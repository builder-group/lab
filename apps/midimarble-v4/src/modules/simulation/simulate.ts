import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import { DEFAULT_MARBLE_RADIUS, type TProject, type TVec2 } from '@/modules/project';
import { ballistic, GRAVITY_Y } from './geometry';
import {
	layoutAtContact,
	layoutAtMarble,
	layoutFree,
	type TLayoutInput,
	type TPieceLayout
} from './piece-layout';
import {
	getPieceDefinition,
	isFollowerPiece,
	pieceRestitution,
	resolvePieceParams,
	resolvePiecePath
} from './pieces';
import { descentPace, descentPoints } from './pace';
import { frameBand } from './placement';
import {
	shapeClosestPoint,
	shapeDistance,
	shapesBounds,
	transformShape,
	wrapAngle,
	type TBounds2,
	type TPieceShape
} from './shapes';
import {
	HIT_DRIFT,
	HIT_TOLERANCE,
	IMPACT_SPEED,
	PHYSICS_HZ,
	type TContact,
	type THitResult,
	type TMarbleSample,
	type TPieceDefinition,
	type TPieceMotionSample,
	type TResolvedPiece,
	type TSimulationResult
} from './types';

const DT = 1 / PHYSICS_HZ;
const GLASS_DENSITY = 2500;
// Marble coefficients sit at the top of the range and pieces use the Min combine rule, which Rapier
// prefers over the marble's Average rule. A piece's own restitution and friction therefore govern every
// marble contact with it, while marble pairs combine to these values. The marble restitution matches the
// highest `bounce` a piece allows, so Min never clips a piece's value.
const MARBLE_RESTITUTION = 0.95;
const MARBLE_FRICTION = 0.5;
// Marble centres move in this plane. Pieces span z from their wall offset over their depth, and the
// smallest allowed depth is 0.02 m, so the plane runs through every piece and contact normals stay in xy.
const MARBLE_Z = 0.01;
// A marble stops being simulated this far below its release or the lowest piece, whichever is lower
const FALL_LIMIT = 20;
// Earlier samples may touch a new piece by this much before it counts as blocked
const BLOCK_TOLERANCE = 0.0005;
const MAX_SNAPSHOTS = 512;
// Rapier's step cost grows with every collider in the world, even fixed or disabled ones. Pieces far
// from all marbles are therefore parked outside the world and re-created when a marble could reach them
// within the next check, which runs every few steps on the global step grid so resumed runs match.
const PARKING_INTERVAL = 6;
const PARKING_MARGIN = 0.05;
const STEP_EPSILON = 1e-7;
const SIGNATURE_VERSION = 'sim@3';
// Windmill parts are light wood
const ROTOR_DENSITY = 600;
// Collision groups as membership << 16 | filter. Marbles keep the default and meet everything. Static
// pieces meet everything but rotors, and rotors meet only marbles, so a turning blade never jams on a
// platform next to it.
const STATIC_GROUPS = 0x0002ffff;
const ROTOR_GROUPS = 0x00040001;

export interface TSimulator {
	/** Simulates the project, resuming from the latest snapshot whose inputs are unchanged */
	simulate: (project: TProject) => TSimulationResult;
	dispose: () => void;
}

let rapierReady: Promise<void> | null = null;

export async function createSimulator(): Promise<TSimulator> {
	rapierReady ??= RAPIER.init();
	await rapierReady;
	let cache = new Map<string, TSnapshot>();
	return {
		simulate(project) {
			const [result, nextCache] = runSimulation(project, cache);
			cache = nextCache;
			return result;
		},
		dispose() {
			cache.clear();
		}
	};
}

function runSimulation(
	project: TProject,
	cache: Map<string, TSnapshot>
): [TSimulationResult, Map<string, TSnapshot>] {
	const startedAt = performance.now();
	const plan = createPlan(project);
	const nextCache = new Map<string, TSnapshot>();

	let resumeIndex = -1;
	for (let i = plan.events.length - 1; i >= 0; i--) {
		const event = plan.events[i];
		const key = plan.eventKeys[i];
		if (event == null || key == null || event.step > plan.endStep) continue;
		if (cache.has(key)) {
			resumeIndex = i;
			break;
		}
	}

	let world: RAPIER.World;
	let state: TRunState;
	const resumed = resumeIndex >= 0 ? cache.get(plan.eventKeys[resumeIndex] ?? '') : undefined;
	if (resumed != null) {
		world = RAPIER.World.restoreSnapshot(resumed.world);
		world.timestep = DT;
		state = restoreState(resumed);
		for (let i = 0; i <= resumeIndex; i++) {
			const key = plan.eventKeys[i] ?? '';
			const snapshot = cache.get(key);
			if (snapshot != null) nextCache.set(key, snapshot);
		}
	} else {
		resumeIndex = -1;
		world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
		world.timestep = DT;
		state = createInitialState(plan, world);
	}
	const reusedUntil = resumed != null ? state.step / PHYSICS_HZ : 0;

	const steps = advance(world, plan, state, nextCache, resumeIndex);
	world.free();

	const result = buildResult(project, plan, state);
	result.stats = { computeMs: performance.now() - startedAt, reusedUntil, steps };
	return [result, trimCache(nextCache)];
}

// Plan

interface TPlan {
	startStep: number;
	endStep: number;
	marbles: TPlanMarble[];
	staticPieces: TStaticPiece[];
	/** Hit-linked, unpinned pieces in global hit time order */
	events: TPlanEvent[];
	/** Signature of the state just before each event is processed */
	eventKeys: string[];
	/** Linked piece entity ID to its hit time, null when the hit does not exist */
	linkedHitTimes: Map<string, number | null>;
}

interface TPlanMarble {
	entityId: string;
	laneId: string;
	radius: number;
	release: TVec2;
	releaseVelocity: TVec2;
	releaseTime: number;
	releaseStep: number;
}

interface TStaticPiece {
	entityId: string;
	definition: TPieceDefinition;
	params: Record<string, number>;
	layout: TPieceLayout;
	resolved: TResolvedPiece;
}

interface TPlanEvent {
	entityId: string;
	definition: TPieceDefinition;
	params: Record<string, number>;
	/** Local control points of rails and tunnels */
	path: TVec2[];
	angle: number;
	contactAt: number;
	/** When the piece is placed: the hit time, plus the entry delay for follower rails and tunnels */
	time: number;
	hitTime: number;
	step: number;
	/** Index into `TPlan.marbles`, -1 when the lane has no marble */
	marbleIndex: number;
}

function createPlan(project: TProject): TPlan {
	const hitTimes = new Map<string, number>();
	for (const lane of project.music.lanes) {
		for (const hit of lane.hits) hitTimes.set(`${lane.id}/${hit.id}`, hit.time);
	}

	const marbles: TPlanMarble[] = [];
	for (const entity of project.entities) {
		const { marble, release } = entity.components;
		if (marble == null || release == null) continue;
		marbles.push({
			entityId: entity.id,
			laneId: marble.laneId,
			radius: marble.radius,
			release: release.position,
			releaseVelocity: release.velocity ?? { x: 0, y: 0 },
			releaseTime: release.time,
			releaseStep: Math.ceil(release.time * PHYSICS_HZ - STEP_EPSILON)
		});
	}

	const staticPieces: TStaticPiece[] = [];
	const events: TPlanEvent[] = [];
	const linkedHitTimes = new Map<string, number | null>();
	const defaultRadius = marbles[0]?.radius ?? DEFAULT_MARBLE_RADIUS;
	for (const entity of project.entities) {
		const { piece, hitLink, transform } = entity.components;
		if (piece == null) continue;
		const definition = getPieceDefinition(piece.type);
		if (definition == null) continue;
		const params = resolvePieceParams(piece.type, piece.params);
		const path = resolvePiecePath(piece.type, entity.components.path?.points);

		if (hitLink != null) {
			const time = hitTimes.get(`${hitLink.laneId}/${hitLink.hitId}`) ?? null;
			linkedHitTimes.set(entity.id, time);
			const marbleIndex = marbles.findIndex((marble) => marble.laneId === hitLink.laneId);
			const input: TLayoutInput = {
				type: piece.type,
				params,
				path,
				angle: hitLink.angle,
				contactAt: hitLink.contactAt,
				marbleRadius: marbles[marbleIndex]?.radius ?? defaultRadius
			};
			if (hitLink.pinned && hitLink.pinnedPosition != null) {
				// Pinned pieces keep the unflipped normal since the incoming direction is unknown at time 0
				const layout = layoutAtContact(input, hitLink.pinnedPosition);
				staticPieces.push({
					entityId: entity.id,
					definition,
					params,
					layout,
					resolved: resolvedFromLayout(entity.id, piece.type, params, layout, time, 'pinned')
				});
				continue;
			}
			if (time == null) continue;
			const eventTime = time + (isFollowerPiece(params) ? (params['entryDelay'] ?? 0) : 0);
			events.push({
				entityId: entity.id,
				definition,
				params,
				path,
				angle: hitLink.angle,
				contactAt: hitLink.contactAt,
				time: eventTime,
				hitTime: time,
				step: Math.floor(eventTime * PHYSICS_HZ + STEP_EPSILON),
				marbleIndex
			});
			continue;
		}

		if (transform == null) continue;
		const layout = layoutFree(
			{
				type: piece.type,
				params,
				path,
				angle: transform.angle,
				contactAt: 0.5,
				marbleRadius: defaultRadius
			},
			transform.position
		);
		const resolved = resolvedFromLayout(entity.id, piece.type, params, layout, null, 'free');
		resolved.position = transform.position;
		staticPieces.push({ entityId: entity.id, definition, params, layout, resolved });
	}
	events.sort(
		(a, b) => a.time - b.time || (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0)
	);

	const startStep = Math.min(0, ...marbles.map((marble) => marble.releaseStep));
	const endStep = Math.floor(project.end * PHYSICS_HZ + STEP_EPSILON);

	// Each key covers everything that determines the world up to the event: marbles, static pieces,
	// every earlier event and the step the event is processed at
	let chain = signature(
		JSON.stringify([
			SIGNATURE_VERSION,
			startStep,
			marbles,
			staticPieces.map((piece) => [
				piece.entityId,
				piece.definition.type,
				piece.params,
				piece.layout.shapes
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
				event.angle,
				event.contactAt,
				event.time,
				event.marbleIndex
			])}`
		);
	}

	return { startStep, endStep, marbles, staticPieces, events, eventKeys, linkedHitTimes };
}

// Run state

interface TMarbleRun {
	bodyHandle: number;
	status: 'waiting' | 'live' | 'ended';
	samples: TMarbleSample[];
}

type TColliderInfo =
	| { kind: 'marble'; marbleIndex: number }
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
	marbles: TMarbleRun[];
	colliders: Map<number, TColliderInfo>;
	contacts: TContact[];
	placements: Map<string, TPlacement>;
	lowestPieceY: number;
	/** Every piece inserted so far, in insertion order */
	pieces: TPieceRecord[];
	/** Collider handles per piece, empty while parked */
	pieceHandles: number[][];
	rotors: TRotorRun[];
	/** Touching collider count per marble index and piece entity, so a rail logs one contact */
	touching: Map<string, number>;
	/** Per marble bounds of complete sample chunks, derived from samples and never snapshotted */
	chunkBounds: number[][];
}

interface TPieceRecord {
	entityId: string;
	definition: TPieceDefinition;
	params: Record<string, number>;
	shapes: TPieceShape[];
	bounds: TBounds2;
	/** Index into `TRunState.rotors`, -1 for static pieces, which may be parked */
	rotorIndex: number;
}

interface TRotorRun {
	entityId: string;
	bodyHandle: number;
	hub: TVec2;
	motorSpeed: number;
	motion: TPieceMotionSample[];
}

interface TSnapshot {
	world: Uint8Array;
	step: number;
	eventIndex: number;
	marbles: {
		bodyHandle: number;
		status: TMarbleRun['status'];
		samples: TMarbleSample[];
		count: number;
	}[];
	colliders: Map<number, TColliderInfo>;
	contacts: TContact[];
	contactCount: number;
	placements: Map<string, TPlacement>;
	lowestPieceY: number;
	pieces: TPieceRecord[];
	pieceHandles: number[][];
	rotors: (Omit<TRotorRun, 'motion'> & { motion: TPieceMotionSample[]; count: number })[];
	touching: Map<string, number>;
}

function createInitialState(plan: TPlan, world: RAPIER.World): TRunState {
	const state: TRunState = {
		step: plan.startStep,
		eventIndex: 0,
		marbles: plan.marbles.map(() => ({ bodyHandle: -1, status: 'waiting', samples: [] })),
		colliders: new Map(),
		contacts: [],
		placements: new Map(),
		lowestPieceY: Infinity,
		pieces: [],
		pieceHandles: [],
		rotors: [],
		touching: new Map(),
		chunkBounds: plan.marbles.map(() => [])
	};
	for (const piece of plan.staticPieces)
		insertPiece(world, state, piece.entityId, piece.definition, piece.params, piece.layout);
	return state;
}

function takeSnapshot(world: RAPIER.World, state: TRunState): TSnapshot {
	return {
		world: world.takeSnapshot(),
		step: state.step,
		eventIndex: state.eventIndex,
		marbles: state.marbles.map((marble) => ({
			bodyHandle: marble.bodyHandle,
			status: marble.status,
			samples: marble.samples,
			count: marble.samples.length
		})),
		colliders: new Map(state.colliders),
		contacts: state.contacts,
		contactCount: state.contacts.length,
		placements: new Map(state.placements),
		lowestPieceY: state.lowestPieceY,
		pieces: state.pieces.slice(),
		pieceHandles: state.pieceHandles.slice(),
		rotors: state.rotors.map((rotor) => ({ ...rotor, count: rotor.motion.length })),
		touching: new Map(state.touching)
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
		colliders: new Map(snapshot.colliders),
		contacts: snapshot.contacts.slice(0, snapshot.contactCount),
		placements: new Map(snapshot.placements),
		lowestPieceY: snapshot.lowestPieceY,
		pieces: snapshot.pieces.slice(),
		pieceHandles: snapshot.pieceHandles.slice(),
		rotors: snapshot.rotors.map(({ count, ...rotor }) => ({
			...rotor,
			motion: rotor.motion.slice(0, count)
		})),
		touching: new Map(snapshot.touching),
		chunkBounds: snapshot.marbles.map(() => [])
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
	world: RAPIER.World,
	plan: TPlan,
	state: TRunState,
	cache: Map<string, TSnapshot>,
	resumeIndex: number
): number {
	const queue = new RAPIER.EventQueue(true);
	let steps = 0;
	for (;;) {
		const hasReleased = releaseMarbles(world, plan, state);
		for (;;) {
			const event = plan.events[state.eventIndex];
			if (event == null || event.step > state.step) break;
			if (state.eventIndex !== resumeIndex) {
				cache.set(plan.eventKeys[state.eventIndex] ?? '', takeSnapshot(world, state));
			}
			processEvent(world, plan, state, event);
			state.eventIndex++;
		}
		if (state.step >= plan.endStep) break;
		if (hasReleased || state.step % PARKING_INTERVAL === 0) parkPieces(world, plan, state);

		world.step(queue);
		state.step++;
		steps++;
		sampleMarbles(world, plan, state);
		sampleRotors(world, state);
		queue.drainCollisionEvents((handleA, handleB, started) => {
			recordContact(plan, state, handleA, handleB, started);
		});
	}
	queue.free();
	return steps;
}

/** Releases marbles due at the current step and returns whether any entered */
function releaseMarbles(world: RAPIER.World, plan: TPlan, state: TRunState): boolean {
	let hasReleased = false;
	for (let i = 0; i < plan.marbles.length; i++) {
		const marble = plan.marbles[i];
		const run = state.marbles[i];
		if (
			marble == null ||
			run == null ||
			run.status !== 'waiting' ||
			marble.releaseStep > state.step
		)
			continue;
		const time = state.step / PHYSICS_HZ;
		// The marble enters on the first step at or after its release time, moved along its free flight
		const { position, velocity } = ballistic(
			marble.release,
			marble.releaseVelocity,
			Math.max(0, time - marble.releaseTime)
		);
		const body = world.createRigidBody(
			RAPIER.RigidBodyDesc.dynamic()
				.setTranslation(position.x, position.y, MARBLE_Z)
				.setLinvel(velocity.x, velocity.y, 0)
				.enabledTranslations(true, true, false)
				.enabledRotations(false, false, true)
				.setCcdEnabled(true)
				.setCanSleep(false)
		);
		const collider = world.createCollider(
			RAPIER.ColliderDesc.ball(marble.radius)
				.setDensity(GLASS_DENSITY)
				.setRestitution(MARBLE_RESTITUTION)
				.setFriction(MARBLE_FRICTION)
				.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
			body
		);
		state.colliders.set(collider.handle, { kind: 'marble', marbleIndex: i });
		run.bodyHandle = body.handle;
		run.status = 'live';
		run.samples.push({ time, position, angle: 0, velocity });
		hasReleased = true;
	}
	return hasReleased;
}

function sampleMarbles(world: RAPIER.World, plan: TPlan, state: TRunState): void {
	const time = state.step / PHYSICS_HZ;
	for (let i = 0; i < state.marbles.length; i++) {
		const run = state.marbles[i];
		const marble = plan.marbles[i];
		if (run == null || marble == null || run.status !== 'live') continue;
		const body = world.getRigidBody(run.bodyHandle);
		const translation = body.translation();
		if (translation.y < Math.min(marble.release.y, state.lowestPieceY) - FALL_LIMIT) {
			for (let c = 0; c < body.numColliders(); c++) state.colliders.delete(body.collider(c).handle);
			world.removeRigidBody(body);
			run.status = 'ended';
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

function sampleRotors(world: RAPIER.World, state: TRunState): void {
	const time = state.step / PHYSICS_HZ;
	for (const rotor of state.rotors) {
		const body = world.getRigidBody(rotor.bodyHandle);
		const rotation = body.rotation();
		const previous = rotor.motion[rotor.motion.length - 1]?.angle ?? 0;
		const raw = 2 * Math.atan2(rotation.z, rotation.w);
		rotor.motion.push({ time, angle: previous + wrapAngle(raw - previous) });
	}
}

function insertPiece(
	world: RAPIER.World,
	state: TRunState,
	entityId: string,
	definition: TPieceDefinition,
	params: Record<string, number>,
	layout: TPieceLayout
): void {
	const bounds = shapesBounds(layout.shapes);
	let rotorIndex = -1;
	if (layout.rotor != null) {
		rotorIndex = state.rotors.length;
		// Adding zero turns the -0 of step 0 into 0
		const time = state.step / PHYSICS_HZ + 0;
		state.rotors.push({
			entityId,
			bodyHandle: -1,
			hub: layout.rotor.hub,
			motorSpeed: layout.rotor.motorSpeed,
			motion: [{ time, angle: layout.rotor.angle }]
		});
	}
	state.pieces.push({ entityId, definition, params, shapes: layout.shapes, bounds, rotorIndex });
	state.pieceHandles.push([]);
	const index = state.pieces.length - 1;
	if (layout.rotor != null) addRotorBody(world, state, index, layout);
	else addPieceColliders(world, state, index);
	state.lowestPieceY = Math.min(
		state.lowestPieceY,
		layout.box != null ? layout.box.cy : bounds.minY
	);
}

function addPieceColliders(world: RAPIER.World, state: TRunState, index: number): void {
	const piece = state.pieces[index];
	if (piece == null) return;
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
		state.colliders.set(collider.handle, {
			kind: 'piece',
			entityId: piece.entityId,
			shape,
			rotorIndex: -1
		});
		handles.push(collider.handle);
	}
	state.pieceHandles[index] = handles;
}

function staticColliderDesc(
	shape: TPieceShape,
	params: Record<string, number>,
	definition: TPieceDefinition
): RAPIER.ColliderDesc | null {
	switch (shape.kind) {
		case 'box': {
			const { box } = shape;
			const depth = params['depth'] ?? 0.03;
			return RAPIER.ColliderDesc.cuboid(box.halfLength, box.halfThickness, depth / 2)
				.setTranslation(box.cx, box.cy, definition.wallOffset + depth / 2)
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
 * never slow it down.
 */
function addRotorBody(
	world: RAPIER.World,
	state: TRunState,
	index: number,
	layout: TPieceLayout
): void {
	const piece = state.pieces[index];
	const rotor = layout.rotor;
	const run = state.rotors[piece?.rotorIndex ?? -1];
	if (piece == null || rotor == null || run == null) return;
	const hasMotor = rotor.motorSpeed !== 0;
	const bodyDesc = (
		hasMotor
			? RAPIER.RigidBodyDesc.kinematicVelocityBased().setAngvel({ x: 0, y: 0, z: rotor.motorSpeed })
			: RAPIER.RigidBodyDesc.dynamic()
					.enabledTranslations(false, false, false)
					.enabledRotations(false, false, true)
					.setAngularDamping(rotor.damping)
	)
		.setTranslation(rotor.hub.x, rotor.hub.y, MARBLE_Z)
		.setRotation(zRotation(rotor.angle))
		.setCanSleep(false);
	const body = world.createRigidBody(bodyDesc);
	const handles: number[] = [];
	for (const shape of rotor.localShapes) {
		let desc: RAPIER.ColliderDesc;
		if (shape.kind === 'box') {
			const { box } = shape;
			desc = RAPIER.ColliderDesc.cuboid(box.halfLength, box.halfThickness, rotor.depth / 2)
				.setTranslation(box.cx, box.cy, piece.definition.wallOffset + rotor.depth / 2 - MARBLE_Z)
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
		state.colliders.set(collider.handle, {
			kind: 'piece',
			entityId: piece.entityId,
			shape,
			rotorIndex: piece.rotorIndex
		});
		handles.push(collider.handle);
	}
	run.bodyHandle = body.handle;
	state.pieceHandles[index] = handles;
}

function zRotation(angle: number): RAPIER.Rotation {
	return { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) };
}

/** Keeps only pieces a marble could reach before the next check in the world */
function parkPieces(world: RAPIER.World, plan: TPlan, state: TRunState): void {
	const horizon = (PARKING_INTERVAL + 1) * DT;
	const reachable: { x: number; y: number; reach: number }[] = [];
	let fastest = 0;
	for (const run of state.marbles) {
		const sample = run.samples[run.samples.length - 1];
		if (run.status === 'live' && sample != null)
			fastest = Math.max(fastest, Math.hypot(sample.velocity.x, sample.velocity.y));
	}
	for (let i = 0; i < state.marbles.length; i++) {
		const run = state.marbles[i];
		const sample = run?.samples[run.samples.length - 1];
		const marble = plan.marbles[i];
		if (run?.status !== 'live' || sample == null || marble == null) continue;
		// A collision can at most add the fastest marble's speed, so twice that bounds the next distance
		const speed = 2 * fastest + 1;
		const reach =
			speed * horizon - 0.5 * GRAVITY_Y * horizon * horizon + marble.radius + PARKING_MARGIN;
		reachable.push({ x: sample.position.x, y: sample.position.y, reach });
	}
	for (let index = 0; index < state.pieces.length; index++) {
		const piece = state.pieces[index];
		// Rotors stay in the world so they keep turning
		if (piece == null || piece.rotorIndex >= 0) continue;
		const { bounds } = piece;
		const isNear = reachable.some(
			(marble) =>
				marble.x >= bounds.minX - marble.reach &&
				marble.x <= bounds.maxX + marble.reach &&
				marble.y >= bounds.minY - marble.reach &&
				marble.y <= bounds.maxY + marble.reach
		);
		const handles = state.pieceHandles[index] ?? [];
		if (isNear && !handles.length) {
			addPieceColliders(world, state, index);
		} else if (!isNear && handles.length > 0) {
			for (const handle of handles) {
				world.removeCollider(world.getCollider(handle), false);
				state.colliders.delete(handle);
			}
			state.pieceHandles[index] = [];
		}
	}
}

// Placement by construction: the piece appears at its hit time with its contact face touching the marble

function processEvent(world: RAPIER.World, plan: TPlan, state: TRunState, event: TPlanEvent): void {
	const marble = plan.marbles[event.marbleIndex];
	const run = state.marbles[event.marbleIndex];
	const last = run?.samples[run.samples.length - 1];
	const unreached: TPlacement = {
		piece: {
			entityId: event.entityId,
			type: event.definition.type,
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
	if (event.time !== event.hitTime) unreached.piece.entryTime = event.time;
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
		Math.max(0, event.time - last.time)
	);
	const layout = layoutAtMarble(
		{
			type: event.definition.type,
			params: event.params,
			path: event.path,
			angle: event.angle,
			contactAt: event.contactAt,
			marbleRadius: marble.radius
		},
		position,
		velocity
	);
	const isBlocked = isLayoutBlocked(plan, state, layout, event.time);
	const resolved = resolvedFromLayout(
		event.entityId,
		event.definition.type,
		event.params,
		layout,
		event.hitTime,
		isBlocked ? 'blocked' : 'placed'
	);
	if (unreached.piece.entryTime != null) resolved.entryTime = unreached.piece.entryTime;
	state.placements.set(event.entityId, { piece: resolved, dot: position, velocity });
	if (!isBlocked) insertPiece(world, state, event.entityId, event.definition, event.params, layout);
}

function resolvedFromLayout(
	entityId: string,
	type: string,
	params: Record<string, number>,
	layout: TPieceLayout,
	hitTime: number | null,
	status: TResolvedPiece['status']
): TResolvedPiece {
	const resolved: TResolvedPiece = {
		entityId,
		type,
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
	let bounds = shapesBounds(layout.shapes);
	if (hasMotor) {
		// The swept disc
		const local = shapesBounds(rotor.localShapes);
		const reach = Math.max(
			Math.hypot(local.minX, local.minY),
			Math.hypot(local.maxX, local.maxY),
			Math.hypot(local.minX, local.maxY),
			Math.hypot(local.maxX, local.minY)
		);
		bounds = {
			minX: rotor.hub.x - reach,
			minY: rotor.hub.y - reach,
			maxX: rotor.hub.x + reach,
			maxY: rotor.hub.y + reach
		};
	}
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
	handleA: number,
	handleB: number,
	started: boolean
): void {
	const a = state.colliders.get(handleA);
	const b = state.colliders.get(handleB);
	if (a == null || b == null) return;
	if (a.kind === 'marble' && b.kind === 'marble') {
		if (started) recordMarbleContact(plan, state, a.marbleIndex, b.marbleIndex);
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
	let centre = last?.position ?? marble.release;
	let velocity = (pre ?? last)?.velocity ?? { x: 0, y: 0 };
	if (pre != null) {
		const gap = (tau: number): number => {
			const { position } = ballistic(pre.position, pre.velocity, tau);
			return shapeDistance(shape, position.x, position.y) - marble.radius;
		};
		const tau = findFirstRoot(gap, 3 * DT);
		if (tau != null) {
			time = pre.time + tau;
			const flight = ballistic(pre.position, pre.velocity, tau);
			centre = flight.position;
			velocity = flight.velocity;
		}
	}
	const position = shapeClosestPoint(shape, centre.x, centre.y);
	state.contacts.push({
		time,
		marbleEntityId: marble.entityId,
		otherEntityId: entityId,
		kind: 'piece',
		position,
		speed: approachSpeed(centre, velocity, position, rotor)
	});
}

/** Speed of the marble toward the surface along the contact normal, relative to the surface */
function approachSpeed(
	centre: TVec2,
	velocity: TVec2,
	point: TVec2,
	rotor: TRotorRun | null
): number {
	let nx = centre.x - point.x;
	let ny = centre.y - point.y;
	const length = Math.hypot(nx, ny);
	// A centre inside the shape has no outline direction; the motion itself is then the approach
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

function recordMarbleContact(plan: TPlan, state: TRunState, indexA: number, indexB: number): void {
	const marbleA = plan.marbles[indexA];
	const marbleB = plan.marbles[indexB];
	const runA = state.marbles[indexA];
	const runB = state.marbles[indexB];
	if (marbleA == null || marbleB == null || runA == null || runB == null) return;
	const reach = marbleA.radius + marbleB.radius;
	let time = state.step / PHYSICS_HZ;
	let a = runA.samples[runA.samples.length - 1]?.position ?? marbleA.release;
	let b = runB.samples[runB.samples.length - 1]?.position ?? marbleB.release;
	const preA = preStepSample(runA, state.step);
	const preB = preStepSample(runB, state.step);
	if (preA != null && preB != null) {
		// Both marbles fall under the same gravity, so their relative motion is linear
		const dx = preB.position.x - preA.position.x;
		const dy = preB.position.y - preA.position.y;
		const vx = preB.velocity.x - preA.velocity.x;
		const vy = preB.velocity.y - preA.velocity.y;
		const tau = findFirstRoot((t) => Math.hypot(dx + vx * t, dy + vy * t) - reach, 3 * DT);
		if (tau != null) {
			time = preA.time + tau;
			a = ballistic(preA.position, preA.velocity, tau).position;
			b = ballistic(preB.position, preB.velocity, tau).position;
		}
	}
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
	for (const entity of project.entities) {
		const { piece } = entity.components;
		if (piece == null || getPieceDefinition(piece.type) == null) continue;
		const resolved = staticById.get(entity.id) ?? state.placements.get(entity.id)?.piece;
		if (resolved != null) {
			const rotor = state.rotors.find((r) => r.entityId === entity.id);
			pieces.push(rotor != null ? { ...resolved, motion: rotorMotion(plan, rotor) } : resolved);
			continue;
		}
		// Linked pieces that were never processed: missing hit, hit after the end or before the start
		const marble = plan.marbles.find((m) => m.laneId === entity.components.hitLink?.laneId);
		pieces.push({
			entityId: entity.id,
			type: piece.type,
			position: marble?.release ?? { x: 0, y: 0 },
			angle: entity.components.hitLink?.angle ?? 0,
			params: resolvePieceParams(piece.type, piece.params),
			contactPoint: null,
			contactNormal: null,
			hitTime: plan.linkedHitTimes.get(entity.id) ?? null,
			status: 'unreached'
		});
	}
	const pieceById = new Map(pieces.map((piece) => [piece.entityId, piece]));

	const contacts = state.contacts.slice().sort((a, b) => a.time - b.time);

	const linkByHit = new Map<string, string>();
	for (const entity of project.entities) {
		const { hitLink } = entity.components;
		const piece = pieceById.get(entity.id);
		// Follower rails and tunnels do not sound their hit
		if (hitLink == null || piece == null || isFollowerPiece(piece.params)) continue;
		const key = `${hitLink.laneId}/${hitLink.hitId}`;
		if (!linkByHit.has(key)) linkByHit.set(key, entity.id);
	}

	const hits: THitResult[] = [];
	for (const lane of project.music.lanes) {
		const band = frameBand(project, lane.id);
		const marbleIndex = plan.marbles.findIndex((marble) => marble.laneId === lane.id);
		const marble = plan.marbles[marbleIndex];
		const samples = state.marbles[marbleIndex]?.samples ?? [];
		for (const hit of lane.hits) {
			const pieceEntityId = linkByHit.get(`${lane.id}/${hit.id}`) ?? null;
			const piece = pieceEntityId != null ? pieceById.get(pieceEntityId) : undefined;
			const placement = pieceEntityId != null ? state.placements.get(pieceEntityId) : undefined;
			const onTrajectory = placement?.dot != null ? null : trajectoryAt(samples, hit.time);
			const result: THitResult = {
				laneId: lane.id,
				hitId: hit.id,
				targetTime: hit.time,
				pieceEntityId,
				dot: placement?.dot ?? onTrajectory?.position ?? null,
				velocity: placement?.velocity ?? onTrajectory?.velocity ?? null,
				actualTime: null,
				error: null,
				status: 'open'
			};
			if (piece == null || marble == null) {
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
					c.marbleEntityId === marble.entityId &&
					c.otherEntityId === piece.entityId
			);
			if (contact != null) {
				const error = contact.time - hit.time;
				result.actualTime = contact.time;
				result.error = error;
				result.status =
					Math.abs(error) <= HIT_DRIFT
						? 'onTime'
						: Math.abs(error) <= HIT_TOLERANCE
							? 'drifting'
							: 'missed';
				// A marble that arrives resting or rolling sounds no note
				if (result.status !== 'missed' && (contact.speed ?? Infinity) < IMPACT_SPEED) {
					result.status = 'missed';
					result.reason = 'resting';
				}
			} else {
				result.status = 'missed';
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
			laneId: marble.laneId,
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

/** Marble state at `time`, extrapolated along free flight from the sample at or before it */
export function trajectoryAt(
	samples: TMarbleSample[],
	time: number
): { position: TVec2; velocity: TVec2 } | null {
	const first = samples[0];
	if (first == null) return null;
	const index = Math.floor(time * PHYSICS_HZ + STEP_EPSILON) - Math.round(first.time * PHYSICS_HZ);
	const sample = samples[index];
	if (sample == null) return null;
	return ballistic(sample.position, sample.velocity, Math.max(0, time - sample.time));
}

// Signatures

function signature(text: string): string {
	return `${hash53(text, 0)}${hash53(text, 1)}`;
}

/** cyrb53 string hash */
function hash53(text: string, seed: number): string {
	let h1 = 0xdeadbeef ^ seed;
	let h2 = 0x41c6ce57 ^ seed;
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		h1 = Math.imul(h1 ^ code, 2654435761);
		h2 = Math.imul(h2 ^ code, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(11, '0');
}
