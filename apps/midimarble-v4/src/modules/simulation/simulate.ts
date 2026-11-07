import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import { type THandOver, type TProject, type TVec2, tieOf } from '@/modules/project';
import { createPlan, lowPointOf, resolvedFromLayout, STEP_EPSILON, type TPlan, type TRunInput, type TStaticPiece, type TPlanEvent } from './create-plan';
import { ballistic, gravityOf } from './geometry';
import { layoutAtMarble, layoutFree, type TLayoutInput, type TPieceLayout, type TRotorLayout } from './piece-layout';
import { getPieceDefinition, soundsHit, pieceRestitution, resolvePieceParams } from './pieces';
import { descentPace, descentPoints } from './pace';
import { LEAVE_STEPS, rideFrame, rideLength, rideTolerance, rideVelocity } from './ride';
import { shapeClosestPoint, shapeDistance, shapesBounds, transformShape, wrapAngle, type TBounds2, type TPieceShape } from './shapes';
import { HIT_DRIFT, HIT_TOLERANCE, IMPACT_SPEED, PHYSICS_HZ, type TContact, type THitResult, type TMarbleSample, type TPieceDefinition, type TPieceMotionSample, type TResolvedPiece, type TSimulationResult } from './types';

// A run is hops: one short Rapier world per stretch between a marble's notes, from a hand-over (where the marble is, how it
// moves and turns, how the windmills stand) to the next note. A hop holds only what it can reach. With wires as one surface
// and no recycled contacts a piece the marble doesn't touch changes no bit of its run, so hops of different marbles stand
// alone; marbles that meet run in one world for as long as that takes. Hops are kept by what they start from, so what an
// edit doesn't touch is never run again. See `edit-rule.ts` for what an edit does with them.

const DT = 1 / PHYSICS_HZ;
const GLASS_DENSITY = 2500;
// Marble coefficients sit at the top of the range and pieces use the Min combine rule, which Rapier
// prefers over the marble's Average rule. A piece's own restitution and friction therefore govern every
// marble contact with it, while marble pairs combine to these values. The marble restitution matches the
// highest `bounce` a piece allows, so Min never clips a piece's value.
const MARBLE_RESTITUTION = 0.95;
const MARBLE_FRICTION = 0.5;
// Marble centers move in this plane. Colliders span z from their wall offset over COLLIDER_DEPTH, so the plane runs
// through every piece and contact normals stay in xy.
const MARBLE_Z = 0.01;
// A piece's `depth` is how far it stands out in the film and plays no part in the run. Its collider keeps this fixed
// depth: a Jingle Bells rebuilt at 9 cm colliders missed 53 of 115 hits, as Rapier's rounding differs with a box's size
// and a long run amplifies it. Tracks built at the earlier default of 4.5 cm play exactly as before.
const COLLIDER_DEPTH = 0.045;
// A marble stops being simulated this far below its release or the lowest piece, whichever is lower
const FALL_LIMIT = 20;
// Earlier samples may touch a new piece by this much before it counts as blocked
const BLOCK_TOLERANCE = 0.0005;
// A hop checks every few steps, on the global step grid, what its marble could reach before the next check
const REACH_INTERVAL = 6;
const REACH_MARGIN = 0.05;
// Speed slack of the reach, in m/s
const SPEED_SLACK = 1;
// What a kept hop answers for: the pieces this far from its marble's surface, past Rapier's speculative margin of 2 cm. A
// sample every few steps sees that, at the speeds of a song. A piece further off has no contact to solve
const KEPT_REACH = 0.03;
const NEAR_STRIDE = 3;
// Windmill parts are light wood
const ROTOR_DENSITY = 600;
// Collision groups as membership << 16 | filter. Marbles keep the default and meet everything. Static
// pieces meet everything but rotors, and rotors meet only marbles, so a turning blade never jams on a
// platform next to it.
const STATIC_GROUPS = 0x0002ffff;
const ROTOR_GROUPS = 0x00040001;
// Marbles this close after a step touch, within Rapier's allowed penetration
const MARBLE_SLOP = 0.001;
// Marbles this much closer than their speeds' next two steps may meet, so they share a world
const MEETING_SLACK = 0.002;
const MEETING_MARGIN = 0.05;
// A wire's rolling stays calm only with these two: more solver work on each contact, and a contact solved afresh every
// step rather than recycled from the last. Rapier has no setter for recycling, but it never recycles a pair with hooks.
const SOLVER_ITERATIONS = 8;
const WIRE_CAP_SEGMENTS = 4;
const WIRE_HALF_DEPTH = 0.03;
const NO_RECYCLING: RAPIER.PhysicsHooks = {
	filterContactPair: () => RAPIER.SolverFlags.COMPUTE_IMPULSE,
	filterIntersectionPair: () => true
};
// A stored hand-over stands while the hop before it lands this near it: a seam at a bounce doesn't show
export const SEAM_DISTANCE = 0.01;
export const SEAM_SPEED = 0.1;
// Steps into a hop in which a touch the hop before ended in may be reported again
const CARRIED_STEPS = 3;
// A marble this far off a piece it touched has left it, and this near touches it again (`recordReturns`): a roll's
// rattle stays under a millimeter, and Rapier's allowed penetration is about one
const APART = 0.001;
const TOUCHING = 0.0005;
// Samples kept across runs, about a minute of song a hundred times over
const KEPT_SAMPLES = 1_500_000;

/** What a run reads, and which project and revision its result answers for */
export type TSimulationInput = TRunInput & Pick<TProject, 'id' | 'revision'>;

export interface TSimulator {
	/**
	 * Simulates the project, keeping every hop whose inputs are unchanged. With a `horizon` it stops that many seconds after
	 * the first hop it has to run, and past there the result shows what the latest whole run found.
	 */
	simulate: (project: TSimulationInput, horizon?: number) => TSimulationResult;
	/**
	 * The hops of a run, for the edit rule. `until` stops once every marble has passed that step, `stopsOffChain` at the first
	 * marble that lands off its stored hand-over, as what would run from there is no use to it
	 */
	walk: (project: TRunInput, until?: number, stopsOffChain?: boolean) => TWalk;
	dispose: () => void;
}

let rapierReady: Promise<void> | null = null;

export async function createSimulator(options: { isOneRun?: boolean } = {}): Promise<TSimulator> {
	rapierReady ??= RAPIER.init();
	await rapierReady;
	const kept = createHopStore();
	let whole: { projectId: string; result: TSimulationResult } | null = null;
	return {
		simulate(project, horizon) {
			const far = whole?.projectId === project.id ? whole.result : null;
			const startedAt = now();
			const walk = walkHops(project, kept, { horizon: far != null ? horizon : undefined, isOneRun: options.isOneRun === true });
			const result = buildResult(project, walk);
			result.stats = { computeMs: now() - startedAt, reusedUntil: walk.reusedUntil, steps: walk.steps };
			if (far != null && result.duration < project.length - 1 / PHYSICS_HZ) return withFarRun(result, far);
			whole = { projectId: project.id, result };
			return result;
		},
		walk: (project, until, stopsOffChain) => walkHops(project, kept, { until, stopsOffChain: stopsOffChain === true, isOneRun: false }),
		dispose() {
			kept.hops.clear();
		}
	};
}

/** The real clock, whatever a hop has put in its place */
const now = performance.now.bind(performance);

function stillClock(): number {
	return 0;
}

// Hops

/** A marble's state, in the coordinates of its hop's world */
export interface TBodyState {
	x: number;
	y: number;
	vx: number;
	vy: number;
	qz: number;
	qw: number;
	spin: number;
}

interface TRotorState {
	qz: number;
	qw: number;
	spin: number;
}

/** A hop as it ran, in its world's coordinates, kept for as long as what it starts from stays the same */
export interface THopRecord {
	key: string;
	from: number;
	to: number;
	marbles: THopMarble[];
	contacts: { time: number; marbleIndex: number; otherId: string; kind: TContact['kind']; position: TVec2; speed?: number }[];
	rotors: { pieceId: string; from: number; angles: number[]; spins: number[]; end: TRotorState }[];
	/** The pieces and windmills near its path as it ran, what `reachKey` compares */
	reachKey: string;
	bounds: TBounds2;
	steps: number;
	/** Wall samples and layouts of what it placed by world origin, so a hop shifted along its song builds them once */
	wall: { origin: TVec2; samples: TMarbleSample[][] } | null;
	layouts: { origin: TVec2; byEvent: Map<number, TPieceLayout> } | null;
	/** Whether its path comes near a piece, by how the piece sits against its world */
	nearness: Map<string, boolean>;
}

interface THopMarble {
	index: number;
	/** First step this marble is in the world */
	from: number;
	samples: TMarbleSample[];
	end: TBodyState | null;
	status: 'live' | 'ended';
	touching: string[];
	/** What its events did, in order: where the marble was when each came */
	placed: THopPlaced[];
}

interface THopPlaced {
	eventIndex: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	/** Samples of the hop before it came */
	sampleCount: number;
	isBlocked: boolean;
}

interface THopStore {
	hops: Map<string, THopRecord>;
	samples: number;
}

function createHopStore(): THopStore {
	return { hops: new Map(), samples: 0 };
}

function keepHop(store: THopStore, record: THopRecord): void {
	const count = (hop: THopRecord): number => hop.marbles.reduce((sum, marble) => sum + marble.samples.length, 0);
	const known = store.hops.get(record.key);
	if (known != null) {
		store.samples -= count(known);
		store.hops.delete(record.key);
	}
	store.hops.set(record.key, record);
	store.samples += count(record);
	// Least recently used first: a hop in use was just kept again
	for (const [key, old] of store.hops) {
		if (store.samples <= KEPT_SAMPLES) break;
		store.hops.delete(key);
		store.samples -= count(old);
	}
}

/** One marble's way through a run */
export interface TMarbleWalk {
	index: number;
	status: 'waiting' | 'live' | 'ended';
	/** Steps at which a hop starts: the release and each note */
	boundaries: number[];
	nextBoundary: number;
	step: number;
	state: TBodyState | null;
	origin: TVec2;
	touching: string[];
	hops: TWalkHop[];
	/** Its hops by where they ran. An index past `hops` was taken back */
	hopGrid: PieceGrid;
	stored: Map<number, THandOver>;
	/** From this step on the marble flies free and its pieces wait where the stored hand-overs have them */
	waitsFrom: number | null;
	events: TEventRef[];
	nextEvent: number;
}

interface TEventRef {
	event: TPlanEvent;
	index: number;
}

export interface TWalkHop {
	record: THopRecord;
	/** Index into `record.marbles` */
	track: number;
	origin: TVec2;
	from: number;
	to: number;
	start: TBodyState;
	/** How far the hop before it landed from this hop's stored start, null without one */
	seam: { distance: number; speed: number } | null;
	/** True when the stored start was taken */
	isStored: boolean;
	isKept: boolean;
}

/** A piece on the wall */
interface TWorldPiece {
	pieceId: string;
	definition: TPieceDefinition;
	params: Record<string, number>;
	/** Wall coordinates */
	shapes: TPieceShape[];
	bounds: TBounds2;
	rotorIndex: number;
	rotor: TRotorLayout | null;
	enterStep: number;
	marbleIndex: number;
	/** Says what a hop near it needs to know */
	signature: string;
	/** Wall position, for the signature's offset to a hop's world */
	at: TVec2;
	/** The same shapes in the coordinates of the world that placed it, so a hop in that world sees them to the bit */
	frame: { origin: TVec2; shapes: TPieceShape[] } | null;
}

/** A windmill's turning over the run */
interface TRotorRun {
	pieceId: string;
	hub: TVec2;
	motorSpeed: number;
	damping: number;
	localShapes: TPieceShape[];
	/** Step of `motion[0]` */
	firstStep: number;
	motion: TPieceMotionSample[];
	spins: number[];
	/** The exact state at a step, the end of the hop that last moved it */
	exact: { step: number; state: TRotorState } | null;
	bounds: TBounds2;
	/** Marble that last struck it and the steps of that hop, so a second marble there shares its world */
	struck: { marbleIndex: number; from: number; to: number } | null;
}

interface TPlacement {
	piece: TResolvedPiece;
	dot: TVec2 | null;
	velocity: TVec2 | null;
	marbleIndex: number;
	step: number;
}

/** A run, as far as it went */
export interface TWalk {
	plan: TPlan;
	marbles: TMarbleWalk[];
	pieces: TWorldPiece[];
	/** Index of each piece on the wall by its ID */
	onWall: Map<string, number>;
	grid: PieceGrid;
	placements: Map<string, TPlacement>;
	rotors: TRotorRun[];
	lowestPieceY: number;
	/** Seconds up to which nothing had to run */
	reusedUntil: number;
	steps: number;
	end: number;
}

function zeroOrigin(): TVec2 {
	return { x: 0, y: 0 };
}

function isZero(origin: TVec2): boolean {
	return origin.x === 0 && origin.y === 0;
}

/**
 * Walks the plan: each marble's next hop in turn, the one that ends soonest first, so what any hop can meet has already been
 * placed. A hop comes from the store when what it starts from and what stands near its path are as they were.
 */
function walkHops(project: TRunInput, store: THopStore, options: { horizon?: number | undefined; until?: number | undefined; stopsOffChain?: boolean; isOneRun: boolean }): TWalk {
	const plan = createPlan(project);
	const walk = startWalk(project, plan);
	let limit = options.until ?? plan.endStep;
	const clock = performance.now;
	// Rapier reads the clock about seventy times a step for counters it never shows, with its profiler off: a tenth of a
	// run's time in Node. A still clock while stepping costs it nothing to read; `now` keeps the real one.
	performance.now = stillClock;
	try {
		if (options.isOneRun) {
			runShared(walk, store, walk.marbles.filter((marble) => marble.status !== 'ended'), plan.startStep, plan.endStep);
			placeRemaining(walk);
			walk.end = plan.endStep;
			return walk;
		}
		let meetings = 0;
		for (;;) {
			const walker = nextWalker(walk, limit);
			if (walker == null) break;
			if (options.stopsOffChain === true && isOffChain(walk, walker)) break;
			const before = walk.steps;
			const hop = runNextHop(walk, store, walker);
			if (before === 0 && walk.steps > 0) {
				walk.reusedUntil = hop.from / PHYSICS_HZ;
				if (options.horizon != null) limit = Math.min(limit, hop.from + Math.ceil(options.horizon * PHYSICS_HZ));
			}
			const meeting = meetings < MAX_MEETINGS ? findMeeting(walk, walker, hop) : null;
			if (meeting != null) {
				meetings++;
				shareWorld(walk, store, walker, hop, meeting);
			}
		}
		placeRemaining(walk);
		walk.end = limit;
		if (walk.steps === 0) walk.reusedUntil = limit / PHYSICS_HZ;
		return walk;
	} finally {
		performance.now = clock;
	}
}

const MAX_MEETINGS = 64;

function isOffChain(walk: TWalk, walker: TMarbleWalk): boolean {
	if (walker.state == null) return false;
	const start = hopStart(walk, walker, walker.boundaries[walker.nextBoundary] ?? walker.step);
	return start.seam != null && !start.isStored;
}

function startWalk(project: TRunInput, plan: TPlan): TWalk {
	const walk: TWalk = {
		plan,
		marbles: [],
		pieces: [],
		onWall: new Map(),
		grid: new PieceGrid(),
		placements: new Map(),
		rotors: [],
		lowestPieceY: Infinity,
		reusedUntil: 0,
		steps: 0,
		end: plan.endStep
	};
	plan.marbles.forEach((marble, index) => {
		const events = plan.events.flatMap((event, eventIndex) => (event.marbleIndex === index ? [{ event, index: eventIndex }] : []));
		const notes = events.filter(({ event }) => !event.isAnchor && event.step > marble.releaseStep && event.step < plan.endStep).map(({ event }) => event.step);
		const boundaries = [...new Set([marble.releaseStep, ...notes, plan.endStep])].filter((step) => step <= plan.endStep).sort((a, b) => a - b);
		const hits = project.marbles.find((item) => item.id === marble.marbleId);
		const stored = new Map((hits?.handOvers ?? []).map((handOver) => [handOver.step, handOver]));
		const waitsHit = hits?.waitsFrom != null ? hits.hits.find((hit) => hit.id === hits.waitsFrom) : null;
		walk.marbles.push({
			index,
			status: 'waiting',
			boundaries,
			nextBoundary: 0,
			step: marble.releaseStep,
			state: null,
			origin: zeroOrigin(),
			touching: [],
			hops: [],
			hopGrid: new PieceGrid(),
			stored,
			waitsFrom: waitsHit != null ? Math.floor(waitsHit.time * PHYSICS_HZ + STEP_EPSILON) : null,
			events,
			nextEvent: 0
		});
	});
	for (const piece of plan.staticPieces) addStaticPiece(walk, piece);
	return walk;
}

function addStaticPiece(walk: TWalk, piece: TStaticPiece): void {
	let rotorIndex = -1;
	let bounds = shapesBounds(piece.layout.shapes);
	if (piece.layout.rotor != null) {
		rotorIndex = walk.rotors.length;
		bounds = sweptDisc(piece.layout.rotor);
		walk.rotors.push(rotorRun(piece.pieceId, piece.layout.rotor, walk.plan.startStep, bounds));
	}
	addWorldPiece(walk, {
		pieceId: piece.pieceId,
		definition: piece.definition,
		params: piece.params,
		shapes: piece.layout.shapes,
		bounds,
		rotorIndex,
		rotor: piece.layout.rotor,
		enterStep: -Infinity,
		marbleIndex: -1,
		signature: piece.key !== '' ? piece.key : `${piece.pieceId}|${JSON.stringify(piece.layout.rotor)}`,
		at: piece.layout.position,
		frame: null
	});
}

function rotorRun(pieceId: string, rotor: TRotorLayout, firstStep: number, bounds: TBounds2): TRotorRun {
	return {
		pieceId,
		hub: rotor.hub,
		motorSpeed: rotor.motorSpeed,
		damping: rotor.damping,
		localShapes: rotor.localShapes,
		firstStep,
		// Adding zero turns the -0 of step 0 into 0
		motion: [{ time: firstStep / PHYSICS_HZ + 0, angle: rotor.angle }],
		spins: [rotor.motorSpeed],
		exact: null,
		bounds,
		struck: null
	};
}

function addWorldPiece(walk: TWalk, piece: TWorldPiece): void {
	walk.onWall.set(piece.pieceId, walk.pieces.length);
	walk.pieces.push(piece);
	walk.grid.add(walk.pieces.length - 1, piece.bounds);
}

function nextWalker(walk: TWalk, limit: number): TMarbleWalk | null {
	let best: TMarbleWalk | null = null;
	let bestEnd = Infinity;
	for (const marble of walk.marbles) {
		if (marble.status === 'ended' || marble.step >= walk.plan.endStep || marble.step >= limit) continue;
		const end = marble.boundaries[marble.nextBoundary + 1] ?? marble.step;
		if (end < bestEnd) {
			best = marble;
			bestEnd = end;
		}
	}
	return best;
}

/** Runs or finds this marble's next hop and moves it on */
function runNextHop(walk: TWalk, store: THopStore, walker: TMarbleWalk): TWalkHop {
	const { plan } = walk;
	const from = walker.boundaries[walker.nextBoundary] ?? walker.step;
	const to = walker.boundaries[walker.nextBoundary + 1] ?? plan.endStep;
	const start = hopStart(walk, walker, from);
	if (start.isStored) takeStoredRotors(walk, walker.stored.get(from), from);
	const events = hopEvents(walker, from, to, plan.endStep);
	const key = hopKey(walk, [{ walker, start: start.state, from }], from, to, events);
	const fallY = fallLimit(walk, walker.index);
	const kept = store.hops.get(key);
	const wholeReach = (record: THopRecord): boolean => reachKeyOf(walk, record, start.origin, to, from) === record.reachKey;
	let record: THopRecord;
	let isKept = false;
	if (kept != null && wholeReach(kept) && kept.bounds.minY + start.origin.y >= fallY && replaysAlike(walk, kept, start.origin)) {
		record = kept;
		isKept = true;
		keepHop(store, record);
	} else {
		record = runStretch(walk, {
			key,
			from,
			to,
			origin: start.origin,
			marbles: [{ walker, start: start.state, from }],
			events,
			fallY
		});
		record.reachKey = reachKeyOf(walk, record, start.origin, to, from);
		walk.steps += record.steps;
		if (record.bounds.minY + start.origin.y >= fallY) keepHop(store, record);
	}
	applyPlacements(walk, record, start.origin, [walker]);
	const hop: TWalkHop = { record, track: 0, origin: start.origin, from, to, start: start.state, seam: start.seam, isStored: start.isStored, isKept };
	advanceWalker(walk, walker, hop);
	return hop;
}

function addHop(walker: TMarbleWalk, hop: TWalkHop): void {
	const box = hop.record.bounds;
	walker.hopGrid.add(walker.hops.length, { minX: box.minX + hop.origin.x, minY: box.minY + hop.origin.y, maxX: box.maxX + hop.origin.x, maxY: box.maxY + hop.origin.y });
	walker.hops.push(hop);
}

function advanceWalker(walk: TWalk, walker: TMarbleWalk, hop: TWalkHop): void {
	const track = hop.record.marbles[hop.track];
	addHop(walker, hop);
	applyRotors(walk, hop.record);
	if (track == null) return;
	walker.status = track.status;
	walker.state = track.end;
	walker.origin = hop.origin;
	walker.step = hop.to;
	walker.touching = track.touching;
	walker.nextBoundary++;
	moveToEvents(walker, hop.to, walk.plan.endStep);
}

/** The marble's next event is the first at or after this step, none at the song's end */
function moveToEvents(walker: TMarbleWalk, step: number, endStep: number): void {
	if (step >= endStep) {
		walker.nextEvent = walker.events.length;
		return;
	}
	while (walker.nextEvent < walker.events.length && (walker.events[walker.nextEvent]?.event.step ?? Infinity) < step) walker.nextEvent++;
}

interface THopStart {
	state: TBodyState;
	origin: TVec2;
	seam: { distance: number; speed: number } | null;
	isStored: boolean;
}

/** What a hop starts from: the release, the hop before it, or the stored hand-over when the hop before it lands near that */
function hopStart(walk: TWalk, walker: TMarbleWalk, from: number): THopStart {
	const marble = walk.plan.marbles[walker.index] as TPlan['marbles'][number];
	const before = walker.status === 'waiting' ? null : walker.state;
	if (before == null) {
		// The marble enters on the first step at or after its release time, moved along its free flight
		const time = from / PHYSICS_HZ;
		const { position, velocity } = ballistic(marble.release, marble.releaseVelocity, Math.max(0, time - marble.releaseTime), walk.plan.gravity);
		return { state: { x: position.x, y: position.y, vx: velocity.x, vy: velocity.y, qz: 0, qw: 1, spin: marble.releaseSpin }, origin: zeroOrigin(), seam: null, isStored: false };
	}
	const stored = walker.waitsFrom != null && from >= walker.waitsFrom ? undefined : walker.stored.get(from);
	if (stored == null) return { state: before, origin: walker.origin, seam: null, isStored: false };
	const seam = {
		distance: Math.hypot(before.x + walker.origin.x - stored.position.x - stored.origin.x, before.y + walker.origin.y - stored.position.y - stored.origin.y),
		speed: Math.hypot(before.vx - stored.velocity.x, before.vy - stored.velocity.y)
	};
	if (seam.distance > SEAM_DISTANCE || seam.speed > SEAM_SPEED) return { state: before, origin: walker.origin, seam, isStored: false };
	return {
		state: { x: stored.position.x, y: stored.position.y, vx: stored.velocity.x, vy: stored.velocity.y, qz: stored.rotation[0], qw: stored.rotation[1], spin: stored.spin },
		origin: stored.origin,
		seam,
		isStored: true
	};
}

function takeStoredRotors(walk: TWalk, handOver: THandOver | undefined, step: number): void {
	for (const stored of handOver?.rotors ?? []) {
		const rotor = walk.rotors.find((item) => item.pieceId === stored.pieceId);
		if (rotor != null) rotor.exact = { step, state: { qz: stored.rotation[0], qw: stored.rotation[1], spin: stored.spin } };
	}
}

function hopEvents(walker: TMarbleWalk, from: number, to: number, endStep: number): TEventRef[] {
	const events: TEventRef[] = [];
	for (let i = walker.nextEvent; i < walker.events.length; i++) {
		const ref = walker.events[i];
		if (ref == null) break;
		if (ref.event.step >= to && !(to === endStep && ref.event.step === to)) break;
		events.push(ref);
	}
	return events;
}

function fallLimit(walk: TWalk, marbleIndex: number): number {
	const marble = walk.plan.marbles[marbleIndex];
	return Math.min(marble?.release.y ?? 0, walk.lowestPieceY, walk.plan.staticLowY) - FALL_LIMIT;
}

/** Everything that decides a hop besides what stands near it */
function hopKey(walk: TWalk, marbles: { walker: TMarbleWalk; start: TBodyState; from: number }[], from: number, to: number, events: TEventRef[]): string {
	const parts: (string | number)[] = [walk.plan.gravity, from, to];
	for (const { walker, start, from: entered } of marbles) {
		const stored = walker.waitsFrom != null && walker.waitsFrom <= to ? 'w' : '';
		parts.push(walker.index, entered, walk.plan.marbles[walker.index]?.radius ?? 0, start.x, start.y, start.vx, start.vy, start.qz, start.qw, start.spin, walker.touching.join(), stored);
	}
	for (const { event, index } of events) parts.push(event.hash, event.time, index, heldBy(walk, event)?.dot.x ?? '', heldBy(walk, event)?.dot.y ?? '');
	return parts.join('|');
}

/** Where a piece waits instead of following the marble: at its stored hand-over, while the marble is released */
function heldBy(walk: TWalk, event: TPlanEvent): { dot: TVec2; velocity: TVec2 | null } | null {
	const walker = walk.marbles[event.marbleIndex];
	if (walker?.waitsFrom == null || event.step < walker.waitsFrom) return null;
	// A follower's moment falls inside a hop; the hand-over before it says near enough where it waits
	const stored = [...walker.stored.values()].filter((item) => item.step <= event.step).at(-1);
	if (stored == null) return null;
	const flight = ballistic({ x: stored.position.x + stored.origin.x, y: stored.position.y + stored.origin.y }, stored.velocity, Math.max(0, event.time - stored.step / PHYSICS_HZ), walk.plan.gravity);
	return { dot: flight.position, velocity: flight.velocity };
}

/**
 * The pieces and windmills a hop's path comes near, with how they sit against its world: while these stay, so does the hop.
 * A piece further off has no contact to solve and changes no bit of the run, wherever it stands.
 */
function reachKeyOf(walk: TWalk, record: THopRecord, origin: TVec2, to: number, from: number): string {
	const reach = KEPT_REACH + Math.max(...record.marbles.map((marble) => walk.plan.marbles[marble.index]?.radius ?? 0));
	const minX = record.bounds.minX + origin.x - reach;
	const maxX = record.bounds.maxX + origin.x + reach;
	const minY = record.bounds.minY + origin.y - reach;
	const maxY = record.bounds.maxY + origin.y + reach;
	const own = record.marbles.map((marble) => marble.index);
	const near = new Set<number>();
	walk.grid.queryBox(minX, minY, maxX, maxY, near);
	const parts: string[] = [];
	for (const index of [...near].sort((x, y) => x - y)) {
		const piece = walk.pieces[index] as TWorldPiece;
		// What the hop itself places follows from what it starts from
		if (piece.enterStep >= from && own.includes(piece.marbleIndex)) continue;
		if (piece.enterStep > to || piece.bounds.maxX < minX || piece.bounds.minX > maxX || piece.bounds.maxY < minY || piece.bounds.minY > maxY) continue;
		const rotor = walk.rotors[piece.rotorIndex];
		// Micrometers, as a piece following a marble that was shifted differs from its old offset in the last bits
		const key = `${piece.pieceId}|${piece.signature}|${piece.enterStep}|${Math.round((piece.at.x - origin.x) * 1e6)}|${Math.round((piece.at.y - origin.y) * 1e6)}`;
		if (rotor != null) {
			parts.push(`${key}|${rotorKey(rotor, from)}`);
			continue;
		}
		let isNear = record.nearness.get(key);
		if (isNear == null) {
			isNear = comesNear(record, piece, origin, reach);
			record.nearness.set(key, isNear);
		}
		if (isNear) parts.push(key);
	}
	return parts.join(';');
}

/** Whether any sample of a hop's path comes within `reach` of a piece's shapes */
function comesNear(record: THopRecord, piece: TWorldPiece, origin: TVec2, reach: number): boolean {
	for (const marble of record.marbles) {
		for (let i = 0; i < marble.samples.length; i += NEAR_STRIDE) {
			const sample = marble.samples[i];
			if (sample == null) continue;
			const x = sample.position.x + origin.x;
			const y = sample.position.y + origin.y;
			if (x < piece.bounds.minX - reach || x > piece.bounds.maxX + reach || y < piece.bounds.minY - reach || y > piece.bounds.maxY + reach) continue;
			for (const shape of piece.shapes) if (shapeDistance(shape, x, y) < reach) return true;
		}
	}
	return false;
}

function rotorKey(rotor: TRotorRun, step: number): string {
	const state = rotorStateAt(rotor, step);
	return `${state.qz}|${state.qw}|${state.spin}`;
}

/** A windmill's pose at a step, by its motor or damping from the last it was known when no hop moved it since */
function rotorStateAt(rotor: TRotorRun, step: number): TRotorState {
	if (rotor.exact?.step === step) return rotor.exact.state;
	extendRotor(rotor, step);
	const index = Math.max(0, step - rotor.firstStep);
	const angle = rotor.motion[index]?.angle ?? rotor.motion[0]?.angle ?? 0;
	const rotation = zRotation(angle);
	return { qz: rotation.z, qw: rotation.w, spin: rotor.spins[index] ?? rotor.motorSpeed };
}

function extendRotor(rotor: TRotorRun, step: number): void {
	while (rotor.firstStep + rotor.motion.length - 1 < step) {
		const last = rotor.motion[rotor.motion.length - 1];
		const spin = rotor.spins[rotor.spins.length - 1] ?? rotor.motorSpeed;
		const next = rotor.motorSpeed !== 0 ? rotor.motorSpeed : spin / (1 + DT * rotor.damping);
		rotor.motion.push({ time: (rotor.firstStep + rotor.motion.length) / PHYSICS_HZ, angle: (last?.angle ?? 0) + next * DT });
		rotor.spins.push(next);
	}
}

/** Whether a kept hop's pieces would be placed as they were: a piece blocked or free depends on the run before it */
function replaysAlike(walk: TWalk, record: THopRecord, origin: TVec2): boolean {
	for (const track of record.marbles) {
		for (const placed of track.placed) {
			const event = walk.plan.events[placed.eventIndex];
			if (event == null || heldBy(walk, event) != null || event.definition == null) continue;
			const marble = walk.plan.marbles[track.index];
			if (marble == null) continue;
			const wall = keptLayout(record, event, marble.radius, placed, origin);
			const isBlocked = isLayoutBlocked(walk, wall, event.time, record, track, placed.sampleCount, origin);
			if (isBlocked !== placed.isBlocked) return false;
		}
	}
	return true;
}

function eventLayoutInput(event: TPlanEvent, radius: number): TLayoutInput {
	return {
		type: event.definition.type,
		params: event.params,
		path: event.path,
		extraPaths: event.extraPaths,
		layout: event.railLayout,
		angle: event.angle,
		contactAt: event.contactAt,
		marbleRadius: radius
	};
}

function wallLayout(event: TPlanEvent, radius: number, placed: THopPlaced, origin: TVec2): TPieceLayout {
	const position = { x: placed.x + origin.x, y: placed.y + origin.y };
	const input = eventLayoutInput(event, radius);
	return event.offset != null ? layoutFree(input, { x: position.x + event.offset.x, y: position.y + event.offset.y }) : layoutAtMarble(input, position, { x: placed.vx, y: placed.vy });
}

function keptLayout(record: THopRecord, event: TPlanEvent, radius: number, placed: THopPlaced, origin: TVec2): TPieceLayout {
	if (record.layouts?.origin.x !== origin.x || record.layouts.origin.y !== origin.y) record.layouts = { origin, byEvent: new Map() };
	let layout = record.layouts.byEvent.get(placed.eventIndex);
	if (layout == null) {
		layout = wallLayout(event, radius, placed, origin);
		record.layouts.byEvent.set(placed.eventIndex, layout);
	}
	return layout;
}

/** Puts what a hop placed on the wall, and its events that never came as out of reach */
function applyPlacements(walk: TWalk, record: THopRecord, origin: TVec2, walkers: TMarbleWalk[]): void {
	for (const walker of walkers) {
		const track = record.marbles.find((item) => item.index === walker.index);
		if (track == null) continue;
		for (const placed of track.placed) applyPlaced(walk, record, track, placed, origin);
	}
}

/** Places a piece where it waits while its marble is released; false when it follows the marble */
function placeHeld(walk: TWalk, event: TPlanEvent, radius: number, marbleIndex: number): boolean {
	const held = heldBy(walk, event);
	if (held == null) return false;
	const input = eventLayoutInput(event, radius);
	const { dot, velocity } = held;
	const layout = event.offset != null ? layoutFree(input, { x: dot.x + event.offset.x, y: dot.y + event.offset.y }) : layoutAtMarble(input, dot, velocity);
	const resolved = resolvedFromLayout(event.pieceId, event.definition.type, event.params, layout, event.hitTime, 'held', event.railLayout);
	if (event.isAnchor) resolved.entryTime = event.time;
	walk.placements.set(event.pieceId, { piece: resolved, dot, velocity, marbleIndex, step: event.step });
	placeOnWall(walk, event, layout, marbleIndex, zeroOrigin(), layout.shapes);
	return true;
}

function applyPlaced(walk: TWalk, record: THopRecord, track: THopMarble, placed: THopPlaced, origin: TVec2): void {
	const event = walk.plan.events[placed.eventIndex];
	const marble = walk.plan.marbles[track.index];
	if (event == null || marble == null) return;
	if (placeHeld(walk, event, marble.radius, track.index)) return;
	const layout = keptLayout(record, event, marble.radius, placed, origin);
	const resolved = resolvedFromLayout(event.pieceId, event.definition.type, event.params, layout, event.hitTime, placed.isBlocked ? 'blocked' : 'placed', event.railLayout);
	if (event.isAnchor) resolved.entryTime = event.time;
	const flight = { x: placed.x + origin.x, y: placed.y + origin.y };
	walk.placements.set(event.pieceId, { piece: resolved, dot: flight, velocity: { x: placed.vx, y: placed.vy }, marbleIndex: track.index, step: event.step });
	if (!placed.isBlocked) placeOnWall(walk, event, layout, track.index, origin, null);
}

function placeOnWall(walk: TWalk, event: TPlanEvent, layout: TPieceLayout, marbleIndex: number, origin: TVec2, frameShapes: TPieceShape[] | null): void {
	if (walk.onWall.has(event.pieceId)) return;
	let rotorIndex = -1;
	let bounds = shapesBounds(layout.shapes);
	if (layout.rotor != null) {
		rotorIndex = walk.rotors.findIndex((rotor) => rotor.pieceId === event.pieceId);
		bounds = sweptDisc(layout.rotor);
		if (rotorIndex < 0) {
			rotorIndex = walk.rotors.length;
			walk.rotors.push(rotorRun(event.pieceId, layout.rotor, event.step, bounds));
		}
	}
	addWorldPiece(walk, {
		pieceId: event.pieceId,
		definition: event.definition,
		params: event.params,
		shapes: layout.shapes,
		bounds,
		rotorIndex,
		rotor: layout.rotor,
		enterStep: event.step,
		marbleIndex,
		signature: event.hash,
		at: layout.position,
		frame: frameShapes != null ? { origin, shapes: frameShapes } : null
	});
	walk.lowestPieceY = Math.min(walk.lowestPieceY, lowPointOf(layout));
}

function applyRotors(walk: TWalk, record: THopRecord): void {
	for (const run of record.rotors) {
		const rotor = walk.rotors.find((item) => item.pieceId === run.pieceId);
		if (rotor == null) continue;
		extendRotor(rotor, run.from);
		const index = run.from - rotor.firstStep;
		rotor.motion.length = index + 1;
		rotor.spins.length = index + 1;
		let previous = rotor.motion[index]?.angle ?? 0;
		for (let i = 0; i < run.angles.length; i++) {
			previous += wrapAngle((run.angles[i] ?? 0) - previous);
			rotor.motion.push({ time: (run.from + i + 1) / PHYSICS_HZ, angle: previous });
			rotor.spins.push(run.spins[i] ?? 0);
		}
		rotor.exact = { step: record.to, state: run.end };
	}
}

/** The events no hop came to, as a whole run would leave them */
function placeRemaining(walk: TWalk): void {
	const { plan } = walk;
	for (const event of plan.events) {
		if (walk.placements.has(event.pieceId)) continue;
		const marble = plan.marbles[event.marbleIndex];
		if (marble != null && event.step <= plan.endStep && placeHeld(walk, event, marble.radius, event.marbleIndex)) continue;
		const unreached: TResolvedPiece = {
			pieceId: event.pieceId,
			type: event.definition.type,
			...(event.railLayout != null ? { layout: event.railLayout } : {}),
			position: marble?.release ?? { x: 0, y: 0 },
			angle: event.angle,
			params: event.params,
			contactPoint: null,
			contactNormal: null,
			hitTime: event.hitTime,
			status: 'unreached'
		};
		if (event.isAnchor) unreached.entryTime = event.time;
		walk.placements.set(event.pieceId, { piece: unreached, dot: null, velocity: null, marbleIndex: event.marbleIndex, step: event.step });
	}
}

// Marbles that meet

interface TMeeting {
	other: TMarbleWalk;
	step: number;
}

/** The first step of a hop at which another marble, as far as it has run, could touch this one */
function findMeeting(walk: TWalk, walker: TMarbleWalk, hop: TWalkHop): TMeeting | null {
	if (walk.marbles.length < 2) return null;
	const track = hop.record.marbles[hop.track];
	const radius = walk.plan.marbles[walker.index]?.radius ?? 0;
	if (track == null) return null;
	for (const other of walk.marbles) {
		if (other === walker || !other.hops.length) continue;
		const otherRadius = walk.plan.marbles[other.index]?.radius ?? 0;
		// Marbles a hop apart, in the same world already, were solved there
		if (other.hops.at(-1)?.record === hop.record) continue;
		for (let h = other.hops.length - 1; h >= 0; h--) {
			const part = other.hops[h];
			if (part == null || part.to <= hop.from) break;
			if (part.from >= hop.to) continue;
			// Boxes too far apart for either marble to cross in this stretch need no look at each step
			const a = hop.record.bounds;
			const b = part.record.bounds;
			const gapX = Math.max(b.minX + part.origin.x - a.maxX - hop.origin.x, a.minX + hop.origin.x - b.maxX - part.origin.x);
			const gapY = Math.max(b.minY + part.origin.y - a.maxY - hop.origin.y, a.minY + hop.origin.y - b.maxY - part.origin.y);
			if (Math.max(gapX, gapY) > radius + otherRadius + MEETING_SLACK + MEETING_MARGIN) continue;
			const partTrack = part.record.marbles[part.track];
			if (partTrack == null) continue;
			const first = Math.max(hop.from, part.from) + 1;
			const last = Math.min(hop.to, part.to);
			for (let step = first; step <= last; step++) {
				const sample = track.samples[step - track.from - 1];
				const at = partTrack.samples[step - partTrack.from - 1];
				if (sample == null || at == null) continue;
				const gap = Math.hypot(sample.position.x + hop.origin.x - at.position.x - part.origin.x, sample.position.y + hop.origin.y - at.position.y - part.origin.y) - radius - otherRadius;
				const closing = Math.hypot(sample.velocity.x, sample.velocity.y) + Math.hypot(at.velocity.x, at.velocity.y);
				if (gap <= closing * 2 * DT + MEETING_SLACK) return { other, step };
			}
		}
	}
	// A windmill struck by another marble in the same stretch turns for both
	for (const run of hop.record.rotors) {
		const rotor = walk.rotors.find((item) => item.pieceId === run.pieceId);
		if (rotor == null) continue;
		const isStruck = hop.record.contacts.some((contact) => contact.otherId === run.pieceId && contact.marbleIndex === walker.index);
		if (!isStruck) continue;
		const struck = rotor.struck;
		if (struck != null && struck.marbleIndex !== walker.index && struck.to > hop.from && struck.from < hop.to) {
			const other = walk.marbles[struck.marbleIndex];
			if (other != null) return { other, step: Math.max(struck.from, hop.from) + 1 };
		}
		rotor.struck = { marbleIndex: walker.index, from: hop.from, to: hop.to };
	}
	return null;
}

/**
 * Two marbles that may touch run in one world, from the later of the hop starts the meeting falls in to the end of both
 * hops. What each did alone from there on is taken back first. The marble ahead picks up again from where the shared world
 * ends, on a boundary of its own.
 */
function shareWorld(walk: TWalk, store: THopStore, walker: TMarbleWalk, hop: TWalkHop, meeting: TMeeting): void {
	const { other, step } = meeting;
	takeBack(walk, walker, hop.from);
	const otherIndex = other.hops.findIndex((item) => item.to >= step);
	const otherHop = other.hops[otherIndex];
	if (otherHop == null) return;
	takeBack(walk, other, otherHop.from);
	const from = Math.min(hop.from, otherHop.from);
	const to = Math.max(walker.boundaries[walker.nextBoundary + 1] ?? hop.to, other.boundaries[other.nextBoundary + 1] ?? otherHop.to);
	runShared(walk, store, [walker, other].sort((a, b) => a.index - b.index), from, to);
}

/** Takes a marble back to the start of the hop that begins at `step` */
function takeBack(walk: TWalk, walker: TMarbleWalk, step: number): void {
	while ((walker.hops.at(-1)?.from ?? -Infinity) >= step) walker.hops.pop();
	const last = walker.hops.at(-1);
	const track = last?.record.marbles[last.track];
	walker.state = track?.end ?? null;
	walker.origin = last?.origin ?? zeroOrigin();
	walker.status = track?.status ?? 'waiting';
	walker.touching = track?.touching ?? [];
	walker.step = step;
	walker.nextBoundary = walker.boundaries.indexOf(step);
	if (walker.nextBoundary < 0) {
		walker.boundaries = [...new Set([...walker.boundaries, step])].sort((a, b) => a - b);
		walker.nextBoundary = walker.boundaries.indexOf(step);
	}
	walker.nextEvent = walker.events.findIndex(({ event }) => event.step >= step);
	if (walker.nextEvent < 0) walker.nextEvent = walker.events.length;
	// Its pieces from there on are placed again
	for (const ref of walker.events) {
		if (ref.event.step < step) continue;
		walk.placements.delete(ref.event.pieceId);
		const index = walk.onWall.get(ref.event.pieceId);
		if (index != null) walk.pieces[index] = { ...(walk.pieces[index] as TWorldPiece), enterStep: Infinity, pieceId: '' };
		walk.onWall.delete(ref.event.pieceId);
	}
}

/** One world for several marbles, each from where it is, up to `to` */
function runShared(walk: TWalk, store: THopStore, walkers: TMarbleWalk[], from: number, to: number): void {
	const entries = walkers.map((walker) => {
		const entered = walker.boundaries[walker.nextBoundary] ?? walker.step;
		return { walker, from: entered, start: hopStart(walk, walker, entered) };
	});
	const origin = (entries.find((entry) => !isZero(entry.start.origin)) ?? entries[0])?.start.origin ?? zeroOrigin();
	const marbles = entries.map((entry) => ({
		walker: entry.walker,
		from: entry.from,
		start: isZero(entry.start.origin) && isZero(origin) ? entry.start.state : { ...entry.start.state, x: entry.start.state.x + entry.start.origin.x - origin.x, y: entry.start.state.y + entry.start.origin.y - origin.y }
	}));
	const events = walkers.flatMap((walker) => hopEvents(walker, walker.step, to, walk.plan.endStep)).sort((a, b) => a.index - b.index);
	const key = `shared|${hopKey(walk, marbles, from, to, events)}`;
	const kept = store.hops.get(key);
	let record: THopRecord;
	if (kept != null && reachKeyOf(walk, kept, origin, to, from) === kept.reachKey && replaysAlike(walk, kept, origin)) {
		record = kept;
		keepHop(store, record);
	} else {
		record = runStretch(walk, { key, from, to, origin, marbles, events, fallY: Math.min(...walkers.map((walker) => fallLimit(walk, walker.index))) });
		record.reachKey = reachKeyOf(walk, record, origin, to, from);
		walk.steps += record.steps;
		keepHop(store, record);
	}
	applyPlacements(walk, record, origin, walkers);
	applyRotors(walk, record);
	marbles.forEach((entry, track) => {
		const { walker } = entry;
		const part = record.marbles[track];
		if (part == null) return;
		addHop(walker, { record, track, origin, from: entry.from, to, start: entry.start, seam: null, isStored: false, isKept: false });
		walker.status = part.status;
		walker.state = part.end;
		walker.origin = origin;
		walker.step = to;
		walker.touching = part.touching;
		walker.boundaries = [...new Set([...walker.boundaries.filter((step) => step <= entry.from || step >= to), to])].sort((a, b) => a - b);
		walker.nextBoundary = walker.boundaries.indexOf(to);
		moveToEvents(walker, to, walk.plan.endStep);
	});
}

// One world

interface TStretch {
	key: string;
	from: number;
	to: number;
	origin: TVec2;
	marbles: { walker: TMarbleWalk; start: TBodyState; from: number }[];
	events: TEventRef[];
	fallY: number;
}

/** `shapes` are what the collider stands for, in the world's coordinates, and relative to the hub for rotors */
type TPieceColliderInfo = { kind: 'piece'; pieceId: string; shapes: TPieceShape[]; rotor: TLiveRotor | null };
type TColliderInfo = { kind: 'marble'; track: number } | TPieceColliderInfo;

/** A piece Rapier holds in contact with a marble */
interface TTouch {
	/** Its colliders in contact, by handle */
	colliders: Map<number, TPieceColliderInfo>;
	/** Whether the marble is still coming, on the piece, or off it again since its last contact (`recordReturns`) */
	phase: 'coming' | 'on' | 'off';
}

interface TLiveRotor {
	run: TRotorRun;
	/** Step it entered this world */
	from: number;
	body: RAPIER.RigidBody;
	hub: TVec2;
	angles: number[];
	spins: number[];
	/** The two last angles */
	previous: number;
	last: number;
}

interface TLeaving {
	step: number;
	velocity: TVec2;
	spin: number;
}

interface TLiveRide {
	pieceId: string;
	stored: NonNullable<TPlanEvent['ride']>;
	startStep: number;
	origin: TVec2;
	angle: number;
}

interface TLiveMarble {
	track: number;
	entered: boolean;
	start: TBodyState;
	from: number;
	body: RAPIER.RigidBody | null;
	colliderHandle: number;
	radius: number;
	result: THopMarble;
	/** Pieces Rapier holds in contact with the marble, by piece ID */
	touching: Map<string, TTouch>;
	/** Pieces the hop before ended touching: their first report here isn't a new touch */
	carried: Set<string>;
	ride: TLiveRide | null;
	leaving: TLeaving | null;
	last: TMarbleSample | null;
	before: TMarbleSample | null;
}

function runStretch(walk: TWalk, stretch: TStretch): THopRecord {
	const { plan } = walk;
	const { origin, from, to } = stretch;
	const world = new RAPIER.World({ x: 0, y: plan.gravity, z: 0 });
	world.timestep = DT;
	world.profilerEnabled = false;
	world.integrationParameters.numSolverIterations = SOLVER_ITERATIONS;
	const queue = new RAPIER.EventQueue(true);
	const colliders = new Map<number, TColliderInfo>();
	const record: THopRecord = { key: stretch.key, from, to, marbles: [], contacts: [], rotors: [], reachKey: '', bounds: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }, steps: 0, wall: null, layouts: null, nearness: new Map() };
	const live: TLiveMarble[] = stretch.marbles.map((entry, track) => {
		const marble = plan.marbles[entry.walker.index] as TPlan['marbles'][number];
		const result: THopMarble = { index: entry.walker.index, from: entry.from, samples: [], end: null, status: 'live', touching: [], placed: [] };
		record.marbles.push(result);
		return { track, entered: false, start: entry.start, from: entry.from, body: null, colliderHandle: -1, radius: marble.radius, result, touching: new Map(), carried: new Set(entry.walker.touching), ride: null, leaving: null, last: null, before: null };
	});
	const inWorld = new Set<number>();
	const liveRotors: TLiveRotor[] = [];
	let eventIndex = 0;
	const meeting = new Set<string>();

	const bringIn = (index: number): void => {
		const piece = walk.pieces[index];
		if (piece == null || inWorld.has(index)) return;
		inWorld.add(index);
		const rotor = walk.rotors[piece.rotorIndex];
		if (rotor != null) liveRotors.push(addRotorBody(world, colliders, piece, rotor, step0(), origin));
		else addPieceColliders(world, colliders, piece, origin);
	};
	let step = from;
	const step0 = (): number => step;
	const updateReach = (): void => {
		const found = new Set<number>();
		for (const marble of live) {
			if (marble.body == null) continue;
			const position = marble.body.translation();
			const velocity = marble.body.linvel();
			const speed = Math.hypot(velocity.x, velocity.y);
			const horizon = (REACH_INTERVAL + 1) * DT;
			let tip = 0;
			for (const rotor of walk.rotors) tip = Math.max(tip, Math.abs(rotor.spins[rotor.spins.length - 1] ?? 0) * ((rotor.bounds.maxX - rotor.bounds.minX) / 2));
			const reach = (2 * speed + SPEED_SLACK + 2 * tip) * horizon - 0.5 * plan.gravity * horizon * horizon + marble.radius + REACH_MARGIN;
			const x = position.x + origin.x;
			const y = position.y + origin.y;
			const near = new Set<number>();
			walk.grid.query(x, y, reach, near);
			for (const index of near) {
				const piece = walk.pieces[index];
				if (piece == null || piece.enterStep > step || inWorld.has(index)) continue;
				if (piece.bounds.maxX >= x - reach && piece.bounds.minX <= x + reach && piece.bounds.maxY >= y - reach && piece.bounds.minY <= y + reach) found.add(index);
			}
		}
		for (const index of [...found].sort((a, b) => a - b)) bringIn(index);
	};

	for (;;) {
		let hasEntered = false;
		for (const marble of live) {
			if (marble.entered || marble.from > step) continue;
			enterMarble(world, colliders, marble, step);
			hasEntered = true;
		}
		while (eventIndex < stretch.events.length && (stretch.events[eventIndex]?.event.step ?? Infinity) <= step) {
			const ref = stretch.events[eventIndex++] as TEventRef;
			const marble = live.find((item) => item.result.index === ref.event.marbleIndex);
			const index = marble != null ? placeInWorld(walk, ref, marble, step, origin, record) : -1;
			if (index >= 0) bringIn(index);
		}
		if (step >= to) break;
		if (hasEntered || step % REACH_INTERVAL === 0) updateReach();
		for (const rotor of liveRotors) rotor.previous = rotor.last;
		world.physicsPipeline.step(world.gravity, world.integrationParameters, world.islands, world.broadPhase, world.narrowPhase, world.bodies, world.colliders, world.softBodies, world.impulseJoints, world.multibodyJoints, world.ccdSolver, queue, NO_RECYCLING);
		step++;
		record.steps++;
		if (step - from === CARRIED_STEPS) for (const marble of live) marble.carried.clear();
		followRides(plan, live, step);
		sampleMarbles(world, colliders, live, step, record, stretch.fallY, origin);
		for (const rotor of liveRotors) {
			const rotation = rotor.body.rotation();
			rotor.last = 2 * Math.atan2(rotation.z, rotation.w);
			rotor.angles.push(rotor.last);
			rotor.spins.push(rotor.body.angvel().z);
		}
		queue.drainCollisionEvents((a, b, started) => {
			recordContact(plan, live, colliders, record, step, a, b, started, meeting);
		});
		recordReturns(plan, live, record, step);
		for (const key of [...meeting]) recordMarbleContact(plan, live, meeting, record, step, key);
		if (live.every((marble) => marble.result.status === 'ended') && eventIndex >= stretch.events.length) break;
	}
	for (const marble of live) {
		if (marble.result.status === 'ended') continue;
		marble.result.end = marble.body != null ? bodyState(marble.body) : marble.start;
		marble.result.touching = [...marble.touching.keys()];
	}
	for (const rotor of liveRotors) {
		const rotation = rotor.body.rotation();
		record.rotors.push({ pieceId: rotor.run.pieceId, from: rotor.from, angles: rotor.angles, spins: rotor.spins, end: { qz: rotation.z, qw: rotation.w, spin: rotor.body.angvel().z } });
	}
	queue.free();
	world.free();
	if (!Number.isFinite(record.bounds.minX)) record.bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
	return record;
}

function bodyState(body: RAPIER.RigidBody): TBodyState {
	const position = body.translation();
	const velocity = body.linvel();
	const rotation = body.rotation();
	return { x: position.x, y: position.y, vx: velocity.x, vy: velocity.y, qz: rotation.z, qw: rotation.w, spin: body.angvel().z };
}

function enterMarble(world: RAPIER.World, colliders: Map<number, TColliderInfo>, marble: TLiveMarble, step: number): void {
	const { start } = marble;
	const body = world.createRigidBody(
		RAPIER.RigidBodyDesc.dynamic()
			.enabledTranslations(true, true, false)
			.enabledRotations(false, false, true)
			.setCcdEnabled(true)
			.setCanSleep(false)
			.setTranslation(start.x, start.y, MARBLE_Z)
			.setRotation({ x: 0, y: 0, z: start.qz, w: start.qw })
			.setLinvel(start.vx, start.vy, 0)
			.setAngvel({ x: 0, y: 0, z: start.spin })
	);
	const collider = world.createCollider(
		RAPIER.ColliderDesc.ball(marble.radius)
			.setDensity(GLASS_DENSITY)
			.setRestitution(MARBLE_RESTITUTION)
			.setFriction(MARBLE_FRICTION)
			.setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS)
			.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
		body
	);
	colliders.set(collider.handle, { kind: 'marble', track: marble.track });
	marble.body = body;
	marble.colliderHandle = collider.handle;
	marble.entered = true;
	const time = step / PHYSICS_HZ;
	marble.last = { time, position: { x: start.x, y: start.y }, angle: 2 * Math.atan2(start.qz, start.qw), velocity: { x: start.vx, y: start.vy } };
	marble.before = null;
}

/** Places an event's piece where its marble is, and returns its index on the wall, -1 when none enters */
function placeInWorld(walk: TWalk, ref: TEventRef, marble: TLiveMarble, step: number, origin: TVec2, record: THopRecord): number {
	const { event } = ref;
	const { plan } = walk;
	const last = marble.last;
	const placed: THopPlaced = { eventIndex: ref.index, x: 0, y: 0, vx: 0, vy: 0, sampleCount: marble.result.samples.length, isBlocked: false };
	if (placeHeld(walk, event, marble.radius, marble.result.index)) {
		marble.result.placed.push(placed);
		return walk.onWall.get(event.pieceId) ?? -1;
	}
	if (last == null || marble.result.status !== 'live' || event.step !== step) return -1;
	const { position, velocity } = ballistic(last.position, last.velocity, Math.max(0, event.time - last.time), plan.gravity);
	placed.x = position.x;
	placed.y = position.y;
	placed.vx = velocity.x;
	placed.vy = velocity.y;
	const input = eventLayoutInput(event, marble.radius);
	const frame = event.offset != null ? layoutFree(input, { x: position.x + event.offset.x, y: position.y + event.offset.y }) : layoutAtMarble(input, position, velocity);
	const wall = isZero(origin) ? frame : wallLayout(event, marble.radius, placed, origin);
	placed.isBlocked = isLayoutBlocked(walk, wall, event.time, record, marble.result, marble.result.samples.length, origin);
	marble.result.placed.push(placed);
	const resolved = resolvedFromLayout(event.pieceId, event.definition.type, event.params, wall, event.hitTime, placed.isBlocked ? 'blocked' : 'placed', event.railLayout);
	if (event.isAnchor) resolved.entryTime = event.time;
	walk.placements.set(event.pieceId, { piece: resolved, dot: { x: position.x + origin.x, y: position.y + origin.y }, velocity, marbleIndex: marble.result.index, step });
	if (placed.isBlocked) return -1;
	placeOnWall(walk, event, wall, marble.result.index, origin, frame.shapes);
	if (event.leaves != null) marble.leaving = { step: step + LEAVE_STEPS, velocity: event.leaves.velocity, spin: event.leaves.spin };
	if (event.ride != null && Math.hypot(last.velocity.x - event.ride.entry.x, last.velocity.y - event.ride.entry.y) <= rideTolerance(plan.gravity / gravityOf({}))) {
		marble.ride = { pieceId: event.pieceId, stored: event.ride, startStep: step, origin: last.position, angle: last.angle };
	}
	return walk.onWall.get(event.pieceId) ?? -1;
}

/** Puts every marble on a ride where its ride says, after the step moved it; the last frame hands it back to physics */
function followRides(plan: TPlan, live: TLiveMarble[], step: number): void {
	for (const marble of live) {
		const { body } = marble;
		if (body == null || marble.result.status !== 'live') continue;
		const { leaving } = marble;
		if (leaving != null && step >= leaving.step) {
			marble.leaving = null;
			const velocity = body.linvel();
			if (Math.hypot(velocity.x - leaving.velocity.x, velocity.y - leaving.velocity.y) <= rideTolerance(plan.gravity / gravityOf({}))) {
				body.setLinvel({ x: leaving.velocity.x, y: leaving.velocity.y, z: 0 }, false);
				body.setAngvel({ x: 0, y: 0, z: leaving.spin }, false);
			}
		}
		const { ride } = marble;
		if (ride == null) continue;
		const index = step - ride.startStep - 1;
		const last = rideLength(ride.stored) - 1;
		if (index >= last) {
			const { exit } = ride.stored;
			body.setTranslation({ x: ride.origin.x + exit.position.x, y: ride.origin.y + exit.position.y, z: MARBLE_Z }, false);
			body.setRotation(zRotation(ride.angle + exit.angle), false);
			body.setLinvel({ x: exit.velocity.x, y: exit.velocity.y, z: 0 }, false);
			body.setAngvel({ x: 0, y: 0, z: exit.spin }, false);
			marble.ride = null;
			continue;
		}
		const frame = rideFrame(ride.stored, index);
		const velocity = rideVelocity(ride.stored, index);
		body.setTranslation({ x: ride.origin.x + frame.x, y: ride.origin.y + frame.y, z: MARBLE_Z }, false);
		body.setRotation(zRotation(ride.angle + frame.angle), false);
		body.setLinvel({ x: velocity.x, y: velocity.y, z: 0 }, false);
		const after = rideFrame(ride.stored, index + 1);
		body.setAngvel({ x: 0, y: 0, z: (after.angle - frame.angle) * PHYSICS_HZ }, false);
	}
}

function sampleMarbles(world: RAPIER.World, colliders: Map<number, TColliderInfo>, live: TLiveMarble[], step: number, record: THopRecord, fallY: number, origin: TVec2): void {
	const time = step / PHYSICS_HZ;
	for (const marble of live) {
		const { body } = marble;
		if (body == null || marble.result.status !== 'live') continue;
		const translation = body.translation();
		if (translation.y + origin.y < fallY) {
			for (let c = 0; c < body.numColliders(); c++) colliders.delete(body.collider(c).handle);
			world.removeRigidBody(body);
			marble.body = null;
			marble.result.status = 'ended';
			continue;
		}
		const rotation = body.rotation();
		const linvel = body.linvel();
		const sample: TMarbleSample = {
			time,
			position: { x: translation.x, y: translation.y },
			angle: 2 * Math.atan2(rotation.z, rotation.w),
			velocity: { x: linvel.x, y: linvel.y }
		};
		marble.result.samples.push(sample);
		marble.before = marble.last;
		marble.last = sample;
		const { bounds } = record;
		if (translation.x < bounds.minX) bounds.minX = translation.x;
		if (translation.x > bounds.maxX) bounds.maxX = translation.x;
		if (translation.y < bounds.minY) bounds.minY = translation.y;
		if (translation.y > bounds.maxY) bounds.maxY = translation.y;
	}
}

function frameShape(shape: TPieceShape, delta: TVec2): TPieceShape {
	return delta.x === 0 && delta.y === 0 ? shape : transformShape(shape, delta, 0);
}

function addPieceColliders(world: RAPIER.World, colliders: Map<number, TColliderInfo>, piece: TWorldPiece, origin: TVec2): void {
	const { definition, params } = piece;
	const shapes = piece.frame != null && piece.frame.origin.x === origin.x && piece.frame.origin.y === origin.y ? piece.frame.shapes : piece.shapes.map((shape) => frameShape(shape, { x: -origin.x, y: -origin.y }));
	for (const group of colliderGroups(shapes)) {
		const desc = staticColliderDesc(group, definition);
		if (desc == null) continue;
		const collider = world.createCollider(
			desc
				.setRestitution(pieceRestitution(definition, params))
				.setFriction(definition.friction)
				.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
				.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
				.setCollisionGroups(STATIC_GROUPS)
		);
		colliders.set(collider.handle, { kind: 'piece', pieceId: piece.pieceId, shapes: group, rotor: null });
	}
}

/** A piece's shapes by the collider each becomes: a wire's joined capsules together, anything else alone */
function colliderGroups(shapes: TPieceShape[]): TPieceShape[][] {
	const groups: TPieceShape[][] = [];
	for (const shape of shapes) {
		const last = groups[groups.length - 1]?.at(-1);
		if (shape.kind === 'capsule' && last?.kind === 'capsule' && isSameSpot(last.b, shape.a) && !isSameSpot(shape.a, shape.b)) groups[groups.length - 1]?.push(shape);
		else groups.push([shape]);
	}
	return groups;
}

function isSameSpot(a: TVec2, b: TVec2): boolean {
	return Math.hypot(a.x - b.x, a.y - b.y) < 1e-9;
}

function staticColliderDesc(shapes: TPieceShape[], definition: TPieceDefinition): RAPIER.ColliderDesc | null {
	const [shape] = shapes;
	switch (shape?.kind) {
		case undefined:
			return null;
		case 'box': {
			const { box } = shape;
			return RAPIER.ColliderDesc.cuboid(box.halfLength, box.halfThickness, COLLIDER_DEPTH / 2)
				.setTranslation(box.cx, box.cy, definition.wallOffset + COLLIDER_DEPTH / 2)
				.setRotation(zRotation(box.angle));
		}
		case 'capsule': {
			if (isSameSpot(shape.a, shape.b)) return RAPIER.ColliderDesc.ball(shape.radius).setTranslation(shape.a.x, shape.a.y, MARBLE_Z);
			const { vertices, indices } = wireSurface(wirePoints(shapes), shape.radius);
			return RAPIER.ColliderDesc.trimesh(vertices, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES);
		}
		case 'ball':
			return RAPIER.ColliderDesc.ball(shape.radius).setTranslation(shape.center.x, shape.center.y, MARBLE_Z);
	}
}

function wirePoints(capsules: TPieceShape[]): TVec2[] {
	const points: TVec2[] = [];
	for (const capsule of capsules) {
		if (capsule.kind !== 'capsule') continue;
		if (!points.length) points.push(capsule.a);
		points.push(capsule.b);
	}
	return points;
}

/**
 * One wire as one surface: a closed loop around its path at the wire's radius, with round ends, standing across the
 * marble's plane. On a chain of capsules each next one is a new contact whose round end leans back at the marble, which
 * turned a rail's rolling chaotic; the mesh knows its inner edges and rolls past them.
 */
function wireSurface(points: TVec2[], radius: number): { vertices: Float32Array; indices: Uint32Array } {
	const count = points.length;
	const side = (offset: number): TVec2[] =>
		points.map((point, i) => {
			const a = points[Math.max(0, i - 1)] ?? point;
			const b = points[Math.min(count - 1, i + 1)] ?? point;
			const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
			return { x: point.x - (offset * (b.y - a.y)) / length, y: point.y + (offset * (b.x - a.x)) / length };
		});
	const cap = (end: TVec2, inner: TVec2): TVec2[] => {
		const length = Math.hypot(end.x - inner.x, end.y - inner.y) || 1;
		const ux = (end.x - inner.x) / length;
		const uy = (end.y - inner.y) / length;
		return [1, 2, 3].map((i) => {
			const t = (Math.PI * i) / WIRE_CAP_SEGMENTS;
			return { x: end.x + radius * (ux * Math.sin(t) - uy * Math.cos(t)), y: end.y + radius * (uy * Math.sin(t) + ux * Math.cos(t)) };
		});
	};
	const first = points[0] ?? { x: 0, y: 0 };
	const last = points[count - 1] ?? first;
	const loop = [...side(radius).reverse(), ...cap(first, points[1] ?? first), ...side(-radius), ...cap(last, points[count - 2] ?? last)];
	const vertices = new Float32Array(loop.length * 6);
	const indices = new Uint32Array(loop.length * 6);
	loop.forEach((point, i) => {
		vertices.set([point.x, point.y, MARBLE_Z - WIRE_HALF_DEPTH, point.x, point.y, MARBLE_Z + WIRE_HALF_DEPTH], i * 6);
		const a = 2 * i;
		const b = 2 * ((i + 1) % loop.length);
		indices.set([a, b, a + 1, a + 1, b, b + 1], i * 6);
	});
	return { vertices, indices };
}

/**
 * A windmill is a body that may only turn around the wall normal through its hub. Without a motor it is
 * dynamic with angular damping; with a motor it is kinematic at a fixed angular velocity, so strikes
 * never slow it down. It enters a world at its angle and spin there.
 */
function addRotorBody(world: RAPIER.World, colliders: Map<number, TColliderInfo>, piece: TWorldPiece, run: TRotorRun, step: number, origin: TVec2): TLiveRotor {
	const rotor = piece.rotor as TRotorLayout;
	const state = rotorStateAt(run, step);
	const hasMotor = rotor.motorSpeed !== 0;
	const hub = { x: rotor.hub.x - origin.x, y: rotor.hub.y - origin.y };
	const bodyDesc = (
		hasMotor
			? RAPIER.RigidBodyDesc.kinematicVelocityBased().setAngvel({ x: 0, y: 0, z: rotor.motorSpeed })
			: RAPIER.RigidBodyDesc.dynamic()
					.enabledTranslations(false, false, false)
					.enabledRotations(false, false, true)
					.setAngularDamping(rotor.damping)
					.setAngvel({ x: 0, y: 0, z: state.spin })
	)
		.setTranslation(hub.x, hub.y, MARBLE_Z)
		.setRotation({ x: 0, y: 0, z: state.qz, w: state.qw })
		.setCanSleep(false);
	const body = world.createRigidBody(bodyDesc);
	const angle = 2 * Math.atan2(state.qz, state.qw);
	const live: TLiveRotor = { run, from: step, body, hub, angles: [], spins: [], previous: angle, last: angle };
	for (const shape of rotor.localShapes) {
		let desc: RAPIER.ColliderDesc;
		if (shape.kind === 'box') {
			const { box } = shape;
			desc = RAPIER.ColliderDesc.cuboid(box.halfLength, box.halfThickness, COLLIDER_DEPTH / 2)
				.setTranslation(box.cx, box.cy, piece.definition.wallOffset + COLLIDER_DEPTH / 2 - MARBLE_Z)
				.setRotation(zRotation(box.angle));
		} else if (shape.kind === 'ball') {
			desc = RAPIER.ColliderDesc.ball(shape.radius).setTranslation(shape.center.x, shape.center.y, 0);
		} else continue;
		const collider = world.createCollider(
			desc
				.setDensity(ROTOR_DENSITY)
				.setRestitution(pieceRestitution(piece.definition, piece.params))
				.setFriction(piece.definition.friction)
				.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
				.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
				.setCollisionGroups(ROTOR_GROUPS),
			body
		);
		colliders.set(collider.handle, { kind: 'piece', pieceId: piece.pieceId, shapes: [shape], rotor: live });
	}
	return live;
}

function zRotation(angle: number): RAPIER.Rotation {
	return { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) };
}

/** Bounds of the disc a windmill's blades sweep around its hub */
function sweptDisc(rotor: TRotorLayout): TBounds2 {
	const local = shapesBounds(rotor.localShapes);
	const reach = Math.max(Math.hypot(local.minX, local.minY), Math.hypot(local.maxX, local.maxY), Math.hypot(local.minX, local.maxY), Math.hypot(local.maxX, local.minY));
	return { minX: rotor.hub.x - reach, minY: rotor.hub.y - reach, maxX: rotor.hub.x + reach, maxY: rotor.hub.y + reach };
}

const GRID_CELL = 0.5;

/** Piece indices by grid cell of their bounds */
class PieceGrid {
	private readonly cells = new Map<number, number[]>();

	add(index: number, bounds: TBounds2): void {
		for (let cx = cellOf(bounds.minX); cx <= cellOf(bounds.maxX); cx++) {
			for (let cy = cellOf(bounds.minY); cy <= cellOf(bounds.maxY); cy++) {
				const key = cellKey(cx, cy);
				const cell = this.cells.get(key);
				if (cell != null) cell.push(index);
				else this.cells.set(key, [index]);
			}
		}
	}

	queryBox(minX: number, minY: number, maxX: number, maxY: number, into: Set<number>): void {
		for (let cx = cellOf(minX); cx <= cellOf(maxX); cx++) {
			for (let cy = cellOf(minY); cy <= cellOf(maxY); cy++) {
				for (const index of this.cells.get(cellKey(cx, cy)) ?? []) into.add(index);
			}
		}
	}

	/** Adds the indices of pieces whose cells meet the square of half size `reach` around x, y */
	query(x: number, y: number, reach: number, into: Set<number>): void {
		for (let cx = cellOf(x - reach); cx <= cellOf(x + reach); cx++) {
			for (let cy = cellOf(y - reach); cy <= cellOf(y + reach); cy++) {
				for (const index of this.cells.get(cellKey(cx, cy)) ?? []) into.add(index);
			}
		}
	}
}

function cellOf(value: number): number {
	return Math.floor(value / GRID_CELL);
}

function cellKey(cx: number, cy: number): number {
	// Cells span ±500 km, far beyond any track
	return (cx + 1e6) * 2e6 + (cy + 1e6);
}

/**
 * True when any earlier sample of any marble overlaps the piece, in wall coordinates: every marble's finished hops, and the
 * `count` first samples of the hop now running. A motor windmill is checked against its blades where they were at each
 * sample's time, since it turns before its hit.
 */
function isLayoutBlocked(walk: TWalk, layout: TPieceLayout, time: number, record: THopRecord, current: THopMarble, count: number, origin: TVec2): boolean {
	const rotor = layout.rotor;
	const hasMotor = rotor != null && rotor.motorSpeed !== 0;
	const bounds = hasMotor ? sweptDisc(rotor) : shapesBounds(layout.shapes);
	const distance = (x: number, y: number, sampleTime: number): number => {
		if (!hasMotor) {
			let d = Infinity;
			for (const shape of layout.shapes) d = Math.min(d, shapeDistance(shape, x, y));
			return d;
		}
		// Moves the sample into the rotor frame at its time instead of turning every blade
		const angle = rotor.angle + rotor.motorSpeed * (sampleTime - time);
		const cos = Math.cos(-angle);
		const sin = Math.sin(-angle);
		const dx = x - rotor.hub.x;
		const dy = y - rotor.hub.y;
		let d = Infinity;
		for (const shape of rotor.localShapes) d = Math.min(d, shapeDistance(shape, dx * cos - dy * sin, dx * sin + dy * cos));
		return d;
	};
	const touches = (samples: TMarbleSample[], total: number, at: TVec2, reach: number): boolean => {
		for (let i = 0; i < total; i++) {
			const sample = samples[i];
			if (sample != null && distance(sample.position.x + at.x, sample.position.y + at.y, sample.time) < reach) return true;
		}
		return false;
	};
	for (const walker of walk.marbles) {
		const marble = walk.plan.marbles[walker.index];
		if (marble == null) continue;
		const reach = marble.radius - BLOCK_TOLERANCE;
		const minX = bounds.minX - reach;
		const maxX = bounds.maxX + reach;
		const minY = bounds.minY - reach;
		const maxY = bounds.maxY + reach;
		const near = new Set<number>();
		walker.hopGrid.queryBox(minX, minY, maxX, maxY, near);
		for (const index of near) {
			const hop = walker.hops[index];
			if (hop == null) continue;
			const box = hop.record.bounds;
			if (box.maxX + hop.origin.x < minX || box.minX + hop.origin.x > maxX || box.maxY + hop.origin.y < minY || box.minY + hop.origin.y > maxY) continue;
			const track = hop.record.marbles[hop.track];
			if (track != null && touches(track.samples, track.samples.length, hop.origin, reach)) return true;
		}
		// The hop now running, as far as it came
		const part = walker.index === current.index ? current : record.marbles.find((item) => item.index === walker.index);
		if (part != null && touches(part.samples, part === current ? count : part.samples.length, origin, reach)) return true;
	}
	return false;
}

// Contacts

function recordContact(plan: TPlan, live: TLiveMarble[], colliders: Map<number, TColliderInfo>, record: THopRecord, step: number, handleA: number, handleB: number, started: boolean, meeting: Set<string>): void {
	const a = colliders.get(handleA);
	const b = colliders.get(handleB);
	if (a == null || b == null) return;
	if (a.kind === 'marble' && b.kind === 'marble') {
		const key = `${Math.min(a.track, b.track)}|${Math.max(a.track, b.track)}`;
		if (started) {
			meeting.add(key);
			for (const track of [a.track, b.track]) {
				const marble = live[track];
				if (marble != null) marble.ride = null;
			}
		} else meeting.delete(key);
		return;
	}
	const pair = a.kind === 'marble' && b.kind === 'piece' ? { track: a.track, piece: b } : a.kind === 'piece' && b.kind === 'marble' ? { track: b.track, piece: a } : null;
	const marble = pair != null ? live[pair.track] : null;
	if (pair == null || marble == null) return;
	// A piece made of several colliders logs a contact only when the marble starts touching any of them
	const key = pair.piece.pieceId;
	const handle = a.kind === 'piece' ? handleA : handleB;
	const touch = marble.touching.get(key);
	if (!started) {
		touch?.colliders.delete(handle);
		if (touch?.colliders.size === 0) marble.touching.delete(key);
		return;
	}
	if (touch != null) {
		touch.colliders.set(handle, pair.piece);
		return;
	}
	marble.touching.set(key, { colliders: new Map([[handle, pair.piece]]), phase: 'coming' });
	// A touch the hop before ended in goes on
	if (marble.carried.delete(key)) return;
	// Something else in the way ends a ride: from here physics decides what happens
	const { ride } = marble;
	if (ride != null && ride.pieceId !== key && !ride.stored.touches.includes(key)) marble.ride = null;
	recordPieceContact(plan, marble, key, pieceShapesNow(pair.piece), pair.piece.rotor, record, step);
}

/**
 * Touches Rapier's events don't report: it keeps a pair in contact while the marble stays within its speculative margin
 * of 2 cm, so a marble that bounces lower than that and lands on the same piece again, to roll on it or strike it twice,
 * would start no contact. A piece the marble has touched, left by `APART` and comes back to within `TOUCHING` of is a
 * new contact. Only the contacts change: the run itself is Rapier's as before.
 */
function recordReturns(plan: TPlan, live: TLiveMarble[], record: THopRecord, step: number): void {
	for (const marble of live) {
		const at = marble.last;
		if (marble.body == null || at == null || marble.touching.size === 0) continue;
		for (const [key, touch] of marble.touching) {
			let nearest: { info: TPieceColliderInfo; shapes: TPieceShape[]; gap: number } | null = null;
			for (const info of touch.colliders.values()) {
				const shapes = pieceShapesNow(info);
				const gap = nearestShape(shapes, at.position.x, at.position.y).distance - marble.radius;
				if (nearest == null || gap < nearest.gap) nearest = { info, shapes, gap };
			}
			if (nearest == null) continue;
			if (nearest.gap <= TOUCHING) {
				if (touch.phase === 'off') recordPieceContact(plan, marble, key, nearest.shapes, nearest.info.rotor, record, step);
				touch.phase = 'on';
			} else if (nearest.gap > APART && touch.phase === 'on') touch.phase = 'off';
		}
	}
}

/** World shapes of a piece collider; rotor parts use the pose at the start of the step */
function pieceShapesNow(info: Extract<TColliderInfo, { kind: 'piece' }>): TPieceShape[] {
	const { rotor } = info;
	if (rotor == null) return info.shapes;
	return info.shapes.map((shape) => transformShape(shape, rotor.hub, rotor.previous));
}

/** The shape nearest a point, and its distance */
function nearestShape(shapes: TPieceShape[], x: number, y: number): { shape: TPieceShape | null; distance: number } {
	let shape: TPieceShape | null = null;
	let distance = Infinity;
	for (const candidate of shapes) {
		const d = shapeDistance(candidate, x, y);
		if (d < distance) {
			distance = d;
			shape = candidate;
		}
	}
	return { shape, distance };
}

// Contact times are refined from the state at the start of the step along free flight. Rapier reports
// contacts per step, sometimes early through predictive contacts, so the search covers three steps. The
// approach speed uses the marble velocity at that time and, for windmill blades, the blade's own velocity.
function recordPieceContact(plan: TPlan, marble: TLiveMarble, pieceId: string, shapes: TPieceShape[], rotor: TLiveRotor | null, record: THopRecord, step: number): void {
	const stepTime = step / PHYSICS_HZ;
	const pre = marble.before;
	const last = marble.last;
	let time = stepTime;
	let center = last?.position ?? { x: marble.start.x, y: marble.start.y };
	let velocity = (pre ?? last)?.velocity ?? { x: 0, y: 0 };
	if (pre != null) {
		const gap = (tau: number): number => {
			const { position } = ballistic(pre.position, pre.velocity, tau, plan.gravity);
			return nearestShape(shapes, position.x, position.y).distance - marble.radius;
		};
		const tau = findFirstRoot(gap, 3 * DT);
		if (tau != null) {
			time = pre.time + tau;
			const flight = ballistic(pre.position, pre.velocity, tau, plan.gravity);
			center = flight.position;
			velocity = flight.velocity;
		}
	}
	const near = nearestShape(shapes, center.x, center.y).shape;
	const position = near != null ? shapeClosestPoint(near, center.x, center.y) : center;
	record.contacts.push({ time, marbleIndex: marble.result.index, otherId: pieceId, kind: 'piece', position, speed: approachSpeed(center, velocity, position, rotor) });
}

/** Speed of the marble toward the surface along the contact normal, relative to the surface */
function approachSpeed(center: TVec2, velocity: TVec2, point: TVec2, rotor: TLiveRotor | null): number {
	let nx = center.x - point.x;
	let ny = center.y - point.y;
	const length = Math.hypot(nx, ny);
	// A center inside the shape has no outline direction; the motion itself is then the approach
	if (length < 1e-9) return Math.hypot(velocity.x, velocity.y);
	nx /= length;
	ny /= length;
	let vx = velocity.x;
	let vy = velocity.y;
	if (rotor != null) {
		const spin = wrapAngle(rotor.last - rotor.previous) * PHYSICS_HZ;
		vx += spin * (point.y - rotor.hub.y);
		vy -= spin * (point.x - rotor.hub.x);
	}
	return Math.max(0, -(vx * nx + vy * ny));
}

/**
 * Logs a marble pair Rapier reported as meeting once they touch. Contacts start while the marbles are still several steps
 * apart, so the pair waits until free flight from the state at the start of the step meets within two steps, since Rapier's
 * speculative contact stops the marbles just short of touching, or until they are within `MARBLE_SLOP` after it.
 */
function recordMarbleContact(plan: TPlan, live: TLiveMarble[], meeting: Set<string>, record: THopRecord, step: number, key: string): void {
	const [trackA, trackB] = key.split('|').map(Number);
	const marbleA = live[trackA ?? -1];
	const marbleB = live[trackB ?? -1];
	if (marbleA == null || marbleB == null) return;
	const reach = marbleA.radius + marbleB.radius;
	let time = step / PHYSICS_HZ;
	let a = marbleA.last?.position ?? { x: 0, y: 0 };
	let b = marbleB.last?.position ?? { x: 0, y: 0 };
	let isTouching = Math.hypot(b.x - a.x, b.y - a.y) - reach <= MARBLE_SLOP;
	const preA = marbleA.before;
	const preB = marbleB.before;
	if (preA != null && preB != null) {
		// Both marbles fall under the same gravity, so their relative motion is linear
		const dx = preB.position.x - preA.position.x;
		const dy = preB.position.y - preA.position.y;
		const vx = preB.velocity.x - preA.velocity.x;
		const vy = preB.velocity.y - preA.velocity.y;
		const tau = findFirstRoot((t) => Math.hypot(dx + vx * t, dy + vy * t) - reach, 2 * DT);
		if (tau != null) {
			isTouching = true;
			time = preA.time + tau;
			a = ballistic(preA.position, preA.velocity, tau, plan.gravity).position;
			b = ballistic(preB.position, preB.velocity, tau, plan.gravity).position;
		}
	}
	if (!isTouching) return;
	meeting.delete(key);
	const share = marbleA.radius / reach;
	const position = { x: a.x + (b.x - a.x) * share, y: a.y + (b.y - a.y) * share };
	const idA = plan.marbles[marbleA.result.index]?.marbleId ?? '';
	const idB = plan.marbles[marbleB.result.index]?.marbleId ?? '';
	record.contacts.push({ time, marbleIndex: marbleA.result.index, otherId: idB, kind: 'marble', position }, { time, marbleIndex: marbleB.result.index, otherId: idA, kind: 'marble', position });
}

/** First t in [0, span] where `gap` reaches zero, or null */
function findFirstRoot(gap: (t: number) => number, span: number): number | null {
	if (gap(0) <= 0) return 0;
	const divisions = 16;
	let low = 0;
	let high = -1;
	for (let i = 1; i <= divisions; i++) {
		const t = (span * i) / divisions;
		if (gap(t) <= 0) {
			high = t;
			break;
		}
		low = t;
	}
	if (high < 0) return null;
	for (let i = 0; i < 40; i++) {
		const mid = (low + high) / 2;
		if (gap(mid) <= 0) high = mid;
		else low = mid;
	}
	return high;
}

/** Spin from the two samples before `time`, a contact, which the steps just before it don't feel yet */
function spinBefore(samples: TMarbleSample[], time: number): number {
	let low = 0;
	let high = samples.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		if ((samples[middle]?.time ?? Infinity) < time - 2 * DT) low = middle + 1;
		else high = middle;
	}
	const a = samples[low - 2];
	const b = samples[low - 1];
	if (a == null || b == null || b.time <= a.time) return 0;
	return Math.atan2(Math.sin(b.angle - a.angle), Math.cos(b.angle - a.angle)) / (b.time - a.time);
}

/** The whole track of a marble on the wall, and its contacts */
function wallSamples(walker: TMarbleWalk): TMarbleSample[] {
	const samples: TMarbleSample[] = [];
	const first = walker.hops[0];
	if (first != null) {
		// The release is a sample of its own
		const { start, origin } = first;
		samples.push({ time: first.from / PHYSICS_HZ, position: { x: start.x + origin.x, y: start.y + origin.y }, angle: 0, velocity: { x: start.vx, y: start.vy } });
	}
	for (const hop of walker.hops) {
		const part = wallPart(hop);
		for (const sample of part) samples.push(sample);
	}
	return samples;
}

function wallPart(hop: TWalkHop): TMarbleSample[] {
	const { record, origin, track } = hop;
	const samples = record.marbles[track]?.samples ?? [];
	if (isZero(origin)) return samples;
	if (record.wall?.origin.x !== origin.x || record.wall.origin.y !== origin.y) {
		record.wall = {
			origin,
			samples: record.marbles.map((marble) =>
				marble.samples.map((sample) => ({ time: sample.time, position: { x: sample.position.x + origin.x, y: sample.position.y + origin.y }, angle: sample.angle, velocity: sample.velocity }))
			)
		};
	}
	return record.wall.samples[track] ?? [];
}

function wallContacts(walk: TWalk): TContact[] {
	const contacts: TContact[] = [];
	const seen = new Set<THopRecord>();
	for (const walker of walk.marbles) {
		for (const hop of walker.hops) {
			if (seen.has(hop.record)) continue;
			seen.add(hop.record);
			for (const contact of hop.record.contacts) {
				const entry: TContact = {
					time: contact.time,
					marbleId: walk.plan.marbles[contact.marbleIndex]?.marbleId ?? '',
					otherId: contact.otherId,
					kind: contact.kind,
					position: { x: contact.position.x + hop.origin.x, y: contact.position.y + hop.origin.y }
				};
				if (contact.speed != null) entry.speed = contact.speed;
				contacts.push(entry);
			}
		}
	}
	return contacts;
}

/** Each hand-over a run went through, in step order, from which it can be run again; the first hop runs from the release */
export function handOversOf(walk: TWalk, marbleIndex: number): THandOver[] {
	const walker = walk.marbles[marbleIndex];
	if (walker == null) return [];
	const handOvers: THandOver[] = [];
	for (const hop of walker.hops.slice(1)) {
		const { start, origin, from } = hop;
		const entry: THandOver = { step: from, position: { x: start.x, y: start.y }, origin, velocity: { x: start.vx, y: start.vy }, rotation: [start.qz, start.qw], spin: start.spin };
		const rotors = walk.rotors.filter((rotor) => rotor.firstStep <= from);
		if (rotors.length) {
			entry.rotors = rotors.map((rotor) => {
				const state = rotorStateAt(rotor, from);
				return { pieceId: rotor.pieceId, rotation: [state.qz, state.qw], spin: state.spin };
			});
		}
		handOvers.push(entry);
	}
	return handOvers;
}

// Result

function buildResult(project: TSimulationInput, walk: TWalk): TSimulationResult {
	const plan: TPlan = { ...walk.plan, endStep: walk.end };
	const staticById = new Map(plan.staticPieces.map((piece) => [piece.pieceId, piece.resolved]));
	const trackOf = walk.marbles.map(wallSamples);
	const pieces: TResolvedPiece[] = [];
	for (const piece of project.track.pieces) {
		if (piece == null || getPieceDefinition(piece.type) == null) continue;
		const resolved = staticById.get(piece.id) ?? walk.placements.get(piece.id)?.piece;
		if (resolved != null) {
			const rotor = walk.rotors.find((r) => r.pieceId === piece.id);
			if (rotor != null) extendRotor(rotor, plan.endStep);
			pieces.push(rotor != null ? { ...resolved, motion: rotorMotion(plan, rotor) } : resolved);
			continue;
		}
		// A piece tied to a hit that is gone has no place in the run or the film
		if (tieOf(piece) != null && plan.linkedHitTimes.get(piece.id) == null) continue;
		// Linked pieces that were never processed: hit after the end or before the start
		const marble = plan.marbles.find((m) => m.marbleId === tieOf(piece)?.marbleId);
		pieces.push({
			pieceId: piece.id,
			type: piece.type,
			...(piece.layout != null ? { layout: piece.layout } : {}),
			position: marble?.release ?? { x: 0, y: 0 },
			angle: piece.angle ?? 0,
			params: resolvePieceParams(piece.type, piece.params),
			contactPoint: null,
			contactNormal: null,
			hitTime: plan.linkedHitTimes.get(piece.id) ?? null,
			status: 'unreached'
		});
	}
	const pieceById = new Map(pieces.map((piece) => [piece.pieceId, piece]));

	const contacts = wallContacts(walk).sort((a, b) => a.time - b.time);
	// A marble's contacts with each piece in time order, so a hit finds its first contact without a walk over every contact
	const contactsByPair = new Map<string, TContact[]>();
	for (const contact of contacts) {
		const key = `${contact.marbleId}|${contact.otherId}`;
		const list = contactsByPair.get(key);
		if (list != null) list.push(contact);
		else contactsByPair.set(key, [contact]);
	}

	const linkByHit = new Map<string, string>();
	for (const piece of project.track.pieces) {
		const tie = tieOf(piece);
		const resolvedPiece = pieceById.get(piece.id);
		// Scenery never sounds its hit
		if (tie == null || resolvedPiece == null || !soundsHit(resolvedPiece.type, tie)) continue;
		const key = `${tie.marbleId}/${tie.hitId}`;
		if (!linkByHit.has(key)) linkByHit.set(key, piece.id);
	}

	const hits: THitResult[] = [];
	// Speeds scale with gravity, so the strike threshold does too
	const impactSpeed = IMPACT_SPEED * (plan.gravity / gravityOf({}));
	for (const marble of project.marbles) {
		const marbleIndex = plan.marbles.findIndex((item) => item.marbleId === marble.id);
		const plannedMarble = plan.marbles[marbleIndex];
		const samples = trackOf[marbleIndex] ?? [];
		let isBehindBreak = false;
		for (const hit of marble.hits) {
			const pieceId = linkByHit.get(`${marble.id}/${hit.id}`) ?? null;
			const piece = pieceId != null ? pieceById.get(pieceId) : undefined;
			const placement = pieceId != null ? walk.placements.get(pieceId) : undefined;
			const onTrajectory =
				placement?.dot != null ? null : trajectoryAt(samples, hit.time, plan.gravity);
			const result: THitResult = {
				marbleId: marble.id,
				hitId: hit.id,
				targetTime: hit.time,
				pieceId,
				dot: placement?.dot ?? onTrajectory?.position ?? null,
				velocity: placement?.velocity ?? onTrajectory?.velocity ?? null,
				actualTime: null,
				error: null,
				status: 'open'
			};
			if (piece == null || plannedMarble == null) {
				if (piece != null) result.status = 'missed';
				hits.push(result);
				continue;
			}
			if (piece.status === 'blocked') {
				result.status = 'blocked';
				hits.push(result);
				continue;
			}
			const from = hit.time - HIT_TOLERANCE - DT;
			const contact = contactsByPair.get(`${plannedMarble.marbleId}|${piece.pieceId}`)?.find((c) => c.time >= from);
			if (contact != null) {
				const error = contact.time - hit.time;
				result.actualTime = contact.time;
				result.error = error;
				result.spin = spinBefore(samples, contact.time);
				result.status =
					Math.abs(error) <= HIT_DRIFT
						? 'onTime'
						: Math.abs(error) <= HIT_TOLERANCE
							? 'drifting'
							: 'missed';
				// A marble that arrives resting or rolling sounds no note
				if (result.status !== 'missed' && (contact.speed ?? Infinity) < impactSpeed) {
					result.status = 'missed';
					result.reason = 'resting';
				}
			} else {
				result.status = 'missed';
			}
			// Behind the hit an edit broke, a waiting platform is no problem of its own
			if (piece.status === 'held' && result.status === 'missed') {
				if (isBehindBreak) result.status = 'waiting';
				isBehindBreak = true;
			}
			hits.push(result);
		}
	}

	const pace = descentPace(project, hits);
	return {
		revision: project.revision,
		duration: plan.endStep / PHYSICS_HZ,
		marbles: plan.marbles.map((marble, i) => ({
			marbleId: marble.marbleId,
			radius: marble.radius,
			samples: trackOf[i] ?? []
		})),
		pieces,
		contacts,
		hits,
		stats: { computeMs: 0, reusedUntil: 0, steps: 0 },
		pace,
		descent:
			pace != null && plan.marbles.length > 1
				? descentPoints(pace, plan.startStep / PHYSICS_HZ + 0, plan.endStep / PHYSICS_HZ)
				: null
	};
}

/**
 * A run that stopped early, completed from the latest whole run: the stretch it simulated is exact, and everything past
 * its stop stays as that run left it. A diverged marble's track jumps at the stop until the next whole run.
 */
function withFarRun(near: TSimulationResult, far: TSimulationResult): TSimulationResult {
	const until = near.duration;
	const hitKey = (hit: THitResult): string => `${hit.marbleId}/${hit.hitId}`;
	const farHits = new Map(far.hits.map((hit) => [hitKey(hit), hit]));
	const farPieces = new Map(far.pieces.map((piece) => [piece.pieceId, piece]));
	const farTracks = new Map(far.marbles.map((track) => [track.marbleId, track]));
	return {
		...near,
		duration: far.duration,
		// A hit this close to the stop could still have been struck in time after it
		hits: near.hits.map((hit) => (hit.targetTime <= until - HIT_TOLERANCE ? hit : (farHits.get(hitKey(hit)) ?? hit))),
		pieces: near.pieces.map((piece) => (piece.status === 'unreached' && (piece.entryTime ?? piece.hitTime ?? Infinity) > until ? (farPieces.get(piece.pieceId) ?? piece) : piece)),
		contacts: [...near.contacts, ...far.contacts.filter((contact) => contact.time > until)],
		marbles: near.marbles.map((track) => {
			const last = track.samples[track.samples.length - 1];
			// A marble that fell out before the stop is gone in this run
			if (last != null && last.time < until - STEP_EPSILON - 1 / PHYSICS_HZ) return track;
			const samples = farTracks.get(track.marbleId)?.samples ?? [];
			return { ...track, samples: [...track.samples, ...samples.filter((sample) => sample.time > until + STEP_EPSILON)] };
		}),
		pace: far.pace,
		descent: far.descent
	};
}

/** Motion with a first sample at the run start when the rotor entered later */
function rotorMotion(plan: TPlan, rotor: TRotorRun): TPieceMotionSample[] {
	// Adding zero turns the -0 of a release at time 0 into 0
	const startTime = plan.startStep / PHYSICS_HZ + 0;
	const first = rotor.motion[0];
	if (first == null || first.time <= startTime) return rotor.motion;
	return [
		{ time: startTime, angle: first.angle - rotor.motorSpeed * (first.time - startTime) },
		...rotor.motion
	];
}

/**
 * Marble state at `time`, extrapolated along free flight from the sample at or before it. Pass the project's
 * gravity (`gravityOf`) for exact values; the extrapolation never spans more than one physics step.
 */
export function trajectoryAt(
	samples: TMarbleSample[],
	time: number,
	gravity?: number
): { position: TVec2; velocity: TVec2 } | null {
	const first = samples[0];
	if (first == null) return null;
	const index = Math.floor(time * PHYSICS_HZ + STEP_EPSILON) - Math.round(first.time * PHYSICS_HZ);
	const sample = samples[index];
	if (sample == null) return null;
	return ballistic(sample.position, sample.velocity, Math.max(0, time - sample.time), gravity);
}
