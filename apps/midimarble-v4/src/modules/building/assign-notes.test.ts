import { beforeAll, describe, expect, it } from 'vitest';
import { BACKING_ID, backingOf, tieOf } from '@/modules/project';
import { createSimulator, type TSimulator } from '@/modules/simulation';
import { assignNotesCommands, newMarbleCommands } from './assign-notes';
import { apply, loadFixture } from '@/modules/project/test-helpers';

describe('assignNotesCommands function', () => {
	let simulator: TSimulator;

	beforeAll(async () => {
		simulator = await createSimulator();
	});

	it('should remove the platform of a note handed to Backing', () => {
		const project = loadFixture('two-marbles');
		const result = simulator.simulate(project);

		const next = apply(project, assignNotesCommands(project, result, ['hit-1-2'], BACKING_ID));

		expect(backingOf(next).map((hit) => hit.id)).toEqual(['hit-1-2']);
		expect(next.marbles[0]?.hits.map((hit) => hit.id)).toEqual(['hit-1-1', 'hit-1-3']);
		expect(next.track.pieces.some((item) => item.id === 'piece-1-2')).toBe(false);
		// The other hits keep their platforms and timing
		expect(simulator.simulate(next).hits.filter((hit) => hit.marbleId === 'marble-1').map((hit) => hit.status)).toEqual(['onTime', 'onTime']);
	});

	it('should take the platform along when a note goes to another marble and back again', () => {
		const project = loadFixture('two-marbles');
		const result = simulator.simulate(project);

		const moved = apply(project, assignNotesCommands(project, result, ['hit-1-3'], 'marble-2'));
		const movedResult = simulator.simulate(moved);
		const back = apply(moved, assignNotesCommands(moved, movedResult, ['hit-1-3'], 'marble-1'));

		expect(tieOf(moved.track.pieces.find((item) => item.id === 'piece-1-3'))).toMatchObject({ marbleId: 'marble-2', hitId: 'hit-1-3' });
		expect(movedResult.hits.find((hit) => hit.hitId === 'hit-1-3')?.marbleId).toBe('marble-2');
		expect(back.marbles[0]?.hits.map((hit) => hit.id)).toEqual(['hit-1-1', 'hit-1-2', 'hit-1-3']);
		expect(tieOf(back.track.pieces.find((item) => item.id === 'piece-1-3'))).toMatchObject({ marbleId: 'marble-1', hitId: 'hit-1-3' });
		expect(simulator.simulate(back).hits.every((hit) => hit.status === 'onTime')).toBe(true);
	});

	it('should keep a following piece at its moment, tied to another hit of the marble', () => {
		const project = loadFixture('long-gap');
		const result = simulator.simulate(project);
		const melody = project.marbles[0];
		const follower = project.track.pieces.find((piece) => piece.id === 'rail-1');
		const hitId = tieOf(follower)?.hitId ?? '';
		if (melody == null || follower == null) throw new Error('No rail');
		const before = result.pieces.find((piece) => piece.pieceId === follower.id);

		const next = apply(project, assignNotesCommands(project, result, [hitId], BACKING_ID));
		const link = tieOf(next.track.pieces.find((piece) => piece.id === follower.id));
		const after = simulator.simulate(next).pieces.find((piece) => piece.pieceId === follower.id);

		// The platform before the rail goes with its note, so the run changes; the rail keeps its moment
		expect(link).toBeDefined();
		expect(link?.hitId).not.toBe(hitId);
		expect(melody.hits.some((hit) => hit.id === link?.hitId)).toBe(true);
		expect(after?.entryTime).toBeCloseTo(before?.entryTime ?? NaN, 6);
	}, 20_000);

	it('should do nothing for notes already in place', () => {
		const project = loadFixture('two-marbles');
		expect(assignNotesCommands(project, null, ['hit-1-1'], 'marble-1')).toEqual([]);
	});

	it('should give a new marble the notes in one edit', () => {
		const project = loadFixture('two-marbles');
		const { marbleId, commands } = newMarbleCommands(project, 2);
		const next = apply(project, [...commands, ...assignNotesCommands(project, simulator.simulate(project), ['hit-2-3'], marbleId)]);

		expect(next.revision).toBe(project.revision + 1);
		expect(next.marbles.find((marble) => marble.id === marbleId)?.hits.map((hit) => hit.id)).toEqual(['hit-2-3']);
		expect(next.marbles.some((marble) => marble.id === marbleId)).toBe(true);
	});
});
