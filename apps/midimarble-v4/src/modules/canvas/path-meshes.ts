import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TVec2 } from '@/modules/project';
import type { TResolvedPiece } from '@/modules/simulation';
import { pieceKind, tubeCeiling } from '@/modules/scene';

// Rails, Tunnels and Bowls as real geometry at the marble's depth, for Track's 3D view: plain tubes standing on thin
// posts from the wall. The flat wall and the Draft Preview keep drawing them as lines.

/** Meters between a path's posts */
const POST_SPACING = 0.08;
const POST_RADIUS = 0.0011;
const TIE_SPACING = 0.025;
const TUBE_SIDES = 8;
const TUNNEL_SIDES = 14;

export interface TPathMeshes {
	/** What the marble runs on */
	wires: THREE.BufferGeometry | null;
	/** Ties between a rail's wires and the posts back to the wall */
	posts: THREE.BufferGeometry | null;
	/** A Tunnel's clear tube */
	shell: THREE.BufferGeometry | null;
}

/** The meshes of a path piece, in wall coordinates, with `z` the depth the marble runs at */
export function pathMeshes(piece: TResolvedPiece, z: number): TPathMeshes {
	const radius = Math.max(piece.params['radius'] ?? 0.0025, 0.001);
	const gauge = Math.max(radius * 2.6, 0.005);
	const kind = pieceKind(piece);
	const wires: THREE.BufferGeometry[] = [];
	const posts: THREE.BufferGeometry[] = [];
	const shells: THREE.BufferGeometry[] = [];

	if (kind === 'tube') {
		const floor = piece.path ?? [];
		const ceiling = tubeCeiling(piece);
		const rings = Math.min(floor.length, ceiling.length);
		if (rings >= 2) {
			shells.push(tunnelShell(floor.slice(0, rings), ceiling.slice(0, rings), z));
			const reach = Math.hypot((ceiling[0]?.x ?? 0) - (floor[0]?.x ?? 0), (ceiling[0]?.y ?? 0) - (floor[0]?.y ?? 0)) / 2;
			posts.push(...postsAlong(floor, Math.max(0, z - reach)));
		}
		wires.push(tubeAlong(floor, radius, z));
	} else if (kind === 'generated') {
		for (const line of piece.paths ?? []) {
			wires.push(tubeAlong(line, radius, z));
			posts.push(...postsAlong(line, z));
		}
	} else {
		// A rail's or Bowl's two wires, side by side in depth so the marble rolls between them
		const lines = kind === 'catcher' ? (piece.paths ?? []) : [piece.path ?? []];
		for (const line of lines) {
			wires.push(tubeAlong(line, radius * 0.7, z - gauge / 2), tubeAlong(line, radius * 0.7, z + gauge / 2));
			posts.push(...postsAlong(line, z - gauge / 2), ...tiesAlong(line, z, gauge));
		}
	}
	return { wires: merged(wires), posts: merged(posts), shell: merged(shells) };
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
	const usable = parts.filter((part) => (part.getAttribute('position')?.count ?? 0) > 0);
	const geometry = usable.length > 1 ? mergeGeometries(usable) : (usable[0] ?? null);
	for (const part of usable) if (part !== geometry) part.dispose();
	return geometry;
}

/** A round tube along a polyline in the plane at depth `z`, with averaged normals at its joins */
function tubeAlong(line: readonly TVec2[], radius: number, z: number): THREE.BufferGeometry {
	const points = distinct(line);
	const rings = points.map((point, index) => {
		const before = points[index - 1] ?? point;
		const after = points[index + 1] ?? point;
		const length = Math.hypot(after.x - before.x, after.y - before.y) || 1;
		const normal = { x: -(after.y - before.y) / length, y: (after.x - before.x) / length };
		return ringAround({ x: point.x, y: point.y, z }, { x: normal.x * radius, y: normal.y * radius }, radius, TUBE_SIDES);
	});
	return lofted(rings, true);
}

/** A Tunnel's tube: round in depth, reaching from its floor to its ceiling along the wall */
function tunnelShell(floor: readonly TVec2[], ceiling: readonly TVec2[], z: number): THREE.BufferGeometry {
	const rings = floor.map((bottom, index) => {
		const top = ceiling[index] ?? bottom;
		const across = { x: (top.x - bottom.x) / 2, y: (top.y - bottom.y) / 2 };
		return ringAround({ x: bottom.x + across.x, y: bottom.y + across.y, z }, across, Math.hypot(across.x, across.y), TUNNEL_SIDES);
	});
	return lofted(rings, false);
}

/** A closed ring of points around `center`, spanned by `across` in the wall's plane and `depth` out of it */
function ringAround(center: { x: number; y: number; z: number }, across: TVec2, depth: number, sides: number): THREE.Vector3[] {
	return Array.from({ length: sides }, (_, side) => {
		const angle = (side / sides) * Math.PI * 2;
		const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
		return new THREE.Vector3(center.x + across.x * cos, center.y + across.y * cos, center.z + depth * sin);
	});
}

function lofted(rings: readonly THREE.Vector3[][], hasCaps: boolean): THREE.BufferGeometry {
	const geometry = new THREE.BufferGeometry();
	const sides = rings[0]?.length ?? 0;
	if (rings.length < 2 || sides === 0) return geometry;
	const positions = rings.flatMap((ring) => ring.flatMap((point) => [point.x, point.y, point.z]));
	const indices: number[] = [];
	for (let ring = 0; ring < rings.length - 1; ring++) {
		for (let side = 0; side < sides; side++) {
			const next = (side + 1) % sides;
			const [a, b, c, d] = [ring * sides + side, ring * sides + next, (ring + 1) * sides + side, (ring + 1) * sides + next];
			indices.push(a, c, b, b, c, d);
		}
	}
	if (hasCaps) {
		const last = (rings.length - 1) * sides;
		for (let side = 1; side < sides - 1; side++) indices.push(0, side, side + 1, last, last + side + 1, last + side);
	}
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setIndex(indices);
	geometry.computeVertexNormals();
	return geometry;
}

/** Thin posts from the wall to depth `z`, at both ends of the line and evenly between them */
function postsAlong(line: readonly TVec2[], z: number): THREE.BufferGeometry[] {
	if (z <= 0) return [];
	return spots(line, POST_SPACING).map((point) => rod(point, 0, z, POST_RADIUS));
}

function tiesAlong(line: readonly TVec2[], z: number, gauge: number): THREE.BufferGeometry[] {
	return spots(line, TIE_SPACING).map((point) => rod(point, z - gauge / 2, z + gauge / 2, POST_RADIUS));
}

/** A rod along depth, from `from` to `to` */
function rod(point: TVec2, from: number, to: number, radius: number): THREE.BufferGeometry {
	const geometry = new THREE.CylinderGeometry(radius, radius, to - from, 6).rotateX(Math.PI / 2).translate(point.x, point.y, (from + to) / 2);
	geometry.deleteAttribute('uv');
	return geometry;
}

/** Points along a line every `spacing` or a little less, from end to end */
export function spots(line: readonly TVec2[], spacing: number): TVec2[] {
	const points = distinct(line);
	const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - (points[index] as TVec2).x, point.y - (points[index] as TVec2).y));
	const total = lengths.reduce((sum, length) => sum + length, 0);
	if (total <= 0) return points.slice(0, 1);
	const count = Math.max(1, Math.ceil(total / spacing));
	const result: TVec2[] = [];
	let [segment, walked] = [0, 0];
	for (let index = 0; index <= count; index++) {
		const along = (total * index) / count;
		while (segment < lengths.length - 1 && walked + (lengths[segment] ?? 0) < along) walked += lengths[segment++] ?? 0;
		const [a, b] = [points[segment] as TVec2, points[segment + 1] as TVec2];
		const share = Math.min(1, (along - walked) / (lengths[segment] || 1));
		result.push({ x: a.x + (b.x - a.x) * share, y: a.y + (b.y - a.y) * share });
	}
	return result;
}

/** The line without repeated points, which have no direction */
function distinct(line: readonly TVec2[]): TVec2[] {
	return line.filter((point, index) => {
		const before = line[index - 1];
		return before == null || Math.hypot(point.x - before.x, point.y - before.y) > 1e-6;
	});
}
