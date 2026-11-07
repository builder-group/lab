import { useFileDropped } from '@/hooks';
import { notSongFileMessage, songFileKind } from '@/environment';
import type { StudioCx } from './StudioCx';

/** Imports MIDI and audio files dropped anywhere on the window; returns true while a file is dragged over it */
export function useFileDrop(cx: StudioCx): boolean {
	return useFileDropped((file) => {
		const kind = songFileKind(file.name);
		if (kind === 'midi') void cx.sources.openMidi(file);
		else if (kind === 'audio') void cx.sources.importAudio(file);
		else cx.notify(notSongFileMessage(file.name), 'error');
	});
}
