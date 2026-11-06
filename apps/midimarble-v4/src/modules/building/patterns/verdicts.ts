import type { TSimulationResult } from '@/modules/simulation';
import type { THitVerdict, TPatternMoment } from './contract';
import { sampleAt } from './fit-bars';

/** A verdict for every hit: it fits unless something said it doesn't, in words saying all of it */
export function verdictsFor(hits: readonly { id: string }[], said: readonly THitVerdict[]): THitVerdict[] {
	return hits.map((hit) => {
		const about = said.filter((item) => item.hitId === hit.id);
		const words = about.flatMap((item) => item.words ?? []);
		return { hitId: hit.id, fits: about.every((item) => item.fits), words: words.length > 0 ? words.join(' ') : null };
	});
}

/** How the marble moves at this time on a run */
export function exitAt(result: TSimulationResult, marbleId: string, time: number): TPatternMoment | null {
	const sample = sampleAt(result.marbles.find((marble) => marble.marbleId === marbleId)?.samples ?? [], time - 1e-6);
	return sample == null ? null : { position: sample.position, velocity: sample.velocity, time: sample.time };
}
