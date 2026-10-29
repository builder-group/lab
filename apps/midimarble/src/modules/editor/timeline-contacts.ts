import type { TImpact, TNoteMarker, TPerformance } from '../project';

/** Keeps note alignment separate from additional bounces in the physical world. */
export function summarizeTimelineContacts(
	performance: Pick<TPerformance, 'impacts' | 'noteMarkers'>
) {
	const linked = performance.noteMarkers.filter((marker) => marker.objectId != null);
	const markers = new Map(performance.noteMarkers.map((marker) => [marker.noteId, marker]));
	let recontacts = 0;
	let extra = 0;
	for (const impact of performance.impacts) {
		const marker = impact.noteId == null ? undefined : markers.get(impact.noteId);
		const kind = classifyTimelineContact(impact, marker?.time, marker);
		if (kind === 'recontact') recontacts++;
		if (kind === 'extra') extra++;
	}
	return {
		linked: linked.length,
		aligned: linked.filter((marker) => marker.error != null && Math.abs(marker.error) < 0.035)
			.length,
		unlinked: performance.noteMarkers.length - linked.length,
		recontacts,
		extra
	};
}

/** Matches the assigned note contact; subsequent bounces do not retime pitched MIDI audio. */
export function classifyTimelineContact(
	impact: TImpact,
	noteTime: number | undefined,
	marker: TNoteMarker | undefined
): 'primary' | 'recontact' | 'extra' | 'world' {
	if (impact.noteId == null) return 'world';
	if (
		noteTime == null ||
		marker?.error == null ||
		marker.noteId !== impact.noteId ||
		marker.objectId !== impact.objectId
	)
		return 'extra';
	const delta = impact.time - (noteTime + marker.error);
	if (Math.abs(delta) <= 1e-6) return 'primary';
	return delta > 0 ? 'recontact' : 'extra';
}
