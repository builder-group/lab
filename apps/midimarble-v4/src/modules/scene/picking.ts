import type { TVec2 } from '@/modules/project';

// Pointer targets are picked in screen space, so hit areas keep a constant size at every zoom level.

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
	/** The piece's, or the marble's for `release` */
	id: string;
	position: TVec2;
	radius: number;
	/** Node of a drawn rail, for node and handle kinds */
	index?: number;
}

export interface TScreenDot {
	marbleId: string;
	hitId: string;
	position: TVec2;
	/** Set for a placed hit's dot, how close a click has to be; an open dot takes `DOT_PICK_RADIUS` and wins over pieces */
	radius?: number;
}

export interface TScreenPiece {
	pieceId: string;
	/** Outline corners in order */
	corners: TVec2[];
	/** What picks instead of the outline, for a piece that is mostly air */
	lines?: TVec2[][] | undefined;
	/** Selected: under the pointer it wins over what lies on top of it */
	isSelected?: boolean;
}

/** A marble trajectory in screen space with the time of each point */
export interface TScreenTrack {
	marbleId: string;
	points: TVec2[];
	times: number[];
}

export type TPick =
	| { kind: 'release'; marbleId: string }
	| { kind: 'rotate' | 'pathEnd' | 'pathBend'; pieceId: string }
	| { kind: 'node' | 'nodeIn' | 'nodeOut'; pieceId: string; index: number }
	| { kind: 'dot'; marbleId: string; hitId: string }
	| { kind: 'ghost' }
	| { kind: 'piece'; pieceId: string }
	| { kind: 'track'; marbleId: string; time: number; position: TVec2 };

export const DOT_PICK_RADIUS = 10;
// A placed hit's dot is small: its visible radius and 2 px, and then only when it is nearer than the platform
export const PLACED_DOT_PICK_RADIUS = 6;
// Thin bars far away are still easy to click within this distance of their outline
const PIECE_PICK_SLOP = 4;
const HANDLE_PICK_SLOP = 4;

export function pick(point: TVec2, scene: TPickScene): TPick | null {
	for (let i = scene.handles.length - 1; i >= 0; i--) {
		const handle = scene.handles[i];
		if (handle != null && distance(point, handle.position) <= handle.radius + HANDLE_PICK_SLOP) {
			if (handle.kind === 'node' || handle.kind === 'nodeIn' || handle.kind === 'nodeOut') {
				return { kind: handle.kind, pieceId: handle.id, index: handle.index ?? 0 };
			}
			if (handle.kind === 'release') return { kind: 'release', marbleId: handle.id };
			return { kind: handle.kind, pieceId: handle.id };
		}
	}

	// Open dots win over pieces. A placed dot sits against its platform, so it only wins when the pointer is nearer to
	// it than to any piece: at low zoom the bar stays easy to grab, and a tie goes to the bar.
	const nearestWithin = (dots: TScreenDot[], radius: number): { dot: TScreenDot; distance: number } | null => {
		let nearest: { dot: TScreenDot; distance: number } | null = null;
		for (const dot of dots) {
			const dotDistance = distance(point, dot.position);
			if (dotDistance <= radius && (nearest == null || dotDistance <= nearest.distance)) nearest = { dot, distance: dotDistance };
		}
		return nearest;
	};
	const open = nearestWithin(scene.dots.filter((dot) => dot.radius == null), DOT_PICK_RADIUS);
	if (open != null) return { kind: 'dot', marbleId: open.dot.marbleId, hitId: open.dot.hitId };

	let piecePick: { pieceId: string; distance: number } | null = null;
	for (let i = scene.pieces.length - 1; i >= 0; i--) {
		const piece = scene.pieces[i];
		if (piece == null) continue;
		const pieceDistance = distanceToPiece(point, piece);
		if (pieceDistance > PIECE_PICK_SLOP) continue;
		if (piece.isSelected === true) {
			piecePick = { pieceId: piece.pieceId, distance: pieceDistance };
			break;
		}
		if (piecePick == null || pieceDistance < piecePick.distance) piecePick = { pieceId: piece.pieceId, distance: pieceDistance };
	}
	const placed = nearestWithin(scene.dots.filter((dot) => dot.radius != null), PLACED_DOT_PICK_RADIUS);
	if (placed != null && (piecePick == null || placed.distance < piecePick.distance)) return { kind: 'dot', marbleId: placed.dot.marbleId, hitId: placed.dot.hitId };
	return piecePick == null ? null : { kind: 'piece', pieceId: piecePick.pieceId };
}

/** Whether a point is on a suggested piece's outline */
export function isOnGhost(point: TVec2, corners: TVec2[]): boolean {
	return corners.length > 0 && (isPointInPolygon(point, corners) || distanceToPolygon(point, corners) <= PIECE_PICK_SLOP);
}

// About a fingertip on a trackpad: a click this close to a trajectory still lands on it
export const TRACK_PICK_RADIUS = 12;

/** The trajectory point nearest to `point` within a few pixels, with its time interpolated along the segment */
export function pickTrack(point: TVec2, tracks: TScreenTrack[], radius = TRACK_PICK_RADIUS): TPick | null {
	let best: { marbleId: string; time: number; position: TVec2; distance: number } | null = null;
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
				best = { marbleId: track.marbleId, time, position, distance: d };
			}
		}
	}
	return best == null ? null : { kind: 'track', marbleId: best.marbleId, time: best.time, position: best.position };
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
		if (piece.corners.some((corner) => isPointInRect(corner, rect))) ids.push(piece.pieceId);
		else {
			const rectCorners = [
				{ x: rect.x, y: rect.y },
				{ x: rect.x + rect.width, y: rect.y },
				{ x: rect.x + rect.width, y: rect.y + rect.height },
				{ x: rect.x, y: rect.y + rect.height }
			];
			const isCovered = rectCorners.some((corner) => isPointInPolygon(corner, piece.corners));
			const isCrossing = edges(piece.corners).some(([a, b]) => edges(rectCorners).some(([c, d]) => segmentsIntersect(a, b, c, d)));
			if (isCovered || isCrossing) ids.push(piece.pieceId);
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

function distanceToPiece(point: TVec2, piece: TScreenPiece): number {
	if (piece.lines != null) return Math.min(...piece.lines.flatMap((line) => line.slice(1).map((end, index) => distanceToSegment(point, line[index] as TVec2, end))), Number.POSITIVE_INFINITY);
	return isPointInPolygon(point, piece.corners) ? 0 : distanceToPolygon(point, piece.corners);
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
