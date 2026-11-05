import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyProjectCommands, createProject, isPatternGroup, type TGroup, type TPiece, type TProject, type TProjectCommand } from '@/modules/project';
import { createSimulator, type TSimulator, startRailId } from '@/modules/simulation';
import { BAR_LENGTH, ZIGZAG_WIDTH } from './fit-bars';
import { fitPattern } from './fit-pattern';
import { measurePattern } from './measures';
import { dropForBounce } from './registry';
import { flattenCommands, patternOfPiece, runGroupChange } from './run-group';

// Real fits of a few hits, which an otherwise busy machine runs several times slower
vi.setConfig({ testTimeout: 30_000 });

let sim: TSimulator;

beforeAll(async () => {
	sim = await createSimulator();
});
afterAll(() => sim.dispose());

const MARBLE = 'marble';

function apply(project: TProject, commands: TProjectCommand[]): TProject {
	const [isOk, err, next] = applyProjectCommands(project, commands);
	if (!isOk) throw err;
	return next;
}

function smallProject(times: number[], id = 'small'): TProject {
	const project = createProject({ id, title: 'Small' });
	const marble = project.marbles[0]!;
	return apply(project, [
		{ type: 'addMarble', marble: { ...marble, id: MARBLE, start: { position: { x: 0, y: 0.6 }, time: times[0]! - 0.35 }, hits: times.map((time, index) => ({ id: `h${index + 1}`, time })) } },
		{ type: 'removeMarble', marbleId: marble.id },
		{ type: 'updateProject', patch: { length: times.at(-1)! + 0.6 } }
	]);
}

const ids = (from: number, to: number): string[] => Array.from({ length: to - from + 1 }, (_, index) => `h${from + index}`);

describe('fitPattern function', () => {
	it('should play every note of a Zigzag on time in two straight columns', () => {
		const project = smallProject([1, 1.4, 1.8, 2.2, 2.6, 3]);
		const fit = fitPattern({ project, marbleId: MARBLE, hitIds: ids(1, 6), kind: 'zigzag', width: 0.14, drop: 0.08, barDepth: 0.03 }, { sim });
		const measures = measurePattern(fit.project, sim.simulate(fit.project), MARBLE);

		expect(fit.problems).toEqual([]);
		expect(fit.pieces).toHaveLength(6);
		expect(measures.onTime).toBe(6);
		expect(measures.columnStraightness).toBeLessThan(0.005);
		expect(measures.dropPerHit).toBeCloseTo(fit.drop ?? 0, 2);
		expect(fit.exit).not.toBeNull();
	});

	it('should default a Zigzag to tight columns, and build any Width asked exactly', () => {
		const project = smallProject([1, 1.4, 1.8, 2.2, 2.6, 3]);
		const tight = fitPattern({ project, marbleId: MARBLE, hitIds: ids(1, 6), kind: 'zigzag' }, { sim });
		const wide = fitPattern({ project, marbleId: MARBLE, hitIds: ids(1, 6), kind: 'zigzag', width: 0.17 }, { sim });
		// Where the marble strikes is what's solved: a quarter of a bar inside each bar's center
		const apart = (fit: typeof tight): number => {
			const hits = sim.simulate(fit.project).hits;
			return Math.abs((hits.find((hit) => hit.hitId === 'h2')?.dot?.x ?? 0) - (hits.find((hit) => hit.hitId === 'h3')?.dot?.x ?? 0));
		};

		expect(tight.width).toBe(ZIGZAG_WIDTH);
		expect(tight.problems).toEqual([]);
		expect(apart(tight)).toBeCloseTo(ZIGZAG_WIDTH - BAR_LENGTH / 2, 2);
		expect(wide.width).toBe(0.17);
		expect(apart(wide)).toBeCloseTo(0.17 - BAR_LENGTH / 2, 2);
	});

	it('should share the fall a longer hop needs with the hop before it, and fit the same way twice', () => {
		// A marble can't leave a bar faster than it landed: 0.235 s hops, then 0.37 and 0.59 s, must fall about 0.36 m at Gravity 1
		const project = { ...smallProject([1, 1.235, 1.47, 1.843, 2.43, 2.8]), gravity: 1 };
		const fit = fitPattern({ project, marbleId: MARBLE, hitIds: ids(1, 6), kind: 'zigzag', drop: 0.08 }, { sim });
		const again = fitPattern({ project, marbleId: MARBLE, hitIds: ids(1, 6), kind: 'zigzag', drop: 0.08 }, { sim });
		const measures = measurePattern(fit.project, sim.simulate(fit.project), MARBLE);

		expect(measures.onTime).toBe(6);
		expect(measures.largestDrop).toBeLessThan(0.45);
		expect(again.commands).toEqual(fit.commands);
	});

	it('should keep Length and Depth asked for, with the strike on the bar', () => {
		const project = smallProject([1, 1.4, 1.8, 2.2]);
		const fit = fitPattern({ project, marbleId: MARBLE, hitIds: ids(1, 4), kind: 'zigzag', width: 0.14, drop: 0.08, barLength: 0.04, barDepth: 0.03 }, { sim });

		expect(fit.pieces.map((piece) => piece.params['length'])).toEqual([0.04, 0.04, 0.04, 0.04]);
		expect(fit.pieces.map((piece) => piece.params['depth'])).toEqual([0.03, 0.03, 0.03, 0.03]);
		expect(sim.simulate(fit.project).hits.every((hit) => hit.status === 'onTime' || hit.status === 'drifting')).toBe(true);
	});

	it('should step sideways by Width in a Staircase', () => {
		const project = smallProject([1, 1.5, 2, 2.5, 3]);
		const fit = fitPattern({ project, marbleId: MARBLE, hitIds: ids(1, 5), kind: 'staircase', width: 0.09, drop: 0.12 }, { sim });
		const result = sim.simulate(fit.project);
		const dots = result.hits.map((hit) => hit.dot?.x ?? 0);

		expect(result.hits.every((hit) => hit.status === 'onTime' || hit.status === 'drifting')).toBe(true);
		expect(Math.abs(dots[1]! - dots[0]!)).toBeCloseTo(fit.width, 2);
		expect(Math.abs(dots[2]! - dots[1]!)).toBeCloseTo(fit.width, 2);
	});

	it('should say in words why a hop can not fit, instead of falling back silently', () => {
		const project = smallProject([1, 1.14, 1.28, 1.42, 1.56]);
		const fit = fitPattern({ project, marbleId: MARBLE, hitIds: ids(1, 5), kind: 'zigzag', width: 0.3, drop: 0.08, maxTries: 1 }, { sim });

		expect(fit.width).toBeCloseTo(0.3, 5);
		expect(fit.problems.length).toBeGreaterThan(0);
		expect(fit.problems.every((problem) => problem.hitId.length > 0 && /[a-z]/.test(problem.words) && !problem.words.includes('undefined'))).toBe(true);
	});

	it('should build the Width asked, and tilt past the usual limit only when asked', () => {
		const project = smallProject([1, 1.14, 1.28, 1.42, 1.56]);
		const usual = fitPattern({ project, marbleId: MARBLE, hitIds: ids(1, 5), kind: 'zigzag', width: 0.3, drop: 0.08 }, { sim });
		const steep = fitPattern({ project, marbleId: MARBLE, hitIds: ids(1, 5), kind: 'zigzag', width: 0.3, drop: 0.08, maxTilt: 70 }, { sim });
		const steepest = (fit: typeof usual): number => Math.max(...fit.pieces.map((piece) => Math.abs(piece.angle ?? 0) * (180 / Math.PI)));

		expect(usual.width).toBe(0.3);
		expect(steep.width).toBe(0.3);
		expect(steepest(usual)).toBeLessThanOrEqual(40.01);
		expect(steepest(steep)).toBeGreaterThan(40);
		expect(steep.notes[0]).toContain('past the usual 40°');
		expect(usual.problems.some((problem) => problem.words.includes('of tilt') && !problem.words.includes('limit'))).toBe(true);
	});

	it('should fill a long silence with a Long Rail that lets go in time for the next note', () => {
		const project = smallProject([1, 2.2]);
		const placed = fitPattern({ project, marbleId: MARBLE, hitIds: ['h1'], kind: 'zigzag', width: 0.14, drop: 0.08 }, { sim });
		const rail = fitPattern({ project: placed.project, marbleId: MARBLE, hitIds: ['h1', 'h2'], kind: 'longRail' }, { sim });
		const result = sim.simulate(rail.project);
		const free = sim.simulate(placed.project);
		const fall = (run: typeof result): number => (run.hits[0]?.dot?.y ?? 0) - (run.hits[1]?.dot?.y ?? 0);

		expect(rail.problems).toEqual([]);
		expect(rail.pieces[0]?.type).toBe('rail');
		expect(fall(result)).toBeLessThan(fall(free) / 2);
	});

	it('should use a Switchback for a silence over the rail limit', () => {
		const project = smallProject([1, 3]);
		const placed = fitPattern({ project, marbleId: MARBLE, hitIds: ['h1'], kind: 'zigzag', width: 0.14, drop: 0.08 }, { sim });
		const rail = fitPattern({ project: placed.project, marbleId: MARBLE, hitIds: ['h1', 'h2'], kind: 'longRail' }, { sim });

		expect(rail.pieces[0]?.layout).toBe('switchback');
	});

	it('should use the same bounce on every bar when one is given', () => {
		const project = smallProject([1, 1.4, 1.8]);
		const fit = fitPattern({ project, marbleId: MARBLE, hitIds: ids(1, 3), kind: 'zigzag', width: 0.14, fixedBounce: 0.6, maxTries: 1 }, { sim });
		expect(fit.drop).toBeNull();
		expect(fit.pieces[0]?.params['bounce']).toBeCloseTo(0.6, 1);
	});
});

describe('runGroupChange function', () => {
	const change = { marbleId: MARBLE, from: 1, to: 2.2, kind: 'zigzag' as const, width: 0.14, bounce: 0.5 };

	it('should make one Group named after the Pattern and leave the project untouched', () => {
		const project = smallProject([1, 1.4, 1.8, 2.2]);
		const outcome = runGroupChange(project, change, { sim });
		const next = apply(project, outcome.commands);

		expect(project.track.groups).toEqual([]);
		expect(next.track.groups).toHaveLength(1);
		expect(next.track.groups?.[0]).toMatchObject({ name: 'Zigzag', pattern: { kind: 'zigzag', hitIds: ['h1', 'h2', 'h3', 'h4'], width: 0.14 } });
		expect(next.track.groups?.[0]?.pieceIds).toHaveLength(4);
		expect(outcome.measures?.onTime).toBe(4);
	});

	it('should keep skins when a Group runs again', () => {
		const project = smallProject([1, 1.4, 1.8, 2.2]);
		const made = apply(project, runGroupChange(project, change, { sim }).commands);
		const group = made.track.groups?.[0];
		const [bar] = made.track.pieces.filter((piece) => group?.pieceIds.includes(piece.id));
		const dressed = apply(made, [{ type: 'addPiece', piece: { ...bar!, skin: { assetId: 'platform:gift' } } }]);
		const again = apply(dressed, runGroupChange(dressed, { ...change, groupId: group!.id, width: 0.16 }, { sim }).commands);

		expect(again.track.pieces.find((piece) => piece.id === bar!.id)?.skin?.assetId).toBe('platform:gift');
		expect(again.track.groups?.filter(isPatternGroup)[0]?.pattern.width).toBe(0.16);
	});

	it('should open a track on a Long Rail before the first note, from a release at the start of the range', () => {
		const project = smallProject([2, 2.4]);
		const outcome = runGroupChange(project, { ...change, kind: 'longRail', from: 0.5, to: 1.95 }, { sim });
		const next = apply(project, outcome.commands);
		const result = sim.simulate(next);
		const marble = next.marbles[0];

		expect(outcome.problems).toEqual([]);
		expect(marble?.start?.time).toBe(0.5);
		expect(next.track.groups?.[0]?.pieceIds).toEqual([startRailId(MARBLE)]);
		expect((marble?.start?.position.y ?? 0) - (result.hits[0]?.dot?.y ?? 0)).toBeLessThan(0.6);
	});

	it('should hold the marble on a rail across a hop too long for a bounce', () => {
		const project = { ...smallProject([1, 1.25, 1.5, 2.5, 2.74]), gravity: 1 };
		const outcome = runGroupChange(project, { ...change, to: 2.74 }, { sim });
		const result = sim.simulate(apply(project, outcome.commands));

		expect(outcome.madePieces.filter((piece) => piece.type === 'rail')).toHaveLength(1);
		expect(outcome.madePieces.filter((piece) => piece.type === 'platform')).toHaveLength(5);
		expect(outcome.problems.some((problem) => /falls [\d.]+ m/.test(problem.words))).toBe(false);
		expect(result.hits.every((hit) => hit.status === 'onTime' || hit.status === 'drifting')).toBe(true);
	});

	it('should flatten to a plain Group that later Groups leave alone', () => {
		const project = smallProject([1, 1.4, 1.8, 2.2, 2.6, 3]);
		const first = apply(project, runGroupChange(project, { ...change, to: 1.8 }, { sim }).commands);
		const firstGroup = first.track.groups?.filter(isPatternGroup)[0];
		expect(patternOfPiece(first, firstGroup?.pieceIds[0] ?? '')?.id).toBe(firstGroup?.id);
		const flat = apply(first, flattenCommands(firstGroup!));

		expect(flat.track.groups).toEqual([{ id: firstGroup?.id, name: firstGroup?.name, marbleId: MARBLE, pieceIds: firstGroup?.pieceIds }]);
		expect(flat.track.pieces).toHaveLength(first.track.pieces.length);
		expect(patternOfPiece(flat, firstGroup?.pieceIds[0] ?? '')).toBeNull();
		const next = apply(flat, runGroupChange(flat, { ...change, from: 2.2, to: 3 }, { sim }).commands);
		expect(next.track.pieces.filter((piece) => firstGroup?.pieceIds.includes(piece.id))).toEqual(flat.track.pieces.filter((piece) => firstGroup?.pieceIds.includes(piece.id)));
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

	it('should fit later Groups again when an earlier one changes, as one edit', () => {
		const project = smallProject([1, 1.4, 1.8, 2.2, 2.6, 3]);
		const first = apply(project, runGroupChange(project, { ...change, to: 1.8 }, { sim }).commands);
		const second = apply(first, runGroupChange(first, { ...change, from: 2.2, to: 3 }, { sim }).commands);
		const earlier = second.track.groups?.filter(isPatternGroup).find((group) => group.pattern.hitIds[0] === 'h1');
		const moved = runGroupChange(second, { ...change, groupId: earlier?.id, to: 1.8, width: 0.16 }, { sim });
		const next = apply(second, moved.commands);
		const result = sim.simulate(next);

		expect(moved.later.map((item) => item.name)).toEqual(['Zigzag 2']);
		expect(next.track.groups).toHaveLength(2);
		expect(result.hits.every((hit) => hit.status === 'onTime' || hit.status === 'drifting')).toBe(true);
	});

	it('should leave hand edits on later Groups alone when the marble leaves the same way', () => {
		const project = smallProject([1, 1.4, 1.8, 2.2, 2.6, 3]);
		const first = apply(project, runGroupChange(project, { ...change, to: 1.8 }, { sim }).commands);
		const second = apply(first, runGroupChange(first, { ...change, from: 2.2, to: 3 }, { sim }).commands);
		const earlier = second.track.groups?.filter(isPatternGroup).find((group) => group.pattern.hitIds[0] === 'h1');
		const same = runGroupChange(second, { ...change, groupId: earlier?.id, to: 1.8 }, { sim });
		expect(same.later).toEqual([]);
	});

	it('should say when a later Group can not fit any more', () => {
		const project = smallProject([1, 1.4, 1.8, 2.2, 2.6]);
		const first = apply(project, runGroupChange(project, { ...change, to: 1.8 }, { sim }).commands);
		const second = apply(first, [{ type: 'addGroup', group: { id: 'late', name: 'Long Rail', marbleId: MARBLE, pieceIds: [], pattern: { kind: 'longRail', hitIds: ['h3', 'h5'], width: 0.14, bounce: 0.5 } } }]);
		const earlier = second.track.groups?.filter(isPatternGroup).find((group) => group.pattern.hitIds[0] === 'h1');
		const outcome = runGroupChange(second, { ...change, groupId: earlier?.id, to: 1.8, width: 0.16 }, { sim });
		const later = outcome.later.find((item) => item.groupId === 'late');

		expect(later?.problems[0]?.words).toContain('fills silence');
	});

	it('should replace a Long Rail when one is made over it', () => {
		const project = smallProject([1, 2.2]);
		const first = apply(project, runGroupChange(project, { ...change, to: 1 }, { sim }).commands);
		const railed = apply(first, runGroupChange(first, { ...change, from: 1.2, to: 2, kind: 'longRail' }, { sim }).commands);
		const again = apply(railed, runGroupChange(railed, { ...change, from: 1.3, to: 1.9, kind: 'longRail' }, { sim }).commands);
		const rail = again.track.groups?.filter(isPatternGroup).find((group) => group.pattern.kind === 'longRail');

		expect(again.track.groups).toHaveLength(2);
		expect(rail?.pieceIds).toHaveLength(1);
		expect(again.track.pieces.some((piece) => piece.id === rail?.pieceIds[0])).toBe(true);
	});

	it('should let a preview answer without touching what follows', () => {
		const project = smallProject([1, 1.4, 1.8, 2.2]);
		const outcome = runGroupChange(project, change, { sim, isPreview: true });
		expect(outcome.madePieces).toHaveLength(4);
		expect(outcome.measures).toBeNull();
	});

	it('should ask for less fall at a livelier Bounce', () => {
		expect(dropForBounce('zigzag', 0.7)).toBeLessThan(dropForBounce('zigzag', 0.5));
		expect(dropForBounce('zigzag', 0.5)).toBeCloseTo(0.08, 5);
	});
});

describe('Group commands', () => {
	const group: TGroup = { id: 'g', name: 'Zigzag', marbleId: MARBLE, pieceIds: ['a', 'b'], pattern: { kind: 'zigzag', hitIds: ['h1', 'h2'], width: 0.14, bounce: 0.5 } };
	const piece = (id: string): TPiece => ({ id, type: 'platform', params: {}, angle: 0, place: { kind: 'plays', marbleId: MARBLE, hitId: 'h1', contactAt: 0.5 } });

	it('should forget a deleted piece and drop a Group that lost them all', () => {
		const project = apply(smallProject([1, 2]), [{ type: 'addPiece', piece: piece('a') }, { type: 'addPiece', piece: piece('b') }, { type: 'addGroup', group }]);
		const one = apply(project, [{ type: 'removePieces', pieceIds: ['a'] }]);
		const none = apply(one, [{ type: 'removePieces', pieceIds: ['b'] }]);

		expect(one.track.groups?.[0]?.pieceIds).toEqual(['b']);
		expect(none.track.groups).toEqual([]);
	});

	it('should take the Groups of a removed marble with it', () => {
		const project = apply(smallProject([1, 2]), [{ type: 'addGroup', group }]);
		expect(apply(project, [{ type: 'removeMarble', marbleId: MARBLE }]).track.groups).toEqual([]);
	});
});
