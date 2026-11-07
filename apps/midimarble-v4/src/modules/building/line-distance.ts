import type { TProject } from '@/modules/project';
import { bandAlongGuide, type TSimulationResult } from '@/modules/simulation';

// How close a marble stays to its guide line, the one direction a person or agent gives (`bandAlongGuide`): straight down
// from its release unless the marble stores points.

/**
 * The mean sideways distance of the marble from its line between two times, in meters, over the run's samples, which
 * come at a fixed step, so it weighs each moment alike. Null when the run has no sample there.
 */
export function lineDistance(project: TProject, result: TSimulationResult, marbleId: string, from: number, until: number): number | null {
	const samples = result.marbles.find((marble) => marble.marbleId === marbleId)?.samples ?? [];
	const lineAt = bandAlongGuide(project, marbleId);
	let sum = 0;
	let count = 0;
	for (const { time, position } of samples) {
		if (time < from) continue;
		if (time > until) break;
		sum += Math.abs(position.x - lineAt(position.y).centerX);
		count++;
	}
	return count > 0 ? sum / count : null;
}
