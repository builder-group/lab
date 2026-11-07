import type { TPiece, TProject, TVec2 } from '@/modules/project';
import { gravityOf, platformDefinition, createLinkedPiece, type TSimulator, type TMarbleSample, type TSimulationResult } from '@/modules/simulation';
import { bounceTakeoff, rollingHits } from '../track-problems';
import type { TPatternLeaving, TPatternMoment } from './contract';

// Zigzag and Staircase: decide the shape first, then solve each bar's tilt, and optionally its bounce, against the real
// simulator. Promoted from the Patterns experiment (`.local/patterns/zigzag.mts`).

const DEGREE = Math.PI / 180;
/** A column the marble lands within this of is reached; the fast path aims for 1 mm */
const COLUMN_CLOSE = 0.003;
/** Further off a column than this reads on the wall, so it is a problem */
export const COLUMN_PROBLEM = 0.01;

/** Physics runs one bar may take before it settles for its best: past this more scanning rarely finds a shape */
const BAR_TRIALS = 240;

/** Air kept under the bar above a landing: its inner end tilts down a little */
const CLEARING_MARGIN = 0.005;
/** The share of its landing speed a marble is asked to keep: a bounce this high still clears, with room for the solver */
const KEPT_SPEED = 0.85;

export const BAR_LENGTH = 0.03;
/**
 * A Zigzag's Width unless asked: about a film-view bar, the reference's spacing. On the reference's 58 hits and Jingle
 * Bells it leaves fewer problems than 14 cm at Gravity 0.5 and 1; below 8 cm hops start to miss their columns.
 */
export const ZIGZAG_WIDTH = 0.1;
const BAR_THICKNESS = 0.012;
/** The steepest a bar tilts unless asked otherwise */
export const MAX_TILT = 40;

export interface TBarShape {
	kind: 'zigzag' | 'staircase';
	/** Bar centers apart (Zigzag) or sideways per hit (Staircase), in meters */
	width: number;
	/** Strike this far from the bar's center toward where it flies next, in meters */
	strike: number;
	/** Fixed bounce per bar; the seed when `drop` is set */
	bounce: number;
	/** When set, a bounce per bar too, aiming for this wall drop per hit */
	drop?: number;
	barLength?: number;
	/** How far the bars stand out of the wall: their look only, the run doesn't change with it */
	barDepth?: number;
	maxTilt?: number;
	/** Staircase direction, Zigzag's first side when no arrival motion decides */
	dir?: number;
	/** Fixed column center instead of the arrival's */
	center?: number;
	minTakeoff?: number;
	/** The last bar sends the marble toward this x, where a following rail should start */
	exitToFrame?: number;
	/** The last id is the next Pattern's first hit: aim there, place nothing on it */
	stopBefore?: boolean;
	/** Where the marble must be at the last id, so what follows can stay where it stands */
	endAt?: TVec2;
	/** How the last bar sends the marble on when no next id says: as the bar it replaces did */
	leaveLike?: TPatternLeaving;
	/** Stop at the first bar that can't play: nothing after it can apply, so a refusal comes sooner. A ghost goes on, to show the shape */
	stopsAtBadBar?: boolean;
}

export interface TBar {
	hitId: string;
	/** Seconds to the next hit; the 0.3 s it is given when it is the last */
	hop: number;
	angle: number;
	bounce: number;
	contactAt: number;
	errX: number;
	errY: number;
	trials: number;
	why: TBarIssue[];
}

export type TBarIssue = 'late' | 'resting' | 'restrike' | 'stray' | 'rolls';

export interface TBarsFit {
	project: TProject;
	pieces: TPiece[];
	bars: TBar[];
	sims: number;
	center: number;
}

interface TVelocity {
	x: number;
	y: number;
}

interface TTrial {
	piece: TPiece;
	project: TProject;
	result: TSimulationResult;
	x: number;
	y: number;
	angle: number;
	bounce: number;
	contactAt: number;
	errX: number;
	errY: number;
	why: TBarIssue[];
}

export function fitBars(sim: TSimulator, base: TProject, marbleId: string, hitIds: string[], firstArrival: TPatternMoment, shape: TBarShape, onBar?: (done: number, total: number) => void): TBarsFit {
	const gravity = Math.abs(gravityOf(base));
	const marble = base.marbles.find((item) => item.id === marbleId);
	if (marble == null) throw new Error(`Marble ${marbleId} does not exist`);
	const times = new Map(marble.hits.map((hit) => [hit.id, hit.time]));
	const length = shape.barLength ?? BAR_LENGTH;
	const maxTilt = (shape.maxTilt ?? MAX_TILT) * DEGREE;
	const isFollowing = shape.endAt != null || shape.leaveLike != null;
	const scanTilt = Math.floor((shape.maxTilt ?? MAX_TILT) / 4) * 4;
	let sims = 0;
	const run = (next: TProject, until: number): TSimulationResult => {
		sims++;
		return sim.simulate({ ...next, length: until });
	};
	let project = base;
	const bars: TBar[] = [];
	const pieces: TPiece[] = [];
	let result: TSimulationResult;
	const arrival = (time: number): TMarbleSample | null => sampleAt(result.marbles.find((marble) => marble.marbleId === marbleId)?.samples ?? [], time - 1e-6);
	const firstDot = firstArrival.position;

	// Sides. Zigzag: a marble moving right lands in the right column
	const firstSide = shape.dir ?? (Math.abs(firstArrival.velocity.x) > 0.02 ? Math.sign(firstArrival.velocity.x) : 1);
	const sideOf = (index: number): number => (shape.kind === 'zigzag' ? (index % 2 === 0 ? firstSide : -firstSide) : firstSide);
	const span = shape.width - 2 * shape.strike;
	const center = shape.center ?? (shape.kind === 'zigzag' ? firstDot.x - (sideOf(0) * span) / 2 : firstDot.x);
	const dotX = (index: number): number => (shape.kind === 'zigzag' ? center + (sideOf(index) * span) / 2 : center + index * firstSide * shape.width);
	const total = shape.stopBefore === true ? hitIds.length - 1 : hitIds.length;
	const radius = base.marbles.find((item) => item.id === marbleId)?.radius ?? 0.012;
	const heights: number[] = [];
	const planned = shape.drop != null ? plannedDrops(gravity, hitIds.slice(1).map((id, index) => (times.get(id) as number) - (times.get(hitIds[index] as string) as number)), shape.drop, Math.abs(firstArrival.velocity.y)) : [];

	for (let index = 0; index < total; index++) {
		const id = hitIds[index] as string;
		const time = times.get(id) as number;
		const nextId = hitIds[index + 1];
		const leave = nextId == null ? shape.leaveLike : undefined;
		const nextTime = nextId != null ? (times.get(nextId) as number) : time + (leave?.after ?? 0.3);
		const hop = nextTime - time;
		result = run(project, time + 0.03);
		const here = result.hits.find((hit) => hit.hitId === id);
		const sample = arrival(time);
		const dot = here?.dot ?? sample?.position ?? firstDot;
		heights.push(dot.y);
		const incoming: TVelocity = sample?.velocity ?? { x: 0, y: -1 };
		const toward = nextId == null && shape.exitToFrame != null ? Math.sign(shape.exitToFrame - dot.x) || 1 : shape.kind === 'zigzag' ? -sideOf(index) : firstSide;
		const isEnd = shape.endAt != null && nextId != null && nextId === hitIds.at(-1);
		const targetX = isEnd ? (shape.endAt?.x ?? 0) : nextId != null ? dotX(index + 1) : leave != null ? dot.x + leave.offset.x : dot.x + toward * 0.05;

		// The drop aimed for stays small enough for a real bounce: the takeoff the rule asks, with a little to spare
		const sideways = Math.abs(((nextId != null ? targetX : dot.x) - dot.x) / hop);
		const guess = Math.atan2(sideways + Math.abs(incoming.x), Math.max(0.3, Math.abs(incoming.y) + 0.35));
		const minUp = Math.max(0.12, ((shape.minTakeoff ?? 1.1 * bounceTakeoff(radius, gravity)) - sideways * Math.sin(guess)) / Math.cos(guess));
		const mostDrop = (gravity * hop * hop) / 2 - minUp * hop;
		const above = shape.kind === 'zigzag' && index > 0 && nextId != null ? (heights[index - 1] as number) - dot.y : null;
		const clearing = above != null ? clearingDrop(gravity, hop, Math.abs(span), length / 2 - shape.strike + radius, radius, above) : 0;
		const dropHere = shape.drop != null ? Math.max(0.02, Math.min(Math.max(planned[index] ?? shape.drop, clearing), mostDrop)) : null;
		const targetY = isEnd ? (shape.endAt?.y ?? 0) : leave != null ? dot.y + leave.offset.y : dropHere != null ? dot.y - dropHere : null;
		const want = { x: (targetX - dot.x) / hop, y: ((targetY ?? dot.y - 0.05) - dot.y + (gravity * hop * hop) / 2) / hop };

		// Seed: the normal lies along the change in velocity
		const change = { x: want.x - incoming.x, y: want.y - incoming.y };
		let angle = clamp(Math.atan2(-change.x, change.y), -maxTilt, maxTilt);
		const seedNormal = normalOf(angle);
		let bounce = dropHere != null ? clamp(-(want.x * seedNormal.x + want.y * seedNormal.y) / (incoming.x * seedNormal.x + incoming.y * seedNormal.y), 0.1, 0.95) : shape.bounce;
		const bounceSeed = bounce;
		const strikeAt = 0.5 + (toward * shape.strike) / length; // contactAt grows toward +x
		let trials = 0;
		const found: { best: TTrial | null } = { best: null };

		const cleanOf = (trial: Pick<TTrial, 'piece' | 'project' | 'result'>): TBarIssue[] => {
			const out: TBarIssue[] = [];
			const hit = trial.result.hits.find((item) => item.hitId === id);
			if (hit?.status !== 'onTime' && hit?.status !== 'drifting') out.push(hit?.reason === 'resting' ? 'resting' : 'late');
			for (const contact of trial.result.contacts) {
				if (contact.kind !== 'piece' || contact.marbleId !== marbleId || contact.time > nextTime - 0.004) continue;
				if (contact.otherId === trial.piece.id) {
					if (contact.time > time + 0.03) {
						out.push('restrike');
						break;
					}
					continue;
				}
				if (contact.time > time + 0.004 && project.track.pieces.find((item) => item.id === contact.otherId)?.type === 'platform') {
					out.push('stray');
					break;
				}
			}
			if (nextId != null && rollingHits(trial.project, trial.result).some((item) => item.hitId === id)) out.push('rolls');
			return out;
		};

		/** One real run; a restrike first moves the strike toward the end flown to, which leaves the flight alone */
		const trial = (tryAngle: number, tryBounce: number): TTrial => {
			let out: TTrial | null = null;
			for (const shift of [0, 0.012, 0.02, 0.028]) {
				const contactAt = clamp(strikeAt + (toward * shift) / length, 0.05, 0.95);
				const piece = barPiece(marbleId, id, tryAngle, tryBounce, contactAt, length, shape.barDepth);
				const next = withPiece(project, piece);
				const trialResult = run(next, nextTime + 0.03);
				trials++;
				const nextHit = nextId != null ? trialResult.hits.find((hit) => hit.hitId === nextId) : null;
				const samples = trialResult.marbles.find((marble) => marble.marbleId === marbleId)?.samples ?? [];
				const position = nextHit?.dot ?? sampleAt(samples, nextTime - 1e-6)?.position ?? dot;
				const why = cleanOf({ piece, project: next, result: trialResult });
				out = { piece, project: next, result: trialResult, x: position.x, y: position.y, angle: tryAngle, bounce: tryBounce, contactAt, errX: targetX - position.x, errY: targetY != null ? targetY - position.y : 0, why };
				if (!why.includes('restrike')) break;
			}
			return out as TTrial;
		};
		const score = (item: TTrial): number => (item.why.length > 0 ? 10 : 0) + Math.abs(item.errX) * 20 + Math.abs(item.errY) * 2;
		const isGood = (item: TTrial): boolean => !item.why.length && Math.abs(item.errX) < 0.001 && (targetY == null || Math.abs(item.errY) < 0.005 || (item.bounce <= 0.1 && item.errY < 0) || (item.bounce >= 0.95 && item.errY > 0));
		// Following a track, held for the column and the drop: not worth a scan that may trade the drop for the last millimeters
		const isCloseEnough = (item: TTrial): boolean => isFollowing && !item.why.length && Math.abs(item.errX) < 0.002 && (targetY == null || Math.abs(item.errY) < 0.01);
		const keep = (item: TTrial): void => {
			if (found.best == null || score(item) < score(found.best)) found.best = item;
		};

		// Fast path: the bounce model as a Jacobian, the simulator as the truth
		let lastErrX = 0;
		let settling = 1;
		for (let step = 0; step < 6 && (nextId != null || leave != null); step++) {
			const item = trial(angle, bounce);
			keep(item);
			if (isGood(item)) break;
			// The model is only a guess at the slope: following a track, a step that overshoots halves those after it
			if (isFollowing && item.errX * lastErrX < 0) settling /= 2;
			lastErrX = item.errX;
			const dvx = item.errX / hop;
			const dvy = item.errY / hop;
			const small = 0.2 * DEGREE;
			const m0 = bounceModel(incoming, angle, bounce);
			const ma = bounceModel(incoming, angle + small, bounce);
			const me = bounceModel(incoming, angle, bounce + 0.01);
			const jxa = (ma.x - m0.x) / small;
			const jya = (ma.y - m0.y) / small;
			const jxe = (me.x - m0.x) / 0.01;
			const jye = (me.y - m0.y) / 0.01;
			let da: number;
			let de = 0;
			if (targetY != null && !(bounce <= 0.1 && dvy < 0) && !(bounce >= 0.95 && dvy > 0)) {
				const determinant = jxa * jye - jya * jxe;
				da = (dvx * jye - dvy * jxe) / determinant;
				de = (jxa * dvy - jya * dvx) / determinant;
			} else da = dvx / (Math.abs(jxa) > 1e-3 ? jxa : 1e-3);
			angle = clamp(angle + clamp(da * settling, -12 * DEGREE, 12 * DEGREE), -maxTilt, maxTilt);
			bounce = clamp(bounce + clamp(de, -0.25, 0.25), 0.1, 0.95);
		}

		if (nextId == null) {
			// A last bar has no column to reach, but the marble must still leave it once
			let last = found.best ?? trial(angle, bounce);
			outer: for (const de of [0, 0.1, 0.2, 0.3, 0.4]) {
				for (const da of [0, 6, -6, 12, -12, 18, -18]) {
					if (!last.why.length) break outer;
					const item = trial(clamp(angle + da * DEGREE, -maxTilt, maxTilt), Math.min(0.95, bounce + de));
					if (item.why.length < last.why.length) last = item;
				}
			}
			found.best = last;
		}

		// Slow path: tilt scan with the bounce held, then bisection between clean trials on either side of the column
		if (nextId != null && (found.best == null || (!isGood(found.best) && !isCloseEnough(found.best)))) {
			const seeds = shape.drop != null ? [0, 0.1, -0.1, 0.2, -0.2, 0.3].map((d) => bounceSeed + d) : [0, 0.08, 0.16, -0.08, 0.24, -0.16].map((d) => shape.bounce + d);
			// Each bounce has its own root, and the one nearest the drop aimed for wins: the first found can fall many times further
			let solved: TTrial | null = null;
			for (const seed of seeds.map((item) => clamp(item, 0.1, 0.95))) {
				if (trials >= BAR_TRIALS) break;
				let previous: TTrial | null = null;
				const roots: TTrial[] = [];
				for (let step = -scanTilt; step <= scanTilt && trials < BAR_TRIALS; step += 4) {
					const item = trial(step * DEGREE, seed);
					keep(item);
					if (previous != null && !previous.why.length && !item.why.length && previous.errX * item.errX <= 0) {
						let low: TTrial = previous;
						let high: TTrial = item;
						for (let round = 0; round < 8; round++) {
							const weight = low.errX / (low.errX - high.errX);
							const middle = trial(low.angle + (high.angle - low.angle) * clamp(weight, 0.1, 0.9), seed);
							keep(middle);
							if (Math.abs(middle.errX) < 0.001) {
								low = middle;
								high = middle;
								break;
							}
							if (middle.why.length > 0) break;
							if (low.errX * middle.errX <= 0) high = middle;
							else low = middle;
						}
						const root = Math.abs(low.errX) < Math.abs(high.errX) ? low : high;
						if (Math.abs(root.errX) < 0.002 && !root.why.length) roots.push(root);
					}
					previous = item;
				}
				if (roots.length > 0) {
					roots.sort((a, b) => Math.abs(a.errY) - Math.abs(b.errY) || Math.abs(a.angle) - Math.abs(b.angle));
					const root = roots[0] as TTrial;
					if (solved == null || Math.abs(root.errY) < Math.abs(solved.errY)) solved = root;
					if (targetY == null || Math.abs(root.errY) < 0.02) break;
				}
			}
			if (solved != null) found.best = solved;
		}

		const chosen = found.best as TTrial;
		pieces.push(chosen.piece);
		project = chosen.project;
		result = chosen.result;
		bars.push({ hitId: id, hop, angle: chosen.angle, bounce: chosen.bounce, contactAt: chosen.contactAt, errX: chosen.errX, errY: chosen.errY, trials, why: chosen.why });
		onBar?.(index + 1, total);
		if (shape.stopsAtBadBar === true && chosen.why.length > 0) break;
	}
	return { project, pieces, bars, sims, center };
}

/**
 * The drop to aim for on each hop. A marble can't leave a bar faster than it landed, and a hop's length sets its takeoff,
 * so a longer hop after a shorter one must be paid for by falling: about g(T² - t²) / 8, whatever the Width or Bounce. Left
 * alone the long hop pays it all at once; this shares it with the hop before, which keeps the largest drop down.
 */
function plannedDrops(gravity: number, hops: readonly number[], drop: number, arrival: number): number[] {
	const drops = hops.map(() => drop);
	for (let sweep = 0; sweep < 8; sweep++) {
		hops.forEach((hop, index) => {
			const before = hops[index - 1];
			const landing = before != null ? (gravity * before) / 2 + (drops[index - 1] as number) / before : arrival;
			const short = (gravity * hop) / 2 - (drops[index] as number) / hop - KEPT_SPEED * landing;
			if (short <= 0) return;
			const raise = short / (1 / hop + (before != null ? KEPT_SPEED / before : 0));
			drops[index] = (drops[index] as number) + raise;
			if (before != null) drops[index - 1] = (drops[index - 1] as number) + raise;
		});
	}
	return drops;
}

/**
 * The least drop on a Zigzag hop that lands under the bar two hits back, which hangs right above the one landed on. A slow
 * hop comes down almost straight, so it is still high when it reaches that bar's inner end: `reach` from where it lands.
 * Aimed for from the start, since a stray strike otherwise ends on whatever low bounce clears it, many times further down.
 */
function clearingDrop(gravity: number, hop: number, span: number, reach: number, radius: number, above: number): number {
	const before = Math.min((reach * hop) / Math.max(span, 1e-3), hop / 2);
	let drop = 0;
	// Landing faster with more drop, which two rounds settle
	for (let round = 0; round < 2; round++) drop = Math.max(0, BAR_THICKNESS + 2 * radius + CLEARING_MARGIN + ((gravity * hop) / 2 + drop / hop) * before - (gravity * before * before) / 2 - above);
	return drop;
}

/** The column shape counts as held for a bar within this */
export function isOffColumn(bar: TBar): boolean {
	return Math.abs(bar.errX) > COLUMN_CLOSE;
}

function barPiece(marbleId: string, hitId: string, angle: number, bounce: number, contactAt: number, length: number, depth = platformDefinition.params['depth']?.default ?? 0.09): TPiece {
	const piece = createLinkedPiece('platform', marbleId, hitId, angle, { id: `bar-${hitId}`, contactAt });
	return { ...piece, params: { length, thickness: BAR_THICKNESS, depth, bounce, entryDelay: 0 } };
}

/** The project with this piece in place of its old self, without the checks of a command: the solver's trials stay fast */
export function withPiece(project: TProject, piece: TPiece): TProject {
	const index = project.track.pieces.findIndex((item) => item.id === piece.id);
	if (index < 0) return { ...project, track: { ...project.track, pieces: [...project.track.pieces, piece] } };
	const pieces = [...project.track.pieces];
	pieces[index] = piece;
	return { ...project, track: { ...project.track, pieces } };
}

/** Rough bounce: restitution on the normal, friction limited loss on the tangent. Only a guess and a Jacobian; the simulator decides */
function bounceModel(incoming: TVelocity, angle: number, bounce: number): TVelocity {
	const tangent = { x: Math.cos(angle), y: Math.sin(angle) };
	const normal = normalOf(angle);
	const along = incoming.x * tangent.x + incoming.y * tangent.y;
	const across = incoming.x * normal.x + incoming.y * normal.y;
	const impulse = Math.min(0.3 * (1 + bounce) * Math.abs(across), (2 / 7) * Math.abs(along));
	const nextAlong = along - Math.sign(along) * impulse;
	const nextAcross = -bounce * across;
	return { x: nextAlong * tangent.x + nextAcross * normal.x, y: nextAlong * tangent.y + nextAcross * normal.y };
}

function normalOf(angle: number): TVelocity {
	return { x: -Math.sin(angle), y: Math.cos(angle) };
}

function clamp(value: number, low: number, high: number): number {
	return Math.max(low, Math.min(high, value));
}

export function sampleAt(samples: TMarbleSample[], time: number): TMarbleSample | null {
	if (!samples.length) return null;
	let low = 0;
	let high = samples.length - 1;
	while (low < high) {
		const middle = (low + high + 1) >> 1;
		if ((samples[middle] as TMarbleSample).time <= time) low = middle;
		else high = middle - 1;
	}
	return samples[low] as TMarbleSample;
}
