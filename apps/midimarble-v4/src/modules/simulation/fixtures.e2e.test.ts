import { beforeAll, describe, expect, it } from 'vitest';
import { type TProject, type TVec2, tieOf, tempoOf } from '@/modules/project';
import { NO_BLENDER_OBJECTS, checkRun } from '@/modules/building';
import { findLongGaps } from './assists';
import { bowlCatch, bowlOfMarble } from './bowl';
import { paceAt } from './pace';
import { frameBand, startRailId } from './placement';
import { createSimulator, type TSimulator } from './simulate';
import { HIT_DRIFT, type TMarbleSample, type TSimulationResult } from './types';
import { loadFixture } from '@/modules/project/test-helpers';

function expectAllOnTime(result: TSimulationResult, count: number): void {
	expect(result.hits).toHaveLength(count);
	for (const hit of result.hits) {
		expect(hit.status, hit.hitId).toBe('onTime');
		expect(Math.abs(hit.error ?? Infinity)).toBeLessThanOrEqual(HIT_DRIFT);
	}
	expect(result.pieces.every((piece) => piece.status === 'placed' || piece.status === 'free')).toBe(true);
}

function expectDotsInFrame(project: TProject, result: TSimulationResult): void {
	const band = frameBand(project);
	for (const hit of result.hits)
		expect(Math.abs((hit.dot?.x ?? Infinity) - band.centerX), hit.hitId).toBeLessThanOrEqual(
			band.halfWidth
		);
}

function withFreeWindmill(project: TProject, position: TVec2, motorSpeed: number): TProject {
	return {
		...project,
		revision: project.revision + 1,
		track: { ...project.track, pieces: [
			...project.track.pieces,
			{
				id: 'windmill-far',
				name: 'Windmill',
				type: 'windmill', params: { motorSpeed }, angle: 0.3, place: { kind: 'free', position: position }
			}
		] }
	};
}

let simulator: TSimulator;

beforeAll(async () => {
	// A fresh simulator per file, so fixture results never come from another test's snapshots
	simulator = await createSimulator();
});

describe('fixtures', () => {
	it('every fixture: a clean preflight, but for what its filter names', () => {
		// long-gap: the tunnel's run strikes two platforms twice and clips through one of them, and Fix only clears that by sending hit 7 80 cm out of the marble; windmill: the Windmill is anchored to the path as a case study for motion, so it touches two platforms and the marble rolls on one; two-marbles: the collision is its point
		const allowed: Record<string, string[]> = {
			'long-gap': ['Marble 1 hits Platform 6 twice', 'Marble 1 hits Platform 5 twice', 'Marble 1 passes through Platform 5'],
			windmill: ['Platform 2 touches Windmill 1', 'Windmill 1 touches Platform 4'],
			'two-marbles': ['Marble 1 collides with Marble 2']
		};
		for (const name of ['zigzag', 'staircase', 'long-gap', 'windmill', 'two-marbles', 'tap-along', 'reference-20', 'jingle-bells']) {
			const project = loadFixture(name);
			const song = { id: 'song', kind: 'midi' as const, path: 'song.mid', name: 'Song', start: 0, backing: [] };
			const withSong = { ...project, songs: project.songs.length > 0 ? project.songs : [song] };
			expect(checkRun(withSong, simulator.simulate(project), NO_BLENDER_OBJECTS).issues.map((issue) => issue.title), name).toEqual(allowed[name] ?? []);
		}
	}, 20_000);

	it('zigzag: sixteen mirrored platforms on time and in frame', () => {
		const project = loadFixture('zigzag');
		const result = simulator.simulate(project);
		expectAllOnTime(result, 16);
		expectDotsInFrame(project, result);
		const angles = project.track.pieces
			.map((piece) => piece.angle)
			.filter((angle): angle is number => angle != null);
		expect(angles).toHaveLength(16);
		// Mirrored, with Continue's small turns where the plain copy would strike twice
		angles.forEach((angle, i) => expect(Math.abs(angle - (i % 2 === 0 ? -0.45 : 0.45))).toBeLessThanOrEqual((4 * Math.PI) / 180 + 1e-3));
		// The dots alternate sides of the frame center once the zigzag settles
		const xs = result.hits.slice(6).map((hit) => hit.dot?.x ?? 0);
		xs.forEach((x, i) => expect(Math.sign(x - (xs[i - 1] ?? -x))).toBe(i % 2 === 0 ? -1 : 1));
	});

	it('long-gap: a rail and a tunnel bridge 1.5 s gaps with every hit on time', () => {
		const project = loadFixture('long-gap');
		const result = simulator.simulate(project);
		expectAllOnTime(result, 8);
		expectDotsInFrame(project, result);
		const gaps = findLongGaps(project, 'marble-1');
		expect(gaps.map((gap) => [gap.fromHitId, gap.bridgedBy])).toEqual([
			['hit-1-3', 'rail-1'],
			['hit-1-6', 'tunnel-1']
		]);
		const band = frameBand(project);
		const samples = result.marbles[0]?.samples ?? [];
		for (const [id, from, to] of [
			['rail-1', 0.75, 2.25],
			['tunnel-1', 2.85, 4.35]
		] as const) {
			const piece = result.pieces.find((item) => item.pieceId === id);
			expect(piece?.status).toBe('placed');
			expect(piece?.entryTime).toBeGreaterThan(from);
			expect(piece?.path?.length).toBeGreaterThanOrEqual(2);
			// One contact for the whole roll, and the marble stays in frame through the gap. Scenery is
			// environment, so a later touch after the gap is a plain contact.
			expect(result.contacts.filter((contact) => contact.otherId === id && contact.time < to)).toHaveLength(1);
			const contact = result.contacts.find((item) => item.otherId === id);
			expect(contact?.time).toBeCloseTo(piece?.entryTime ?? 0, 2);
			const inGap = samples.filter((sample) => sample.time > from && sample.time < to);
			expect(
				inGap.every((sample) => Math.abs(sample.position.x - band.centerX) <= band.halfWidth)
			).toBe(true);
			// The piece carries the marble for most of the gap instead of a long fall
			expect(Math.min(...inGap.map((sample) => sample.position.y))).toBeGreaterThan(
				(contact?.position.y ?? 0) - 0.4
			);
		}
	});

	it('windmill: the windmill struck between two platforms turns and records its motion', () => {
		const project = loadFixture('windmill');
		const result = simulator.simulate(project);
		expectAllOnTime(result, 7);
		expectDotsInFrame(project, result);
		const windmill = result.pieces.find((piece) => piece.type === 'windmill');
		const motion = windmill?.motion ?? [];
		expect(motion[0]?.time).toBe(0);
		// Scenery: no hit belongs to the windmill; the marble strikes it at its anchor, between two platforms
		expect(result.hits.some((hit) => hit.pieceId === windmill?.pieceId)).toBe(false);
		const anchor = windmill?.entryTime ?? 0;
		expect(anchor).toBeGreaterThan(0.75);
		expect(anchor).toBeLessThan(1.05);
		const strike = result.contacts.find((contact) => contact.otherId === windmill?.pieceId);
		expect(strike?.time).toBeCloseTo(anchor, 2);
		const rest = motion.filter((sample) => sample.time <= anchor);
		expect(rest.every((sample) => sample.angle === windmill?.angle)).toBe(true);
		for (let i = 1; i < motion.length; i++) {
			expect((motion[i]?.time ?? 0) > (motion[i - 1]?.time ?? 0)).toBe(true);
			// Unwrapped: no step jumps by a turn
			expect(Math.abs((motion[i]?.angle ?? 0) - (motion[i - 1]?.angle ?? 0))).toBeLessThan(1);
		}
		const last = motion[motion.length - 1];
		expect(last?.time).toBeCloseTo(result.duration, 9);
		expect(Math.abs((last?.angle ?? 0) - (windmill?.angle ?? 0))).toBeGreaterThan(0.5);
	});

	it('reference-20: two zigzag sections joined by a rail, every hit on time and descending', () => {
		const project = loadFixture('reference-20');
		const result = simulator.simulate(project);
		const hitCount = project.marbles.reduce((count, marble) => count + marble.hits.length, 0);
		// 24 hits 0.4 s apart per section at the default half gravity, less any hit no angle could serve
		expect(hitCount).toBeGreaterThanOrEqual(45);
		expectAllOnTime(result, hitCount);
		expect(result.pieces.filter((piece) => piece.type === 'rail')).toHaveLength(1);
		// Each dot lies below the dot two hits earlier, in the same column of the zigzag
		const hits = [...result.hits].sort((a, b) => a.targetTime - b.targetTime);
		hits.slice(2).forEach((hit, i) =>
			expect(hit.dot?.y ?? Infinity, hit.hitId).toBeLessThan(hits[i]?.dot?.y ?? -Infinity)
		);
		expect((hits[0]?.dot?.y ?? 0) - (hits.at(-1)?.dot?.y ?? 0)).toBeGreaterThan(3);
	});

	it('two-marbles: one intended collision and every hit on time', () => {
		const project = loadFixture('two-marbles');
		const result = simulator.simulate(project);
		expectAllOnTime(result, 6);
		const marbleContacts = result.contacts.filter((contact) => contact.kind === 'marble');
		expect(marbleContacts).toHaveLength(2);
		expect(marbleContacts[0]?.time).toBeCloseTo(0.18, 2);
		// No piece of one marble touches the other marble
		for (const contact of result.contacts.filter((item) => item.kind === 'piece')) {
			const marble = contact.marbleId.replace('marble-', '');
			expect(contact.otherId.startsWith(`piece-${marble}-`) || contact.otherId === `bowl-lane-${marble}`).toBe(true);
		}
	});

	it('jingle-bells: melody and bass from the MIDI import, every hit on time without marble contacts', () => {
		const project = loadFixture('jingle-bells');
		const result = simulator.simulate(project);
		const counts = project.marbles.map((marble) => marble.hits.length);
		// The refrain's 51 melody notes and 64 bass notes, none left out by the build
		expect(counts).toEqual([51, 64]);
		expectAllOnTime(result, 115);
		expect(project.marbles.map((marble) => marble.sound)).toEqual([9, 8]);
		expect(project.film.theme).toBe('theme-christmas');
		expect(project.film.themes.find((theme) => theme.id === 'theme-christmas')).toMatchObject({ name: 'Christmas', base: 'brass' });
		expect(project.film.decor.length).toBeGreaterThan(70);
		// A theme carries no side dressing
		expect(project.film.themes.find((theme) => theme.id === 'theme-christmas')?.wallKind).toBeUndefined();
		expect(project.film.decor.map((item) => item.source)).toEqual(expect.arrayContaining(['decor:snowfall']));
		// Built at new projects' default Gravity, which the assists keep on the shared pace
		expect(project.gravity).toBe(0.25);
		// Rails with the Switchback layout hold the melody across its long notes
		expect(result.pieces.filter((piece) => piece.layout === 'switchback').length).toBeGreaterThanOrEqual(10);
		// While both marbles play, they never touch each other or the other marble's pieces
		const until = Math.min(...project.marbles.map((marble) => marble.hits.at(-1)?.time ?? 0));
		const played = result.contacts.filter((contact) => contact.time <= until);
		expect(played.filter((contact) => contact.kind === 'marble')).toHaveLength(0);
		const marbleOf = (id: string): string | undefined => {
			const piece = project.track.pieces.find((item) => item.id === id);
			return tieOf(piece)?.marbleId ?? project.marbles.find((marble) => marble.id === id || startRailId(marble.id) === id)?.id;
		};
		for (const contact of played.filter((item) => item.kind === 'piece'))
			expect(marbleOf(contact.otherId), contact.otherId).toBe(marbleOf(contact.marbleId));
		// The dots keep to the shared descent pace, so one camera frames both marbles: at most two end beyond
		// the limit, where the build had to rotate a piece by hand, and none by more than 0.15 m
		const pace = result.pace;
		if (pace == null) throw new Error('The run has no pace');
		const offsets = result.hits.map((hit) => Math.abs((hit.dot?.y ?? Infinity) - paceAt(pace, hit.targetTime)));
		expect(offsets.filter((offset) => offset > pace.limit).length).toBeLessThanOrEqual(2);
		expect(Math.max(...offsets)).toBeLessThan(pace.limit + 0.15);
		const [melody, bass] = result.marbles;
		const bassY = new Map(bass?.samples.map((sample) => [Math.round(sample.time * 240), sample.position.y]));
		let spread = 0;
		for (const sample of melody?.samples ?? []) {
			const other = bassY.get(Math.round(sample.time * 240));
			if (sample.time >= 1 && sample.time <= until && other != null) spread = Math.max(spread, Math.abs(sample.position.y - other));
		}
		expect(spread).toBeLessThan(1);
		// Half gravity stacks each column's pieces about 0.3 m apart, against 0.52 m at full gravity
		const melodyMarble = project.marbles[0]?.id;
		const platforms = result.pieces.filter(
			(item) =>
				item.type === 'platform' &&
				tieOf(project.track.pieces.find((piece) => piece.id === item.pieceId))?.marbleId === melodyMarble
		);
		const heights = platforms.map((piece) => piece.position.y);
		expect(platforms.length / (Math.max(...heights) - Math.min(...heights))).toBeGreaterThan(5);
		// The film camera follows the sampled pace
		expect(result.descent?.length).toBeGreaterThan(60);
		expect(result.descent?.[10]?.y).toBeCloseTo(paceAt(pace, result.descent?.[10]?.time ?? 0), 12);
		// The MIDI file is the project's song
		expect(project.songs).toEqual([expect.objectContaining({ kind: 'midi', path: 'audio/jingle-bells.mid' })]);
		expect(tempoOf(project)?.bpm).toBe(120);
	}, 20_000);

	it('jingle-bells: a windmill no marble comes near leaves every hit and sample unchanged', () => {
		const project = loadFixture('jingle-bells');
		const base = simulator.simulate(project);
		for (const motorSpeed of [0, 3]) {
			const result = simulator.simulate(withFreeWindmill(project, { x: 5, y: 5 }, motorSpeed));
			expect(result.hits.filter((hit) => hit.status === 'onTime')).toHaveLength(115);
			expect(result.hits).toEqual(base.hits);
			expect(result.marbles).toEqual(base.marbles);
			expect(result.contacts).toEqual(base.contacts);
		}
	}, 20_000);

	it('jingle-bells: a windmill the bass strikes changes nothing before its first contact', () => {
		const project = loadFixture('jingle-bells');
		const base = simulator.simulate(project);
		const [melody, bass] = base.marbles;
		if (melody == null || bass == null) throw new Error('Missing marbles');
		// Just below the bass's path where the melody is furthest from it, so the melody's world never takes the windmill in
		const farthest = (sample: TMarbleSample): number => {
			const other = melody.samples.find((item) => item.time >= sample.time)?.position;
			return other != null ? Math.hypot(other.x - sample.position.x, other.y - sample.position.y) : 0;
		};
		const at = bass.samples.filter((sample) => sample.time >= 10 && sample.time <= 25 && Math.round(sample.time * 240) % 24 === 0).reduce((best, sample) => (farthest(sample) > farthest(best) ? sample : best)).position;
		const result = simulator.simulate(withFreeWindmill(project, { x: at.x + 0.02, y: at.y - 0.12 }, 0));
		const strike = result.contacts.find((contact) => contact.otherId === 'windmill-far');
		expect(strike?.marbleId).toBe(bass.marbleId);
		const strikeTime = strike?.time ?? 0;
		const before = (samples: TMarbleSample[]): TMarbleSample[] =>
			samples.filter((sample) => sample.time < strikeTime);
		expect(before(result.marbles[1]?.samples ?? [])).toEqual(before(bass.samples));
		expect(before(result.marbles[0]?.samples ?? [])).toEqual(before(melody.samples));
		expect(result.hits.filter((hit) => hit.targetTime < strikeTime)).toEqual(
			base.hits.filter((hit) => hit.targetTime < strikeTime)
		);
	}, 20_000);

	it('jingle-bells, reference-20: their Bowls catch every marble and no Bowl problem shows', () => {
		for (const [name, count] of [['jingle-bells', 115], ['reference-20', 48]] as const) {
			const project = loadFixture(name);
			const result = simulator.simulate(project);
			expect(result.hits.filter((hit) => hit.status === 'onTime')).toHaveLength(count);
			for (const marble of project.marbles) {
				const bowl = bowlOfMarble(project, marble.id);
				expect(bowl, `${name} ${marble.name}`).toBeDefined();
				expect(bowlCatch(result, bowl?.id ?? '').status).toBe('caught');
			}
			expect(checkRun(project, result, NO_BLENDER_OBJECTS).issues.filter((issue) => issue.id.startsWith('bowl:'))).toEqual([]);
		}
	}, 20_000);

	it('tap-along: hits suggested from the recording, every one on time and in frame', () => {
		const project = loadFixture('tap-along');
		const result = simulator.simulate(project);
		expectAllOnTime(result, 16);
		expectDotsInFrame(project, result);
		expect(project.songs).toEqual([expect.objectContaining({ kind: 'audio', path: 'audio/tap-along.wav', start: 1 })]);
		// The recording keeps an even 125 BPM rhythm, which the onsets keep to the detector's 11 ms frames
		const times = project.marbles[0]?.hits.map((hit) => hit.time) ?? [];
		times.slice(1).forEach((time, index) => expect(time - (times[index] ?? 0)).toBeCloseTo(0.48, 1));
	});
});
