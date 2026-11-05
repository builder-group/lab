import { distanceToSegment, isPointInPolygon, pieceKind, pieceOutline } from '@/modules/scene';
import type { TVec2 } from '@/modules/project';
import { shownDepth, type TResolvedPiece } from '@/modules/simulation';

/**
 * Selection outline of a solid piece in the Draft Preview: the convex hull of its corners at the wall and at its
 * front, as the steep film camera sees the whole bar, moved out by `margin` pixels so the stroke clears the piece
 * like the Track canvas's selection. Points that are not finite are left out.
 */
export function selectionHull(points: TVec2[], margin: number): TVec2[] {
	const hull = convexHull(points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
	return hull.length < 3 ? hull : offsetConvex(hull, margin);
}

/** Convex hull of points by Andrew's monotone chain */
export function convexHull(points: TVec2[]): TVec2[] {
	const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
	if (sorted.length < 3) return sorted;
	const cross = (o: TVec2, a: TVec2, b: TVec2): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
	const lower: TVec2[] = [];
	for (const point of sorted) {
		while (lower.length >= 2 && cross(lower[lower.length - 2] as TVec2, lower[lower.length - 1] as TVec2, point) <= 0) lower.pop();
		lower.push(point);
	}
	const upper: TVec2[] = [];
	for (const point of sorted.reverse()) {
		while (upper.length >= 2 && cross(upper[upper.length - 2] as TVec2, upper[upper.length - 1] as TVec2, point) <= 0) upper.pop();
		upper.push(point);
	}
	return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Moves each edge of a convex polygon out by `distance`, keeping its corners sharp */
function offsetConvex(hull: TVec2[], distance: number): TVec2[] {
	const center = { x: hull.reduce((sum, p) => sum + p.x, 0) / hull.length, y: hull.reduce((sum, p) => sum + p.y, 0) / hull.length };
	const normalOf = (a: TVec2, b: TVec2): TVec2 => {
		const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
		const normal = { x: (b.y - a.y) / length, y: -(b.x - a.x) / length };
		const mid = { x: (a.x + b.x) / 2 - center.x, y: (a.y + b.y) / 2 - center.y };
		return normal.x * mid.x + normal.y * mid.y < 0 ? { x: -normal.x, y: -normal.y } : normal;
	};
	return hull.map((corner, index) => {
		const previous = hull[(index + hull.length - 1) % hull.length] as TVec2;
		const next = hull[(index + 1) % hull.length] as TVec2;
		const a = normalOf(previous, corner);
		const b = normalOf(corner, next);
		// The corner moves along the bisector far enough that both edges move by `distance`; capped for thin spikes
		const bisector = { x: a.x + b.x, y: a.y + b.y };
		const dot = bisector.x * a.x + bisector.y * a.y;
		const scale = dot > 0.2 ? distance / dot : distance * 5;
		return { x: corner.x + bisector.x * scale, y: corner.y + bisector.y * scale };
	});
}

type TToScreen = (point: TVec2, z: number) => TVec2;

/**
 * Selection outline of a piece in CSS pixels through a perspective: rails and tunnels by their outline at the marble's
 * depth, solid pieces by everything seen of them from the wall to their front, a few pixels out like the flat canvas
 */
export function pieceScreenOutline(piece: TResolvedPiece, toScreen: TToScreen, pathZ: number): TVec2[] {
	const kind = pieceKind(piece);
	const wall = pieceOutline(piece);
	if (kind === 'path' || kind === 'tube') return wall.map((corner) => toScreen(corner, pathZ));
	const depth = shownDepth(piece);
	return selectionHull([...wall.map((corner) => toScreen(corner, 0)), ...wall.map((corner) => toScreen(corner, depth))], 3);
}

/** The piece under a CSS pixel point through a perspective; thin ones stay pickable within a few pixels */
export function pickPiece(pieces: readonly TResolvedPiece[], point: TVec2, toScreen: TToScreen, pathZ: number): string | null {
	let best: { id: string; distance: number } | null = null;
	for (const piece of pieces) {
		const kind = pieceKind(piece);
		const wall = pieceOutline(piece);
		if (kind === 'path' || kind === 'tube') {
			const outline = wall.map((corner) => toScreen(corner, pathZ));
			if (isPointInPolygon(point, outline)) return piece.pieceId;
			const distance = distanceToOutline(point, outline);
			if (distance < 6 && (best == null || distance < best.distance)) best = { id: piece.pieceId, distance };
			continue;
		}
		// A steep camera sees bars from above: the piece covers its outline at the wall, at its front and the sides between them
		const depth = shownDepth(piece);
		const back = wall.map((corner) => toScreen(corner, 0));
		const front = wall.map((corner) => toScreen(corner, depth));
		const sides = wall.map((_, index) => {
			const next = (index + 1) % wall.length;
			return [back[index], back[next], front[next], front[index]].filter((corner) => corner != null);
		});
		if ([back, front, ...sides].some((polygon) => isPointInPolygon(point, polygon))) return piece.pieceId;
		const distance = Math.min(distanceToOutline(point, back), distanceToOutline(point, front));
		if (distance < 6 && (best == null || distance < best.distance)) best = { id: piece.pieceId, distance };
	}
	return best?.id ?? null;
}

function distanceToOutline(point: TVec2, outline: TVec2[]): number {
	return outline.reduce((best, a, index) => {
		const b = outline[(index + 1) % outline.length] ?? a;
		return Math.min(best, distanceToSegment(point, a, b));
	}, Infinity);
}
