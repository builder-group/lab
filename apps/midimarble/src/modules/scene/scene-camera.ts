import * as THREE from 'three';
import {
	getProjectMarbles,
	type TCameraSettings,
	type TMarbleDefinition,
	type TPerformance,
	type TProject,
	type TSample,
	type TVec3
} from '../project';

export interface TCameraPose {
	position: TVec3;
	target: TVec3;
	fov: number;
}

/** Derives each frame from project time, including direct seeks and offline export. */
export function evaluateCamera(
	project: TProject,
	performance: TPerformance | null,
	time: number,
	aspect: number,
	distanceOverride?: number
): TCameraPose {
	const keys = project.camera?.keyframes;
	const keyed = keys?.length ? sampleCameraKeyframes(keys, time) : null;
	if (keyed != null)
		return project.camera?.keyframeSpace === 'follow'
			? offsetCameraPose(keyed, getCameraFollowCenter(project, performance, time), 1)
			: keyed;
	const wallStudio = project.scene?.theme === 'wall';
	const followers = project.camera?.followMarbles ? getFollowers(project, performance) : [];
	const target = sampleCameraFollowCenter(project, performance, time, followers);
	target.y -= wallStudio ? 0.24 : 0.45;
	let distance = THREE.MathUtils.clamp(
		distanceOverride ??
			project.camera?.distance ??
			project.cameraDistance ??
			(aspect < 0.9 ? 9.2 : 8.5),
		3,
		200
	);
	const azimuth = project.camera?.azimuth ?? 0.21;
	const elevation = project.camera?.elevation ?? (wallStudio ? 0.23 : 0.24);
	const direction = new THREE.Vector3(
		Math.sin(azimuth) * Math.cos(elevation),
		Math.sin(elevation),
		Math.cos(azimuth) * Math.cos(elevation)
	);
	const fov = project.camera?.fov ?? 36;
	if (followers.length > 0) {
		const right = new THREE.Vector3()
			.crossVectors(THREE.Object3D.DEFAULT_UP, direction)
			.normalize();
		const up = new THREE.Vector3().crossVectors(direction, right).normalize();
		const tanVertical = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * 0.82;
		const tanHorizontal = tanVertical * Math.max(0.05, aspect);
		const leader = new THREE.Vector3(),
			body = new THREE.Vector3();
		// A short look-ahead starts widening the shot before another marble enters it.
		for (const offset of [-0.2, 0, 0.2, 0.4]) {
			const sampleTime = Math.max(0, time + offset);
			samplePosition(performance, sampleTime, project.launch.position, leader);
			const active = followers.filter((follower) =>
				isFollowerActive(follower, sampleTime, leader, body)
			);
			if (!active.length) continue;
			distance = Math.max(distance, fitDistance(leader, project.launch.radius));
			for (const follower of active) {
				samplePosition(follower.track, sampleTime, follower.definition.launch.position, body);
				const start = follower.definition.startTime ?? 0;
				const anticipation =
					time < start
						? THREE.MathUtils.smoothstep(time, start - 0.4, start)
						: time > follower.end
							? 1 -
								THREE.MathUtils.smoothstep(
									sampleTime,
									follower.end,
									follower.end + FOLLOW_RELEASE_SECONDS
								)
							: 1;
				const proximity = 1 - THREE.MathUtils.smoothstep(body.distanceTo(leader), 10, 12);
				body.lerp(leader, 1 - anticipation * proximity);
				distance = Math.max(distance, fitDistance(body, follower.definition.launch.radius));
			}
		}
		function fitDistance(point: THREE.Vector3, radius: number) {
			const relative = point.clone().sub(target);
			return (
				relative.dot(direction) +
				radius +
				Math.max(
					(Math.abs(relative.dot(right)) + radius) / tanHorizontal,
					(Math.abs(relative.dot(up)) + radius) / tanVertical
				)
			);
		}
	}
	const position = target.clone().addScaledVector(direction, distance);
	return {
		position: position.toArray() as TVec3,
		target: target.toArray() as TVec3,
		fov
	};
}

/** Returns the smoothed, look-ahead center before any automatic camera framing offsets. */
export function getCameraFollowCenter(
	project: TProject,
	performance: TPerformance | null,
	time: number
): TVec3 {
	const followers = project.camera?.followMarbles ? getFollowers(project, performance) : [];
	return sampleCameraFollowCenter(project, performance, time, followers).toArray() as TVec3;
}

/** Encodes a captured world pose in the camera's currently selected keyframe space. */
export function cameraPoseToKeyframeSpace(
	project: TProject,
	performance: TPerformance | null,
	time: number,
	pose: TCameraPose
): TCameraPose {
	if (project.camera?.keyframeSpace === 'follow')
		return offsetCameraPose(pose, getCameraFollowCenter(project, performance, time), -1);
	return { position: [...pose.position], target: [...pose.target], fov: pose.fov };
}

/** Preserves each key's world pose at its timestamp; interpolation between converted keys may change. */
export function convertCameraKeyframeSpace(
	project: TProject,
	performance: TPerformance | null,
	nextSpace: NonNullable<TCameraSettings['keyframeSpace']>
): TCameraSettings['keyframes'] {
	const keys = project.camera?.keyframes ?? [];
	if ((project.camera?.keyframeSpace ?? 'world') === nextSpace) return structuredClone(keys);
	const direction = nextSpace === 'follow' ? -1 : 1;
	return keys.map((key) => ({
		...key,
		...offsetCameraPose(key, getCameraFollowCenter(project, performance, key.time), direction)
	}));
}

function sampleCameraKeyframes(
	keys: TCameraSettings['keyframes'],
	time: number
): TCameraPose | null {
	let first: TCameraSettings['keyframes'][number] | undefined;
	let last: TCameraSettings['keyframes'][number] | undefined;
	let a: TCameraSettings['keyframes'][number] | undefined;
	let b: TCameraSettings['keyframes'][number] | undefined;
	for (const key of keys) {
		if (first == null || key.time < first.time) first = key;
		if (last == null || key.time >= last.time) last = key;
		if (key.time < time) {
			if (a == null || key.time >= a.time) a = key;
		} else if (b == null || key.time < b.time) b = key;
	}
	if (first == null || last == null) return null;
	if (time <= first.time) return { position: first.position, target: first.target, fov: first.fov };
	if (time >= last.time) return { position: last.position, target: last.target, fov: last.fov };
	if (a == null || b == null) return null;
	const alpha = THREE.MathUtils.smoothstep(time, a.time, b.time);
	return {
		position: lerpVector(a.position, b.position, alpha),
		target: lerpVector(a.target, b.target, alpha),
		fov: THREE.MathUtils.lerp(a.fov, b.fov, alpha)
	};
}

function sampleCameraFollowCenter(
	project: TProject,
	performance: TPerformance | null,
	time: number,
	followers: TCameraFollower[]
): THREE.Vector3 {
	const wallStudio = project.scene?.theme === 'wall';
	const lead = project.camera?.lead ?? 0.42;
	const point = new THREE.Vector3();
	const ahead = new THREE.Vector3();
	const target = new THREE.Vector3();
	if (wallStudio) {
		// A symmetric time window follows the run rather than shaking on each bounce.
		for (const offset of [-0.24, -0.12, 0, 0.12, 0.24]) {
			sampleFollowCenter(
				project,
				performance,
				followers,
				Math.max(0, time + offset + lead * 0.3),
				point
			);
			target.addScaledVector(point, 0.2);
		}
	} else sampleFollowCenter(project, performance, followers, time, target);
	sampleFollowCenter(project, performance, followers, time + lead, ahead);
	return target.lerp(ahead, wallStudio ? 0.12 : 0.28);
}

function offsetCameraPose(pose: TCameraPose, center: TVec3, direction: 1 | -1): TCameraPose {
	return {
		position: [
			pose.position[0] + direction * center[0],
			pose.position[1] + direction * center[1],
			pose.position[2] + direction * center[2]
		],
		target: [
			pose.target[0] + direction * center[0],
			pose.target[1] + direction * center[1],
			pose.target[2] + direction * center[2]
		],
		fov: pose.fov
	};
}

const FOLLOW_RELEASE_SECONDS = 0.8;

interface TCameraFollower {
	definition: TMarbleDefinition;
	track: Pick<TPerformance, 'samples'> | null;
	end: number;
}

function getFollowers(project: TProject, performance: TPerformance | null): TCameraFollower[] {
	if (!project.marbles?.length || !performance?.additionalMarbles?.length) return [];
	const lastAnchors = new Map<string, number>();
	const noteTimes = new Map(project.notes.map((note) => [note.id, note.time]));
	for (const object of project.objects) {
		if (object.marbleId == null || object.disabled) continue;
		const time = object.trajectoryAnchor?.time ?? noteTimes.get(object.binding?.noteId ?? '');
		if (time != null)
			lastAnchors.set(
				object.marbleId,
				Math.max(lastAnchors.get(object.marbleId) ?? -Infinity, time)
			);
	}
	return getProjectMarbles(project)
		.filter((marble) => marble.id !== 'main')
		.map((definition) => {
			const lastAnchor = lastAnchors.get(definition.id) ?? -Infinity;
			return {
				definition,
				track: performance?.additionalMarbles?.find((track) => track.id === definition.id) ?? null,
				end: Number.isFinite(lastAnchor) ? lastAnchor + 0.65 : project.duration
			};
		});
}

function isFollowerActive(
	follower: TCameraFollower,
	time: number,
	leader: THREE.Vector3,
	point: THREE.Vector3
): boolean {
	if (
		time < (follower.definition.startTime ?? 0) ||
		time > follower.end + FOLLOW_RELEASE_SECONDS ||
		follower.track == null
	)
		return false;
	samplePosition(follower.track, time, follower.definition.launch.position, point);
	return point.distanceToSquared(leader) <= 144;
}

function sampleFollowCenter(
	project: TProject,
	performance: TPerformance | null,
	followers: TCameraFollower[],
	time: number,
	output: THREE.Vector3
): void {
	samplePosition(performance, time, project.launch.position, output);
	if (!followers.length) return;
	const leader = output.clone(),
		point = new THREE.Vector3();
	let weight = 1;
	for (const follower of followers) {
		if (!isFollowerActive(follower, time, leader, point)) continue;
		const enter = THREE.MathUtils.smoothstep(
			time,
			follower.definition.startTime ?? 0,
			(follower.definition.startTime ?? 0) + 0.25
		);
		const exit =
			1 - THREE.MathUtils.smoothstep(time, follower.end, follower.end + FOLLOW_RELEASE_SECONDS);
		const proximity = 1 - THREE.MathUtils.smoothstep(point.distanceTo(leader), 10, 12);
		const contribution = enter * exit * proximity;
		output.addScaledVector(point, contribution);
		weight += contribution;
	}
	output.multiplyScalar(1 / weight);
}

function lerpVector(a: TVec3, b: TVec3, alpha: number): TVec3 {
	return [
		THREE.MathUtils.lerp(a[0], b[0], alpha),
		THREE.MathUtils.lerp(a[1], b[1], alpha),
		THREE.MathUtils.lerp(a[2], b[2], alpha)
	];
}

export function samplePosition(
	performance: Pick<TPerformance, 'samples'> | null,
	time: number,
	fallback: TVec3,
	position: THREE.Vector3,
	rotation?: THREE.Quaternion
) {
	const samples = performance?.samples;
	if (samples == null || samples.length === 0) {
		position.fromArray(fallback);
		rotation?.identity();
		return;
	}
	let low = 0;
	let high = samples.length - 1;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if ((samples[middle]?.time ?? 0) <= time) low = middle;
		else high = middle - 1;
	}
	const first = samples[low] as TSample;
	const second = samples[Math.min(low + 1, samples.length - 1)] as TSample;
	const alpha =
		first === second
			? 0
			: THREE.MathUtils.clamp((time - first.time) / (second.time - first.time), 0, 1);
	position.fromArray(lerpVector(first.position, second.position, alpha));
	if (rotation != null) {
		rotation.fromArray(first.rotation);
		rotation.slerp(new THREE.Quaternion(...second.rotation), alpha);
	}
}
