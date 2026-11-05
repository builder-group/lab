import { suggestedHitTimes } from '@/modules/music';
import { createId, type TMarble, type TSong } from '@/modules/project';
import type { StudioCx } from './StudioCx';

/** A hit for each beat found in a recording that the marble does not play yet, tied to it */
export interface TSuggestedHit {
	time: number;
	songId: string;
}

/** The project's recordings whose beats are known */
function analyzedRecordings(cx: StudioCx): TSong[] {
	const analysis = cx.sources.$analysis.get();
	return cx.project?.songs.filter((song) => song.kind === 'audio' && song.path != null && analysis[song.id] != null) ?? [];
}

/** The suggestions from every recording, or from one; empty without a recording */
export function suggestedHits(cx: StudioCx, marble: TMarble, songId?: string): TSuggestedHit[] {
	const taken = marble.hits.map((hit) => hit.time);
	return analyzedRecordings(cx)
		.filter((song) => songId == null || song.id === songId)
		.flatMap((song) => {
			const times = suggestedHitTimes(cx.sources.$analysis.get()[song.id]?.onsets ?? [], song.start, taken);
			taken.push(...times);
			return times.map((time) => ({ time, songId: song.id }));
		});
}

export function suggestedHitsLabel(count: number, songName?: string): string {
	return `Add ${count} Suggested ${count === 1 ? 'Hit' : 'Hits'}${songName != null ? ` from ${songName}` : ''}`;
}

export function addSuggestedHits(cx: StudioCx, marble: TMarble, songId?: string): void {
	const hits = suggestedHits(cx, marble, songId).map((hit) => ({ id: createId('hit'), ...hit }));
	if (hits.length > 0) cx.execute([{ type: 'upsertHits', marbleId: marble.id, hits }]);
}

/** One choice per recording that has suggestions, naming it once there are several */
export function suggestedHitChoices(cx: StudioCx, marble: TMarble): { label: string; onSelect: () => void }[] {
	const recordings = analyzedRecordings(cx);
	return recordings.flatMap((song) => {
		const count = suggestedHits(cx, marble, song.id).length;
		if (count === 0) return [];
		return [{ label: suggestedHitsLabel(count, recordings.length > 1 ? song.name : undefined), onSelect: () => addSuggestedHits(cx, marble, song.id) }];
	});
}
