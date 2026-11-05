import { beforeAll, describe, expect, it } from 'vitest';
import { preflightExport } from '@/modules/design/export-preflight';
import { BOWL_TAIL, projectSongEnd } from '@/modules/music';
import { type TProject } from '@/modules/project';
import { bowlCatch, bowlOfLane } from '@/modules/simulation/bowl';
import { createSimulator, type TSimulator } from '@/modules/simulation/simulate';
import { findBowl, bowlFix, lanesWithoutBowl } from './bowl-assist';
import { asLaneBowl } from './step-loop';
import { loadFixture } from '@/modules/project/test-helpers';

function withoutBowls(project: TProject): TProject {
	return { ...project, revision: project.revision + 1, entities: project.entities.filter((entity) => entity.components.piece?.type !== 'bowl') };
}

let simulator: TSimulator;
const deps = { simulate: (project: TProject) => simulator.simulate(project) };

beforeAll(async () => {
	simulator = await createSimulator();
});

describe('Add Bowl', () => {
	it('offers a Bowl for each marble that plays last and has none', () => {
		const duet = withoutBowls(loadFixture('two-marbles'));
		// Their last notes lie closer together than the Bowl's tail, so both play last
		expect(lanesWithoutBowl(duet)).toEqual(['lane-1', 'lane-2']);
		// With Marble 2's last note later than that, only it does
		expect(lanesWithoutBowl({ ...duet, music: { ...duet.music, lanes: duet.music.lanes.map((lane) => (lane.id === 'lane-2' ? { ...lane, hits: [...lane.hits, { id: 'late', time: 5 }] } : lane)) } })).toEqual(['lane-2']);
		expect(lanesWithoutBowl(loadFixture('two-marbles'))).toEqual([]);
	});

	it('places a Bowl on the fall after the last note that catches the marble and breaks no hit', async () => {
		const zigzag = withoutBowls(loadFixture('zigzag'));
		const placed = await findBowl(zigzag, 'lane-1', deps);
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
		expect(projectSongEnd(next)).toBeCloseTo(6.2 + BOWL_TAIL, 6);
		const run = simulator.simulate({ ...next, end: projectSongEnd(next) ?? next.end });
		expect(run.hits.filter((hit) => hit.status === 'onTime')).toHaveLength(16);
		expect(bowlCatch(run, placed.entity.id).status).toBe('caught');
	}, 20_000);

	it('keeps every hit with their Bowls, which catch both marbles', () => {
		const project = loadFixture('two-marbles');
		const result = simulator.simulate(project);
		expect(result.hits.filter((hit) => hit.status === 'onTime')).toHaveLength(6);
		for (const lane of project.music.lanes) {
			const bowl = bowlOfLane(project, lane.id);
			expect(bowl, lane.name).toBeDefined();
			expect(bowlCatch(result, bowl?.id ?? '').status).toBe('caught');
		}
		expect(preflightExport(project, result).issues.filter((issue) => issue.id.startsWith('bowl:'))).toEqual([]);
	});

	it('reports a Bowl that misses its marble and places it again', async () => {
		const zigzag = withoutBowls(loadFixture('zigzag'));
		const found = await findBowl(zigzag, 'lane-1', deps);
		if ('error' in found) throw new Error(found.error);
		const bowl = found.entity;
		if (bowl.components.hitLink == null) throw new Error('No Bowl');
		// Pushed off to the side, the marble falls past it
		const missing: TProject = {
			...zigzag,
			end: projectSongEnd({ ...zigzag, entities: [...zigzag.entities, bowl] }) ?? zigzag.end,
			revision: zigzag.revision + 1,
			entities: [...zigzag.entities, { ...bowl, components: { ...bowl.components, hitLink: { ...bowl.components.hitLink, offset: { x: 0.25, y: 0 } } } }]
		};
		const result = simulator.simulate(missing);
		const issue = preflightExport(missing, result).issues.find((item) => item.id === `bowl:${bowl.id}`);
		expect(issue?.title).toBe('Marble 1 misses the Bowl');
		expect(issue?.severity).toBe('warning');
		const fix = await bowlFix(missing, result, bowl.id, deps);
		const placed = fix.commands?.[0];
		if (placed?.type !== 'upsertEntity') throw new Error(fix.message);
		expect(placed.entity.id).toBe(bowl.id);
		expect(placed.entity.components.hitLink?.offset).toBeUndefined();
		const fixed = { ...missing, entities: missing.entities.map((entity) => (entity.id === bowl.id ? placed.entity : entity)) };
		expect(bowlCatch(simulator.simulate(fixed), bowl.id).status).toBe('caught');
	});

	it('keeps one Bowl per marble: a new one for a marble moves its own', () => {
		const duet = loadFixture('two-marbles');
		const own = bowlOfLane(duet, 'lane-1');
		const dropped = asLaneBowl(
			duet,
			{ id: 'piece-new', name: 'Bowl 3', components: { piece: { type: 'bowl', params: { entryDelay: 0.5 } }, hitLink: { laneId: 'lane-1', hitId: 'hit-1-2', angle: 0, contactAt: 0.5 } } },
			{ x: -0.4, y: -1 }
		);
		expect(dropped.id).toBe(own?.id);
		expect(dropped.name).toBe(own?.name);
		expect(dropped.components.piece?.params['mirror']).toBe(1);
		expect(dropped.components.hitLink?.anchored).toBe(true);
	});
});
