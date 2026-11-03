import { isTauri } from '@tauri-apps/api/core';
import React from 'react';
import { host, notSongFileMessage, songFileKind, type THostPickedFile } from '@/environment';
import type { StudioCx } from './StudioCx';

/** Imports MIDI and audio files dropped anywhere on the window; returns true while a file is dragged over it */
export function useFileDrop(cx: StudioCx): boolean {
	const [isOver, setIsOver] = React.useState(false);

	React.useEffect(() => {
		function importFile(file: THostPickedFile): void {
			const kind = songFileKind(file.name);
			if (kind === 'midi') void cx.sources.openMidi(file);
			else if (kind === 'audio') void cx.sources.importAudio(file);
			else cx.notify(notSongFileMessage(file.name), 'error');
		}

		if (isTauri()) {
			let disposed = false;
			let unlisten: (() => void) | null = null;
			void import('@tauri-apps/api/webview').then(async ({ getCurrentWebview }) => {
				const stop = await getCurrentWebview().onDragDropEvent((event) => {
					setIsOver(event.payload.type === 'enter' || event.payload.type === 'over');
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
			if (event.dataTransfer?.types.includes('Files') === true) setIsOver(true);
		}
		function onDragLeave(event: DragEvent): void {
			// Leaving the window reports no related target
			if (event.relatedTarget == null) setIsOver(false);
		}
		function onDrop(event: DragEvent): void {
			event.preventDefault();
			setIsOver(false);
			const file = event.dataTransfer?.files[0];
			if (file != null) importFile(host.registerBrowserFile(file));
		}
		window.addEventListener('dragover', onDragOver);
		window.addEventListener('drop', onDrop);
		window.addEventListener('dragleave', onDragLeave);
		return () => {
			window.removeEventListener('dragleave', onDragLeave);
			window.removeEventListener('dragover', onDragOver);
			window.removeEventListener('drop', onDrop);
		};
	}, [cx]);

	return isOver;
}
