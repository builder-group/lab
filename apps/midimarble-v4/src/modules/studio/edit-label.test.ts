import { describe, expect, it } from 'vitest';
import { applyProjectCommands, createProject, type TPiece, type TProject, type TProjectCommand } from '@/modules/project';
import { editLabel } from './edit-label';

function platform(id: string): TPiece {
	return { id, name: id, type: 'platform', params: {}, angle: 0, place: { kind: 'free', position: { x: 0, y: 0 } } } as TPiece;
}

function label(project: TProject, commands: TProjectCommand[]): string | null {
	const [isOk, error, next] = applyProjectCommands(project, commands);
	if (!isOk) throw error;
	return editLabel(project, next, commands);
}

describe('editLabel', () => {
	const empty = createProject();
	const [, , project] = applyProjectCommands(empty, [{ type: 'addPiece', piece: platform('a') }, { type: 'addPiece', piece: platform('b') }]);
	const base = project as TProject;
	const a = platform('a');

	it('should name adding, moving, tilting and deleting a piece', () => {
		expect(label(empty, [{ type: 'addPiece', piece: a }])).toBe('Add Platform');
		expect(label(base, [{ type: 'addPiece', piece: { ...a, place: { kind: 'free', position: { x: 1, y: 0 } } } }])).toBe('Move Platform');
		expect(label(base, [{ type: 'addPiece', piece: { ...a, angle: 0.3 } }])).toBe('Tilt');
		expect(label(base, [{ type: 'removePieces', pieceIds: ['a', 'b'] }])).toBe('Delete 2 Platforms');
	});

	it('should name a rename and the settings of the film', () => {
		expect(label(base, [{ type: 'addPiece', piece: { ...a, name: 'Mine' } }])).toBe('Rename Platform');
		expect(label(base, [{ type: 'updateProject', patch: { length: 9 } }])).toBe('Change Length');
		expect(label(base, [{ type: 'updateProject', patch: { gravity: 0.5 } }])).toBe('Change Gravity');
	});
});
