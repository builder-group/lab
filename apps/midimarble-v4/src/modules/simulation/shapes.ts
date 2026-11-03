import type { TVec2 } from '@/modules/project';
import { boxDistance, boxExtents, closestPointOnBox, type TBox2 } from './geometry';

// Collider primitives in the wall plane. Every piece is a union of these; the simulation builds one
// Rapier collider per primitive and uses the same shapes for blocking checks and contact refinement.

export type TPieceShape =
	| { kind: 'box'; box: TBox2 }
	/** Segment from `a` to `b` swept by `radius`, used for rail wires and tunnel walls */
	| { kind: 'capsule'; a: TVec2; b: TVec2; radius: number }
	| { kind: 'ball'; center: TVec2; radius: number };

export interface TBounds2 {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

/** Signed distance from a point to the shape outline, negative inside */
export function shapeDistance(shape: TPieceShape, x: number, y: number): number {
	switch (shape.kind) {
		case 'box':
			return boxDistance(shape.box, x, y);
		case 'capsule': {
			const closest = closestPointOnSegment(shape.a, shape.b, x, y);
			return Math.hypot(x - closest.x, y - closest.y) - shape.radius;
		}
		case 'ball':
			return Math.hypot(x - shape.center.x, y - shape.center.y) - shape.radius;
	}
}

/** Closest point on the shape outline, or the point itself when inside */
export function shapeClosestPoint(shape: TPieceShape, x: number, y: number): TVec2 {
	switch (shape.kind) {
		case 'box':
			return closestPointOnBox(shape.box, x, y);
		case 'capsule':
			return pushToRadius(closestPointOnSegment(shape.a, shape.b, x, y), shape.radius, x, y);
		case 'ball':
			return pushToRadius(shape.center, shape.radius, x, y);
	}
}

export function shapeBounds(shape: TPieceShape): TBounds2 {
	switch (shape.kind) {
		case 'box': {
			const extents = boxExtents(shape.box);
			return {
				minX: shape.box.cx - extents.x,
				minY: shape.box.cy - extents.y,
				maxX: shape.box.cx + extents.x,
				maxY: shape.box.cy + extents.y
			};
		}
		case 'capsule':
			return {
				minX: Math.min(shape.a.x, shape.b.x) - shape.radius,
				minY: Math.min(shape.a.y, shape.b.y) - shape.radius,
				maxX: Math.max(shape.a.x, shape.b.x) + shape.radius,
				maxY: Math.max(shape.a.y, shape.b.y) + shape.radius
			};
		case 'ball':
			return {
				minX: shape.center.x - shape.radius,
				minY: shape.center.y - shape.radius,
				maxX: shape.center.x + shape.radius,
				maxY: shape.center.y + shape.radius
			};
	}
}

export function shapesBounds(shapes: TPieceShape[]): TBounds2 {
	const bounds: TBounds2 = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
	for (const shape of shapes) {
		const b = shapeBounds(shape);
		bounds.minX = Math.min(bounds.minX, b.minX);
		bounds.minY = Math.min(bounds.minY, b.minY);
		bounds.maxX = Math.max(bounds.maxX, b.maxX);
		bounds.maxY = Math.max(bounds.maxY, b.maxY);
	}
	return bounds;
}

/** Smallest distance from a point to any of the shapes */
export function shapesDistance(shapes: TPieceShape[], x: number, y: number): number {
	let distance = Infinity;
	for (const shape of shapes) distance = Math.min(distance, shapeDistance(shape, x, y));
	return distance;
}

/** Rotates the shape by `angle` around the origin, then moves it by `offset` */
export function transformShape(shape: TPieceShape, offset: TVec2, angle: number): TPieceShape {
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	const move = (p: TVec2): TVec2 => ({
		x: offset.x + p.x * cos - p.y * sin,
		y: offset.y + p.x * sin + p.y * cos
	});
	switch (shape.kind) {
		case 'box': {
			const center = move({ x: shape.box.cx, y: shape.box.cy });
			return {
				kind: 'box',
				box: { ...shape.box, cx: center.x, cy: center.y, angle: shape.box.angle + angle }
			};
		}
		case 'capsule':
			return { kind: 'capsule', a: move(shape.a), b: move(shape.b), radius: shape.radius };
		case 'ball':
			return { kind: 'ball', center: move(shape.center), radius: shape.radius };
	}
}

export function closestPointOnSegment(a: TVec2, b: TVec2, x: number, y: number): TVec2 {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const lengthSq = dx * dx + dy * dy;
	const t =
		lengthSq > 0 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / lengthSq)) : 0;
	return { x: a.x + dx * t, y: a.y + dy * t };
}

function pushToRadius(center: TVec2, radius: number, x: number, y: number): TVec2 {
	const dx = x - center.x;
	const dy = y - center.y;
	const distance = Math.hypot(dx, dy);
	if (distance <= radius) return { x, y };
	return { x: center.x + (dx / distance) * radius, y: center.y + (dy / distance) * radius };
}

// Paths

const PATH_SPACING = 0.01;
// Consecutive segments bending less than this merge into one capsule
const MERGE_ANGLE = (0.25 * Math.PI) / 180;

/**
 * Smooth polyline through the control points. Uses a centripetal Catmull-Rom spline, which passes
 * through every control point without overshoot, sampled about every centimetre. Nearly straight runs
 * merge so a straight rail is a single segment.
 */
export function smoothPath(points: TVec2[]): TVec2[] {
	const controls = points.filter(
		(point, i) =>
			i === 0 ||
			Math.hypot(point.x - (points[i - 1]?.x ?? 0), point.y - (points[i - 1]?.y ?? 0)) > 1e-9
	);
	if (controls.length < 3) return controls.map((point) => ({ ...point }));
	const sampled: TVec2[] = [{ ...(controls[0] as TVec2) }];
	for (let i = 0; i < controls.length - 1; i++) {
		const p1 = controls[i] as TVec2;
		const p2 = controls[i + 1] as TVec2;
		const p0 = controls[i - 1] ?? reflect(p2, p1);
		const p3 = controls[i + 2] ?? reflect(p1, p2);
		const count = Math.max(1, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / PATH_SPACING));
		for (let s = 1; s <= count; s++) sampled.push(centripetal(p0, p1, p2, p3, s / count));
	}
	return mergeStraight(sampled);
}

/** Length of the polyline */
export function pathLength(path: TVec2[]): number {
	let length = 0;
	for (let i = 1; i < path.length; i++) {
		const a = path[i - 1] as TVec2;
		const b = path[i] as TVec2;
		length += Math.hypot(b.x - a.x, b.y - a.y);
	}
	return length;
}

/** Closest point on the polyline with its arc length and the unit tangent of its segment */
export function projectOnPath(
	path: TVec2[],
	x: number,
	y: number
): { point: TVec2; distance: number; along: number; tangent: TVec2 } {
	let best = {
		point: path[0] ?? { x: 0, y: 0 },
		distance: Infinity,
		along: 0,
		tangent: { x: 1, y: 0 }
	};
	let along = 0;
	for (let i = 1; i < path.length; i++) {
		const a = path[i - 1] as TVec2;
		const b = path[i] as TVec2;
		const length = Math.hypot(b.x - a.x, b.y - a.y);
		if (length <= 0) continue;
		const point = closestPointOnSegment(a, b, x, y);
		const distance = Math.hypot(x - point.x, y - point.y);
		if (distance < best.distance - 1e-12) {
			best = {
				point,
				distance,
				along: along + Math.hypot(point.x - a.x, point.y - a.y),
				tangent: { x: (b.x - a.x) / length, y: (b.y - a.y) / length }
			};
		}
		along += length;
	}
	return best;
}

function reflect(from: TVec2, around: TVec2): TVec2 {
	return { x: 2 * around.x - from.x, y: 2 * around.y - from.y };
}

function centripetal(p0: TVec2, p1: TVec2, p2: TVec2, p3: TVec2, u: number): TVec2 {
	const knot = (a: TVec2, b: TVec2): number =>
		Math.max(1e-9, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)));
	const t0 = 0;
	const t1 = t0 + knot(p0, p1);
	const t2 = t1 + knot(p1, p2);
	const t3 = t2 + knot(p2, p3);
	const t = t1 + (t2 - t1) * u;
	const lerp = (a: TVec2, b: TVec2, ta: number, tb: number): TVec2 => ({
		x: ((tb - t) * a.x + (t - ta) * b.x) / (tb - ta),
		y: ((tb - t) * a.y + (t - ta) * b.y) / (tb - ta)
	});
	const a1 = lerp(p0, p1, t0, t1);
	const a2 = lerp(p1, p2, t1, t2);
	const a3 = lerp(p2, p3, t2, t3);
	const b1 = lerp(a1, a2, t0, t2);
	const b2 = lerp(a2, a3, t1, t3);
	return lerp(b1, b2, t1, t2);
}

function mergeStraight(points: TVec2[]): TVec2[] {
	const merged: TVec2[] = [];
	for (const point of points) {
		const a = merged[merged.length - 2];
		const b = merged[merged.length - 1];
		if (a != null && b != null) {
			const before = Math.atan2(b.y - a.y, b.x - a.x);
			const after = Math.atan2(point.y - b.y, point.x - b.x);
			if (Math.abs(wrapAngle(after - before)) < MERGE_ANGLE)
				merged[merged.length - 1] = { ...point };
			else merged.push({ ...point });
			continue;
		}
		merged.push({ ...point });
	}
	return merged;
}

/** Angle wrapped into (-π, π] */
export function wrapAngle(angle: number): number {
	let wrapped = angle % (2 * Math.PI);
	if (wrapped <= -Math.PI) wrapped += 2 * Math.PI;
	if (wrapped > Math.PI) wrapped -= 2 * Math.PI;
	return wrapped;
}
