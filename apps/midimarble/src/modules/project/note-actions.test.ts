import { describe, expect, it } from 'vitest';
import { createDemoProject } from './fixtures/sample-project';
import { createProjectHistory } from './history';
import { addProjectNotes, deleteProjectNotes, updateProjectNotes } from './note-actions';
import type { TNote } from './types';

describe('project note actions', () => {
	it('should update a phrase in one undo step while retaining note identities', () => {
		const project = createDemoProject();
		const selected = project.notes.slice(0, 2);
		const original = structuredClone(project);
		const history = createProjectHistory(project);

		history.update((draft) =>
			updateProjectNotes(
				draft,
				selected.map((note) => ({
					id: note.id,
					patch: { id: 'unintended-id', midi: note.midi + 12, time: note.time + 0.1 }
				}))
			)
		);

		for (const note of selected) {
			const updated = history.getSnapshot().project.notes.find((item) => item.id === note.id);
			expect(updated?.midi).toBe(note.midi + 12);
			expect(updated?.time).toBeCloseTo(note.time + 0.1);
		}
		history.undo();
		expect(history.getSnapshot().project).toEqual(original);
	});

	it('should protect the entire deletion when a linked instrument is locked', () => {
		const project = createDemoProject();
		const notes = project.notes.slice(0, 2);
		const linked = project.objects.find((object) => object.binding?.noteId === notes[0]?.id);
		if (linked == null) throw new Error('Expected a linked demonstration instrument.');
		linked.locked = true;
		const original = structuredClone(project);

		expect(
			deleteProjectNotes(
				project,
				notes.map((note) => note.id)
			)
		).toBe(false);
		expect(project).toEqual(original);
		linked.locked = false;
		expect(
			deleteProjectNotes(
				project,
				notes.map((note) => note.id)
			)
		).toBe(true);
		expect(project.notes.some((note) => notes.some((selected) => selected.id === note.id))).toBe(
			false
		);
		expect(
			project.objects.some((object) => notes.some((note) => object.binding?.noteId === note.id))
		).toBe(false);
	});

	it('should add a duplicate phrase atomically and own its saved values', () => {
		const project = createDemoProject();
		const originals = structuredClone(project.notes);
		const phrase = project.notes.slice(0, 2).map((note) => ({ ...note, id: `copy-${note.id}` }));
		const history = createProjectHistory(project);

		history.update((draft) => expect(addProjectNotes(draft, phrase)).toBeNull());
		const firstCopy = phrase[0];
		if (firstCopy == null) throw new Error('Expected a copied note.');
		firstCopy.midi = 127;

		expect(history.getSnapshot().project.notes).toHaveLength(originals.length + 2);
		expect(history.getSnapshot().project.notes.at(-2)?.midi).toBe(originals[0]?.midi);
		history.undo();
		expect(history.getSnapshot().project.notes).toEqual(originals);
	});

	it('should reject a whole phrase when it exceeds capacity or contains a duplicate identity', () => {
		const project = createDemoProject();
		const note = project.notes[0];
		if (note == null) throw new Error('Expected a demonstration note.');
		project.notes = Array.from({ length: 1999 }, (_, index) => ({
			...note,
			id: `existing-${index}`
		}));
		const original = structuredClone(project);
		const phrase: TNote[] = [
			{ ...note, id: 'new-a' },
			{ ...note, id: 'new-b' }
		];

		expect(addProjectNotes(project, phrase)).toContain('2,000');
		expect(project).toEqual(original);
		expect(addProjectNotes(project, [{ ...note, id: 'existing-0' }])).not.toBeNull();
		expect(project).toEqual(original);
	});

	it('should ignore invalid numeric edits and keep a moved note inside the score', () => {
		const project = createDemoProject();
		const note = project.notes[0];
		if (note == null) throw new Error('Expected a demonstration note.');
		const original = structuredClone(note);

		updateProjectNotes(project, [{ id: note.id, patch: { time: NaN } }]);
		expect(note).toEqual(original);
		updateProjectNotes(project, [
			{ id: note.id, patch: { time: project.duration + 10, midi: 150 } }
		]);
		expect(note.time + note.duration).toBeCloseTo(project.duration);
		expect(note.midi).toBe(127);
	});
});
