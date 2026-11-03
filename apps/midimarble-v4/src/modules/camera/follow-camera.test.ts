import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseProject, type TProject } from '@/modules/project';
import { createSimulator } from '@/modules/simulation/simulate';
import type { TSimulationResult } from '@/modules/simulation/types';
import { compareCameraTrack, quaternionToMatrix, type TBlenderCameraDump } from './compare-track';
import { pyRound, sampleCameraTrack, verticalFov, type TCameraTrack } from './follow-camera';
import { followCameraTrack } from './project-track';

const FIXTURES = ['zigzag', 'reference-20', 'jingle-bells'] as const;

function loadFixture(name: string): TProject {
	const json = readFileSync(
		new URL(`../../../fixtures/${name}.marble.json`, import.meta.url),
		'utf8'
	);
	const [isProjectOk, projectErr, project] = parseProject(json);
	if (!isProjectOk) throw projectErr;
	return project;
}

/** Blender dump written by `pnpm camera:check`, or null when the check has not run on this machine */
function loadDump(name: string, fps: number): TBlenderCameraDump | null {
	const url = new URL(`../../../.local/camera/${name}-${fps}/blender-camera.json`, import.meta.url);
	return existsSync(url) ? (JSON.parse(readFileSync(url, 'utf8')) as TBlenderCameraDump) : null;
}

/** Marble position in normalised image coordinates (0 to 1, y up) seen through the track at `frame` */
function project(track: TCameraTrack, frame: number, x: number, y: number): [number, number] {
	const rotation = quaternionToMatrix(track.rotation.subarray(frame * 4, frame * 4 + 4));
	const relative = [
		x - at(track.position, frame * 3),
		-track.depth - at(track.position, frame * 3 + 1),
		y - at(track.position, frame * 3 + 2)
	];
	// Camera space = R^T * relative
	const local = [0, 1, 2].map((column) =>
		rotation.reduce((sum, row, index) => sum + at(row, column) * at(relative, index), 0)
	);
	const depth = -at(local, 2);
	const halfHeight = Math.tan((verticalFov(track.lens, track.aspect) * Math.PI) / 360);
	const halfWidth = halfHeight * track.aspect;
	return [0.5 + at(local, 0) / depth / halfWidth / 2, 0.5 + at(local, 1) / depth / halfHeight / 2];
}

function at(values: ArrayLike<number>, index: number): number {
	return values[index] ?? Number.NaN;
}

function required<T>(value: T | null | undefined): T {
	if (value == null) throw new Error('Missing value');
	return value;
}

describe('follow camera', () => {
	const results = new Map<string, { project: TProject; result: TSimulationResult }>();
	const fixture = (name: string): { project: TProject; result: TSimulationResult } =>
		required(results.get(name));

	beforeAll(async () => {
		const simulator = await createSimulator();
		for (const name of FIXTURES) {
			const loaded = loadFixture(name);
			results.set(name, { project: loaded, result: simulator.simulate(loaded) });
		}
		simulator.dispose();
	});

	it('rounds halves to even like Python', () => {
		expect([0.5, 1.5, 2.5, 4.5, 2.4, 2.6].map(pyRound)).toEqual([0, 2, 2, 4, 2, 3]);
	});

	it('bakes one pose per film frame and keeps the marble in frame', () => {
		const { project: zigzag, result } = fixture('zigzag');
		const track = required(followCameraTrack(zigzag, result, 30));
		expect(track.frameCount).toBe(Math.ceil(result.duration * 30 - 1e-6) + 1);
		expect(track.lens).toBe(50);
		const samples = required(result.marbles[0]).samples;
		const release = required(samples[0]).time;
		for (let frame = 0; frame < track.frameCount; frame += 5) {
			const time = frame / 30;
			const sample = samples.find((item) => item.time >= time);
			if (sample == null || time < release) continue;
			const [u, v] = project(track, frame, sample.position.x, sample.position.y);
			expect(u).toBeGreaterThan(0);
			expect(u).toBeLessThan(1);
			expect(v).toBeGreaterThan(0);
			expect(v).toBeLessThan(1);
		}
	});

	it('keeps the marble that still plays in frame after the other has finished', () => {
		const { project: jingle, result } = fixture('jingle-bells');
		const track = required(followCameraTrack(jingle, result, 30));
		// The melody's last note is at 31 s; the bass plays until 32.5 s, where the camera holds
		const bass = required(result.marbles.find((marble) => marble.laneId === jingle.music.lanes[1]?.id));
		for (let frame = 30 * 30; frame <= 32.5 * 30; frame += 3) {
			const sample = bass.samples.find((item) => item.time >= frame / 30);
			if (sample == null) continue;
			const [u, v] = project(track, frame, sample.position.x, sample.position.y);
			expect(Math.min(u, v)).toBeGreaterThan(0.05);
			expect(Math.max(u, v)).toBeLessThan(0.95);
		}
	});

	it('keeps both marbles in frame and readable while both play', () => {
		const { project: jingle, result } = fixture('jingle-bells');
		const track = required(followCameraTrack(jingle, result, 30));
		const halfWidth = Math.tan((verticalFov(track.lens, track.aspect) * Math.PI) / 360) * track.aspect;
		for (let frame = 30; frame <= 31 * 30; frame += 4) {
			for (const marble of result.marbles) {
				const sample = required(marble.samples.find((item) => item.time >= frame / 30));
				const [u, v] = project(track, frame, sample.position.x, sample.position.y);
				expect(Math.min(u, v)).toBeGreaterThan(0);
				expect(Math.max(u, v)).toBeLessThan(1);
			}
			// A 24 mm marble at the camera distance spans at least 3.5 % of the frame width
			expect(0.024 / at(track.distance, frame) / halfWidth / 2).toBeGreaterThan(0.035);
		}
	});

	it('holds on the last hit and shows the final pieces', () => {
		const { project: jingle, result } = fixture('jingle-bells');
		const track = required(followCameraTrack(jingle, result, 30));
		const last = Math.max(...result.hits.map((hit) => hit.actualTime ?? -Infinity));
		const end = track.frameCount - 1;
		expect(last + 2).toBeLessThan(end / 30);
		// The camera settles after the hit: well under 1 cm/s at the end against about 50 cm/s while following
		const speed = (frame: number): number =>
			Math.hypot(...[0, 1, 2].map((axis) => at(track.position, (frame + 1) * 3 + axis) - at(track.position, frame * 3 + axis))) * 30;
		expect(speed(end - 1)).toBeLessThan(0.01);
		const finals = result.pieces
			.filter((piece) => piece.hitTime != null)
			.sort((a, b) => (b.hitTime ?? 0) - (a.hitTime ?? 0))
			.slice(0, 3);
		for (const piece of finals) {
			const [u, v] = project(track, end, piece.position.x, piece.position.y);
			expect(Math.min(u, v)).toBeGreaterThan(0);
			expect(Math.max(u, v)).toBeLessThan(1);
		}
	});

	it('eases a Push In back to the rig after its hold', () => {
		const { project: reference, result } = fixture('reference-20');
		const rig = reference.design.camera.distance;
		const withShot = (length?: number): TProject => ({
			...reference,
			design: {
				...reference.design,
				camera: { ...reference.design.camera, shots: [{ id: 'shot', time: 6, kind: 'pushIn', roll: 0, distance: rig * 0.7, ...(length != null ? { length } : {}) }] }
			}
		});
		const held = required(followCameraTrack(withShot(), result, 30));
		expect(at(held.distance, 7.5 * 30)).toBeLessThan(rig * 0.85);
		expect(at(held.distance, 11 * 30)).toBeCloseTo(rig, 2);
		const open = required(followCameraTrack(withShot(0), result, 30));
		expect(at(open.distance, 11 * 30)).toBeCloseTo(rig * 0.7, 2);
	});

	it('samples between frames', () => {
		const { project: zigzag, result } = fixture('zigzag');
		const track = required(followCameraTrack(zigzag, result, 30));
		const onFrame = sampleCameraTrack(track, 10 / 30);
		expect(onFrame.position[0]).toBeCloseTo(at(track.position, 30), 9);
		const between = sampleCameraTrack(track, 10.5 / 30);
		expect(between.position[2]).toBeCloseTo(
			(at(track.position, 32) + at(track.position, 35)) / 2,
			9
		);
		expect(Math.hypot(...between.rotation)).toBeCloseTo(1, 9);
	});

	// Parity with Blender where `pnpm camera:check` left its dumps in `.local/camera/`
	for (const name of FIXTURES) {
		const dump = loadDump(name, 30);
		it.skipIf(dump == null)(`matches the camera Blender bakes for ${name}`, () => {
			const { project: loaded, result } = fixture(name);
			const track = required(
				followCameraTrack({ ...loaded, design: { ...loaded.design, theme: 'brass' } }, result, 30)
			);
			const error = compareCameraTrack(track, required(dump));
			expect(error.frameCountDelta).toBe(0);
			expect(error.maxPosition).toBeLessThan(0.01);
			expect(error.maxAngle).toBeLessThan(0.5);
		});
	}
});
