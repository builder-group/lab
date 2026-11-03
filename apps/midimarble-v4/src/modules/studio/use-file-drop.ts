import { isTauri } from '@tauri-apps/api/core';
import React from 'react';
import { host, type THostPickedFile } from '@/environment';
import type { StudioCx } from './StudioCx';

const midiExtensions = ['mid', 'midi'];
const audioExtensions = ['wav', 'mp3', 'm4a', 'aac', 'aiff', 'aif', 'flac', 'ogg'];

/** Imports MIDI and audio files dropped anywhere on the window */
export function useFileDrop(cx: StudioCx): void {
	React.useEffect(() => {
		function importFile(file: THostPickedFile): void {
			const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
			if (midiExtensions.includes(extension)) void cx.sources.openMidi(file);
			else if (audioExtensions.includes(extension)) void cx.sources.importAudio(file);
			else cx.notify(`${file.name} is not a MIDI or audio file`, 'error');
		}

		if (isTauri()) {
			let disposed = false;
			let unlisten: (() => void) | null = null;
			void import('@tauri-apps/api/webview').then(async ({ getCurrentWebview }) => {
				const stop = await getCurrentWebview().onDragDropEvent((event) => {
					if (event.payload.type !== 'drop') return;
					const path = event.payload.paths[0];
					if (path != null) importFile({ name: path.split('/').pop() ?? path, path });
				});
				if (disposed) stop();
				else unlisten = stop;
			});
			return () => {
				disposed = true;
				unlisten?.();
			};
		}

		function onDragOver(event: DragEvent): void {
			event.preventDefault();
		}
		function onDrop(event: DragEvent): void {
			event.preventDefault();
			const file = event.dataTransfer?.files[0];
			if (file != null) importFile(host.registerBrowserFile(file));
		}
		window.addEventListener('dragover', onDragOver);
		window.addEventListener('drop', onDrop);
		return () => {
			window.removeEventListener('dragover', onDragOver);
			window.removeEventListener('drop', onDrop);
		};
	}, [cx]);
}
