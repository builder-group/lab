import { describe, expect, it } from 'vitest';
import { applyProjectCommands } from './commands';
import { createProject } from './create-project';
import { amendHistory, createHistory, pushHistory, redoHistory, undoHistory, type TProjectHistory } from './history';
import type { TPiece, TProject } from './schema';

describe('history groups', () => {
	it('should make each push its own undo step, named by its revision', () => {
		// Prepare
		const base = createProject();

		// Act
		const history = edit(edit(createHistory(base), piece('a')), piece('b'));

		// Assert
		expect(history.past).toHaveLength(2);
		expect(history.groups.present).toBe(history.present.revision);
		expect(history.groups.past).toEqual([0, 1]);
	});

	it('should fold commands of the same group into one undo step', () => {
		// Prepare
		const placed = edit(createHistory(createProject()), piece('windmill'));
		const group = placed.groups.present;

		// Act
		const anchored = edit(placed, { ...piece('windmill'), name: 'Anchored' }, group);
		const undone = undoHistory(anchored);

		// Assert
		expect(anchored.past).toHaveLength(1);
		expect(anchored.groups.present).toBe(group);
		expect(ids(undone.present)).not.toContain('windmill');
	});

	it('should start a new step when another edit came between the group and its next commands', () => {
		// Prepare
		const placed = edit(createHistory(createProject()), piece('windmill'));
		const group = placed.groups.present;
		const other = edit(placed, piece('platform'));

		// Act
		const late = edit(other, { ...piece('windmill'), name: 'Anchored' }, group);
		const undone = undoHistory(late);

		// Assert
		expect(late.past).toHaveLength(3);
		expect(ids(undone.present).slice(-2)).toEqual(['windmill', 'platform']);
		expect(undone.present.track.pieces.find((piece) => piece.id === 'windmill')?.name).toBe('windmill');
	});

	it('should keep the group through an amend, which changes the revision', () => {
		// Prepare
		const placed = edit(createHistory(createProject()), piece('a'));
		const group = placed.groups.present;
		const [, , refined] = applyProjectCommands(placed.present, [{ type: 'addPiece', piece: { ...piece('a'), name: 'Refined' } }]);

		// Act
		const amended = amendHistory(placed, refined as TProject);

		// Assert
		expect(amended.present.revision).not.toBe(placed.present.revision);
		expect(amended.groups.present).toBe(group);
		expect(ids(undoHistory(amended).present)).not.toContain('a');
	});

	it('should carry the groups through undo and redo', () => {
		// Prepare
		const first = edit(createHistory(createProject()), piece('a'));
		const second = edit(first, piece('b'));

		// Act
		const undone = undoHistory(second);
		const redone = redoHistory(undone);

		// Assert
		expect(undone.groups.present).toBe(first.groups.present);
		expect(undone.groups.future).toEqual([second.groups.present]);
		expect(redone.groups.present).toBe(second.groups.present);
		expect(redone.groups.past).toEqual([0, first.groups.present]);
	});
});

function ids(project: TProject): string[] {
	return project.track.pieces.map((piece) => piece.id);
}

function piece(id: string): TPiece {
	return { id, name: id, type: 'platform', params: {}, angle: 0, place: { kind: 'free', position: { x: 0, y: 0 } } };
}

function edit(history: TProjectHistory, piece: TPiece, group?: number): TProjectHistory {
	const [isOk, error, next] = applyProjectCommands(history.present, [{ type: 'addPiece', piece }]);
	if (!isOk) throw error;
	return pushHistory(history, next, group);
}
