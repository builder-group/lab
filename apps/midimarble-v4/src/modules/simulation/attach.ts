import { Err, Ok, type TResult } from 'tuple-result';
import {
	DEFAULT_MARBLE_RADIUS,
	type TEntity,
	type TProject,
	type TProjectCommand,
	type TVec2
} from '@/modules/project';
import { gravityOf } from './geometry';
import { layoutFree, layoutOf, type TLayoutInput } from './piece-layout';
import {
	ANCHOR_DELAY,
	isMusicalPiece,
	resolvePieceParams,
	resolvePiecePath,
	soundsHit
} from './pieces';
import { trajectoryAt } from './simulate';
import type { TResolvedPiece, TSimulationResult } from './types';

// Converting a piece between its three states keeps its world pose where possible:
// - free: a transform in the world, environment the marbles may strike
// - anchored: follows a marble's trajectory at a moment in time and plays no note
// - linked: a musical platform on a hit dot that sounds that hit

export interface TAttachResult {
	/** The entity after the change */
	entity: TEntity;
	/** One edit that applies the change */
	commands: TProjectCommand[];
}

/**
 * The hit an anchor at `time` is stored against: the last hit at or before it, or the first hit when the
 * moment comes before it, so the delay is negative. Null when the moment is more than `ANCHOR_DELAY` away.
 */
export function anchorHit<T extends { time: number }>(hits: T[], time: number): T | null {
	const before = hits.filter((item) => item.time <= time + 1e-9).at(-1);
	if (before != null) return time - before.time <= ANCHOR_DELAY ? before : null;
	const first = hits[0];
	return first != null && first.time - time <= ANCHOR_DELAY ? first : null;
}

/**
 * Anchors a piece to the trajectory of `laneId`'s marble at `time`. The piece keeps its pose relative to the
 * marble at that moment, so it follows upstream edits, and it never sounds a hit. Any piece type can be
 * anchored; the moment must lie within `ANCHOR_DELAY` seconds after one of the lane's hits, or before its
 * first hit.
 */
export function anchorPiece(
	project: TProject,
	result: TSimulationResult,
	entityId: string,
	laneId: string,
	time: number
): TResult<TAttachResult, Error> {
	const [isFound, findErr, found] = findPiece(project, result, entityId);
	if (!isFound) return Err(findErr);
	const { entity, resolved } = found;
	const lane = project.music.lanes.find((item) => item.id === laneId);
	if (lane == null) return Err(new Error(`Lane ${laneId} not found`));
	const hit = anchorHit(lane.hits, time);
	if (hit == null)
		return Err(new Error(`No hit of ${lane.name} within ${ANCHOR_DELAY} s of that moment`));
	const track = result.marbles.find((marble) => marble.laneId === laneId);
	const sample = track != null ? trajectoryAt(track.samples, time, gravityOf(project)) : null;
	if (track == null || sample == null)
		return Err(new Error(`The marble of ${lane.name} does not reach that moment`));

	const pose = freePose(entity, resolved, track.radius);
	const params = { ...entity.components.piece?.params, entryDelay: time - hit.time };
	const next = withPiece(entity, {
		params,
		hitLink: {
			laneId,
			hitId: hit.id,
			angle: pose.angle,
			contactAt: entity.components.hitLink?.contactAt ?? 0.5,
			anchored: true,
			offset: { x: pose.position.x - sample.position.x, y: pose.position.y - sample.position.y }
		}
	});
	return Ok({ entity: next, commands: [{ type: 'upsertEntity', entity: next }] });
}

/** Turns an anchored piece back into a free piece at its current pose */
export function unanchorPiece(
	project: TProject,
	result: TSimulationResult,
	entityId: string
): TResult<TAttachResult, Error> {
	return detach(project, result, entityId, 'anchored');
}

/**
 * Links a musical piece to a hit dot so it sounds that hit. The piece keeps its angle, and where the dot
 * falls along its surface becomes the contact point, so the bar moves only as far as it must to touch
 * the marble.
 */
export function linkPieceToHit(
	project: TProject,
	result: TSimulationResult,
	entityId: string,
	laneId: string,
	hitId: string
): TResult<TAttachResult, Error> {
	const [isFound, findErr, found] = findPiece(project, result, entityId);
	if (!isFound) return Err(findErr);
	const { entity, resolved } = found;
	const type = entity.components.piece?.type ?? '';
	if (!isMusicalPiece(type)) return Err(new Error(`A ${type} is scenery; anchor it instead`));
	const lane = project.music.lanes.find((item) => item.id === laneId);
	const hit = lane?.hits.find((item) => item.id === hitId);
	if (lane == null || hit == null) return Err(new Error(`Hit ${hitId} not found`));
	const owner = project.entities.find(
		(item) =>
			item.id !== entityId &&
			item.components.hitLink?.laneId === laneId &&
			item.components.hitLink.hitId === hitId &&
			soundsHit(item.components.piece?.type ?? '', item.components.hitLink)
	);
	if (owner != null) return Err(new Error(`The hit already has ${owner.name ?? 'a piece'}`));
	const track = result.marbles.find((marble) => marble.laneId === laneId);
	const dot =
		result.hits.find((item) => item.laneId === laneId && item.hitId === hitId)?.dot ??
		(track != null ? trajectoryAt(track.samples, hit.time, gravityOf(project))?.position : null);
	if (dot == null) return Err(new Error(`The marble of ${lane.name} does not reach that hit`));

	const pose = freePose(entity, resolved, track?.radius);
	const params = resolvePieceParams(type, entity.components.piece?.params ?? {});
	const length = params['length'] ?? 0.06;
	const along =
		(dot.x - pose.position.x) * Math.cos(pose.angle) + (dot.y - pose.position.y) * Math.sin(pose.angle);
	const contactAt = Math.min(1, Math.max(0, 0.5 + along / length));
	const next = withPiece(entity, {
		params: { ...entity.components.piece?.params, entryDelay: 0 },
		hitLink: { laneId, hitId, angle: pose.angle, contactAt }
	});
	return Ok({ entity: next, commands: [{ type: 'upsertEntity', entity: next }] });
}

/** Turns a linked piece back into a free piece at its current pose; its hit opens again */
export function unlinkPiece(
	project: TProject,
	result: TSimulationResult,
	entityId: string
): TResult<TAttachResult, Error> {
	return detach(project, result, entityId, 'linked');
}

/**
 * The free transform that reproduces a resolved pose. Free layouts place rails and tunnels by their
 * local origin and switchbacks by their entry point, so the shift between the pose origin and the
 * transform is taken from a layout at the world origin.
 */
export function freePose(
	entity: TEntity,
	resolved: TResolvedPiece,
	marbleRadius = DEFAULT_MARBLE_RADIUS
): { position: TVec2; angle: number } {
	if (resolved.status === 'free') return { position: { ...resolved.position }, angle: resolved.angle };
	const type = entity.components.piece?.type ?? resolved.type;
	if (layoutOf(type) === 'box' || layoutOf(type) === 'rotor')
		return { position: { ...resolved.position }, angle: resolved.angle };
	const input: TLayoutInput = {
		type,
		params: resolved.params,
		path: resolvePiecePath(type, entity.components.path?.points),
		angle: resolved.angle,
		contactAt: entity.components.hitLink?.contactAt ?? 0.5,
		marbleRadius
	};
	const shift = layoutFree(input, { x: 0, y: 0 }).position;
	return {
		position: { x: resolved.position.x - shift.x, y: resolved.position.y - shift.y },
		angle: resolved.angle
	};
}

function detach(
	project: TProject,
	result: TSimulationResult,
	entityId: string,
	from: 'anchored' | 'linked'
): TResult<TAttachResult, Error> {
	const [isFound, findErr, found] = findPiece(project, result, entityId);
	if (!isFound) return Err(findErr);
	const { entity, resolved } = found;
	const { hitLink, piece } = entity.components;
	if (hitLink == null) return Err(new Error(`${entity.name ?? entityId} plays no note and follows no marble`));
	const isLinked = soundsHit(piece?.type ?? '', hitLink);
	if (from === 'linked' && !isLinked) return Err(new Error(`${entity.name ?? entityId} is anchored, not linked`));
	if (from === 'anchored' && isLinked) return Err(new Error(`${entity.name ?? entityId} is linked, not anchored`));
	if (resolved.status === 'unreached')
		return Err(new Error(`${entity.name ?? entityId} has no pose in this run`));
	const radius = result.marbles.find((marble) => marble.laneId === hitLink.laneId)?.radius;
	const pose = freePose(entity, resolved, radius);
	const { hitLink: _, ...components } = entity.components;
	const params = { ...piece?.params };
	delete params['entryDelay'];
	const next: TEntity = {
		...entity,
		components: {
			...components,
			...(piece != null ? { piece: { ...piece, params } } : {}),
			transform: pose
		}
	};
	return Ok({ entity: next, commands: [{ type: 'upsertEntity', entity: next }] });
}

function findPiece(
	project: TProject,
	result: TSimulationResult,
	entityId: string
): TResult<{ entity: TEntity; resolved: TResolvedPiece }, Error> {
	const entity = project.entities.find((item) => item.id === entityId);
	if (entity?.components.piece == null) return Err(new Error(`Piece ${entityId} not found`));
	if (result.revision !== project.revision)
		return Err(new Error('The run is out of date; wait for the simulation to catch up'));
	const resolved = result.pieces.find((item) => item.entityId === entityId);
	if (resolved == null) return Err(new Error(`${entity.name ?? entityId} has no pose in this run`));
	return Ok({ entity, resolved });
}

function withPiece(
	entity: TEntity,
	patch: { params: Record<string, number>; hitLink: NonNullable<TEntity['components']['hitLink']> }
): TEntity {
	const { transform: _, ...components } = entity.components;
	const piece = entity.components.piece ?? { type: 'platform', params: {} };
	return {
		...entity,
		components: { ...components, piece: { ...piece, params: patch.params }, hitLink: patch.hitLink }
	};
}
