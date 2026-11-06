import type { TProject } from '@/modules/project';
import type { TSimulator } from '@/modules/simulation';
import type { TPatternMoment } from './contract';
import { sampleAt } from './fit-bars';

/** Where the marble is at a hit on this wall, a Pattern's arrival; null when it isn't there */
export function arrivalAt(sim: TSimulator, project: TProject, marbleId: string, hitId: string, time: number): TPatternMoment | null {
	const result = sim.simulate({ ...project, length: time + 0.03 });
	const sample = sampleAt(result.marbles.find((marble) => marble.marbleId === marbleId)?.samples ?? [], time - 1e-6);
	if (sample == null) return null;
	return { position: result.hits.find((hit) => hit.hitId === hitId)?.dot ?? sample.position, velocity: sample.velocity, time: sample.time };
}
