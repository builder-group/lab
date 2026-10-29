import React from 'react';
import { exportDimensions, exportVideo } from '../export';
import { downloadFile, type TPerformance, type TProject } from '../project';
import type { TSceneHandle } from '../scene';
import type { TCompletedVideo } from './CompletedVideo';

export function useVideoExport(options: TVideoExportOptions) {
	const { project, performance, compiling, sceneError, sceneRef, onStop, onMessage } = options;
	const [exporting, setExporting] = React.useState(false);
	const [error, setError] = React.useState<{ project: TProject; message: string } | null>(null);
	const [completedVideo, setCompletedVideo] = React.useState<
		(TCompletedVideo & { project: TProject }) | null
	>(null);
	const [progress, setProgress] = React.useState(0);
	const [preferences, setPreferences] = React.useState(readExportPreferences);
	const { size, fps } = preferences;
	const setSize = React.useCallback((value: number) => {
		setPreferences((current) => ({ ...current, size: value === 1080 ? 1080 : 720 }));
	}, []);
	const setFps = React.useCallback((value: number) => {
		setPreferences((current) => ({ ...current, fps: value === 60 ? 60 : 30 }));
	}, []);
	const abortRef = React.useRef<AbortController | null>(null);
	const unavailableReason =
		sceneError ??
		(compiling || performance == null
			? 'The scene is still preparing. You can render when the trajectory is ready.'
			: null);

	const start = React.useCallback(async () => {
		if (abortRef.current != null) return;
		const scene = sceneRef.current;
		if (scene == null || performance == null || unavailableReason != null) {
			setError({
				project,
				message: unavailableReason ?? 'The scene is still preparing. Try again in a moment.'
			});
			return;
		}
		onStop();
		setError(null);
		setCompletedVideo(null);
		setExporting(true);
		setProgress(0);
		const controller = new AbortController();
		abortRef.current = controller;
		const { width, height } = exportDimensions(project.aspectRatio, size);
		try {
			const result = await exportVideo({
				project,
				performance,
				scene,
				width,
				height,
				fps,
				onProgress: setProgress,
				signal: controller.signal
			});
			if (controller.signal.aborted) return;
			setCompletedVideo({
				project,
				url: URL.createObjectURL(result.blob),
				name: project.name,
				extension: result.extension,
				bytes: result.blob.size
			});
			onMessage('Your film is ready to preview and download.');
		} catch (error) {
			if (!controller.signal.aborted) {
				setError({
					project,
					message: error instanceof Error ? error.message : 'The video could not be exported.'
				});
			}
		} finally {
			setExporting(false);
			abortRef.current = null;
		}
	}, [project, performance, unavailableReason, sceneRef, onStop, onMessage, size, fps]);

	const cancel = React.useCallback(() => abortRef.current?.abort(), []);
	const adjustSettings = React.useCallback(() => setCompletedVideo(null), []);
	const saveFrame = React.useCallback(() => {
		try {
			const { width, height } = exportDimensions(project.aspectRatio, size);
			const encoded = sceneRef.current?.capture(width, height).split(',')[1];
			if (!encoded) throw new Error('The scene is still preparing. Try saving again in a moment.');
			const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
			downloadFile(new Blob([bytes], { type: 'image/png' }), `${project.name}.png`);
			setError(null);
		} catch (error) {
			setError({
				project,
				message: error instanceof Error ? error.message : 'The frame could not be saved.'
			});
		}
	}, [project, sceneRef, size]);

	React.useEffect(() => {
		try {
			localStorage.setItem(EXPORT_PREFERENCES_KEY, JSON.stringify(preferences));
		} catch {
			// Export still works when browser storage is unavailable
		}
	}, [preferences]);
	React.useEffect(
		() => () => {
			if (completedVideo != null) URL.revokeObjectURL(completedVideo.url);
		},
		[completedVideo]
	);
	React.useEffect(() => () => abortRef.current?.abort(), []);

	return {
		exporting,
		error: error?.project === project ? error.message : null,
		completedVideo: completedVideo?.project === project ? completedVideo : null,
		unavailableReason,
		progress,
		size,
		setSize,
		fps,
		setFps,
		start,
		cancel,
		adjustSettings,
		saveFrame
	};
}

interface TVideoExportOptions {
	project: TProject;
	performance: TPerformance | null;
	compiling: boolean;
	sceneError: string | null;
	sceneRef: React.RefObject<TSceneHandle | null>;
	onStop: () => void;
	onMessage: (message: string) => void;
}

export type TVideoExport = ReturnType<typeof useVideoExport>;

const EXPORT_PREFERENCES_KEY = 'midimarble.export.v1';

function readExportPreferences(): { size: number; fps: number } {
	try {
		const saved = JSON.parse(localStorage.getItem(EXPORT_PREFERENCES_KEY) ?? '{}') as {
			size?: unknown;
			fps?: unknown;
		} | null;
		return { size: saved?.size === 1080 ? 1080 : 720, fps: saved?.fps === 60 ? 60 : 30 };
	} catch {
		return { size: 720, fps: 30 };
	}
}
