import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyProjectCommands, BACKING_ID, parseProject, type TProject, type TProjectCommand } from '@/modules/project';
import { createSimulator, type TSimulator } from '@/modules/simulation/simulate';
import { assignNotesCommands, newMarbleCommands } from './assign-notes';

function loadFixture(name: string): TProject {
	const json = readFileSync(new URL(`../../../fixtures/${name}.marble.json`, import.meta.url), 'utf8');
	const [isProjectOk, projectErr, project] = parseProject(json);
	if (!isProjectOk) throw projectErr;
	return project;
}

function apply(project: TProject, commands: TProjectCommand[]): TProject {
	const [isApplied, applyErr, next] = applyProjectCommands(project, commands);
	if (!isApplied) throw applyErr;
	return next;
}

describe('assignNotesCommands function', () => {
	let simulator: TSimulator;

	beforeAll(async () => {
		simulator = await createSimulator();
	});

	it('should remove the platform of a note handed to Backing', () => {
		const project = loadFixture('two-marbles');
		const result = simulator.simulate(project);

		const next = apply(project, assignNotesCommands(project, result, ['hit-1-2'], BACKING_ID));

		expect(next.music.backing.map((hit) => hit.id)).toEqual(['hit-1-2']);
		expect(next.music.lanes[0]?.hits.map((hit) => hit.id)).toEqual(['hit-1-1', 'hit-1-3']);
		expect(next.entities.some((item) => item.id === 'piece-1-2')).toBe(false);
		// The other hits keep their platforms and timing
		expect(simulator.simulate(next).hits.filter((hit) => hit.laneId === 'lane-1').map((hit) => hit.status)).toEqual(['onTime', 'onTime']);
	});

	it('should take the platform along when a note goes to another marble and back again', () => {
		const project = loadFixture('two-marbles');
		const result = simulator.simulate(project);

		const moved = apply(project, assignNotesCommands(project, result, ['hit-1-3'], 'lane-2'));
		const movedResult = simulator.simulate(moved);
		const back = apply(moved, assignNotesCommands(moved, movedResult, ['hit-1-3'], 'lane-1'));

		expect(moved.entities.find((item) => item.id === 'piece-1-3')?.components.hitLink).toMatchObject({ laneId: 'lane-2', hitId: 'hit-1-3' });
		expect(movedResult.hits.find((hit) => hit.hitId === 'hit-1-3')?.laneId).toBe('lane-2');
		expect(back.music.lanes[0]?.hits.map((hit) => hit.id)).toEqual(['hit-1-1', 'hit-1-2', 'hit-1-3']);
		expect(back.entities.find((item) => item.id === 'piece-1-3')?.components.hitLink).toMatchObject({ laneId: 'lane-1', hitId: 'hit-1-3' });
		expect(simulator.simulate(back).hits.every((hit) => hit.status === 'onTime')).toBe(true);
	});

	it('should keep a following piece at its moment, tied to another hit of the lane', () => {
		const project = loadFixture('jingle-bells');
		const result = simulator.simulate(project);
		const melody = project.music.lanes[0];
		const switchback = project.entities.find((entity) => entity.id === 'switchback-1-5');
		const hitId = switchback?.components.hitLink?.hitId ?? '';
		if (melody == null || switchback == null) throw new Error('No switchback');
		const before = result.pieces.find((piece) => piece.entityId === switchback.id);

		const next = apply(project, assignNotesCommands(project, result, [hitId], BACKING_ID));
		const link = next.entities.find((entity) => entity.id === switchback.id)?.components.hitLink;
		const after = simulator.simulate(next).pieces.find((piece) => piece.entityId === switchback.id);

		// The platform before the switchback goes with its note, so the run changes; the switchback keeps its moment
		expect(link).toBeDefined();
		expect(link?.hitId).not.toBe(hitId);
		expect(melody.hits.some((hit) => hit.id === link?.hitId)).toBe(true);
		expect(after?.entryTime).toBeCloseTo(before?.entryTime ?? NaN, 6);
	}, 20_000);

	it('should do nothing for notes already in place', () => {
		const project = loadFixture('two-marbles');
		expect(assignNotesCommands(project, null, ['hit-1-1'], 'lane-1')).toEqual([]);
	});

	it('should give a new marble the notes in one edit', () => {
		const project = loadFixture('two-marbles');
		const { laneId, commands } = newMarbleCommands(project, 2);
		const next = apply(project, [...commands, ...assignNotesCommands(project, simulator.simulate(project), ['hit-2-3'], laneId)]);

		expect(next.revision).toBe(project.revision + 1);
		expect(next.music.lanes.find((lane) => lane.id === laneId)?.hits.map((hit) => hit.id)).toEqual(['hit-2-3']);
		expect(next.entities.some((entity) => entity.components.marble?.laneId === laneId)).toBe(true);
	});
});
