import { type THandOver, type TMarble, type TPiece, type TProject, type TProjectCommand, type TVec2, tieOf } from '@/modules/project';
import { ballistic, gravityOf, bandAlongGuide, getPieceDefinition, soundsHit, handOversOf, SEAM_SPEED, type TBodyState, type TMarbleWalk, type TSimulator, type TWalk, type TWalkHop, hasRide, PHYSICS_HZ } from '@/modules/simulation';

// What an edit does to the run. A hop stands alone from its hand-over, so an edit runs only the hops it reaches. Where the
// marble then lands differs from the next stored hand-over, and the next bar takes that up: its tilt and bounce are two
// numbers for the two numbers of a velocity, so it sends the marble on with the stored velocity, by a reflection first and one
// or two hop runs to check. The later hops stay stored and shift together, an exact symmetry since they keep their own world's
// coordinates. A shift that would collide or leave the frame takes two bars instead, and nothing later moves. A bar that can't
// restore the velocity releases the marble: it flies on for real and later notes wait, with their hand-overs kept, so moving
// what's in the way or Undo brings every note back at once.

const STEP_TIME = 1 / PHYSICS_HZ;
/** Tries of a bar's tilt and bounce. The reflection leaves friction out, which a try measures */
const BAR_TRIES = 3;
/** A velocity this near needs no more tries */
const SOLVED_SPEED = 0.005;
/** A velocity this near at a hand-over shows no seam; further off the next bar takes it up */
const ABSORBED_SPEED = 0.02;
/** A landing this near a hand-over isn't worth moving the later hops for */
const ABSORBED_DISTANCE = 2e-5;
/** A bar may turn this far from what it was, or stand this steep */
const TILT_LIMIT = 40 * (Math.PI / 180);
/** Bars the rule tries in one edit before it releases the marble */
const MAX_TAKERS = 4;
/** Steps after a bounce at which a hop with a rail is compared, before the rail */
const EARLY_STEPS = 6;
/** A dot this near is where it was asked for */
const DOT_LANDED = 1e-3;
const DOT_TRIES = 3;
/** The way with two bars has to land this near the next bar's old spot: the next bar and a small shift take up the rest */
const TWO_BAR_MISS = 0.02;

export interface TEditRequest {
	before: TProject;
	after: TProject;
	/** A dragged platform's new dot: the platform before it aims there */
	movedDot?: { marbleId: string; hitId: string; dot: TVec2 } | null;
	/** Bars the rule may use, for a fixture rebuilt over a whole song */
	maxTakers?: number;
	/** A rebuild: each bar restores what its own hop should land with, rather than the next bar */
	isOwnBar?: boolean;
}

export interface TEditAnswer {
	/** Pieces the edit changed besides what was asked, new values in */
	pieces: TPiece[];
	/** What the marbles keep: new hand-overs, and from which hit they wait */
	marbles: { marbleId: string; handOvers: THandOver[]; waitsFrom: string | null }[];
	/** Ids of the bars that took up the change, in the order they did */
	absorbedBy: string[];
	/** How far the later hops moved, in meters, per marble that moved */
	shifts: { marbleId: string; distance: number }[];
	/** Hits from which a marble flies free and later pieces wait */
	heldFrom: { marbleId: string; hitId: string; time: number }[];
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

interface TChain {
	marbleId: string;
	index: number;
	handOvers: THandOver[];
	/** As they were before the edit */
	original: THandOver[];
	waitsFrom: string | null;
	/** The bar values the stored hops ran with */
	stored: Map<number, { angle: number; bounce: number; hop: TWalkHop | null }>;
}

/** The first place a marble doesn't land where its stored hand-over has it */
interface TDeviation {
	chain: TChain;
	walker: TMarbleWalk;
	/** The hop that starts at the hand-over */
	step: number;
	landed: TBodyState;
	origin: TVec2;
	distance: number;
	speed: number;
}

export function answerEdit(simulator: TSimulator, request: TEditRequest): TEditAnswer {
	const { before, after, movedDot } = request;
	const maxTakers = request.maxTakers ?? MAX_TAKERS;
	const base = simulator.walk(before);
	const chains = before.marbles.flatMap((marble, index) => {
		const now = after.marbles.find((item) => item.id === marble.id);
		// The same run later keeps its own hand-overs, as moving a song left them
		if (now == null || isWholeRunMoved(marble, now)) return [];
		const handOvers = chainOf(before, base, index);
		const chain: TChain = { marbleId: marble.id, index: after.marbles.indexOf(now), handOvers, original: handOvers, waitsFrom: null, stored: storedBars(before, base, index, marble.id) };
		return [chain];
	});
	const state: TEditState = { project: withChains(after, chains), chains, absorbedBy: [], heldFrom: [], touched: new Set(), shifted: new Map(), first: null, hasCollided: false, edited: new Set(changedPieces(before, after).map((piece) => piece.id)) };
	const g = gravityOf(state.project);
	let move: TMoveOutcome | null = null;

	// A dragged dot: the bar before it aims there, and the dragged bar takes up the rest like any other
	if (movedDot != null) {
		const chain = chains.find((item) => item.marbleId === movedDot.marbleId);
		const aimed = chain != null ? aimAtDot(simulator, state.project, chain, movedDot, g) : null;
		if (aimed != null) {
			state.project = aimed.project;
			move = aimed.move;
			if (aimed.takerId != null) {
				state.absorbedBy.push(aimed.takerId);
				state.touched.add(movedDot.marbleId);
			}
		}
	}
	absorbAll(simulator, state, maxTakers, g, request.isOwnBar === true);
	const chosen = withTwoBarsIfNeeded(simulator, state, before, maxTakers, g);
	const answer: TEditAnswer = { pieces: [], marbles: [], absorbedBy: chosen.absorbedBy, shifts: [], heldFrom: chosen.heldFrom, move };
	for (const marble of before.marbles) if (marble.waitsFrom != null) chosen.touched.add(marble.id);
	if (!chosen.touched.size) return answer;
	answer.pieces = changedPieces(after, chosen.project);
	for (const chain of chosen.chains) {
		if (!chosen.touched.has(chain.marbleId)) continue;
		answer.marbles.push({ marbleId: chain.marbleId, handOvers: chain.handOvers, waitsFrom: chain.waitsFrom });
		const offset = chosen.shifted.get(chain.marbleId);
		if (offset != null) answer.shifts.push({ marbleId: chain.marbleId, distance: Math.hypot(offset.x, offset.y) });
	}
	return answer;
}

function isWholeRunMoved(before: TMarble, after: TMarble): boolean {
	const delta = after.start.time - before.start.time;
	if (delta === 0 || before.hits.length !== after.hits.length) return false;
	return after.hits.every((hit, index) => before.hits[index]?.id === hit.id && Math.abs(hit.time - (before.hits[index]?.time ?? 0) - delta) < 1e-5);
}

/** What a marble's run went through. Past where it waits, what it would go through: the stored hand-overs that wait for it */
function chainOf(project: TProject, walk: TWalk, index: number): THandOver[] {
	const marble = project.marbles[index];
	const handOvers = handOversOf(walk, index);
	const waits = marble?.hits.find((hit) => hit.id === marble.waitsFrom);
	if (marble == null || waits == null) return handOvers;
	const from = stepOf(waits.time);
	return [...handOvers.filter((handOver) => handOver.step < from), ...(marble.handOvers ?? []).filter((handOver) => handOver.step >= from)];
}

interface TEditState {
	project: TProject;
	chains: TChain[];
	absorbedBy: string[];
	heldFrom: TEditAnswer['heldFrom'];
	touched: Set<string>;
	shifted: Map<string, TVec2>;
	/** The edit as it stood when its first bar came, for the way with two */
	first: { state: TEditState; marbleId: string; step: number; laterStep: number } | null;
	/** A later hop stopped landing where it should once the rest moved */
	hasCollided: boolean;
	/** Pieces the person changed, which the rule doesn't turn back */
	edited: Set<string>;
}

function cloneState(state: TEditState): TEditState {
	return {
		...state,
		chains: state.chains.map((chain) => ({ ...chain })),
		absorbedBy: [...state.absorbedBy],
		heldFrom: [...state.heldFrom],
		touched: new Set(state.touched),
		shifted: new Map(state.shifted),
		first: null
	};
}

/** Every deviation in turn, earliest first: the velocity to the next bar, the rest as a shift of what comes later */
function absorbAll(simulator: TSimulator, state: TEditState, maxTakers: number, g: number, isOwnBar = false): void {
	let takers = 0;
	for (let guard = 0; guard < maxTakers * 4 + 8; guard++) {
		const deviation = firstDeviation(simulator.walk(state.project, undefined, true), state.chains);
		if (deviation == null) return;
		const { chain, step } = deviation;
		state.touched.add(chain.marbleId);
		const later = chain.handOvers.find((handOver) => handOver.step > step);
		if (deviation.speed <= ABSORBED_SPEED) {
			shiftFrom(state, chain, step, { x: deviation.landed.x + deviation.origin.x - wallX(chain, step), y: deviation.landed.y + deviation.origin.y - wallY(chain, step) });
			state.project = withChains(state.project, state.chains);
			continue;
		}
		if (later == null) {
			// Nothing after it to keep
			chain.handOvers = chain.handOvers.filter((item) => item.step < step);
			state.project = withChains(state.project, state.chains);
			continue;
		}
		// A bar the person changed has no stored run to come back on: the hop after it runs from where the marble lands
		const edited = takerAt(state.project, chain, step);
		if (edited != null && state.edited.has(edited.id)) {
			chain.handOvers = chain.handOvers.filter((item) => item.step !== step);
			state.project = withChains(state.project, state.chains);
			continue;
		}
		if (state.first != null && step > state.first.laterStep && state.first.marbleId === chain.marbleId) state.hasCollided = true;
		state.first ??= { state: cloneState(state), marbleId: chain.marbleId, step, laterStep: later.step };
		// A rebuild has each bar keep its own hop; an edit asks the next bar, then the one before it if a person didn't change that
		const own = ownBarDeviation(deviation);
		const ownTaker = own != null ? takerAt(state.project, chain, own.step) : null;
		const tryOwn = (): boolean => {
			const isFree = isOwnBar || (ownTaker != null && !state.edited.has(ownTaker.id));
			if (own == null || ownTaker == null || !isFree || takers >= maxTakers) return false;
			const landing = chain.handOvers.find((handOver) => handOver.step === step);
			const solved = landing != null ? solveTaker(simulator, state.project, chain, own, ownTaker, landing, g) : null;
			takers++;
			if (solved == null) return false;
			state.project = solved.project;
			state.absorbedBy.push(ownTaker.id);
			shiftFrom(state, chain, step, solved.shift);
			state.project = withChains(state.project, state.chains);
			return true;
		};
		if (isOwnBar && tryOwn()) continue;
		const taker = takerAt(state.project, chain, step);
		const solved = taker != null && takers < maxTakers ? solveTaker(simulator, state.project, chain, deviation, taker, later, g) : null;
		takers++;
		if (taker == null || solved == null) {
			if (!isOwnBar && tryOwn()) continue;
			releaseMarble(state, chain, step);
			state.project = withChains(state.project, state.chains);
			return;
		}
		state.project = solved.project;
		state.absorbedBy.push(taker.id);
		// The hop after it starts where the marble lands, in the world of the hop before
		setHandOver(chain, step, deviation);
		shiftFrom(state, chain, step + 1, solved.shift);
		state.project = withChains(state.project, state.chains);
	}
}

/** A shift that would leave the frame or run into something takes two bars, which leave everything later where it was */
function withTwoBarsIfNeeded(simulator: TSimulator, state: TEditState, before: TProject, maxTakers: number, g: number): TEditState {
	const { first } = state;
	if (first == null) return state;
	const chain = state.chains.find((item) => item.marbleId === first.marbleId);
	if (chain == null) return state;
	if (!state.hasCollided && !state.heldFrom.length && !wouldLeaveFrame(simulator, state.project, before, chain)) return state;
	const other = first.state;
	const otherChain = other.chains.find((item) => item.marbleId === first.marbleId);
	if (otherChain == null) return state;
	const deviation = firstDeviation(simulator.walk(other.project, undefined, true), other.chains);
	const marble = other.project.marbles.find((item) => item.id === first.marbleId);
	const next = marble?.hits.find((hit) => stepOf(hit.time) === first.laterStep);
	const target = otherChain.original.find((item) => item.step === first.laterStep);
	if (deviation == null || deviation.step !== first.step || next == null || target == null) return state;
	const dot = ballistic({ x: target.position.x + target.origin.x, y: target.position.y + target.origin.y }, target.velocity, Math.max(0, next.time - first.laterStep * STEP_TIME), g).position;
	const aimed = aimAtDot(simulator, other.project, otherChain, { marbleId: first.marbleId, hitId: next.id, dot }, g, true);
	if (aimed?.takerId == null || aimed.move.missed > TWO_BAR_MISS) return state;
	other.project = aimed.project;
	other.absorbedBy.push(aimed.takerId);
	other.touched.add(first.marbleId);
	setHandOver(otherChain, first.step, deviation);
	other.project = withChains(other.project, other.chains);
	absorbAll(simulator, other, maxTakers, g);
	if (other.heldFrom.length > state.heldFrom.length) return state;
	if (other.hasCollided && !state.hasCollided) return state;
	if (wouldLeaveFrame(simulator, other.project, before, otherChain) && !state.hasCollided) return state;
	return other;
}

/** The same deviation as the bar before it sees it: the hop to run again is its own */
function ownBarDeviation(deviation: TDeviation): TDeviation | null {
	const { walker, step } = deviation;
	const hop = walker.hops.find((item) => item.to === step);
	return hop != null && hop.from !== walker.hops[0]?.from ? { ...deviation, step: hop.from, landed: hop.start, origin: hop.origin } : null;
}

function wallX(chain: TChain, step: number): number {
	const handOver = chain.handOvers.find((item) => item.step === step);
	return (handOver?.position.x ?? 0) + (handOver?.origin.x ?? 0);
}

function wallY(chain: TChain, step: number): number {
	const handOver = chain.handOvers.find((item) => item.step === step);
	return (handOver?.position.y ?? 0) + (handOver?.origin.y ?? 0);
}

function withChains(project: TProject, chains: TChain[]): TProject {
	return {
		...project,
		marbles: project.marbles.map((marble) => {
			const chain = chains.find((item) => item.marbleId === marble.id);
			if (chain == null) return marble;
			const { waitsFrom: _, ...rest } = marble;
			return { ...rest, handOvers: chain.handOvers, ...(chain.waitsFrom != null ? { waitsFrom: chain.waitsFrom } : {}) };
		})
	};
}

/** The bars of a marble by the step of their note, as the stored run played them */
function storedBars(project: TProject, walk: TWalk, index: number, marbleId: string): TChain['stored'] {
	const stored: TChain['stored'] = new Map();
	const marble = project.marbles.find((item) => item.id === marbleId);
	for (const piece of project.track.pieces) {
		const tie = tieOf(piece);
		if (tie?.marbleId !== marbleId || !isBar(piece)) continue;
		const hit = marble?.hits.find((item) => item.id === tie.hitId);
		if (hit == null) continue;
		const step = stepOf(hit.time);
		stored.set(step, { angle: piece.angle, bounce: piece.params['bounce'] ?? 0.65, hop: walk.marbles[index]?.hops.find((hop) => hop.from === step) ?? null });
	}
	return stored;
}

function isBar(piece: TPiece): boolean {
	return soundsHit(piece.type, tieOf(piece)) && getPieceDefinition(piece.type)?.params['bounce'] != null;
}

function stepOf(time: number): number {
	return Math.floor(time * PHYSICS_HZ + 1e-7);
}

/** The earliest hand-over a marble doesn't land on, by more than a seam a bounce hides */
function firstDeviation(walk: TWalk, chains: TChain[]): TDeviation | null {
	let best: TDeviation | null = null;
	for (const chain of chains) {
		if (chain.waitsFrom != null) continue;
		const walker = walk.marbles[chain.index];
		if (walker == null) continue;
		const stored = new Map(chain.handOvers.map((handOver) => [handOver.step, handOver]));
		for (const previous of walker.hops) {
			const handOver = stored.get(previous.to);
			const landed = previous.record.marbles[previous.track]?.end;
			if (handOver == null || landed == null) continue;
			const distance = Math.hypot(landed.x + previous.origin.x - handOver.position.x - handOver.origin.x, landed.y + previous.origin.y - handOver.position.y - handOver.origin.y);
			const speed = Math.hypot(landed.vx - handOver.velocity.x, landed.vy - handOver.velocity.y);
			if (distance <= ABSORBED_DISTANCE && speed <= ABSORBED_SPEED) continue;
			if (best == null || previous.to < best.step) best = { chain, walker, step: previous.to, landed, origin: previous.origin, distance, speed };
			break;
		}
	}
	return best;
}

function takerAt(project: TProject, chain: TChain, step: number): TPiece | null {
	const marble = project.marbles.find((item) => item.id === chain.marbleId);
	const hit = marble?.hits.find((item) => stepOf(item.time) === step);
	if (hit == null) return null;
	return project.track.pieces.find((piece) => tieOf(piece)?.marbleId === chain.marbleId && tieOf(piece)?.hitId === hit.id && isBar(piece)) ?? null;
}

/** Tilt and bounce that turn velocity `u` into `v` by a reflection, friction left out */
function reflectionFor(u: TVec2, v: TVec2): { angle: number; bounce: number } {
	const dx = v.x - u.x;
	const dy = v.y - u.y;
	const length = Math.hypot(dx, dy) || 1e-9;
	let nx = dx / length;
	let ny = dy / length;
	const into = -(u.x * nx + u.y * ny);
	const bounce = into > 1e-6 ? (v.x * nx + v.y * ny) / into : Number.NaN;
	if (ny < 0) {
		nx = -nx;
		ny = -ny;
	}
	return { angle: Math.atan2(-nx, ny), bounce };
}

function reflect(u: TVec2, angle: number, bounce: number): TVec2 {
	const nx = -Math.sin(angle);
	const ny = Math.cos(angle);
	const into = u.x * nx + u.y * ny;
	return { x: u.x - (1 + bounce) * into * nx, y: u.y - (1 + bounce) * into * ny };
}

function withBar(project: TProject, id: string, angle: number, bounce: number): TProject {
	return { ...project, track: { ...project.track, pieces: project.track.pieces.map((piece) => (piece.id === id ? { ...piece, angle, params: { ...piece.params, bounce } } : piece)) } };
}

function withoutHandOverAt(project: TProject, marbleId: string, step: number): TProject {
	return { ...project, marbles: project.marbles.map((marble) => (marble.id === marbleId ? { ...marble, handOvers: (marble.handOvers ?? []).filter((handOver) => handOver.step !== step) } : marble)) };
}

function hopFrom(walk: TWalk, index: number, step: number): TWalkHop | null {
	return walk.marbles[index]?.hops.find((hop) => hop.from === step) ?? null;
}

function clampBar(angle: number, bounce: number, was: { angle: number }, range: { min: number; max: number }): { angle: number; bounce: number; isClamped: boolean } {
	const limit = Math.max(TILT_LIMIT, Math.abs(was.angle) + 0.1);
	const nextAngle = Math.max(Math.max(-limit, was.angle - TILT_LIMIT), Math.min(Math.min(limit, was.angle + TILT_LIMIT), angle));
	const nextBounce = Number.isNaN(bounce) ? 0.65 : Math.max(range.min, Math.min(range.max, bounce));
	return { angle: nextAngle, bounce: nextBounce, isClamped: nextAngle !== angle || nextBounce !== bounce };
}

/** The next bar's tilt and bounce that send the marble on as the stored hop did. Null when it can't within its range */
function solveTaker(simulator: TSimulator, project: TProject, chain: TChain, deviation: TDeviation, taker: TPiece, later: THandOver, g: number): { project: TProject; shift: TVec2 } | null {
	const { step, landed } = deviation;
	const spec = getPieceDefinition(taker.type)?.params['bounce'];
	const range = { min: spec?.min ?? 0.1, max: spec?.max ?? 0.95 };
	const stored = chain.stored.get(step);
	const was = { angle: stored?.angle ?? taker.angle, bounce: stored?.bounce ?? taker.params['bounce'] ?? 0.65 };
	const span = (later.step - step) * STEP_TIME;
	const arrival = { x: landed.vx, y: landed.vy };
	const storedHop = stored?.hop ?? null;
	const storedTrack = storedHop?.record.marbles[storedHop.track];
	const hasRail = hasRailAfter(project, chain, step, later.step);
	// With a rail in the hop the two are compared just after the bounce, as the rail decides the rest
	const early = hasRail && storedTrack != null ? storedTrack.samples[Math.min(EARLY_STEPS, storedTrack.samples.length - 1)] : null;
	const earlyTime = early != null ? early.time - step * STEP_TIME : 0;
	const leaves = early != null ? { x: early.velocity.x, y: early.velocity.y - g * earlyTime } : { x: later.velocity.x, y: later.velocity.y - g * span };
	const storedArrival = storedHop != null ? { x: storedHop.start.vx, y: storedHop.start.vy } : arrival;
	const plain = reflect(storedArrival, was.angle, was.bounce);
	// A reflection of the marble as it arrived before, so what friction adds to it stays out of the first try
	const want = storedHop != null ? { ...plain } : { ...leaves };
	const trial0 = withoutHandOverAt(project, chain.marbleId, step);
	let best: { angle: number; bounce: number; speed: number; end: TBodyState; origin: TVec2 } | null = null;
	for (let attempt = 0; attempt < BAR_TRIES; attempt++) {
		const reflected = reflectionFor(arrival, want);
		const { angle, bounce, isClamped } = clampBar(reflected.angle, reflected.bounce, was, range);
		const trial = withBar(trial0, taker.id, angle, bounce);
		const walk = simulator.walk(trial, later.step);
		const hop = hopFrom(walk, chain.index, step);
		const track = hop?.record.marbles[hop.track];
		const end = track?.end;
		if (hop == null || track == null || end == null) break;
		let errorX: number;
		let errorY: number;
		if (early != null) {
			const sample = track.samples[Math.min(EARLY_STEPS, track.samples.length - 1)];
			errorX = early.velocity.x - (sample?.velocity.x ?? 0);
			errorY = early.velocity.y - (sample?.velocity.y ?? 0);
		} else {
			errorX = later.velocity.x - end.vx;
			errorY = later.velocity.y - end.vy;
		}
		const speed = Math.hypot(errorX, errorY);
		if (best == null || speed < best.speed) best = { angle, bounce, speed, end, origin: hop.origin };
		if (speed < SOLVED_SPEED) break;
		// Out of range the next try gets no further
		if (isClamped && attempt > 0) break;
		want.x += errorX;
		want.y += errorY;
	}
	if (best == null || best.speed > SEAM_SPEED) return null;
	const shift = { x: best.end.x + best.origin.x - later.position.x - later.origin.x, y: best.end.y + best.origin.y - later.position.y - later.origin.y };
	return { project: withBar(project, taker.id, best.angle, best.bounce), shift };
}

function hasRailAfter(project: TProject, chain: TChain, step: number, until: number): boolean {
	const marble = project.marbles.find((item) => item.id === chain.marbleId);
	return project.track.pieces.some((piece) => {
		const tie = tieOf(piece);
		if (tie?.marbleId !== chain.marbleId || !hasRide(piece.type)) return false;
		const hit = marble?.hits.find((item) => item.id === tie.hitId);
		const at = stepOf((hit?.time ?? -1) + (piece.params['entryDelay'] ?? 0));
		return hit != null && at >= step && at < until;
	});
}

function setHandOver(chain: TChain, step: number, deviation: TDeviation): void {
	const { landed, origin } = deviation;
	const next: THandOver = { step, position: { x: landed.x, y: landed.y }, origin, velocity: { x: landed.vx, y: landed.vy }, rotation: [landed.qz, landed.qw], spin: landed.spin };
	const was = chain.handOvers.find((item) => item.step === step);
	if (was?.rotors != null) next.rotors = was.rotors;
	chain.handOvers = chain.handOvers.map((item) => (item.step === step ? next : item));
}

function shiftFrom(state: TEditState, chain: TChain, step: number, by: TVec2): void {
	if (by.x === 0 && by.y === 0) return;
	chain.handOvers = chain.handOvers.map((item) => (item.step >= step ? { ...item, origin: { x: item.origin.x + by.x, y: item.origin.y + by.y } } : item));
	const total = state.shifted.get(chain.marbleId) ?? { x: 0, y: 0 };
	state.shifted.set(chain.marbleId, { x: total.x + by.x, y: total.y + by.y });
}

function releaseMarble(state: TEditState, chain: TChain, step: number): void {
	const marble = state.project.marbles.find((item) => item.id === chain.marbleId);
	const hit = marble?.hits.find((item) => stepOf(item.time) === step);
	if (hit == null) return;
	chain.waitsFrom = hit.id;
	state.heldFrom.push({ marbleId: chain.marbleId, hitId: hit.id, time: hit.time });
}

/** The pieces of `project` that differ from `from`, new ones too, in project order */
export function changedPieces(from: TProject, project: TProject): TPiece[] {
	const was = new Map(from.track.pieces.map((piece) => [piece.id, piece]));
	return project.track.pieces.filter((piece) => was.get(piece.id) !== piece && JSON.stringify(was.get(piece.id)) !== JSON.stringify(piece));
}

/** `project` as an answer leaves it */
export function withEditAnswer(project: TProject, answer: Pick<TEditAnswer, 'pieces' | 'marbles'>): TProject {
	const pieces = new Map(answer.pieces.map((piece) => [piece.id, piece]));
	const marbles = new Map(answer.marbles.map((marble) => [marble.marbleId, marble]));
	return {
		...project,
		track: pieces.size > 0 ? { ...project.track, pieces: project.track.pieces.map((piece) => pieces.get(piece.id) ?? piece) } : project.track,
		marbles: marbles.size > 0
			? project.marbles.map((marble) => {
					const kept = marbles.get(marble.id);
					if (kept == null) return marble;
					const { waitsFrom: _, ...rest } = marble;
					return { ...rest, handOvers: kept.handOvers, ...(kept.waitsFrom != null ? { waitsFrom: kept.waitsFrom } : {}) };
				})
			: project.marbles
	};
}

/** What lands an answer in the project */
export function editCommands(answer: Pick<TEditAnswer, 'pieces' | 'marbles'>): TProjectCommand[] {
	return [
		...answer.pieces.map((piece): TProjectCommand => ({ type: 'addPiece', piece })),
		...answer.marbles.map((marble): TProjectCommand => ({ type: 'updateMarble', marbleId: marble.marbleId, patch: { handOvers: marble.handOvers, waitsFrom: marble.waitsFrom } }))
	];
}

/** `answerEdit` for what plans its edits in a run of its own, such as a Pattern's check */
export function answerSettle(simulator: TSimulator, request: TEditRequest, _known: null): { answer: TEditAnswer } {
	return { answer: answerEdit(simulator, request) };
}

/** Marbles that wait go back on their stored run, when something now lets them. Null when one still can't */
export function reconnect(simulator: TSimulator, project: TProject): Pick<TEditAnswer, 'pieces' | 'marbles'> | null {
	if (!project.marbles.some((marble) => marble.waitsFrom != null)) return null;
	const answer = answerEdit(simulator, { before: project, after: project, maxTakers: MAX_TAKERS * 2 });
	return answer.heldFrom.length > 0 ? null : { pieces: answer.pieces, marbles: answer.marbles };
}

/** A marble's pieces follow the marble again, with no stored run to come back on */
export function release(project: TProject, marbleId?: string): TProject {
	return {
		...project,
		marbles: project.marbles.map((marble) => {
			if (marble.waitsFrom == null || (marbleId != null && marble.id !== marbleId)) return marble;
			const { waitsFrom: _, handOvers: _dropped, ...rest } = marble;
			return rest;
		})
	};
}

// A dragged dot

/** The bar before a dragged dot aims the marble at it, as far as its range goes; `isBack` when that's where it stands, for a marble off its run */
function aimAtDot(simulator: TSimulator, project: TProject, chain: TChain, moved: { marbleId: string; hitId: string; dot: TVec2 }, g: number, isBack = false): { project: TProject; move: TMoveOutcome; takerId: string | null } | null {
	const marble = project.marbles.find((item) => item.id === moved.marbleId);
	const index = marble?.hits.findIndex((hit) => hit.id === moved.hitId) ?? -1;
	const hit = marble?.hits[index];
	const previous = marble?.hits[index - 1];
	if (marble == null || hit == null) return null;
	const step = stepOf(hit.time);
	const stored = chain.handOvers.find((item) => item.step === step);
	const wall = stored != null ? ballistic({ x: stored.position.x + stored.origin.x, y: stored.position.y + stored.origin.y }, stored.velocity, Math.max(0, hit.time - step * STEP_TIME), g).position : moved.dot;
	const asked = Math.hypot(moved.dot.x - wall.x, moved.dot.y - wall.y);
	const before = previous != null ? project.track.pieces.filter((piece) => tieOf(piece)?.marbleId === moved.marbleId && tieOf(piece)?.hitId === previous.id) : [];
	const from = before.find((piece) => hasRide(piece.type)) ?? before[0];
	const taker = before.find(isBar);
	const fixed = (): { project: TProject; move: TMoveOutcome; takerId: string | null } => ({ project, move: { moved: 0, missed: asked, fromId: from?.id ?? null, isFixed: true }, takerId: null });
	if (previous == null || taker == null || before.some((piece) => hasRide(piece.type))) return fixed();
	const previousStep = stepOf(previous.time);
	const start = chain.handOvers.find((item) => item.step === previousStep);
	const span = hit.time - previous.time;
	const spec = getPieceDefinition(taker.type)?.params['bounce'];
	const range = { min: spec?.min ?? 0.1, max: spec?.max ?? 0.95 };
	const was = chain.stored.get(previousStep) ?? { angle: taker.angle, bounce: taker.params['bounce'] ?? 0.65, hop: null };
	const baseWalk = simulator.walk(project, previousStep);
	const arriving = previousStep > 0 ? baseWalk.marbles[chain.index]?.hops.at(-1) : null;
	const landing = arriving?.record.marbles[arriving.track]?.end;
	const arrival = landing ?? (start != null ? { x: start.position.x, y: start.position.y, vx: start.velocity.x, vy: start.velocity.y } : null);
	const arrivalOrigin = arriving?.origin ?? start?.origin ?? { x: 0, y: 0 };
	if (arrival == null) return fixed();
	const position = { x: arrival.x + arrivalOrigin.x, y: arrival.y + arrivalOrigin.y };
	const velocity = { x: arrival.vx, y: arrival.vy };
	const want = { x: (moved.dot.x - position.x) / span, y: (moved.dot.y - position.y - (g * span * span) / 2) / span };
	const storedHop = was.hop;
	const storedLeaves = storedHop != null && stored != null ? { x: stored.velocity.x, y: stored.velocity.y - g * (step - previousStep) * STEP_TIME } : null;
	if (storedHop != null && storedLeaves != null) {
		const plain = reflect({ x: storedHop.start.vx, y: storedHop.start.vy }, was.angle, was.bounce);
		want.x -= storedLeaves.x - plain.x;
		want.y -= storedLeaves.y - plain.y;
	}
	const trial0 = withoutHandOverAt(project, chain.marbleId, previousStep);
	let best: { angle: number; bounce: number; missed: number } | null = null;
	for (let attempt = 0; attempt < DOT_TRIES; attempt++) {
		const reflected = reflectionFor(velocity, want);
		const { angle, bounce } = clampBar(reflected.angle, reflected.bounce, was, range);
		const walk = simulator.walk(withBar(trial0, taker.id, angle, bounce), step);
		const hop = hopFrom(walk, chain.index, previousStep);
		const end = hop?.record.marbles[hop.track]?.end;
		if (hop == null || end == null) break;
		const landedAt = ballistic({ x: end.x + hop.origin.x, y: end.y + hop.origin.y }, { x: end.vx, y: end.vy }, Math.max(0, hit.time - step * STEP_TIME), g).position;
		const errorX = moved.dot.x - landedAt.x;
		const errorY = moved.dot.y - landedAt.y;
		const missed = Math.hypot(errorX, errorY);
		if (best == null || missed < best.missed) best = { angle, bounce, missed };
		if (missed < DOT_LANDED) break;
		want.x += errorX / span;
		want.y += errorY / span;
	}
	if (best == null) return fixed();
	// Nearer than it stands now, or nothing moves
	if (!isBack && best.missed >= asked - 1e-3) return { project, move: { moved: 0, missed: asked, fromId: from?.id ?? null, isFixed: false }, takerId: null };
	return { project: withBar(project, taker.id, best.angle, best.bounce), move: { moved: Math.max(0, asked - best.missed), missed: best.missed, fromId: from?.id ?? null, isFixed: false }, takerId: taker.id };
}

// Two bars

function wouldLeaveFrame(simulator: TSimulator, project: TProject, before: TProject, chain: TChain): boolean {
	const bandAt = bandAlongGuide(project, chain.marbleId);
	const stick = (walk: TWalk, index: number): number => {
		let worst = -Infinity;
		for (const hop of walk.marbles[index]?.hops ?? []) {
			const box = hop.record.bounds;
			const band = bandAt((box.minY + box.maxY) / 2 + hop.origin.y);
			worst = Math.max(worst, band.centerX - band.halfWidth - (box.minX + hop.origin.x), box.maxX + hop.origin.x - (band.centerX + band.halfWidth));
		}
		return worst;
	};
	const was = stick(simulator.walk(before), before.marbles.findIndex((item) => item.id === chain.marbleId));
	const now = stick(simulator.walk(project), chain.index);
	return now > 0.001 && now > was + 0.001;
}

