import { describe, expect, it } from 'vitest';
import { createExampleProject } from '../modules/project/example-projects';
import { composeProject } from './compose-project';

describe('composeProject function', () => {
	it('should create a new editable composition with verified physical contacts', async () => {
		const input = createExampleProject('first-light');
		const snapshot = structuredClone(input);
		const { project, performance } = await composeProject(input);
		expect(project.id).not.toBe(input.id);
		expect(project.notes).toEqual(input.notes);
		expect(project.scene?.wallPosition).toBe(0);
		expect(project.launch.position[2]).toBe(0.65);
		expect(project.objects.every((object) => object.binding != null)).toBe(true);
		expect(project.objects).toEqual(performance.objects);
		expect(
			performance.noteMarkers.every(
				(marker) => marker.error != null && Math.abs(marker.error) <= 1 / 60
			)
		).toBe(true);
		expect(input).toEqual(snapshot);
	});

	it('should require a track choice and copy only the selected musical track', async () => {
		const input = createExampleProject('counterpoint');
		await expect(composeProject(input)).rejects.toThrow('Choose one monophonic track');
		const { project } = await composeProject(input, 'melody');
		expect(project.tracks.map((track) => track.id)).toEqual(['melody']);
		expect(project.notes).toEqual(input.notes.filter((note) => note.trackId === 'melody'));
		expect(project.marbles).toBeUndefined();
	});

	it('should reject long scores and overlapping notes before creating a draft', async () => {
		const input = createExampleProject('first-light');
		await expect(composeProject({ ...input, duration: 21 })).rejects.toThrow('up to 20 seconds');
		const first = input.notes[0];
		if (first == null) throw new Error('The fixture needs a first note.');
		input.notes.push({ ...first, id: 'simultaneous', midi: 60 });
		await expect(composeProject(input)).rejects.toThrow('non-overlapping notes');
	});

	it('should reject a physically unplayable phrase with a timing diagnostic', async () => {
		const input = createExampleProject('first-light');
		input.notes = input.notes.map((note, index) => ({
			...note,
			time: 0.8 + index * 0.08,
			duration: 0.04
		}));
		await expect(composeProject(input)).rejects.toThrow('did not pass physical verification');
	});
});
