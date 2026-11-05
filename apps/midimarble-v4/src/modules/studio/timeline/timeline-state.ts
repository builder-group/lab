import { createState } from 'feature-state';
import { DEFAULT_NOTE_LENGTH } from './piano-roll';

/** The songs whose row shows every note in a piano roll. View state for the session, not saved with the project. */
export const $expandedSongs = createState<string[]>([]);

/** The length of the next note added in the piano roll: the last one resized. View state for the session. */
export const $noteLength = createState(DEFAULT_NOTE_LENGTH);

/** The piano roll was clicked last, so ⌫ is its own: the note itself goes */
export const $rollHasFocus = createState(false);

export function toggleSongExpanded(songId: string): void {
	$expandedSongs.set((songs) => (songs.includes(songId) ? songs.filter((id) => id !== songId) : [...songs, songId]));
}
