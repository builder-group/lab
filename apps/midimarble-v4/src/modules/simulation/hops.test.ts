import { beforeAll, describe, expect, it } from 'vitest';
import type { TProject } from '@/modules/project';
import { loadFixture } from '@/modules/project/test-helpers';
import { createSimulator, handOversOf, type TSimulator } from './simulate';
import type { TSimulationResult } from './types';

let chain: TSimulator;
let oneWorld: TSimulator;

beforeAll(async () => {
	chain = await createSimulator();
	oneWorld = await createSimulator({ isOneRun: true });
});

function expectSameRun(a: TSimulationResult, b: TSimulationResult, name: string): void {
	expect(a.marbles.map((track) => track.samples.length), name).toEqual(b.marbles.map((track) => track.samples.length));
	for (const [index, track] of a.marbles.entries()) {
		const other = b.marbles[index];
		for (const [i, sample] of track.samples.entries()) expect(sample, `${name} ${track.marbleId} sample ${i}`).toEqual(other?.samples[i]);
	}
	expect(a.hits, name).toEqual(b.hits);
	expect(a.contacts, name).toEqual(b.contacts);
}

function withHandOvers(simulator: TSimulator, project: TProject): TProject {
	const walk = simulator.walk(project);
	return { ...project, marbles: project.marbles.map((marble, index) => ({ ...marble, handOvers: handOversOf(walk, index) })) };
}

describe('hops', () => {
	it.each(['zigzag', 'long-gap', 'windmill', 'two-marbles', 'staircase'])('should run %s the same to the bit as one long world', (name) => {
		const project = loadFixture(name);

		expectSameRun(chain.simulate(project), oneWorld.simulate(project), name);
	});

	it.each(['zigzag', 'windmill', 'two-marbles'])('should run %s from its stored hand-overs as it ran without them', (name) => {
		const project = loadFixture(name);
		const fresh = chain.simulate(project);

		expectSameRun(chain.simulate(withHandOvers(chain, project)), fresh, name);
	});

	it('should run nothing again when nothing changed', () => {
		const project = loadFixture('zigzag');
		chain.simulate(project);

		expect(chain.simulate(project).stats.steps).toBe(0);
	});

	it('should keep a shifted hop and move it whole', () => {
		const project = withHandOvers(chain, loadFixture('zigzag'));
		const run = chain.simulate(project);
		const marble = project.marbles[0];
		const from = marble?.handOvers?.[8];
		if (marble == null || from == null) throw new Error('No hand-over');
		const shifted = { ...project, marbles: [{ ...marble, handOvers: (marble.handOvers ?? []).map((handOver) => (handOver.step >= from.step ? { ...handOver, origin: { x: 0.004, y: -0.002 } } : handOver)) }] };

		const moved = chain.simulate(shifted);

		// A hop before it lands within a seam, so the hand-over stands. Only the hop that starts there sees what stands near it move
		expect(moved.stats.steps).toBeLessThan(200);
		const samples = run.marbles[0]?.samples ?? [];
		const after = moved.marbles[0]?.samples ?? [];
		for (const [i, sample] of samples.entries()) {
			if (sample.time * 240 < from.step + 1) expect(after[i]).toEqual(sample);
			else {
				expect(after[i]?.position.x).toBe(sample.position.x + 0.004);
				expect(after[i]?.position.y).toBe(sample.position.y - 0.002);
			}
		}
		expect(moved.hits.every((hit) => hit.status === 'onTime')).toBe(true);
	});

	it('should run only the hops near a piece added in their way', () => {
		const project = loadFixture('zigzag');
		chain.simulate(project);
		const far: TProject = { ...project, track: { ...project.track, pieces: [...project.track.pieces, { id: 'far', type: 'platform', params: {}, angle: 0, place: { kind: 'free', position: { x: 30, y: 30 } } }] } };

		const run = chain.simulate(far);

		expect(run.stats.steps).toBe(0);
		expectSameRun(run, chain.simulate(project), 'zigzag');
	});

	it('should take a windmill where the hand-over has it', () => {
		const project = withHandOvers(chain, loadFixture('windmill'));
		const handOvers = project.marbles[0]?.handOvers ?? [];

		expect(handOvers.some((handOver) => (handOver.rotors ?? []).some((rotor) => rotor.spin !== 0))).toBe(true);
	});
});
