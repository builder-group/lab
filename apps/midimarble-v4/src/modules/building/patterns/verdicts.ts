import type { TSimulationResult } from '@/modules/simulation';
import type { THitVerdict, TPatternMoment } from './contract';
import { sampleAt } from './fit-bars';

/** A verdict for every hit: the first thing said about it, and a verdict that doesn't fit before one that does */
export function verdictsFor(hits: readonly { id: string }[], said: readonly THitVerdict[]): THitVerdict[] {
	return hits.map((hit) => {
		const about = said.filter((item) => item.hitId === hit.id);
		return about.find((item) => !item.fits) ?? about[0] ?? { hitId: hit.id, fits: true, words: null };
	});
}

/** How the marble moves at this time on a run */
export function exitAt(result: TSimulationResult, marbleId: string, time: number): TPatternMoment | null {
	const sample = sampleAt(result.marbles.find((marble) => marble.marbleId === marbleId)?.samples ?? [], time - 1e-6);
	return sample == null ? null : { position: sample.position, velocity: sample.velocity, time: sample.time };
}
