import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseProject, type TProject } from '@/modules/project';
import { findLongGaps } from './assists';
import { paceAt } from './pace';
import { frameBand } from './placement';
import { createSimulator, type TSimulator } from './simulate';
import { HIT_DRIFT, type TSimulationResult } from './types';

function loadFixture(name: string): TProject {
	const json = readFileSync(
		new URL(`../../../fixtures/${name}.marble.json`, import.meta.url),
		'utf8'
	);
	const [isProjectOk, projectErr, project] = parseProject(json);
	if (!isProjectOk) throw projectErr;
	return project;
}

function expectAllOnTime(result: TSimulationResult, count: number): void {
	expect(result.hits).toHaveLength(count);
	for (const hit of result.hits) {
		expect(hit.status, hit.hitId).toBe('onTime');
		expect(Math.abs(hit.error ?? Infinity)).toBeLessThanOrEqual(HIT_DRIFT);
	}
	expect(result.pieces.every((piece) => piece.status === 'placed')).toBe(true);
}

function expectDotsInFrame(project: TProject, result: TSimulationResult): void {
	const band = frameBand(project);
	for (const hit of result.hits)
		expect(Math.abs((hit.dot?.x ?? Infinity) - band.centerX), hit.hitId).toBeLessThanOrEqual(
			band.halfWidth
		);
}

let simulator: TSimulator;

beforeAll(async () => {
	// A fresh simulator per file, so fixture results never come from another test's snapshots
	simulator = await createSimulator();
});

describe('fixtures', () => {
	it('zigzag: sixteen mirrored platforms on time and in frame', () => {
		const project = loadFixture('zigzag');
		const result = simulator.simulate(project);
		expectAllOnTime(result, 16);
		expectDotsInFrame(project, result);
		const angles = project.entities
			.map((entity) => entity.components.hitLink?.angle)
			.filter((angle): angle is number => angle != null);
		expect(angles).toHaveLength(16);
		angles.forEach((angle, i) => expect(angle).toBeCloseTo(i % 2 === 0 ? -0.45 : 0.45, 12));
		// The dots alternate sides of the frame centre once the zigzag settles
		const xs = result.hits.slice(6).map((hit) => hit.dot?.x ?? 0);
		xs.forEach((x, i) => expect(Math.sign(x - (xs[i - 1] ?? -x))).toBe(i % 2 === 0 ? -1 : 1));
	});

	it('long-gap: a rail and a tunnel bridge 1.5 s gaps with every hit on time', () => {
		const project = loadFixture('long-gap');
		const result = simulator.simulate(project);
		expectAllOnTime(result, 8);
		expectDotsInFrame(project, result);
		const gaps = findLongGaps(project, 'lane-1');
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
			const piece = result.pieces.find((item) => item.entityId === id);
			expect(piece?.status).toBe('placed');
			expect(piece?.entryTime).toBeGreaterThan(from);
			expect(piece?.path?.length).toBeGreaterThanOrEqual(2);
			// One contact for the whole roll, and the marble stays in frame through the gap. Scenery is
			// environment, so a later touch after the gap is a plain contact.
			expect(result.contacts.filter((contact) => contact.otherEntityId === id && contact.time < to)).toHaveLength(1);
			const contact = result.contacts.find((item) => item.otherEntityId === id);
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
		expect(result.hits.some((hit) => hit.pieceEntityId === windmill?.entityId)).toBe(false);
		const anchor = windmill?.entryTime ?? 0;
		expect(anchor).toBeGreaterThan(0.75);
		expect(anchor).toBeLessThan(1.05);
		const strike = result.contacts.find((contact) => contact.otherEntityId === windmill?.entityId);
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
		const hitCount = project.music.lanes.reduce((count, lane) => count + lane.hits.length, 0);
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
		// No piece of one lane touches the other lane's marble
		for (const contact of result.contacts.filter((item) => item.kind === 'piece')) {
			const lane = contact.marbleEntityId.replace('marble-', '');
			expect(contact.otherEntityId.startsWith(`piece-${lane}-`)).toBe(true);
		}
	});

	it('jingle-bells: melody and bass from the MIDI import, every hit on time without marble contacts', () => {
		const project = loadFixture('jingle-bells');
		const result = simulator.simulate(project);
		const counts = project.music.lanes.map((lane) => lane.hits.length);
		// The refrain's 51 melody notes and 64 bass notes, none left out by the build
		expect(counts).toEqual([51, 64]);
		expectAllOnTime(result, 115);
		expect(project.music.lanes.map((lane) => lane.instrument)).toEqual([9, 8]);
		expect(project.design.theme).toBe('brass');
		// Switchbacks hold the melody across its long notes
		expect(result.pieces.filter((piece) => piece.type === 'switchback').length).toBeGreaterThanOrEqual(10);
		// While both marbles play, they never touch each other or the other lane's pieces
		const until = Math.min(...project.music.lanes.map((lane) => lane.hits.at(-1)?.time ?? 0));
		const played = result.contacts.filter((contact) => contact.time <= until);
		expect(played.filter((contact) => contact.kind === 'marble')).toHaveLength(0);
		const laneOf = (id: string): string | undefined => {
			const entity = project.entities.find((item) => item.id === id);
			return entity?.components.hitLink?.laneId ?? entity?.components.marble?.laneId;
		};
		for (const contact of played.filter((item) => item.kind === 'piece'))
			expect(laneOf(contact.otherEntityId), contact.otherEntityId).toBe(laneOf(contact.marbleEntityId));
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
		// The film camera follows the sampled pace
		expect(result.descent?.length).toBeGreaterThan(60);
		expect(result.descent?.[10]?.y).toBeCloseTo(paceAt(pace, result.descent?.[10]?.time ?? 0), 12);
	});
});
