import type { TSceneBuild } from '@/modules/blender/scene-builder';

/** Frames per second of the background render; a 60 fps project renders every other frame */
export const LIVE_PREVIEW_FPS = 30;
/** Width of a background frame in pixels; the height follows the film's aspect */
export const LIVE_PREVIEW_WIDTH = 360;
/** Frames ahead of the playhead rendered before the job widens outward: playback runs forward */
export const LIVE_PREVIEW_LEAD = 3 * LIVE_PREVIEW_FPS;
/** A rendered frame stands in for a time at most this many frames away */
export const LIVE_PREVIEW_TOLERANCE = 1;

/** Frames of one scene signature on disk, as the host lists them */
export interface TLivePreviewFrames {
	signature: string;
	/** Absolute folder of the frames */
	folder: string;
	fps: number;
	/** Scene time of frame 0 in seconds */
	startTime: number;
	/** Frames in the song */
	total: number;
	rendered: ReadonlySet<number>;
}

/**
 * Preview frames of an applied scene, as the worker's `preview_render` counts them: every `step`-th scene frame,
 * so a 60 fps scene previews at 30 fps
 */
export function previewTimeline(scene: { fps: number; frameStart: number; frameEnd: number }, fps = LIVE_PREVIEW_FPS): { fps: number; startTime: number; total: number } {
	const step = Math.max(1, Math.round(scene.fps / fps));
	return {
		fps: scene.fps / step,
		startTime: scene.frameStart / scene.fps,
		total: Math.floor(Math.max(0, scene.frameEnd - scene.frameStart) / step) + 1
	};
}

/**
 * Order the job renders frames in: the playhead and `lead` frames ahead first, then outward, one frame
 * ahead and one behind in turn, like Final Cut's background render following the playhead
 */
export function previewFrameOrder(target: number, total: number, lead = LIVE_PREVIEW_LEAD): number[] {
	if (total <= 0) return [];
	const first = Math.max(0, Math.min(total - 1, Math.round(target)));
	const order: number[] = [];
	for (let index = first; index < Math.min(total, first + lead + 1); index++) order.push(index);
	let behind = first - 1;
	let ahead = first + lead + 1;
	while (behind >= 0 || ahead < total) {
		if (ahead < total) order.push(ahead++);
		if (behind >= 0) order.push(behind--);
	}
	return order;
}

/** Frame number showing a time; frames are `1 / fps` apart from `startTime` */
export function frameIndexAt(time: number, fps: number, startTime = 0): number {
	return Math.round((time - startTime) * fps);
}

/** The rendered frame closest to a time, or null when none is within `tolerance` frames: then the Draft Preview draws it */
export function lookupFrame(frames: TLivePreviewFrames, time: number, tolerance = LIVE_PREVIEW_TOLERANCE): number | null {
	const exact = frameIndexAt(time, frames.fps, frames.startTime);
	for (let distance = 0; distance <= tolerance; distance++) {
		for (const index of distance === 0 ? [exact] : [exact - distance, exact + distance]) {
			if (index >= 0 && index < frames.total && frames.rendered.has(index)) return index;
		}
	}
	return null;
}

/** File of a frame, such as `00042.jpg` */
export function framePath(folder: string, index: number): string {
	return `${folder}/${String(index).padStart(5, '0')}.jpg`;
}

/** Rendered frames from a time up to `seconds` ahead, in playback order, for the image cache to decode early */
export function framesAhead(frames: TLivePreviewFrames, time: number, seconds = 1): number[] {
	const first = Math.max(0, frameIndexAt(time, frames.fps, frames.startTime));
	const last = Math.min(frames.total - 1, first + Math.ceil(seconds * frames.fps));
	const ahead: number[] = [];
	for (let index = first; index <= last; index++) if (frames.rendered.has(index)) ahead.push(index);
	return ahead;
}

export interface TRenderedSpan {
	/** Seconds */
	start: number;
	end: number;
}

/** Runs of rendered frames as time spans for the ruler's render bar; each frame covers `1 / fps` from its time */
export function renderedSpans(indices: Iterable<number>, fps: number, startTime = 0): TRenderedSpan[] {
	const sorted = [...new Set(indices)].sort((a, b) => a - b);
	const spans: TRenderedSpan[] = [];
	let first: number | null = null;
	let previous = -2;
	for (const index of sorted) {
		if (first != null && index === previous + 1) {
			previous = index;
			continue;
		}
		if (first != null) spans.push({ start: startTime + first / fps, end: startTime + (previous + 1) / fps });
		first = index;
		previous = index;
	}
	if (first != null) spans.push({ start: startTime + first / fps, end: startTime + (previous + 1) / fps });
	return spans;
}

/**
 * Names the scene Blender has: a hash of the scene description and every motion file applied. Any change gives a
 * new signature and a new frame folder (invalidate all); undo returns to a signature whose frames are still there.
 * `salt` marks applies that change the Blender scene without changing the description, such as Discard Blender Changes.
 */
export function sceneSignature(build: Pick<TSceneBuild, 'description' | 'motionFiles'>, salt = ''): string {
	let hash = fnv1a(FNV_OFFSET, new TextEncoder().encode(`${FRAME_LOOK}\n${salt}\n${JSON.stringify(build.description)}`));
	for (const file of build.motionFiles) {
		hash = fnv1a(hash, new TextEncoder().encode(file.path));
		hash = fnv1a(hash, file.bytes);
	}
	// A second pass seeded differently makes the 64-bit name collisions practically impossible
	let second = fnv1a(FNV_OFFSET ^ 0x5bd1e995, new TextEncoder().encode(JSON.stringify(build.description)));
	for (const file of build.motionFiles) second = fnv1a(second, file.bytes);
	return `s${hash.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
}

/** What the frames look like: a folder of frames rendered another way has another name */
const FRAME_LOOK = 'eevee';
const FNV_OFFSET = 0x811c9dc5;

function fnv1a(seed: number, bytes: Uint8Array): number {
	let hash = seed >>> 0;
	for (const byte of bytes) {
		hash ^= byte;
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash;
}
