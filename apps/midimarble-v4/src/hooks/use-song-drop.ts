import { isTauri } from '@tauri-apps/api/core';
import React from 'react';
import { host, type THostPickedFile } from '@/environment';

/** Takes a file dropped anywhere on the window; returns true while a file is dragged over it */
export function useFileDropped(onFile: (file: THostPickedFile) => void): boolean {
	const [isOver, setIsOver] = React.useState(false);
	const onFileRef = React.useRef(onFile);
	React.useEffect(() => {
		onFileRef.current = onFile;
	});

	React.useEffect(() => {
		if (isTauri()) {
			let disposed = false;
			let unlisten: (() => void) | null = null;
			void import('@tauri-apps/api/webview').then(async ({ getCurrentWebview }) => {
				const stop = await getCurrentWebview().onDragDropEvent((event) => {
					setIsOver(event.payload.type === 'enter' || event.payload.type === 'over');
					if (event.payload.type !== 'drop') return;
					const path = event.payload.paths[0];
					if (path != null) onFileRef.current({ name: path.split('/').pop() ?? path, path });
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
			if (file != null) onFileRef.current(host.registerBrowserFile(file));
		}
		window.addEventListener('dragover', onDragOver);
		window.addEventListener('drop', onDrop);
		window.addEventListener('dragleave', onDragLeave);
		return () => {
			window.removeEventListener('dragleave', onDragLeave);
			window.removeEventListener('dragover', onDragOver);
			window.removeEventListener('drop', onDrop);
		};
	}, []);

	return isOver;
}
