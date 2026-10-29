import { createDemoProject } from './fixtures/sample-project';
import { describe, expect, it } from 'vitest';
import { createProjectHistory } from './history';

describe('createProjectHistory function', () => {
	it('should undo and redo unlinking together with preserving the resolved world position', () => {
		const project = createDemoProject();
		const initial = structuredClone(project);
		const history = createProjectHistory(project);
		history.update((draft) => {
			const object = draft.objects[0];
			if (object == null) throw new Error('Expected a demonstration instrument.');
			object.binding = null;
			object.position = [2, -4, 0.5];
		});
		const unlinked = structuredClone(history.getSnapshot().project);
		expect(unlinked.objects[0]?.binding).toBeNull();
		expect(unlinked.objects[0]?.position).toEqual([2, -4, 0.5]);
		history.undo();
		expect(history.getSnapshot().project).toEqual(initial);
		history.redo();
		expect(history.getSnapshot().project).toEqual(unlinked);
	});

	it('should preserve prior snapshots and clear redo when editing after undo', () => {
		const project = createDemoProject();
		const history = createProjectHistory(project);
		history.update((draft) => {
			draft.name = 'First edit';
		});
		history.update((draft) => {
			draft.name = 'Second edit';
		});
		history.undo();
		expect(history.getSnapshot().canRedo).toBe(true);
		history.update((draft) => {
			draft.name = 'New branch';
		});
		expect(history.getSnapshot().canRedo).toBe(false);
		expect(project.name).toBe('A little momentum');
		history.undo();
		expect(history.getSnapshot().project.name).toBe('First edit');
	});

	it('should avoid recording empty edits or notifying after unsubscribe', () => {
		const history = createProjectHistory(createDemoProject());
		let notifications = 0;
		const unsubscribe = history.subscribe(() => {
			notifications++;
		});
		history.update(() => {});
		expect(history.getSnapshot().canUndo).toBe(false);
		expect(notifications).toBe(0);
		unsubscribe();
		history.update((draft) => {
			draft.name = 'Changed';
		});
		expect(notifications).toBe(0);
	});
});
