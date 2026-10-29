import type { TNote, TObjectKind, TProject, TSceneObject, TVec3 } from '../types';

export function createDemoProject(): TProject {
	const pitches = [
		72, 76, 79, 83, 81, 79, 76, 74, 72, 76, 79, 84, 83, 79, 76, 74, 72, 74, 76, 79, 76, 74, 72
	];
	const notes: TNote[] = pitches.map((midi, index) => ({
		id: `note-${index}`,
		trackId: 'melody',
		midi,
		time: 0.85 + index * 0.72,
		duration: 0.48,
		velocity: index % 4 === 0 ? 0.88 : 0.7
	}));
	const project: TProject = {
		version: 1,
		id: crypto.randomUUID(),
		name: 'A little momentum',
		bpm: 83.333333,
		duration: 18,
		notes,
		tracks: [{ id: 'melody', name: 'The melody', color: '#9675dc', instrument: 12, muted: false }],
		objects: [],
		launch: { position: [0, 4, 0], velocity: [1.1, -0.4, 0], radius: 0.24 },
		gravity: 9.81,
		restitution: 0.35,
		aspectRatio: '9:16',
		marbleColor: '#34896c'
	};
	project.objects = notes.map((note, index) => {
		const object = createObjectForNote(project, note.id, index % 6 === 4 ? 'drum' : 'bar', index);
		return object;
	});
	return project;
}

export function createObjectForNote(
	project: TProject,
	noteId: string,
	kind: TObjectKind = 'bar',
	index = project.objects.length
): TSceneObject {
	const note = project.notes.find((item) => item.id === noteId);
	return {
		id: crypto.randomUUID(),
		name: `${objectNames[kind]} ${index + 1}`,
		kind,
		binding: { noteId, offset: [0, 0, 0] },
		position: [0, 0, 0],
		rotation: [0, 0, (index % 2 === 0 ? 1 : -1) * 0.72],
		size:
			kind === 'drum'
				? [1.8, 0.28, 1.4]
				: kind === 'bumper'
					? [0.65, 0.65, 0.65]
					: [2.15 + ((note?.midi ?? 72) - 72) * 0.035, 0.16, 0.72],
		restitution: project.restitution,
		material: kind === 'bar' ? 'wood' : 'metal'
	};
}

export function createWorldObject(kind: TObjectKind, position: TVec3): TSceneObject {
	return {
		id: crypto.randomUUID(),
		name: kind === 'bar' ? 'Resonator key' : kind === 'bowl' ? 'Bowl' : objectNames[kind],
		kind,
		binding: null,
		position,
		rotation: [0, 0, 0.18],
		size:
			kind === 'rail'
				? [3.6, 0.14, 0.9]
				: kind === 'bumper'
					? [0.65, 0.65, 0.65]
					: [2.2, 0.2, 0.85],
		restitution: kind === 'bumper' ? 0.96 : 0.65,
		material: kind === 'bar' ? 'wood' : 'metal'
	};
}

const objectNames: Record<TObjectKind, string> = {
	bar: 'Marimba bar',
	rail: 'Twin rail',
	bowl: 'Resonator',
	bumper: 'Bumper',
	drum: 'Steel pan'
};
