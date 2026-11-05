import { hasSong } from '@/modules/music';
import { type TProject, type TProjectCommand, backingOf } from '@/modules/project';
import { songSource } from './SourcesCx';

/**
 * The Song layer is optional: it exists while the project has a song file or Backing notes. A new project and a
 * project of tapped hits have none, so Layers and the timeline show no Song row until a song is imported.
 */
export function hasSongLayer(project: TProject): boolean {
	return hasSong(project);
}

/** The Song layer's name in Layers and the timeline; its file is the subtitle */
export const SONG_LAYER_LABEL = 'Song';

/** What notices call the song: its file's name, or "Song" for Backing notes left without a file */
export function songLayerName(project: TProject): string {
	return songSource(project)?.name ?? SONG_LAYER_LABEL;
}

/**
 * Deleting the Song layer removes the song files and Backing as one edit; the marbles keep their hits, which
 * are theirs and not the song's
 */
export function deleteSongCommands(project: TProject): TProjectCommand[] {
	if (!hasSongLayer(project)) return [];
	return project.songs.map((song) => ({ type: 'removeSong', songId: song.id }));
}

/** The confirmation before deleting the Song layer, only when Backing notes would be lost with it */
export function deleteSongQuestion(project: TProject): string | null {
	const count = backingOf(project).length;
	if (count === 0) return null;
	return `Delete ${songLayerName(project)} and its ${backingNotes(count)}?`;
}

/** The notice after deleting the Song layer, with Undo beside it */
export function deleteSongNotice(project: TProject): string {
	const count = backingOf(project).length;
	const name = songLayerName(project);
	return count > 0 ? `Deleted ${name} and its ${backingNotes(count)}. The marbles keep their hits.` : `Deleted ${name}. The marbles keep their hits.`;
}

function backingNotes(count: number): string {
	return count === 1 ? '1 Backing note' : `${count} Backing notes`;
}
