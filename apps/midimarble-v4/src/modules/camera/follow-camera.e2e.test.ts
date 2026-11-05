import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { BOWL_TAIL_MAX, bowlTail, songEnd } from '@/modules/music';
import { type TProject, tieOf } from '@/modules/project';
import { loadFixture } from '@/modules/project/test-helpers';
import { bowlCatch, createSimulator } from '@/modules/simulation';
import type { TSimulationResult } from '@/modules/simulation';
import { compareCameraTrack, type TBlenderCameraDump } from './compare-track';
import { bowlExit } from './bowl-exit';
import { pyRound, verticalFov } from './follow-camera';
import { at, project, required } from './follow-camera-test-helpers';
import { followCameraTrack } from './project-track';

const FIXTURES = ['zigzag', 'reference-20', 'jingle-bells'] as const;

/** Blender dump written by `pnpm camera:check`, or null when the check has not run on this machine */
function loadDump(name: string, fps: number): TBlenderCameraDump | null {
	const url = new URL(`../../../.local/camera/${name}-${fps}/blender-camera.json`, import.meta.url);
	return existsSync(url) ? (JSON.parse(readFileSync(url, 'utf8')) as TBlenderCameraDump) : null;
}

describe('follow camera on whole songs', () => {
	const results = new Map<string, { project: TProject; result: TSimulationResult }>();
	const fixture = (name: string): { project: TProject; result: TSimulationResult } => required(results.get(name));

	beforeAll(async () => {
		const simulator = await createSimulator();
		for (const name of FIXTURES) {
			const loaded = loadFixture(name);
			results.set(name, { project: loaded, result: simulator.simulate(loaded) });
		}
		// Jingle Bells run on 3 s past its film end, to see the hold settle and the last marble leave the frame
		const longer = { ...fixture('jingle-bells').project, length: fixture('jingle-bells').project.length + 3 };
		results.set('jingle-bells-longer', { project: longer, result: simulator.simulate(longer) });
		simulator.dispose();
	});

	it('keeps the marble that still plays in frame after the other has finished', () => {
		const { project: jingle, result } = fixture('jingle-bells');
		const track = required(followCameraTrack(jingle, result, 30));
		// The melody's last note is at 31 s; the bass plays until 32.5 s, where the camera holds
		const bass = required(
			result.marbles.find((marble) => marble.marbleId === jingle.marbles[1]?.id)
		);
		for (let frame = 30 * 30; frame <= 32.5 * 30; frame += 3) {
			const sample = bass.samples.find((item) => item.time >= frame / 30);
			if (sample == null) continue;
			const [u, v] = project(track, frame, sample.position.x, sample.position.y);
			expect(Math.min(u, v)).toBeGreaterThan(0.05);
			expect(Math.max(u, v)).toBeLessThan(0.95);
		}
	});

	it('keeps both marbles of a duet in frame, close and steady', () => {
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
			// A 24 mm marble at the camera distance spans at least 4.5 % of the frame width: no survey of 20 bars
			expect(0.024 / at(track.distance, frame) / halfWidth / 2).toBeGreaterThan(0.045);
		}
		// Both marbles stay in frame on nearly every frame (80.8 % when the readable maximum was 6 %)
		expect(both / frames).toBeGreaterThan(0.93);
		// At 0:12, where Bass was fully out, both are in frame
		const at12 = result.marbles.filter((marble) => {
			const sample = required(marble.samples.find((item) => item.time >= 12));
			const [u, v] = project(track, 12 * 30, sample.position.x, sample.position.y);
			return Math.min(u, v) > 0 && Math.max(u, v) < 1;
		});
		expect(at12.length).toBe(2);
		// Once the opening's one push-in from its wide frame is over (6 s from the first hit), the zoom changes slowly and does not pump: at most 10 cm within a second
		for (let frame = 7 * 30; frame + 30 < track.frameCount; frame++)
			expect(Math.abs(at(track.distance, frame + 30) - at(track.distance, frame))).toBeLessThan(
				0.1
			);
	});

	it('lets a marble it does not lead go fully in or fully out, not linger cut at the frame edge', () => {
		const { project: jingle, result } = fixture('jingle-bells');
		const track = required(followCameraTrack(jingle, result, 30));
		const hits = result.hits.map((hit) => hit.actualTime ?? Number.NaN).filter(Number.isFinite);
		const first = pyRound(Math.min(...hits) * 30);
		const last = pyRound(Math.max(...hits) * 30);
		// Distance of a marble center to the nearest frame edge in frame fractions, negative outside
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

	it('pushes in relative to the current framing', () => {
		const { project: jingle, result } = fixture('jingle-bells');
		const rig = jingle.film.camera.distance;
		const automatic = required(followCameraTrack(jingle, result, 30));
		const pushed = required(
			followCameraTrack(
				{
					...jingle,
					film: {
						...jingle.film,
						camera: {
							...jingle.film.camera,
							shots: [
								{ id: 'shot', time: 10, kind: 'pushIn', distance: rig * 0.7, hold: 2 }
							]
						}
					}
				},
				result,
				30
			)
		);
		// Whatever the two marbles need at that moment, the Push In still comes to 0.7 of it
		// Framing the leading marble alone changes the group's need a little
		expect(Math.abs(at(pushed.distance, 11 * 30) / at(automatic.distance, 11 * 30) - 0.7)).toBeLessThan(
			0.06
		);
		expect(Math.abs(at(pushed.distance, 14 * 30) - at(automatic.distance, 14 * 30))).toBeLessThan(0.07);
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
		// The marble that struck last stays in the held frame as it falls into its Bowl
		const lastMarble = required(result.hits.find((hit) => hit.actualTime === last)).marbleId;
		const marble = required(result.marbles.find((item) => item.marbleId === lastMarble));
		for (let frame = pyRound(last * 30); frame <= pyRound((last + 0.8) * 30); frame += 3) {
			const sample = required(marble.samples.find((item) => item.time >= frame / 30));
			const [u, v] = project(track, frame, sample.position.x, sample.position.y);
			expect(Math.min(u, v)).toBeGreaterThan(0);
			expect(Math.max(u, v)).toBeLessThan(1);
		}
		// Its Bowl holds it there after that too, so the film ends on the marble and not on an empty frame
		const held = pyRound((last + 1.5) * 30);
		const sample = required(marble.samples.find((item) => item.time >= held / 30));
		const [u, v] = project(track, held, sample.position.x, sample.position.y);
		expect(Math.min(u, v)).toBeGreaterThan(0);
		expect(Math.max(u, v)).toBeLessThan(1);
	});

	it('ends Jingle Bells on the longest tail, with both marbles landing in their Bowls in frame', () => {
		const { project: jingle, result } = fixture('jingle-bells');
		const track = required(followCameraTrack(jingle, result, 30));
		const lastNote = Math.max(
			...jingle.marbles.flatMap((marble) => marble.hits.map((hit) => hit.time))
		);
		const longer = required(results.get('jingle-bells-longer'));
		const exit = required(bowlExit(longer.project, longer.result));
		expect(exit).toBe(Number.POSITIVE_INFINITY);
		expect(jingle.length).toBe(songEnd(lastNote, bowlTail(exit)));
		const end = track.frameCount - 1;
		const bowls = jingle.track.pieces.filter((piece) => piece.type === 'bowl');
		expect(bowls).toHaveLength(2);
		for (const bowl of bowls) {
			const caught = bowlCatch(result, bowl.id);
			expect(caught.status).toBe('caught');
			const marble = required(result.marbles.find((item) => item.marbleId === tieOf(bowl)?.marbleId));
			// The marble enters its Bowl in frame, with a margin of 5 % of it
			const enter = pyRound(required(caught.enterTime) * 30);
			const sample = required(marble.samples.find((item) => item.time >= enter / 30 - 1e-6));
			const [u, v] = project(track, enter, sample.position.x, sample.position.y);
			expect(Math.min(u, v)).toBeGreaterThan(0.05);
			expect(Math.max(u, v)).toBeLessThan(0.95);
			// A catch after the last hit stays in the held frame to the end
			if (required(caught.enterTime) < Math.max(...result.hits.map((hit) => hit.actualTime ?? -Infinity))) continue;
			const mouth = required(result.pieces.find((piece) => piece.entityId === bowl.id)).position;
			const [mu, mv] = project(track, end, mouth.x, mouth.y);
			expect(Math.min(mu, mv)).toBeGreaterThan(0.05);
			expect(Math.max(mu, mv)).toBeLessThan(0.95);
		}
	});

	it('ends Reference 20 no later than the longest tail, with its last marble in its Bowl in frame', () => {
		const { project: reference, result } = fixture('reference-20');
		const lastNote = Math.max(...reference.marbles.flatMap((marble) => marble.hits.map((hit) => hit.time)));
		expect(reference.length).toBeLessThanOrEqual(songEnd(lastNote, BOWL_TAIL_MAX));
		const track = required(followCameraTrack(reference, result, 30));
		const end = track.frameCount - 1;
		const marble = required(result.marbles[0]);
		const sample = required([...marble.samples].reverse().find((item) => item.time <= end / 30 + 1e-6));
		const [u, v] = project(track, end, sample.position.x, sample.position.y);
		expect(Math.min(u, v)).toBeGreaterThan(0);
		expect(Math.max(u, v)).toBeLessThan(1);
	});

	it('frames the last hit and the Bowl together in the held ending', () => {
		const { project: reference, result } = fixture('reference-20');
		const held = required(followCameraTrack(reference, result, 30));
		const without = required(
			followCameraTrack(
				{ ...reference, track: { ...reference.track, pieces: reference.track.pieces.filter((piece) => piece.type !== 'bowl') } },
				{ ...result, pieces: result.pieces.filter((piece) => piece.type !== 'bowl') },
				30
			)
		);
		const end = held.frameCount - 1;
		const mouth = required(result.pieces.find((piece) => piece.type === 'bowl')).position;
		const [, before] = project(without, end, mouth.x, mouth.y);
		const [u, v] = project(held, end, mouth.x, mouth.y);
		// Held on the last pieces alone, the Bowl sits lower in the frame than when the frame holds both
		expect(v).toBeGreaterThan(before);
		expect(Math.min(u, v)).toBeGreaterThan(0.1);
		expect(Math.max(u, v)).toBeLessThan(0.9);
	});

	it('eases a Push In back to the rig after its hold', () => {
		const { project: reference, result } = fixture('reference-20');
		const rig = reference.film.camera.distance;
		const withShot = (length?: number): TProject => ({
			...reference,
			film: {
				...reference.film,
				camera: {
					...reference.film.camera,
					shots: [
						{
							id: 'shot',
							time: 6,
							kind: 'pushIn',
							distance: rig * 0.7,
							...(length != null ? { hold: length } : {})
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

	// Parity with Blender where `pnpm camera:check` left its dumps in `.local/camera/`
	for (const name of FIXTURES) {
		const dump = loadDump(name, 30);
		it.skipIf(dump == null)(`matches the camera Blender bakes for ${name}`, () => {
			const { project: loaded, result } = fixture(name);
			const track = required(
				followCameraTrack({ ...loaded, film: { ...loaded.film, theme: 'brass' } }, result, 30)
			);
			const error = compareCameraTrack(track, required(dump));
			expect(error.frameCountDelta).toBe(0);
			expect(error.maxPosition).toBeLessThan(0.01);
			expect(error.maxAngle).toBeLessThan(0.5);
		});
	}
});
