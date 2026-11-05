import { beforeAll, describe, expect, it } from 'vitest';
import { type TProject, tieOf } from '@/modules/project';
import { loadFixture } from '@/modules/project/test-helpers';
import { bowlCatch, createSimulator } from '@/modules/simulation';
import type { TSimulationResult } from '@/modules/simulation';
import { quaternionToMatrix } from './compare-track';
import { bakeFollowCamera, pyRound, sampleCameraTrack, SIDE_ANGLE, verticalFov, type TCameraTrack, type TFollowCameraInput, type TFollowMarble } from './follow-camera';
import { at, project, required } from './follow-camera-test-helpers';
import { followCameraTrack } from './project-track';

const FIXTURES = ['zigzag', 'two-marbles'] as const;

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
		// Zigzag run on 3 s past its film end, to see the hold settle and the marble leave the frame
		const longer = { ...fixture('zigzag').project, length: fixture('zigzag').project.length + 3 };
		results.set('zigzag-longer', { project: longer, result: simulator.simulate(longer) });
		simulator.dispose();
	});

	it('should keep the wall upright at Sway 0, and roll on its own at the default', () => {
		const { project, result } = fixture(FIXTURES[0] as string);
		const tilts = (sway: number | undefined): number[] => {
			const camera = { ...project.film.camera, ...(sway != null ? { sway } : {}) };
			const track = required(followCameraTrack({ ...project, film: { ...project.film, camera } }, result, 30));
			const frames = track.rotation.length / 4;
			return Array.from({ length: frames }, (_, frame) => {
				const matrix = quaternionToMatrix(track.rotation.subarray(frame * 4, frame * 4 + 4));
				// The image's right direction: its share along the wall's up is the roll
				return Math.abs(matrix[2]?.[0] ?? Number.NaN);
			});
		};
		expect(Math.max(...tilts(0))).toBeLessThan(1e-6);
		expect(Math.max(...tilts(undefined))).toBeGreaterThan(0.05);
		expect(Math.max(...tilts(0.5))).toBeLessThan(Math.max(...tilts(undefined)));
	});

	it('should stand the camera at the Turn, the same as the default when the project sets 95°', () => {
		const { project, result } = fixture(FIXTURES[0] as string);
		const track = (turn: number | undefined): Float64Array => {
			const { turn: _, ...base } = project.film.camera;
			const camera = { ...base, ...(turn != null ? { turn } : {}) };
			return required(followCameraTrack({ ...project, film: { ...project.film, camera } }, result, 30)).position;
		};
		const standard = track(undefined);
		expect(Array.from(track(SIDE_ANGLE))).toEqual(Array.from(standard));
		expect(track(SIDE_ANGLE + 0.5)[0]).not.toBeCloseTo(standard[0] ?? 0, 3);
	});

	it('rounds halves to even like Python', () => {
		expect([0.5, 1.5, 2.5, 4.5, 2.4, 2.6].map(pyRound)).toEqual([0, 2, 2, 4, 2, 3]);
	});

	it('bakes one pose per film frame and keeps the marble in frame', () => {
		const { project: zigzag, result } = fixture('zigzag');
		const track = required(followCameraTrack(zigzag, result, 30));
		expect(track.frameCount).toBe(Math.ceil(result.duration * 30 - 1e-6) + 1);
		expect(track.lens).toBe(85);
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

	it('follows the marble that plays the next notes in a close shot', () => {
		const fall = (x: number): TFollowMarble['motion'] => {
			const time = Float64Array.from({ length: 101 }, (_, index) => index / 10);
			return { time, x: time.map(() => x), y: time.map((value) => -0.3 * value) };
		};
		const input = (isNoted: boolean): TFollowCameraInput => ({
			fps: 30,
			duration: 10,
			frame: { width: 1080, height: 1920 },
			camera: {
				mode: 'rig',
				distance: 0.7,
				pitch: 1.15,
				lead: 0.15,
				smoothing: 0.6,
				shots: [{ time: -2, kind: 'pushIn', distance: 0.35 }]
			},
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

	it('leads the frame downward while the marble falls, so it sits above the center', () => {
		const time = Float64Array.from({ length: 601 }, (_, index) => index / 100);
		// A slow roll for 2 s, a drop at 2.5 m/s for 1.5 s, then a slow roll again
		const y = time.map((t) => (t < 2 ? -0.3 * t : t < 3.5 ? -0.6 - 2.5 * (t - 2) : -4.35 - 0.3 * (t - 3.5)));
		const x = time.map((t) => 0.1 * Math.sin(t));
		const track = required(
			bakeFollowCamera({
				fps: 30,
				duration: 6,
				frame: { width: 1080, height: 1920 },
				// As much in frame as 0.9 m through the former 50 mm lens
				camera: { mode: 'rig', distance: 1.53, pitch: 0.7, lead: 0.15, smoothing: 0.6, shots: [] },
				marbles: [{ id: 'marble', radius: 0.012, hitTimes: [0.5, 1, 1.5, 4, 4.5, 5], motion: { time, x, y } }]
			})
		);
		const height = (seconds: number): number => {
			const index = pyRound(seconds * 100);
			return project(track, pyRound(seconds * 30), at(x, index), at(y, index))[1];
		};
		// The look target sits below the falling marble: 0.04 m was all the lead allowed before
		for (const seconds of [2.4, 2.6, 2.8])
			expect(at(track.target, pyRound(seconds * 30) * 2 + 1)).toBeLessThan(at(y, pyRound(seconds * 100)) - 0.06);
		// Mid-drop the marble is in the upper part of the frame (0.51 to 0.61 before), and never near the bottom edge
		expect(height(2.6)).toBeGreaterThan(0.62);
		for (let seconds = 2; seconds <= 3.8; seconds += 0.1) expect(height(seconds)).toBeGreaterThan(0.2);
	});

	it('keeps a single marble in frame when the opening frames pieces far from it and a long fall pulls the frame ahead', () => {
		// `check_apply_scene.py`'s film: the opening's box puts the waiting marble at its corner, smoothing looks ahead to the fall
		const time = Float64Array.from({ length: 217 }, (_, index) => 0.1 + index / 240);
		const x = time.map((value) => 0.1 * (value - 0.1));
		const y = time.map((value) => 0.6 - 4.905 * (value - 0.1) ** 2);
		const track = required(
			bakeFollowCamera({
				fps: 60,
				duration: 1,
				frame: { width: 1080, height: 1920 },
				camera: { mode: 'rig', distance: 0.5, pitch: 0.45, lead: 0.15, smoothing: 0.6, shots: [] },
				opening: [{ time: 0.3, x: 0.25, y: 0.4 }, { time: 0.38, x: 0.08, y: 0.22 }],
				marbles: [{ id: 'marble', radius: 0.01, motion: { time, x, y } }]
			})
		);
		let worst = 0;
		for (let frame = 0; frame < track.frameCount; frame++) {
			const index = Math.max(0, Math.min(time.length - 1, pyRound((frame / 60 - 0.1) * 240)));
			const [u, v] = project(track, frame, at(x, index), at(y, index));
			worst = Math.max(worst, Math.abs(u - 0.5), Math.abs(v - 0.5));
		}
		expect(worst).toBeLessThan(0.45);
	});

	it('frames marbles that need more room, and stands at a Wide shot\'s distance', () => {
		const fall = (x: number): TFollowMarble['motion'] => {
			const time = Float64Array.from({ length: 101 }, (_, index) => index / 10);
			return { time, x: time.map(() => x), y: time.map((value) => -0.3 * value) };
		};
		// Side by side 44 cm apart
		const input = (shots: NonNullable<TFollowCameraInput['camera']>['shots']): TFollowCameraInput => ({
			fps: 30,
			duration: 10,
			frame: { width: 1080, height: 1920 },
			camera: { mode: 'rig', distance: 0.7, pitch: 0.7, lead: 0.15, smoothing: 0.6, shots },
			marbles: [
				{ id: 'melody', radius: 0.012, motion: fall(-0.22), hitTimes: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
				{ id: 'bass', radius: 0.012, motion: fall(0.22), hitTimes: [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5] }
			]
		});
		const shown = (track: TCameraTrack, seconds: number): number =>
			[-0.22, 0.22].filter((x) => {
				const [u, v] = project(track, pyRound(seconds * 30), x, -0.3 * seconds);
				return Math.min(u, v) > 0 && Math.max(u, v) < 1;
			}).length;
		const automatic = required(bakeFollowCamera(input([])));
		const wide = required(bakeFollowCamera(input([{ time: 2, kind: 'wide', distance: 0.7 * 1.6, length: 6 }])));
		for (const seconds of [4, 5, 6, 7]) {
			expect(shown(automatic, seconds)).toBe(2);
			expect(shown(wide, seconds)).toBe(2);
		}
		// At least the shot's distance while it holds, and the automatic framing again after it eases back
		expect(at(wide.distance, 5 * 30)).toBeGreaterThanOrEqual(0.7 * 1.6 - 1e-6);
		expect(Math.abs(at(wide.distance, 10 * 30) - at(automatic.distance, 10 * 30))).toBeLessThan(0.05);
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

	it('keeps the marble that still plays in frame after the other has finished', () => {
		// Side by side and falling together; the first plays until 5 s, the second until 8 s
		const time = Float64Array.from({ length: 101 }, (_, index) => index / 10);
		const fall = (x: number): TFollowMarble['motion'] => ({ time, x: time.map(() => x), y: time.map((value) => -0.3 * value) });
		const track = required(
			bakeFollowCamera({
				fps: 30,
				duration: 10,
				frame: { width: 1080, height: 1920 },
				camera: { mode: 'rig', distance: 0.7, pitch: 0.7, lead: 0.15, smoothing: 0.6, shots: [] },
				marbles: [
					{ id: 'first', radius: 0.012, motion: fall(-0.2), hitTimes: [1, 2, 3, 4, 5] },
					{ id: 'second', radius: 0.012, motion: fall(0.2), hitTimes: [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8] }
				]
			})
		);
		for (let seconds = 6.5; seconds <= 8; seconds += 0.1) {
			const [u, v] = project(track, pyRound(seconds * 30), 0.2, -0.3 * seconds);
			expect(Math.min(u, v)).toBeGreaterThan(0.05);
			expect(Math.max(u, v)).toBeLessThan(0.95);
		}
	});

	it('keeps both marbles of a duet in frame, close and steady', () => {
		const { project: duet, result } = fixture('two-marbles');
		const track = required(followCameraTrack(duet, result, 30));
		const halfWidth = Math.tan((verticalFov(track.lens, track.aspect) * Math.PI) / 360) * track.aspect;
		for (let frame = 0; frame <= 1.5 * 30; frame += 3) {
			for (const marble of result.marbles) {
				const sample = required(marble.samples.find((item) => item.time >= frame / 30) ?? marble.samples[0]);
				const [u, v] = project(track, frame, sample.position.x, sample.position.y);
				expect(Math.min(u, v)).toBeGreaterThan(0);
				expect(Math.max(u, v)).toBeLessThan(1);
			}
			// A 24 mm marble at the camera distance spans at least 4.5 % of the frame width
			expect(0.024 / at(track.distance, frame) / halfWidth / 2).toBeGreaterThan(0.045);
		}
		for (let frame = 0; frame + 30 < track.frameCount; frame++) expect(Math.abs(at(track.distance, frame + 30) - at(track.distance, frame))).toBeLessThan(0.06);
	});

	it('opens on the release points and the first struck pieces', () => {
		const { project: zigzag, result } = fixture('zigzag');
		const track = required(followCameraTrack(zigzag, result, 30));
		const firstPieces = result.pieces.filter((piece) => piece.hitTime != null).sort((a, b) => (a.hitTime ?? 0) - (b.hitTime ?? 0)).slice(0, 3);
		const releases = result.marbles.map((marble) => required(marble.samples[0]).position);
		for (const { x, y } of [...firstPieces.map((piece) => piece.position), ...releases]) {
			const [u, v] = project(track, 0, x, y);
			expect(Math.min(u, v)).toBeGreaterThan(0.1);
			expect(Math.max(u, v)).toBeLessThan(0.9);
		}
	});

	it('pushes in relative to the current framing, and eases back to the rig after its hold', () => {
		const { project: zigzag, result } = fixture('zigzag');
		const rig = zigzag.film.camera.distance;
		const withShot = (length?: number): TProject => ({
			...zigzag,
			film: { ...zigzag.film, camera: { ...zigzag.film.camera, shots: [{ id: 'shot', time: 1, kind: 'pushIn', distance: rig * 0.7, ...(length != null ? { hold: length } : {}) }] } }
		});
		const automatic = required(followCameraTrack(zigzag, result, 30));
		const held = required(followCameraTrack(withShot(1), result, 30));
		// Two seconds on from the shot it has come to 0.7 of the framing it pushed in from
		expect(Math.abs(at(held.distance, 2 * 30) / at(automatic.distance, 2 * 30) - 0.7)).toBeLessThan(0.1);
		expect(Math.abs(at(held.distance, 6 * 30) - at(automatic.distance, 6 * 30))).toBeLessThan(0.07);
		const open = required(followCameraTrack(withShot(0), result, 30));
		expect(at(open.distance, 6 * 30)).toBeCloseTo(rig * 0.7, 1);
	});

	it('holds on the last hit, shows the final pieces and lets the marble leave', () => {
		const { project: zigzag, result } = fixture('zigzag-longer');
		const track = required(followCameraTrack(zigzag, result, 30));
		const last = Math.max(...result.hits.map((hit) => hit.actualTime ?? -Infinity));
		const end = track.frameCount - 1;
		const speed = Math.hypot(...[0, 1, 2].map((axis) => at(track.position, end * 3 + axis) - at(track.position, (end - 1) * 3 + axis))) * 30;
		expect(speed).toBeLessThan(0.01);
		const finals = result.pieces.filter((piece) => piece.hitTime != null).sort((a, b) => (b.hitTime ?? 0) - (a.hitTime ?? 0)).slice(0, 3);
		for (const piece of finals) {
			const [u, v] = project(track, end, piece.position.x, piece.position.y);
			expect(Math.min(u, v)).toBeGreaterThan(0);
			expect(Math.max(u, v)).toBeLessThan(1);
		}
		const marble = required(result.marbles[0]);
		const leaves = pyRound((last + 2) * 30);
		const sample = required(marble.samples.find((item) => item.time >= leaves / 30));
		const [u, v] = project(track, leaves, sample.position.x, sample.position.y);
		expect(Math.min(u, v) < 0 || Math.max(u, v) > 1).toBe(true);
	});

	it('shows each marble landing in its Bowl', () => {
		const { project: duet, result } = fixture('two-marbles');
		const track = required(followCameraTrack(duet, result, 30));
		const bowls = duet.track.pieces.filter((piece) => piece.type === 'bowl');
		expect(bowls).toHaveLength(2);
		for (const bowl of bowls) {
			const caught = bowlCatch(result, bowl.id);
			expect(caught.status).toBe('caught');
			const marble = required(result.marbles.find((item) => item.marbleId === tieOf(bowl)?.marbleId));
			const enter = pyRound(required(caught.enterTime) * 30);
			const sample = required(marble.samples.find((item) => item.time >= enter / 30 - 1e-6));
			const [u, v] = project(track, enter, sample.position.x, sample.position.y);
			expect(Math.min(u, v)).toBeGreaterThan(0.05);
			expect(Math.max(u, v)).toBeLessThan(0.95);
		}
	});
});
