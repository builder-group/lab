import { describe, expect, it } from 'vitest';
import { applyProjectCommands } from './commands';
import { createProject } from './create-project';
import { createHistory, pushHistory, redoHistory, undoHistory } from './history';
import { parseProject, serializeProject } from './project-file';
import type { TProject } from './schema';

function firstLaneId(project: TProject): string {
	const lane = project.music.lanes[0];
	if (lane == null) throw new Error('Missing lane');
	return lane.id;
}

describe('project document', () => {
	it('round-trips through JSON', () => {
		const project = createProject({ title: 'Song' });
		const [isParsedOk, parsedErr, parsed] = parseProject(serializeProject(project));
		expect(parsedErr).toBeUndefined();
		expect(isParsedOk).toBe(true);
		expect(parsed).toEqual(project);
	});

	it('rejects unknown versions and malformed files', () => {
		const project = createProject();
		expect(parseProject(JSON.stringify({ ...project, $schema: 'marble-project@99' }))[0]).toBe(false);
		expect(parseProject('{nope')[0]).toBe(false);
		expect(parseProject(JSON.stringify({ ...project, extra: true }))[0]).toBe(false);
	});
});

describe('commands', () => {
	it('applies a batch as one revision and keeps hits sorted', () => {
		const project = createProject();
		const laneId = firstLaneId(project);
		const [isEditOk, editErr, edited] = applyProjectCommands(project, [
			{ type: 'upsertHits', laneId, hits: [{ id: 'b', time: 2 }] },
			{ type: 'upsertHits', laneId, hits: [{ id: 'a', time: 1 }] },
			{ type: 'setTitle', title: 'Renamed' }
		]);
		expect(editErr).toBeUndefined();
		expect(isEditOk).toBe(true);
		expect(edited?.revision).toBe(project.revision + 1);
		expect(edited?.music.lanes[0]?.hits.map((hit) => hit.id)).toEqual(['a', 'b']);
		expect(project.music.lanes[0]?.hits).toEqual([]);
	});

	it('leaves the source untouched when a batch is invalid', () => {
		const project = createProject();
		const [isEditOk] = applyProjectCommands(project, [
			{ type: 'setTitle', title: 'Changed' },
			{ type: 'upsertHits', laneId: 'missing', hits: [] }
		]);
		expect(isEditOk).toBe(false);
		expect(project.title).toBe('Untitled');

		const [isNegativeOk] = applyProjectCommands(project, [
			{ type: 'upsertHits', laneId: firstLaneId(project), hits: [{ id: 'x', time: -1 }] }
		]);
		expect(isNegativeOk).toBe(false);
	});

	it('sets and removes components', () => {
		const project = createProject();
		const entity = project.entities[0];
		if (entity == null) throw new Error('Missing marble');
		const [, , withPiece] = applyProjectCommands(project, [
			{
				type: 'setComponent',
				entityId: entity.id,
				component: { name: 'transform', value: { position: { x: 1, y: 2 }, angle: 0.1 } }
			}
		]);
		expect(withPiece?.entities[0]?.components.transform?.position.x).toBe(1);
		const [, , without] = applyProjectCommands(withPiece as TProject, [
			{ type: 'removeComponent', entityId: entity.id, name: 'transform' }
		]);
		expect(without?.entities[0]?.components.transform).toBeUndefined();
	});

	it('removes the marble of a removed lane', () => {
		const project = createProject();
		const [, , edited] = applyProjectCommands(project, [
			{ type: 'removeLane', laneId: firstLaneId(project) }
		]);
		expect(edited?.music.lanes).toEqual([]);
		expect(edited?.entities).toEqual([]);
	});
});

describe('history', () => {
	it('undoes and redoes with increasing revisions', () => {
		const project = createProject();
		const [, , renamed] = applyProjectCommands(project, [{ type: 'setTitle', title: 'A' }]);
		let history = pushHistory(createHistory(project), renamed as TProject);
		history = undoHistory(history);
		expect(history.present.title).toBe('Untitled');
		expect(history.present.revision).toBe(2);
		history = redoHistory(history);
		expect(history.present.title).toBe('A');
		expect(history.present.revision).toBe(3);
	});
});
