import type { TProject } from './schema';

/** A film opens this many seconds before its first sound, so a viewer sees the marble land on it */
export const OPENING_LEAD = 0.2;
/** Starts land on whole frames of the film's rate, so its sound and picture start together */
const START_STEP = 1 / 30;

/**
 * Where the film's first frame is on the timeline: the time a person set, or by default `OPENING_LEAD` before the first hit
 * or the first sound, whichever comes first, so nothing a person hears is cut off and nothing waits for it. The run itself
 * doesn't change: the marble still falls from its start, and the film only opens later.
 */
export function filmStartOf(project: Pick<TProject, 'film' | 'songs' | 'marbles' | 'length'>): number {
	const start = project.film.start ?? Math.max(0, firstSound(project) - OPENING_LEAD);
	return Math.floor(Math.min(start, project.length) / START_STEP + 1e-6) * START_STEP;
}

/** The first hit, Backing note or recording on the timeline. A project with none opens at its start */
function firstSound(project: Pick<TProject, 'songs' | 'marbles'>): number {
	const times = [
		...project.marbles.flatMap((marble) => marble.hits.map((hit) => hit.time)),
		...project.songs.flatMap((song) => [...song.backing.map((hit) => hit.time), ...(song.kind === 'audio' && song.path != null ? [song.start] : [])])
	];
	return times.length > 0 ? Math.min(...times) : 0;
}
