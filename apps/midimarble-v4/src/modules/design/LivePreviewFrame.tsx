import { convertFileSrc } from '@tauri-apps/api/core';
import React from 'react';
import type { StudioCx } from '@/modules/studio/StudioCx';
import { framePath, framesAhead, lookupFrame, type TLivePreviewLevel } from './live-preview';
import type { LivePreviewCx } from './LivePreviewCx';
import { PreviewImageCache } from './preview-image-cache';

/** Seconds the last Blender frame stays while the next one decodes, before the Draft Preview shows through */
const HOLD_SECONDS = 0.25;
/** Seconds of frames ahead of the playhead decoded early */
const PRELOAD_SECONDS = 1;

/**
 * Blender's background preview frame at the playhead, drawn over the Draft Preview. It follows the playhead
 * outside React so playback does not re-render the tree, and fades out where no frame is rendered yet.
 */
export const LivePreviewFrame: React.FC<TLivePreviewFrameProps> = (props) => {
	const { live, studio, onLevelChange } = props;
	const canvasRef = React.useRef<HTMLCanvasElement>(null);
	const [cache] = React.useState(() => new PreviewImageCache());

	React.useEffect(() => {
		const canvas = canvasRef.current;
		const context = canvas?.getContext('2d');
		if (canvas == null || context == null) return;
		let shown: TLivePreviewLevel | null = null;
		let drawnTime: number | null = null;
		let drawnUrl: string | null = null;

		function show(level: TLivePreviewLevel | null): void {
			if (canvas == null || level === shown) return;
			shown = level;
			canvas.style.opacity = level != null ? '1' : '0';
			onLevelChange(level);
		}

		function draw(): void {
			const time = studio.$playhead.get();
			const frames = live.$frames.get();
			if (frames == null || frames.folder === '' || !live.$enabled.get()) {
				drawnTime = null;
				show(null);
				return;
			}
			for (const ahead of framesAhead(frames, time, PRELOAD_SECONDS)) cache.load(convertFileSrc(framePath(frames.folder, ahead.index, ahead.level)), onReady);
			const hit = lookupFrame(frames, time);
			const url = hit != null ? convertFileSrc(framePath(frames.folder, hit.index, hit.level)) : null;
			const image = url != null ? cache.get(url) : null;
			if (hit != null && url != null && image != null) {
				if (url !== drawnUrl && canvas != null && context != null) {
					if (canvas.width !== image.naturalWidth || canvas.height !== image.naturalHeight) {
						canvas.width = image.naturalWidth;
						canvas.height = image.naturalHeight;
					}
					context.drawImage(image, 0, 0, canvas.width, canvas.height);
					drawnUrl = url;
				}
				drawnTime = time;
				show(hit.level);
				return;
			}
			if (url != null) cache.load(url, onReady);
			// Keep the last frame briefly while the next one decodes, so playback does not flicker to the draft
			if (drawnTime == null || Math.abs(time - drawnTime) > HOLD_SECONDS) show(null);
		}

		function onReady(): void {
			draw();
		}

		draw();
		const stops = [studio.$playhead.listen(draw), live.$frames.listen(draw), live.$enabled.listen(draw)];
		return () => {
			for (const stop of stops) stop();
			cache.clear();
			onLevelChange(null);
		};
	}, [cache, live, studio, onLevelChange]);

	return (
		<canvas
			ref={canvasRef}
			aria-hidden
			className="pointer-events-none absolute inset-0 h-full w-full"
			style={{ opacity: 0, transition: 'opacity 140ms ease-out' }}
		/>
	);
};

interface TLivePreviewFrameProps {
	live: LivePreviewCx;
	studio: StudioCx;
	/** The level of the frame shown, or null while the Draft Preview shows through; keep it stable, like a state setter */
	onLevelChange: (level: TLivePreviewLevel | null) => void;
}
