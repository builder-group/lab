import type { TProject, TVec2 } from '@/modules/project';
import { trajectoryAt } from './simulate';
import type { TMarbleSample, TSimulationResult } from './types';

// Seamless loops by entry from above. The film shows [start, end). At `start` every marble that is already
// released is in free flight well below its release point, so the release point is out of the camera's view.
// Before `end` a ghost of each marble replays the marble's own motion from its release to `start`, shifted by the
// loop length, so the frame at `end` shows the ghost exactly where the marble was at `start`. The marble itself
// has left the view by then: it fell off the track or went far down the run. The camera blends its last
// `blend` seconds into its poses from before `start` (in Blender), and the soundtrack is cut to the same range
// with the tails of notes near the end folded onto its beginning.

/** Loop start and length snap to this grid, so both land on frames at 30 and 60 fps */
export const LOOP_GRID = 1 / 30;
/** Seconds over which the camera blends from the run into its first pose */
export const LOOP_BLEND = 0.75;
/** Fall below the highest point before the loop starts, in camera distances, so the release point is out of view */
export const LOOP_ENTRY_DROP = 0.75;
/** Seconds between the loop start and a marble's first contact, so playback warps near hits do not reach the start */
export const LOOP_ENTRY_MARGIN = 0.15;
/** Seconds the ghost keeps replaying after the loop end */
const GHOST_TAIL = 0.1;
/** Reactions read the hit value, which decays to 0 within this time (`HIT_DECAY` in the Blender worker) */
const REACTION_DECAY = 0.25;
/** A marble closer than this many camera distances to the entry point can still be in view at the loop end */
const VIEW_REACH = 1.6;
/** Largest ghost mismatch accepted by the loop check */
export const LOOP_POSITION_TOLERANCE = 0.0005;
export const LOOP_VELOCITY_TOLERANCE = 0.01;

export interface TLoop {
	/** Time of the first film frame */
	start: number;
	/** Time of the frame after the last; it shows what `start` shows */
	end: number;
	length: number;
	/** Seconds the camera blends into its first pose before `end` */
	blend: number;
	ghosts: TLoopGhost[];
	/** Bar grid of the music; null when the tempo is unknown */
	bars: TLoopBars | null;
}

export interface TLoopGhost {
	marbleEntityId: string;
	/** The marble's samples from its release to just after `start`, shifted by the loop length */
	samples: TMarbleSample[];
}

export interface TLoopBars {
	/** Seconds per bar */
	barLength: number;
	/** Whole bars closest to the loop length */
	count: number;
	/** Loop length minus the whole bars, in seconds */
	offset: number;
	/** Project end that makes the loop exactly `count` bars long, on the loop grid */
	snappedEnd: number;
}

/**
 * Loop range and ghosts of a simulated project. The start is the first moment a released marble has fallen
 * `LOOP_ENTRY_DROP` camera distances below its highest point; the end is the project end, both on the loop grid.
 * Returns null when no marble falls far enough or the range is shorter than a grid step.
 */
export function createLoop(project: TProject, result: TSimulationResult): TLoop | null {
	const drop = LOOP_ENTRY_DROP * project.design.camera.distance;
	let entry = Number.POSITIVE_INFINITY;
	for (const track of result.marbles) entry = Math.min(entry, entryTime(track.samples, drop) ?? Number.POSITIVE_INFINITY);
	if (!Number.isFinite(entry)) return null;

	const startStep = Math.ceil(entry / LOOP_GRID - 1e-6);
	const lengthSteps = Math.floor((project.end - startStep * LOOP_GRID) / LOOP_GRID + 1e-6);
	if (lengthSteps < 1) return null;
	const start = startStep * LOOP_GRID;
	const length = lengthSteps * LOOP_GRID;
	const end = (startStep + lengthSteps) * LOOP_GRID;

	const ghosts: TLoopGhost[] = [];
	for (const track of result.marbles) {
		const first = track.samples[0];
		// A marble released after the start is held at its release point at both ends
		if (first == null || first.time > start + 1e-9) continue;
		ghosts.push({
			marbleEntityId: track.entityId,
			samples: track.samples
				.filter((sample) => sample.time <= start + GHOST_TAIL + 1e-9)
				.map((sample) => ({ ...sample, time: sample.time + length }))
		});
	}

	return { start, end, length, blend: Math.min(LOOP_BLEND, length / 3), ghosts, bars: loopBars(project, start, length) };
}

/** Compares the loop's first frame with the frame after its last and reports every mismatch */
export function checkLoop(project: TProject, result: TSimulationResult, loop: TLoop): TLoopCheck {
	const issues: TLoopIssue[] = [];
	let positionError = 0;
	let velocityError = 0;
	const reach = VIEW_REACH * project.design.camera.distance;

	for (const track of result.marbles) {
		const first = track.samples[0];
		if (first == null) continue;
		if (first.time > loop.start + 1e-9) {
			issues.push({ kind: 'lateRelease', marbleEntityId: track.entityId });
			continue;
		}
		const atStart = trajectoryAt(track.samples, loop.start);
		const ghost = loop.ghosts.find((item) => item.marbleEntityId === track.entityId);
		const ghostAtEnd = ghost != null ? trajectoryAt(ghost.samples, loop.end) : null;
		if (atStart == null || ghostAtEnd == null) {
			issues.push({ kind: 'state', marbleEntityId: track.entityId, positionError: Infinity, velocityError: Infinity });
			continue;
		}
		const position = distance(atStart.position, ghostAtEnd.position);
		const velocity = distance(atStart.velocity, ghostAtEnd.velocity);
		positionError = Math.max(positionError, position);
		velocityError = Math.max(velocityError, velocity);
		if (position > LOOP_POSITION_TOLERANCE || velocity > LOOP_VELOCITY_TOLERANCE)
			issues.push({ kind: 'state', marbleEntityId: track.entityId, positionError: position, velocityError: velocity });

		const firstContact = result.contacts.find((contact) => contact.marbleEntityId === track.entityId);
		if (firstContact != null && firstContact.time < loop.start + LOOP_ENTRY_MARGIN)
			issues.push({ kind: 'entry', marbleEntityId: track.entityId, contactTime: firstContact.time });

		// A marble whose samples ended fell out of the world; otherwise it must be far from where the ghost is
		const atEnd = trajectoryAt(track.samples, loop.end);
		if (atEnd != null && distance(atEnd.position, atStart.position) < reach)
			issues.push({ kind: 'stillInView', marbleEntityId: track.entityId, distance: distance(atEnd.position, atStart.position) });
	}

	for (const hit of result.hits) {
		if (hit.actualTime == null || hit.pieceEntityId == null) continue;
		if (hit.actualTime > loop.end - REACTION_DECAY && hit.actualTime < loop.end)
			issues.push({ kind: 'reaction', pieceEntityId: hit.pieceEntityId, time: hit.actualTime });
	}

	for (const piece of result.pieces) {
		if (piece.motion == null || piece.motion.length < 2) continue;
		// A rotor with n blades looks the same after a turn of 2π / n
		const period = (2 * Math.PI) / Math.max(1, piece.params['bladeCount'] ?? 1);
		const turned = motionAngle(piece.motion, loop.end) - motionAngle(piece.motion, loop.start);
		const angleError = Math.abs(turned - Math.round(turned / period) * period);
		if (angleError > 0.01) issues.push({ kind: 'movingPiece', pieceEntityId: piece.entityId, angleError });
	}

	if (loop.bars != null && Math.abs(loop.bars.offset) > LOOP_GRID / 2)
		issues.push({ kind: 'bars', offset: loop.bars.offset, snappedEnd: loop.bars.snappedEnd });

	return { isOk: !issues.length, issues, positionError, velocityError };
}

export interface TLoopCheck {
	isOk: boolean;
	issues: TLoopIssue[];
	/** Largest distance between a marble at the start and its ghost at the end */
	positionError: number;
	velocityError: number;
}

export type TLoopIssue =
	/** The ghost does not reproduce the marble's state at the start */
	| { kind: 'state'; marbleEntityId: string; positionError: number; velocityError: number }
	/** The marble touches a piece before or right after the start, so it does not enter from above */
	| { kind: 'entry'; marbleEntityId: string; contactTime: number }
	/** The marble is still near the entry at the end, so it would show twice */
	| { kind: 'stillInView'; marbleEntityId: string; distance: number }
	/** The marble is released after the start and waits at its release point */
	| { kind: 'lateRelease'; marbleEntityId: string }
	/** A piece still reacts to a hit at the end */
	| { kind: 'reaction'; pieceEntityId: string; time: number }
	/** A moving piece ends at another angle than it starts */
	| { kind: 'movingPiece'; pieceEntityId: string; angleError: number }
	/** The loop is not a whole number of bars */
	| { kind: 'bars'; offset: number; snappedEnd: number };

/** First sample time at which the marble is `drop` below the highest point it reached so far */
function entryTime(samples: TMarbleSample[], drop: number): number | null {
	let highest = Number.NEGATIVE_INFINITY;
	for (const sample of samples) {
		highest = Math.max(highest, sample.position.y);
		if (highest - sample.position.y >= drop) return sample.time;
	}
	return null;
}

function loopBars(project: TProject, start: number, length: number): TLoopBars | null {
	const tempo = project.music.tempo;
	if (tempo == null) return null;
	const barLength = (60 / tempo.bpm) * tempo.beatsPerBar;
	const count = Math.max(1, Math.round(length / barLength));
	const snappedEnd = Math.round((start + count * barLength) / LOOP_GRID) * LOOP_GRID;
	return { barLength, count, offset: length - count * barLength, snappedEnd };
}

function motionAngle(motion: { time: number; angle: number }[], time: number): number {
	const index = motion.findIndex((sample) => sample.time > time);
	if (index < 0) return motion[motion.length - 1]?.angle ?? 0;
	const after = motion[index];
	const before = motion[index - 1];
	if (before == null || after == null) return after?.angle ?? 0;
	const t = (time - before.time) / Math.max(1e-9, after.time - before.time);
	return before.angle + (after.angle - before.angle) * t;
}

function distance(a: TVec2, b: TVec2): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}
