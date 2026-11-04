import { Err, Ok, type TResult } from 'tuple-result';
import type { TEntity, TProject, TProjectCommand, TVec2 } from '@/modules/project';
import {
	finishOfLane,
	createLinkedPiece,
	defaultPlatformAngle,
	frameBand,
	getPieceDefinition,
	layoutOf,
	resolvePiecePath,
	type THitResult,
	type TSimulationResult
} from '@/modules/simulation';
import { parseHitKey } from '@/modules/studio/selection';
import type { StudioCx } from '@/modules/studio/StudioCx';

// The step loop builds a run one hit at a time: place a piece at a dot, rotate it, accept and move on.

/** Open hits of a lane that the marble reaches, in time order */
export function openHits(result: TSimulationResult, laneId?: string): THitResult[] {
	return result.hits
		.filter((hit) => hit.status === 'open' && hit.dot != null && (laneId == null || hit.laneId === laneId))
		.sort((a, b) => a.targetTime - b.targetTime);
}

/** The first open hit per lane, which the canvas emphasises as the next step */
export function nextOpenHitPerLane(result: TSimulationResult): Map<string, THitResult> {
	const next = new Map<string, THitResult>();
	for (const hit of openHits(result)) if (!next.has(hit.laneId)) next.set(hit.laneId, hit);
	return next;
}

export interface TLinkedPiece {
	entity: TEntity;
	laneId: string;
	hitId: string;
	angle: number;
	time: number;
}

/** Hit-linked pieces with their hit time, in time order */
export function linkedPieces(project: TProject, laneId?: string): TLinkedPiece[] {
	const times = new Map<string, number>();
	for (const lane of project.music.lanes) for (const hit of lane.hits) times.set(`${lane.id}/${hit.id}`, hit.time);
	const pieces: TLinkedPiece[] = [];
	for (const entity of project.entities) {
		const link = entity.components.hitLink;
		if (link == null || entity.components.piece == null || (laneId != null && link.laneId !== laneId)) continue;
		const time = times.get(`${link.laneId}/${link.hitId}`);
		if (time == null) continue;
		pieces.push({ entity, laneId: link.laneId, hitId: link.hitId, angle: link.angle, time });
	}
	return pieces.sort((a, b) => a.time - b.time);
}

/**
 * The open hit that Return, Repeat and Mirror act on: the focused dot, otherwise the next open dot after
 * the selected piece's hit, otherwise the first open dot of the first lane that has one.
 */
export function findStepTarget(project: TProject, result: TSimulationResult, selection: string[]): THitResult | null {
	const open = openHits(result);
	if (selection.length === 1) {
		const key = selection[0] ?? '';
		const hitKey = parseHitKey(key);
		if (hitKey != null) {
			const focused = open.find((hit) => hit.laneId === hitKey.laneId && hit.hitId === hitKey.hitId);
			if (focused != null) return focused;
			const time = result.hits.find((hit) => hit.laneId === hitKey.laneId && hit.hitId === hitKey.hitId)?.targetTime;
			// A Backing note belongs to no marble, so the next step is the first open dot of any marble
			if (time == null) return open[0] ?? null;
			return open.find((hit) => hit.laneId === hitKey.laneId && hit.targetTime > time) ?? null;
		}
		const piece = linkedPieces(project).find((item) => item.entity.id === key);
		if (piece != null) return open.find((hit) => hit.laneId === piece.laneId && hit.targetTime > piece.time) ?? null;
	}
	return open[0] ?? null;
}

/** The latest piece of the lane placed before `time`, which Repeat and Mirror copy */
export function previousPiece(project: TProject, laneId: string, time: number): TLinkedPiece | null {
	const before = linkedPieces(project, laneId).filter((piece) => piece.time < time);
	return before[before.length - 1] ?? null;
}

export type TStepMode = 'default' | 'repeat' | 'mirror';

/** Angle for a new piece at `hit`: the default lean, or the previous piece's angle repeated or mirrored */
export function stepAngle(project: TProject, hit: THitResult, mode: TStepMode): number {
	const previous = mode === 'default' ? null : previousPiece(project, hit.laneId, hit.targetTime);
	if (previous != null) return mode === 'mirror' ? -previous.angle : previous.angle;
	const dot = hit.dot ?? { x: 0, y: 0 };
	return defaultPlatformAngle(dot, hit.velocity, frameBand(project, hit.laneId).centerX);
}

/**
 * The piece a click or step puts at an open hit. Platforms and windmills take the step angle; rails and
 * tunnels start under the marble and run with its travel, turned back when that would leave the frame.
 */
export function pieceForHit(project: TProject, hit: THitResult, type: string, mode: TStepMode = 'default', id?: string): TEntity {
	const kind = layoutOf(type);
	if (kind === 'path' || kind === 'tube') {
		const entity = createLinkedPiece(type, hit.laneId, hit.hitId, 0, { entities: project.entities, id });
		return withRunDirection(project, entity, hit.dot, hit.velocity);
	}
	return createLinkedPiece(type, hit.laneId, hit.hitId, stepAngle(project, hit, mode), { entities: project.entities, id });
}

/**
 * A scenery piece (rail, tunnel, windmill) the marble meets at `time` on its way, linked to the lane's latest
 * hit before that time with an entry delay. It follows that hit's trajectory like any linked piece and never
 * sounds a hit.
 */
export function followerAt(
	project: TProject,
	laneId: string,
	type: string,
	time: number,
	position: TVec2,
	velocity: TVec2 | null
): TResult<TEntity, Error> {
	const lane = project.music.lanes.find((item) => item.id === laneId);
	const hit = [...(lane?.hits ?? [])].reverse().find((item) => item.time < time - 0.005);
	if (hit == null) return Err(new Error("A piece can follow this marble only after its first hit. Drop it lower on the marble's fall."));
	const delay = Math.round((time - hit.time) * 1000) / 1000;
	const maxDelay = getPieceDefinition(type)?.params['entryDelay']?.max ?? 2;
	if (delay > maxDelay) return Err(new Error(`This spot is ${delay.toFixed(1)} s after the last hit. Drop the piece within ${maxDelay} s of a hit.`));
	const entity = createLinkedPiece(type, laneId, hit.id, 0, { entities: project.entities });
	const piece = entity.components.piece;
	if (piece != null) piece.params = { ...piece.params, entryDelay: delay };
	const kind = layoutOf(type);
	if (kind === 'catcher') return Ok(asLaneFinish(project, entity, velocity));
	return Ok(kind === 'path' || kind === 'tube' ? withRunDirection(project, entity, position, velocity) : entity);
}

/**
 * A Finish for the marble of its anchor: its backstop on the side the marble moves toward, and the marble's own Finish
 * kept, moved to the new spot, since a marble has at most one
 */
export function asLaneFinish(project: TProject, entity: TEntity, velocity: TVec2 | null): TEntity {
	const laneId = entity.components.hitLink?.laneId;
	const existing = laneId != null ? finishOfLane(project, laneId) : undefined;
	const piece = entity.components.piece;
	const params: Record<string, number> = { ...(existing?.components.piece?.params ?? {}), ...piece?.params, mirror: (velocity?.x ?? 0) < 0 ? 1 : 0 };
	const style = existing?.components.piece?.params['style'];
	if (style != null) params['style'] = style;
	const link = entity.components.hitLink;
	const { transform: _, ...kept } = existing?.components ?? {};
	return {
		...entity,
		id: existing?.id ?? entity.id,
		...(existing?.name != null ? { name: existing.name } : {}),
		components: {
			...kept,
			...entity.components,
			piece: { type: piece?.type ?? 'finish', params },
			...(link != null ? { hitLink: { ...link, anchored: true } } : {})
		}
	};
}

/** Points the run of a new rail or tunnel along the horizontal travel, or back when it would leave the frame */
function withRunDirection(project: TProject, entity: TEntity, position: TVec2 | null, velocity: TVec2 | null): TEntity {
	const piece = entity.components.piece;
	if (piece == null) return entity;
	const points = resolvePiecePath(piece.type, undefined);
	const reach = Math.max(...points.map((point) => point.x));
	const band = frameBand(project);
	const x = position?.x ?? band.centerX;
	let direction = Math.abs(velocity?.x ?? 0) > 0.05 ? Math.sign(velocity?.x ?? 1) : x <= band.centerX ? 1 : -1;
	if (Math.abs(x + direction * reach - band.centerX) > band.halfWidth) direction = -direction;
	return {
		...entity,
		components: { ...entity.components, path: { points: points.map((point) => ({ x: point.x * direction, y: point.y })) } }
	};
}

/** Adds a piece made for an open hit, selects it, moves the playhead there and plays the note */
export function commitAtHit(cx: StudioCx, hit: THitResult, entity: TEntity): boolean {
	const project = cx.project;
	if (project == null || !cx.execute([{ type: 'upsertEntity', entity }])) return false;
	cx.$selection.set([entity.id]);
	if (!cx.$playing.get()) cx.$playhead.set(hit.targetTime);
	const pitch = project.music.lanes.find((lane) => lane.id === hit.laneId)?.hits.find((item) => item.id === hit.hitId)?.pitch;
	cx.audition(hit.laneId, pitch);
	return true;
}

/** Places a piece of `type` at an open hit, selects it, moves the playhead there and plays the note */
export function placeAtHit(cx: StudioCx, hit: THitResult, type: string, mode: TStepMode = 'default'): string | null {
	const project = cx.project;
	if (project == null || hit.dot == null) return null;
	const entity = pieceForHit(project, hit, type, mode);
	return commitAtHit(cx, hit, entity) ? entity.id : null;
}

// MARK: - Piece edits

/** Project with new angles for some pieces, for previews that should not enter history. Free pieces turn their transform. */
export function withPieceAngles(project: TProject, angles: Map<string, number>): TProject {
	return {
		...project,
		entities: project.entities.map((entity) => {
			const angle = angles.get(entity.id);
			const { hitLink: link, transform } = entity.components;
			if (angle == null) return entity;
			if (link != null) return { ...entity, components: { ...entity.components, hitLink: { ...link, angle } } };
			if (transform != null) return { ...entity, components: { ...entity.components, transform: { ...transform, angle } } };
			return entity;
		})
	};
}

export function pieceAngleCommands(project: TProject, angles: Map<string, number>): TProjectCommand[] {
	const commands: TProjectCommand[] = [];
	for (const entity of project.entities) {
		const angle = angles.get(entity.id);
		const { hitLink: link, transform } = entity.components;
		if (angle == null) continue;
		if (link != null && link.angle !== angle) {
			commands.push({ type: 'setComponent', entityId: entity.id, component: { name: 'hitLink', value: { ...link, angle } } });
		} else if (link == null && transform != null && transform.angle !== angle) {
			commands.push({ type: 'setComponent', entityId: entity.id, component: { name: 'transform', value: { ...transform, angle } } });
		}
	}
	return commands;
}

/** Surface angle of a piece as edited: its link's angle, or its free transform's */
export function pieceAngle(entity: TEntity): number | null {
	return entity.components.hitLink?.angle ?? entity.components.transform?.angle ?? null;
}

export function selectedPieceIds(project: TProject, selection: string[]): string[] {
	return selection.filter((id) => project.entities.some((entity) => entity.id === id && entity.components.piece != null));
}
