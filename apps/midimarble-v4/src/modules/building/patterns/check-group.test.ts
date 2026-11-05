import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyProjectCommands, createProject, type TEntity, type TProject, type TProjectCommand } from '@/modules/project';
import { createSimulator, type TSimulator } from '@/modules/simulation';
import { checkGroupChange } from './check-group';
import { runGroupChange, type TGroupRunOutcome } from './run-group';

const LANE = 'lane';
let sim: TSimulator;

beforeAll(async () => {
	sim = await createSimulator();
});
afterAll(() => sim.dispose());

function apply(project: TProject, commands: TProjectCommand[]): TProject {
	const [isOk, err, next] = applyProjectCommands(project, commands);
	if (!isOk) throw err;
	return next;
}

function smallProject(times: number[]): TProject {
	const project = createProject({ id: 'check', title: 'Check' });
	const lane = project.music.lanes[0];
	const marble = project.entities[0];
	if (lane == null || marble?.components.marble == null) throw new Error('No marble');
	return apply(project, [
		{ type: 'upsertLane', lane: { ...lane, id: LANE, hits: times.map((time, index) => ({ id: `h${index}`, time })) } },
		{ type: 'removeLane', marbleId: lane.id },
		{ type: 'upsertEntity', entity: { ...marble, components: { ...marble.components, marble: { ...marble.components.marble, marbleId: LANE } } } },
		{ type: 'setEnd', end: (times.at(-1) ?? 0) + 0.6 }
	]);
}

const change = { marbleId: LANE, from: 1, to: 2.2, kind: 'zigzag' as const, width: 0.1, bounce: 0.5 };

function outcomeOf(project: TProject, over: Partial<TGroupRunOutcome> = {}): TGroupRunOutcome {
	return { ...runGroupChange(project, change, { sim }), ...over };
}

describe('checkGroupChange function', () => {
	it('should refuse a Pattern a hit can\'t fit, naming the hit and why', () => {
		const project = smallProject([1, 1.4, 1.8, 2.2]);

		const check = checkGroupChange(project, outcomeOf(project, { blocking: [{ hitId: 'h2', words: 'The marble lands on this bar a second time.' }] }), LANE, sim);

		expect(check.commands).toEqual([]);
		expect(check.refusal).toEqual({ marbleId: LANE, hitId: 'h2', words: expect.stringContaining('Hit 3 of') as string });
		expect(check.refusal?.words).toContain('The marble lands on this bar a second time. Nothing changed.');
	});

	it('should land a Pattern that keeps the song as good as it was', () => {
		const project = smallProject([1, 1.4, 1.8, 2.2]);
		const outcome = outcomeOf(project);
		expect(outcome.blocking).toEqual([]);

		const check = checkGroupChange(project, outcome, LANE, sim);

		expect(check.refusal).toBeNull();
		expect(check.commands.length).toBeGreaterThanOrEqual(outcome.commands.length);
		expect(sim.simulate(apply(project, check.commands)).hits.every((hit) => hit.status === 'onTime' || hit.status === 'drifting')).toBe(true);
	});

	it('should refuse when the run after it would leave the song worse, whatever the fit said', () => {
		const project = smallProject([1, 1.4, 1.8, 2.2]);
		const outcome = outcomeOf(project);
		// A piece dropped on the marble's way: the edit would land a problem the song didn't have
		const bar = outcome.project.entities.find((entity) => entity.components.piece?.type === 'platform') as TEntity;
		const stray: TEntity = { ...bar, id: 'stray', name: 'Stray', components: { ...bar.components, hitLink: { ...bar.components.hitLink!, hitId: 'h1' } } };
		const worse = { ...outcome, project: { ...outcome.project, entities: [...outcome.project.entities, stray] } };

		const check = checkGroupChange(project, worse, LANE, sim);

		expect(check.commands).toEqual([]);
		expect(check.refusal?.words).toMatch(/Zigzag would break what follows: .+\. Nothing changed\./);
	});
});
