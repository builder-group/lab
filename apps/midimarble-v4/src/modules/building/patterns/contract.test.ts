import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyProjectCommands, createProject, type TProject, type TProjectCommand } from '@/modules/project';
import { createSimulator, type TSimulator } from '@/modules/simulation';
import { NO_BLENDER_OBJECTS, preflightExport, problemSummary } from '../export-preflight';
import { checkPattern } from './check-pattern';
import { arrivalAt } from './arrival';
import { fitPattern } from './fit-pattern';
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

describe('checkPattern function', () => {
	const standing = (project: TProject) => {
		const result = sim.simulate(project);
		return { result, summary: problemSummary(preflightExport(project, { ...result, revision: project.revision }, NO_BLENDER_OBJECTS), 'track') };
	};

	it('should start a marble with nothing before its notes just above them, with no new Problems', () => {
		const project = smallProject([1, 1.4, 1.8, 2.2, 2.6, 3, 3.4, 3.8, 4.2]);
		const hits = project.marbles[0]?.hits ?? [];

		const check = checkPattern(project, { marbleId: MARBLE, from: hits[5]?.time ?? 0, to: hits[8]?.time ?? 0, kind: 'zigzag' }, { sim });
		const after = apply(project, check.commands);
		const { result, summary } = standing(after);

		expect(check.refusal).toBeNull();
		expect(after.marbles[0]?.start.time).toBeGreaterThan(hits[4]?.time ?? 0);
		expect(after.marbles[0]?.start.time).toBeLessThan(hits[5]?.time ?? 0);
		expect(result.hits.slice(5).every((hit) => hit.status === 'onTime')).toBe(true);
		expect(result.hits.slice(0, 5).every((hit) => hit.status === 'open')).toBe(true);
		expect(summary.problems).toEqual([]);
	});

	it('should release the marble earlier for a Pattern on the notes before, and fit what follows again', () => {
		const project = smallProject([1, 1.4, 1.8, 2.2, 2.6, 3]);
		const later = apply(project, checkPattern(project, { marbleId: MARBLE, from: 2.2, to: 3, kind: 'zigzag' }, { sim }).commands);

		const check = checkPattern(later, { marbleId: MARBLE, from: 1, to: 1.8, kind: 'zigzag' }, { sim });
		const after = apply(later, check.commands);

		expect(check.refusal).toBeNull();
		expect(after.marbles[0]?.start.time).toBeLessThan(1);
		expect(sim.simulate(after).hits.every((hit) => hit.status === 'onTime' || hit.status === 'drifting')).toBe(true);
	});

	it('should say a hit is out of order when the notes before it have no pieces and the marble falls past them', () => {
		const project = smallProject(Array.from({ length: 10 }, (_, index) => 1 + index * 0.4));
		const built = apply(project, checkPattern(project, { marbleId: MARBLE, from: 1, to: 1.8, kind: 'zigzag' }, { sim }).commands);

		const check = checkPattern(built, { marbleId: MARBLE, from: 3.8, to: 4.6, kind: 'zigzag' }, { sim });

		expect(check.commands).toEqual([]);
		expect(check.refusal?.words).toMatch(/^Zigzag doesn't fit at Hit 8 of .+\. It's out of order: Hits 4 to 7 have no pieces yet, so the marble falls [\d.]+ m before it\. Nothing changed\.$/);
		expect(check.verdicts.find((verdict) => verdict.hitId === 'h8')?.fits).toBe(false);
	});

	it('should pick a Width when none is asked, and store it', () => {
		const project = smallProject([1, 1.4, 1.8, 2.2]);

		const check = checkPattern(project, { marbleId: MARBLE, from: 1, to: 1.8, kind: 'zigzag' }, { sim });
		const group = apply(project, check.commands).track.groups[0];

		expect(group?.pattern?.width).toBe(PATTERNS.zigzag.defaults.width);
		expect(group?.pattern?.bounce).toBe(PATTERNS.zigzag.defaults.bounce);
		expect(Object.keys(group?.pattern ?? {}).sort()).toEqual(['bounce', 'hitIds', 'kind', 'width']);
	});

	it('should offer the hits that fit when one further along does not', () => {
		const project = smallProject([1, 1.4, 1.8, 2.2, 2.24, 2.28]);

		const check = checkPattern(project, { marbleId: MARBLE, from: 1, to: 2.28, kind: 'zigzag', width: 0.1 }, { sim });

		expect(check.commands).toEqual([]);
		expect(check.offers.map((offer) => offer.label)).toContain('Use Hits 1–3');
		const offer = check.offers.find((item) => item.from != null);
		const taken = checkPattern(project, { marbleId: MARBLE, from: offer?.from ?? 0, to: offer?.to ?? 0, kind: 'zigzag', width: 0.1 }, { sim });
		expect(taken.refusal).toBeNull();
	});

	it('should not count another marble playing its own notes as a strike', () => {
		const project = smallProject([1, 1.4, 1.8, 2.2, 2.6]);
		const marble = project.marbles[0];
		if (marble == null) throw new Error('No marble');
		const other = { ...marble, id: 'other', name: 'Other', start: { position: { x: 0.6, y: 0.6 }, time: 0.75 }, hits: [1.1, 1.3, 1.5, 1.7, 1.9, 2.1, 2.3].map((time, index) => ({ id: `o${index + 1}`, time })) };
		const two = apply(project, [{ type: 'addMarble', marble: other }]);
		const played = apply(two, checkPattern(two, { marbleId: 'other', from: 1.1, to: 2.3, kind: 'zigzag' }, { sim }).commands);

		const check = checkPattern(played, { marbleId: MARBLE, from: 1, to: 2.2, kind: 'zigzag' }, { sim });

		expect(check.refusal).toBeNull();
		expect(check.problems.filter((problem) => problem.words.includes('another bar'))).toEqual([]);
	});

	it('should follow a built track, leaving what comes after where it stands', () => {
		const project = smallProject([1, 1.4, 1.8, 2.2, 2.6, 3, 3.4, 3.8]);
		const made = checkPattern(project, { marbleId: MARBLE, from: 1, to: 3.8, kind: 'zigzag', width: 0.14 }, { sim });
		const built = { ...apply(project, made.commands), track: { ...apply(project, made.commands).track, groups: [] } };
		const dotOf = (next: TProject, hitId: string) => sim.simulate(next).hits.find((hit) => hit.hitId === hitId)?.dot;

		const check = checkPattern(built, { marbleId: MARBLE, from: 1.8, to: 2.6, kind: 'staircase' }, { sim });
		const after = apply(built, check.commands);

		expect(check.refusal).toBeNull();
		expect(check.movedAfter).toBe(0);
		for (const hitId of ['h7', 'h8']) expect(Math.hypot((dotOf(after, hitId)?.x ?? 0) - (dotOf(built, hitId)?.x ?? 0), (dotOf(after, hitId)?.y ?? 0) - (dotOf(built, hitId)?.y ?? 0))).toBeLessThan(0.01);
		expect(sim.simulate(after).hits.every((hit) => hit.status === 'onTime')).toBe(true);
	});

	it('should keep a rail that already holds a silence, changing nothing else', () => {
		const project = smallProject([1, 2.2]);
		const first = apply(project, checkPattern(project, { marbleId: MARBLE, from: 1, to: 1, kind: 'zigzag' }, { sim }).commands);
		const railed = apply(first, checkPattern(first, { marbleId: MARBLE, from: 1.2, to: 2, kind: 'longRail' }, { sim }).commands);
		const rail = railed.track.pieces.find((piece) => piece.type === 'rail');
		const plain = { ...railed, track: { ...railed.track, groups: [] } };

		const check = checkPattern(plain, { marbleId: MARBLE, from: 1.2, to: 2, kind: 'longRail' }, { sim });
		const after = apply(plain, check.commands);

		expect(check.madePieces.map((piece) => piece.id)).toEqual([rail?.id]);
		expect(after.track.pieces.find((piece) => piece.id === rail?.id)?.params).toEqual(rail?.params);
		expect(after.track.groups[0]?.pieceIds).toEqual([rail?.id]);
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
