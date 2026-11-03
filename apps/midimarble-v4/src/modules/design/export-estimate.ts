import type { TFilmEngine, TRenderPreset } from '@/modules/blender';

/** Renderer chosen in the export sheet; the draft preset renders with Workbench instead */
export type TRenderEngine = 'eevee' | 'cycles';

export interface TRenderPresetInfo {
	id: TRenderPreset;
	label: string;
	/** Short side of the film in pixels; the long side follows the project frame */
	shortSide: number;
	fps: number;
	/** Engine the preset always renders with, whatever renderer is chosen */
	engine?: TFilmEngine;
	/** What the preset is for, shown in the preset picker */
	purpose?: string;
}

/** Export presets from ux.md; there is no 4K preset */
export const renderPresets: readonly TRenderPresetInfo[] = [
	{ id: 'draft', label: 'Draft', shortSide: 720, fps: 30, engine: 'workbench', purpose: 'fast preview of motion' },
	{ id: 'fast', label: 'Fast', shortSide: 720, fps: 30 },
	{ id: 'balanced', label: 'Balanced', shortSide: 1080, fps: 30 },
	{ id: 'best', label: 'Best', shortSide: 1080, fps: 60 }
];

export function getRenderPreset(id: TRenderPreset): TRenderPresetInfo {
	return renderPresets.find((preset) => preset.id === id) ?? (renderPresets[2] as TRenderPresetInfo);
}

/** Preset picker entry: `Draft · 720p · fast preview of motion`, `Balanced · 1080p, 30 fps` */
export function renderPresetOption(preset: TRenderPresetInfo): string {
	return preset.purpose != null ? `${preset.label} · ${preset.shortSide}p · ${preset.purpose}` : `${preset.label} · ${preset.shortSide}p, ${preset.fps} fps`;
}

/** Engine a film renders with: the preset's own engine, or the chosen renderer */
export function filmEngine(preset: TRenderPreset, engine: TRenderEngine): TFilmEngine {
	return getRenderPreset(preset).engine ?? engine;
}

/** `Balanced · 1080p 30 fps` */
export function renderPresetLabel(id: TRenderPreset): string {
	const preset = getRenderPreset(id);
	return `${preset.label} · ${preset.shortSide}p ${preset.fps} fps`;
}

/** Film size in pixels for a frame aspect, with even sides as video encoders expect */
export function filmSize(frame: { width: number; height: number }, preset: TRenderPreset): { width: number; height: number } {
	const { shortSide } = getRenderPreset(preset);
	const isPortrait = frame.height >= frame.width;
	const longSide = even((shortSide * Math.max(frame.width, frame.height)) / Math.min(frame.width, frame.height));
	return isPortrait ? { width: shortSide, height: longSide } : { width: longSide, height: shortSide };
}

/** Frames of a film from frame 0 through the frame showing `duration` */
export function filmFrameCount(duration: number, fps: number): number {
	return Math.max(1, Math.round(duration * fps) + 1);
}

/** A per-frame time measured by an earlier film render */
export interface TMeasuredRender {
	preset: TRenderPreset;
	engine: TFilmEngine;
	msPerFrame: number;
	/** Pixels per frame of that render */
	pixels: number;
}

export interface TExportEstimate {
	frames: number;
	msPerFrame: number | null;
	seconds: number | null;
	/**
	 * `measured` from an earlier film render with this engine, `preview` scaled from the playhead preview,
	 * `typical` from Workbench times measured on the reference fixtures
	 */
	basis: 'measured' | 'preview' | 'typical' | 'none';
}

// Note: Cycles per-frame time is guessed from Eevee previews; a measured Cycles render replaces the guess
const CYCLES_FACTOR = 12;
// Encoding and muxing after the last frame, relative to the render time
const ENCODE_OVERHEAD = 0.05;
// Draft (Workbench) films at 720x1280 measured 53 ms per frame for reference-20 and 70 ms for Jingle Bells
const WORKBENCH_TYPICAL_MS = 70;
const WORKBENCH_TYPICAL_PIXELS = 720 * 1280;

/**
 * Estimated export time: frame count times the per-frame time. A film render measured with the same engine
 * is scaled by pixel count; otherwise the last Eevee playhead preview is scaled to the film size. Workbench
 * (the draft preset) is not comparable with the Eevee preview and falls back to its typical time.
 */
export function estimateExport(options: {
	duration: number;
	frame: { width: number; height: number };
	preset: TRenderPreset;
	engine: TRenderEngine;
	measured?: TMeasuredRender | null;
	preview?: { renderMs: number; width: number; height: number } | null;
}): TExportEstimate {
	const { preset, measured, preview } = options;
	const engine = filmEngine(preset, options.engine);
	const frames = filmFrameCount(options.duration, getRenderPreset(preset).fps);
	const size = filmSize(options.frame, preset);
	const pixels = size.width * size.height;
	let msPerFrame: number | null = null;
	let basis: TExportEstimate['basis'] = 'none';
	if (measured != null && measured.engine === engine && measured.pixels > 0) {
		msPerFrame = measured.msPerFrame * (pixels / measured.pixels);
		basis = 'measured';
	} else if (engine === 'workbench') {
		msPerFrame = WORKBENCH_TYPICAL_MS * (pixels / WORKBENCH_TYPICAL_PIXELS);
		basis = 'typical';
	} else if (preview != null && preview.renderMs > 0 && preview.width * preview.height > 0) {
		msPerFrame = preview.renderMs * (pixels / (preview.width * preview.height)) * (engine === 'cycles' ? CYCLES_FACTOR : 1);
		basis = 'preview';
	}
	const seconds = msPerFrame == null ? null : ((frames * msPerFrame) / 1000) * (1 + ENCODE_OVERHEAD);
	return { frames, msPerFrame, seconds, basis };
}

/** Remaining seconds of a running render from its rate so far, or null before the first frame */
export function remainingExportSeconds(progress: { frame: number | null; frames: number; msPerFrame: number | null }): number | null {
	if (progress.msPerFrame == null || progress.frame == null) return null;
	const left = Math.max(0, progress.frames - progress.frame);
	return ((left * progress.msPerFrame) / 1000) * (1 + ENCODE_OVERHEAD);
}

/** Rough duration for estimates, like Finder's copy sheet: `Less than a minute`, `About 4 minutes`, `About 1 h 20 min` */
export function formatEstimate(seconds: number): string {
	if (seconds < 60) return 'Less than a minute';
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return minutes === 1 ? 'About 1 minute' : `About ${minutes} minutes`;
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest === 0 ? `About ${hours} h` : `About ${hours} h ${rest} min`;
}

/** Clock duration for progress: `0:42`, `12:05`, `1:02:09` */
export function formatClock(seconds: number): string {
	const total = Math.max(0, Math.round(seconds));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const secs = String(total % 60).padStart(2, '0');
	return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
}

/** File name without folders, made safe and ending in `.mp4` */
export function filmFileName(name: string): string {
	const base = (name.split('/').pop() ?? '').replace(/\.mp4$/i, '').replace(/[^\p{L}\p{N} ._-]/gu, '').trim();
	return `${base.length > 0 ? base : 'Film'}.mp4`;
}

function even(value: number): number {
	return Math.round(value / 2) * 2;
}
