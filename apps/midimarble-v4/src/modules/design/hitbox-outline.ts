import { pieceAngleAt, pieceKind } from '@/modules/compose/scene';
import type { TVec2 } from '@/modules/project';
import type { TResolvedPiece } from '@/modules/simulation';
import { resolvedPieceShapes } from '@/modules/simulation/clearance';
import { rotorLocalShapes } from '@/modules/simulation/piece-layout';
import { transformShape, type TPieceShape } from '@/modules/simulation/shapes';

/** Line segments of a half circle at a capsule's end and of a quarter of a ball */
const ARC_STEPS = 8;
/** A sharp bend moves the outline at most this many radii out from the wire */
const MAX_MITER = 2;

// Resolved pieces stay the same objects until the next run, so a piece's still colliders are outlined once
const stillOutlines = new WeakMap<TResolvedPiece, TVec2[][]>();

/**
 * A piece's hitbox as closed outlines on the wall, from the colliders the simulation uses: a platform's box, the
 * capsule chains of rails, tunnels and Bowls, and a windmill's hub and arms as they turned by `time`
 */
export function hitboxOutlines(piece: TResolvedPiece, time: number): TVec2[][] {
	if (pieceKind(piece) === 'rotor') {
		const angle = pieceAngleAt(piece, time);
		return shapeOutlines(rotorLocalShapes(piece.params).map((shape) => transformShape(shape, piece.position, angle)));
	}
	const known = stillOutlines.get(piece);
	if (known != null) return known;
	const outlines = shapeOutlines(resolvedPieceShapes(piece));
	stillOutlines.set(piece, outlines);
	return outlines;
}

/** Closed outlines of collider primitives; capsules that continue one another become one outline around their wire */
export function shapeOutlines(shapes: TPieceShape[]): TVec2[][] {
	const outlines: TVec2[][] = [];
	let chain: TVec2[] = [];
	let chainRadius = 0;
	const flush = (): void => {
		if (chain.length > 0) outlines.push(wireOutline(chain, chainRadius));
		chain = [];
	};
	for (const shape of shapes) {
		if (shape.kind !== 'capsule') {
			flush();
			outlines.push(shape.kind === 'box' ? boxOutline(shape) : ballOutline(shape.center, shape.radius));
			continue;
		}
		const last = chain[chain.length - 1];
		const continues = last != null && chainRadius === shape.radius && Math.hypot(last.x - shape.a.x, last.y - shape.a.y) < 1e-6;
		if (!continues) {
			flush();
			chain = [shape.a];
			chainRadius = shape.radius;
		}
		chain.push(shape.b);
	}
	flush();
	return outlines;
}

function boxOutline(shape: Extract<TPieceShape, { kind: 'box' }>): TVec2[] {
	const { cx, cy, angle, halfLength, halfThickness } = shape.box;
	const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
	return [
		[-halfLength, -halfThickness],
		[halfLength, -halfThickness],
		[halfLength, halfThickness],
		[-halfLength, halfThickness]
	].map(([x = 0, y = 0]) => ({ x: cx + x * cos - y * sin, y: cy + x * sin + y * cos }));
}

function ballOutline(center: TVec2, radius: number): TVec2[] {
	return Array.from({ length: ARC_STEPS * 4 }, (_, index) => {
		const angle = (index / (ARC_STEPS * 4)) * Math.PI * 2;
		return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
	});
}

/** The outline of a polyline swept by `radius`: one side along it, a round end, the other side back, a round start */
function wireOutline(points: TVec2[], radius: number): TVec2[] {
	const line = points.filter((point, index) => {
		const previous = points[index - 1];
		return previous == null || Math.hypot(point.x - previous.x, point.y - previous.y) > 1e-9;
	});
	const first = line[0];
	const last = line[line.length - 1];
	if (first == null || last == null) return [];
	if (line.length === 1) return ballOutline(first, radius);

	const normals = line.map((point, index) => vertexOffset(line[index - 1], point, line[index + 1]));
	const side = (sign: number): TVec2[] => line.map((point, index) => ({ x: point.x + sign * radius * (normals[index]?.x ?? 0), y: point.y + sign * radius * (normals[index]?.y ?? 0) }));
	const secondLast = line[line.length - 2] ?? first;
	const endAngle = Math.atan2(last.y - secondLast.y, last.x - secondLast.x);
	const second = line[1] ?? last;
	const startAngle = Math.atan2(first.y - second.y, first.x - second.x);
	return [...side(1), ...arc(last, radius, endAngle), ...side(-1).reverse(), ...arc(first, radius, startAngle)];
}

/** Points of the half circle that bulges toward `facing`, from its left side to its right, without the two sides' own ends */
function arc(center: TVec2, radius: number, facing: number): TVec2[] {
	return Array.from({ length: ARC_STEPS - 1 }, (_, index) => {
		const angle = facing + Math.PI / 2 - (Math.PI * (index + 1)) / ARC_STEPS;
		return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
	});
}

/** Left normal at a vertex, longer at a bend so both neighbouring sides stay `radius` from the wire */
function vertexOffset(previous: TVec2 | undefined, point: TVec2, next: TVec2 | undefined): TVec2 {
	const incoming = direction(previous ?? point, previous != null ? point : (next ?? point));
	const outgoing = direction(next != null ? point : (previous ?? point), next ?? point);
	const sum = { x: incoming.x + outgoing.x, y: incoming.y + outgoing.y };
	const length = Math.hypot(sum.x, sum.y);
	if (length < 1e-9) return { x: -incoming.y, y: incoming.x };
	const tangent = { x: sum.x / length, y: sum.y / length };
	const miter = Math.min(MAX_MITER, 1 / Math.max(1e-6, tangent.x * incoming.x + tangent.y * incoming.y));
	return { x: -tangent.y * miter, y: tangent.x * miter };
}

function direction(a: TVec2, b: TVec2): TVec2 {
	const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
	return { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
}
