import { createId, DEFAULT_MARBLE_RADIUS, freePosition, type TPiece, type TPathNode, type TProject, type TVec2, tieOf } from '@/modules/project';
import { anchorHit, frameBand, nextPieceName, freePose, getPieceDefinition, hitPlace, layoutAtMarble, layoutFree, layoutOf, railLayoutInfo, resolvePieceParams, resolvePiecePath, shapeDistance, soundsHit, transformShape, type TLayoutInput, type TPieceLayout, type TPieceShape, type TRailLayout, type TResolvedPiece, type TSimulationResult } from '@/modules/simulation';
import { sampleNodes } from './bezier';

// Pure edits behind the open canvas: an element is free, anchored to a moment on a marble's trajectory or,
// for platforms, linked to a hit dot. Every conversion keeps the world pose, so a drag decides only how the
// element is attached, never where it jumps.

/** World pose of a piece as its free transform would hold it */
export interface TPose {
	position: TVec2;
	angle: number;
}

export type TAttachState =
	| { kind: 'free' }
	| { kind: 'linked'; marbleId: string; hitId: string }
	| { kind: 'anchored'; marbleId: string; hitId: string; time: number };

/** What a drop attaches the dragged element to */
export type TSnap =
	| { kind: 'link'; marbleId: string; hitId: string; dot: TVec2; velocity: TVec2 | null }
	| { kind: 'anchor'; marbleId: string; time: number; marble: TVec2 };

/** Seconds before the closest trajectory moment that an anchor is set, so the element appears ahead of the marble */
export const ANCHOR_LEAD = 0.12;

export function attachState(project: TProject, piece: TPiece): TAttachState {
	const link = tieOf(piece);
	if (link == null) return { kind: 'free' };
	if (soundsHit(piece.type ?? '', link)) return { kind: 'linked', marbleId: link.marbleId, hitId: link.hitId };
	const hitTime = project.marbles.find((marble) => marble.id === link.marbleId)?.hits.find((hit) => hit.id === link.hitId)?.time ?? 0;
	return { kind: 'anchored', marbleId: link.marbleId, hitId: link.hitId, time: hitTime + (piece.params['entryDelay'] ?? 0) };
}

/** The free transform that reproduces where a piece is now: its transform, or the pose the run gave it */
export function piecePose(piece: TPiece, resolved: TResolvedPiece | undefined, marbleRadius = DEFAULT_MARBLE_RADIUS): TPose | null {
	const position = freePosition(piece);
	if (position != null) return { position: { ...position }, angle: piece.angle };
	if (resolved == null || resolved.status === 'unreached') return null;
	return freePose(piece, resolved, marbleRadius);
}

/** A piece standing free at `pose` */
export function asFree(piece: TPiece, pose: TPose): TPiece {
	const params = { ...piece.params };
	delete params['entryDelay'];
	return { ...piece, params, angle: pose.angle, place: { kind: 'free', position: { ...pose.position } } };
}

/**
 * A platform linked to a hit so it sounds the note. It keeps its angle; where the dot falls along its
 * surface becomes the contact point, so the run places it touching the marble right there.
 */
export function asLinked(piece: TPiece, pose: TPose, marbleId: string, hitId: string, dot: TVec2): TPiece {
	const params = resolvePieceParams(piece.type, piece.params);
	const length = params['length'] ?? 0.06;
	const along = (dot.x - pose.position.x) * Math.cos(pose.angle) + (dot.y - pose.position.y) * Math.sin(pose.angle);
	const contactAt = layoutOf(piece.type) === 'box' ? Math.min(0.95, Math.max(0.05, 0.5 + along / length)) : 0.5;
	return { ...piece, params: { ...piece.params, entryDelay: 0 }, angle: pose.angle, place: hitPlace(piece.type, marbleId, hitId, contactAt) };
}

/**
 * A piece anchored to `marbleId`'s trajectory at `time`, where the marble is at `marble`. It keeps its pose
 * relative to the marble at that moment and plays no note. Returns null when the marble has no hit within
 * `ANCHOR_DELAY` of the moment (see `anchorHit`).
 */
export function asAnchored(project: TProject, piece: TPiece, pose: TPose, marbleId: string, time: number, marble: TVec2): TPiece | null {
	const hits = project.marbles.find((marble) => marble.id === marbleId)?.hits ?? [];
	const hit = anchorHit(hits, time);
	if (hit == null) return null;
	const contactAt = tieOf(piece)?.contactAt ?? 0.5;
	return {
		...piece,
		params: { ...piece.params, entryDelay: Math.round((time - hit.time) * 1e4) / 1e4 },
		angle: pose.angle,
		place: {
			kind: 'follows',
			marbleId,
			hitId: hit.id,
			...(contactAt !== 0.5 ? { contactAt } : {}),
			offset: { x: pose.position.x - marble.x, y: pose.position.y - marble.y }
		}
	};
}

/** How far from its note, in meters, a dragged platform still plays it; a drop further away frees it */
export const KEEP_PLAYS_REACH = 0.25;

/**
 * What dropping a platform that plays a note does: back on its dot it follows its note again, on another open dot it
 * plays that note, near its note the marble is sent to where it lies, and with ⌥ or far away it is free.
 */
export type TPlaysDrop = 'onNote' | 'otherNote' | 'keeps' | 'frees';

export function playsDrop(note: { marbleId: string; hitId: string; dot: TVec2 | null }, startPosition: TVec2, position: TVec2, snap: TSnap | null, options: { isFree: boolean; reach: number }): TPlaysDrop {
	if (snap?.kind === 'link') return snap.marbleId === note.marbleId && snap.hitId === note.hitId ? 'onNote' : 'otherNote';
	if (options.isFree) return 'frees';
	const from = note.dot ?? startPosition;
	return Math.hypot(position.x - from.x, position.y - from.y) <= options.reach ? 'keeps' : 'frees';
}

/** The piece a drop produces at `pose` for a snap, falling back to free when the anchor has no hit before it */
export function withSnap(project: TProject, piece: TPiece, pose: TPose, snap: TSnap | null): TPiece {
	if (snap?.kind === 'link') return asLinked(piece, pose, snap.marbleId, snap.hitId, snap.dot);
	if (snap?.kind === 'anchor') return asAnchored(project, piece, pose, snap.marbleId, snap.time, snap.marble) ?? asFree(piece, pose);
	return asFree(piece, pose);
}

/** True when a drop may link this piece to a hit dot: only music pieces sound notes */
export function canLink(piece: TPiece): boolean {
	return getPieceDefinition(piece.type ?? '')?.musical === true;
}

/** A new free piece with default parameters, numbered after the pieces of its type */
export function createFreePiece(type: string, pose: TPose, pieces: TPiece[], path?: { points: TVec2[]; nodes?: TPathNode[] }): TPiece {
	const definition = getPieceDefinition(type);
	const params: Record<string, number> = {};
	for (const [name, spec] of Object.entries(definition?.params ?? {})) if (name !== 'entryDelay') params[name] = spec.default;
	return {
		id: createId('piece'),
		name: nextPieceName(type, pieces),
		type,
		params,
		angle: pose.angle,
		place: { kind: 'free', position: { ...pose.position } },
		...(path != null ? { path } : {})
	};
}

/** Piece types a drawn path can be: the path tool draws a rail and the inspector switches it to a tunnel */
export const pathPieceTypes = ['rail', 'tunnel'] as const;

export type TPathPieceType = (typeof pathPieceTypes)[number];

export function isPathPieceType(type: string | undefined): type is TPathPieceType {
	return type === 'rail' || type === 'tunnel';
}

/**
 * The path piece as `type`, keeping its path, transform or anchor and its anchor moment. The other type's
 * parameters take their defaults, and a default name such as `Rail 2` is renumbered after the new type.
 */
export function withPathType(piece: TPiece, type: TPathPieceType, pieces: TPiece[]): TPiece {
	if (piece.type === type || !isPathPieceType(piece.type)) return piece;
	const params: Record<string, number> = {};
	for (const [name, spec] of Object.entries(getPieceDefinition(type)?.params ?? {})) if (name !== 'entryDelay') params[name] = spec.default;
	const entryDelay = piece.params['entryDelay'];
	if (entryDelay != null) params['entryDelay'] = entryDelay;
	// A piece on its definition's default path keeps that shape, since the other type's default differs
	const path = piece.path ?? { points: resolvePiecePath(piece.type, undefined).map((point) => ({ ...point })) };
	const oldLabel = getPieceDefinition(piece.type)?.label ?? piece.type;
	const isDefaultName = piece.name == null || new RegExp(`^${oldLabel} \\d+$`).test(piece.name);
	const count = pieces.filter((item) => item.id !== piece.id && item.type === type).length;
	const name = isDefaultName ? `${getPieceDefinition(type)?.label ?? type} ${count + 1}` : piece.name;
	const { layout: _layout, ...rest } = piece;
	return { ...rest, ...(name != null ? { name } : {}), type, params, path };
}

/**
 * The Rail with another layout: the parameters that layout starts from, keeping those it shares such as thickness and
 * when it starts. Drawn takes away the layout and uses the path the Rail holds.
 */
export function withRailLayout(piece: TPiece, layout: TRailLayout): TPiece {
	if (piece.type !== 'rail' || (piece.layout ?? 'path') === layout) return piece;
	const { layout: _layout, ...rest } = piece;
	const params = { ...piece.params, ...railLayoutInfo[layout].defaults };
	return layout === 'path' ? { ...rest, params } : { ...rest, layout, params };
}

/** Rail drawn with the path tool: the first node is the local origin, so the transform sits on it */
export function railPath(nodes: TPathNode[]): { points: TVec2[]; nodes: TPathNode[] } {
	const points = sampleNodes(nodes);
	// A rail needs two points even when the nodes coincide
	if (points.length < 2) points.push({ x: (points[0]?.x ?? 0) + 0.01, y: points[0]?.y ?? 0 });
	return { points, nodes };
}

// MARK: - Display

/**
 * How a piece looks at a pose before the run has simulated it, for the dragged piece. Free poses use the
 * free layout; a snapped link places it on the dot the way the run will.
 */
export function displayPiece(piece: TPiece, at: { pose: TPose } | { pose: TPose; dot: TVec2; velocity: TVec2 | null }, marbleRadius = DEFAULT_MARBLE_RADIUS): TResolvedPiece {
	const type = piece.type ?? 'platform';
	const params = resolvePieceParams(type, piece.params ?? {});
	const input: TLayoutInput = {
		type,
		params,
		path: resolvePiecePath(type, piece.path?.points),
		extraPaths: piece.path?.paths,
		layout: piece.layout,
		angle: at.pose.angle,
		contactAt: tieOf(piece)?.contactAt ?? 0.5,
		marbleRadius
	};
	const layout: TPieceLayout = 'dot' in at ? layoutAtMarble(input, at.dot, at.velocity) : layoutFree(input, at.pose.position);
	const railLayout = piece.layout;
	return {
		entityId: piece.id,
		type,
		...(railLayout != null ? { layout: railLayout } : {}),
		position: layout.position,
		angle: layout.angle,
		params,
		contactPoint: layout.contactPoint,
		contactNormal: layout.contactNormal,
		hitTime: null,
		status: 'free',
		shapes: layout.shapes,
		...(layout.path != null ? { path: layout.path } : {}),
		...(layout.paths != null ? { paths: layout.paths } : {})
	};
}

/** A resolved piece turned by `angle` around `pivot`, for a rotation that the run has not caught up with */
export function rotateResolved(piece: TResolvedPiece, pivot: TVec2, angle: number): TResolvedPiece {
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	const turn = (point: TVec2): TVec2 => ({
		x: pivot.x + (point.x - pivot.x) * cos - (point.y - pivot.y) * sin,
		y: pivot.y + (point.x - pivot.x) * sin + (point.y - pivot.y) * cos
	});
	// `transformShape` turns around the origin, so shift the pivot there and back
	const offset = { x: pivot.x - (pivot.x * cos - pivot.y * sin), y: pivot.y - (pivot.x * sin + pivot.y * cos) };
	return {
		...piece,
		position: turn(piece.position),
		angle: piece.angle + angle,
		contactPoint: piece.contactPoint != null ? turn(piece.contactPoint) : null,
		motion: undefined,
		...(piece.shapes != null ? { shapes: piece.shapes.map((shape) => transformShape(shape, offset, angle)) } : {}),
		...(piece.path != null ? { path: piece.path.map(turn) } : {}),
		...(piece.paths != null ? { paths: piece.paths.map((wire) => wire.map(turn)) } : {})
	};
}

/** Replaces one piece, or adds it when it is new */
export function withPiece(project: TProject, piece: TPiece): TProject {
	const exists = project.track.pieces.some((item) => item.id === piece.id);
	return { ...project, track: { ...project.track, pieces: exists ? project.track.pieces.map((item) => (item.id === piece.id ? piece : item)) : [...project.track.pieces, piece] } };
}

/** Gap a windmill added beside a fall keeps between its arm circle and every marble path and piece */
export const ROTOR_CLEARANCE = 0.004;

/**
 * Hub position for a windmill that follows the marble at `at`: beside the fall, perpendicular to it, so its arm
 * circle of radius `reach` clears every marble's path and every piece by `ROTOR_CLEARANCE` and the run stays as
 * it was. The side toward the frame center is tried first, then further out. Without a clear spot, the roomiest
 * one tried.
 */
export function clearRotorPosition(project: TProject, result: TSimulationResult, at: { position: TVec2; velocity: TVec2 }, reach: number, marbleId: string): TVec2 {
	const speed = Math.hypot(at.velocity.x, at.velocity.y);
	const across = speed > 1e-6 ? { x: -at.velocity.y / speed, y: at.velocity.x / speed } : { x: 1, y: 0 };
	const marbleRadius = result.marbles.find((track) => track.marbleId === marbleId)?.radius ?? DEFAULT_MARBLE_RADIUS;
	const centerX = frameBand(project, marbleId).centerX;
	const inward = Math.sign((centerX - at.position.x) * across.x) || 1;
	const shapes = result.pieces.flatMap(pieceShapes);
	const base = reach + marbleRadius + ROTOR_CLEARANCE;
	let best: { position: TVec2; gap: number } | null = null;
	for (const stretch of [1, 1.3, 1.7, 2.2]) {
		for (const side of [inward, -inward]) {
			const position = { x: at.position.x + across.x * side * base * stretch, y: at.position.y + across.y * side * base * stretch };
			const gap = rotorGap(position, reach, result, shapes);
			if (gap >= ROTOR_CLEARANCE) return position;
			if (best == null || gap > best.gap) best = { position, gap };
		}
	}
	return best?.position ?? at.position;
}

/** Smallest distance from a windmill's arm circle to any marble surface along the run or any piece */
function rotorGap(center: TVec2, reach: number, result: TSimulationResult, shapes: TPieceShape[]): number {
	let gap = Infinity;
	for (const track of result.marbles) {
		for (let i = 0; i < track.samples.length; i += 2) {
			const sample = track.samples[i];
			if (sample == null) continue;
			gap = Math.min(gap, Math.hypot(sample.position.x - center.x, sample.position.y - center.y) - track.radius - reach);
		}
	}
	for (const shape of shapes) gap = Math.min(gap, shapeDistance(shape, center.x, center.y) - reach);
	return gap;
}

/** Collider shapes of a resolved piece; a platform carries only its pose and size */
function pieceShapes(piece: TResolvedPiece): TPieceShape[] {
	if (piece.shapes != null) return piece.shapes;
	const box = { cx: piece.position.x, cy: piece.position.y, angle: piece.angle, halfLength: (piece.params['length'] ?? 0) / 2, halfThickness: (piece.params['thickness'] ?? 0) / 2 };
	return [{ kind: 'box', box }];
}
