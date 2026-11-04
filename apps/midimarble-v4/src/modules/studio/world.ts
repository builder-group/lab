import { songEnd } from '@/modules/music';
import type { TProject } from '@/modules/project';

/** Film length that fits the song: the last note plus `SONG_TAIL`, or null without notes */
export function songFitEnd(project: TProject): number | null {
	const times = project.music.lanes.flatMap((lane) => lane.hits.map((hit) => hit.time));
	if (!times.length) return null;
	return songEnd(Math.max(...times));
}
