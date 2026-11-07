import { Err, Ok, type TResult } from 'tuple-result';
import type { TPiece, TProject, TProjectCommand, TVec2 } from '@/modules/project';
import { bowlOfMarble, createLinkedPiece, frameBand, stageBand, getPieceDefinition, layoutOf, resolvePiecePath, type THitResult, type TSimulationResult } from '@/modules/simulation';
import { tieOf } from '@/modules/project';
import type { StudioCx } from '@/modules/studio';
import { linkedPieces, openHits, type TLinkedPiece } from '@/modules/building';

// The step loop builds a run one hit at a time: place a piece at a dot, rotate it, accept and move on.

/** The first open hit per marble, which the canvas emphasizes as the next step */
export function nextOpenHitPerMarble(result: TSimulationResult): Map<string, THitResult> {
	const next = new Map<string, THitResult>();
	for (const hit of openHits(result)) if (!next.has(hit.marbleId)) next.set(hit.marbleId, hit);
	return next;
}

/** The latest piece of the marble placed before `time`, which Repeat and Mirror copy */
export function previousPiece(project: TProject, marbleId: string, time: number): TLinkedPiece | null {
	const before = linkedPieces(project, marbleId).filter((piece) => piece.time < time);
	return before[before.length - 1] ?? null;
}

const DEFAULT_TILT = (15 * Math.PI) / 180;
// Dots closer than this to the frame center lean against the horizontal motion instead
const CENTER_DEADBAND = 0.02;

/**
 * Default surface angle for a new piece at a hit dot. The surface tilts by 15° so its normal leans toward
 * the frame center. Near the center it leans against the current horizontal motion, which turns the
 * marble back. A positive angle leans the normal to the left.
 */
function defaultPlatformAngle(
	dot: TVec2,
	velocity: TVec2 | null,
	frameCenterX: number
): number {
	const offset = dot.x - frameCenterX;
	if (Math.abs(offset) > CENTER_DEADBAND) return offset > 0 ? DEFAULT_TILT : -DEFAULT_TILT;
	return (velocity?.x ?? 0) >= 0 ? DEFAULT_TILT : -DEFAULT_TILT;
}

export type TStepMode = 'default' | 'repeat' | 'mirror';

/** Angle for a new piece at `hit`: the default lean, or the previous piece's angle repeated or mirrored */
export function stepAngle(project: TProject, hit: THitResult, mode: TStepMode): number {
	const previous = mode === 'default' ? null : previousPiece(project, hit.marbleId, hit.targetTime);
	if (previous != null) return mode === 'mirror' ? -previous.angle : previous.angle;
	const dot = hit.dot ?? { x: 0, y: 0 };
	return defaultPlatformAngle(dot, hit.velocity, frameBand(project, hit.marbleId, dot.y).centerX);
}

/**
 * The piece a click or step puts at an open hit. Platforms and windmills take the step angle; rails and
 * tunnels start under the marble and run with its travel, turned back when that would leave the frame.
 */
export function pieceForHit(project: TProject, hit: THitResult, type: string, mode: TStepMode = 'default', id?: string): TPiece {
	const kind = layoutOf(type);
	if (kind === 'path' || kind === 'tube') {
		const piece = createLinkedPiece(type, hit.marbleId, hit.hitId, 0, { pieces: project.track.pieces, id });
		return withRunDirection(project, piece, hit.dot, hit.velocity);
	}
	return createLinkedPiece(type, hit.marbleId, hit.hitId, stepAngle(project, hit, mode), { pieces: project.track.pieces, id });
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
	if (hit == null) return Err(new Error("A piece can follow this marble only after its first note. Drop it lower on the marble's fall."));
	const delay = Math.round((time - hit.time) * 1000) / 1000;
	const maxDelay = getPieceDefinition(type)?.params['entryDelay']?.max ?? 2;
	if (delay > maxDelay) return Err(new Error(`This spot is ${delay.toFixed(1)} s after the last note. Drop the piece within ${maxDelay} s of a note.`));
	const piece = createLinkedPiece(type, marbleId, hit.id, 0, { pieces: project.track.pieces });
	piece.params = { ...piece.params, entryDelay: delay };
	const kind = layoutOf(type);
	if (kind === 'catcher') return Ok(asMarbleBowl(project, piece, velocity));
	return Ok(kind === 'path' || kind === 'tube' ? withRunDirection(project, piece, position, velocity) : piece);
}

/**
 * A Bowl for the marble of its anchor: its center on the side the marble moves toward, and the marble's own Bowl
 * kept, moved to the new spot, since a marble has at most one
 */
export function asMarbleBowl(project: TProject, piece: TPiece, velocity: TVec2 | null): TPiece {
	const link = tieOf(piece);
	const existing = link != null ? bowlOfMarble(project, link.marbleId) : undefined;
	const params: Record<string, number> = { ...(existing?.params ?? {}), ...piece.params, mirror: (velocity?.x ?? 0) < 0 ? 1 : 0 };
	const style = existing?.params['style'];
	if (style != null) params['style'] = style;
	return {
		...(existing?.path != null ? { path: existing.path } : {}),
		...(existing?.skin != null ? { skin: existing.skin } : {}),
		...(existing?.ride != null ? { ride: existing.ride } : {}),
		...piece,
		id: existing?.id ?? piece.id,
		...(existing?.name != null ? { name: existing.name } : {}),
		params,
		...(link?.kind === 'plays' ? { place: { kind: 'follows' as const, marbleId: link.marbleId, hitId: link.hitId, contactAt: link.contactAt } } : {})
	};
}

/** Points the run of a new rail or tunnel along the horizontal travel, or back when it would leave the frame */
function withRunDirection(project: TProject, piece: TPiece, position: TVec2 | null, velocity: TVec2 | null): TPiece {
	const points = resolvePiecePath(piece.type, undefined);
	const reach = Math.max(...points.map((point) => point.x));
	const band = stageBand(project, position?.y);
	const x = position?.x ?? band.centerX;
	let direction = Math.abs(velocity?.x ?? 0) > 0.05 ? Math.sign(velocity?.x ?? 1) : x <= band.centerX ? 1 : -1;
	if (Math.abs(x + direction * reach - band.centerX) > band.halfWidth) direction = -direction;
	return { ...piece, path: { points: points.map((point) => ({ x: point.x * direction, y: point.y })) } };
}

/** Lands a piece made for an open hit and what it brings, selects it, moves the playhead there and plays the note */
export function commitAtHit(cx: StudioCx, hit: THitResult, piece: TPiece, commands: TProjectCommand[] = [{ type: 'addPiece', piece }]): boolean {
	const project = cx.project;
	if (project == null || !cx.execute(commands)) return false;
	cx.$selection.set([piece.id]);
	if (!cx.$playing.get()) cx.$playhead.set(hit.targetTime);
	const pitch = project.marbles.find((marble) => marble.id === hit.marbleId)?.hits.find((item) => item.id === hit.hitId)?.pitch;
	cx.audition(hit.marbleId, pitch);
	return true;
}

/** Places a piece of `type` at an open hit, selects it, moves the playhead there and plays the note */
export function placeAtHit(cx: StudioCx, hit: THitResult, type: string): string | null {
	const project = cx.project;
	if (project == null || hit.dot == null) return null;
	const piece = pieceForHit(project, hit, type, 'default');
	return commitAtHit(cx, hit, piece) ? piece.id : null;
}

// MARK: - Piece edits

/** Project with new angles for some pieces, for previews that should not enter history */
export function withPieceAngles(project: TProject, angles: Map<string, number>): TProject {
	return {
		...project,
		track: { ...project.track, pieces: project.track.pieces.map((piece) => {
			const angle = angles.get(piece.id);
			return angle == null ? piece : { ...piece, angle };
		}) }
	};
}

export function pieceAngleCommands(project: TProject, angles: Map<string, number>): TProjectCommand[] {
	const commands: TProjectCommand[] = [];
	for (const piece of project.track.pieces) {
		const angle = angles.get(piece.id);
		if (angle != null && piece.angle !== angle) commands.push({ type: 'updatePiece', pieceId: piece.id, patch: { angle } });
	}
	return commands;
}

/** Surface angle of a piece as edited */
export function pieceAngle(piece: TPiece): number {
	return piece.angle;
}

export function selectedPieceIds(project: TProject, selection: string[]): string[] {
	return selection.filter((id) => project.track.pieces.some((piece) => piece.id === id));
}
