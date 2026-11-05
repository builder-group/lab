import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import { DEFAULT_MARBLE_RADIUS, type TProject, type TRide, type TVec2, tieOf, freePosition } from '@/modules/project';
import { ballistic, gravityOf } from './geometry';
import { layoutAtMarble, layoutFree, type TLayoutInput, type TPieceLayout, type TRotorLayout } from './piece-layout';
import { getPieceDefinition, soundsHit, pieceRestitution, resolvePieceParams, resolvePiecePath, type TRailLayout } from './pieces';
import { descentPace, descentPoints } from './pace';
import { frameBand } from './placement';
import { hasRide, LEAVE_STEPS, rideFrame, rideHash, rideKey, rideLength, rideTolerance, rideVelocity } from './transit';
import { shapeClosestPoint, shapeDistance, shapesBounds, transformShape, wrapAngle, type TBounds2, type TPieceShape } from './shapes';
import { HIT_DRIFT, HIT_TOLERANCE, IMPACT_SPEED, PHYSICS_HZ, type TContact, type THitResult, type TMarbleSample, type TPieceDefinition, type TPieceMotionSample, type TResolvedPiece, type TSimulationResult } from './types';

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
const MAX_SNAPSHOTS = 512;
// Every marble has a Rapier world of its own, and a piece is in a marble's world only while that marble
// could reach it before the next check. Any enabled collider reshapes Rapier's broad-phase tree, even one
// that never meets anything, and the tree's shape sets the order of the contacts a marble meets in one
// step, such as two rail wires; that order changes the solve in the last bits, and a tightly tuned
// run cascades from there. Keeping far pieces and the other marbles' pieces out of a marble's world
// leaves its run bit for bit unchanged until it comes near them. Checks run every few steps on the global
// step grid so resumed runs match. Parking also keeps Rapier's step cost, which grows with every
// collider, to what is near.
const PARKING_INTERVAL = 6;
const PARKING_MARGIN = 0.05;
// Speed slack of the parking reach, in m/s
const SPEED_SLACK = 1;
const STEP_EPSILON = 1e-7;
const SIGNATURE_VERSION = 'sim@4';
// Windmill parts are light wood
const ROTOR_DENSITY = 600;
// Collision groups as membership << 16 | filter. Marbles keep the default and meet everything. Static
// pieces meet everything but rotors, and rotors meet only marbles, so a turning blade never jams on a
// platform next to it. A proxy, the copy of another marble in a marble's world, meets only marbles.
const STATIC_GROUPS = 0x0002ffff;
const ROTOR_GROUPS = 0x00040001;
const PROXY_GROUPS = 0x00080001;
// Marbles this close after a step touch, within Rapier's allowed penetration
const MARBLE_SLOP = 0.001;

export interface TSimulator {
	/**
	 * Simulates the project, resuming from the latest snapshot whose inputs are unchanged. With a `horizon` it stops
	 * that many seconds after the point it resumed from, and past there the result shows what the latest whole run found.
	 */
	simulate: (project: TProject, horizon?: number) => TSimulationResult;
	dispose: () => void;
}

let rapierReady: Promise<void> | null = null;

export async function createSimulator(): Promise<TSimulator> {
	rapierReady ??= RAPIER.init();
	await rapierReady;
	let cache = new Map<string, TSnapshot>();
	let whole: { projectId: string; result: TSimulationResult } | null = null;
	return {
		simulate(project, horizon) {
			const far = whole?.projectId === project.id ? whole.result : null;
			const [result, nextCache] = runSimulation(project, cache, far != null ? horizon : undefined);
			cache = nextCache;
			if (far != null && result.duration < project.length - 1 / PHYSICS_HZ) return withFarRun(result, far);
			whole = { projectId: project.id, result };
			return result;
		},
		dispose() {
			cache.clear();
		}
	};
}

function runSimulation(
	project: TProject,
	cache: Map<string, TSnapshot>,
	horizon?: number
): [TSimulationResult, Map<string, TSnapshot>] {
	const startedAt = performance.now();
	const plan = createPlan(project);
	const nextCache = new Map<string, TSnapshot>();

	// The latest snapshot whose inputs are unchanged, where edited parkable pieces were still out of reach
	let resumeIndex = -1;
	for (let i = plan.events.length - 1; i >= 0; i--) {
		const event = plan.events[i];
		const key = plan.eventKeys[i];
		if (event == null || key == null || event.step > plan.endStep) continue;
		const snapshot = cache.get(key);
		if (snapshot != null && canResume(plan, snapshot)) {
			resumeIndex = i;
			break;
		}
	}

	let worlds: RAPIER.World[];
	let state: TRunState;
	const resumed = resumeIndex >= 0 ? cache.get(plan.eventKeys[resumeIndex] ?? '') : undefined;
	if (resumed != null) {
		worlds = resumed.worlds.map((bytes) => {
			const world = RAPIER.World.restoreSnapshot(bytes);
			world.timestep = DT;
			return world;
		});
		state = restoreState(resumed);
		rebaseStaticPieces(plan, state, resumed);
		for (let i = 0; i <= resumeIndex; i++) {
			const key = plan.eventKeys[i] ?? '';
			const snapshot = cache.get(key);
			if (snapshot != null) nextCache.set(key, snapshot);
		}
	} else {
		resumeIndex = -1;
		worlds = plan.marbles.map(() => {
			const world = new RAPIER.World({ x: 0, y: plan.gravity, z: 0 });
			world.timestep = DT;
			return world;
		});
		state = createInitialState(plan);
	}
	const reusedUntil = resumed != null ? state.step / PHYSICS_HZ : 0;

	const run = horizon != null ? { ...plan, endStep: Math.min(plan.endStep, state.step + Math.ceil(horizon * PHYSICS_HZ)) } : plan;
	const steps = advance(worlds, run, state, nextCache, resumeIndex);
	for (const world of worlds) world.free();

	const result = buildResult(project, run, state);
	result.stats = { computeMs: performance.now() - startedAt, reusedUntil, steps };
	return [result, trimCache(nextCache)];
}

/**
 * True when the snapshot's world matches what a run from scratch would build: every parkable piece that was
 * added, removed or changed since the snapshot's run was out of every marble's parking reach at every step
 * up to the snapshot, so it never entered the world. The reach uses the fastest speed so far, a bound on
 * what each parking check used.
 */
function canResume(plan: TPlan, snapshot: TSnapshot): boolean {
	const before = new Set<string>();
	for (const piece of snapshot.pieces) if (piece.key !== '') before.add(piece.key);
	const after = new Set<string>();
	for (const piece of plan.staticPieces) if (piece.key !== '') after.add(piece.key);
	const changed: TBounds2[] = [];
	for (const piece of snapshot.pieces) if (piece.key !== '' && !after.has(piece.key)) changed.push(piece.bounds);
	for (const piece of plan.staticPieces) {
		if (piece.key !== '' && !before.has(piece.key)) changed.push(shapesBounds(piece.layout.shapes));
	}
	if (!changed.length) return true;
	// A marble that ended before the snapshot ended at a depth set by the lowest piece
	if (snapshot.staticLowY !== plan.staticLowY && snapshot.marbles.some((marble) => marble.status === 'ended'))
		return false;

	let fastest = 0;
	let radius = 0;
	for (let i = 0; i < snapshot.marbles.length; i++) {
		const marble = snapshot.marbles[i];
		if (marble == null) continue;
		radius = Math.max(radius, plan.marbles[i]?.radius ?? 0);
		for (let k = 0; k < marble.count; k++) {
			const velocity = marble.samples[k]?.velocity;
			if (velocity != null) fastest = Math.max(fastest, Math.hypot(velocity.x, velocity.y));
		}
	}
	// The fastest blade tip so far, which bounds what a strike may add
	let tip = 0;
	for (const rotor of snapshot.rotors) {
		for (let k = 1; k < rotor.count; k++) {
			const turn = Math.abs((rotor.motion[k]?.angle ?? 0) - (rotor.motion[k - 1]?.angle ?? 0));
			tip = Math.max(tip, turn * PHYSICS_HZ * rotorRadius(rotor));
		}
		tip = Math.max(tip, Math.abs(rotor.spin) * rotorRadius(rotor));
	}
	const horizon = (PARKING_INTERVAL + 1) * DT;
	// Bounds every check's reach: twice the fastest marble, the slack and twice the fastest blade tip
	const speed = 2 * fastest + SPEED_SLACK + 2 * tip;
	const reach =
		speed * horizon - 0.5 * plan.gravity * horizon * horizon + radius + PARKING_MARGIN;
	for (const marble of snapshot.marbles) {
		for (let k = 0; k < marble.count; k++) {
			const position = marble.samples[k]?.position;
			if (position == null) continue;
			for (const bounds of changed) {
				if (
					position.x >= bounds.minX - reach &&
					position.x <= bounds.maxX + reach &&
					position.y >= bounds.minY - reach &&
					position.y <= bounds.maxY + reach
				)
					return false;
			}
		}
	}
	return true;
}

/**
 * Swaps the snapshot's parkable pieces for the plan's, in plan order as a run from scratch inserts them.
 * Unchanged pieces keep their colliders; edited ones start parked, as `canResume` checked they were.
 */
function rebaseStaticPieces(plan: TPlan, state: TRunState, snapshot: TSnapshot): void {
	const kept = new Map<string, { record: TPieceRecord; handles: number[][] }>();
	const placed: { record: TPieceRecord; handles: number[][] }[] = [];
	const parked = (): number[][] => state.marbles.map(() => []);
	for (let i = 0; i < snapshot.pieces.length; i++) {
		const record = snapshot.pieces[i];
		if (record == null) continue;
		const entry = { record, handles: state.pieceHandles[i] ?? parked() };
		if (record.key !== '') kept.set(record.key, entry);
		else if (plan.staticPieces.some((piece) => piece.key === '' && piece.entityId === record.entityId))
			kept.set(`rotor:${record.entityId}`, entry);
		else placed.push(entry);
	}
	const pieces: TPieceRecord[] = [];
	const handles: number[][][] = [];
	for (const piece of plan.staticPieces) {
		const entry = kept.get(piece.key !== '' ? piece.key : `rotor:${piece.entityId}`);
		pieces.push(entry?.record ?? staticRecord(piece));
		handles.push(entry?.handles ?? parked());
	}
	for (const entry of placed) {
		pieces.push(entry.record);
		handles.push(entry.handles);
	}
	state.pieces = pieces;
	state.pieceHandles = handles;
}

// Plan

interface TPlan {
	/** Gravity along y, Earth's scaled by the project's `physics.gravity` */
	gravity: number;
	startStep: number;
	endStep: number;
	marbles: TPlanMarble[];
	staticPieces: TStaticPiece[];
	/** Lowest point of the static pieces, which bounds how far a marble may fall */
	staticLowY: number;
	/** Hit-linked pieces in global hit time order */
	events: TPlanEvent[];
	/** Signature of the state just before each event is processed */
	eventKeys: string[];
	/** Linked piece entity ID to its hit time, null when the hit does not exist */
	linkedHitTimes: Map<string, number | null>;
}

interface TPlanMarble {
	entityId: string;
	marbleId: string;
	radius: number;
	release: TVec2;
	releaseVelocity: TVec2;
	releaseSpin: number;
	releaseTime: number;
	releaseStep: number;
}

interface TStaticPiece {
	entityId: string;
	definition: TPieceDefinition;
	params: Record<string, number>;
	layout: TPieceLayout;
	resolved: TResolvedPiece;
	/**
	 * Signature of a parkable piece, empty for windmills. Parkable pieces enter the world only when a marble
	 * comes near, so they stay out of the event chain, and a run resumes past an edit to one of them as long
	 * as no marble came near its old or new pose before the snapshot.
	 */
	key: string;
}

interface TPlanEvent {
	entityId: string;
	definition: TPieceDefinition;
	params: Record<string, number>;
	/** Local control points of rails and tunnels */
	path: TVec2[];
	/** A drawn Rail's further paths */
	extraPaths: TVec2[][] | undefined;
	/** How a Rail gets its paths */
	railLayout: TRailLayout | undefined;
	angle: number;
	contactAt: number;
	/** When the piece is placed: the hit time, plus the entry delay for follower rails and tunnels */
	time: number;
	hitTime: number;
	/** Position among all hits, marble by marble: settles equal times */
	hitOrder: number;
	step: number;
	/** Index into `TPlan.marbles`, -1 when the marble has no marble */
	marbleIndex: number;
	/** Anchored or scenery: follows the trajectory without sounding its hit */
	isAnchor: boolean;
	/** Pose origin relative to the marble at the event, for anchors that keep their pose */
	offset: TVec2 | null;
	/** The ride this piece gives while the marble enters at about the same speed */
	transit: TRide | null;
	/** How the marble leaves this platform while it comes out near that */
	leaves: { velocity: TVec2; spin: number } | null;
	/** Where the piece waits instead of following the marble */
	held: { dot: TVec2; velocity: TVec2 | null } | null;
}

function createPlan(project: TProject): TPlan {
	const hitTimes = new Map<string, number>();
	const hitOrder = new Map<string, number>();
	let nextHitOrder = 0;
	for (const marble of project.marbles) {
		for (const hit of marble.hits) {
			hitTimes.set(`${marble.id}/${hit.id}`, hit.time);
			hitOrder.set(`${marble.id}/${hit.id}`, nextHitOrder++);
		}
	}

	const marbles: TPlanMarble[] = project.marbles.map((marble) => ({
		entityId: marble.id,
		marbleId: marble.id,
		radius: marble.radius,
		release: marble.start.position,
		releaseVelocity: marble.start.velocity ?? { x: 0, y: 0 },
		releaseSpin: marble.start.spin ?? 0,
		releaseTime: marble.start.time,
		releaseStep: Math.ceil(marble.start.time * PHYSICS_HZ - STEP_EPSILON)
	}));

	const staticPieces: TStaticPiece[] = [];
	const events: TPlanEvent[] = [];
	const linkedHitTimes = new Map<string, number | null>();
	const defaultRadius = marbles[0]?.radius ?? DEFAULT_MARBLE_RADIUS;
	for (const entity of project.track.pieces) {
		const hitLink = tieOf(entity);
		const definition = getPieceDefinition(entity.type);
		if (definition == null) continue;
		const params = resolvePieceParams(entity.type, entity.params);
		const path = resolvePiecePath(entity.type, entity.path?.points);

		if (hitLink != null) {
			const time = hitTimes.get(`${hitLink.marbleId}/${hitLink.hitId}`) ?? null;
			linkedHitTimes.set(entity.id, time);
			const marbleIndex = marbles.findIndex((marble) => marble.marbleId === hitLink.marbleId);
			if (time == null) continue;
			// Anchored pieces and scenery follow the trajectory at their hit time plus their entry delay
			const isAnchor = !soundsHit(entity.type, hitLink);
			const eventTime = time + (isAnchor ? (params['entryDelay'] ?? 0) : 0);
			events.push({
				entityId: entity.id,
				definition,
				params,
				path,
				extraPaths: entity.path?.paths,
				railLayout: entity.layout,
				angle: entity.angle,
				contactAt: hitLink.contactAt ?? 0.5,
				time: eventTime,
				hitTime: time,
				hitOrder: hitOrder.get(`${hitLink.marbleId}/${hitLink.hitId}`) ?? 0,
				step: Math.floor(eventTime * PHYSICS_HZ + STEP_EPSILON),
				marbleIndex,
				isAnchor,
				offset: hitLink.kind === 'follows' ? (hitLink.offset ?? null) : null,
				transit: entity.ride != null && hasRide(entity.type) && entity.ride.key === rideKey(entity) ? entity.ride : null,
				held: hitLink.held ?? null,
				leaves: hitLink.kind === 'plays' && hitLink.leaves != null && hitLink.leaves.angle === entity.angle && hitLink.leaves.bounce === params['bounce'] ? { velocity: hitLink.leaves.velocity, spin: hitLink.leaves.spin } : null
			});
			continue;
		}

		const freeAt = freePosition(entity) ?? { x: 0, y: 0 };
		const layout = layoutFree(
			{
				type: entity.type,
				params,
				path,
				extraPaths: entity.path?.paths,
				layout: entity.layout,
				angle: entity.angle,
				contactAt: 0.5,
				marbleRadius: defaultRadius
			},
			freeAt
		);
		const resolved = resolvedFromLayout(entity.id, entity.type, params, layout, null, 'free', entity.layout);
		resolved.position = freeAt;
		staticPieces.push({ entityId: entity.id, definition, params, layout, resolved, key: '' });
	}
	// Equal times go by marble, then hit: IDs are random, so ordering by them gives one song different tracks
	events.sort((a, b) => a.time - b.time || a.hitOrder - b.hitOrder);

	const startStep = Math.min(0, ...marbles.map((marble) => marble.releaseStep));
	const gravity = gravityOf(project);
	const endStep = Math.floor(project.length * PHYSICS_HZ + STEP_EPSILON);

	let staticLowY = Infinity;
	for (const piece of staticPieces) {
		staticLowY = Math.min(staticLowY, lowPointOf(piece.layout));
		if (piece.layout.rotor == null)
			piece.key = signature(
				JSON.stringify([piece.entityId, piece.definition.type, piece.params, piece.layout.shapes])
			);
	}

	// Each key covers everything that determines the world up to the event: marbles, windmills, every
	// earlier event and the step the event is processed at. Parkable static pieces are checked on resume.
	let chain = signature(
		JSON.stringify([
			SIGNATURE_VERSION,
			gravity,
			startStep,
			marbles,
			staticPieces
				.filter((piece) => piece.key === '')
				.map((piece) => [
					piece.entityId,
					piece.definition.type,
					piece.params,
					piece.layout.shapes,
					piece.layout.rotor
				])
		])
	);
	const eventKeys: string[] = [];
	for (const event of events) {
		eventKeys.push(signature(`${chain}|${event.step}`));
		chain = signature(
			`${chain}|${JSON.stringify([
				event.entityId,
				event.definition.type,
				event.params,
				event.path,
				event.extraPaths,
				event.railLayout,
				event.angle,
				event.contactAt,
				event.time,
				event.marbleIndex,
				event.isAnchor,
				event.offset,
				event.transit != null ? rideHash(event.transit) : null,
				event.leaves,
				event.held
			])}`
		);
	}

	return {
		gravity,
		startStep,
		endStep,
		marbles,
		staticPieces,
		staticLowY,
		events,
		eventKeys,
		linkedHitTimes
	};
}

// Run state

interface TMarbleRun {
	bodyHandle: number;
	status: 'waiting' | 'live' | 'ended';
	samples: TMarbleSample[];
}

type TColliderInfo =
	| { kind: 'marble'; marbleIndex: number }
	/** Another marble's copy in a marble's world */
	| { kind: 'proxy'; marbleIndex: number }
	/** `shape` is in world coordinates for static pieces and relative to the hub for rotors */
	| { kind: 'piece'; entityId: string; shape: TPieceShape; rotorIndex: number };

interface TPlacement {
	piece: TResolvedPiece;
	dot: TVec2 | null;
	velocity: TVec2 | null;
}

interface TRunState {
	step: number;
	eventIndex: number;
	/** Marble `i` lives in world `i` */
	marbles: TMarbleRun[];
	/** Collider info per world, by collider handle */
	colliders: Map<number, TColliderInfo>[];
	contacts: TContact[];
	placements: Map<string, TPlacement>;
	lowestPieceY: number;
	/** Every piece inserted so far, in insertion order */
	pieces: TPieceRecord[];
	/** Collider handles per piece and world, empty while parked there */
	pieceHandles: number[][][];
	rotors: TRotorRun[];
	/** Proxy body handle per world and other marble, -1 while that marble is far */
	proxies: number[][];
	/** Touching collider count per marble index and piece entity, so a rail logs one contact */
	touching: Map<string, number>;
	/** Marble pairs Rapier reports in contact that have not touched yet, by `low|high` index */
	meeting: Map<string, [number, number]>;
	/** Per marble bounds of complete sample chunks, derived from samples and never snapshotted */
	chunkBounds: number[][];
	/** Per marble the ride it is taking, null while physics moves it */
	rides: (TActiveRide | null)[];
	/** Per marble the platform that says how it leaves, until `LEAVE_STEPS` after its hit */
	leaving: (TLeaving | null)[];
}

interface TLeaving {
	entityId: string;
	step: number;
	velocity: TVec2;
	spin: number;
}

/** A marble following a stored ride */
interface TActiveRide {
	entityId: string;
	transit: TRide;
	startStep: number;
	origin: TVec2;
	angle: number;
}

interface TPieceRecord {
	entityId: string;
	definition: TPieceDefinition;
	params: Record<string, number>;
	shapes: TPieceShape[];
	/** Shape bounds, or the disc a windmill's blades sweep */
	bounds: TBounds2;
	/** Index into `TRunState.rotors`, -1 for static pieces */
	rotorIndex: number;
	rotor: TRotorLayout | null;
	/** `TStaticPiece.key` of parkable static pieces, empty for windmills and placed pieces */
	key: string;
}

/**
 * A windmill is in the world of every marble that could reach it. The first of those worlds drives it and
 * the copies in the others follow its pose each step. In no world it turns on by its motor or damping.
 */
interface TRotorRun {
	entityId: string;
	/** Body handle per world, -1 while parked there */
	bodyHandles: number[];
	hub: TVec2;
	motorSpeed: number;
	damping: number;
	/** Angular velocity after the last step */
	spin: number;
	/** The disc the blades sweep */
	bounds: TBounds2;
	motion: TPieceMotionSample[];
}

interface TSnapshot {
	worlds: Uint8Array[];
	step: number;
	eventIndex: number;
	marbles: {
		bodyHandle: number;
		status: TMarbleRun['status'];
		samples: TMarbleSample[];
		count: number;
	}[];
	colliders: Map<number, TColliderInfo>[];
	contacts: TContact[];
	contactCount: number;
	placements: Map<string, TPlacement>;
	lowestPieceY: number;
	pieces: TPieceRecord[];
	pieceHandles: number[][][];
	rotors: (Omit<TRotorRun, 'motion'> & { motion: TPieceMotionSample[]; count: number })[];
	proxies: number[][];
	touching: Map<string, number>;
	meeting: Map<string, [number, number]>;
	staticLowY: number;
	rides: (TActiveRide | null)[];
	leaving: (TLeaving | null)[];
}

function createInitialState(plan: TPlan): TRunState {
	const state: TRunState = {
		step: plan.startStep,
		eventIndex: 0,
		marbles: plan.marbles.map(() => ({ bodyHandle: -1, status: 'waiting', samples: [] })),
		colliders: plan.marbles.map(() => new Map()),
		contacts: [],
		placements: new Map(),
		lowestPieceY: Infinity,
		pieces: [],
		pieceHandles: [],
		rotors: [],
		proxies: plan.marbles.map(() => plan.marbles.map(() => -1)),
		touching: new Map(),
		meeting: new Map(),
		chunkBounds: plan.marbles.map(() => []),
		rides: plan.marbles.map(() => null),
		leaving: plan.marbles.map(() => null)
	};
	// Every static piece starts parked; the first parking check brings in those a marble can reach
	for (const piece of plan.staticPieces) {
		if (piece.key === '')
			insertPiece(state, piece.entityId, piece.definition, piece.params, piece.layout, false);
		else {
			state.pieces.push(staticRecord(piece));
			state.pieceHandles.push(plan.marbles.map(() => []));
		}
	}
	return state;
}

function staticRecord(piece: TStaticPiece): TPieceRecord {
	return {
		entityId: piece.entityId,
		definition: piece.definition,
		params: piece.params,
		shapes: piece.layout.shapes,
		bounds: shapesBounds(piece.layout.shapes),
		rotorIndex: -1,
		rotor: null,
		key: piece.key
	};
}

function lowPointOf(layout: TPieceLayout): number {
	return layout.box != null ? layout.box.cy : shapesBounds(layout.shapes).minY;
}

function takeSnapshot(worlds: RAPIER.World[], plan: TPlan, state: TRunState): TSnapshot {
	return {
		worlds: worlds.map((world) => world.takeSnapshot()),
		step: state.step,
		eventIndex: state.eventIndex,
		marbles: state.marbles.map((marble) => ({
			bodyHandle: marble.bodyHandle,
			status: marble.status,
			samples: marble.samples,
			count: marble.samples.length
		})),
		colliders: state.colliders.map((colliders) => new Map(colliders)),
		contacts: state.contacts,
		contactCount: state.contacts.length,
		placements: new Map(state.placements),
		lowestPieceY: state.lowestPieceY,
		pieces: state.pieces.slice(),
		pieceHandles: state.pieceHandles.map((handles) => handles.slice()),
		rotors: state.rotors.map((rotor) => ({
			...rotor,
			bodyHandles: rotor.bodyHandles.slice(),
			count: rotor.motion.length
		})),
		proxies: state.proxies.map((proxies) => proxies.slice()),
		touching: new Map(state.touching),
		meeting: new Map(state.meeting),
		staticLowY: plan.staticLowY,
		rides: state.rides.slice(),
		leaving: state.leaving.slice()
	};
}

function restoreState(snapshot: TSnapshot): TRunState {
	return {
		step: snapshot.step,
		eventIndex: snapshot.eventIndex,
		marbles: snapshot.marbles.map((marble) => ({
			bodyHandle: marble.bodyHandle,
			status: marble.status,
			samples: marble.samples.slice(0, marble.count)
		})),
		colliders: snapshot.colliders.map((colliders) => new Map(colliders)),
		contacts: snapshot.contacts.slice(0, snapshot.contactCount),
		placements: new Map(snapshot.placements),
		lowestPieceY: snapshot.lowestPieceY,
		pieces: snapshot.pieces.slice(),
		pieceHandles: snapshot.pieceHandles.map((handles) => handles.slice()),
		rotors: snapshot.rotors.map(({ count, ...rotor }) => ({
			...rotor,
			bodyHandles: rotor.bodyHandles.slice(),
			motion: rotor.motion.slice(0, count)
		})),
		proxies: snapshot.proxies.map((proxies) => proxies.slice()),
		touching: new Map(snapshot.touching),
		meeting: new Map(snapshot.meeting),
		chunkBounds: snapshot.marbles.map(() => []),
		rides: snapshot.rides.slice(),
		leaving: snapshot.leaving.slice()
	};
}

function trimCache(cache: Map<string, TSnapshot>): Map<string, TSnapshot> {
	if (cache.size <= MAX_SNAPSHOTS) return cache;
	// Keep snapshots spread evenly over the run
	const entries = [...cache.entries()];
	const stride = entries.length / MAX_SNAPSHOTS;
	const trimmed = new Map<string, TSnapshot>();
	for (let i = 0; i < MAX_SNAPSHOTS; i++) {
		const entry = entries[Math.floor(i * stride)];
		if (entry != null) trimmed.set(entry[0], entry[1]);
	}
	return trimmed;
}

// Stepping

function advance(
	worlds: RAPIER.World[],
	plan: TPlan,
	state: TRunState,
	cache: Map<string, TSnapshot>,
	resumeIndex: number
): number {
	const queues = worlds.map(() => new RAPIER.EventQueue(true));
	let steps = 0;
	for (;;) {
		const hasReleased = releaseMarbles(worlds, plan, state);
		for (;;) {
			const event = plan.events[state.eventIndex];
			if (event == null || event.step > state.step) break;
			if (state.eventIndex !== resumeIndex) {
				cache.set(plan.eventKeys[state.eventIndex] ?? '', takeSnapshot(worlds, plan, state));
			}
			processEvent(worlds, plan, state, event);
			state.eventIndex++;
		}
		if (state.step >= plan.endStep) break;
		if (hasReleased || state.step % PARKING_INTERVAL === 0) parkPieces(worlds, plan, state);
		if (worlds.length > 1) updateProxies(worlds, plan, state);
		followCopies(worlds, state);

		for (let k = 0; k < worlds.length; k++) worlds[k]?.step(queues[k]);
		state.step++;
		steps++;
		followRides(worlds, plan, state);
		sampleMarbles(worlds, plan, state);
		sampleRotors(worlds, state);
		for (let k = 0; k < worlds.length; k++) {
			queues[k]?.drainCollisionEvents((handleA, handleB, started) => {
				recordContact(plan, state, k, handleA, handleB, started);
			});
		}
		for (const key of [...state.meeting.keys()]) recordMarbleContact(plan, state, key);
	}
	for (const queue of queues) queue.free();
	return steps;
}

/** Releases marbles due at the current step and returns whether any entered */
function releaseMarbles(worlds: RAPIER.World[], plan: TPlan, state: TRunState): boolean {
	let hasReleased = false;
	for (let i = 0; i < plan.marbles.length; i++) {
		const marble = plan.marbles[i];
		const run = state.marbles[i];
		const world = worlds[i];
		if (
			marble == null ||
			run == null ||
			world == null ||
			run.status !== 'waiting' ||
			marble.releaseStep > state.step
		)
			continue;
		const time = state.step / PHYSICS_HZ;
		// The marble enters on the first step at or after its release time, moved along its free flight
		const { position, velocity } = ballistic(
			marble.release,
			marble.releaseVelocity,
			Math.max(0, time - marble.releaseTime),
			plan.gravity
		);
		const body = world.createRigidBody(
			marbleBodyDesc().setTranslation(position.x, position.y, MARBLE_Z).setLinvel(velocity.x, velocity.y, 0).setAngvel({ x: 0, y: 0, z: marble.releaseSpin })
		);
		const collider = world.createCollider(
			marbleColliderDesc(marble.radius).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
			body
		);
		state.colliders[i]?.set(collider.handle, { kind: 'marble', marbleIndex: i });
		run.bodyHandle = body.handle;
		run.status = 'live';
		run.samples.push({ time, position, angle: 0, velocity });
		hasReleased = true;
	}
	return hasReleased;
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

function marbleBodyDesc(): RAPIER.RigidBodyDesc {
	return RAPIER.RigidBodyDesc.dynamic()
		.enabledTranslations(true, true, false)
		.enabledRotations(false, false, true)
		.setCcdEnabled(true)
		.setCanSleep(false);
}

function marbleColliderDesc(radius: number): RAPIER.ColliderDesc {
	return RAPIER.ColliderDesc.ball(radius)
		.setDensity(GLASS_DENSITY)
		.setRestitution(MARBLE_RESTITUTION)
		.setFriction(MARBLE_FRICTION);
}

/** Puts every marble on a ride where its ride says, after the step moved it; the last frame hands it back to physics */
function followRides(worlds: RAPIER.World[], plan: TPlan, state: TRunState): void {
	for (let i = 0; i < state.rides.length; i++) {
		const leaving = state.leaving[i];
		if (leaving != null && state.step >= leaving.step) {
			state.leaving[i] = null;
			const body = state.marbles[i]?.status === 'live' ? worlds[i]?.getRigidBody(state.marbles[i]?.bodyHandle ?? -1) : null;
			const velocity = body?.linvel();
			const isClose = velocity != null && Math.hypot(velocity.x - leaving.velocity.x, velocity.y - leaving.velocity.y) <= rideTolerance(plan.gravity / gravityOf({}));
			if (body != null && isClose) {
				body.setLinvel({ x: leaving.velocity.x, y: leaving.velocity.y, z: 0 }, false);
				body.setAngvel({ x: 0, y: 0, z: leaving.spin }, false);
			}
		}
		const ride = state.rides[i];
		const run = state.marbles[i];
		if (ride == null || run == null || run.status !== 'live') continue;
		const body = worlds[i]?.getRigidBody(run.bodyHandle);
		if (body == null) continue;
		const index = state.step - ride.startStep - 1;
		const last = rideLength(ride.transit) - 1;
		if (index >= last) {
			const { exit } = ride.transit;
			body.setTranslation({ x: ride.origin.x + exit.position.x, y: ride.origin.y + exit.position.y, z: MARBLE_Z }, false);
			body.setRotation(zRotation(ride.angle + exit.angle), false);
			body.setLinvel({ x: exit.velocity.x, y: exit.velocity.y, z: 0 }, false);
			body.setAngvel({ x: 0, y: 0, z: exit.spin }, false);
			state.rides[i] = null;
			continue;
		}
		const frame = rideFrame(ride.transit, index);
		const velocity = rideVelocity(ride.transit, index);
		body.setTranslation({ x: ride.origin.x + frame.x, y: ride.origin.y + frame.y, z: MARBLE_Z }, false);
		body.setRotation(zRotation(ride.angle + frame.angle), false);
		body.setLinvel({ x: velocity.x, y: velocity.y, z: 0 }, false);
		const after = rideFrame(ride.transit, index + 1);
		body.setAngvel({ x: 0, y: 0, z: (after.angle - frame.angle) * PHYSICS_HZ }, false);
	}
}

function sampleMarbles(worlds: RAPIER.World[], plan: TPlan, state: TRunState): void {
	const time = state.step / PHYSICS_HZ;
	for (let i = 0; i < state.marbles.length; i++) {
		const run = state.marbles[i];
		const marble = plan.marbles[i];
		const world = worlds[i];
		if (run == null || marble == null || world == null || run.status !== 'live') continue;
		const body = world.getRigidBody(run.bodyHandle);
		const translation = body.translation();
		const lowest = Math.min(marble.release.y, state.lowestPieceY, plan.staticLowY);
		if (translation.y < lowest - FALL_LIMIT) {
			for (let c = 0; c < body.numColliders(); c++) state.colliders[i]?.delete(body.collider(c).handle);
			world.removeRigidBody(body);
			run.status = 'ended';
			// Its copies leave the other worlds with it
			for (let k = 0; k < worlds.length; k++) removeProxy(worlds, state, k, i);
			continue;
		}
		const rotation = body.rotation();
		const linvel = body.linvel();
		run.samples.push({
			time,
			position: { x: translation.x, y: translation.y },
			angle: 2 * Math.atan2(rotation.z, rotation.w),
			velocity: { x: linvel.x, y: linvel.y }
		});
	}
}

function sampleRotors(worlds: RAPIER.World[], state: TRunState): void {
	const time = state.step / PHYSICS_HZ;
	for (const rotor of state.rotors) {
		const previous = rotor.motion[rotor.motion.length - 1]?.angle ?? 0;
		const lead = rotor.bodyHandles.findIndex((handle) => handle >= 0);
		let angle: number;
		if (lead >= 0) {
			const body = worlds[lead]?.getRigidBody(rotor.bodyHandles[lead] ?? -1);
			if (body == null) continue;
			const rotation = body.rotation();
			const raw = 2 * Math.atan2(rotation.z, rotation.w);
			angle = previous + wrapAngle(raw - previous);
			rotor.spin = body.angvel().z;
		} else {
			// Parked everywhere: a motor keeps its speed, a free hub slows down as Rapier damps it
			rotor.spin = rotor.motorSpeed !== 0 ? rotor.motorSpeed : rotor.spin / (1 + DT * rotor.damping);
			angle = previous + rotor.spin * DT;
		}
		rotor.motion.push({ time, angle });
	}
}

/**
 * Before each step, windmill copies take the pose of the copy that drives them, and proxies take the state
 * of the marble they stand for, so every world sees the same windmills and marbles.
 */
function followCopies(worlds: RAPIER.World[], state: TRunState): void {
	for (const rotor of state.rotors) {
		const lead = rotor.bodyHandles.findIndex((handle) => handle >= 0);
		if (lead < 0) continue;
		const angle = rotor.motion[rotor.motion.length - 1]?.angle ?? 0;
		for (let k = lead + 1; k < worlds.length; k++) {
			const handle = rotor.bodyHandles[k] ?? -1;
			if (handle < 0) continue;
			const body = worlds[k]?.getRigidBody(handle);
			body?.setRotation(zRotation(angle), false);
			body?.setAngvel({ x: 0, y: 0, z: rotor.spin }, false);
		}
	}
	for (let k = 0; k < worlds.length; k++) {
		for (let j = 0; j < worlds.length; j++) {
			const handle = state.proxies[k]?.[j] ?? -1;
			if (handle < 0) continue;
			const source = worlds[j]?.getRigidBody(state.marbles[j]?.bodyHandle ?? -1);
			const proxy = worlds[k]?.getRigidBody(handle);
			if (source == null || proxy == null) continue;
			copyBodyState(source, proxy);
		}
	}
}

function copyBodyState(source: RAPIER.RigidBody, target: RAPIER.RigidBody): void {
	target.setTranslation(source.translation(), false);
	target.setRotation(source.rotation(), false);
	target.setLinvel(source.linvel(), false);
	target.setAngvel(source.angvel(), false);
}

function insertPiece(
	state: TRunState,
	entityId: string,
	definition: TPieceDefinition,
	params: Record<string, number>,
	layout: TPieceLayout,
	isPlaced = true
): number {
	let bounds = shapesBounds(layout.shapes);
	let rotorIndex = -1;
	if (layout.rotor != null) {
		rotorIndex = state.rotors.length;
		bounds = sweptDisc(layout.rotor);
		// Adding zero turns the -0 of step 0 into 0
		const time = state.step / PHYSICS_HZ + 0;
		state.rotors.push({
			entityId,
			bodyHandles: state.marbles.map(() => -1),
			hub: layout.rotor.hub,
			motorSpeed: layout.rotor.motorSpeed,
			damping: layout.rotor.damping,
			spin: layout.rotor.motorSpeed,
			bounds,
			motion: [{ time, angle: layout.rotor.angle }]
		});
	}
	state.pieces.push({
		entityId,
		definition,
		params,
		shapes: layout.shapes,
		bounds,
		rotorIndex,
		rotor: layout.rotor,
		key: ''
	});
	state.pieceHandles.push(state.marbles.map(() => []));
	// Static pieces count through `TPlan.staticLowY`
	if (isPlaced) state.lowestPieceY = Math.min(state.lowestPieceY, lowPointOf(layout));
	return state.pieces.length - 1;
}

/** Bounds of the disc a windmill's blades sweep around its hub */
function sweptDisc(rotor: TRotorLayout): TBounds2 {
	const local = shapesBounds(rotor.localShapes);
	const reach = Math.max(
		Math.hypot(local.minX, local.minY),
		Math.hypot(local.maxX, local.maxY),
		Math.hypot(local.minX, local.maxY),
		Math.hypot(local.maxX, local.minY)
	);
	return {
		minX: rotor.hub.x - reach,
		minY: rotor.hub.y - reach,
		maxX: rotor.hub.x + reach,
		maxY: rotor.hub.y + reach
	};
}

function addPieceColliders(
	world: RAPIER.World,
	colliders: Map<number, TColliderInfo>,
	piece: TPieceRecord
): number[] {
	const { definition, params } = piece;
	const handles: number[] = [];
	for (const shape of piece.shapes) {
		const desc = staticColliderDesc(shape, params, definition);
		if (desc == null) continue;
		const collider = world.createCollider(
			desc
				.setRestitution(pieceRestitution(definition, params))
				.setFriction(definition.friction)
				.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
				.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
				.setCollisionGroups(STATIC_GROUPS)
		);
		colliders.set(collider.handle, {
			kind: 'piece',
			entityId: piece.entityId,
			shape,
			rotorIndex: -1
		});
		handles.push(collider.handle);
	}
	return handles;
}

function staticColliderDesc(
	shape: TPieceShape,
	params: Record<string, number>,
	definition: TPieceDefinition
): RAPIER.ColliderDesc | null {
	switch (shape.kind) {
		case 'box': {
			const { box } = shape;
			return RAPIER.ColliderDesc.cuboid(box.halfLength, box.halfThickness, COLLIDER_DEPTH / 2)
				.setTranslation(box.cx, box.cy, definition.wallOffset + COLLIDER_DEPTH / 2)
				.setRotation(zRotation(box.angle));
		}
		case 'capsule': {
			// Rapier capsules run along y; wires sit in the marble plane so contact normals stay in xy
			const dx = shape.b.x - shape.a.x;
			const dy = shape.b.y - shape.a.y;
			const length = Math.hypot(dx, dy);
			const desc =
				length > 1e-9
					? RAPIER.ColliderDesc.capsule(length / 2, shape.radius).setRotation(
							zRotation(Math.atan2(dy, dx) - Math.PI / 2)
						)
					: RAPIER.ColliderDesc.ball(shape.radius);
			return desc.setTranslation(
				(shape.a.x + shape.b.x) / 2,
				(shape.a.y + shape.b.y) / 2,
				MARBLE_Z
			);
		}
		case 'ball':
			return RAPIER.ColliderDesc.ball(shape.radius).setTranslation(
				shape.center.x,
				shape.center.y,
				MARBLE_Z
			);
	}
}

/**
 * A windmill is a body that may only turn around the wall normal through its hub. Without a motor it is
 * dynamic with angular damping; with a motor it is kinematic at a fixed angular velocity, so strikes
 * never slow it down. It enters a world at the windmill's current angle and spin.
 */
function addRotorBody(
	world: RAPIER.World,
	colliders: Map<number, TColliderInfo>,
	piece: TPieceRecord,
	run: TRotorRun
): { body: number; handles: number[] } | null {
	const rotor = piece.rotor;
	if (rotor == null) return null;
	const angle = run.motion[run.motion.length - 1]?.angle ?? rotor.angle;
	const hasMotor = rotor.motorSpeed !== 0;
	const bodyDesc = (
		hasMotor
			? RAPIER.RigidBodyDesc.kinematicVelocityBased().setAngvel({ x: 0, y: 0, z: rotor.motorSpeed })
			: RAPIER.RigidBodyDesc.dynamic()
					.enabledTranslations(false, false, false)
					.enabledRotations(false, false, true)
					.setAngularDamping(rotor.damping)
					.setAngvel({ x: 0, y: 0, z: run.spin })
	)
		.setTranslation(rotor.hub.x, rotor.hub.y, MARBLE_Z)
		.setRotation(zRotation(angle))
		.setCanSleep(false);
	const body = world.createRigidBody(bodyDesc);
	const handles: number[] = [];
	for (const shape of rotor.localShapes) {
		let desc: RAPIER.ColliderDesc;
		if (shape.kind === 'box') {
			const { box } = shape;
			desc = RAPIER.ColliderDesc.cuboid(box.halfLength, box.halfThickness, COLLIDER_DEPTH / 2)
				.setTranslation(box.cx, box.cy, piece.definition.wallOffset + COLLIDER_DEPTH / 2 - MARBLE_Z)
				.setRotation(zRotation(box.angle));
		} else if (shape.kind === 'ball') {
			desc = RAPIER.ColliderDesc.ball(shape.radius).setTranslation(
				shape.center.x,
				shape.center.y,
				0
			);
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
		colliders.set(collider.handle, {
			kind: 'piece',
			entityId: piece.entityId,
			shape,
			rotorIndex: piece.rotorIndex
		});
		handles.push(collider.handle);
	}
	return { body: body.handle, handles };
}

function zRotation(angle: number): RAPIER.Rotation {
	return { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) };
}

interface TReach {
	x: number;
	y: number;
	reach: number;
}

/**
 * How far each live marble could get before the next check, null for marbles not live. The speed bound is
 * twice the marble's own speed plus `SPEED_SLACK`; a collision with another marble can add that marble's
 * speed and a blade strike twice the tip speed, so those count when they are near. A far marble never
 * widens another's reach.
 */
function marbleReaches(plan: TPlan, state: TRunState): (TReach | null)[] {
	const horizon = (PARKING_INTERVAL + 1) * DT;
	const reachAt = (speed: number, radius: number): number =>
		speed * horizon - 0.5 * plan.gravity * horizon * horizon + radius + PARKING_MARGIN;
	const own = state.marbles.map((run, i) => {
		const sample = run.samples[run.samples.length - 1];
		const marble = plan.marbles[i];
		if (run.status !== 'live' || sample == null || marble == null) return null;
		const speed = Math.hypot(sample.velocity.x, sample.velocity.y);
		const reach = reachAt(2 * speed + SPEED_SLACK, marble.radius);
		return { x: sample.position.x, y: sample.position.y, reach, speed, radius: marble.radius };
	});
	return own.map((marble, k) => {
		if (marble == null) return null;
		let fastest = marble.speed;
		for (let j = 0; j < own.length; j++) {
			const other = own[j];
			if (j === k || other == null) continue;
			const span = marble.reach + other.reach;
			if (Math.abs(other.x - marble.x) <= span && Math.abs(other.y - marble.y) <= span)
				fastest = Math.max(fastest, other.speed);
		}
		let tip = 0;
		for (const rotor of state.rotors) {
			if (isWithin(marble, rotor.bounds)) tip = Math.max(tip, Math.abs(rotor.spin) * rotorRadius(rotor));
		}
		const reach = reachAt(2 * fastest + SPEED_SLACK + 2 * tip, marble.radius);
		return { x: marble.x, y: marble.y, reach };
	});
}

function rotorRadius(rotor: TRotorRun): number {
	return (rotor.bounds.maxX - rotor.bounds.minX) / 2;
}

function isWithin(marble: TReach | null, bounds: TBounds2): boolean {
	return (
		marble != null &&
		marble.x >= bounds.minX - marble.reach &&
		marble.x <= bounds.maxX + marble.reach &&
		marble.y >= bounds.minY - marble.reach &&
		marble.y <= bounds.maxY + marble.reach
	);
}

/**
 * Keeps in each marble's world only the pieces that marble could reach before the next check.
 * With `only`, updates that piece alone, right after it is placed.
 */
function parkPieces(worlds: RAPIER.World[], plan: TPlan, state: TRunState, only?: number): void {
	const reaches = marbleReaches(plan, state);
	const index = pieceIndex(state);
	for (let k = 0; k < worlds.length; k++) {
		const world = worlds[k];
		const colliders = state.colliders[k];
		const present = index.present[k];
		if (world == null || colliders == null || present == null) continue;
		const reach = reaches[k] ?? null;
		// Pieces in the grid cells the reach covers plus those in the world, in insertion order as a full
		// pass over every piece would update them
		let candidates: number[];
		if (only != null) candidates = [only];
		else {
			const found = new Set(present);
			if (reach != null) index.grid.query(reach.x, reach.y, reach.reach, found);
			candidates = [...found].sort((a, b) => a - b);
		}
		for (const i of candidates) {
			const piece = state.pieces[i];
			const handles = state.pieceHandles[i];
			if (piece == null || handles == null) continue;
			const isNear = isWithin(reach, piece.bounds);
			const rotor = state.rotors[piece.rotorIndex];
			if (rotor != null) {
				const body = rotor.bodyHandles[k] ?? -1;
				if (isNear && body < 0) {
					const added = addRotorBody(world, colliders, piece, rotor);
					if (added != null) {
						rotor.bodyHandles[k] = added.body;
						handles[k] = added.handles;
						present.add(i);
					}
				} else if (!isNear && body >= 0) {
					world.removeRigidBody(world.getRigidBody(body));
					for (const handle of handles[k] ?? []) colliders.delete(handle);
					rotor.bodyHandles[k] = -1;
					handles[k] = [];
					present.delete(i);
				}
				continue;
			}
			const current = handles[k] ?? [];
			if (isNear && !current.length) {
				handles[k] = addPieceColliders(world, colliders, piece);
				if (handles[k]?.length) present.add(i);
			} else if (!isNear && current.length > 0) {
				for (const handle of current) {
					world.removeCollider(world.getCollider(handle), false);
					colliders.delete(handle);
				}
				handles[k] = [];
				present.delete(i);
			}
		}
	}
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

interface TPieceIndex {
	/** Pieces covered so far, so placed pieces are added as they come */
	count: number;
	grid: PieceGrid;
	/** Per world, the pieces with colliders in it */
	present: Set<number>[];
}

const pieceIndexes = new WeakMap<TRunState, TPieceIndex>();

/** Grid and per world presence of the run's pieces, derived from the state and never snapshotted */
function pieceIndex(state: TRunState): TPieceIndex {
	let index = pieceIndexes.get(state);
	if (index == null) {
		index = {
			count: 0,
			grid: new PieceGrid(),
			present: state.marbles.map((_, k) => {
				const present = new Set<number>();
				state.pieceHandles.forEach((handles, i) => {
					const body = state.rotors[state.pieces[i]?.rotorIndex ?? -1]?.bodyHandles[k] ?? -1;
					if ((handles[k]?.length ?? 0) > 0 || body >= 0) present.add(i);
				});
				return present;
			})
		};
		pieceIndexes.set(state, index);
	}
	for (; index.count < state.pieces.length; index.count++) {
		const piece = state.pieces[index.count];
		if (piece != null) index.grid.add(index.count, piece.bounds);
	}
	return index;
}

/**
 * Another marble enters a marble's world as a proxy only while the two could touch within the next two
 * steps. Checked every step with the marbles' own speeds, so neighboring marbles, which pass within a
 * parking reach of each other all the time, stay apart.
 */
function updateProxies(worlds: RAPIER.World[], plan: TPlan, state: TRunState): void {
	const span = 2 * DT;
	for (let k = 0; k < worlds.length; k++) {
		for (let j = 0; j < worlds.length; j++) {
			if (j === k) continue;
			const a = state.marbles[k];
			const b = state.marbles[j];
			const sampleA = a?.samples[a.samples.length - 1];
			const sampleB = b?.samples[b.samples.length - 1];
			let isNear = false;
			if (a?.status === 'live' && b?.status === 'live' && sampleA != null && sampleB != null) {
				const gap =
					Math.hypot(
						sampleA.position.x - sampleB.position.x,
						sampleA.position.y - sampleB.position.y
					) -
					(plan.marbles[k]?.radius ?? 0) -
					(plan.marbles[j]?.radius ?? 0);
				const closing =
					Math.hypot(sampleA.velocity.x, sampleA.velocity.y) +
					Math.hypot(sampleB.velocity.x, sampleB.velocity.y) +
					1;
				isNear = gap <= closing * span + PARKING_MARGIN;
			}
			const handle = state.proxies[k]?.[j] ?? -1;
			if (isNear && handle < 0) addProxy(worlds, plan, state, k, j);
			else if (!isNear && handle >= 0) removeProxy(worlds, state, k, j);
		}
	}
}

/**
 * A proxy is a dynamic copy of marble `j` in marble `k`'s world. It takes `j`'s state before every step, so
 * the contact between the two is solved in both worlds as between two marbles, and each world keeps only
 * its own marble's response.
 */
function addProxy(
	worlds: RAPIER.World[],
	plan: TPlan,
	state: TRunState,
	k: number,
	j: number
): void {
	const world = worlds[k];
	const source = worlds[j]?.getRigidBody(state.marbles[j]?.bodyHandle ?? -1);
	const marble = plan.marbles[j];
	const proxies = state.proxies[k];
	if (world == null || source == null || marble == null || proxies == null) return;
	const body = world.createRigidBody(marbleBodyDesc());
	copyBodyState(source, body);
	const collider = world.createCollider(
		marbleColliderDesc(marble.radius).setCollisionGroups(PROXY_GROUPS),
		body
	);
	state.colliders[k]?.set(collider.handle, { kind: 'proxy', marbleIndex: j });
	proxies[j] = body.handle;
}

function removeProxy(worlds: RAPIER.World[], state: TRunState, k: number, j: number): void {
	const world = worlds[k];
	const proxies = state.proxies[k];
	const handle = proxies?.[j] ?? -1;
	if (world == null || proxies == null || handle < 0) return;
	const body = world.getRigidBody(handle);
	for (let c = 0; c < body.numColliders(); c++) state.colliders[k]?.delete(body.collider(c).handle);
	world.removeRigidBody(body);
	proxies[j] = -1;
	if (k < j) state.meeting.delete(`${k}|${j}`);
}

// Placement by construction: the piece appears at its hit time with its contact face touching the marble

function processEvent(
	worlds: RAPIER.World[],
	plan: TPlan,
	state: TRunState,
	event: TPlanEvent
): void {
	const marble = plan.marbles[event.marbleIndex];
	const run = state.marbles[event.marbleIndex];
	const last = run?.samples[run.samples.length - 1];
	const unreached: TPlacement = {
		piece: {
			entityId: event.entityId,
			type: event.definition.type,
			...(event.railLayout != null ? { layout: event.railLayout } : {}),
			position: marble?.release ?? { x: 0, y: 0 },
			angle: event.angle,
			params: event.params,
			contactPoint: null,
			contactNormal: null,
			hitTime: event.hitTime,
			status: 'unreached'
		},
		dot: null,
		velocity: null
	};
	if (event.isAnchor) unreached.piece.entryTime = event.time;
	if (event.held != null && marble != null) {
		const input = { type: event.definition.type, params: event.params, path: event.path, extraPaths: event.extraPaths, layout: event.railLayout, angle: event.angle, contactAt: event.contactAt, marbleRadius: marble.radius };
		const { dot, velocity } = event.held;
		const layout = event.offset != null ? layoutFree(input, { x: dot.x + event.offset.x, y: dot.y + event.offset.y }) : layoutAtMarble(input, dot, velocity);
		const resolved = resolvedFromLayout(event.entityId, event.definition.type, event.params, layout, event.hitTime, 'held', event.railLayout);
		if (unreached.piece.entryTime != null) resolved.entryTime = unreached.piece.entryTime;
		state.placements.set(event.entityId, { piece: resolved, dot, velocity });
		const held = insertPiece(state, event.entityId, event.definition, event.params, layout);
		parkPieces(worlds, plan, state, held);
		return;
	}
	if (
		marble == null ||
		run == null ||
		last == null ||
		run.status !== 'live' ||
		event.step !== state.step
	) {
		state.placements.set(event.entityId, unreached);
		return;
	}

	const { position, velocity } = ballistic(
		last.position,
		last.velocity,
		Math.max(0, event.time - last.time),
		plan.gravity
	);
	const input: TLayoutInput = {
		type: event.definition.type,
		params: event.params,
		path: event.path,
		extraPaths: event.extraPaths,
		layout: event.railLayout,
		angle: event.angle,
		contactAt: event.contactAt,
		marbleRadius: marble.radius
	};
	// An anchor with an offset keeps its pose relative to the marble; others touch the marble
	const layout =
		event.offset != null
			? layoutFree(input, { x: position.x + event.offset.x, y: position.y + event.offset.y })
			: layoutAtMarble(input, position, velocity);
	const isBlocked = isLayoutBlocked(plan, state, layout, event.time);
	const resolved = resolvedFromLayout(
		event.entityId,
		event.definition.type,
		event.params,
		layout,
		event.hitTime,
		isBlocked ? 'blocked' : 'placed',
		event.railLayout
	);
	if (unreached.piece.entryTime != null) resolved.entryTime = unreached.piece.entryTime;
	state.placements.set(event.entityId, { piece: resolved, dot: position, velocity });
	if (isBlocked) return;
	const index = insertPiece(state, event.entityId, event.definition, event.params, layout);
	// It touches its marble, so it enters that marble's world at once
	parkPieces(worlds, plan, state, index);
	if (event.leaves != null) state.leaving[event.marbleIndex] = { entityId: event.entityId, step: state.step + LEAVE_STEPS, velocity: event.leaves.velocity, spin: event.leaves.spin };
	if (event.transit != null && Math.hypot(last.velocity.x - event.transit.entry.x, last.velocity.y - event.transit.entry.y) <= rideTolerance(plan.gravity / gravityOf({}))) {
		state.rides[event.marbleIndex] = { entityId: event.entityId, transit: event.transit, startStep: state.step, origin: last.position, angle: last.angle };
	}
}

function resolvedFromLayout(
	entityId: string,
	type: string,
	params: Record<string, number>,
	layout: TPieceLayout,
	hitTime: number | null,
	status: TResolvedPiece['status'],
	railLayout: TRailLayout | undefined
): TResolvedPiece {
	const resolved: TResolvedPiece = {
		entityId,
		type,
		...(railLayout != null ? { layout: railLayout } : {}),
		position: layout.position,
		angle: layout.angle,
		params,
		contactPoint: layout.contactPoint,
		contactNormal: layout.contactNormal,
		hitTime,
		status
	};
	if (layout.box == null) resolved.shapes = layout.shapes;
	if (layout.path != null) resolved.path = layout.path;
	if (layout.paths != null) resolved.paths = layout.paths;
	return resolved;
}

const CHUNK = 64;

/**
 * True when any earlier sample of any marble overlaps the piece. A motor windmill is checked against its
 * blades where they were at each sample's time, since it turns before its hit.
 */
function isLayoutBlocked(
	plan: TPlan,
	state: TRunState,
	layout: TPieceLayout,
	time: number
): boolean {
	const rotor = layout.rotor;
	const hasMotor = rotor != null && rotor.motorSpeed !== 0;
	const bounds = hasMotor ? sweptDisc(rotor) : shapesBounds(layout.shapes);
	const distance = (sample: TMarbleSample): number => {
		if (!hasMotor) {
			let d = Infinity;
			for (const shape of layout.shapes)
				d = Math.min(d, shapeDistance(shape, sample.position.x, sample.position.y));
			return d;
		}
		// Moves the sample into the rotor frame at its time instead of turning every blade
		const angle = rotor.angle + rotor.motorSpeed * (sample.time - time);
		const cos = Math.cos(-angle);
		const sin = Math.sin(-angle);
		const dx = sample.position.x - rotor.hub.x;
		const dy = sample.position.y - rotor.hub.y;
		const x = dx * cos - dy * sin;
		const y = dx * sin + dy * cos;
		let d = Infinity;
		for (const shape of rotor.localShapes) d = Math.min(d, shapeDistance(shape, x, y));
		return d;
	};
	for (let m = 0; m < state.marbles.length; m++) {
		const run = state.marbles[m];
		const marble = plan.marbles[m];
		const chunkBounds = state.chunkBounds[m];
		if (run == null || marble == null || chunkBounds == null) continue;
		const reach = marble.radius - BLOCK_TOLERANCE;
		const minX = bounds.minX - reach;
		const maxX = bounds.maxX + reach;
		const minY = bounds.minY - reach;
		const maxY = bounds.maxY + reach;
		const { samples } = run;
		updateChunkBounds(samples, chunkBounds);
		for (let start = 0; start < samples.length; start += CHUNK) {
			const chunk = start / CHUNK;
			if (chunk * 4 < chunkBounds.length) {
				const isOutside =
					(chunkBounds[chunk * 4 + 2] ?? 0) < minX ||
					(chunkBounds[chunk * 4] ?? 0) > maxX ||
					(chunkBounds[chunk * 4 + 3] ?? 0) < minY ||
					(chunkBounds[chunk * 4 + 1] ?? 0) > maxY;
				if (isOutside) continue;
			}
			const end = Math.min(samples.length, start + CHUNK);
			for (let i = start; i < end; i++) {
				const sample = samples[i];
				if (sample != null && distance(sample) < reach) return true;
			}
		}
	}
	return false;
}

/** Appends min x, min y, max x, max y for every complete chunk not yet covered */
function updateChunkBounds(samples: TMarbleSample[], bounds: number[]): void {
	for (let chunk = bounds.length / 4; (chunk + 1) * CHUNK <= samples.length; chunk++) {
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (let i = chunk * CHUNK; i < (chunk + 1) * CHUNK; i++) {
			const position = samples[i]?.position;
			if (position == null) continue;
			minX = Math.min(minX, position.x);
			minY = Math.min(minY, position.y);
			maxX = Math.max(maxX, position.x);
			maxY = Math.max(maxY, position.y);
		}
		bounds.push(minX, minY, maxX, maxY);
	}
}

// Contacts

function recordContact(
	plan: TPlan,
	state: TRunState,
	worldIndex: number,
	handleA: number,
	handleB: number,
	started: boolean
): void {
	const colliders = state.colliders[worldIndex];
	const a = colliders?.get(handleA);
	const b = colliders?.get(handleB);
	if (a == null || b == null) return;
	if (a.kind === 'proxy' || b.kind === 'proxy') {
		// Both marbles' worlds see the contact; the world of the lower marble tracks it
		if (a.kind === 'piece' || b.kind === 'piece') return;
		const low = Math.min(a.marbleIndex, b.marbleIndex);
		if (low !== worldIndex) return;
		const key = `${low}|${Math.max(a.marbleIndex, b.marbleIndex)}`;
		if (started) {
			state.meeting.set(key, [low, Math.max(a.marbleIndex, b.marbleIndex)]);
			state.rides[low] = null;
			state.rides[Math.max(a.marbleIndex, b.marbleIndex)] = null;
		}
		else state.meeting.delete(key);
		return;
	}
	const pair =
		a.kind === 'marble' && b.kind === 'piece'
			? { marbleIndex: a.marbleIndex, piece: b }
			: a.kind === 'piece' && b.kind === 'marble'
				? { marbleIndex: b.marbleIndex, piece: a }
				: null;
	if (pair == null) return;
	// A piece made of several colliders logs a contact only when the marble starts touching any of them
	const key = `${pair.marbleIndex}|${pair.piece.entityId}`;
	const count = state.touching.get(key) ?? 0;
	if (!started) {
		if (count <= 1) state.touching.delete(key);
		else state.touching.set(key, count - 1);
		return;
	}
	state.touching.set(key, count + 1);
	if (count > 0) return;
	// Something else in the way ends a ride: from here physics decides what happens
	const ride = state.rides[pair.marbleIndex];
	if (ride != null && ride.entityId !== pair.piece.entityId && !ride.transit.touches.includes(pair.piece.entityId)) state.rides[pair.marbleIndex] = null;
	recordPieceContact(
		plan,
		state,
		pair.marbleIndex,
		pair.piece.entityId,
		worldShape(state, pair.piece),
		state.rotors[pair.piece.rotorIndex] ?? null
	);
}

/** World shape of a piece collider; rotor parts use the pose at the start of the step */
function worldShape(
	state: TRunState,
	info: Extract<TColliderInfo, { kind: 'piece' }>
): TPieceShape {
	const rotor = state.rotors[info.rotorIndex];
	if (rotor == null) return info.shape;
	const angle = rotor.motion[rotor.motion.length - 2]?.angle ?? rotor.motion[0]?.angle ?? 0;
	return transformShape(info.shape, rotor.hub, angle);
}

/** The state at the start of the step that produced the event, or null if the marble has no such state */
function preStepSample(run: TMarbleRun | undefined, step: number): TMarbleSample | null {
	if (run == null) return null;
	const sample = run.samples[run.samples.length - 2];
	if (sample == null || Math.round(sample.time * PHYSICS_HZ) !== step - 1) return null;
	return sample;
}

// Contact times are refined from the state at the start of the step along free flight. Rapier reports
// contacts per step, sometimes early through predictive contacts, so the search covers three steps. The
// approach speed uses the marble velocity at that time and, for windmill blades, the blade's own velocity.
function recordPieceContact(
	plan: TPlan,
	state: TRunState,
	marbleIndex: number,
	entityId: string,
	shape: TPieceShape,
	rotor: TRotorRun | null
): void {
	const marble = plan.marbles[marbleIndex];
	const run = state.marbles[marbleIndex];
	if (marble == null || run == null) return;
	const stepTime = state.step / PHYSICS_HZ;
	const pre = preStepSample(run, state.step);
	const last = run.samples[run.samples.length - 1];
	let time = stepTime;
	let center = last?.position ?? marble.release;
	let velocity = (pre ?? last)?.velocity ?? { x: 0, y: 0 };
	if (pre != null) {
		const gap = (tau: number): number => {
			const { position } = ballistic(pre.position, pre.velocity, tau, plan.gravity);
			return shapeDistance(shape, position.x, position.y) - marble.radius;
		};
		const tau = findFirstRoot(gap, 3 * DT);
		if (tau != null) {
			time = pre.time + tau;
			const flight = ballistic(pre.position, pre.velocity, tau, plan.gravity);
			center = flight.position;
			velocity = flight.velocity;
		}
	}
	const position = shapeClosestPoint(shape, center.x, center.y);
	state.contacts.push({
		time,
		marbleEntityId: marble.entityId,
		otherEntityId: entityId,
		kind: 'piece',
		position,
		speed: approachSpeed(center, velocity, position, rotor)
	});
}

/** Speed of the marble toward the surface along the contact normal, relative to the surface */
function approachSpeed(
	center: TVec2,
	velocity: TVec2,
	point: TVec2,
	rotor: TRotorRun | null
): number {
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
		const motion = rotor.motion;
		const spin =
			motion.length >= 2
				? ((motion[motion.length - 1]?.angle ?? 0) - (motion[motion.length - 2]?.angle ?? 0)) *
					PHYSICS_HZ
				: rotor.motorSpeed;
		vx += spin * (point.y - rotor.hub.y);
		vy -= spin * (point.x - rotor.hub.x);
	}
	return Math.max(0, -(vx * nx + vy * ny));
}

/**
 * Logs a marble pair Rapier reported as meeting once they touch. Contacts against a proxy start while the
 * marbles are still several steps apart, so the pair waits until free flight from the state at the start
 * of the step meets within two steps, since Rapier's speculative contact stops the marbles just short of
 * touching, or until they are within `MARBLE_SLOP` after it.
 */
function recordMarbleContact(plan: TPlan, state: TRunState, key: string): void {
	const [indexA, indexB] = state.meeting.get(key) ?? [-1, -1];
	const marbleA = plan.marbles[indexA];
	const marbleB = plan.marbles[indexB];
	const runA = state.marbles[indexA];
	const runB = state.marbles[indexB];
	if (marbleA == null || marbleB == null || runA == null || runB == null) return;
	const reach = marbleA.radius + marbleB.radius;
	let time = state.step / PHYSICS_HZ;
	let a = runA.samples[runA.samples.length - 1]?.position ?? marbleA.release;
	let b = runB.samples[runB.samples.length - 1]?.position ?? marbleB.release;
	let isTouching = Math.hypot(b.x - a.x, b.y - a.y) - reach <= MARBLE_SLOP;
	const preA = preStepSample(runA, state.step);
	const preB = preStepSample(runB, state.step);
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
	state.meeting.delete(key);
	const share = marbleA.radius / reach;
	const position = { x: a.x + (b.x - a.x) * share, y: a.y + (b.y - a.y) * share };
	state.contacts.push(
		{
			time,
			marbleEntityId: marbleA.entityId,
			otherEntityId: marbleB.entityId,
			kind: 'marble',
			position
		},
		{
			time,
			marbleEntityId: marbleB.entityId,
			otherEntityId: marbleA.entityId,
			kind: 'marble',
			position
		}
	);
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

// Result

function buildResult(project: TProject, plan: TPlan, state: TRunState): TSimulationResult {
	const staticById = new Map(plan.staticPieces.map((piece) => [piece.entityId, piece.resolved]));
	const pieces: TResolvedPiece[] = [];
	for (const entity of project.track.pieces) {
		
		if (entity == null || getPieceDefinition(entity.type) == null) continue;
		const resolved = staticById.get(entity.id) ?? state.placements.get(entity.id)?.piece;
		if (resolved != null) {
			const rotor = state.rotors.find((r) => r.entityId === entity.id);
			pieces.push(rotor != null ? { ...resolved, motion: rotorMotion(plan, rotor) } : resolved);
			continue;
		}
		// Linked pieces that were never processed: missing hit, hit after the end or before the start
		const marble = plan.marbles.find((m) => m.marbleId === tieOf(entity)?.marbleId);
		pieces.push({
			entityId: entity.id,
			type: entity.type,
			...(entity.layout != null ? { layout: entity.layout } : {}),
			position: marble?.release ?? { x: 0, y: 0 },
			angle: entity.angle ?? 0,
			params: resolvePieceParams(entity.type, entity.params),
			contactPoint: null,
			contactNormal: null,
			hitTime: plan.linkedHitTimes.get(entity.id) ?? null,
			status: 'unreached'
		});
	}
	const pieceById = new Map(pieces.map((piece) => [piece.entityId, piece]));

	const contacts = state.contacts.slice().sort((a, b) => a.time - b.time);

	const linkByHit = new Map<string, string>();
	for (const entity of project.track.pieces) {
		const hitLink = tieOf(entity);
		const piece = pieceById.get(entity.id);
		// Scenery never sounds its hit
		if (hitLink == null || piece == null || !soundsHit(piece.type, hitLink)) continue;
		const key = `${hitLink.marbleId}/${hitLink.hitId}`;
		if (!linkByHit.has(key)) linkByHit.set(key, entity.id);
	}

	const hits: THitResult[] = [];
	// Speeds scale with gravity, so the strike threshold does too
	const impactSpeed = IMPACT_SPEED * (plan.gravity / gravityOf({}));
	for (const marble of project.marbles) {
		const band = frameBand(project);
		const marbleIndex = plan.marbles.findIndex((item) => item.marbleId === marble.id);
		const marbleEntity = plan.marbles[marbleIndex];
		const samples = state.marbles[marbleIndex]?.samples ?? [];
		let isBehindBreak = false;
		for (const hit of marble.hits) {
			const pieceEntityId = linkByHit.get(`${marble.id}/${hit.id}`) ?? null;
			const piece = pieceEntityId != null ? pieceById.get(pieceEntityId) : undefined;
			const placement = pieceEntityId != null ? state.placements.get(pieceEntityId) : undefined;
			const onTrajectory =
				placement?.dot != null ? null : trajectoryAt(samples, hit.time, plan.gravity);
			const result: THitResult = {
				marbleId: marble.id,
				hitId: hit.id,
				targetTime: hit.time,
				pieceEntityId,
				dot: placement?.dot ?? onTrajectory?.position ?? null,
				velocity: placement?.velocity ?? onTrajectory?.velocity ?? null,
				actualTime: null,
				error: null,
				status: 'open'
			};
			if (piece == null || marbleEntity == null) {
				if (piece != null) result.status = 'missed';
				else if (result.dot != null)
					result.outOfFrame = Math.abs(result.dot.x - band.centerX) > band.halfWidth;
				hits.push(result);
				continue;
			}
			if (piece.status === 'blocked') {
				result.status = 'blocked';
				hits.push(result);
				continue;
			}
			const from = hit.time - HIT_TOLERANCE - DT;
			const contact = contacts.find(
				(c) =>
					c.time >= from &&
					c.marbleEntityId === marbleEntity.entityId &&
					c.otherEntityId === piece.entityId
			);
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
			entityId: marble.entityId,
			marbleId: marble.marbleId,
			radius: marble.radius,
			samples: state.marbles[i]?.samples ?? []
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
	const farPieces = new Map(far.pieces.map((piece) => [piece.entityId, piece]));
	const farTracks = new Map(far.marbles.map((track) => [track.entityId, track]));
	return {
		...near,
		duration: far.duration,
		// A hit this close to the stop could still have been struck in time after it
		hits: near.hits.map((hit) => (hit.targetTime <= until - HIT_TOLERANCE ? hit : (farHits.get(hitKey(hit)) ?? hit))),
		pieces: near.pieces.map((piece) => (piece.status === 'unreached' && (piece.entryTime ?? piece.hitTime ?? Infinity) > until ? (farPieces.get(piece.entityId) ?? piece) : piece)),
		contacts: [...near.contacts, ...far.contacts.filter((contact) => contact.time > until)],
		marbles: near.marbles.map((track) => {
			const last = track.samples[track.samples.length - 1];
			// A marble that fell out before the stop is gone in this run
			if (last != null && last.time < until - STEP_EPSILON - 1 / PHYSICS_HZ) return track;
			const samples = farTracks.get(track.entityId)?.samples ?? [];
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

// Signatures

/** Two cyrb53 string hashes, with seeds 0 and 1, computed in one pass over the text */
function signature(text: string): string {
	let a1 = 0xdeadbeef;
	let a2 = 0x41c6ce57;
	let b1 = 0xdeadbeef ^ 1;
	let b2 = 0x41c6ce57 ^ 1;
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		a1 = Math.imul(a1 ^ code, 2654435761);
		a2 = Math.imul(a2 ^ code, 1597334677);
		b1 = Math.imul(b1 ^ code, 2654435761);
		b2 = Math.imul(b2 ^ code, 1597334677);
	}
	return `${bowlHash53(a1, a2)}${bowlHash53(b1, b2)}`;
}

function bowlHash53(h1: number, h2: number): string {
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(11, '0');
}
