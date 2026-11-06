import { type TMarble, type TPiece, type TProject, type TVec2, tieOf, type TPlays } from '@/modules/project';
import { gravityOf } from './geometry';
import { getPieceDefinition, soundsHit } from './pieces';
import { trajectoryAt, type TSimulator } from './simulate';
import { bakeRide, hasRide, LEAVE_STEPS, rideKey } from './ride';
import { PHYSICS_HZ, type THitResult, type TSimulationResult } from './types';

// An edit to a platform changes how the marble leaves it, and only that: with gap pieces keeping their rides, the rest
// of the run depends only on where the marble is and how fast it goes. So the next platforms take up the change. One gets
// the tilt and bounce that send the marble to the next one's old spot, the next the tilt and bounce that send it on as
// before, and everything after them stays where it was, on time. Tilt and bounce are two numbers for the two numbers of
// a velocity, so the solve is exact until the bounce runs out of range or a piece stands in the way. Then a later pair
// is tried, since the error stays what it was as long as nothing takes it up.

const STEP_TIME = 1 / PHYSICS_HZ;
const NEWTON_STEPS = 5;
/** Residual of a solve, with distances counted ten times: 0.2 mm or 2 mm/s */
const SOLVED = 2e-3;
const DISTANCE_WEIGHT = 10;
const TILT_LIMIT = 40 * (Math.PI / 180);
/** Later platforms left alone, and platforms that only restore the speed, before the pair that takes up the rest */
const VARIANTS: readonly { skip: number; restore: number }[] = [
	{ skip: 0, restore: 0 },
	{ skip: 0, restore: 1 },
	{ skip: 1, restore: 0 },
	{ skip: 0, restore: 2 },
	{ skip: 1, restore: 1 },
	{ skip: 2, restore: 0 }
];

/** What changed in a marble: everything after this hit stays on the old run */
export interface TMarbleEdit {
	marbleId: string;
	/** Index in the edited project's marble of the hit after which the run must be what it was */
	afterIndex: number;
	/** The dragged platform's new dot: the platform before it aims there */
	movedDot?: { hitId: string; dot: TVec2 } | null;
}

export interface TSettled {
	/** The edited project with rides kept and the platforms that took up the change */
	project: TProject;
	/** Ids of platforms given a new tilt or bounce */
	absorbedBy: string[];
	/** Hits broken that weren't before; none when the edit stayed local */
	broken: THitResult[];
	/** Marble contacts with pieces it didn't touch before, or strikes more than before */
	strays: number;
	/** The run of `project` */
	result: TSimulationResult;
	/** Hits from which later pieces wait where they were */
	heldFrom: THitResult[];
	/** Runs it took */
	runs: number;
	/** How far from the asked-for spot a moved dot landed, in meters; null without a move */
	moveMiss: number | null;
}

/**
 * The pieces of a marble from `time` on wait where they were in `base`, so a break stays one problem at one hit: the run
 * after it doesn't fold them into a heap, and a fix can bring the marble back to them.
 */
export function holdFrom(project: TProject, base: TSimulationResult, marbleId: string, time: number): TProject {
	const marble = project.marbles.find((item) => item.id === marbleId);
	const samples = base.marbles.find((marble) => marble.marbleId === marbleId)?.samples;
	const first = samples?.[0]?.time;
	if (marble == null || samples == null || first == null) return project;
	const g = gravityOf(project);
	return {
		...project,
		track: { ...project.track, pieces: project.track.pieces.map((piece) => {
			const link = tieOf(piece);
			if (link == null || link.marbleId !== marbleId || link.held != null) return piece;
			const hit = marble.hits.find((item) => item.id === link.hitId);
			if (hit == null) return piece;
			const type = piece.type ?? '';
			const at = hit.time + (soundsHit(type, link) ? 0 : (piece.params['entryDelay'] ?? 0));
			if (at < time - 1e-6) return piece;
			const played = soundsHit(type, link) ? base.hits.find((item) => item.marbleId === marbleId && item.hitId === link.hitId) : undefined;
			const moment = played?.dot != null ? { position: played.dot, velocity: played.velocity } : trajectoryAt(samples, at, g);
			if (moment == null) return piece;
			const leaves = soundsHit(type, link) ? leavingAt(base, marbleId, hit.time) : null;
			return { ...piece, place: { ...link, held: { dot: moment.position, velocity: moment.velocity, leaves } } };
		}) }
	};
}

/**
 * Keeps the rides of a track an edit is about to change, from `fromTime` on. Earlier ones stay simulated: the edit can't
 * reach them, and a ride played back differs by the last bits, which a rail turns into centimeters on the pieces after it.
 */
export function withRides(project: TProject, result: TSimulationResult, fromTime = -Infinity): TProject {
	let isChanged = false;
	const timeOf = (marbleId: string, hitId: string): number | undefined => project.marbles.find((marble) => marble.id === marbleId)?.hits.find((hit) => hit.id === hitId)?.time;
	const pieces = project.track.pieces.map((piece) => {
		const type = piece.type ?? '';
		const link = tieOf(piece);
		if (link == null || !hasRide(type) || soundsHit(type, link)) return piece;
		if (piece.ride?.key === rideKey(piece) || (timeOf(link.marbleId, link.hitId) ?? Infinity) < fromTime) return piece;
		const ride = bakeRide(project, result, piece);
		if (ride == null) return piece;
		isChanged = true;
		return { ...piece, ride };
	});
	return isChanged ? { ...project, track: { ...project.track, pieces } } : project;
}

/** A platform's aim: where the marble must be at its next hit, or how it must leave */
type TAim = { kind: 'dot'; dot: TVec2; nextHitId: string; nextTime: number } | { kind: 'exit'; velocity: TVec2; spin: number };

interface TStep {
	entityId: string;
	hitId: string;
	time: number;
	aim: TAim;
	/** Tilt, bounce, arrival and leaving before the edit, which hold what friction adds to a reflection */
	before: { angle: number; bounce: number; arrival: TVec2 | null; leaving: TVec2 | null };
}

function setValues(project: TProject, id: string, angle: number, bounce: number): TProject {
	return {
		...project,
		track: { ...project.track, pieces: project.track.pieces.map((piece) => {
			if (piece.id !== id) return piece;
			return tieOf(piece) == null ? piece : { ...piece, angle, params: { ...piece.params, bounce } };
		}) }
	};
}

function withLeaves(project: TProject, id: string, leaves: NonNullable<TPlays['leaves']>): TProject {
	return {
		...project,
		track: { ...project.track, pieces: project.track.pieces.map((piece) => {
			return piece.id === id && piece.place.kind === 'plays' ? { ...piece, place: { ...piece.place, leaves } } : piece;
		}) }
	};
}

function linkedPlatform(project: TProject, marbleId: string, hitId: string): TPiece | undefined {
	return project.track.pieces.find((piece) => {
		const link = tieOf(piece);
		const type = piece.type ?? '';
		return link?.marbleId === marbleId && link.hitId === hitId && soundsHit(type, link) && getPieceDefinition(type)?.params['bounce'] != null;
	});
}

/** Whether a piece the marble rides follows this hit */
function launchesRide(project: TProject, marbleId: string, hitId: string): boolean {
	return project.track.pieces.some((piece) => {
		const link = tieOf(piece);
		return link?.marbleId === marbleId && link.hitId === hitId && hasRide(piece.type ?? '');
	});
}

/** The marble as it has just left the platform of a hit at `time`, with its spin */
function leavingAt(result: TSimulationResult, marbleId: string, time: number): { velocity: TVec2; spin: number } | null {
	const samples = result.marbles.find((marble) => marble.marbleId === marbleId)?.samples;
	const first = samples?.[0]?.time;
	if (samples == null || first == null) return null;
	const index = Math.floor(time * PHYSICS_HZ + 1e-6) + LEAVE_STEPS - Math.round(first * PHYSICS_HZ);
	const sample = samples[index];
	const next = samples[index + 1];
	if (sample == null || next == null) return null;
	const turn = next.angle - sample.angle;
	return { velocity: sample.velocity, spin: Math.atan2(Math.sin(turn), Math.cos(turn)) * PHYSICS_HZ };
}

/** A velocity read `LEAVE_STEPS` after the hit, as it was when the marble left the surface */
function atContact(velocity: TVec2, g: number): TVec2 {
	return { x: velocity.x, y: velocity.y + g * LEAVE_STEPS * STEP_TIME };
}

/** Tilt and bounce that turn `arrival` into `leaving` by reflection, without friction: the normal lies along the change */
function reflectionFor(arrival: TVec2, leaving: TVec2): { angle: number; bounce: number } | null {
	const dx = leaving.x - arrival.x;
	const dy = leaving.y - arrival.y;
	const length = Math.hypot(dx, dy);
	if (length < 1e-9) return null;
	const nx = dx / length;
	const ny = dy / length;
	const into = arrival.x * nx + arrival.y * ny;
	if (into >= 0) return null;
	return { angle: Math.atan2(-nx, ny), bounce: -(leaving.x * nx + leaving.y * ny) / into };
}

/** What the old run did at a platform */
interface TWas {
	dot: TVec2;
	arrival: TVec2 | null;
	leaving: { velocity: TVec2; spin: number } | null;
}

/** How the marble met a platform in the old run: as the run before the edit played it, or as it waits for it */
function oldRun(piece: TPiece, base: TSimulationResult, marbleId: string, hit: { id: string; time: number }): TWas | null {
	const held = tieOf(piece)?.held;
	if (held != null) return { dot: held.dot, arrival: held.velocity, leaving: held.leaves };
	const played = base.hits.find((item) => item.marbleId === marbleId && item.hitId === hit.id);
	if (played?.dot == null || played.status !== 'onTime') return null;
	return { dot: played.dot, arrival: played.velocity, leaving: leavingAt(base, marbleId, hit.time) };
}

/**
 * The steps that bring a marble back on `base` after `afterIndex`. `skip` later platforms stay as they are and the next
 * `restore` take only their old speed; then a pair takes up the rest. A platform launching into a ride can only restore
 * its speed, since the ride comes before the next platform: the first pair after the ride takes up the offset.
 */
function planSteps(project: TProject, base: TSimulationResult, edit: TMarbleEdit, variant: { skip: number; restore: number }): TStep[] | null {
	const { marbleId } = edit;
	const marble = project.marbles.find((item) => item.id === marbleId);
	if (marble == null) return null;
	const stepFor = (piece: TPiece, hitId: string, time: number, aim: TAim, was: TWas): TStep => ({
		entityId: piece.id,
		hitId,
		time,
		aim,
		before: {
			angle: piece.angle ?? 0,
			bounce: piece.params['bounce'] ?? 0.65,
			arrival: was.arrival,
			leaving: was.leaving?.velocity ?? null
		}
	});
	// The platforms after the edit that the old run played, in order
	const platforms = marble.hits.slice(edit.afterIndex + 1).flatMap((hit) => {
		const piece = linkedPlatform(project, marbleId, hit.id);
		const was = piece != null ? oldRun(piece, base, marbleId, hit) : null;
		return piece != null && was != null ? [{ piece, hit, was }] : [];
	});
	const steps: TStep[] = [];
	const moved = edit.movedDot;
	if (moved != null) {
		// The platform before the dragged one sends the marble to the new spot, when nothing rides in between
		const index = marble.hits.findIndex((hit) => hit.id === moved.hitId);
		const previous = marble.hits[index - 1];
		const piece = previous != null ? linkedPlatform(project, marbleId, previous.id) : undefined;
		const was = piece != null && previous != null ? oldRun(piece, base, marbleId, previous) : null;
		const target = marble.hits[index];
		if (piece != null && previous != null && was != null && target != null && !launchesRide(project, marbleId, previous.id)) {
			steps.push(stepFor(piece, previous.id, previous.time, { kind: 'dot', dot: moved.dot, nextHitId: moved.hitId, nextTime: target.time }, was));
		}
	}
	let skip = variant.skip;
	let restore = variant.restore;
	for (let i = 0; i < platforms.length; i++) {
		const a = platforms[i];
		if (a == null) break;
		const leaving = a.was.leaving;
		const isLaunch = launchesRide(project, marbleId, a.hit.id);
		if (!isLaunch && skip > 0) {
			skip--;
			continue;
		}
		if (isLaunch || restore > 0) {
			if (leaving != null) steps.push(stepFor(a.piece, a.hit.id, a.hit.time, { kind: 'exit', ...leaving }, a.was));
			if (!isLaunch) restore--;
			continue;
		}
		const b = platforms[i + 1];
		if (b == null || b.was.leaving == null) break;
		steps.push(stepFor(a.piece, a.hit.id, a.hit.time, { kind: 'dot', dot: b.was.dot, nextHitId: b.hit.id, nextTime: b.hit.time }, a.was));
		steps.push(stepFor(b.piece, b.hit.id, b.hit.time, { kind: 'exit', ...b.was.leaving }, b.was));
		return steps;
	}
	// Nothing left to take it up with: the end of the marble
	return steps;
}

/** Solves one platform's aim by Newton's method on its tilt and bounce, each try simulated only as far as the aim */
function solveStep(simulator: TSimulator, project: TProject, marbleId: string, step: TStep, count: () => void): TProject {
	const piece = project.track.pieces.find((item) => item.id === step.entityId);
	if (piece == null || tieOf(piece) == null) return project;
	const g = gravityOf(project);
	const spec = getPieceDefinition(piece.type)?.params['bounce'];
	const until = (step.aim.kind === 'dot' ? step.aim.nextTime : step.time) + (LEAVE_STEPS + 3) * STEP_TIME;
	const end = Math.min(project.length, until);
	const run = (candidate: TProject): TSimulationResult => {
		count();
		return simulator.simulate({ ...candidate, length: end });
	};
	const clampAngle = (angle: number): number => Math.max(step.before.angle - TILT_LIMIT, Math.min(step.before.angle + TILT_LIMIT, angle));
	const clampBounce = (bounce: number): number => Math.max(spec?.min ?? 0.1, Math.min(spec?.max ?? 0.95, bounce));
	const errorOf = (angle: number, bounce: number): [number, number] => {
		const result = run(setValues(project, step.entityId, angle, bounce));
		const { aim } = step;
		if (aim.kind === 'dot') {
			const dot = result.hits.find((hit) => hit.marbleId === marbleId && hit.hitId === aim.nextHitId)?.dot;
			return dot != null ? [(dot.x - aim.dot.x) * DISTANCE_WEIGHT, (dot.y - aim.dot.y) * DISTANCE_WEIGHT] : [99, 99];
		}
		const left = leavingAt(result, marbleId, step.time);
		return left != null ? [left.velocity.x - aim.velocity.x, left.velocity.y - aim.velocity.y] : [99, 99];
	};
	const size = (error: [number, number]): number => Math.hypot(error[0], error[1]);
	let angle = piece.angle;
	let bounce = piece.params['bounce'] ?? spec?.default ?? 0.65;
	let current = errorOf(angle, bounce);
	if (size(current) > SOLVED) {
		// A start from reflection for a large change, keeping what friction added before the edit
		const arrived = run(project).hits.find((hit) => hit.marbleId === marbleId && hit.hitId === step.hitId);
		if (arrived?.dot != null && arrived.velocity != null) {
			const { aim } = step;
			const flight = aim.kind === 'dot' ? aim.nextTime - step.time : 0;
			const leaving = aim.kind === 'exit' ? atContact(aim.velocity, g) : { x: (aim.dot.x - arrived.dot.x) / flight, y: (aim.dot.y - arrived.dot.y) / flight + (g * flight) / 2 };
			const guess = reflectionFor(arrived.velocity, leaving);
			const was = step.before.arrival != null && step.before.leaving != null ? reflectionFor(step.before.arrival, atContact(step.before.leaving, g)) : null;
			if (guess != null) {
				const nextAngle = clampAngle(guess.angle + (was != null ? step.before.angle - was.angle : 0));
				const nextBounce = clampBounce(guess.bounce + (was != null ? step.before.bounce - was.bounce : 0));
				const trial = errorOf(nextAngle, nextBounce);
				if (size(trial) < size(current)) {
					angle = nextAngle;
					bounce = nextBounce;
					current = trial;
				}
			}
		}
	}
	for (let n = 0; n < NEWTON_STEPS && size(current) > SOLVED; n++) {
		const byAngle = errorOf(angle + 2e-3, bounce);
		const byBounce = errorOf(angle, bounce > 0.5 ? bounce - 5e-3 : bounce + 5e-3);
		const bounceStep = bounce > 0.5 ? -5e-3 : 5e-3;
		const a = (byAngle[0] - current[0]) / 2e-3;
		const b = (byBounce[0] - current[0]) / bounceStep;
		const c = (byAngle[1] - current[1]) / 2e-3;
		const d = (byBounce[1] - current[1]) / bounceStep;
		const det = a * d - b * c;
		if (Math.abs(det) < 1e-9) break;
		const stepAngle = (-current[0] * d + current[1] * b) / det;
		const stepBounce = (-current[1] * a + current[0] * c) / det;
		let scale = 1;
		let isBetter = false;
		for (let tries = 0; tries < 3 && !isBetter; tries++) {
			const nextAngle = clampAngle(angle + scale * stepAngle);
			const nextBounce = clampBounce(bounce + scale * stepBounce);
			const trial = errorOf(nextAngle, nextBounce);
			if (size(trial) < size(current)) {
				angle = nextAngle;
				bounce = nextBounce;
				current = trial;
				isBetter = true;
			}
			scale /= 2;
		}
		if (!isBetter) break;
	}
	const solved = setValues(project, step.entityId, angle, bounce);
	// How it leaves is kept, so the last of the error and the spin stop here
	return step.aim.kind === 'exit' ? withLeaves(solved, step.entityId, { velocity: step.aim.velocity, spin: step.aim.spin, angle, bounce }) : solved;
}

function isBroken(hit: THitResult): boolean {
	return hit.pieceId != null && (hit.status === 'blocked' || hit.status === 'missed');
}

/** Hits the run broke that were fine in `base` */
function brokenSince(base: TSimulationResult, result: TSimulationResult): THitResult[] {
	const was = new Set(base.hits.filter(isBroken).map((hit) => `${hit.marbleId}/${hit.hitId}`));
	return result.hits.filter((hit) => isBroken(hit) && !was.has(`${hit.marbleId}/${hit.hitId}`));
}

/** Contacts of a marble with a piece beyond what it had in `base`: a new piece struck, or one struck more often */
function strayContacts(base: TSimulationResult, result: TSimulationResult): number {
	const counts = (run: TSimulationResult): Map<string, number> => {
		const map = new Map<string, number>();
		for (const contact of run.contacts) {
			// A touch with no speed is Rapier's early report of a contact that never comes
			if (contact.kind !== 'piece' || (contact.speed ?? 1) < 0.02) continue;
			const key = `${contact.marbleId}|${contact.otherId}`;
			map.set(key, (map.get(key) ?? 0) + 1);
		}
		return map;
	};
	const before = counts(base);
	let strays = 0;
	for (const [key, count] of counts(result)) strays += Math.max(0, count - (before.get(key) ?? 0));
	return strays;
}

/** How far later pieces may stay moved before a break holds them where they were */
const HOLD_SHIFT = 0.03;
/** Runs after which no further way is tried; a count, not a clock, so the answer stays the same on any machine */
const MAX_RUNS = 150;
/** Seconds a drag's settle looks past the platforms that take up the change */
const QUICK_LOOK = 2.5;
/** A way this good ends the search: nothing broken or struck, later pieces under 2 mm from where they were */
const GOOD_ENOUGH = 2;
const GOOD_ENOUGH_SHIFT = 0.01;
const MISS_WEIGHT = 10000;
/** A moved dot nearer than this to where it was asked is where it was asked */
const MISS_MARGIN = 0.001;

type TJudged = Pick<TSettled, 'broken' | 'strays' | 'result' | 'moveMiss'> & { shift: number };

/** How far the hits after the platforms that took up the change stay from where they were */
function laterShift(base: TSimulationResult, result: TSimulationResult, edits: TMarbleEdit[], absorbedBy: string[]): number {
	const taken = new Set(absorbedBy);
	let shift = 0;
	for (const edit of edits) {
		const hits = result.hits.filter((hit) => hit.marbleId === edit.marbleId).sort((a, b) => a.targetTime - b.targetTime);
		const last = hits.reduce((latest, hit, index) => (hit.pieceId != null && taken.has(hit.pieceId) ? index : latest), edit.afterIndex + 1);
		for (const hit of hits.slice(last + 1)) {
			const was = base.hits.find((item) => item.marbleId === hit.marbleId && item.hitId === hit.hitId);
			if (hit.dot != null && was?.dot != null) shift = Math.max(shift, Math.hypot(hit.dot.x - was.dot.x, hit.dot.y - was.dot.y));
		}
	}
	return shift;
}

export interface TSettleOptions {
	/** Only the first way, not checked: for a drag, which asks again at the next move */
	isQuick?: boolean;
}

/**
 * Keeps the run after an edit. `before` holds its rides and `base` is its run; `after` is `before` with the edit, and
 * every marble in `edits` must come back on its old run after the given hit. The first way that breaks nothing wins, else
 * the one that breaks least. A break that remains holds the marble's later pieces where they were, so it stays one problem
 * at one hit. Pure and deterministic; every try runs on `simulator`, which resumes from its snapshots.
 */
export function settleEdit(simulator: TSimulator, base: TSimulationResult, after: TProject, edits: TMarbleEdit[], options: TSettleOptions = {}): TSettled {
	let runs = 0;
	const count = (): void => {
		runs++;
	};
	// A broken hit counts most, then a new strike, and how far the rest of the run stays moved: 10 cm weighs a broken hit
	// A move asked for a spot: 1 cm short of it weighs a broken hit, so the drop lands first and a break can be fixed after
	const score = (settled: Pick<TJudged, 'broken' | 'strays' | 'shift' | 'moveMiss'>): number => settled.broken.length * 100 + settled.strays * 10 + settled.shift * 1000 + (settled.moveMiss ?? 0) * MISS_WEIGHT;
	const movedEdit = edits.find((edit) => edit.movedDot != null);
	const missOf = (result: TSimulationResult): number | null => {
		const moved = movedEdit?.movedDot;
		if (moved == null) return null;
		const dot = result.hits.find((hit) => hit.marbleId === movedEdit?.marbleId && hit.hitId === moved.hitId)?.dot;
		return dot != null ? Math.hypot(dot.x - moved.dot.x, dot.y - moved.dot.y) : Number.POSITIVE_INFINITY;
	};
	const judge = (project: TProject, absorbedBy: string[]): TJudged => {
		count();
		const result = simulator.simulate(project);
		return { result, broken: brokenSince(base, result), strays: strayContacts(base, result), shift: laterShift(base, result, edits, absorbedBy), moveMiss: missOf(result) };
	};
	if (options.isQuick === true) {
		let project = after;
		const absorbedBy: string[] = [];
		for (const edit of edits) {
			for (const step of planSteps(after, base, edit, VARIANTS[0] ?? { skip: 0, restore: 0 }) ?? []) {
				project = solveStep(simulator, project, edit.marbleId, step, count);
				absorbedBy.push(step.entityId);
			}
		}
		// A look just past the change, so a drag too shows a break as one hit and no heap
		const lastStep = Math.max(...edits.map((edit) => after.marbles.find((marble) => marble.id === edit.marbleId)?.hits[Math.min(edit.afterIndex + 3, (after.marbles.find((marble) => marble.id === edit.marbleId)?.hits.length ?? 1) - 1)]?.time ?? 0));
		const end = Math.min(after.length, lastStep + QUICK_LOOK);
		const near = simulator.simulate({ ...project, length: end });
		const broken = brokenSince(base, near).filter((hit) => hit.targetTime < end - 0.05);
		const held = broken.length > 0 ? holdBreaks(project, after, base, near, broken) : null;
		return { project: held?.project ?? project, absorbedBy, broken, strays: 0, result: base, runs, heldFrom: held?.from ?? [], moveMiss: missOf(near) };
	}
	const unsettled = { project: after, absorbedBy: [] as string[], ...judge(after, []) };
	let best: typeof unsettled | null = null;
	for (const [index, variant] of VARIANTS.entries()) {
		if (runs > MAX_RUNS) break;
		let project = after;
		const absorbedBy: string[] = [];
		for (const edit of edits) {
			for (const step of planSteps(after, base, edit, variant) ?? []) {
				project = solveStep(simulator, project, edit.marbleId, step, count);
				absorbedBy.push(step.entityId);
			}
		}
		const judged = judge(project, absorbedBy);
		if (best == null || score(judged) < score(best)) best = { ...judged, project, absorbedBy };
		if (score(best) < GOOD_ENOUGH || (index >= 2 && best.broken.length === 0 && best.strays === 0 && best.shift < GOOD_ENOUGH_SHIFT)) break;
	}
	// A drag asked for the move, so standing still is no better way of doing it, whatever got nearer sticks
	const isNearer = best != null && (best.moveMiss ?? 0) < (unsettled.moveMiss ?? 0) - MISS_MARGIN;
	const chosen = best != null && (movedEdit != null ? isNearer : score(best) <= score(unsettled)) ? best : unsettled;
	let settled: typeof chosen & { heldFrom: THitResult[] } = { ...chosen, heldFrom: [] };
	// A marble freed of one marble may now strike the pieces that wait, so each marble that breaks waits in turn
	for (let marbles = 0; marbles < after.marbles.length; marbles++) {
		const waiting = new Set(settled.heldFrom.map((hit) => hit.marbleId));
		const fresh = settled.broken.filter((hit) => !waiting.has(hit.marbleId));
		const held = fresh.length > 0 ? holdBreaks(settled.project, after, base, settled.result, fresh) : null;
		if (held == null) break;
		settled = { ...settled, ...judge(held.project, settled.absorbedBy), project: held.project, heldFrom: [...settled.heldFrom, ...held.from] };
	}
	return { ...settled, runs };
}

/** Holds each marble whose break carried later pieces away, from its first broken hit on */
function holdBreaks(project: TProject, unsolved: TProject, base: TSimulationResult, result: TSimulationResult, broken: THitResult[]): { project: TProject; from: THitResult[] } | null {
	let next = project;
	const from: THitResult[] = [];
	for (const marble of project.marbles) {
		const first = broken.filter((hit) => hit.marbleId === marble.id).sort((a, b) => a.targetTime - b.targetTime)[0];
		if (first == null) continue;
		const count = broken.filter((hit) => hit.marbleId === marble.id).length;
		const isCarried = result.hits.some((hit) => {
			const was = base.hits.find((item) => item.marbleId === hit.marbleId && item.hitId === hit.hitId);
			return hit.marbleId === marble.id && hit.targetTime > first.targetTime && hit.dot != null && was?.dot != null && Math.hypot(hit.dot.x - was.dot.x, hit.dot.y - was.dot.y) > HOLD_SHIFT;
		});
		if (count <= 1 && !isCarried) continue;
		// What came after the break keeps its values: it waits, it takes up nothing
		const later = new Set(marble.hits.filter((hit) => hit.time >= first.targetTime - 1e-6).map((hit) => hit.id));
		next = {
			...next,
			track: { ...next.track, pieces: next.track.pieces.map((piece) => {
				const link = tieOf(piece);
				return link?.marbleId === marble.id && later.has(link.hitId) ? (unsolved.track.pieces.find((item) => item.id === piece.id) ?? piece) : piece;
			}) }
		};
		next = holdFrom(next, base, marble.id, first.targetTime);
		from.push(first);
	}
	return from.length > 0 ? { project: next, from } : null;
}

// MARK: - What an edit changed

/** The parts of a piece that decide how the marble leaves it or what it rides */
function physicsOf(piece: TPiece | undefined): string {
	if (piece == null) return '';
	const tie = tieOf(piece);
	const { type } = piece;
	const params = getPieceDefinition(type)?.musical === true ? { bounce: piece.params['bounce'] } : piece.params;
	const link = tie == null ? null : [tie.kind, tie.marbleId, tie.hitId, piece.angle, tie.kind === 'follows' ? tie.offset : undefined];
	return JSON.stringify([type, params, piece.path?.points, link]);
}

/**
 * Which marbles `after` changed against `before`, and after which hit the old run must go on. Later platforms must exist
 * for there to be anything to keep, so a piece added at the end of a marble asks nothing. A change that leaves how the
 * marble leaves alone gets `afterIndex` past the marble's end: no platform takes up anything, but the rides hold.
 */
export function marbleEdits(before: TProject, after: TProject): TMarbleEdit[] {
	const edits: TMarbleEdit[] = [];
	const onMarble = (project: TProject, marbleId: string, hitId: string): TPiece[] =>
		project.track.pieces.filter((piece) => {
			const link = tieOf(piece);
			return link?.marbleId === marbleId && link.hitId === hitId;
		});
	for (const marble of after.marbles) {
		const old = before.marbles.find((item) => item.id === marble.id);
		if (old == null) continue;
		if (isWholeRunMoved(old, marble) && physicsOfMarble(before, marble.id) === physicsOfMarble(after, marble.id)) continue;
		let last = -2;
		for (const [index, hit] of marble.hits.entries()) {
			const was = old.hits.find((item) => item.id === hit.id);
			const now = onMarble(after, marble.id, hit.id);
			const then = onMarble(before, marble.id, hit.id);
			const isNewAtEnd = was == null || (!then.length && !marble.hits.slice(index + 1).some((later) => onMarble(after, marble.id, later.id).length > 0));
			if (isNewAtEnd) continue;
			const isPlatformGone = (piece: TPiece): boolean => getPieceDefinition(piece.type ?? '')?.musical === true;
			const isChanged = was.time !== hit.time || now.some((piece) => physicsOf(piece) !== physicsOf(then.find((item) => item.id === piece.id))) || then.some((piece) => !isPlatformGone(piece) && !now.some((item) => item.id === piece.id));
			if (isChanged) last = index;
		}
		// A platform taken away: the platform before it sends the marble on, so it counts among those that take up the change
		for (const [index, hit] of old.hits.entries()) {
			const wasPlatform = linkedPlatform(before, marble.id, hit.id) != null;
			if (!wasPlatform || linkedPlatform(after, marble.id, hit.id) != null) continue;
			const previous = old.hits
				.slice(0, index)
				.reverse()
				.find((item) => linkedPlatform(after, marble.id, item.id) != null);
			const at = previous != null ? marble.hits.findIndex((item) => item.id === previous.id) : -1;
			last = Math.max(last, at - 1);
			if (last === -2) last = -1;
		}
		if (last > -2 && marble.hits.slice(last + 1).some((hit) => linkedPlatform(after, marble.id, hit.id) != null)) edits.push({ marbleId: marble.id, afterIndex: last });
		else if (hasOtherChange(before, after, marble.id)) edits.push({ marbleId: marble.id, afterIndex: marble.hits.length });
	}
	return edits;
}

function physicsOfMarble(project: TProject, marbleId: string): string {
	return project.track.pieces
		.filter((piece) => tieOf(piece)?.marbleId === marbleId)
		.map(physicsOf)
		.join();
}

/** Whether a marble's start and every hit moved by the same time, as a song does with a marble that plays only it: the same run, later */
function isWholeRunMoved(before: TMarble, after: TMarble): boolean {
	const delta = after.start.time - before.start.time;
	if (delta === 0 || before.hits.length !== after.hits.length) return false;
	if (JSON.stringify({ ...before.start, time: 0 }) !== JSON.stringify({ ...after.start, time: 0 })) return false;
	return after.hits.every((hit, index) => {
		const was = before.hits[index];
		return was?.id === hit.id && Math.abs(hit.time - was.time - delta) < 1e-5;
	});
}

/**
 * Whether anything else of the marble's run changed: a slide along a bar, a longer bar, a moved release. It leaves how the
 * marble leaves alone, so nothing has to take it up, but the rides must hold: the last bits of a number change.
 */
function hasOtherChange(before: TProject, after: TProject, marbleId: string): boolean {
	const onMarble = (project: TProject): TPiece[] =>
		project.track.pieces.filter((piece) => tieOf(piece)?.marbleId === marbleId);
	const startOf = (project: TProject): string => JSON.stringify(project.marbles.find((marble) => marble.id === marbleId)?.start);
	if (startOf(before) !== startOf(after) && before.marbles.some((marble) => marble.id === marbleId)) return true;
	const was = new Map(onMarble(before).map((piece) => [piece.id, piece]));
	const lastHit = before.marbles.find((marble) => marble.id === marbleId)?.hits.at(-1)?.id;
	return onMarble(after).some((piece) => {
		const old = was.get(piece.id);
		if (old === piece) return false;
		if (old == null) return false;
		// Past the marble's last hit nothing follows, so nothing needs to hold
		if (tieOf(piece)?.hitId === lastHit && tieOf(piece) != null) return false;
		const shapeOf = (piece: TPiece): string => {
			const { held: _held, leaves: _leaves, ...link } = { held: null, leaves: null, ...tieOf(piece) };
			return JSON.stringify([link, tieOf(piece)?.contactAt ?? 0.5, piece.angle, piece.type, piece.layout, piece.params, piece.path]);
		};
		return shapeOf(piece) !== shapeOf(old);
	});
}

/** The pieces of `project` that differ from `from`, new ones too, in project order */
export function changedPieces(from: TProject, project: TProject): TPiece[] {
	const was = new Map(from.track.pieces.map((piece) => [piece.id, piece]));
	return project.track.pieces.filter((piece) => was.get(piece.id) !== piece && JSON.stringify(was.get(piece.id)) !== JSON.stringify(piece));
}

/** The pieces of `project` as the rides of `ridden` left them, for the edit made on the project before the rides were kept */
function withSameRides(project: TProject, ridden: TProject): TProject {
	const rides = new Map(ridden.track.pieces.flatMap((piece) => (piece.ride != null ? [[piece.id, piece.ride] as const] : [])));
	return {
		...project,
		track: { ...project.track, pieces: project.track.pieces.map((piece) => {
			const ride = rides.get(piece.id);
			return ride != null && piece.ride == null ? { ...piece, ride } : piece;
		}) }
	};
}

export interface TSettleRequest {
	before: TProject;
	after: TProject;
	isQuick?: boolean;
	movedDot?: { marbleId: string; hitId: string; dot: TVec2 } | null;
}

export interface TSettleAnswer {
	/** Pieces the settled project has beyond `after`; none when there is nothing to keep */
	pieces: TPiece[];
	absorbedBy: string[];
	/** Hits that broke anyway, in time order, and the hits from which later pieces are held */
	broken: { marbleId: string; hitId: string; time: number; status: string }[];
	heldFrom: { marbleId: string; hitId: string; time: number }[];
	runs: number;
	/** For a moved dot: how far it went and how far from the asked-for spot it landed, in meters, and what fixes its spot */
	move: TMoveOutcome | null;
}

export interface TMoveOutcome {
	moved: number;
	missed: number;
	/** What sends the marble to this spot: the piece before it, or null for a marble's first note */
	fromId: string | null;
	/** The piece before it is a ride or nothing, which can't aim the marble anywhere else */
	isFixed: boolean;
}

/** What `settleEdit` needs from the run before an edit, kept while one project is edited: a drag asks at every move */
export interface TSettleBase {
	before: TProject;
	ridden: TProject;
	base: TSimulationResult;
	/** The time from which its rides are kept */
	fromTime: number;
}

export function settleBase(simulator: TSimulator, before: TProject, known: TSettleBase | null, fromTime = -Infinity): TSettleBase {
	if (known != null && known.fromTime === fromTime && (known.before === before || (known.before.id === before.id && known.before.revision === before.revision))) return known;
	const first = simulator.simulate(before);
	const ridden = withRides(before, first, fromTime);
	return { before, ridden, base: ridden === before ? first : simulator.simulate(ridden), fromTime };
}

/** The earliest time an edit reaches: the first hit whose pieces differ, on any marble. A moved dot starts at the platform before it */
export function editStart(before: TProject, after: TProject, moved?: { marbleId: string; hitId: string } | null): number {
	const hitTime = (project: TProject, link: { marbleId: string; hitId: string }): number | undefined => project.marbles.find((marble) => marble.id === link.marbleId)?.hits.find((hit) => hit.id === link.hitId)?.time;
	// A marble that starts elsewhere, is new or is gone: nothing says how early it matters, as with a tied-to-nothing piece
	const startsOf = (project: TProject): string => JSON.stringify(project.marbles.map((marble) => [marble.id, marble.start]));
	let start = startsOf(before) === startsOf(after) ? Infinity : -Infinity;
	const was = new Map(before.track.pieces.map((piece) => [piece.id, piece]));
	const seen = new Set<string>();
	const reach = (piece: TPiece, project: TProject): void => {
		const tie = tieOf(piece);
		// A tied-to-nothing piece: nothing says how early it matters, so nothing before it is known to be safe
		if (tie == null) start = -Infinity;
		else start = Math.min(start, hitTime(project, tie) ?? -Infinity);
	};
	for (const piece of after.track.pieces) {
		seen.add(piece.id);
		const old = was.get(piece.id);
		if (old === piece) continue;
		if (old == null) reach(piece, after);
		else if (physicsOf(old) !== physicsOf(piece)) {
			reach(old, before);
			reach(piece, after);
		}
	}
	for (const piece of before.track.pieces) if (!seen.has(piece.id)) reach(piece, before);
	for (const marble of after.marbles) {
		const old = before.marbles.find((item) => item.id === marble.id);
		for (const hit of marble.hits) {
			const oldHit = old?.hits.find((item) => item.id === hit.id);
			if (oldHit?.time !== hit.time) start = Math.min(start, hit.time, oldHit?.time ?? Infinity);
		}
	}
	if (moved != null) {
		const marble = after.marbles.find((item) => item.id === moved.marbleId);
		const index = marble?.hits.findIndex((hit) => hit.id === moved.hitId) ?? -1;
		start = Math.min(start, marble?.hits[index - 1]?.time ?? -Infinity);
	}
	return start === Infinity ? -Infinity : start;
}

export function answerSettle(simulator: TSimulator, request: TSettleRequest, known: TSettleBase | null): { answer: TSettleAnswer; memo: TSettleBase } {
	const memo = settleBase(simulator, request.before, known, editStart(request.before, request.after, request.movedDot));
	const after = withSameRides(request.after, memo.ridden);
	const edits = marbleEdits(request.before, request.after);
	const moved = request.movedDot;
	if (moved != null) {
		const marble = after.marbles.find((item) => item.id === moved.marbleId);
		const index = marble?.hits.findIndex((hit) => hit.id === moved.hitId) ?? -1;
		const others = edits.filter((edit) => edit.marbleId !== moved.marbleId);
		edits.length = 0;
		edits.push(...others, { marbleId: moved.marbleId, afterIndex: index - 1, movedDot: { hitId: moved.hitId, dot: moved.dot } });
	}
	const settled = settleEdit(simulator, memo.base, after, edits, { isQuick: request.isQuick === true });
	const movedAt = moved != null ? memo.base.hits.find((hit) => hit.marbleId === moved.marbleId && hit.hitId === moved.hitId)?.dot : null;
	return {
		memo,
		answer: {
			pieces: changedPieces(request.after, settled.project),
			absorbedBy: settled.absorbedBy,
			broken: settled.broken.map((hit) => ({ marbleId: hit.marbleId, hitId: hit.hitId, time: hit.targetTime, status: hit.status })).sort((a, b) => a.time - b.time),
			heldFrom: settled.heldFrom.map((hit) => ({ marbleId: hit.marbleId, hitId: hit.hitId, time: hit.targetTime })),
			runs: settled.runs,
			move: moved != null && movedAt != null ? moveOutcome(after, moved, Math.hypot(moved.dot.x - movedAt.x, moved.dot.y - movedAt.y), settled.moveMiss ?? 0) : null
		}
	};
}

function moveOutcome(project: TProject, moved: { marbleId: string; hitId: string }, asked: number, missed: number): TMoveOutcome {
	const marble = project.marbles.find((item) => item.id === moved.marbleId);
	const previous = marble?.hits[(marble.hits.findIndex((hit) => hit.id === moved.hitId) ?? 0) - 1];
	const before = previous != null ? project.track.pieces.filter((piece) => tieOf(piece)?.marbleId === moved.marbleId && tieOf(piece)?.hitId === previous.id) : [];
	// A ride after the note decides where the marble comes off, so that piece is the one to name
	const from = before.find((piece) => hasRide(piece.type ?? '')) ?? before[0];
	const isFixed = previous == null || linkedPlatform(project, moved.marbleId, previous.id) == null || launchesRide(project, moved.marbleId, previous.id);
	return { moved: Math.max(0, asked - missed), missed, fromId: from?.id ?? null, isFixed };
}

// MARK: - Back from a break

/**
 * The marble brought back to the pieces waiting for it: the platform before the first broken hit, or the one before
 * that, aims at its spot and the broken hit's platform sends the marble on as it did. Null when no way plays every hit.
 */
export function reconnect(simulator: TSimulator, project: TProject): { pieces: TPiece[] } | null {
	const run = simulator.simulate(project);
	let next = project;
	for (const marble of project.marbles) {
		const waiting = project.track.pieces.some((piece) => tieOf(piece)?.marbleId === marble.id && tieOf(piece)?.held != null);
		if (!waiting) continue;
		const first = run.hits.filter((hit) => hit.marbleId === marble.id && isBroken(hit)).sort((a, b) => a.targetTime - b.targetTime)[0];
		if (first == null) {
			// The marble is back already, by a later edit
			next = release(next, marble.id);
			continue;
		}
		const index = marble.hits.findIndex((hit) => hit.id === first.hitId);
		let solved: TProject | null = null;
		// The platforms before the break take aim from their own run, whose targets the hold doesn't change
		for (const back of [1, 2, 3]) {
			if (index - back < 0) break;
			const steps = planSteps(next, run, { marbleId: marble.id, afterIndex: index - back - 1 }, { skip: 0, restore: back - 1 });
			if (steps == null || !steps.length) continue;
			let trial = next;
			for (const step of steps) trial = solveStep(simulator, trial, marble.id, step, () => undefined);
			const released = release(trial, marble.id);
			const judged = simulator.simulate(released);
			if (!judged.hits.some((hit) => hit.marbleId === marble.id && (isBroken(hit) || hit.status === 'waiting'))) {
				solved = released;
				break;
			}
		}
		if (solved == null) return null;
		next = solved;
	}
	return next === project ? null : { pieces: changedPieces(project, next) };
}

/** A marble's pieces follow the marble again */
export function release(project: TProject, marbleId?: string): TProject {
	return {
		...project,
		track: { ...project.track, pieces: project.track.pieces.map((piece) => {
			const link = tieOf(piece);
			if (link?.held == null || (marbleId != null && link.marbleId !== marbleId)) return piece;
			const { held: _, ...kept } = link;
			return { ...piece, place: kept };
		}) }
	};
}
