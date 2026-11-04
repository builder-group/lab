import { BACKING_ID, type TProject, type TProjectCommand } from '@/modules/project';
import { songSource } from './SourcesCx';

/**
 * The Song layer is optional: it exists while the project has a song file or Backing notes. A new project and a
 * project of tapped hits have none, so Layers and the timeline show no Song row until a song is imported.
 */
export function hasSongLayer(project: TProject): boolean {
	return project.music.sources.length > 0 || project.music.backing.length > 0;
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
	const { sources, backing, backingInstrument } = project.music;
	return [
		...sources.map((source) => ({ type: 'removeSource' as const, sourceId: source.id })),
		...(backing.length > 0 ? [{ type: 'removeHits' as const, laneId: BACKING_ID, hitIds: backing.map((hit) => hit.id) }] : []),
		...(backingInstrument != null ? [{ type: 'setBackingInstrument' as const, instrument: null }] : [])
	];
}

/** The confirmation before deleting the Song layer, only when Backing notes would be lost with it */
export function deleteSongQuestion(project: TProject): string | null {
	const count = project.music.backing.length;
	if (count === 0) return null;
	return `Delete ${songLayerName(project)} and its ${backingNotes(count)}?`;
}

/** The notice after deleting the Song layer, with Undo beside it */
export function deleteSongNotice(project: TProject): string {
	const count = project.music.backing.length;
	const name = songLayerName(project);
	return count > 0 ? `Deleted ${name} and its ${backingNotes(count)}. The marbles keep their hits.` : `Deleted ${name}. The marbles keep their hits.`;
}

function backingNotes(count: number): string {
	return count === 1 ? '1 Backing note' : `${count} Backing notes`;
}
