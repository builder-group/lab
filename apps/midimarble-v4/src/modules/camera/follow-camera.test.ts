import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { songEnd } from '@/modules/music';
import { parseProject, type TProject } from '@/modules/project';
import { createSimulator } from '@/modules/simulation/simulate';
import type { TSimulationResult } from '@/modules/simulation/types';
import { compareCameraTrack, quaternionToMatrix, type TBlenderCameraDump } from './compare-track';
import {
	bakeFollowCamera,
	pyRound,
	sampleCameraTrack,
	verticalFov,
	type TCameraTrack,
	type TFollowCameraInput,
	type TFollowMarble
} from './follow-camera';
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
		// Jingle Bells run on 3 s past its film end, to see the hold settle and the last marble leave the frame
		const longer = {
			...fixture('jingle-bells').project,
			end: fixture('jingle-bells').project.end + 3
		};
		results.set('jingle-bells-longer', { project: longer, result: simulator.simulate(longer) });
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
		const bass = required(
			result.marbles.find((marble) => marble.laneId === jingle.music.lanes[1]?.id)
		);
		for (let frame = 30 * 30; frame <= 32.5 * 30; frame += 3) {
			const sample = bass.samples.find((item) => item.time >= frame / 30);
			if (sample == null) continue;
			const [u, v] = project(track, frame, sample.position.x, sample.position.y);
			expect(Math.min(u, v)).toBeGreaterThan(0.05);
			expect(Math.max(u, v)).toBeLessThan(0.95);
		}
	});

	it('stays close and steady on two marbles and keeps one of them in frame', () => {
		const { project: jingle, result } = fixture('jingle-bells');
		const track = required(followCameraTrack(jingle, result, 30));
		const halfWidth =
			Math.tan((verticalFov(track.lens, track.aspect) * Math.PI) / 360) * track.aspect;
		let frames = 0;
		let both = 0;
		for (let frame = 30; frame <= 31 * 30; frame += 4) {
			const shown = result.marbles.filter((marble) => {
				const sample = required(marble.samples.find((item) => item.time >= frame / 30));
				const [u, v] = project(track, frame, sample.position.x, sample.position.y);
				return Math.min(u, v) > 0 && Math.max(u, v) < 1;
			}).length;
			frames++;
			if (shown === result.marbles.length) both++;
			expect(shown).toBeGreaterThan(0);
			// A 24 mm marble at the camera distance spans at least 5.5 % of the frame width: no survey of 20 bars
			expect(0.024 / at(track.distance, frame) / halfWidth / 2).toBeGreaterThan(0.055);
		}
		// The second marble leaves the frame only for a while
		expect(both / frames).toBeGreaterThan(0.8);
		// The zoom changes slowly: at most 8 cm per second
		for (let frame = 0; frame + 30 < track.frameCount; frame++)
			expect(Math.abs(at(track.distance, frame + 30) - at(track.distance, frame))).toBeLessThan(
				0.08
			);
	});

	it('lets a marble it does not lead go fully in or fully out, not linger cut at the frame edge', () => {
		const { project: jingle, result } = fixture('jingle-bells');
		const track = required(followCameraTrack(jingle, result, 30));
		const hits = result.hits.map((hit) => hit.actualTime ?? Number.NaN).filter(Number.isFinite);
		const first = pyRound(Math.min(...hits) * 30);
		const last = pyRound(Math.max(...hits) * 30);
		// Distance of a marble centre to the nearest frame edge in frame fractions, negative outside
		const nearest = (frame: number): number[] =>
			result.marbles.map((marble) => {
				const sample = required(marble.samples.find((item) => item.time >= frame / 30));
				const [u, v] = project(track, frame, sample.position.x, sample.position.y);
				return Math.min(u, 1 - u, v, 1 - v);
			});
		let atEdge = 0;
		for (let frame = first; frame <= last; frame++)
			if (nearest(frame).some((distance) => Math.abs(distance) <= 0.04)) atEdge++;
		// 9.6 % of the frames before the edge rule, 4.4 % with it
		expect(atEdge / (last - first + 1)).toBeLessThan(0.06);
		// At 0:21, where the camera follows the bass, the melody sat cut at the left edge
		for (const distance of nearest(21 * 30)) expect(Math.abs(distance)).toBeGreaterThan(0.04);
	});

	it('opens on the release points and the first struck pieces', () => {
		for (const name of ['jingle-bells', 'reference-20'] as const) {
			const { project: loaded, result } = fixture(name);
			const track = required(followCameraTrack(loaded, result, 30));
			const firstPieces = result.pieces
				.filter((piece) => piece.hitTime != null)
				.sort((a, b) => (a.hitTime ?? 0) - (b.hitTime ?? 0))
				.slice(0, 3);
			const releases = result.marbles.map((marble) => required(marble.samples[0]).position);
			// Every one inside the opening frame with a margin of 10 % of it
			for (const { x, y } of [...firstPieces.map((piece) => piece.position), ...releases]) {
				const [u, v] = project(track, 0, x, y);
				expect(Math.min(u, v)).toBeGreaterThan(0.1);
				expect(Math.max(u, v)).toBeLessThan(0.9);
			}
			// And the marbles stay inside with a margin of 5 % until the first hit
			const firstHit = Math.min(...result.hits.map((hit) => hit.actualTime ?? Infinity));
			for (let frame = 0; frame <= pyRound(firstHit * 30); frame++) {
				for (const marble of result.marbles) {
					const sample = required(
						marble.samples.find((item) => item.time >= frame / 30) ?? marble.samples[0]
					);
					const [u, v] = project(track, frame, sample.position.x, sample.position.y);
					expect(Math.min(u, v)).toBeGreaterThan(0.05);
					expect(Math.max(u, v)).toBeLessThan(0.95);
				}
			}
		}
	});

	it('follows the marble that plays the next notes when the marbles do not fit one frame', () => {
		const fall = (x: number): TFollowMarble['motion'] => {
			const time = Float64Array.from({ length: 101 }, (_, index) => index / 10);
			return { time, x: time.map(() => x), y: time.map((value) => -0.3 * value) };
		};
		const input = (isNoted: boolean): TFollowCameraInput => ({
			fps: 30,
			duration: 10,
			frame: { width: 1080, height: 1920 },
			camera: { mode: 'rig', distance: 0.7, pitch: 1.15, lead: 0.15, smoothing: 0.6, shots: [] },
			loop: null,
			pieceLength: 0.09,
			marbles: [
				{
					id: 'melody',
					radius: 0.012,
					motion: fall(-0.75),
					...(isNoted ? { hitTimes: [0.5, 1, 1.5, 2, 2.5] } : {})
				},
				{
					id: 'bass',
					radius: 0.012,
					motion: fall(0.75),
					...(isNoted ? { hitTimes: [7, 7.5, 8, 8.5, 9, 9.5] } : {})
				}
			]
		});
		const targetX = (track: TCameraTrack, time: number): number =>
			at(track.target, pyRound(time * 30) * 2);
		const noted = required(bakeFollowCamera(input(true)));
		// The melody plays first, then the bass has the notes ahead from 5 s on
		expect(targetX(noted, 0.5)).toBeLessThan(-0.7);
		expect(Math.abs(targetX(noted, 5))).toBeLessThan(0.1);
		expect(targetX(noted, 9.5)).toBeGreaterThan(0.7);
		// The pan from one marble to the other takes seconds, not a cut
		for (let frame = 0; frame + 1 < noted.frameCount; frame++)
			expect(Math.abs(at(noted.target, frame * 2 + 2) - at(noted.target, frame * 2))).toBeLessThan(
				0.015
			);
		// Without notes the focus marble, the first, leads throughout
		const unnoted = required(bakeFollowCamera(input(false)));
		expect(targetX(unnoted, 9.5)).toBeLessThan(-0.7);
	});

	it('pushes in relative to the current framing', () => {
		const { project: jingle, result } = fixture('jingle-bells');
		const rig = jingle.design.camera.distance;
		const automatic = required(followCameraTrack(jingle, result, 30));
		const pushed = required(
			followCameraTrack(
				{
					...jingle,
					design: {
						...jingle.design,
						camera: {
							...jingle.design.camera,
							shots: [
								{ id: 'shot', time: 10, kind: 'pushIn', roll: 0, distance: rig * 0.7, length: 2 }
							]
						}
					}
				},
				result,
				30
			)
		);
		// Two marbles widen the frame past the rig distance; the Push In still comes to 0.7 of it
		expect(at(automatic.distance, 11 * 30)).toBeGreaterThan(rig * 1.2);
		expect(at(pushed.distance, 11 * 30) / at(automatic.distance, 11 * 30)).toBeCloseTo(0.7, 2);
		expect(at(pushed.distance, 14 * 30)).toBeCloseTo(at(automatic.distance, 14 * 30), 3);
		// It frames the leading marble
		const shown = result.marbles.some((marble) => {
			const sample = required(marble.samples.find((item) => item.time >= 11));
			const [u, v] = project(pushed, 11 * 30, sample.position.x, sample.position.y);
			return Math.min(u, v) > 0.1 && Math.max(u, v) < 0.9;
		});
		expect(shown).toBe(true);
	});

	it('holds on the last hit and shows the final pieces', () => {
		const { project: jingle, result } = fixture('jingle-bells-longer');
		const track = required(followCameraTrack(jingle, result, 30));
		const last = Math.max(...result.hits.map((hit) => hit.actualTime ?? -Infinity));
		const end = track.frameCount - 1;
		expect(last + 3).toBeLessThan(end / 30);
		// The camera settles after the hit: well under 1 cm/s at the end against about 50 cm/s while following
		const speed = (frame: number): number =>
			Math.hypot(
				...[0, 1, 2].map(
					(axis) =>
						at(track.position, (frame + 1) * 3 + axis) - at(track.position, frame * 3 + axis)
				)
			) * 30;
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
		// The marble that struck last stays in the held frame as it falls away, for about a second
		const lastLane = required(result.hits.find((hit) => hit.actualTime === last)).laneId;
		const marble = required(result.marbles.find((item) => item.laneId === lastLane));
		for (let frame = pyRound(last * 30); frame <= pyRound((last + 0.8) * 30); frame += 3) {
			const sample = required(marble.samples.find((item) => item.time >= frame / 30));
			const [u, v] = project(track, frame, sample.position.x, sample.position.y);
			expect(Math.min(u, v)).toBeGreaterThan(0);
			expect(Math.max(u, v)).toBeLessThan(1);
		}
		// It leaves the held frame within about a second, so a longer song tail would end the film on an empty frame
		const leaves = pyRound((last + 1.5) * 30);
		const sample = required(marble.samples.find((item) => item.time >= leaves / 30));
		const [u, v] = project(track, leaves, sample.position.x, sample.position.y);
		expect(Math.min(u, v) < 0 || Math.max(u, v) > 1).toBe(true);
	});

	it('ends Jingle Bells SONG_TAIL after the last note with the last marble in the final frame', () => {
		const { project: jingle, result } = fixture('jingle-bells');
		const track = required(followCameraTrack(jingle, result, 30));
		const lastNote = Math.max(
			...jingle.music.lanes.flatMap((lane) => lane.hits.map((hit) => hit.time))
		);
		expect(jingle.end).toBe(songEnd(lastNote));
		const last = Math.max(...result.hits.map((hit) => hit.actualTime ?? -Infinity));
		const lastLane = required(result.hits.find((hit) => hit.actualTime === last)).laneId;
		const marble = required(result.marbles.find((item) => item.laneId === lastLane));
		const end = track.frameCount - 1;
		const sample = required(marble.samples.find((item) => item.time >= end / 30 - 1e-6));
		const [u, v] = project(track, end, sample.position.x, sample.position.y);
		// Inside the frame with a margin of 5 % of it
		expect(Math.min(u, v)).toBeGreaterThan(0.05);
		expect(Math.max(u, v)).toBeLessThan(0.95);
	});

	it('eases a Push In back to the rig after its hold', () => {
		const { project: reference, result } = fixture('reference-20');
		const rig = reference.design.camera.distance;
		const withShot = (length?: number): TProject => ({
			...reference,
			design: {
				...reference.design,
				camera: {
					...reference.design.camera,
					shots: [
						{
							id: 'shot',
							time: 6,
							kind: 'pushIn',
							roll: 0,
							distance: rig * 0.7,
							...(length != null ? { length } : {})
						}
					]
				}
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
