import { createDemoProject, createWorldObject } from '../project/fixtures/sample-project';
import { describe, expect, it } from 'vitest';
import { type TProject } from '../project';
import { getNextUnlinkedNote, getNoteTrajectory } from './note-trajectory';

describe('getNoteTrajectory function', () => {
	it('should fit a new harmony note to the marble already playing its track', () => {
		const project = duetProject();
		expect(getNoteTrajectory(project, 'new-note', 'main')).toBe('harmony');
	});
	it('should keep the selected marble when a track has no assigned instruments', () => {
		const project = duetProject();
		project.objects = [];
		expect(getNoteTrajectory(project, 'new-note', 'harmony')).toBe('harmony');
		expect(getNoteTrajectory(project, 'new-note', 'deleted-marble')).toBe('main');
	});
	it('should use the nearest assignment and prefer the preceding note at an equal distance', () => {
		const project = duetProject();
		project.objects.unshift({
			...createWorldObject('bar', [0, 0, 0]),
			binding: { noteId: 'later-note', offset: [0, 0, 0] }
		});
		expect(getNoteTrajectory(project, 'new-note')).toBe('harmony');
		const later = project.notes.find((note) => note.id === 'later-note');
		if (later) later.time = 4.5;
		expect(getNoteTrajectory(project, 'new-note')).toBe('main');
	});
	it('should ignore other tracks and obsolete marble assignments', () => {
		const project = duetProject();
		for (const object of project.objects)
			if (object.marbleId === 'harmony') object.marbleId = 'deleted-marble';
		expect(getNoteTrajectory(project, 'new-note')).toBe('main');
		expect(getNoteTrajectory(project, 'missing-note', 'harmony')).toBe('harmony');
	});
});

describe('getNextUnlinkedNote function', () => {
	it('should continue the same track and skip assigned instruments', () => {
		const project = duetProject();
		expect(getNextUnlinkedNote(project, 'earlier-note')?.id).toBe('new-note');
		project.objects.push({
			...createWorldObject('bar', [0, 0, 0]),
			binding: { noteId: 'new-note', offset: [0, 0, 0] },
			disabled: true
		});
		expect(getNextUnlinkedNote(project, 'earlier-note')?.id).toBe('later-note');
		expect(getNextUnlinkedNote(project, 'later-note')).toBeUndefined();
	});

	it('should include unbuilt simultaneous voices in pitch order without wrapping to earlier notes', () => {
		const project = duetProject();
		project.objects = [];
		const later = project.notes.find((note) => note.id === 'later-note');
		if (later == null) throw new Error('Expected the later voice.');
		later.time = 4;
		project.notes.push({ ...later, id: 'low-voice', midi: 55 });
		expect(getNextUnlinkedNote(project, 'new-note')?.id).toBe('low-voice');
		expect(getNextUnlinkedNote(project, 'missing-note')).toBeUndefined();
		project.notes = project.notes.filter((note) => ['earlier-note', 'new-note'].includes(note.id));
		expect(getNextUnlinkedNote(project, 'new-note')).toBeUndefined();
	});
});

function duetProject(): TProject {
	const project = createDemoProject();
	project.marbles = [{ id: 'harmony', color: '#ffbb33', launch: project.launch }];
	project.notes = [
		{ id: 'earlier-note', trackId: 'duet', time: 2, duration: 0.2, midi: 60, velocity: 0.7 },
		{ id: 'new-note', trackId: 'duet', time: 4, duration: 0.2, midi: 62, velocity: 0.7 },
		{ id: 'later-note', trackId: 'duet', time: 6, duration: 0.2, midi: 64, velocity: 0.7 },
		{ id: 'other-note', trackId: 'other', time: 4, duration: 0.2, midi: 66, velocity: 0.7 }
	];
	project.objects = [
		{
			...createWorldObject('bar', [0, 0, 0]),
			marbleId: 'harmony',
			binding: { noteId: 'earlier-note', offset: [0, 0, 0] }
		},
		{
			...createWorldObject('bar', [0, 0, 0]),
			binding: { noteId: 'other-note', offset: [0, 0, 0] }
		}
	];
	return project;
}
