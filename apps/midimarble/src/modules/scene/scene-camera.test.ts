import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { type TPerformance } from '../project';
import { createDemoProject, createWorldObject } from '../project/fixtures/sample-project';
import { evaluateCamera, samplePosition } from './scene-camera';

const performance: TPerformance = {
	duration: 60,
	dt: 1 / 120,
	objects: [],
	impacts: [],
	noteMarkers: [],
	warnings: [],
	bounds: { min: [0, -120, 0], max: [20, 0, 2] },
	samples: [
		{ time: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1] },
		{ time: 60, position: [20, -120, 2], rotation: [0, 1, 0, 0] }
	]
};

describe('scene camera evaluation', () => {
	it('should produce the same wall-studio frame after a direct seek and sequential playback', () => {
		const project = createDemoProject();
		project.scene = {
			theme: 'wall',
			background: '#ddd',
			keyColor: '#ffe5ce',
			fillColor: '#b9ceff',
			exposure: 1,
			bloom: 1
		};
		const direct = evaluateCamera(project, performance, 43.125, 9 / 16);
		for (let time = 0; time < 43; time += 1 / 60)
			evaluateCamera(project, performance, time, 9 / 16);
		expect(evaluateCamera(project, performance, 43.125, 9 / 16)).toEqual(direct);
		const camera = new THREE.PerspectiveCamera(direct.fov, 9 / 16, 0.05, 1500);
		camera.position.fromArray(direct.position);
		camera.lookAt(new THREE.Vector3(...direct.target));
		camera.updateMatrixWorld();
		const marble = new THREE.Vector3();
		samplePosition(performance, 43.125, project.launch.position, marble);
		marble.project(camera);
		expect(Math.abs(marble.x)).toBeLessThan(0.8);
		expect(Math.abs(marble.y)).toBeLessThan(0.8);
	});

	it('should fit both active marbles in a portrait shot and stop following the finished duet', () => {
		const project = createDemoProject();
		project.camera = {
			distance: 8,
			azimuth: 0.24,
			elevation: 0.2,
			lead: 0.3,
			fov: 36,
			keyframes: [],
			followMarbles: true
		};
		project.marbles = [
			{
				id: 'duet',
				color: '#ffcc44',
				startTime: 3,
				launch: { position: [6, -3, 0.8], velocity: [0, -1, 0], radius: 0.3 }
			}
		];
		project.objects = [
			{
				...createWorldObject('bar', [0, 0, 0]),
				marbleId: 'duet',
				trajectoryAnchor: { time: 14, offset: [0, 0, 0] }
			}
		];
		const duet: TPerformance = {
			...performance,
			samples: [
				{ time: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1] },
				{ time: 20, position: [0, -20, 0], rotation: [0, 0, 0, 1] }
			],
			additionalMarbles: [
				{
					id: 'duet',
					samples: [
						{ time: 3, position: [6, -3, 0.8], rotation: [0, 0, 0, 1] },
						{ time: 20, position: [6, -20, 0.8], rotation: [0, 0, 0, 1] }
					]
				}
			]
		};
		for (const time of [3, 3.2, 5, 10, 14, 14.6]) {
			const pose = evaluateCamera(project, duet, time, 9 / 16);
			const camera = new THREE.PerspectiveCamera(pose.fov, 9 / 16, 0.05, 1500);
			camera.position.fromArray(pose.position);
			camera.lookAt(new THREE.Vector3(...pose.target));
			camera.updateMatrixWorld();
			for (const body of [duet, duet.additionalMarbles?.[0] ?? null]) {
				const position = new THREE.Vector3();
				samplePosition(body, time, project.launch.position, position);
				position.project(camera);
				expect(Math.abs(position.x)).toBeLessThan(0.82);
				expect(Math.abs(position.y)).toBeLessThan(0.82);
			}
		}
		const direct = evaluateCamera(project, duet, 11.2, 9 / 16);
		for (let time = 0; time < 11.2; time += 0.1) evaluateCamera(project, duet, time, 9 / 16);
		expect(evaluateCamera(project, duet, 11.2, 9 / 16)).toEqual(direct);
		const finished = evaluateCamera(project, duet, 16, 9 / 16);
		project.camera.followMarbles = false;
		expect(evaluateCamera(project, duet, 16, 9 / 16)).toEqual(finished);
	});

	it('should honor authored camera endpoints and interpolate unsorted keyframes without mutation', () => {
		const project = createDemoProject();
		project.camera = {
			distance: 8,
			azimuth: 0.2,
			elevation: 0.3,
			lead: 0.4,
			fov: 40,
			keyframes: [
				{ id: 'end', time: 10, position: [10, 20, 30], target: [2, 4, 6], fov: 60 },
				{ id: 'start', time: 0, position: [0, 0, 10], target: [0, 0, 0], fov: 30 }
			]
		};
		expect(evaluateCamera(project, performance, 5, 1)).toEqual({
			position: [5, 10, 20],
			target: [1, 2, 3],
			fov: 45
		});
		expect(evaluateCamera(project, performance, 60, 1)).toEqual({
			position: [10, 20, 30],
			target: [2, 4, 6],
			fov: 60
		});
		expect(project.camera.keyframes[0]?.id).toBe('end');
	});

	it('should clamp motion to its bounds and interpolate rotation while scrubbing', () => {
		const point = new THREE.Vector3();
		const rotation = new THREE.Quaternion();
		samplePosition(performance, 30, [0, 0, 0], point, rotation);
		expect(point.toArray()).toEqual([10, -60, 1]);
		expect(rotation.y).toBeCloseTo(Math.SQRT1_2);
		samplePosition(performance, -1, [0, 0, 0], point);
		expect(point.toArray()).toEqual([0, 0, 0]);
		samplePosition(performance, 100, [0, 0, 0], point);
		expect(point.toArray()).toEqual([20, -120, 2]);
	});

	it('should preserve coincident-key ordering and reflect edits to the same authored array', () => {
		const project = createDemoProject();
		const key = (id: string, time: number, x: number) => ({
			id,
			time,
			position: [x, 0, 8] as [number, number, number],
			target: [0, 0, 0] as [number, number, number],
			fov: 40
		});
		const middle = key('middle-last', 5, 20);
		project.camera = {
			distance: 8,
			azimuth: 0,
			elevation: 0,
			lead: 0,
			fov: 40,
			keyframes: [
				key('start-first', 0, 0),
				key('middle-first', 5, 10),
				key('end-first', 10, 30),
				middle,
				key('start-last', 0, 4),
				key('end-last', 10, 40)
			]
		};
		expect(evaluateCamera(project, performance, 0, 1).position[0]).toBe(0);
		expect(evaluateCamera(project, performance, 5, 1).position[0]).toBe(10);
		expect(evaluateCamera(project, performance, 7.5, 1).position[0]).toBe(25);
		expect(evaluateCamera(project, performance, 10, 1).position[0]).toBe(40);
		middle.time = 6;
		middle.position[0] = 24;
		expect(evaluateCamera(project, performance, 6, 1).position[0]).toBe(24);
	});
});
