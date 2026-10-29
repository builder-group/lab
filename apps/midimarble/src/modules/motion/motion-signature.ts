import type { TProject } from '../project/types';

/** Identifies the inputs used by the physical solver, independently of sound and presentation. */
export function getMotionSignature(project: TProject): string {
	const linkedNotes = new Set(
		project.objects.flatMap((object) => object.binding != null && !object.disabled ? [object.binding.noteId] : [])
	);
	return JSON.stringify([
		'rapier-240hz-6-1-v2',
		project.duration,
		project.notes.filter((note) => linkedNotes.has(note.id)).map(({ id, time }) => [id, time]),
		project.objects.map((object) => [
			object.id,
			object.kind,
			object.marbleId ?? 'main',
			object.binding == null ? null : [object.binding.noteId, object.binding.offset],
			object.trajectoryAnchor ?? null,
			object.position,
			object.rotation,
			object.size,
			object.restitution,
			object.path ?? null,
			object.disabled ?? false,
			...(object.friction == null ? [] : [object.friction]),
			...(object.kind === 'bar' && object.mountStyle === 'folded-front' ? ['folded-front'] : [])
		]),
		[project.launch.position, project.launch.velocity, project.launch.radius],
		(project.marbles ?? []).map(({ id, launch, startTime }) => [id, launch, startTime ?? 0]),
		project.gravity,
		project.restitution
	]);
}
