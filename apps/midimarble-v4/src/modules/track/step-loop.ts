import { Err, Ok, type TResult } from 'tuple-result';
import type { TPiece, TProject, TProjectCommand, TVec2 } from '@/modules/project';
import { bowlOfMarble, createLinkedPiece, defaultPlatformAngle, frameBand, getPieceDefinition, layoutOf, resolvePiecePath, type THitResult, type TSimulationResult } from '@/modules/simulation';
import { parseHitKey, tieOf } from '@/modules/project';
import type { StudioCx } from '@/modules/studio';
import { openHits } from '@/modules/building';

// The step loop builds a run one hit at a time: place a piece at a dot, rotate it, accept and move on.

/** The first open hit per marble, which the canvas emphasizes as the next step */
export function nextOpenHitPerMarble(result: TSimulationResult): Map<string, THitResult> {
	const next = new Map<string, THitResult>();
	for (const hit of openHits(result)) if (!next.has(hit.marbleId)) next.set(hit.marbleId, hit);
	return next;
}

export interface TLinkedPiece {
	entity: TPiece;
	marbleId: string;
	hitId: string;
	angle: number;
	time: number;
}

/** Hit-linked pieces with their hit time, in time order */
export function linkedPieces(project: TProject, marbleId?: string): TLinkedPiece[] {
	const times = new Map<string, number>();
	for (const marble of project.marbles) for (const hit of marble.hits) times.set(`${marble.id}/${hit.id}`, hit.time);
	const pieces: TLinkedPiece[] = [];
	for (const entity of project.track.pieces) {
		const link = tieOf(entity);
		if (link == null || (marbleId != null && link.marbleId !== marbleId)) continue;
		const time = times.get(`${link.marbleId}/${link.hitId}`);
		if (time == null) continue;
		pieces.push({ entity, marbleId: link.marbleId, hitId: link.hitId, angle: entity.angle, time });
	}
	return pieces.sort((a, b) => a.time - b.time);
}

/**
 * The open hit that Return, Repeat and Mirror act on: the focused dot, otherwise the next open dot after
 * the selected piece's hit, otherwise the first open dot of the first marble that has one.
 */
export function findStepTarget(project: TProject, result: TSimulationResult, selection: string[]): THitResult | null {
	const open = openHits(result);
	if (selection.length === 1) {
		const key = selection[0] ?? '';
		const hitKey = parseHitKey(key);
		if (hitKey != null) {
			const focused = open.find((hit) => hit.marbleId === hitKey.marbleId && hit.hitId === hitKey.hitId);
			if (focused != null) return focused;
			const time = result.hits.find((hit) => hit.marbleId === hitKey.marbleId && hit.hitId === hitKey.hitId)?.targetTime;
			// A Backing note belongs to no marble, so the next step is the first open dot of any marble
			if (time == null) return open[0] ?? null;
			// Past the last open note the next step is still that marble's earliest open note
			return open.find((hit) => hit.marbleId === hitKey.marbleId && hit.targetTime > time) ?? open.find((hit) => hit.marbleId === hitKey.marbleId) ?? null;
		}
		const piece = linkedPieces(project).find((item) => item.entity.id === key);
		if (piece != null) return open.find((hit) => hit.marbleId === piece.marbleId && hit.targetTime > piece.time) ?? open.find((hit) => hit.marbleId === piece.marbleId) ?? null;
	}
	return open[0] ?? null;
}

/** The latest piece of the marble placed before `time`, which Repeat and Mirror copy */
export function previousPiece(project: TProject, marbleId: string, time: number): TLinkedPiece | null {
	const before = linkedPieces(project, marbleId).filter((piece) => piece.time < time);
	return before[before.length - 1] ?? null;
}

export type TStepMode = 'default' | 'repeat' | 'mirror';

/** Angle for a new piece at `hit`: the default lean, or the previous piece's angle repeated or mirrored */
export function stepAngle(project: TProject, hit: THitResult, mode: TStepMode): number {
	const previous = mode === 'default' ? null : previousPiece(project, hit.marbleId, hit.targetTime);
	if (previous != null) return mode === 'mirror' ? -previous.angle : previous.angle;
	const dot = hit.dot ?? { x: 0, y: 0 };
	return defaultPlatformAngle(dot, hit.velocity, frameBand(project, hit.marbleId).centerX);
}

/**
 * The piece a click or step puts at an open hit. Platforms and windmills take the step angle; rails and
 * tunnels start under the marble and run with its travel, turned back when that would leave the frame.
 */
export function pieceForHit(project: TProject, hit: THitResult, type: string, mode: TStepMode = 'default', id?: string): TPiece {
	const kind = layoutOf(type);
	if (kind === 'path' || kind === 'tube') {
		const entity = createLinkedPiece(type, hit.marbleId, hit.hitId, 0, { entities: project.track.pieces, id });
		return withRunDirection(project, entity, hit.dot, hit.velocity);
	}
	return createLinkedPiece(type, hit.marbleId, hit.hitId, stepAngle(project, hit, mode), { entities: project.track.pieces, id });
}

/**
 * A scenery piece (rail, tunnel, windmill) the marble meets at `time` on its way, linked to the marble's latest
 * hit before that time with an entry delay. It follows that hit's trajectory like any linked piece and never
 * sounds a hit.
 */
export function followerAt(
	project: TProject,
	marbleId: string,
	type: string,
	time: number,
	position: TVec2,
	velocity: TVec2 | null
): TResult<TPiece, Error> {
	const marble = project.marbles.find((item) => item.id === marbleId);
	const hit = [...(marble?.hits ?? [])].reverse().find((item) => item.time < time - 0.005);
	if (hit == null) return Err(new Error("A piece can follow this marble only after its first hit. Drop it lower on the marble's fall."));
	const delay = Math.round((time - hit.time) * 1000) / 1000;
	const maxDelay = getPieceDefinition(type)?.params['entryDelay']?.max ?? 2;
	if (delay > maxDelay) return Err(new Error(`This spot is ${delay.toFixed(1)} s after the last hit. Drop the piece within ${maxDelay} s of a hit.`));
	const entity = createLinkedPiece(type, marbleId, hit.id, 0, { entities: project.track.pieces });
	entity.params = { ...entity.params, entryDelay: delay };
	const kind = layoutOf(type);
	if (kind === 'catcher') return Ok(asMarbleBowl(project, entity, velocity));
	return Ok(kind === 'path' || kind === 'tube' ? withRunDirection(project, entity, position, velocity) : entity);
}

/**
 * A Bowl for the marble of its anchor: its center on the side the marble moves toward, and the marble's own Bowl
 * kept, moved to the new spot, since a marble has at most one
 */
export function asMarbleBowl(project: TProject, entity: TPiece, velocity: TVec2 | null): TPiece {
	const link = tieOf(entity);
	const existing = link != null ? bowlOfMarble(project, link.marbleId) : undefined;
	const params: Record<string, number> = { ...(existing?.params ?? {}), ...entity.params, mirror: (velocity?.x ?? 0) < 0 ? 1 : 0 };
	const style = existing?.params['style'];
	if (style != null) params['style'] = style;
	return {
		...(existing?.path != null ? { path: existing.path } : {}),
		...(existing?.skin != null ? { skin: existing.skin } : {}),
		...(existing?.ride != null ? { ride: existing.ride } : {}),
		...entity,
		id: existing?.id ?? entity.id,
		...(existing?.name != null ? { name: existing.name } : {}),
		params,
		...(link?.kind === 'plays' ? { place: { kind: 'follows' as const, marbleId: link.marbleId, hitId: link.hitId, contactAt: link.contactAt } } : {})
	};
}

/** Points the run of a new rail or tunnel along the horizontal travel, or back when it would leave the frame */
function withRunDirection(project: TProject, entity: TPiece, position: TVec2 | null, velocity: TVec2 | null): TPiece {
	const points = resolvePiecePath(entity.type, undefined);
	const reach = Math.max(...points.map((point) => point.x));
	const band = frameBand(project);
	const x = position?.x ?? band.centerX;
	let direction = Math.abs(velocity?.x ?? 0) > 0.05 ? Math.sign(velocity?.x ?? 1) : x <= band.centerX ? 1 : -1;
	if (Math.abs(x + direction * reach - band.centerX) > band.halfWidth) direction = -direction;
	return { ...entity, path: { points: points.map((point) => ({ x: point.x * direction, y: point.y })) } };
}

/** Adds a piece made for an open hit, selects it, moves the playhead there and plays the note */
export function commitAtHit(cx: StudioCx, hit: THitResult, entity: TPiece): boolean {
	const project = cx.project;
	if (project == null || !cx.execute([{ type: 'addPiece', piece: entity }])) return false;
	cx.$selection.set([entity.id]);
	if (!cx.$playing.get()) cx.$playhead.set(hit.targetTime);
	const pitch = project.marbles.find((marble) => marble.id === hit.marbleId)?.hits.find((item) => item.id === hit.hitId)?.pitch;
	cx.audition(hit.marbleId, pitch);
	return true;
}

/** Places a piece of `type` at an open hit, selects it, moves the playhead there and plays the note */
export function placeAtHit(cx: StudioCx, hit: THitResult, type: string): string | null {
	const project = cx.project;
	if (project == null || hit.dot == null) return null;
	const entity = pieceForHit(project, hit, type, 'default');
	return commitAtHit(cx, hit, entity) ? entity.id : null;
}

// MARK: - Piece edits

/** Project with new angles for some pieces, for previews that should not enter history */
export function withPieceAngles(project: TProject, angles: Map<string, number>): TProject {
	return {
		...project,
		track: { ...project.track, pieces: project.track.pieces.map((entity) => {
			const angle = angles.get(entity.id);
			return angle == null ? entity : { ...entity, angle };
		}) }
	};
}

export function pieceAngleCommands(project: TProject, angles: Map<string, number>): TProjectCommand[] {
	const commands: TProjectCommand[] = [];
	for (const entity of project.track.pieces) {
		const angle = angles.get(entity.id);
		if (angle != null && entity.angle !== angle) commands.push({ type: 'updatePiece', pieceId: entity.id, patch: { angle } });
	}
	return commands;
}

/** Surface angle of a piece as edited */
export function pieceAngle(entity: TPiece): number {
	return entity.angle;
}

export function selectedPieceIds(project: TProject, selection: string[]): string[] {
	return selection.filter((id) => project.track.pieces.some((entity) => entity.id === id));
}
