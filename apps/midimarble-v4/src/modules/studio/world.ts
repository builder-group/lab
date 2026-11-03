import type { TProject } from '@/modules/project';

/** Seconds the film runs on after the last note, so the final hit can ring out */
export const SONG_TAIL = 1.5;

/** Film length that fits the song: the last note plus `SONG_TAIL`, or null without notes */
export function songFitEnd(project: TProject): number | null {
	const times = project.music.lanes.flatMap((lane) => lane.hits.map((hit) => hit.time));
	if (!times.length) return null;
	return Math.round((Math.max(...times) + SONG_TAIL) * 100) / 100;
}
