import { filmTail, songEnd } from '@/modules/music';
import type { TProject } from '@/modules/project';

/** Film length that fits the song before any run: the last note plus `filmTail` (`SONG_TAIL`, or `BOWL_TAIL` with Bowls, which `StudioCx.fitToSong` measures), or null without notes */
export function songFitEnd(project: TProject): number | null {
	const times = project.music.lanes.flatMap((lane) => lane.hits.map((hit) => hit.time));
	if (!times.length) return null;
	return songEnd(Math.max(...times), filmTail(project));
}
