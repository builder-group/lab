import type { TImpact, TNote, TNoteMarker, TPerformance, TResolvedObject } from '../project/types';
import { samplePerformance } from './sample-performance';

/** Projects the music onto an existing bake without rebuilding its physical world. */
export function createNoteMarkers(
	notes: readonly TNote[],
	performance: TPerformance,
	until = performance.duration
): TNoteMarker[] {
	const objects = new Map<string, TResolvedObject>();
	for (const object of performance.objects)
		if (!object.disabled && object.binding != null && !objects.has(object.binding.noteId))
			objects.set(object.binding.noteId, object);
	const impacts = new Map<string, TImpact[]>();
	for (const impact of performance.impacts) {
		const events = impacts.get(impact.objectId) ?? [];
		events.push(impact);
		impacts.set(impact.objectId, events);
	}
	const voices = new Map(
		(performance.additionalMarbles ?? []).map((track) => [
			track.id,
			{ ...performance, samples: track.samples }
		])
	);
	return notes
		.filter((note) => note.time >= 0 && note.time <= until)
		.map((note) => {
			const object = objects.get(note.id);
			let nearest: TImpact | undefined;
			for (const impact of impacts.get(object?.id ?? '') ?? []) {
				if (impact.noteId !== note.id) continue;
				if (
					nearest == null ||
					Math.abs(impact.time - note.time) < Math.abs(nearest.time - note.time)
				)
					nearest = impact;
			}
			const voice =
				object?.marbleId == null ? performance : (voices.get(object.marbleId) ?? performance);
			return {
				noteId: note.id,
				time: note.time,
				position: samplePerformance(voice, note.time).position,
				objectId: object?.id ?? null,
				error: nearest == null ? null : nearest.time - note.time
			};
		});
}
