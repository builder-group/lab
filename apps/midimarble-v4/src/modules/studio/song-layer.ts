import { hasSong } from '@/modules/music';
import { parseSongKey, shownSongs, type TProject, type TProjectCommand, type TSong } from '@/modules/project';

/**
 * A Song layer is optional: one exists per song with a file or Backing notes. A new project and a project of tapped hits
 * have none, so Layers and the timeline show no Song row until a song is imported.
 */
export function hasSongLayer(project: TProject): boolean {
	return hasSong(project);
}

/** A Song layer's name in Layers and the timeline; its file is the subtitle */
export const SONG_LAYER_LABEL = 'Song';

/** A song's row name: "Song" while it's the only one, its file's name once there are several, so the rows differ */
export function songRowLabel(project: TProject, song: TSong): string {
	return shownSongs(project).length > 1 && song.path != null ? song.name : SONG_LAYER_LABEL;
}

/** What notices call a song: its file's name, or "Song" for Backing notes left without a file */
export function songLayerName(song: TSong): string {
	return song.path != null ? song.name : SONG_LAYER_LABEL;
}

/** The song an action without a song named is for: the selected one, or the only one */
export function targetSong(project: TProject, selection: readonly string[]): TSong | undefined {
	const songs = shownSongs(project);
	const selected = selection.flatMap((key) => parseSongKey(key) ?? []);
	return songs.find((song) => selected.includes(song.id)) ?? (songs.length === 1 ? songs[0] : undefined);
}

/**
 * Deleting a Song layer removes its file and Backing as one edit; the marbles keep their hits, which lose the tie and
 * stay where they are
 */
export function deleteSongCommands(project: TProject, songId: string): TProjectCommand[] {
	return project.songs.some((song) => song.id === songId) ? [{ type: 'removeSong', songId }] : [];
}

/** The confirmation before deleting a Song layer, only when Backing notes would be lost with it */
export function deleteSongQuestion(song: TSong): string | null {
	const count = song.backing.length;
	if (count === 0) return null;
	return `Delete ${songLayerName(song)} and its ${backingNotes(count)}?`;
}

/** The notice after deleting a Song layer, with Undo beside it */
export function deleteSongNotice(song: TSong): string {
	const count = song.backing.length;
	const name = songLayerName(song);
	return count > 0 ? `Deleted ${name} and its ${backingNotes(count)}. The marbles keep their hits.` : `Deleted ${name}. The marbles keep their hits.`;
}

function backingNotes(count: number): string {
	return count === 1 ? '1 Backing note' : `${count} Backing notes`;
}
