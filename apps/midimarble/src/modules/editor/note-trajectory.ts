import { getProjectMarbles, type TNote, type TProject } from '../project';

/** Uses nearby assignments on the same musical track when fitting a new instrument. */
export function getNoteTrajectory(
	project: TProject,
	noteId: string,
	fallbackMarbleId = 'main'
): string {
	const marbles = new Set(getProjectMarbles(project).map((marble) => marble.id));
	const fallback = marbles.has(fallbackMarbleId) ? fallbackMarbleId : 'main';
	const notes = new Map(project.notes.map((note) => [note.id, note]));
	const target = notes.get(noteId);
	if (target == null) return fallback;
	let owner = fallback;
	let distance = Infinity;
	let nearestTime = Infinity;
	for (const object of project.objects) {
		const note = notes.get(object.binding?.noteId ?? '');
		const marbleId = object.marbleId ?? 'main';
		if (note == null || note.trackId !== target.trackId || !marbles.has(marbleId)) continue;
		const nextDistance = Math.abs(note.time - target.time);
		if (nextDistance < distance || (nextDistance === distance && note.time < nearestTime)) {
			distance = nextDistance;
			nearestTime = note.time;
			owner = marbleId;
		}
	}
	return owner;
}

/** Continues the selected musical voice without rebuilding instruments already assigned to it. */
export function getNextUnlinkedNote(project: TProject, noteId: string): TNote | undefined {
	const current = project.notes.find((note) => note.id === noteId);
	if (current == null) return undefined;
	const assigned = new Set(
		project.objects.flatMap((object) => (object.binding == null ? [] : [object.binding.noteId]))
	);
	return project.notes
		.filter(
			(note) =>
				note.id !== noteId &&
				note.trackId === current.trackId &&
				note.time >= current.time &&
				!assigned.has(note.id)
		)
		.sort((a, b) => a.time - b.time || a.midi - b.midi || a.id.localeCompare(b.id))[0];
}
