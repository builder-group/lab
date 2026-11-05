import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyProjectCommands, createProject, type TProject, type TProjectCommand } from '@/modules/project';
import { createSimulator, type TSimulator } from '@/modules/simulation';
import { checkPattern } from './check-pattern';
import { arrivalAt, fitPattern } from './fit-pattern';
import { isPatternKind, PATTERN_KINDS, PATTERNS, patternKinds } from './registry';

// Real fits of a few hits, which an otherwise busy machine runs several times slower
vi.setConfig({ testTimeout: 30_000 });

const MARBLE = 'marble';
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
	const project = createProject({ id: 'contract', title: 'Contract' });
	const marble = project.marbles[0];
	if (marble == null) throw new Error('No marble');
	return apply(project, [
		{ type: 'addMarble', marble: { ...marble, id: MARBLE, start: { position: { x: 0, y: 0.6 }, time: (times[0] ?? 0) - 0.35 }, hits: times.map((time, index) => ({ id: `h${index + 1}`, time })) } },
		{ type: 'removeMarble', marbleId: marble.id },
		{ type: 'updateProject', patch: { length: (times.at(-1) ?? 0) + 0.6 } }
	]);
}

function deepFrozen<T>(value: T): T {
	if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const item of Object.values(value)) deepFrozen(item);
	}
	return value;
}

describe('A Pattern', () => {
	it('should be a pure calculation: arrival, hits and settings in; pieces, exit and a verdict per hit out', () => {
		const project = deepFrozen(smallProject([1, 1.4, 1.8, 2.2]));
		const hits = project.marbles[0]?.hits.slice(0, 3) ?? [];
		const arrival = arrivalAt(sim, project, MARBLE, 'h1', 1);

		const fit = PATTERNS.zigzag.fit({ arrival, hits, settings: { width: 0.1, bounce: 0.5 } }, { project, marbleId: MARBLE, sim });

		expect(fit.pieces).toHaveLength(3);
		expect(fit.exit).not.toBeNull();
		expect(fit.verdicts.map((verdict) => [verdict.hitId, verdict.fits])).toEqual([['h1', true], ['h2', true], ['h3', true]]);
		expect(project.track.pieces).toEqual([]);
	});

	it('should answer a check the same way twice and leave the project as it was', () => {
		const project = deepFrozen(smallProject([1, 1.4, 1.8, 2.2]));
		const before = JSON.stringify(project);
		const change = { marbleId: MARBLE, from: 1, to: 1.8, kind: 'zigzag', width: 0.1, bounce: 0.5 };

		const first = checkPattern(project, change, { sim });
		const second = checkPattern(project, change, { sim });

		expect(JSON.stringify(project)).toBe(before);
		expect(first.refusal).toBeNull();
		expect(first.commands.length).toBeGreaterThan(0);
		expect(second.commands).toEqual(first.commands);
		expect(first.verdicts).toHaveLength(3);
		expect(first.verdicts.every((verdict) => verdict.fits)).toBe(true);
	});

	it('should say which hit does not fit and why, with nothing to apply', () => {
		const project = deepFrozen(smallProject([1, 1.14, 1.28, 1.42, 1.56]));

		const check = checkPattern(project, { marbleId: MARBLE, from: 1, to: 1.56, kind: 'zigzag', width: 0.3, bounce: 0.5 }, { sim });

		expect(check.commands).toEqual([]);
		expect(check.groupId).toBeNull();
		expect(check.refusal?.hitId).toMatch(/^h\d$/);
		expect(check.refusal?.words).toMatch(/^Zigzag doesn't fit at Hit \d of .*Nothing changed\.$/);
		expect(check.verdicts.find((verdict) => verdict.hitId === check.refusal?.hitId)?.fits).toBe(false);
	});

	it('should say the same for a range it can not take at all', () => {
		const project = smallProject([1, 2.2]);

		const check = checkPattern(project, { marbleId: MARBLE, from: 1.2, to: 2, kind: 'zigzag', width: 0.1, bounce: 0.5 }, { sim });

		expect(check.commands).toEqual([]);
		expect(check.refusal?.words).toContain('Try Long Rail');
	});

	it('should say so for a kind this version of the app does not have', () => {
		const project = smallProject([1, 1.4]);

		const fit = fitPattern({ project, marbleId: MARBLE, hitIds: ['h1', 'h2'], kind: 'pretzel' }, { sim });

		expect(fit.pieces).toEqual([]);
		expect(fit.blocking[0]?.words).toContain('pretzel');
	});
});

describe('PATTERNS', () => {
	it('should give every Pattern what the tiles and the commands read', () => {
		for (const kind of PATTERN_KINDS) {
			const pattern = PATTERNS[kind];
			expect(pattern.label).not.toBe('');
			expect(pattern.title).not.toBe('');
			expect(pattern.glyph.marks.length).toBeGreaterThan(0);
			expect(pattern.defaults.width).toBeGreaterThan(0);
			expect(isPatternKind(kind)).toBe(true);
		}
		expect(patternKinds('notes')).toEqual(['zigzag', 'staircase']);
		expect(patternKinds('silence')).toEqual(['longRail']);
		expect(isPatternKind('toString')).toBe(false);
	});
});
