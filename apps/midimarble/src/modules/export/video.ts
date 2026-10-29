import { renderPerformanceAudio } from '../music';
import type { TPerformance, TProject } from '../project';
import type { TSceneHandle } from '../scene';

export async function exportVideo(options: TVideoExportOptions): Promise<TVideoExportResult> {
	if (exporting) throw new Error('A video is already being rendered.');
	exporting = true;
	try {
		return await renderVideo(options);
	} finally {
		exporting = false;
	}
}

async function renderVideo(options: TVideoExportOptions): Promise<TVideoExportResult> {
	const { project, scene, signal, onProgress } = options;
	if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined') {
		throw new Error(
			'Video export needs WebCodecs. Open MidiMarble in a recent Chrome, Edge, or Brave browser.'
		);
	}
	throwIfAborted(signal);
	const {
		Output,
		BufferTarget,
		CanvasSource,
		AudioBufferSource,
		WebMOutputFormat,
		Quality,
		canEncodeAudio,
		canEncodeVideo
	} = await import('mediabunny');
	const size = exportDimensions(project.aspectRatio);
	const width = options.width ?? size.width;
	const height = options.height ?? size.height;
	const fps = options.fps ?? 30;
	if (
		!Number.isInteger(width) ||
		!Number.isInteger(height) ||
		width < 64 ||
		height < 64 ||
		width > 3840 ||
		height > 3840 ||
		width % 2 !== 0 ||
		height % 2 !== 0
	) {
		throw new Error('Choose even video dimensions between 64 and 3,840 pixels.');
	}
	if (fps !== 24 && fps !== 30 && fps !== 60)
		throw new Error('Choose a frame rate of 24, 30, or 60 fps.');
	const videoOptions = { width, height, frameRate: fps, quality: new Quality('high') };
	const [vp9, vp8, opus, avc, aac] = await Promise.all([
		canEncodeVideo('vp9', videoOptions),
		canEncodeVideo('vp8', videoOptions),
		canEncodeAudio('opus', { numberOfChannels: 2, sampleRate: 48000 }),
		canEncodeVideo('avc', videoOptions),
		canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 44100 })
	]);
	const { videoCodec, audioCodec, extension } = selectExportFormat({
		vp9,
		vp8,
		opus,
		avc,
		aac
	});
	throwIfAborted(signal);
	const target = new BufferTarget();
	const output = new Output({
		target,
		format: new WebMOutputFormat()
	});
	let resized = false;
	try {
		onProgress?.(0);
		const audio = await waitForExportStep(
			renderPerformanceAudio(project, options.performance),
			signal
		);
		throwIfAborted(signal);
		onProgress?.(0.08);
		scene.setExportSize(width, height);
		resized = true;
		const videoSource = new CanvasSource(scene.canvas, {
			codec: videoCodec,
			quality: new Quality('high'),
			keyFrameInterval: 2,
			latencyMode: 'quality'
		});
		const audioSource = new AudioBufferSource({
			codec: audioCodec,
			quality: new Quality({ bitrate: 192000 }),
			transform: { sampleRate: 48000 }
		});
		output.addVideoTrack(videoSource, { frameRate: fps });
		output.addAudioTrack(audioSource);
		await output.start();
		await audioSource.add(audio);
		audioSource.close();
		const frames = Math.ceil(project.duration * fps);
		for (let frame = 0; frame < frames; frame++) {
			throwIfAborted(signal);
			const timestamp = frame / fps;
			scene.renderAt(timestamp);
			await videoSource.add(timestamp, Math.min(1 / fps, project.duration - timestamp));
			onProgress?.(0.08 + (0.9 * (frame + 1)) / frames);
			if (frame % 8 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
		}
		videoSource.close();
		throwIfAborted(signal);
		await output.finalize();
		if (target.buffer == null) throw new Error('The encoder did not produce a video file.');
		onProgress?.(1);
		return {
			blob: new Blob([target.buffer], { type: 'video/webm' }),
			extension
		};
	} catch (error) {
		await output.cancel().catch(() => undefined);
		throw error;
	} finally {
		if (resized) scene.restoreSize();
	}
}

export interface TVideoExportOptions {
	project: TProject;
	performance?: TPerformance | null;
	scene: TSceneHandle;
	signal?: AbortSignal;
	onProgress?: (progress: number) => void;
	width?: number;
	height?: number;
	fps?: number;
}

export interface TVideoExportResult {
	blob: Blob;
	extension: 'webm';
}

export function selectExportFormat(capabilities: TExportCapabilities): TExportFormat {
	if (capabilities.opus && (capabilities.vp9 || capabilities.vp8)) {
		return { extension: 'webm', videoCodec: capabilities.vp9 ? 'vp9' : 'vp8', audioCodec: 'opus' };
	}
	// Native AAC hides encoder priming; Opus carries an explicit pre-skip for contact alignment
	// https://github.com/Vanilagy/mediabunny/issues/444
	if (capabilities.avc && capabilities.aac) {
		throw new Error(
			'Accurate export requires WebM video with Opus sound. This browser supports MP4/AAC, whose encoder can delay the audio. Try a recent Chrome or Brave browser.'
		);
	}
	throw new Error(
		'This browser cannot encode video with sound at this resolution. Try a lower resolution or a recent Chrome or Brave browser.'
	);
}

export interface TExportCapabilities {
	vp9: boolean;
	vp8: boolean;
	opus: boolean;
	avc: boolean;
	aac: boolean;
}

interface TExportFormat {
	extension: 'webm';
	videoCodec: 'vp9' | 'vp8';
	audioCodec: 'opus';
}

export function exportDimensions(
	aspectRatio: TProject['aspectRatio'],
	size = 1080
): {
	width: number;
	height: number;
} {
	const shortSide = Math.round(size / 2) * 2;
	const longSide = Math.round((shortSide * 16) / 9 / 2) * 2;
	if (aspectRatio === '16:9') return { width: longSide, height: shortSide };
	if (aspectRatio === '1:1') return { width: shortSide, height: shortSide };
	return { width: shortSide, height: longSide };
}

let exporting = false;

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DOMException('Video export was cancelled.', 'AbortError');
}

/** A cancelled export can close immediately while a shared soundtrack render finishes caching. */
export function waitForExportStep<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return task;
	return new Promise((resolve, reject) => {
		function cancelled() {
			signal?.removeEventListener('abort', cancelled);
			reject(new DOMException('Video export was cancelled.', 'AbortError'));
		}
		task.then(
			(value) => {
				signal.removeEventListener('abort', cancelled);
				resolve(value);
			},
			(error: unknown) => {
				signal.removeEventListener('abort', cancelled);
				reject(error);
			}
		);
		if (signal.aborted) cancelled();
		else signal.addEventListener('abort', cancelled, { once: true });
	});
}
