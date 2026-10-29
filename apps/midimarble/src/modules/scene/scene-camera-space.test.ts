import { createDemoProject } from '../project/fixtures/sample-project';
import { describe, expect, it } from 'vitest';
import { getMotionSignature } from '../motion/motion-signature';
import { type TCameraSettings, type TPerformance, type TProject, type TVec3 } from '../project';
import {
	cameraPoseToKeyframeSpace,
	convertCameraKeyframeSpace,
	evaluateCamera,
	getCameraFollowCenter,
	type TCameraPose
} from './scene-camera';

describe('camera keyframe spaces', () => {
	it('should retain legacy world interpolation and endpoint holds when the space is absent', () => {
		const project = createCameraProject();
		project.camera.keyframes = createWorldKeys();
		const original = structuredClone(project);
		const poses = [0, 5, 10, 18].map((time) => evaluateCamera(project, performance, time, 1));
		project.camera.keyframeSpace = 'world';
		expect([0, 5, 10, 18].map((time) => evaluateCamera(project, performance, time, 1))).toEqual(
			poses
		);
		expect(poses[1]).toEqual({ position: [2, 1, 9], target: [1, 0, 0], fov: 40 });
		expect(poses[3]).toEqual({ position: [4, 2, 8], target: [2, 0, 0], fov: 50 });
		expect(project.camera.keyframes).toEqual(original.camera.keyframes);
	});

	it('should keep following before and after a single key instead of freezing the camera in space', () => {
		const project = createCameraProject();
		project.camera.keyframeSpace = 'follow';
		project.camera.keyframes = [
			{ id: 'relative', time: 5, position: [1, 2, 10], target: [1, 2, 0], fov: 42 }
		];
		expect(evaluateCamera(project, performance, 0, 1)).toEqual({
			position: [1, 2, 10],
			target: [1, 2, 0],
			fov: 42
		});
		expect(evaluateCamera(project, performance, 18, 1)).toEqual({
			position: [5, -26, 12],
			target: [5, -26, 2],
			fov: 42
		});
	});

	it('should interpolate authored offsets and lenses before adding the current nonlinear run center', () => {
		const project = createCameraProject();
		project.camera.keyframeSpace = 'follow';
		project.camera.keyframes = createWorldKeys();
		const original = structuredClone(project);
		expect(evaluateCamera(project, performance, 5, 1)).toEqual({
			position: [12, -9, 10],
			target: [11, -10, 1],
			fov: 40
		});
		expect(project).toEqual(original);
	});

	it('should translate follow keys with an edited run while leaving world keys fixed', () => {
		const project = createCameraProject();
		project.camera.keyframes = createWorldKeys();
		const translated = structuredClone(performance);
		const delta: TVec3 = [31, -17, 2];
		for (const sample of translated.samples)
			sample.position = sample.position.map((value, index) => value + (delta[index] ?? 0)) as TVec3;
		const world = evaluateCamera(project, performance, 7.25, 1);
		expect(evaluateCamera(project, translated, 7.25, 1)).toEqual(world);
		project.camera.keyframeSpace = 'follow';
		const pose = evaluateCamera(project, performance, 7.25, 1);
		const moved = evaluateCamera(project, translated, 7.25, 1);
		for (let index = 0; index < 3; index++) {
			expect(moved.position[index]).toBeCloseTo((pose.position[index] ?? 0) + (delta[index] ?? 0));
			expect(moved.target[index]).toBeCloseTo((pose.target[index] ?? 0) + (delta[index] ?? 0));
		}
		expect(moved.fov).toBe(pose.fov);
	});

	it('should convert both ways without changing key-time world poses, identities or physical inputs', () => {
		const project = createCameraProject();
		project.camera.keyframes = createWorldKeys();
		const original = structuredClone(project);
		const signature = getMotionSignature(project);
		const converted = convertCameraKeyframeSpace(project, performance, 'follow');
		expect(project).toEqual(original);
		project.camera = { ...project.camera, keyframeSpace: 'follow', keyframes: converted };
		for (const key of original.camera.keyframes)
			expectPoseClose(evaluateCamera(project, performance, key.time, 1), key);
		expect(convertCameraKeyframeSpace(project, performance, 'world')).toEqual(
			original.camera.keyframes
		);
		expect(converted.map(({ id, time, fov }) => ({ id, time, fov }))).toEqual(
			original.camera.keyframes.map(({ id, time, fov }) => ({ id, time, fov }))
		);
		expect(getMotionSignature(project)).toBe(signature);
	});

	it('should return independently editable keys even when no space conversion is needed', () => {
		const project = createCameraProject();
		project.camera.keyframes = createWorldKeys();
		const original = structuredClone(project);
		const converted = convertCameraKeyframeSpace(project, performance, 'world');
		const first = converted[0];
		if (first == null) throw new Error('Expected a camera key.');
		first.position[0] += 5;
		first.target[1] += 5;
		expect(project).toEqual(original);
	});

	it('should reproduce a captured world pose when it is recorded as a follow key', () => {
		const project = createCameraProject();
		project.camera.keyframeSpace = 'follow';
		const pose: TCameraPose = { position: [15, -7, 9], target: [11, -8, 1], fov: 52 };
		const original = structuredClone(pose);
		const key = cameraPoseToKeyframeSpace(project, performance, 3.125, pose);
		project.camera.keyframes = [{ id: 'captured', time: 3.125, ...key }];
		expectPoseClose(evaluateCamera(project, performance, 3.125, 9 / 16), pose);
		key.position[0] += 1;
		expect(pose).toEqual(original);
	});

	it('should preserve captured world values and own the returned vectors in legacy space', () => {
		const project = createCameraProject();
		const pose: TCameraPose = { position: [15, -7, 9], target: [11, -8, 1], fov: 52 };
		const key = cameraPoseToKeyframeSpace(project, performance, 3.125, pose);
		expect(key).toEqual(pose);
		expect(key.position).not.toBe(pose.position);
		expect(key.target).not.toBe(pose.target);
	});

	it('should keep the shared center independent of authored framing offsets', () => {
		const project = createCameraProject();
		project.scene = {
			theme: 'wall',
			background: '#888888',
			keyColor: '#ffffff',
			fillColor: '#dddddd',
			exposure: 1,
			bloom: 1
		};
		project.camera.lead = 0.3;
		const center = getCameraFollowCenter(project, performance, 6);
		const original = evaluateCamera(project, performance, 6, 1);
		expect(original.target[1]).toBeCloseTo(center[1] - 0.24);
		project.camera.distance = 20;
		project.camera.azimuth = -0.5;
		project.camera.elevation = 0.6;
		expect(getCameraFollowCenter(project, performance, 6)).toEqual(center);
		const reframed = evaluateCamera(project, performance, 6, 1);
		expect(reframed.target).toEqual(original.target);
		expect(reframed.position).not.toEqual(original.position);
	});

	it('should follow the active marble group without overriding authored distance or lens', () => {
		const project = createDuetProject();
		project.camera.keyframeSpace = 'follow';
		project.camera.distance = 100;
		project.camera.keyframes = [
			{ id: 'tight', time: 0, position: [0, 1, 3], target: [0, 0, 0], fov: 31 }
		];
		const duet = createDuetPerformance();
		expect(getCameraFollowCenter(project, duet, 5)).toEqual([14, -10, 1]);
		const pose = evaluateCamera(project, duet, 5, 9 / 16);
		expect(pose).toEqual({ position: [14, -9, 4], target: [14, -10, 1], fov: 31 });
		expect(evaluateCamera(project, duet, 5, 16 / 9, 200)).toEqual(pose);
	});

	it('should produce the same smoothed follow shot after direct seeks and sequential playback', () => {
		const project = createDuetProject();
		project.camera.keyframeSpace = 'follow';
		project.camera.lead = 0.4;
		project.camera.keyframes = createWorldKeys();
		project.scene = {
			theme: 'wall',
			background: '#888888',
			keyColor: '#ffffff',
			fillColor: '#dddddd',
			exposure: 1,
			bloom: 1
		};
		const duet = createDuetPerformance();
		const original = structuredClone({ project, duet });
		const direct = evaluateCamera(project, duet, 7.125, 9 / 16);
		for (let time = 0; time < 7.125; time += 1 / 60) evaluateCamera(project, duet, time, 9 / 16);
		expect(evaluateCamera(project, duet, 7.125, 9 / 16)).toEqual(direct);
		expect({ project, duet }).toEqual(original);
	});

	it('should evaluate relative keys against the launch fallback when no performance is available', () => {
		const project = createCameraProject();
		project.camera.keyframeSpace = 'follow';
		project.camera.keyframes = [
			{ id: 'fallback', time: 0, position: [0, 1, 3], target: [0, 0, 0], fov: 31 }
		];
		expect(getCameraFollowCenter(project, null, 5)).toEqual(project.launch.position);
		expect(evaluateCamera(project, null, 5, 1)).toEqual({
			position: [0, 5, 3],
			target: [0, 4, 0],
			fov: 31
		});
	});
});

function createCameraProject(): TProject & { camera: TCameraSettings } {
	return {
		...createDemoProject(),
		objects: [],
		camera: { distance: 8, azimuth: 0.2, elevation: 0.3, lead: 0, fov: 40, keyframes: [] }
	};
}

function createDuetProject(): TProject & { camera: TCameraSettings } {
	const project = createCameraProject();
	project.camera.followMarbles = true;
	project.marbles = [
		{
			id: 'duet',
			color: '#ffcc44',
			startTime: 2,
			launch: { position: [8, 0, 0], velocity: [0, -1, 0], radius: 0.3 }
		}
	];
	return project;
}

function createWorldKeys(): TCameraSettings['keyframes'] {
	return [
		{ id: 'late', time: 10, position: [4, 2, 8], target: [2, 0, 0], fov: 50 },
		{ id: 'early', time: 0, position: [0, 0, 10], target: [0, 0, 0], fov: 30 }
	];
}

function createDuetPerformance(): TPerformance {
	return {
		...structuredClone(performance),
		additionalMarbles: [
			{
				id: 'duet',
				samples: performance.samples.map((sample) => ({
					...sample,
					position: [sample.position[0] + 8, sample.position[1], sample.position[2]]
				}))
			}
		]
	};
}

function expectPoseClose(actual: TCameraPose, expected: TCameraPose) {
	for (let index = 0; index < 3; index++) {
		expect(actual.position[index]).toBeCloseTo(expected.position[index] ?? 0, 9);
		expect(actual.target[index]).toBeCloseTo(expected.target[index] ?? 0, 9);
	}
	expect(actual.fov).toBe(expected.fov);
}

const performance: TPerformance = {
	duration: 18,
	dt: 1 / 120,
	objects: [],
	impacts: [],
	noteMarkers: [],
	warnings: [],
	bounds: { min: [0, -28, 0], max: [10, 0, 2] },
	samples: [
		{ time: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1] },
		{ time: 5, position: [10, -10, 1], rotation: [0, 0, 0, 1] },
		{ time: 10, position: [0, -20, 0], rotation: [0, 0, 0, 1] },
		{ time: 18, position: [4, -28, 2], rotation: [0, 0, 0, 1] }
	]
};
