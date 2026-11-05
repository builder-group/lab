import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyProjectCommands, createProject, type TProject, type TProjectCommand } from '@/modules/project';
import { createSimulator, type TSimulator } from '../simulate';
import { fitPattern } from './fit-pattern';
import { measurePattern } from './measures';
import { dropForBounce, runGroupChange } from './run-group';

let sim: TSimulator;

beforeAll(async () => {
	sim = await createSimulator();
});
afterAll(() => sim.dispose());

const LANE = 'lane';

function apply(project: TProject, commands: TProjectCommand[]): TProject {
	const [isOk, err, next] = applyProjectCommands(project, commands);
	if (!isOk) throw err;
	return next;
}

function smallProject(times: number[], id = 'small'): TProject {
	const project = createProject({ id, title: 'Small' });
	const lane = project.music.lanes[0]!;
	const marble = project.entities[0]!;
	return apply(project, [
		{ type: 'upsertLane', lane: { ...lane, id: LANE, hits: times.map((time, index) => ({ id: `h${index + 1}`, time })) } },
		{ type: 'removeLane', laneId: lane.id },
		{ type: 'upsertEntity', entity: { ...marble, components: { marble: { ...marble.components.marble!, laneId: LANE }, release: { position: { x: 0, y: 0.6 }, time: times[0]! - 0.35 } } } },
		{ type: 'setEnd', end: times.at(-1)! + 0.6 }
	]);
}

const ids = (from: number, to: number): string[] => Array.from({ length: to - from + 1 }, (_, index) => `h${from + index}`);

describe('fitPattern function', () => {
	it('should play every note of a Zigzag on time in two straight columns', () => {
		const project = smallProject([1, 1.4, 1.8, 2.2, 2.6, 3]);
		const fit = fitPattern({ project, laneId: LANE, hitIds: ids(1, 6), kind: 'zigzag', width: 0.14, drop: 0.08 }, { sim });
		const measures = measurePattern(fit.project, sim.simulate(fit.project), LANE);

		expect(fit.problems).toEqual([]);
		expect(fit.entities).toHaveLength(6);
		expect(measures.onTime).toBe(6);
		expect(measures.columnStraightness).toBeLessThan(0.005);
		expect(measures.dropPerHit).toBeCloseTo(fit.drop ?? 0, 2);
		expect(fit.exit).not.toBeNull();
	});

	it('should step sideways by Width in a Staircase', () => {
		const project = smallProject([1, 1.5, 2, 2.5, 3]);
		const fit = fitPattern({ project, laneId: LANE, hitIds: ids(1, 5), kind: 'staircase', width: 0.09, drop: 0.12 }, { sim });
		const result = sim.simulate(fit.project);
		const dots = result.hits.map((hit) => hit.dot?.x ?? 0);

		expect(result.hits.every((hit) => hit.status === 'onTime' || hit.status === 'drifting')).toBe(true);
		expect(Math.abs(dots[1]! - dots[0]!)).toBeCloseTo(fit.width, 2);
		expect(Math.abs(dots[2]! - dots[1]!)).toBeCloseTo(fit.width, 2);
	});

	it('should say in words why a hop can not fit, instead of falling back silently', () => {
		const project = smallProject([1, 1.14, 1.28, 1.42, 1.56]);
		const fit = fitPattern({ project, laneId: LANE, hitIds: ids(1, 5), kind: 'zigzag', width: 0.3, drop: 0.08, maxTries: 1 }, { sim });

		expect(fit.width).toBeCloseTo(0.3, 5);
		expect(fit.problems.length).toBeGreaterThan(0);
		expect(fit.problems.every((problem) => problem.hitId.length > 0 && /[a-z]/.test(problem.words) && !problem.words.includes('undefined'))).toBe(true);
	});

	it('should fill a long silence with a Long Rail that lets go in time for the next note', () => {
		const project = smallProject([1, 2.2]);
		const placed = fitPattern({ project, laneId: LANE, hitIds: ['h1'], kind: 'zigzag', width: 0.14, drop: 0.08 }, { sim });
		const rail = fitPattern({ project: placed.project, laneId: LANE, hitIds: ['h1', 'h2'], kind: 'longRail' }, { sim });
		const result = sim.simulate(rail.project);
		const free = sim.simulate(placed.project);
		const fall = (run: typeof result): number => (run.hits[0]?.dot?.y ?? 0) - (run.hits[1]?.dot?.y ?? 0);

		expect(rail.problems).toEqual([]);
		expect(rail.entities[0]?.components.piece?.type).toBe('rail');
		expect(fall(result)).toBeLessThan(fall(free) / 2);
	});

	it('should use a Switchback for a silence over the rail limit', () => {
		const project = smallProject([1, 3]);
		const placed = fitPattern({ project, laneId: LANE, hitIds: ['h1'], kind: 'zigzag', width: 0.14, drop: 0.08 }, { sim });
		const rail = fitPattern({ project: placed.project, laneId: LANE, hitIds: ['h1', 'h2'], kind: 'longRail' }, { sim });

		expect(rail.entities[0]?.components.piece?.layout).toBe('switchback');
	});

	it('should use the same bounce on every bar when one is given', () => {
		const project = smallProject([1, 1.4, 1.8]);
		const fit = fitPattern({ project, laneId: LANE, hitIds: ids(1, 3), kind: 'zigzag', width: 0.14, bounce: 0.6, maxTries: 1 }, { sim });
		expect(fit.drop).toBeNull();
		expect(fit.entities[0]?.components.piece?.params['bounce']).toBeCloseTo(0.6, 1);
	});
});

describe('runGroupChange function', () => {
	const change = { laneId: LANE, from: 1, to: 2.2, kind: 'zigzag' as const, width: 0.14, bounce: 0.5 };

	it('should make one Group named after the Pattern and leave the project untouched', () => {
		const project = smallProject([1, 1.4, 1.8, 2.2]);
		const outcome = runGroupChange(project, change, { sim });
		const next = apply(project, outcome.commands);

		expect(project.groups).toBeUndefined();
		expect(next.groups).toHaveLength(1);
		expect(next.groups?.[0]).toMatchObject({ name: 'Zigzag', kind: 'zigzag', from: 1, to: 2.2, width: 0.14 });
		expect(next.groups?.[0]?.pieceIds).toHaveLength(4);
		expect(outcome.measures?.onTime).toBe(4);
	});

	it('should refuse a Long Rail over notes and a Zigzag over silence, in words', () => {
		const project = smallProject([1, 1.4, 3]);
		const overNotes = runGroupChange(project, { ...change, kind: 'longRail' }, { sim });
		const overSilence = runGroupChange(project, { ...change, from: 1.6, to: 2.8 }, { sim });

		expect(overNotes.commands).toEqual([]);
		expect(overNotes.problems[0]?.words).toContain('Long Rail fills silence');
		expect(overSilence.commands).toEqual([]);
		expect(overSilence.problems[0]?.words).toContain('Try Long Rail');
	});

	it('should fit later Groups again when an earlier one changes, as one edit', { timeout: 20_000 }, () => {
		const project = smallProject([1, 1.4, 1.8, 2.2, 2.6, 3]);
		const first = apply(project, runGroupChange(project, { ...change, to: 1.8 }, { sim }).commands);
		const second = apply(first, runGroupChange(first, { ...change, from: 2.2, to: 3 }, { sim }).commands);
		const earlier = second.groups?.find((group) => group.from === 1);
		const moved = runGroupChange(second, { ...change, groupId: earlier?.id, to: 1.8, width: 0.16 }, { sim });
		const next = apply(second, moved.commands);
		const result = sim.simulate(next);

		expect(moved.later.map((item) => item.name)).toEqual(['Zigzag 2']);
		expect(next.groups).toHaveLength(2);
		expect(result.hits.every((hit) => hit.status === 'onTime' || hit.status === 'drifting')).toBe(true);
	});

	it('should leave hand edits on later Groups alone when the marble leaves the same way', { timeout: 20_000 }, () => {
		const project = smallProject([1, 1.4, 1.8, 2.2, 2.6, 3]);
		const first = apply(project, runGroupChange(project, { ...change, to: 1.8 }, { sim }).commands);
		const second = apply(first, runGroupChange(first, { ...change, from: 2.2, to: 3 }, { sim }).commands);
		const earlier = second.groups?.find((group) => group.from === 1);
		const same = runGroupChange(second, { ...change, groupId: earlier?.id, to: 1.8 }, { sim });
		expect(same.later).toEqual([]);
	});

	it('should say when a later Group can not fit any more', { timeout: 20_000 }, () => {
		const project = smallProject([1, 1.4, 1.8, 2.2, 2.6]);
		const first = apply(project, runGroupChange(project, { ...change, to: 1.8 }, { sim }).commands);
		const second = apply(first, [{ type: 'upsertGroup', group: { id: 'late', name: 'Long Rail', laneId: LANE, from: 2.2, to: 2.6, kind: 'longRail', width: 0.14, bounce: 0.5, pieceIds: [] } }]);
		const earlier = second.groups?.find((group) => group.from === 1);
		const outcome = runGroupChange(second, { ...change, groupId: earlier?.id, to: 1.8, width: 0.16 }, { sim });
		const later = outcome.later.find((item) => item.groupId === 'late');

		expect(later?.problems[0]?.words).toContain('fills silence');
	});

	it('should let a preview answer without touching what follows', () => {
		const project = smallProject([1, 1.4, 1.8, 2.2]);
		const outcome = runGroupChange(project, change, { sim, isPreview: true });
		expect(outcome.entities).toHaveLength(4);
		expect(outcome.measures).toBeNull();
	});

	it('should ask for less fall at a livelier Bounce', () => {
		expect(dropForBounce('zigzag', 0.7)).toBeLessThan(dropForBounce('zigzag', 0.5));
		expect(dropForBounce('zigzag', 0.5)).toBeCloseTo(0.08, 5);
	});
});

describe('Group commands', () => {
	const group = { id: 'g', name: 'Zigzag', laneId: LANE, from: 1, to: 2, kind: 'zigzag' as const, width: 0.14, bounce: 0.5, pieceIds: ['a', 'b'] };
	const piece = (id: string) => ({ id, components: { piece: { type: 'platform', params: {} }, hitLink: { laneId: LANE, hitId: 'h1', angle: 0, contactAt: 0.5 } } });

	it('should forget a deleted piece and drop a Group that lost them all', () => {
		const project = apply(smallProject([1, 2]), [{ type: 'upsertEntity', entity: piece('a') }, { type: 'upsertEntity', entity: piece('b') }, { type: 'upsertGroup', group }]);
		const one = apply(project, [{ type: 'removeEntities', entityIds: ['a'] }]);
		const none = apply(one, [{ type: 'removeEntities', entityIds: ['b'] }]);

		expect(one.groups?.[0]?.pieceIds).toEqual(['b']);
		expect(none.groups).toBeUndefined();
	});

	it('should take the Groups of a removed marble with it', () => {
		const project = apply(smallProject([1, 2]), [{ type: 'upsertGroup', group }]);
		expect(apply(project, [{ type: 'removeLane', laneId: LANE }]).groups).toBeUndefined();
	});
});
