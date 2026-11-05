import { describe, expect, it } from 'vitest';
import { type TProject, tieOf } from '@/modules/project';
import { loadFixture } from '@/modules/project/test-helpers';
import { createSimulator, type TSimulator } from './simulate';

const HORIZON = 2;

function tilted(project: TProject, time: number, by: number): TProject {
	const linked = project.track.pieces.flatMap((entity) => {
		const link = tieOf(entity);
		const hit = project.marbles.find((marble) => marble.id === link?.marbleId)?.hits.find((item) => item.id === link?.hitId);
		return entity.type === 'platform' && hit != null ? [{ entity, time: hit.time }] : [];
	});
	const target = linked.filter((item) => item.time >= time).sort((a, b) => a.time - b.time)[0];
	if (target == null) throw new Error('No platform at that time');
	const entities = project.track.pieces.map((entity) => (entity === target.entity ? { ...entity, angle: entity.angle + by } : entity));
	return { ...project, track: { ...project.track, pieces: entities } };
}

async function warmed(project: TProject): Promise<TSimulator> {
	const simulator = await createSimulator();
	simulator.simulate(project);
	return simulator;
}

describe('a preview that stops at a horizon', () => {
	it('is exact up to the horizon and shows the whole run past it', async () => {
		const project = loadFixture('zigzag');
		const whole = (await warmed(project)).simulate(project);
		const edited = tilted(project, 1, 0.1);
		const simulator = await warmed(project);
		const near = simulator.simulate(edited, HORIZON);
		const exact = (await createSimulator()).simulate(edited);
		const until = near.stats.reusedUntil + HORIZON;

		expect(near.stats.steps).toBeLessThan(exact.stats.steps / 2);
		expect(near.duration).toBe(whole.duration);
		const brokenNear = exact.hits.filter((hit) => hit.targetTime <= until - 0.02 && hit.status !== 'onTime');
		expect(brokenNear.length).toBeGreaterThan(0);
		for (const [index, hit] of near.hits.entries()) {
			if (hit.targetTime <= until - 0.02) expect(hit).toEqual(exact.hits[index]);
			else expect(hit).toEqual(whole.hits[index]);
		}
		for (const [index, piece] of near.pieces.entries()) {
			if ((piece.hitTime ?? 0) > until) expect(piece).toEqual(whole.pieces[index]);
		}
		// Each track runs on past the stop without a gap in its clock
		for (const track of near.marbles) {
			const times = track.samples.map((sample) => sample.time);
			expect(times.at(-1)).toBeCloseTo(whole.marbles[0]?.samples.at(-1)?.time ?? 0, 6);
			expect(times.every((time, index) => index === 0 || Math.abs(time - (times[index - 1] ?? 0) - 1 / 240) < 1e-6)).toBe(true);
		}
	});

	it('leaves the whole run after it as a run from scratch finds it', async () => {
		const project = loadFixture('zigzag');
		const simulator = await warmed(project);
		for (const by of [0.001, 0.002, 0.003]) simulator.simulate(tilted(project, 1, by), HORIZON);
		const edited = tilted(project, 1, 0.003);
		const after = simulator.simulate(edited);
		const fresh = (await createSimulator()).simulate(edited);
		expect(after.hits).toEqual(fresh.hits);
		expect(after.marbles).toEqual(fresh.marbles);
		expect(after.contacts).toEqual(fresh.contacts);
	});

	it('runs whole without a whole run of this project to show past the stop', async () => {
		const project = loadFixture('zigzag');
		const simulator = await createSimulator();
		const run = simulator.simulate(project, HORIZON);
		expect(run.duration).toBeCloseTo(project.length, 2);
		expect(run.hits.filter((hit) => hit.status === 'onTime')).toHaveLength(project.marbles.reduce((count, marble) => count + marble.hits.length, 0));
	});
});
