import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyProjectCommands, createProject, isPatternGroup, type TEntity, type TProject, type TProjectCommand } from '@/modules/project';
import { createSimulator, type TSimulator, extraStrikes, rollingHits, touchingPairs } from '@/modules/simulation';
import type { TSimulationResult } from '@/modules/simulation';
import { measurePattern } from './measures';
import { runGroupChange } from './run-group';

const MINUTES = 60_000;
let sim: TSimulator;

beforeAll(async () => {
	sim = await createSimulator();
});
afterAll(() => sim.dispose());

const MARBLE = 'lane';

interface TReferenceHits {
	gravity: number;
	release: NonNullable<TEntity['components']['release']>;
	startRail: TEntity['components'];
	hits: number[];
}

function apply(project: TProject, commands: TProjectCommand[]): TProject {
	const [isOk, err, next] = applyProjectCommands(project, commands);
	if (!isOk) throw err;
	return next;
}

/** The reference's 58 hit times on a bare project, with its release and start rail */
function referenceProject(): TProject {
	const reference = JSON.parse(readFileSync(new URL('../../../../fixtures/reference-hits.json', import.meta.url), 'utf8')) as TReferenceHits;
	const project = createProject({ id: 'chain', title: 'Chain' });
	const marble = project.music.marbles[0];
	const marbleEntity = project.entities[0];
	if (marble == null || marbleEntity?.components.marble == null) throw new Error('No marble');
	return apply({ ...project, gravity: reference.gravity }, [
		{ type: 'upsertLane', marble: { ...marble, id: MARBLE, hits: reference.hits.map((time, index) => ({ id: `h${index}`, time })) } },
		{ type: 'removeLane', marbleId: marble.id },
		{ type: 'upsertEntity', entity: { ...marbleEntity, components: { marble: { ...marbleEntity.components.marble, marbleId: MARBLE }, release: reference.release } } },
		{ type: 'upsertEntity', entity: { id: 'start-rail', name: 'Rail 1', components: reference.startRail } },
		{ type: 'updateProject', patch: { length: (reference.hits.at(-1) ?? 0) + 0.6 } }
	]);
}

const CHAIN: [number, number, 'zigzag' | 'staircase' | 'longRail', number][] = [
	[0, 24, 'zigzag', 0.14],
	[24, 25, 'longRail', 0.14],
	[25, 29, 'staircase', 0.09],
	[30, 32, 'zigzag', 0.14],
	[32, 33, 'longRail', 0.14],
	[33, 42, 'zigzag', 0.14],
	[42, 43, 'longRail', 0.14],
	[43, 57, 'zigzag', 0.14]
];

function buildChain(start: TProject): TProject {
	const times = start.music.marbles[0]?.hits.map((hit) => hit.time) ?? [];
	let project = start;
	for (const [first, last, kind, width] of CHAIN) {
		const gap = kind === 'longRail' ? 0.02 : 0;
		const outcome = runGroupChange(project, { marbleId: MARBLE, from: (times[first] ?? 0) + gap, to: (times[last] ?? 0) - gap, kind, width, bounce: 0.5 }, { sim });
		project = apply(project, outcome.commands);
	}
	return project;
}

function gapFalls(result: TSimulationResult): number[] {
	return [24, 32, 42].map((index) => (result.hits[index]?.dot?.y ?? 0) - (result.hits[index + 1]?.dot?.y ?? 0));
}

describe('Patterns chained on the reference hits', () => {
	it('should play all 58 on time with rails in the gaps, and say what a Width cannot do, also when an earlier Width changes', { timeout: 5 * MINUTES }, () => {
		const startedAt = performance.now();
		const chain = buildChain(referenceProject());
		const chainMs = performance.now() - startedAt;
		const result = sim.simulate(chain);
		const measures = measurePattern(chain, result, MARBLE);
		const falls = gapFalls(result);
		console.log('chain', JSON.stringify({ ...measures, falls, ms: Math.round(chainMs), touching: touchingPairs(chain, result).length, problems: chain.groups?.filter(isPatternGroup).flatMap((group) => group.problems ?? []).map((problem) => problem.words) }));

		expect(measures.onTime).toBe(58);
		// Width stays what's asked, so what it can't do is said, not fixed by another Width
		expect(chain.groups?.filter(isPatternGroup).every((group) => group.width === 0.14 || group.width === 0.09)).toBe(true);
		const said = chain.groups?.filter(isPatternGroup).flatMap((group) => group.problems ?? []).map((problem) => problem.words).join(' ') ?? '';
		if (extraStrikes(chain, result).length > 0) expect(said).toMatch(/twice|a second time|another bar/);
		if (rollingHits(chain, result).length > 0) expect(said).toContain('rolls');
		for (const fall of falls) expect(fall).toBeLessThan(0.4);

		const first = chain.groups?.filter(isPatternGroup).find((group) => group.from < 2);
		const changedAt = performance.now();
		const changed = runGroupChange(chain, { marbleId: MARBLE, groupId: first?.id, from: first?.from ?? 0, to: first?.to ?? 0, kind: 'zigzag', width: 0.15, bounce: 0.5 }, { sim });
		const after = apply(chain, changed.commands);
		const rerun = sim.simulate(after);
		const again = measurePattern(after, rerun, MARBLE);
		console.log('rerun', JSON.stringify({ onTime: again.onTime, later: changed.later.length, ms: Math.round(performance.now() - changedAt), falls: gapFalls(rerun) }));

		expect(changed.later).toHaveLength(7);
		// Later Groups keep their Width too: what no longer fits is said, not hidden
		if (again.onTime < 58) expect(changed.later.some((item) => item.problems.length > 0)).toBe(true);
	});

	it('should answer a hover preview on real rhythm quickly', { timeout: MINUTES }, () => {
		const project = referenceProject();
		const hits = project.music.marbles[0]?.hits ?? [];
		const start = runGroupChange(project, { marbleId: MARBLE, from: hits[0]?.time ?? 0, to: hits[24]?.time ?? 0, kind: 'zigzag', width: 0.14, bounce: 0.5 }, { sim });
		const base = apply(project, start.commands);
		const times: number[] = [];
		for (let first = 0; first + 8 < 25; first += 2) {
			const from = hits[first]?.time ?? 0;
			const to = hits[first + 8]?.time ?? 0;
			const startedAt = performance.now();
			runGroupChange(base, { marbleId: MARBLE, from, to, kind: 'zigzag', width: 0.14, bounce: 0.5 }, { sim, isPreview: true });
			times.push(performance.now() - startedAt);
		}
		const sorted = [...times].sort((a, b) => a - b);
		const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
		console.log('hover', JSON.stringify({ median: Math.round(median), max: Math.round(sorted.at(-1) ?? 0), n: sorted.length }));
		expect(median).toBeLessThan(1000);
	});
});
