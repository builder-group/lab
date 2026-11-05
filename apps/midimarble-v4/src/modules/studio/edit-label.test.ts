import { describe, expect, it } from 'vitest';
import { applyProjectCommands, createProject, type TEntity, type TProject, type TProjectCommand } from '@/modules/project';
import { editLabel } from './edit-label';

function platform(id: string): TEntity {
	return { id, name: id, components: { transform: { position: { x: 0, y: 0 }, angle: 0 }, piece: { type: 'platform', params: {} } } } as TEntity;
}

function label(project: TProject, commands: TProjectCommand[]): string | null {
	const [isOk, error, next] = applyProjectCommands(project, commands);
	if (!isOk) throw error;
	return editLabel(project, next, commands);
}

describe('editLabel', () => {
	const empty = createProject();
	const [, , project] = applyProjectCommands(empty, [{ type: 'upsertEntity', entity: platform('a') }, { type: 'upsertEntity', entity: platform('b') }]);
	const base = project as TProject;
	const a = platform('a');

	it('should name adding, moving, tilting and deleting a piece', () => {
		expect(label(empty, [{ type: 'upsertEntity', entity: a }])).toBe('Add Platform');
		expect(label(base, [{ type: 'upsertEntity', entity: { ...a, components: { ...a.components, transform: { position: { x: 1, y: 0 }, angle: 0 } } } }])).toBe('Move Platform');
		expect(label(base, [{ type: 'upsertEntity', entity: { ...a, components: { ...a.components, transform: { position: { x: 0, y: 0 }, angle: 0.3 } } } }])).toBe('Tilt');
		expect(label(base, [{ type: 'removeEntities', entityIds: ['a', 'b'] }])).toBe('Delete 2 Platforms');
	});

	it('should name a rename and the settings of the film', () => {
		expect(label(base, [{ type: 'upsertEntity', entity: { ...a, name: 'Mine' } }])).toBe('Rename Platform');
		expect(label(base, [{ type: 'updateProject', patch: { length: 9 } }])).toBe('Change Length');
		expect(label(base, [{ type: 'updateProject', patch: { gravity: 0.5 } }])).toBe('Change Gravity');
	});
});
