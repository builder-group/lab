import type { TVec2 } from '@/modules/project';
import { shapeBounds, shapeDistance, type TBounds2, type TPieceShape } from './shapes';
import type { TMarbleSample, TResolvedPiece } from './types';

// Distances between resolved pieces and from the marble path to pieces, for checks that want a margin
// rather than a contact. Shapes are compared through points sampled along their outlines, which is exact
// for a point against a shape and within half a sample step for two shapes.

const SAMPLE_STEP = 0.004;

/** Collider primitives of a resolved piece in world coordinates. Platforms carry only their pose. */
export function resolvedPieceShapes(piece: TResolvedPiece): TPieceShape[] {
	if (piece.shapes != null) return piece.shapes;
	return [
		{
			kind: 'box',
			box: {
				cx: piece.position.x,
				cy: piece.position.y,
				angle: piece.angle,
				halfLength: (piece.params['length'] ?? 0) / 2,
				halfThickness: (piece.params['thickness'] ?? 0) / 2
			}
		}
	];
}

/**
 * Smallest distance between two sets of shapes, negative when they overlap. Returns the gap between
 * their bounds instead when that alone is at least `limit`.
 */
export function shapesGap(a: TPieceShape[], b: TPieceShape[], limit = Infinity): number {
	const boundsGap = gapBetween(boundsOf(a), boundsOf(b));
	if (boundsGap >= limit) return boundsGap;
	let gap = Infinity;
	for (const [from, to] of [
		[a, b],
		[b, a]
	] as const) {
		for (const shape of from) {
			for (const sample of outlineSamples(shape)) {
				for (const other of to)
					gap = Math.min(gap, shapeDistance(other, sample.point.x, sample.point.y) - sample.radius);
			}
		}
	}
	return gap;
}

/**
 * Smallest distance between the marble surface and the shapes over the samples within `[from, to]`,
 * negative when the marble would pass through them
 */
export function pathGap(
	samples: TMarbleSample[],
	radius: number,
	shapes: TPieceShape[],
	from: number,
	to: number
): number {
	if (!shapes.length) return Infinity;
	const bounds = boundsOf(shapes);
	let gap = Infinity;
	for (const sample of samples) {
		if (sample.time < from || sample.time > to) continue;
		const { x, y } = sample.position;
		const outside = Math.max(bounds.minX - x, x - bounds.maxX, bounds.minY - y, y - bounds.maxY);
		if (outside - radius >= gap) continue;
		for (const shape of shapes) gap = Math.min(gap, shapeDistance(shape, x, y) - radius);
	}
	return gap;
}

export function boundsOf(shapes: TPieceShape[]): TBounds2 {
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

function gapBetween(a: TBounds2, b: TBounds2): number {
	const dx = Math.max(a.minX - b.maxX, b.minX - a.maxX, 0);
	const dy = Math.max(a.minY - b.maxY, b.minY - a.maxY, 0);
	return Math.hypot(dx, dy);
}

/** Points along the outline, each with the radius the shape adds around it */
function outlineSamples(shape: TPieceShape): { point: TVec2; radius: number }[] {
	switch (shape.kind) {
		case 'box': {
			const { cx, cy, angle, halfLength, halfThickness } = shape.box;
			const cos = Math.cos(angle);
			const sin = Math.sin(angle);
			const corners = [
				[-halfLength, -halfThickness],
				[halfLength, -halfThickness],
				[halfLength, halfThickness],
				[-halfLength, halfThickness]
			] as const;
			const samples: { point: TVec2; radius: number }[] = [];
			corners.forEach(([ax, ay], i) => {
				const [bx, by] = corners[(i + 1) % corners.length] ?? corners[0];
				const count = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / SAMPLE_STEP));
				for (let k = 0; k < count; k++) {
					const lx = ax + ((bx - ax) * k) / count;
					const ly = ay + ((by - ay) * k) / count;
					samples.push({
						point: { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos },
						radius: 0
					});
				}
			});
			return samples;
		}
		case 'capsule': {
			const { a, b, radius } = shape;
			const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / SAMPLE_STEP));
			return Array.from({ length: count + 1 }, (_, k) => ({
				point: { x: a.x + ((b.x - a.x) * k) / count, y: a.y + ((b.y - a.y) * k) / count },
				radius
			}));
		}
		case 'ball':
			return [{ point: shape.center, radius: shape.radius }];
	}
}
