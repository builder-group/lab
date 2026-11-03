import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseProject, type TProject } from '@/modules/project';
import { findLongGaps } from './assists';
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
		angles.forEach((angle, i) => expect(angle).toBeCloseTo(i % 2 === 0 ? -0.3 : 0.3, 12));
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
			// One contact for the whole roll, and the marble stays in frame through the gap
			expect(result.contacts.filter((contact) => contact.otherEntityId === id)).toHaveLength(1);
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

	it('windmill: the struck windmill turns and records its motion', () => {
		const project = loadFixture('windmill');
		const result = simulator.simulate(project);
		expectAllOnTime(result, 7);
		expectDotsInFrame(project, result);
		const windmill = result.pieces.find((piece) => piece.type === 'windmill');
		const motion = windmill?.motion ?? [];
		expect(motion[0]?.time).toBe(0);
		const struck = result.hits.find((hit) => hit.pieceEntityId === windmill?.entityId);
		const rest = motion.filter((sample) => sample.time <= (struck?.targetTime ?? 0));
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

	it('two-marbles: one intended collision and every hit on time', () => {
		const project = loadFixture('two-marbles');
		const result = simulator.simulate(project);
		expectAllOnTime(result, 6);
		const marbleContacts = result.contacts.filter((contact) => contact.kind === 'marble');
		expect(marbleContacts).toHaveLength(2);
		expect(marbleContacts[0]?.time).toBeCloseTo(0.175, 2);
		// No piece of one lane touches the other lane's marble
		for (const contact of result.contacts.filter((item) => item.kind === 'piece')) {
			const lane = contact.marbleEntityId.replace('marble-', '');
			expect(contact.otherEntityId.startsWith(`piece-${lane}-`)).toBe(true);
		}
	});
});
