import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { preflightExport } from '@/modules/design/export-preflight';
import { FINISH_TAIL, projectSongEnd } from '@/modules/music';
import { parseProject, type TProject } from '@/modules/project';
import { finishCatch, finishOfLane } from '@/modules/simulation/finish';
import { createSimulator, type TSimulator } from '@/modules/simulation/simulate';
import { addFinishLabel, findFinish, finishFix, lanesWithoutFinish } from './finish-assist';
import { asLaneFinish } from './step-loop';

function loadFixture(name: string): TProject {
	const [isOk, error, project] = parseProject(readFileSync(new URL(`../../../fixtures/${name}.marble.json`, import.meta.url), 'utf8'));
	if (!isOk) throw error;
	return project;
}

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
		const jingle = withoutFinishes(loadFixture('jingle-bells'));
		// Melody's last note comes 1.5 s before the bass's, more than the Finish's tail, so only Bass plays last
		expect(lanesWithoutFinish(jingle)).toEqual(['lane-2']);
		expect(lanesWithoutFinish({ ...jingle, music: { ...jingle.music, lanes: jingle.music.lanes.map((lane) => (lane.id === 'lane-1' ? { ...lane, hits: [...lane.hits, { id: 'late', time: 32 }] } : lane)) } })).toEqual(['lane-1', 'lane-2']);
		expect(addFinishLabel(jingle, 'lane-2', 2)).toBe('Add Finish for Bass');
		expect(addFinishLabel(jingle, 'lane-1', 1)).toBe('Add Finish');
		expect(lanesWithoutFinish(loadFixture('jingle-bells'))).toEqual([]);
	});

	it('places a Finish on the fall after the last note that catches the marble and breaks no hit', async () => {
		const reference = withoutFinishes(loadFixture('reference-20'));
		const placed = await findFinish(reference, 'lane-1', deps);
		if ('error' in placed) throw new Error(placed.error);
		expect(placed.catch.status).toBe('caught');
		const link = placed.entity.components.hitLink;
		expect(link?.anchored).toBe(true);
		expect(link?.hitId).toBe('hit-1-48');
		const delay = placed.entity.components.piece?.params['entryDelay'] ?? 0;
		expect(delay).toBeGreaterThan(0.1);
		expect(delay).toBeLessThan(1.2);
		// The film that follows the song runs on until the catch shows
		const next = { ...reference, entities: [...reference.entities, placed.entity] };
		expect(projectSongEnd(next)).toBeCloseTo(19.25 + FINISH_TAIL, 6);
		const run = simulator.simulate({ ...next, end: projectSongEnd(next) ?? next.end });
		expect(run.hits.filter((hit) => hit.status === 'onTime')).toHaveLength(48);
		expect(finishCatch(run, placed.entity.id).status).toBe('caught');
	}, 20_000);

	it('keeps every hit of the fixtures with their Finishes, which catch both marbles of Jingle Bells', () => {
		for (const [name, count] of [['jingle-bells', 115], ['reference-20', 48]] as const) {
			const project = loadFixture(name);
			const result = simulator.simulate(project);
			expect(result.hits.filter((hit) => hit.status === 'onTime')).toHaveLength(count);
			for (const lane of project.music.lanes) {
				const finish = finishOfLane(project, lane.id);
				expect(finish, `${name} ${lane.name}`).toBeDefined();
				expect(finishCatch(result, finish?.id ?? '').status).toBe('caught');
			}
			expect(preflightExport(project, result).issues.filter((issue) => issue.id.startsWith('finish:'))).toEqual([]);
		}
	}, 20_000);

	it('reports a Finish that misses its marble and places it again', async () => {
		const reference = loadFixture('reference-20');
		const finish = finishOfLane(reference, 'lane-1');
		if (finish?.components.piece == null) throw new Error('No Finish');
		// Pushed off to the side, the marble falls past it
		const missing: TProject = {
			...reference,
			revision: reference.revision + 1,
			entities: reference.entities.map((entity) =>
				entity.id === finish.id && entity.components.hitLink != null ? { ...entity, components: { ...entity.components, hitLink: { ...entity.components.hitLink, offset: { x: 0.25, y: 0 } } } } : entity
			)
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
		const reference = loadFixture('reference-20');
		const own = finishOfLane(reference, 'lane-1');
		const dropped = asLaneFinish(
			reference,
			{ id: 'piece-new', name: 'Finish 2', components: { piece: { type: 'finish', params: { entryDelay: 0.5 } }, hitLink: { laneId: 'lane-1', hitId: 'hit-1-47', angle: 0, contactAt: 0.5 } } },
			{ x: -0.4, y: -1 }
		);
		expect(dropped.id).toBe(own?.id);
		expect(dropped.name).toBe(own?.name);
		expect(dropped.components.piece?.params['mirror']).toBe(1);
		expect(dropped.components.hitLink?.anchored).toBe(true);
	});
});
