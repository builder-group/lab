import { suggestedHitTimes } from '@/modules/music';
import { createId, type TLane } from '@/modules/project';
import type { StudioCx } from './StudioCx';

/** A hit for each beat found in the recording that the marble does not play yet; empty without a recording */
export function suggestedHits(cx: StudioCx, marble: TLane): number[] {
	const audio = cx.project?.music.sources.find((source) => source.kind === 'audio');
	const onsets = audio == null ? undefined : cx.sources.$analysis.get()[audio.id]?.onsets;
	if (audio == null || onsets == null) return [];
	return suggestedHitTimes(
		onsets,
		audio.offset,
		marble.hits.map((hit) => hit.time)
	);
}

export function suggestedHitsLabel(count: number): string {
	return `Add ${count} Suggested ${count === 1 ? 'Hit' : 'Hits'}`;
}

export function addSuggestedHits(cx: StudioCx, marble: TLane): void {
	const hits = suggestedHits(cx, marble).map((time) => ({ id: createId('hit'), time }));
	if (hits.length > 0) cx.execute([{ type: 'upsertHits', marbleId: marble.id, hits }]);
}
