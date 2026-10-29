import type { TNote, TProject } from './types';

/** Applies an editor gesture to a history draft without changing note identities. */
export function updateProjectNotes(project: TProject, updates: TNoteUpdate[]): void {
	const patches = new Map(updates.map(({ id, patch }) => [id, patch]));
	for (const note of project.notes) {
		const patch = patches.get(note.id);
		if (patch == null) continue;
		const next = { ...note, ...patch, id: note.id };
		if (!validNoteNumbers(next) || !project.tracks.some((track) => track.id === next.trackId))
			continue;
		next.midi = Math.min(127, Math.max(0, Math.round(next.midi)));
		next.velocity = Math.min(1, Math.max(0, next.velocity));
		next.time = Math.max(
			0,
			Math.min(
				project.duration - (patch.time != null && patch.duration == null ? next.duration : 0.001),
				next.time
			)
		);
		next.duration = Math.max(0.001, Math.min(project.duration - next.time, next.duration));
		Object.assign(note, next);
	}
}

export interface TNoteUpdate {
	id: string;
	patch: Partial<TNote>;
}

/** A locked linked instrument protects its note; group deletion is all or nothing. */
export function deleteProjectNotes(project: TProject, ids: readonly string[]): boolean {
	const selected = new Set(ids);
	if (project.objects.some((object) => object.locked && selected.has(object.binding?.noteId ?? '')))
		return false;
	project.notes = project.notes.filter((note) => !selected.has(note.id));
	project.objects = project.objects.filter((object) => !selected.has(object.binding?.noteId ?? ''));
	return true;
}

/** Adds a phrase atomically, so a full project never accepts only part of a duplicate. */
export function addProjectNotes(project: TProject, notes: TNote[]): string | null {
	if (project.notes.length + notes.length > 2000)
		return 'This phrase would exceed the 2,000 note limit.';
	const ids = new Set(project.notes.map((note) => note.id));
	for (const note of notes) {
		if (
			!note.id ||
			ids.has(note.id) ||
			!validNoteNumbers(note) ||
			!project.tracks.some((track) => track.id === note.trackId) ||
			!Number.isInteger(note.midi) ||
			note.midi < 0 ||
			note.midi > 127 ||
			note.velocity < 0 ||
			note.velocity > 1 ||
			note.time < 0 ||
			note.duration < 0.001 ||
			note.time + note.duration > project.duration + 1e-9
		)
			return 'The phrase must fit inside the project and use an existing music track.';
		ids.add(note.id);
	}
	project.notes.push(...structuredClone(notes));
	return null;
}

function validNoteNumbers(note: TNote): boolean {
	return [note.time, note.duration, note.midi, note.velocity].every(Number.isFinite);
}
