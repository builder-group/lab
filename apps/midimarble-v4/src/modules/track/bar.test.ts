import { describe, expect, it } from 'vitest';
import type { TProposal } from '@/modules/building';
import { createProject, toHitKey, toRangeKey, type TProject } from '@/modules/project';
import { createLinkedPiece, type TSimulationResult } from '@/modules/simulation';
import { acceptWords, barRows, causeWords, barTargetOf, defaultChoice, fallbackOf, frontierStop, passedWords, selectionOfStop, senderOf, standingWords, stopBeside, stopsOf, whereTitle, whereWords, type TBarTarget } from './bar';

/** Notes at these times on one marble, the first `built` with a platform each */
function track(times: number[], built = 0): TProject {
	const base = createProject();
	const marble = { ...(base.marbles[0] ?? { id: 'm', name: 'Melody' }), id: 'm', hits: times.map((time, index) => ({ id: `h${index + 1}`, time })) } as TProject['marbles'][number];
	const pieces = times.slice(0, built).map((_, index) => createLinkedPiece('platform', 'm', `h${index + 1}`, 0.2, { id: `p${index + 1}` }));
	return { ...base, marbles: [marble], track: { pieces, groups: [] } };
}

const EVEN = [1, 1.5, 2, 2.5];
const WITH_REST = [1, 1.5, 5, 5.5];

const hit = (id: string): string => toHitKey('m', id);

function targetOf(project: TProject, selection: string[]): TBarTarget {
	const target = barTargetOf(project, selection);
	if (target == null) throw new Error('No target');
	return target;
}

describe('barTargetOf', () => {
	it('is about an open note at the frontier, and past it asks to build up to here', () => {
		const project = track(EVEN, 1);
		expect(targetOf(project, [hit('h2')])).toMatchObject({ kind: 'note', number: 2, total: 4, stage: 'open' });
		const past = targetOf(project, [hit('h3')]);
		expect(past).toMatchObject({ stage: 'pastBuilt' });
		expect(defaultChoice(past)).toBe('buildUpTo');
	});

	it('takes a platform as the note it plays, and it is the end of what is built', () => {
		expect(targetOf(track(EVEN, 2), ['p2'])).toMatchObject({ kind: 'note', number: 2, stage: 'built', isLastBuilt: true });
		expect(targetOf(track(EVEN, 3), ['p2'])).toMatchObject({ isLastBuilt: false });
	});

	it('reads several notes as a range, whichever order they were selected in', () => {
		const target = targetOf(track(EVEN, 4), [hit('h3'), hit('h1'), hit('h2')]);
		expect(target).toMatchObject({ kind: 'notes', first: 1, last: 3, hitIds: ['h1', 'h2', 'h3'] });
		expect(whereWords(target)).toBe('3 notes');
		expect(whereTitle(target)).toBe('Notes 1 to 3');
		expect(standingWords(track(EVEN, 0), targetOf(track(EVEN, 0), [hit('h1'), hit('h2')]))).toBe('Notes');
		expect(standingWords(track(EVEN, 2), targetOf(track(EVEN, 2), [hit('h1'), hit('h2')]))).toBe('Platforms');
	});

	it('has nothing to say on notes of two marbles or anything else', () => {
		const project = track(EVEN, 1);
		expect(barTargetOf(project, [])).toBeNull();
		expect(barTargetOf(project, [hit('h1'), toHitKey('other', 'x')])).toBeNull();
		expect(barTargetOf(project, ['m'])).toBeNull();
	});
});

describe('stops', () => {
	it('stops on a long rest between two notes', () => {
		const stops = stopsOf(track(WITH_REST, 2), 'm');
		expect(stops.map((stop) => stop.kind)).toEqual(['note', 'note', 'rest', 'note', 'note']);
	});

	it('moves by one stop, and a rest counts', () => {
		const project = track(WITH_REST, 2);
		const stop = stopBeside(project, targetOf(project, ['p2']), 1);
		expect(stop?.kind).toBe('rest');
		if (stop == null) throw new Error('No stop');
		const selection = selectionOfStop(project, stop);
		const rest = targetOf(project, selection);
		expect(rest.kind).toBe('rest');
		expect(whereWords(rest)).toBe('Rest 3.5 s');
		expect(stopBeside(project, rest, -1)).toMatchObject({ kind: 'note', number: 2 });
		expect(stopBeside(project, rest, 1)).toMatchObject({ kind: 'note', number: 3 });
	});

	it('selects a built note by its platform and an open one by its note', () => {
		const project = track(EVEN, 1);
		const [first, second] = stopsOf(project, 'm');
		if (first == null || second == null) throw new Error('No stops');
		expect(selectionOfStop(project, first)).toEqual(['p1']);
		expect(selectionOfStop(project, second)).toEqual([hit('h2')]);
	});

	it('finds where building goes on: the first open note, or the rest before it', () => {
		expect(frontierStop(track(EVEN, 2), 'm')).toMatchObject({ kind: 'note', number: 3 });
		expect(frontierStop(track(WITH_REST, 2), 'm')?.kind).toBe('rest');
		expect(frontierStop(track(EVEN, 4), 'm')).toBeNull();
	});

	it('names the piece that sends the marble to a note or a rest, the last of its own it touched before', () => {
		const run = (times: number[]): TSimulationResult =>
			({
				hits: times.map((time, index) => ({ marbleId: 'm', hitId: `h${index + 1}`, targetTime: time })),
				contacts: [
					{ marbleId: 'm', kind: 'piece', otherId: 'p1', time: times[0] },
					{ marbleId: 'm', kind: 'piece', otherId: 'p2', time: times[1] },
					{ marbleId: 'm', kind: 'piece', otherId: 'stray', time: (times[1] ?? 0) + 0.1 }
				]
			}) as unknown as TSimulationResult;
		const open = track(EVEN, 1);
		expect(senderOf(open, run(EVEN), targetOf(open, [hit('h2')]))).toMatchObject({ piece: { id: 'p1' }, stop: { kind: 'note', number: 1 } });
		// Its own platform isn't what sends the marble there, and a piece tied to nothing isn't counted
		const built = track(EVEN, 2);
		expect(senderOf(built, run(EVEN), targetOf(built, ['p2']))?.piece.id).toBe('p1');
		const rest = track(WITH_REST, 2);
		expect(senderOf(rest, run(WITH_REST), targetOf(rest, [toRangeKey('m', 1.5, 5)]))).toMatchObject({ piece: { id: 'p2' }, stop: { kind: 'note', number: 2 } });
		expect(senderOf(open, null, targetOf(open, [hit('h2')]))).toBeNull();
	});

	it('names a rest\'s rail by what it is: one curved stroke is a Curved Rail, turns a Switchback', () => {
		const base = track(WITH_REST, 2);
		const rail = (layout: 'curve' | 'c' | 'switchback' | 'path'): TProject => ({ ...base, track: { ...base.track, pieces: [...base.track.pieces, { ...createLinkedPiece('rail', 'm', 'h2', 0, { id: 'r1' }), layout }] } });
		const words = (layout: 'curve' | 'c' | 'switchback' | 'path'): string => standingWords(rail(layout), targetOf(rail(layout), [toRangeKey('m', 1.5, 5)]));
		expect(words('curve')).toBe('Curved Rail');
		expect(words('c')).toBe('Curved Rail');
		expect(words('switchback')).toBe('Switchback');
		expect(words('path')).toBe('Rail');
	});

	it('takes a dragged silence as a rest', () => {
		const project = track(WITH_REST, 2);
		expect(targetOf(project, [toRangeKey('m', 2, 3)])).toMatchObject({ kind: 'rest', gap: { fromHitId: 'h2', toHitId: 'h3' } });
	});
});

describe('barRows', () => {
	const ids = (project: TProject, selection: string[], open = 2): string[] => barRows(project, targetOf(project, selection), open).map((row) => row.id);

	it('offers an open note Platform and the stretches, then Build Entire Track last', () => {
		expect(ids(track(EVEN, 1), [hit('h2')])).toEqual(['platform', 'zigzag', 'staircase', 'buildEntire']);
	});

	it('offers a rest what fills a rest, then the plain piece, in the order a refused default falls through', () => {
		const project = track(WITH_REST, 2);
		const rest = targetOf(project, [toRangeKey('m', 1.5, 5)]);
		expect(ids(project, [toRangeKey('m', 1.5, 5)])).toEqual(['longRail', 'switchback', 'platform', 'buildEntire']);
		expect(defaultChoice(rest)).toBe('longRail');
		expect(fallbackOf(rest, 'longRail')).toBe('switchback');
		expect(fallbackOf(rest, 'switchback')).toBe('platform');
		expect(fallbackOf(rest, 'platform')).toBeNull();
		expect(defaultChoice(rest, ['longRail'])).toBe('switchback');
		expect(defaultChoice(rest, ['longRail', 'switchback'])).toBe('platform');
		// A note's default doesn't fall through
		expect(fallbackOf(targetOf(project, [hit('h3')]), 'platform')).toBeNull();
	});

	it('says which kind it shows and why the ones before it were passed over', () => {
		const refusal = { words: "Curved Rail doesn't fit at Note 3 of Melody. The rail lets go 0.40 s early for the note at 0:05. Nothing changed." } as TProposal;
		expect(passedWords([{ kind: 'longRail', proposal: refusal }], 'switchback')).toBe("Curved Rail doesn't fit at Note 3 of Melody. The rail lets go 0.40 s early for the note at 0:05. Switchback instead.");
		expect(passedWords([{ kind: 'switchback', proposal: { words: 'No switchback holds the marble.' } as TProposal }], 'platform')).toBe("Switchback doesn't fit. No switchback holds the marble. Platform instead.");
		expect(passedWords([], 'longRail')).toBeNull();
	});

	it('offers a built note Change to, Rebuild From Here and Remove', () => {
		const rows = barRows(track(EVEN, 4), targetOf(track(EVEN, 4), ['p2']), 0);
		expect(rows.map((row) => row.label)).toEqual(['Change to Zigzag · 3 notes', 'Change to Staircase · 3 notes', 'Rebuild From Here', 'Remove']);
		expect(rows[2]?.note).toBe('Keeps Notes 1 to 2');
	});

	it('offers a range of built notes the same, without counting them again', () => {
		const project = track(EVEN, 4);
		const rows = barRows(project, targetOf(project, [hit('h2'), hit('h3')]), 0);
		expect(rows.map((row) => row.label)).toEqual(['Change to Zigzag', 'Change to Staircase', 'Rebuild From Here', 'Remove']);
	});

	it('offers past the built notes only building', () => {
		expect(ids(track(EVEN, 1), [hit('h3')])).toEqual(['buildUpTo', 'buildEntire']);
	});
});

describe('acceptWords', () => {
	it('names what a press does', () => {
		const project = track(EVEN, 1);
		const open = targetOf(project, [hit('h2')]);
		expect(acceptWords(project, open, 'platform', false)).toBe('Add Platform');
		expect(acceptWords(project, open, 'zigzag', false)).toBe('Add Zigzag · 3 Notes');
		expect(acceptWords(project, targetOf(project, ['p1']), 'staircase', false)).toBe('Change to Staircase · 4 Notes');
		expect(acceptWords(project, targetOf(project, ['p1']), 'remove', true)).toBe('Remove Anyway');
	});
});

describe('causeWords', () => {
	it('says a marble sent past a platform from the piece that sends it, and keeps other words as they are', () => {
		const base = track(EVEN, 2);
		const project = { ...base, track: { ...base.track, pieces: base.track.pieces.map((piece, index) => ({ ...piece, name: `Platform ${index + 1}` })) } };
		const target = targetOf(project, ['p2']);
		const sender = { piece: project.track.pieces[0] as TProject['track']['pieces'][number] };
		expect(causeWords(project, target, sender, { label: 'Missed', detail: 'Marble 1 passes Platform 2 without touching it' })).toBe('Platform 1 sends Marble 1 past Platform 2');
		expect(causeWords(project, target, sender, { label: 'Missed', detail: 'Lands 12 ms before the note' })).toBe('Lands 12 ms before the note');
		expect(causeWords(project, target, null, { label: 'Missed', detail: 'Marble 1 passes Platform 2 without touching it' })).toBe('Marble 1 passes Platform 2 without touching it');
	});
});
