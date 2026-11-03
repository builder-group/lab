import type { TVec2 } from '@/modules/project';
import { placeBoxAtContact, placeBoxAtMarble, surfaceNormal, type TBox2 } from './geometry';
import { getPieceDefinition } from './pieces';
import { projectOnPath, smoothPath, transformShape, type TPieceShape } from './shapes';

// World layout of every piece type. Linked pieces are placed by construction: their contact surface
// touches the marble at the placement time, offset by the marble radius along the surface normal.

export interface TPieceLayout {
	/** Pose origin: box centre for platforms, support anchor for rails and tunnels, hub for windmills */
	position: TVec2;
	angle: number;
	contactPoint: TVec2 | null;
	contactNormal: TVec2 | null;
	/** Collider primitives in world coordinates */
	shapes: TPieceShape[];
	/** Platform box, kept so platforms build exactly as before */
	box: TBox2 | null;
	/** Smoothed support line of rails and tunnels in world coordinates */
	path: TVec2[] | null;
	rotor: TRotorLayout | null;
}

export interface TRotorLayout {
	hub: TVec2;
	angle: number;
	/** Collider primitives relative to the hub at angle 0 */
	localShapes: TPieceShape[];
	damping: number;
	motorSpeed: number;
	depth: number;
}

export interface TLayoutInput {
	type: string;
	params: Record<string, number>;
	/** Local control points of rails and tunnels */
	path: TVec2[];
	angle: number;
	contactAt: number;
	marbleRadius: number;
}

/** Places the piece so its contact surface touches a marble centred at `position` */
export function layoutAtMarble(
	input: TLayoutInput,
	position: TVec2,
	velocity: TVec2 | null
): TPieceLayout {
	if (layoutOf(input.type) === 'box') {
		const { length, thickness } = boxSize(input.params);
		const placement = placeBoxAtMarble(
			position,
			velocity,
			input.marbleRadius,
			input.angle,
			input.contactAt,
			length,
			thickness
		);
		return boxLayout(placement.box, placement.contactPoint, placement.contactNormal);
	}
	let normal = baseNormal(input);
	if (velocity != null && normal.x * velocity.x + normal.y * velocity.y > 0) {
		normal = { x: -normal.x, y: -normal.y };
	}
	const contactPoint = {
		x: position.x - normal.x * input.marbleRadius,
		y: position.y - normal.y * input.marbleRadius
	};
	return layoutAtContact(input, contactPoint, normal);
}

/**
 * Places the piece so its contact surface holds `contactPoint` with `normal` facing the marble. Without a
 * normal the surface keeps its unflipped normal, as pinned pieces do.
 */
export function layoutAtContact(
	input: TLayoutInput,
	contactPoint: TVec2,
	normal: TVec2 | null = null
): TPieceLayout {
	const kind = layoutOf(input.type);
	const n = normal ?? baseNormal(input);
	if (kind === 'box') {
		const { length, thickness } = boxSize(input.params);
		const placement = placeBoxAtContact(
			contactPoint,
			n,
			input.angle,
			input.contactAt,
			length,
			thickness
		);
		return boxLayout(placement.box, placement.contactPoint, placement.contactNormal);
	}
	if (kind === 'rotor') {
		const { bladeLength, bladeThickness, hubRadius } = rotorSize(input.params);
		const d = { x: Math.cos(input.angle), y: Math.sin(input.angle) };
		const reach = hubRadius + input.contactAt * bladeLength;
		const hub = {
			x: contactPoint.x - (n.x * bladeThickness) / 2 - d.x * reach,
			y: contactPoint.y - (n.y * bladeThickness) / 2 - d.y * reach
		};
		return rotorLayout(input, hub, contactPoint, n);
	}
	const radius = input.params['radius'] ?? 0.002;
	const local = localPath(input.path);
	const base = baseNormal(input);
	// The side the marble rides on, in local terms: +1 above the left normal of the path
	const side = n.x * base.x + n.y * base.y >= 0 ? 1 : -1;
	const origin = { x: contactPoint.x - n.x * radius, y: contactPoint.y - n.y * radius };
	return pathLayout(input, local, origin, side, contactPoint, n);
}

/** Places an unlinked piece from its transform */
export function layoutFree(input: TLayoutInput, position: TVec2): TPieceLayout {
	const kind = layoutOf(input.type);
	if (kind === 'box') {
		const { length, thickness } = boxSize(input.params);
		const box = {
			cx: position.x,
			cy: position.y,
			angle: input.angle,
			halfLength: length / 2,
			halfThickness: thickness / 2
		};
		return boxLayout(box, null, null);
	}
	if (kind === 'rotor') return rotorLayout(input, position, null, null);
	// The transform places the local origin, so the anchor shift is undone
	const local = localPath(input.path);
	const cos = Math.cos(input.angle);
	const sin = Math.sin(input.angle);
	const origin = {
		x: position.x + local.anchor.x * cos - local.anchor.y * sin,
		y: position.y + local.anchor.x * sin + local.anchor.y * cos
	};
	return pathLayout(input, local, origin, 1, null, null);
}

export function layoutOf(type: string): 'box' | 'path' | 'tube' | 'rotor' {
	return getPieceDefinition(type)?.layout ?? 'box';
}

// Platforms

function boxSize(params: Record<string, number>): { length: number; thickness: number } {
	return { length: params['length'] ?? 0.06, thickness: params['thickness'] ?? 0.008 };
}

function boxLayout(
	box: TBox2,
	contactPoint: TVec2 | null,
	contactNormal: TVec2 | null
): TPieceLayout {
	return {
		position: { x: box.cx, y: box.cy },
		angle: box.angle,
		contactPoint,
		contactNormal,
		shapes: [{ kind: 'box', box }],
		box,
		path: null,
		rotor: null
	};
}

/** Surface normal before flipping toward the marble */
function baseNormal(input: TLayoutInput): TVec2 {
	const kind = layoutOf(input.type);
	if (kind === 'box' || kind === 'rotor') return surfaceNormal(input.angle);
	const { tangent } = localPath(input.path);
	return surfaceNormal(input.angle + Math.atan2(tangent.y, tangent.x));
}

// Rails and tunnels

interface TLocalPath {
	points: TVec2[];
	/** Point of the smoothed path closest to the local origin, where the marble touches */
	anchor: TVec2;
	anchorAlong: number;
	tangent: TVec2;
}

const localPathCache = new WeakMap<TVec2[], TLocalPath>();

function localPath(controls: TVec2[]): TLocalPath {
	const cached = localPathCache.get(controls);
	if (cached != null) return cached;
	const points = smoothPath(controls);
	const projected = projectOnPath(points, 0, 0);
	const local = {
		points,
		anchor: projected.point,
		anchorAlong: projected.along,
		tangent: projected.tangent
	};
	localPathCache.set(controls, local);
	return local;
}

function pathLayout(
	input: TLayoutInput,
	local: TLocalPath,
	origin: TVec2,
	side: number,
	contactPoint: TVec2 | null,
	contactNormal: TVec2 | null
): TPieceLayout {
	const radius = input.params['radius'] ?? 0.002;
	const cos = Math.cos(input.angle);
	const sin = Math.sin(input.angle);
	const toWorld = (p: TVec2): TVec2 => {
		const x = p.x - local.anchor.x;
		const y = p.y - local.anchor.y;
		return { x: origin.x + x * cos - y * sin, y: origin.y + x * sin + y * cos };
	};
	const path = local.points.map(toWorld);
	const shapes: TPieceShape[] = capsuleChain(path, radius);
	if (layoutOf(input.type) === 'tube') {
		const bore = input.params['bore'] ?? 0.004;
		const mouth = input.params['mouth'] ?? 0.03;
		const offset = 2 * input.marbleRadius + bore + 2 * radius;
		const ceiling = offsetPath(local.points, local.anchorAlong + mouth, offset * side);
		shapes.push(...capsuleChain(ceiling.map(toWorld), radius));
	}
	return {
		position: origin,
		angle: input.angle,
		contactPoint,
		contactNormal,
		shapes,
		box: null,
		path,
		rotor: null
	};
}

function capsuleChain(points: TVec2[], radius: number): TPieceShape[] {
	const shapes: TPieceShape[] = [];
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1] as TVec2;
		const b = points[i] as TVec2;
		shapes.push({ kind: 'capsule', a, b, radius });
	}
	if (points.length === 1 && points[0] != null)
		shapes.push({ kind: 'capsule', a: points[0], b: points[0], radius });
	return shapes;
}

/** The part of the path after arc length `from`, moved by `offset` along its left normal */
function offsetPath(points: TVec2[], from: number, offset: number): TVec2[] {
	const result: TVec2[] = [];
	let along = 0;
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1] as TVec2;
		const b = points[i] as TVec2;
		const length = Math.hypot(b.x - a.x, b.y - a.y);
		if (length <= 0) continue;
		const nx = -(b.y - a.y) / length;
		const ny = (b.x - a.x) / length;
		const startT = Math.max(0, (from - along) / length);
		along += length;
		if (startT >= 1) continue;
		// Vertex normals average the two adjacent segments so the walls stay parallel through bends
		const start = { x: a.x + (b.x - a.x) * startT, y: a.y + (b.y - a.y) * startT };
		if (!result.length) result.push({ x: start.x + nx * offset, y: start.y + ny * offset });
		const next = points[i + 1];
		let vx = nx;
		let vy = ny;
		if (next != null) {
			const nextLength = Math.hypot(next.x - b.x, next.y - b.y);
			if (nextLength > 0) {
				const mx = nx - (next.y - b.y) / nextLength;
				const my = ny + (next.x - b.x) / nextLength;
				const m = Math.hypot(mx, my);
				// Keep the wall distance through the bend: scale by 1 / cos(half the bend angle)
				const scale = m > 1e-9 ? 2 / (m * m) : 1;
				vx = mx * scale;
				vy = my * scale;
			}
		}
		result.push({ x: b.x + vx * offset, y: b.y + vy * offset });
	}
	return result;
}

// Windmills

function rotorSize(params: Record<string, number>): {
	bladeCount: number;
	bladeLength: number;
	bladeThickness: number;
	hubRadius: number;
} {
	return {
		bladeCount: Math.max(2, Math.round(params['bladeCount'] ?? 4)),
		bladeLength: params['bladeLength'] ?? 0.06,
		bladeThickness: params['bladeThickness'] ?? 0.006,
		hubRadius: params['hubRadius'] ?? 0.008
	};
}

/** Hub and blades relative to the hub, with blade 0 along +x */
export function rotorLocalShapes(params: Record<string, number>): TPieceShape[] {
	const { bladeCount, bladeLength, bladeThickness, hubRadius } = rotorSize(params);
	const shapes: TPieceShape[] = [{ kind: 'ball', center: { x: 0, y: 0 }, radius: hubRadius }];
	for (let k = 0; k < bladeCount; k++) {
		const angle = (2 * Math.PI * k) / bladeCount;
		const reach = hubRadius + bladeLength / 2;
		shapes.push({
			kind: 'box',
			box: {
				cx: Math.cos(angle) * reach,
				cy: Math.sin(angle) * reach,
				angle,
				halfLength: bladeLength / 2,
				halfThickness: bladeThickness / 2
			}
		});
	}
	return shapes;
}

function rotorLayout(
	input: TLayoutInput,
	hub: TVec2,
	contactPoint: TVec2 | null,
	contactNormal: TVec2 | null
): TPieceLayout {
	const localShapes = rotorLocalShapes(input.params);
	return {
		position: hub,
		angle: input.angle,
		contactPoint,
		contactNormal,
		shapes: localShapes.map((shape) => transformShape(shape, hub, input.angle)),
		box: null,
		path: null,
		rotor: {
			hub,
			angle: input.angle,
			localShapes,
			damping: input.params['damping'] ?? 0.5,
			motorSpeed: input.params['motorSpeed'] ?? 0,
			depth: input.params['depth'] ?? 0.03
		}
	};
}
