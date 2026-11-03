import { createId, DEFAULT_MARBLE_RADIUS, type TEntity, type TPathNode, type TProject, type TVec2 } from '@/modules/project';
import {
	anchorHit,
	nextPieceName,
	freePose,
	getPieceDefinition,
	layoutAtMarble,
	layoutFree,
	layoutOf,
	resolvePieceParams,
	resolvePiecePath,
	soundsHit,
	transformShape,
	type TLayoutInput,
	type TPieceLayout,
	type TResolvedPiece
} from '@/modules/simulation';
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
	| { kind: 'linked'; laneId: string; hitId: string }
	| { kind: 'anchored'; laneId: string; hitId: string; time: number };

/** What a drop attaches the dragged element to */
export type TSnap =
	| { kind: 'link'; laneId: string; hitId: string; dot: TVec2; velocity: TVec2 | null }
	| { kind: 'anchor'; laneId: string; time: number; marble: TVec2 };

/** Seconds before the closest trajectory moment that an anchor is set, so the element appears ahead of the marble */
export const ANCHOR_LEAD = 0.12;

export function attachState(project: TProject, entity: TEntity): TAttachState {
	const link = entity.components.hitLink;
	if (link == null) return { kind: 'free' };
	if (soundsHit(entity.components.piece?.type ?? '', link)) return { kind: 'linked', laneId: link.laneId, hitId: link.hitId };
	const hitTime = project.music.lanes.find((lane) => lane.id === link.laneId)?.hits.find((hit) => hit.id === link.hitId)?.time ?? 0;
	return { kind: 'anchored', laneId: link.laneId, hitId: link.hitId, time: hitTime + (entity.components.piece?.params['entryDelay'] ?? 0) };
}

/** The free transform that reproduces where a piece is now: its transform, or the pose the run gave it */
export function piecePose(entity: TEntity, resolved: TResolvedPiece | undefined, marbleRadius = DEFAULT_MARBLE_RADIUS): TPose | null {
	const transform = entity.components.transform;
	if (entity.components.hitLink == null && transform != null) return { position: { ...transform.position }, angle: transform.angle };
	if (resolved == null || resolved.status === 'unreached') return null;
	return freePose(entity, resolved, marbleRadius);
}

/** A piece standing free at `pose` */
export function asFree(entity: TEntity, pose: TPose): TEntity {
	const { hitLink: _, ...components } = entity.components;
	const piece = components.piece;
	if (piece != null) {
		const params = { ...piece.params };
		delete params['entryDelay'];
		components.piece = { ...piece, params };
	}
	return { ...entity, components: { ...components, transform: { position: { ...pose.position }, angle: pose.angle } } };
}

/**
 * A platform linked to a hit so it sounds the note. It keeps its angle; where the dot falls along its
 * surface becomes the contact point, so the run places it touching the marble right there.
 */
export function asLinked(entity: TEntity, pose: TPose, laneId: string, hitId: string, dot: TVec2): TEntity {
	const { transform: _, ...components } = entity.components;
	const piece = components.piece ?? { type: 'platform', params: {} };
	const params = resolvePieceParams(piece.type, piece.params);
	const length = params['length'] ?? 0.06;
	const along = (dot.x - pose.position.x) * Math.cos(pose.angle) + (dot.y - pose.position.y) * Math.sin(pose.angle);
	const contactAt = layoutOf(piece.type) === 'box' ? Math.min(0.95, Math.max(0.05, 0.5 + along / length)) : 0.5;
	return {
		...entity,
		components: {
			...components,
			piece: { ...piece, params: { ...piece.params, entryDelay: 0 } },
			hitLink: { laneId, hitId, angle: pose.angle, contactAt, pinned: false }
		}
	};
}

/**
 * A piece anchored to `laneId`'s trajectory at `time`, where the marble is at `marble`. It keeps its pose
 * relative to the marble at that moment and plays no note. Returns null when the lane has no hit within
 * `ANCHOR_DELAY` of the moment (see `anchorHit`).
 */
export function asAnchored(project: TProject, entity: TEntity, pose: TPose, laneId: string, time: number, marble: TVec2): TEntity | null {
	const hits = project.music.lanes.find((lane) => lane.id === laneId)?.hits ?? [];
	const hit = anchorHit(hits, time);
	if (hit == null) return null;
	const { transform: _, ...components } = entity.components;
	const piece = components.piece ?? { type: 'platform', params: {} };
	return {
		...entity,
		components: {
			...components,
			piece: { ...piece, params: { ...piece.params, entryDelay: Math.round((time - hit.time) * 1e4) / 1e4 } },
			hitLink: {
				laneId,
				hitId: hit.id,
				angle: pose.angle,
				contactAt: entity.components.hitLink?.contactAt ?? 0.5,
				pinned: false,
				anchored: true,
				offset: { x: pose.position.x - marble.x, y: pose.position.y - marble.y }
			}
		}
	};
}

/** The entity a drop produces at `pose` for a snap, falling back to free when the anchor has no hit before it */
export function withSnap(project: TProject, entity: TEntity, pose: TPose, snap: TSnap | null): TEntity {
	if (snap?.kind === 'link') return asLinked(entity, pose, snap.laneId, snap.hitId, snap.dot);
	if (snap?.kind === 'anchor') return asAnchored(project, entity, pose, snap.laneId, snap.time, snap.marble) ?? asFree(entity, pose);
	return asFree(entity, pose);
}

/** True when a drop may link this piece to a hit dot: only music pieces sound notes */
export function canLink(entity: TEntity): boolean {
	return getPieceDefinition(entity.components.piece?.type ?? '')?.musical === true;
}

/** A new free piece with default parameters, numbered after the pieces of its type */
export function createFreePiece(type: string, pose: TPose, entities: TEntity[], path?: { points: TVec2[]; nodes?: TPathNode[] }): TEntity {
	const definition = getPieceDefinition(type);
	const params: Record<string, number> = {};
	for (const [name, spec] of Object.entries(definition?.params ?? {})) if (name !== 'entryDelay') params[name] = spec.default;
	return {
		id: createId('piece'),
		name: nextPieceName(type, entities),
		components: {
			piece: { type, params },
			transform: { position: { ...pose.position }, angle: pose.angle },
			...(path != null ? { path } : {})
		}
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
export function withPathType(entity: TEntity, type: TPathPieceType, entities: TEntity[]): TEntity {
	const piece = entity.components.piece;
	if (piece == null || piece.type === type || !isPathPieceType(piece.type)) return entity;
	const params: Record<string, number> = {};
	for (const [name, spec] of Object.entries(getPieceDefinition(type)?.params ?? {})) if (name !== 'entryDelay') params[name] = spec.default;
	const entryDelay = piece.params['entryDelay'];
	if (entryDelay != null) params['entryDelay'] = entryDelay;
	// A piece on its definition's default path keeps that shape, since the other type's default differs
	const path = entity.components.path ?? { points: resolvePiecePath(piece.type, undefined).map((point) => ({ ...point })) };
	const oldLabel = getPieceDefinition(piece.type)?.label ?? piece.type;
	const isDefaultName = entity.name == null || new RegExp(`^${oldLabel} \\d+$`).test(entity.name);
	const count = entities.filter((item) => item.id !== entity.id && item.components.piece?.type === type).length;
	const name = isDefaultName ? `${getPieceDefinition(type)?.label ?? type} ${count + 1}` : entity.name;
	return { ...entity, ...(name != null ? { name } : {}), components: { ...entity.components, piece: { type, params }, path } };
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
export function displayPiece(entity: TEntity, at: { pose: TPose } | { pose: TPose; dot: TVec2; velocity: TVec2 | null }, marbleRadius = DEFAULT_MARBLE_RADIUS): TResolvedPiece {
	const type = entity.components.piece?.type ?? 'platform';
	const params = resolvePieceParams(type, entity.components.piece?.params ?? {});
	const input: TLayoutInput = {
		type,
		params,
		path: resolvePiecePath(type, entity.components.path?.points),
		angle: at.pose.angle,
		contactAt: entity.components.hitLink?.contactAt ?? 0.5,
		marbleRadius
	};
	const layout: TPieceLayout = 'dot' in at ? layoutAtMarble(input, at.dot, at.velocity) : layoutFree(input, at.pose.position);
	return {
		entityId: entity.id,
		type,
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

/** Replaces one entity, or adds it when it is new */
export function withEntity(project: TProject, entity: TEntity): TProject {
	const exists = project.entities.some((item) => item.id === entity.id);
	return { ...project, entities: exists ? project.entities.map((item) => (item.id === entity.id ? entity : item)) : [...project.entities, entity] };
}
