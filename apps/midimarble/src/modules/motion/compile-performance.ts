import RAPIER from '@dimforge/rapier3d-compat';
import type {
	TImpact,
	TPerformance,
	TProject,
	TResolvedObject,
	TSample,
	TSceneObject,
	TSurfaceContact,
	TVec3
} from '../project/types';
import { getFrontFlangeGeometry } from './key-geometry';
import type { TCompileOptions } from './motion-progress';
import { createNoteMarkers } from './note-markers';
import { getPlacementPrefix } from './placement-prefix';
import { getRailGeometry } from './rail-geometry';

export { samplePerformance } from './sample-performance';

/** Resolves note-bound placements, then bakes the complete physical scene for time-addressable playback. */
export async function compilePerformance(
	project: TProject,
	options: TCompileOptions = {}
): Promise<TPerformance> {
	if (!Number.isFinite(project.duration) || project.duration < 0.1 || project.duration > 120) {
		throw new Error(
			'The physical performance must be between 0.1 and 120 seconds. Trim the score to a shorter passage.'
		);
	}
	validatePhysicalInputs(project);
	await initializeRapier();
	checkCancelled(options);
	const duration = project.duration;
	const warnings: string[] = [];
	const notesById = new Map(project.notes.map((note) => [note.id, note]));
	const objects: TResolvedObject[] = [];
	const boundObjects: TResolvedObject[] = [];
	const shapeCache = new Map<TResolvedObject, RAPIER.ColliderDesc[]>();

	for (const object of project.objects) {
		const resolved = structuredClone(object);
		if ((object.binding == null && object.trajectoryAnchor == null) || object.disabled) {
			objects.push(resolved);
			continue;
		}
		if (object.binding != null && !notesById.has(object.binding.noteId)) {
			warnings.push(`${object.name} refers to a missing note; its stored world placement is used.`);
			resolved.binding = null;
			objects.push(resolved);
			continue;
		}
		boundObjects.push(resolved);
	}

	boundObjects.sort((left, right) => {
		const leftTime = getPlacementTime(left, project);
		const rightTime = getPlacementTime(right, project);
		return leftTime - rightTime || left.id.localeCompare(right.id);
	});

	const lastPlacementTime = new Map<string, number>();
	const simultaneous = boundObjects.some((object) => {
		const marbleId = object.marbleId ?? 'main';
		const time = getPlacementTime(object, project);
		const previousTime = lastPlacementTime.get(marbleId);
		lastPlacementTime.set(marbleId, time);
		return previousTime != null && Math.abs(time - previousTime) < fixedStep;
	});
	if (simultaneous) {
		warnings.push(
			'Several linked notes share a physical instant. A single marble may not reach separate instruments together; use one instrument for the moment or stagger the notes.'
		);
	}

	const reused =
		options.previous?.performance.influenceBounds == null
			? []
			: getPlacementPrefix(project, boundObjects, options.previous);
	const influenceBounds = {
		min: [Infinity, Infinity, Infinity] as TVec3,
		max: [-Infinity, -Infinity, -Infinity] as TVec3
	};
	// Reused placements can depend on predictor paths absent from the final playback.
	if (reused.length > 0 && options.previous?.performance.influenceBounds != null)
		includeBounds(influenceBounds, options.previous.performance.influenceBounds);
	for (const [index, position] of reused.entries()) {
		const object = boundObjects[index];
		if (object == null) continue;
		object.position = [...position];
		objects.push(object);
	}
	const total = boundObjects.length;
	const predictor = createPredictor(project, objects, shapeCache, influenceBounds);
	try {
		publishPlacementProgress(reused.length);
		for (let index = reused.length; index < total; index++) {
			checkCancelled(options);
			const object = boundObjects[index];
			if (object == null) continue;
			const time = getPlacementTime(object, project);
			if (time > duration) {
				objects.push(object);
				continue;
			}
			predictor.advance(Math.max(0, time));
			const marble = predictor.context.marbles.get(object.marbleId ?? 'main');
			if (marble == null) throw new Error(`${object.name} refers to an unknown marble.`);
			if (time < marble.startTime)
				warnings.push(`${object.name} is anchored before its marble is launched.`);
			const translation = marble.body.translation();
			const velocity = marble.body.linvel();
			const fractionalTime = Math.max(0, time) - predictor.step * fixedStep;
			const target: TVec3 = [
				translation.x + velocity.x * fractionalTime,
				translation.y + velocity.y * fractionalTime - (project.gravity * fractionalTime ** 2) / 2,
				translation.z + velocity.z * fractionalTime
			];
			resolvePlacement(object, target, velocity, marble.radius);
			objects.push(object);
			predictor.insert(object);
			publishPlacementProgress(index + 1);
			if (options.yieldControl != null) await options.yieldControl();
		}
	} finally {
		predictor.dispose();
	}

	function publishPlacementProgress(completed: number): void {
		options.onProgress?.({
			phase: 'placement',
			completed,
			total,
			reused: reused.length,
			performance: {
				duration,
				dt: fixedStep,
				objects: structuredClone(objects),
				samples: [],
				impacts: [],
				noteMarkers: [],
				warnings: [...warnings],
				bounds: getBounds(
					[{ time: 0, position: project.launch.position, rotation: [0, 0, 0, 1] }],
					objects
				)
			}
		});
	}

	const context = createPhysicalWorld(project, objects, shapeCache);
	const samples: TSample[] = [readSample(context, 0)];
	const additionalMarbles = (project.marbles ?? []).map((definition) => {
		const marble = context.marbles.get(definition.id);
		return {
			id: definition.id,
			samples: marble?.body.isEnabled() ? [readMarbleSample(marble.body, 0)] : ([] as TSample[])
		};
	});
	const impacts: TImpact[] = [];
	const lastImpact = new Map<string, number>();
	const surfaceContacts: TSurfaceContact[] = [];
	const activeSurfaces = new Map<string, { contact: TSurfaceContact; steps: number }>();
	try {
		const steps = Math.ceil(duration / fixedStep);
		for (let step = 1; step <= steps; step++) {
			checkCancelled(options);
			activateMarbles(context, (step - 1) * fixedStep);
			for (const track of additionalMarbles) {
				const marble = context.marbles.get(track.id);
				if (marble?.body.isEnabled() && !track.samples.length)
					track.samples.push(readMarbleSample(marble.body, (step - 1) * fixedStep));
			}
			const previousPositions = new Map(
				[...context.marbles.values()]
					.filter((marble) => marble.body.isEnabled())
					.map((marble) => [marble.id, marble.body.translation()])
			);
			const previousVelocities = new Map(
				[...context.marbles.values()].map((marble) => [marble.id, marble.body.linvel()])
			);
			context.world.step(context.events);
			for (const marble of context.marbles.values()) {
				const before = previousPositions.get(marble.id);
				const velocity = previousVelocities.get(marble.id);
				if (before == null || velocity == null) continue;
				includeBounds(
					influenceBounds,
					getSweepBounds(
						before,
						marble.body.translation(),
						velocity,
						marble.body.linvel(),
						marble.radius,
						project.gravity
					)
				);
			}
			const time = step * fixedStep;
			context.events.drainCollisionEvents((first, second, started) => {
				if (!started || time > duration + 1e-9) return;
				const marble = context.marbleColliders.get(first) ?? context.marbleColliders.get(second);
				if (marble == null) return;
				const other = first === marble.collider ? second : first;
				const object = context.colliders.get(other);
				const previousVelocity = previousVelocities.get(marble.id);
				if (previousVelocity == null) return;
				const currentVelocity = marble.body.linvel();
				const impactKey = `${marble.id}:${object?.id}`;
				if (object == null || time - (lastImpact.get(impactKey) ?? -1) < 0.08) return;
				lastImpact.set(impactKey, time);
				const position = marble.body.translation();
				impacts.push({
					...(marble.id === 'main' ? {} : { marbleId: marble.id }),
					objectId: object.id,
					noteId:
						(object.marbleId ?? 'main') === marble.id ? (object.binding?.noteId ?? null) : null,
					time,
					position: [position.x, position.y, position.z],
					strength: Math.min(
						1,
						Math.hypot(
							currentVelocity.x - previousVelocity.x,
							currentVelocity.y - previousVelocity.y,
							currentVelocity.z - previousVelocity.z
						) / 12
					)
				});
			});
			readSurfaceContacts(context, time, activeSurfaces, surfaceContacts);
			samples.push(readSample(context, time));
			for (const track of additionalMarbles) {
				const marble = context.marbles.get(track.id);
				if (marble?.body.isEnabled()) track.samples.push(readMarbleSample(marble.body, time));
			}
			if (step % 240 === 0 && options.onProgress != null) {
				const partial: TPerformance = {
					duration,
					dt: fixedStep,
					samples: [...samples],
					additionalMarbles: structuredClone(additionalMarbles),
					objects: structuredClone(objects),
					impacts: [...impacts],
					surfaceContacts: structuredClone(surfaceContacts),
					noteMarkers: [],
					warnings: [...warnings],
					bounds: getBounds(
						[...samples, ...additionalMarbles.flatMap((track) => track.samples)],
						objects
					)
				};
				partial.noteMarkers = createNoteMarkers(project.notes, partial, Math.min(time, duration));
				options.onProgress({
					phase: 'simulation',
					completed: step,
					total: steps,
					reused: reused.length,
					performance: partial,
					simulatedUntil: Math.min(time, duration)
				});
				if (options.yieldControl != null) await options.yieldControl();
			}
		}
	} finally {
		context.events.free();
		context.world.free();
	}

	const performance: TPerformance = {
		influenceBounds,
		duration,
		dt: fixedStep,
		samples,
		additionalMarbles,
		objects,
		impacts,
		surfaceContacts,
		noteMarkers: [],
		warnings,
		bounds: getBounds([...samples, ...additionalMarbles.flatMap((track) => track.samples)], objects)
	};
	performance.noteMarkers = createNoteMarkers(project.notes, performance, duration);
	const missed = performance.noteMarkers.filter(
		(marker) => marker.objectId != null && marker.error == null
	).length;
	const late = performance.noteMarkers.filter(
		(marker) => marker.error != null && Math.abs(marker.error) > 0.035
	).length;
	if (missed > 0)
		warnings.push(
			`${missed} linked instrument${missed === 1 ? '' : 's'} missed. Adjust placement, size, or the previous bounce.`
		);
	if (late > 0)
		warnings.push(
			`${late} contact${late === 1 ? ' is' : 's are'} more than 35 ms from the assigned note.`
		);
	return performance;
}

function getPlacementTime(object: TSceneObject, project: TProject): number {
	return (
		object.trajectoryAnchor?.time ??
		project.notes.find((note) => note.id === object.binding?.noteId)?.time ??
		0
	);
}

function resolvePlacement(
	object: TResolvedObject,
	target: TVec3,
	velocity: RAPIER.Vector,
	radius: number
): void {
	const offset = object.trajectoryAnchor?.offset ?? object.binding?.offset ?? [0, 0, 0];
	const quaternion = eulerQuaternion(object.rotation);
	if (object.kind === 'rail' && object.path != null) {
		const first = object.path[0] ?? [0, 0, 0];
		const second = object.path[1] ?? [1, 0, 0];
		const tangent = second.map((component, axis) => component - (first[axis] ?? 0)) as TVec3;
		const horizontalLength = Math.hypot(tangent[0], tangent[2]);
		const normalLength = Math.hypot(...tangent);
		const localNormal: TVec3 =
			horizontalLength > 1e-8 && normalLength > 1e-8
				? [
						(-tangent[0] * tangent[1]) / horizontalLength / normalLength,
						horizontalLength / normalLength,
						(-tangent[2] * tangent[1]) / horizontalLength / normalLength
					]
				: [0, 1, 0];
		const normal = rotateVector(localNormal, quaternion);
		const start = rotateVector(first, quaternion);
		const wireRadius = getRailGeometry(object).radius;
		const support = Math.sqrt(Math.max(0, (radius + wireRadius) ** 2 - (object.size[2] / 2) ** 2));
		object.position = target.map(
			(component, axis) =>
				component - (start[axis] ?? 0) - (normal[axis] ?? 0) * support + (offset[axis] ?? 0)
		) as TVec3;
		return;
	}
	let normal = rotateVector([0, 1, 0], quaternion);
	const ascending = velocity.x * normal[0] + velocity.y * normal[1] + velocity.z * normal[2] > 0.05;
	if (ascending) normal = normal.map((component) => -component) as TVec3;
	let surfaceHeight = object.size[1] / 2;
	if (object.kind === 'rail' || object.kind === 'bowl') {
		surfaceHeight = -object.size[1] / 2 + Math.min(0.08, object.size[1] * 0.3);
	}
	if (ascending) surfaceHeight = object.size[1] / 2;
	if (object.kind === 'bumper') {
		surfaceHeight = Math.max(...object.size) / 2;
	}
	const separation = radius + surfaceHeight;
	object.position = target.map(
		(component, index) => component - (normal[index] ?? 0) * separation + (offset[index] ?? 0)
	) as TVec3;
}

function checkCancelled(options: TCompileOptions): void {
	if (options.signal?.aborted)
		throw new DOMException('A newer scene replaced this prediction.', 'AbortError');
}

const fixedStep = 1 / 240;
let initialization: Promise<void> | undefined;

function validatePhysicalInputs(project: TProject): void {
	const validVector = (vector: TVec3) => vector.length === 3 && vector.every(Number.isFinite);
	if (
		!validVector(project.launch.position) ||
		!validVector(project.launch.velocity) ||
		!Number.isFinite(project.launch.radius) ||
		project.launch.radius <= 0 ||
		!Number.isFinite(project.gravity) ||
		project.gravity <= 0 ||
		!Number.isFinite(project.restitution)
	) {
		throw new Error(
			'Marble launch and physics settings must contain finite values and a positive radius and gravity.'
		);
	}
	const marbleIds = new Set(['main']);
	for (const marble of project.marbles ?? []) {
		if (
			marbleIds.has(marble.id) ||
			!validVector(marble.launch.position) ||
			!validVector(marble.launch.velocity) ||
			!Number.isFinite(marble.launch.radius) ||
			marble.launch.radius <= 0 ||
			!Number.isFinite(marble.startTime ?? 0) ||
			(marble.startTime ?? 0) < 0
		) {
			throw new Error(
				'Additional marbles require unique identities, finite launches, and a positive radius.'
			);
		}
		marbleIds.add(marble.id);
	}
	for (const object of project.objects) {
		if (object.marbleId != null && !marbleIds.has(object.marbleId))
			throw new Error(`${object.name} refers to an unknown marble.`);
		if (
			object.friction != null &&
			(!Number.isFinite(object.friction) || object.friction < 0 || object.friction > 2)
		)
			throw new Error('Surface friction must be a finite value between 0 and 2.');
		const hasValidPath =
			object.path == null ||
			(object.path.length >= 2 &&
				object.path.length <= 512 &&
				object.path.every(validVector) &&
				object.path.some((point, index) => {
					const previous = object.path?.[index - 1];
					return (
						previous != null &&
						Math.hypot(...point.map((value, axis) => value - (previous[axis] ?? 0))) > 1e-8
					);
				}));
		if (
			!validVector(object.position) ||
			!validVector(object.rotation) ||
			!validVector(object.size) ||
			object.size.some((size) => size <= 0) ||
			!Number.isFinite(object.restitution) ||
			!hasValidPath ||
			(object.binding != null && !validVector(object.binding.offset)) ||
			(object.trajectoryAnchor != null &&
				(!Number.isFinite(object.trajectoryAnchor.time) ||
					!validVector(object.trajectoryAnchor.offset) ||
					object.binding != null))
		) {
			throw new Error(
				`${object.name} has invalid physical dimensions or placement. Use positive sizes and finite coordinates.`
			);
		}
	}
}

function initializeRapier(): Promise<void> {
	initialization ??= RAPIER.init();
	return initialization;
}

interface TPhysicalMarble {
	id: string;
	body: RAPIER.RigidBody;
	collider: number;
	radius: number;
	startTime: number;
}

interface TPhysicalWorld {
	marbles: Map<string, TPhysicalMarble>;
	marbleColliders: Map<number, TPhysicalMarble>;
	world: RAPIER.World;
	events: RAPIER.EventQueue;
	marble: RAPIER.RigidBody;
	marbleCollider: number;
	colliders: Map<number, TResolvedObject>;
}

function createPhysicalWorld(
	project: TProject,
	objects: TResolvedObject[],
	shapeCache: Map<TResolvedObject, RAPIER.ColliderDesc[]>
): TPhysicalWorld {
	const world = new RAPIER.World({ x: 0, y: -Math.max(0.1, project.gravity), z: 0 });
	world.timestep = fixedStep;
	world.numSolverIterations = 6;
	world.numInternalPgsIterations = 1;
	const marbles = new Map<string, TPhysicalMarble>();
	const marbleColliders = new Map<number, TPhysicalMarble>();
	for (const definition of [
		{ id: 'main', launch: project.launch, startTime: 0 },
		...(project.marbles ?? [])
	]) {
		const body = world.createRigidBody(
			RAPIER.RigidBodyDesc.dynamic()
				.setTranslation(...definition.launch.position)
				.setLinvel(...definition.launch.velocity)
				.setEnabled((definition.startTime ?? 0) <= 0)
				.setCcdEnabled(true)
				.setCanSleep(false)
				.setLinearDamping(0)
				.setAngularDamping(0.015)
		);
		const collider = world.createCollider(
			RAPIER.ColliderDesc.ball(Math.max(0.04, definition.launch.radius))
				.setRestitution(Math.max(0, Math.min(1, project.restitution)))
				.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
				.setFriction(0.12)
				.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
			body
		);
		const marble: TPhysicalMarble = {
			id: definition.id,
			body,
			collider: collider.handle,
			radius: Math.max(0.04, definition.launch.radius),
			startTime: definition.startTime ?? 0
		};
		marbles.set(marble.id, marble);
		marbleColliders.set(collider.handle, marble);
	}
	const main = marbles.get('main');
	if (main == null) throw new Error('The performance has no main marble.');

	const colliders = new Map<number, TResolvedObject>();
	for (const object of objects) addPhysicalObject(world, colliders, object, shapeCache);
	return {
		world,
		events: new RAPIER.EventQueue(true),
		marble: main.body,
		marbleCollider: main.collider,
		marbles,
		marbleColliders,
		colliders
	};
}

function addPhysicalObject(
	world: RAPIER.World,
	colliders: Map<number, TResolvedObject>,
	object: TResolvedObject,
	shapeCache: Map<TResolvedObject, RAPIER.ColliderDesc[]>
): void {
	if (object.disabled) return;
	const body = world.createRigidBody(
		RAPIER.RigidBodyDesc.fixed()
			.setTranslation(...object.position)
			.setRotation(eulerQuaternion(object.rotation))
	);
	let shapes = shapeCache.get(object);
	if (shapes == null) {
		shapes = objectColliders(object);
		shapeCache.set(object, shapes);
	}
	for (const collider of shapes) {
		collider
			.setRestitution(Math.max(0, Math.min(1, object.restitution)))
			.setRestitutionCombineRule(
				object.kind === 'rail' && object.path != null
					? RAPIER.CoefficientCombineRule.Multiply
					: RAPIER.CoefficientCombineRule.Max
			)
			.setFriction(object.friction ?? (object.kind === 'rail' && object.path != null ? 0.5 : 0.12))
			.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
			.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
		colliders.set(world.createCollider(collider, body).handle, object);
	}
}

function objectColliders(object: TResolvedObject): RAPIER.ColliderDesc[] {
	const [width, height, depth] = object.size.map((value) => Math.max(0.04, value)) as TVec3;
	if (object.kind === 'bumper')
		return [RAPIER.ColliderDesc.ball(Math.max(width, height, depth) / 2)];
	if (object.kind === 'drum')
		return [RAPIER.ColliderDesc.cylinder(height / 2, Math.min(width, depth) / 2)];
	if (object.kind === 'rail') {
		if (object.path != null) {
			const { paths, radius } = getRailGeometry(object);
			const segments = paths.flatMap((path) =>
				path.slice(1).flatMap((end, index) => {
					const start = path[index];
					if (start == null) return [];
					const delta = end.map((value, axis) => value - (start[axis] ?? 0)) as TVec3;
					const length = Math.hypot(...delta);
					if (length < 1e-8) return [];
					const direction = delta.map((value) => value / length) as TVec3;
					const quaternion =
						direction[1] < -0.999999
							? { x: 1, y: 0, z: 0, w: 0 }
							: normalizeQuaternion({
									x: direction[2],
									y: 0,
									z: -direction[0],
									w: 1 + direction[1]
								});
					return [
						RAPIER.ColliderDesc.capsule(length / 2, radius)
							.setTranslation(
								(start[0] + end[0]) / 2,
								(start[1] + end[1]) / 2,
								(start[2] + end[2]) / 2
							)
							.setRotation(quaternion)
					];
				})
			);
			return [
				RAPIER.ColliderDesc.compound(
					segments.map((segment) => segment.shape),
					segments.map((segment) => segment.translation),
					segments.map((segment) => segment.rotation)
				)
			];
		}
		const thickness = Math.min(0.08, height * 0.3);
		return [
			RAPIER.ColliderDesc.cuboid(width / 2, thickness / 2, depth / 2).setTranslation(
				0,
				-height / 2 + thickness / 2,
				0
			),
			RAPIER.ColliderDesc.cuboid(width / 2, height / 2, thickness / 2).setTranslation(
				0,
				0,
				-depth / 2 + thickness / 2
			),
			RAPIER.ColliderDesc.cuboid(width / 2, height / 2, thickness / 2).setTranslation(
				0,
				0,
				depth / 2 - thickness / 2
			)
		];
	}
	if (object.kind === 'bowl') {
		const thickness = Math.min(0.08, height * 0.3);
		const result = [
			RAPIER.ColliderDesc.cylinder(thickness / 2, Math.min(width, depth) / 2).setTranslation(
				0,
				-height / 2 + thickness / 2,
				0
			)
		];
		for (let segment = 0; segment < 20; segment++) {
			const angle = (segment / 20) * Math.PI * 2;
			result.push(
				RAPIER.ColliderDesc.cuboid((width * Math.PI) / 40, height / 2, thickness / 2)
					.setTranslation(
						Math.sin(angle) * (width / 2 - thickness / 2),
						0,
						Math.cos(angle) * (depth / 2 - thickness / 2)
					)
					.setRotation(eulerQuaternion([0, angle, 0]))
			);
		}
		return result;
	}
	const result = [
		RAPIER.ColliderDesc.roundCuboid(width / 2 - 0.015, height / 2 - 0.015, depth / 2 - 0.015, 0.015)
	];
	const flange = getFrontFlangeGeometry(object);
	if (flange != null) {
		const [lipWidth, lipHeight, lipDepth] = flange.size;
		result.push(
			RAPIER.ColliderDesc.cuboid(lipWidth / 2, lipHeight / 2, lipDepth / 2).setTranslation(
				...flange.position
			)
		);
	}
	return result;
}

function readSample(context: TPhysicalWorld, time: number): TSample {
	return readMarbleSample(context.marble, time);
}

function readMarbleSample(body: RAPIER.RigidBody, time: number): TSample {
	const position = body.translation();
	const rotation = body.rotation();
	return {
		time,
		position: [position.x, position.y, position.z],
		rotation: [rotation.x, rotation.y, rotation.z, rotation.w]
	};
}

function eulerQuaternion([x, y, z]: TVec3): { x: number; y: number; z: number; w: number } {
	const cx = Math.cos(x / 2);
	const cy = Math.cos(y / 2);
	const cz = Math.cos(z / 2);
	const sx = Math.sin(x / 2);
	const sy = Math.sin(y / 2);
	const sz = Math.sin(z / 2);
	return {
		x: sx * cy * cz + cx * sy * sz,
		y: cx * sy * cz - sx * cy * sz,
		z: cx * cy * sz + sx * sy * cz,
		w: cx * cy * cz - sx * sy * sz
	};
}

function normalizeQuaternion(quaternion: {
	x: number;
	y: number;
	z: number;
	w: number;
}): typeof quaternion {
	const length = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
	return {
		x: quaternion.x / length,
		y: quaternion.y / length,
		z: quaternion.z / length,
		w: quaternion.w / length
	};
}

function rotateVector(
	[x, y, z]: TVec3,
	quaternion: { x: number; y: number; z: number; w: number }
): TVec3 {
	const { x: qx, y: qy, z: qz, w } = quaternion;
	const tx = 2 * (qy * z - qz * y);
	const ty = 2 * (qz * x - qx * z);
	const tz = 2 * (qx * y - qy * x);
	return [
		x + w * tx + qy * tz - qz * ty,
		y + w * ty + qz * tx - qx * tz,
		z + w * tz + qx * ty - qy * tx
	];
}

function getBounds(samples: TSample[], objects: TResolvedObject[]): TPerformance['bounds'] {
	const min: TVec3 = [Infinity, Infinity, Infinity];
	const max: TVec3 = [-Infinity, -Infinity, -Infinity];
	function include(point: TVec3, padding = 0): void {
		for (let axis = 0; axis < 3; axis++) {
			min[axis] = Math.min(min[axis] ?? Infinity, (point[axis] ?? 0) - padding);
			max[axis] = Math.max(max[axis] ?? -Infinity, (point[axis] ?? 0) + padding);
		}
	}
	for (const sample of samples) include(sample.position);
	for (const object of objects) {
		const rotation = eulerQuaternion(object.rotation);
		const localPoints: TVec3[] = [];
		let padding = 0;
		if (object.kind === 'rail' && object.path != null) {
			const { paths, radius } = getRailGeometry(object);
			localPoints.push(...paths[0], ...paths[1]);
			padding = radius;
		} else {
			const size = object.size.map((value) => Math.max(0.04, value));
			if (object.kind === 'bumper') size.fill(Math.max(...size));
			for (const x of [-0.5, 0.5])
				for (const y of [-0.5, 0.5])
					for (const z of [-0.5, 0.5]) {
						localPoints.push([x * (size[0] ?? 0), y * (size[1] ?? 0), z * (size[2] ?? 0)]);
					}
		}
		for (const point of localPoints) {
			include(
				rotateVector(point, rotation).map(
					(value, axis) => value + (object.position[axis] ?? 0)
				) as TVec3,
				padding
			);
		}
	}
	return { min, max };
}

function readSurfaceContacts(
	context: TPhysicalWorld,
	time: number,
	active: Map<string, { contact: TSurfaceContact; steps: number }>,
	contacts: TSurfaceContact[]
): void {
	const touching = new Set<string>();
	for (const marble of context.marbles.values()) {
		if (!marble.body.isEnabled()) continue;
		const marbleCollider = context.world.getCollider(marble.collider);
		const velocity = marble.body.linvel();
		const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
		context.world.contactPairsWith(marbleCollider, (collider) => {
			const object = context.colliders.get(collider.handle);
			if (object == null || (object.kind !== 'rail' && object.kind !== 'bar')) return;
			let supported = false;
			context.world.contactPair(marbleCollider, collider, (manifold) => {
				for (let index = 0; index < manifold.numContacts(); index++) {
					if (manifold.contactDist(index) <= 0.002) supported = true;
				}
			});
			if (!supported) return;
			const key = `${marble.id}:${object.id}`;
			touching.add(key);
			const existing = active.get(key);
			if (existing != null) {
				existing.steps++;
				existing.contact.end = time;
				existing.contact.speed += (speed - existing.contact.speed) / existing.steps;
				return;
			}
			const contact: TSurfaceContact = {
				...(marble.id === 'main' ? {} : { marbleId: marble.id }),
				objectId: object.id,
				start: Math.max(0, time - fixedStep),
				end: time,
				speed
			};
			active.set(key, { contact, steps: 1 });
			contacts.push(contact);
		});
	}
	for (const id of active.keys()) if (!touching.has(id)) active.delete(id);
}

/** Rewinds before a newly placed solid can touch any previously simulated marble sweep. */
function createPredictor(
	project: TProject,
	objects: TResolvedObject[],
	shapeCache: Map<TResolvedObject, RAPIER.ColliderDesc[]>,
	influenceBounds: TPerformance['bounds']
) {
	let context = createPhysicalWorld(project, objects, shapeCache);
	let step = 0;
	const sweeps: TPerformance['bounds'][][] = [];
	const checkpoints: {
		step: number;
		snapshot: Uint8Array;
		colliders: Map<number, TResolvedObject>;
		objectCount: number;
	}[] = [];
	saveCheckpoint();

	function saveCheckpoint(): void {
		checkpoints.push({
			step,
			snapshot: context.world.takeSnapshot(),
			colliders: new Map(context.colliders),
			objectCount: objects.length
		});
	}

	function advance(time: number): void {
		const until = Math.floor(time / fixedStep);
		while (step < until) {
			activateMarbles(context, step * fixedStep);
			const before = [...context.marbles.values()]
				.filter((marble) => marble.body.isEnabled())
				.map((marble) => ({
					marble,
					position: marble.body.translation(),
					velocity: marble.body.linvel()
				}));
			context.world.step();
			const frameSweeps: TPerformance['bounds'][] = [];
			for (const state of before) {
				const after = state.marble.body.translation();
				const nextVelocity = state.marble.body.linvel();
				const sweep = getSweepBounds(
					state.position,
					after,
					state.velocity,
					nextVelocity,
					state.marble.radius,
					project.gravity
				);
				frameSweeps.push(sweep);
				includeBounds(influenceBounds, sweep);
			}
			sweeps.push(frameSweeps);
			step++;
			if (step % 120 === 0) saveCheckpoint();
		}
	}

	function insert(object: TResolvedObject): void {
		const bounds = getBounds([], [object]);
		const affected = sweeps.findIndex((frame) =>
			frame.some((sweep) => boundsOverlap(sweep, bounds))
		);
		if (affected < 0) {
			addPhysicalObject(context.world, context.colliders, object, shapeCache);
			return;
		}
		const until = step;
		let checkpointIndex = checkpoints.length - 1;
		while (checkpointIndex > 0 && (checkpoints[checkpointIndex]?.step ?? Infinity) > affected)
			checkpointIndex--;
		const checkpoint = checkpoints[checkpointIndex];
		if (checkpoint == null)
			throw new Error('The physical prediction is missing its launch checkpoint.');
		const marbleHandle = context.marble.handle;
		const oldMarbles = [...context.marbles.values()];
		context.world.free();
		context.events.free();
		const world = RAPIER.World.restoreSnapshot(checkpoint.snapshot);
		const marbles = new Map(
			oldMarbles.map((marble) => [
				marble.id,
				{ ...marble, body: world.getRigidBody(marble.body.handle) }
			])
		);
		context = {
			marbles,
			marbleColliders: new Map([...marbles.values()].map((marble) => [marble.collider, marble])),
			world,
			events: new RAPIER.EventQueue(true),
			marble: world.getRigidBody(marbleHandle),
			marbleCollider: context.marbleCollider,
			colliders: new Map(checkpoint.colliders)
		};
		for (const missing of objects.slice(checkpoint.objectCount))
			addPhysicalObject(world, context.colliders, missing, shapeCache);
		step = checkpoint.step;
		sweeps.length = step;
		checkpoints.length = checkpointIndex + 1;
		advance(until * fixedStep);
	}

	return {
		get context() {
			return context;
		},
		get step() {
			return step;
		},
		advance,
		insert,
		dispose() {
			context.events.free();
			context.world.free();
		}
	};
}

function boundsOverlap(left: TPerformance['bounds'], right: TPerformance['bounds']): boolean {
	return left.min.every(
		(value, axis) =>
			value <= (right.max[axis] ?? 0) && (left.max[axis] ?? 0) >= (right.min[axis] ?? 0)
	);
}

function activateMarbles(context: TPhysicalWorld, time: number): void {
	for (const marble of context.marbles.values()) {
		if (!marble.body.isEnabled() && marble.startTime <= time + 1e-9) marble.body.setEnabled(true);
	}
}

function getSweepBounds(
	before: { x: number; y: number; z: number },
	after: { x: number; y: number; z: number },
	velocity: { x: number; y: number; z: number },
	nextVelocity: { x: number; y: number; z: number },
	radius: number,
	gravity: number
): TPerformance['bounds'] {
	// Includes substep travel around a contact and the solver's contact margin.
	const padding =
		radius +
		fixedStep *
			Math.max(
				Math.hypot(velocity.x, velocity.y, velocity.z),
				Math.hypot(nextVelocity.x, nextVelocity.y, nextVelocity.z)
			) +
		gravity * fixedStep ** 2 +
		0.05;
	return {
		min: [
			Math.min(before.x, after.x) - padding,
			Math.min(before.y, after.y) - padding,
			Math.min(before.z, after.z) - padding
		],
		max: [
			Math.max(before.x, after.x) + padding,
			Math.max(before.y, after.y) + padding,
			Math.max(before.z, after.z) + padding
		]
	};
}

function includeBounds(target: TPerformance['bounds'], source: TPerformance['bounds']): void {
	for (let axis = 0; axis < 3; axis++) {
		target.min[axis] = Math.min(target.min[axis] ?? Infinity, source.min[axis] ?? Infinity);
		target.max[axis] = Math.max(target.max[axis] ?? -Infinity, source.max[axis] ?? -Infinity);
	}
}
