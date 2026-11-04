import { beforeAll, describe, expect, it } from 'vitest';
import { preflightExport } from '@/modules/design/export-preflight';
import { FINISH_TAIL, projectSongEnd } from '@/modules/music';
import { type TProject } from '@/modules/project';
import { finishCatch, finishOfLane } from '@/modules/simulation/finish';
import { createSimulator, type TSimulator } from '@/modules/simulation/simulate';
import { addFinishLabel, findFinish, finishFix, lanesWithoutFinish } from './finish-assist';
import { asLaneFinish } from './step-loop';
import { loadFixture } from '@/modules/project/test-helpers';

function withoutFinishes(project: TProject): TProject {
	return { ...project, revision: project.revision + 1, entities: project.entities.filter((entity) => entity.components.piece?.type !== 'finish') };
}

let simulator: TSimulator;
const deps = { simulate: (project: TProject) => simulator.simulate(project) };

beforeAll(async () => {
	simulator = await createSimulator();
});

describe('Add Finish', () => {
	it('offers a Finish for each marble that plays last and has none', () => {
		const duet = withoutFinishes(loadFixture('two-marbles'));
		// Their last notes lie closer together than the Finish's tail, so both play last
		expect(lanesWithoutFinish(duet)).toEqual(['lane-1', 'lane-2']);
		// With Marble 2's last note later than that, only it does
		expect(lanesWithoutFinish({ ...duet, music: { ...duet.music, lanes: duet.music.lanes.map((lane) => (lane.id === 'lane-2' ? { ...lane, hits: [...lane.hits, { id: 'late', time: 5 }] } : lane)) } })).toEqual(['lane-2']);
		expect(addFinishLabel(duet, 'lane-2', 2)).toBe('Add Finish for Marble 2');
		expect(addFinishLabel(duet, 'lane-1', 1)).toBe('Add Finish');
		expect(lanesWithoutFinish(loadFixture('two-marbles'))).toEqual([]);
	});

	it('places a Finish on the fall after the last note that catches the marble and breaks no hit', async () => {
		const zigzag = withoutFinishes(loadFixture('zigzag'));
		const placed = await findFinish(zigzag, 'lane-1', deps);
		if ('error' in placed) throw new Error(placed.error);
		expect(placed.catch.status).toBe('caught');
		const link = placed.entity.components.hitLink;
		expect(link?.anchored).toBe(true);
		expect(link?.hitId).toBe('hit-1-16');
		const delay = placed.entity.components.piece?.params['entryDelay'] ?? 0;
		expect(delay).toBeGreaterThan(0.1);
		expect(delay).toBeLessThan(1.2);
		// The film that follows the song runs on until the catch shows
		const next = { ...zigzag, entities: [...zigzag.entities, placed.entity] };
		expect(projectSongEnd(next)).toBeCloseTo(6.2 + FINISH_TAIL, 6);
		const run = simulator.simulate({ ...next, end: projectSongEnd(next) ?? next.end });
		expect(run.hits.filter((hit) => hit.status === 'onTime')).toHaveLength(16);
		expect(finishCatch(run, placed.entity.id).status).toBe('caught');
	}, 20_000);

	it('keeps every hit with their Finishes, which catch both marbles', () => {
		const project = loadFixture('two-marbles');
		const result = simulator.simulate(project);
		expect(result.hits.filter((hit) => hit.status === 'onTime')).toHaveLength(6);
		for (const lane of project.music.lanes) {
			const finish = finishOfLane(project, lane.id);
			expect(finish, lane.name).toBeDefined();
			expect(finishCatch(result, finish?.id ?? '').status).toBe('caught');
		}
		expect(preflightExport(project, result).issues.filter((issue) => issue.id.startsWith('finish:'))).toEqual([]);
	});

	it('reports a Finish that misses its marble and places it again', async () => {
		const zigzag = withoutFinishes(loadFixture('zigzag'));
		const found = await findFinish(zigzag, 'lane-1', deps);
		if ('error' in found) throw new Error(found.error);
		const finish = found.entity;
		if (finish.components.hitLink == null) throw new Error('No Finish');
		// Pushed off to the side, the marble falls past it
		const missing: TProject = {
			...zigzag,
			end: projectSongEnd({ ...zigzag, entities: [...zigzag.entities, finish] }) ?? zigzag.end,
			revision: zigzag.revision + 1,
			entities: [...zigzag.entities, { ...finish, components: { ...finish.components, hitLink: { ...finish.components.hitLink, offset: { x: 0.25, y: 0 } } } }]
		};
		const result = simulator.simulate(missing);
		const issue = preflightExport(missing, result).issues.find((item) => item.id === `finish:${finish.id}`);
		expect(issue?.title).toBe('Marble 1 misses the Finish');
		expect(issue?.severity).toBe('warning');
		const fix = await finishFix(missing, result, finish.id, deps);
		expect(fix.label).toBe('Place Finish Again');
		const placed = fix.commands?.[0];
		if (placed?.type !== 'upsertEntity') throw new Error(fix.message);
		expect(placed.entity.id).toBe(finish.id);
		expect(placed.entity.components.hitLink?.offset).toBeUndefined();
		const fixed = { ...missing, entities: missing.entities.map((entity) => (entity.id === finish.id ? placed.entity : entity)) };
		expect(finishCatch(simulator.simulate(fixed), finish.id).status).toBe('caught');
	});

	it('keeps one Finish per marble: a new one for a marble moves its own', () => {
		const duet = loadFixture('two-marbles');
		const own = finishOfLane(duet, 'lane-1');
		const dropped = asLaneFinish(
			duet,
			{ id: 'piece-new', name: 'Finish 3', components: { piece: { type: 'finish', params: { entryDelay: 0.5 } }, hitLink: { laneId: 'lane-1', hitId: 'hit-1-2', angle: 0, contactAt: 0.5 } } },
			{ x: -0.4, y: -1 }
		);
		expect(dropped.id).toBe(own?.id);
		expect(dropped.name).toBe(own?.name);
		expect(dropped.components.piece?.params['mirror']).toBe(1);
		expect(dropped.components.hitLink?.anchored).toBe(true);
	});
});
