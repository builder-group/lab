import { shownSongs, type TMarble, type TProject, type TSong } from '@/modules/project';
import { soundingMarbles } from './synthesize';

/** Backing notes are gray: heard, but no marble plays them */
export const BACKING_COLOR = '#8e8e93';

/**
 * Muted and soloed marbles and songs, by ID, like the M and S of a Logic track. View state: not saved, no Undo, and every
 * opened project starts with everything on.
 */
export interface TMix {
	muted: string[];
	solo: string[];
}

export const EMPTY_MIX: TMix = { muted: [], solo: [] };

/** The project has a Song: a song file or Backing notes. Without one a project opens and plays silently. */
export function hasSong(project: TProject): boolean {
	return project.songs.some((song) => song.path != null || song.backing.length > 0);
}

/** Whether a marble has anything to mute or give a Sound: a note that plays, which a tapped hit or one in a recording isn't */
export function marbleSounds(project: TProject, marble: TMarble): boolean {
	return soundingMarbles({ songs: project.songs, marbles: [marble] }).some((item) => item.hits.length > 0);
}

/** Whether a marble or song sounds: soloed ones win over everything, otherwise every one that is not muted */
export function isAudible(mix: TMix, id: string): boolean {
	return mix.solo.length > 0 ? mix.solo.includes(id) : !mix.muted.includes(id);
}

/** Whether a marble's hit sounds: its marble and the song it is tied to each have a say, and a solo of either lets it through */
export function isHitAudible(mix: TMix, marbleId: string, songId: string | undefined): boolean {
	if (mix.solo.length > 0) return mix.solo.includes(marbleId) || (songId != null && mix.solo.includes(songId));
	return !mix.muted.includes(marbleId) && (songId == null || !mix.muted.includes(songId));
}

/**
 * The mix limited to what the project has: a marble that lost its last note can no longer be unsoloed, so it stops
 * counting instead of silencing everything else
 */
export function currentMix(project: TProject, mix: TMix): TMix {
	if (!mix.muted.length && !mix.solo.length) return mix;
	const ids = new Set([...project.marbles.filter((marble) => marbleSounds(project, marble)).map((marble) => marble.id), ...shownSongs(project).map((song) => song.id)]);
	return { muted: mix.muted.filter((id) => ids.has(id)), solo: mix.solo.filter((id) => ids.has(id)) };
}

/**
 * The project as it sounds with this mix. Soloing Bass leaves the hits Bass plays. Muting a song takes out what it
 * plays: its recording, its Backing and the marbles' hits tied to it. A muted recording has no audio source and no
 * notes left, which renders as silence.
 */
export function audibleProject(project: TProject, mix: TMix): TProject {
	const current = currentMix(project, mix);
	if (!current.muted.length && !current.solo.length) return project;
	return {
		...project,
		marbles: project.marbles.map((marble) => ({ ...marble, hits: marble.hits.filter((hit) => isHitAudible(current, marble.id, hit.songId)) })),
		songs: project.songs.flatMap((song) => {
			if (isAudible(current, song.id)) return [song];
			return song.kind === 'audio' ? [] : [{ ...song, backing: [] }];
		})
	};
}

/**
 * The project as the film's soundtrack hears it: what is muted stays out, so what is muted while exporting is what the
 * film leaves out, and the export sheet says so. Solo is for listening while editing and never shapes the film.
 */
export function soundtrackProject(project: TProject, mix: TMix): TProject {
	return audibleProject(project, { muted: mix.muted, solo: [] });
}

/** The quiet line in the export sheet while the mix changes the film's soundtrack; null when nothing is muted */
export function mutedSoundtrackNote(project: TProject, mix: TMix): string | null {
	const { muted } = currentMix(project, mix);
	if (!muted.length) return null;
	const names = [...project.songs.filter((song) => muted.includes(song.id)).map(songLabel), ...project.marbles.filter((marble) => muted.includes(marble.id)).map((marble) => marble.name)];
	return `${joinNames(names)} ${names.length === 1 ? 'is' : 'are'} muted and left out of the film's sound.`;
}

function songLabel(song: TSong): string {
	return song.name === '' ? 'Backing' : song.name;
}

function joinNames(names: string[]): string {
	if (names.length < 2) return names.join('');
	return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}
