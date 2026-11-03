import type { TVec2 } from '@/modules/project';

// Pointer targets are picked in screen space, so hit areas keep a constant size at every zoom level and
// work the same in 2D and orbit views.

export interface TPickScene {
	/** Draggable handles, checked first */
	handles: TScreenHandle[];
	/** Open hit dots */
	dots: TScreenDot[];
	/** Piece outlines, later entries drawn on top */
	pieces: TScreenPiece[];
}

export type THandleKind = 'rotate' | 'release' | 'pathEnd' | 'pathBend' | 'node' | 'nodeIn' | 'nodeOut';

export interface TScreenHandle {
	kind: THandleKind;
	entityId: string;
	position: TVec2;
	radius: number;
	/** Node of a drawn rail, for node and handle kinds */
	index?: number;
}

export interface TScreenDot {
	laneId: string;
	hitId: string;
	position: TVec2;
}

export interface TScreenPiece {
	entityId: string;
	/** Outline corners in order */
	corners: TVec2[];
}

/** A marble trajectory in screen space with the time of each point */
export interface TScreenTrack {
	laneId: string;
	points: TVec2[];
	times: number[];
}

export type TPick =
	| { kind: 'rotate' | 'release' | 'pathEnd' | 'pathBend'; entityId: string }
	| { kind: 'node' | 'nodeIn' | 'nodeOut'; entityId: string; index: number }
	| { kind: 'dot'; laneId: string; hitId: string }
	| { kind: 'piece'; entityId: string }
	| { kind: 'track'; laneId: string; time: number; position: TVec2 };

export const DOT_PICK_RADIUS = 10;
// Thin bars far away are still easy to click within this distance of their outline
const PIECE_PICK_SLOP = 4;
const HANDLE_PICK_SLOP = 4;

export function pick(point: TVec2, scene: TPickScene): TPick | null {
	for (let i = scene.handles.length - 1; i >= 0; i--) {
		const handle = scene.handles[i];
		if (handle != null && distance(point, handle.position) <= handle.radius + HANDLE_PICK_SLOP) {
			if (handle.kind === 'node' || handle.kind === 'nodeIn' || handle.kind === 'nodeOut') {
				return { kind: handle.kind, entityId: handle.entityId, index: handle.index ?? 0 };
			}
			return { kind: handle.kind, entityId: handle.entityId };
		}
	}

	let nearestDot: TScreenDot | null = null;
	let nearestDistance = DOT_PICK_RADIUS;
	for (const dot of scene.dots) {
		const dotDistance = distance(point, dot.position);
		if (dotDistance <= nearestDistance) {
			nearestDot = dot;
			nearestDistance = dotDistance;
		}
	}
	if (nearestDot != null) return { kind: 'dot', laneId: nearestDot.laneId, hitId: nearestDot.hitId };

	for (let i = scene.pieces.length - 1; i >= 0; i--) {
		const piece = scene.pieces[i];
		if (piece == null) continue;
		if (isPointInPolygon(point, piece.corners) || distanceToPolygon(point, piece.corners) <= PIECE_PICK_SLOP) {
			return { kind: 'piece', entityId: piece.entityId };
		}
	}
	return null;
}

export const TRACK_PICK_RADIUS = 6;

/** The trajectory point nearest to `point` within a few pixels, with its time interpolated along the segment */
export function pickTrack(point: TVec2, tracks: TScreenTrack[], radius = TRACK_PICK_RADIUS): TPick | null {
	let best: { laneId: string; time: number; position: TVec2; distance: number } | null = null;
	for (const track of tracks) {
		for (let i = 1; i < track.points.length; i++) {
			const a = track.points[i - 1] as TVec2;
			const b = track.points[i] as TVec2;
			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const lengthSquared = dx * dx + dy * dy;
			const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
			const position = { x: a.x + t * dx, y: a.y + t * dy };
			const d = distance(point, position);
			if (d <= radius && (best == null || d < best.distance)) {
				const time = (track.times[i - 1] ?? 0) + ((track.times[i] ?? 0) - (track.times[i - 1] ?? 0)) * t;
				best = { laneId: track.laneId, time, position, distance: d };
			}
		}
	}
	return best == null ? null : { kind: 'track', laneId: best.laneId, time: best.time, position: best.position };
}

export interface TRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export function rectFromPoints(a: TVec2, b: TVec2): TRect {
	return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/** Pieces the marquee touches, like Figma's default marquee */
export function piecesInRect(rect: TRect, pieces: TScreenPiece[]): string[] {
	const ids: string[] = [];
	for (const piece of pieces) {
		if (piece.corners.some((corner) => isPointInRect(corner, rect))) ids.push(piece.entityId);
		else {
			const rectCorners = [
				{ x: rect.x, y: rect.y },
				{ x: rect.x + rect.width, y: rect.y },
				{ x: rect.x + rect.width, y: rect.y + rect.height },
				{ x: rect.x, y: rect.y + rect.height }
			];
			const isCovered = rectCorners.some((corner) => isPointInPolygon(corner, piece.corners));
			const isCrossing = edges(piece.corners).some(([a, b]) => edges(rectCorners).some(([c, d]) => segmentsIntersect(a, b, c, d)));
			if (isCovered || isCrossing) ids.push(piece.entityId);
		}
	}
	return ids;
}

export function isPointInRect(point: TVec2, rect: TRect): boolean {
	return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

export function isPointInPolygon(point: TVec2, corners: TVec2[]): boolean {
	let inside = false;
	for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
		const a = corners[i];
		const b = corners[j];
		if (a == null || b == null) continue;
		const crosses = a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
		if (crosses) inside = !inside;
	}
	return inside;
}

function distanceToPolygon(point: TVec2, corners: TVec2[]): number {
	let best = Number.POSITIVE_INFINITY;
	for (const [a, b] of edges(corners)) best = Math.min(best, distanceToSegment(point, a, b));
	return best;
}

export function distanceToSegment(point: TVec2, a: TVec2, b: TVec2): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const lengthSquared = dx * dx + dy * dy;
	const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
	return distance(point, { x: a.x + t * dx, y: a.y + t * dy });
}

function edges(corners: TVec2[]): [TVec2, TVec2][] {
	const result: [TVec2, TVec2][] = [];
	for (let i = 0; i < corners.length; i++) {
		const a = corners[i];
		const b = corners[(i + 1) % corners.length];
		if (a != null && b != null) result.push([a, b]);
	}
	return result;
}

function segmentsIntersect(a: TVec2, b: TVec2, c: TVec2, d: TVec2): boolean {
	const d1 = cross(c, d, a);
	const d2 = cross(c, d, b);
	const d3 = cross(a, b, c);
	const d4 = cross(a, b, d);
	return d1 * d2 < 0 && d3 * d4 < 0;
}

function cross(a: TVec2, b: TVec2, c: TVec2): number {
	return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function distance(a: TVec2, b: TVec2): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}
