import type { TProject } from '@/modules/project';

// A repeated stretch of a marble's notes: the same gaps between notes and the same pitch steps as an earlier stretch,
// about two bars of a nursery song. When a phrase comes back, its pieces can come back the same way.

/** Notes in a stretch */
export const STRETCH = 8;
/** Gaps between notes match within this, in seconds */
const GAP_TOLERANCE = 0.01;

/** Each later stretch with its first time, by the index of their first notes on the marble, in time order and never overlapping */
export function repeatedStretches(project: TProject, marbleId: string): { first: number; again: number }[] {
	const hits = project.marbles.find((marble) => marble.id === marbleId)?.hits ?? [];
	const keyAt = (start: number): string =>
		hits
			.slice(start + 1, start + STRETCH)
			.map((hit, index) => {
				const before = hits[start + index];
				return `${Math.round((hit.time - (before?.time ?? 0)) / GAP_TOLERANCE)}:${(hit.pitch ?? 0) - (before?.pitch ?? 0)}`;
			})
			.join('|');
	const firsts = new Map<string, number>();
	const found: { first: number; again: number }[] = [];
	for (let start = 0; start + STRETCH <= hits.length; ) {
		const key = keyAt(start);
		const first = firsts.get(key);
		if (first != null && first + STRETCH <= start) {
			found.push({ first, again: start });
			start += STRETCH;
			continue;
		}
		if (first == null) firsts.set(key, start);
		start++;
	}
	return found;
}

/** For each note of a later stretch, the note in the same place the first time, by hit ID */
export function repeatSources(project: TProject, marbleId: string): Map<string, string> {
	const hits = project.marbles.find((marble) => marble.id === marbleId)?.hits ?? [];
	const sources = new Map<string, string>();
	for (const { first, again } of repeatedStretches(project, marbleId)) {
		for (let index = 0; index < STRETCH; index++) {
			const [later, earlier] = [hits[again + index], hits[first + index]];
			if (later != null && earlier != null) sources.set(later.id, earlier.id);
		}
	}
	return sources;
}
