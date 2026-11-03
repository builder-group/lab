import { convertFileSrc } from '@tauri-apps/api/core';
import { createState } from 'feature-state';
import { blender, buildSceneDescription, type TPreviewFrameResult } from '@/modules/blender';
import type { TProject } from '@/modules/project';
import type { TSimulationResult } from '@/modules/simulation';

const PREVIEW_DEBOUNCE_MS = 220;

/**
 * Keeps the package's Blender scene in step with Compose and renders the current playhead.
 * The worker runs in the background; the user opens the same scene in Blender for detailed work.
 */
export class DesignCx {
	readonly $status = createState<TDesignStatus>('idle');
	readonly $preview = createState<TDesignPreview | null>(null);
	readonly $error = createState<string | null>(null);
	readonly $blenderVersion = createState<string | null>(null);

	private syncedKey: string | null = null;
	private previewTimer: ReturnType<typeof setTimeout> | undefined;
	private generation = 0;
	private startedFor: string | null = null;
	private queue: Promise<unknown> = Promise.resolve();

	constructor(private readonly source: TDesignSource) {}

	/** Starts Blender for the open package if needed, syncs the scene and renders the playhead */
	async activate(): Promise<void> {
		if (!blender.isAvailable()) {
			this.$status.set('unavailable');
			return;
		}
		const install = await blender.detect();
		if (!install.available) {
			this.$status.set('missing');
			return;
		}
		this.$blenderVersion.set(install.version);
		this.requestPreview(0);
	}

	/** Schedules a preview render, coalescing rapid playhead and project changes */
	requestPreview(delay = PREVIEW_DEBOUNCE_MS): void {
		clearTimeout(this.previewTimer);
		const status = this.$status.get();
		if (status === 'unavailable' || status === 'missing') return;
		this.previewTimer = setTimeout(() => void this.enqueue(() => this.renderPreview()), delay);
	}

	async openInBlender(): Promise<void> {
		const packagePath = this.source.getPackagePath();
		if (packagePath == null) return;
		await this.enqueue(async () => {
			await this.sync();
			const [isShownOk, shownErr] = await blender.show(packagePath);
			if (!isShownOk) this.fail(shownErr.message);
			// The background worker was replaced by a window; the next request reapplies the scene
			this.syncedKey = null;
			this.startedFor = packagePath;
		});
	}

	/** Entity ID under a point of the preview, from the object ID image, in 0..1 image coordinates */
	async pick(u: number, v: number): Promise<string | null> {
		const preview = this.$preview.get();
		if (preview == null) return null;
		const image = await loadImage(preview.idUrl);
		const canvas = document.createElement('canvas');
		canvas.width = image.naturalWidth;
		canvas.height = image.naturalHeight;
		const context = canvas.getContext('2d', { willReadFrequently: true });
		if (context == null) return null;
		context.drawImage(image, 0, 0);
		const x = Math.min(canvas.width - 1, Math.max(0, Math.floor(u * canvas.width)));
		const y = Math.min(canvas.height - 1, Math.max(0, Math.floor(v * canvas.height)));
		const [r = 0, g = 0, b = 0] = context.getImageData(x, y, 1, 1).data;
		const hex = `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
		return preview.ids[hex] ?? null;
	}

	/** Saves and stops the worker of the package that was open */
	async close(): Promise<void> {
		clearTimeout(this.previewTimer);
		const packagePath = this.startedFor;
		this.startedFor = null;
		this.syncedKey = null;
		this.$preview.set(null);
		this.$status.set('idle');
		if (packagePath == null) return;
		await blender.save(packagePath);
		await blender.stop(packagePath);
	}

	// MARK: - Internals

	private enqueue<GValue>(task: () => Promise<GValue>): Promise<GValue> {
		const run = this.queue.then(task, task);
		this.queue = run.catch(() => undefined);
		return run;
	}

	private async ensureStarted(packagePath: string): Promise<boolean> {
		if (this.startedFor === packagePath) {
			const status = await blender.status(packagePath);
			if (status.running) return true;
		}
		this.$status.set('starting');
		const [isStartedOk, startedErr] = await blender.start(packagePath);
		if (!isStartedOk) {
			this.fail(startedErr.message);
			return false;
		}
		this.startedFor = packagePath;
		this.syncedKey = null;
		return true;
	}

	private async sync(): Promise<boolean> {
		const project = this.source.getProject();
		const result = this.source.getResult();
		const packagePath = this.source.getPackagePath();
		if (project == null || result == null || packagePath == null) return false;
		if (!(await this.ensureStarted(packagePath))) return false;
		const fps = renderFps(project);
		const key = `${packagePath}:${result.revision}:${fps}`;
		if (this.syncedKey === key) return true;
		this.$status.set('syncing');
		const build = buildSceneDescription(project, result, { fps });
		const [isAppliedOk, appliedErr] = await blender.applyScene(packagePath, build);
		if (!isAppliedOk) {
			this.fail(appliedErr.message);
			return false;
		}
		this.syncedKey = key;
		return true;
	}

	private async renderPreview(): Promise<void> {
		const generation = ++this.generation;
		if (!(await this.sync())) return;
		const packagePath = this.source.getPackagePath();
		if (packagePath == null || generation !== this.generation) return;
		const time = this.source.getPlayhead();
		this.$status.set('rendering');
		const [isFrameOk, frameErr, frame] = await blender.previewFrame(packagePath, { time, width: 540 });
		if (!isFrameOk) {
			this.fail(frameErr.message);
			return;
		}
		this.$error.set(null);
		this.$preview.set(toPreview(frame, this.source.getResult()?.revision ?? 0));
		this.$status.set('ready');
	}

	private fail(message: string): void {
		this.$error.set(message);
		this.$status.set('error');
	}
}

export type TDesignStatus = 'idle' | 'unavailable' | 'missing' | 'starting' | 'syncing' | 'rendering' | 'ready' | 'error';

export interface TDesignSource {
	getProject: () => TProject | null;
	getResult: () => TSimulationResult | null;
	getPackagePath: () => string | null;
	getPlayhead: () => number;
}

export interface TDesignPreview {
	url: string;
	idUrl: string;
	ids: Record<string, string>;
	width: number;
	height: number;
	time: number;
	revision: number;
	renderMs: number;
}

export function renderFps(project: TProject): number {
	return project.design.renderPreset === 'best' ? 60 : 30;
}

function toPreview(frame: TPreviewFrameResult, revision: number): TDesignPreview {
	// The worker reuses file names, so a query string forces the webview to load the new render
	const stamp = `?v=${Date.now()}`;
	return {
		url: `${convertFileSrc(frame.path)}${stamp}`,
		idUrl: `${convertFileSrc(frame.idPath)}${stamp}`,
		ids: frame.ids,
		width: frame.width,
		height: frame.height,
		time: frame.time,
		revision,
		renderMs: frame.renderMs
	};
}

function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.crossOrigin = 'anonymous';
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error('The object ID image could not be loaded'));
		image.src = url;
	});
}
