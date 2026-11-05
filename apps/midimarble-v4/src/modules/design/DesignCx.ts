import { convertFileSrc } from '@tauri-apps/api/core';
import { createState } from 'feature-state';
import { Err, Ok, type TResult } from 'tuple-result';
import { blender, buildSceneDescription, type TApplySceneResult, type TPreviewFrameResult } from '@/modules/blender';
import type { TProject } from '@/modules/project';
import type { TSimulationResult } from '@/modules/simulation';
import type { TCameraAngles } from './camera-orbit';
import { $blenderObjects } from './decor';
import { getRenderPreset } from './export-estimate';
import { sceneSignature } from './live-preview';
import { LivePreviewCx } from './LivePreviewCx';

const PREVIEW_DEBOUNCE_MS = 220;
/** How often an unchanged scene asks Blender what the user added there */
const INSPECT_EVERY_MS = 2000;

/**
 * Keeps the package's Blender scene in step with Compose and renders the current playhead.
 * The worker runs in the background; the user opens the same scene in Blender for detailed work.
 */
export class DesignCx {
	readonly $status = createState<TDesignStatus>('idle');
	readonly $preview = createState<TDesignPreview | null>(null);
	readonly $error = createState<string | null>(null);
	readonly $blenderVersion = createState<string | null>(null);
	/** Link state of app-owned holders by entity ID, from `inspect` after each sync */
	readonly $links = createState<Record<string, TDesignLink>>({});
	/** Camera state the last sync reported; `takenOver` means the user edited it in Blender */
	readonly $camera = createState<TApplySceneResult['camera'] | null>(null);
	/** Set while the next click on the preview places something on the wall */
	readonly $placing = createState<'text' | null>(null);
	/** A title just placed, whose Text field takes focus with its contents selected; the inspector clears it */
	readonly $editingTitle = createState<string | null>(null);
	/** Turn and Tilt of a camera drag in the preview, drawn by the Draft Preview until Blender's still has caught up */
	readonly $orbit = createState<TCameraAngles | null>(null);
	/** Background Blender frames for playback, renewed after every scene sync */
	readonly live: LivePreviewCx;

	private syncedKey: string | null = null;
	private idPixels: TIdPixels | null = null;
	private previewTimer: ReturnType<typeof setTimeout> | undefined;
	private generation = 0;
	private startedFor: string | null = null;
	private queue: Promise<unknown> = Promise.resolve();
	/** Applies that changed the Blender scene without changing the description (discarded Blender changes, a reset camera) */
	private forcedApplies = 0;
	private inspectedAt = 0;
	/** The render generation when a camera drag ended; the first still rendered after it ends the drag's draft */
	private orbitEndedAt: number | null = null;

	constructor(private readonly source: TDesignSource) {
		this.live = new LivePreviewCx({ getPlayhead: () => source.getPlayhead(), isPlaying: () => source.isPlaying() });
	}

	/** Starts Blender for the open package if needed, syncs the scene and renders the playhead */
	async activate(): Promise<void> {
		if (await this.detect()) this.requestPreview(0);
	}

	/** Finds Blender without starting it, so the title bar knows whether it is installed in Compose too */
	async detect(): Promise<boolean> {
		if (!blender.isAvailable()) {
			this.$status.set('unavailable');
			return false;
		}
		const install = await blender.detect();
		if (!install.available) {
			this.$status.set('missing');
			return false;
		}
		this.$blenderVersion.set(install.version);
		if (this.$status.get() === 'missing' || this.$status.get() === 'unavailable') this.$status.set('idle');
		return true;
	}

	/** Saves and stops the worker, then starts it again and renders the playhead */
	async restart(): Promise<void> {
		clearTimeout(this.previewTimer);
		await this.enqueue(async () => {
			const packagePath = this.startedFor;
			this.startedFor = null;
			this.syncedKey = null;
			this.$error.set(null);
			this.$status.set('idle');
			if (packagePath == null) return;
			await blender.save(packagePath);
			await blender.stop(packagePath);
		});
		await this.activate();
	}

	/** The worker's log in the package's bridge folder, once a worker was started for it */
	logPath(): string | null {
		return this.startedFor != null ? `${this.startedFor}/.bridge/worker.log` : null;
	}

	/** Schedules a preview render, coalescing rapid playhead and project changes */
	requestPreview(delay = PREVIEW_DEBOUNCE_MS): void {
		clearTimeout(this.previewTimer);
		const status = this.$status.get();
		if (status === 'unavailable' || status === 'missing') return;
		this.previewTimer = setTimeout(() => void this.enqueue(() => this.renderPreview()), delay);
	}

	/** A camera drag ended: Blender renders the new angle, and the Draft Preview holds until that still is there */
	endOrbit(): void {
		this.orbitEndedAt = this.generation;
		const status = this.$status.get();
		if (status === 'unavailable' || status === 'missing') this.clearOrbit();
		else this.requestPreview(0);
	}

	/** Opens the scene in Blender's window, with `select` the objects to select there */
	async openInBlender(select: string[] = []): Promise<void> {
		const packagePath = this.source.getPackagePath();
		if (packagePath == null) return;
		await this.enqueue(async () => {
			await this.sync();
			const [isShownOk, shownErr] = await blender.show(packagePath);
			if (!isShownOk) this.fail(shownErr.message);
			else if (select.length > 0) {
				const [isSelectedOk, selectedErr] = await blender.selectObjects(packagePath, select);
				if (!isSelectedOk && import.meta.env.DEV) console.warn('[design] select', selectedErr);
			}
			// The background worker was replaced by a window; the next request reapplies the scene
			this.syncedKey = null;
			this.startedFor = packagePath;
		});
	}

	/** Entity ID under a point of the preview, from the object ID image, in 0..1 image coordinates */
	async pick(u: number, v: number): Promise<string | null> {
		const preview = this.$preview.get();
		if (preview == null) return null;
		let pixels = this.idPixels?.url === preview.idUrl ? this.idPixels : null;
		if (pixels == null) {
			const [isLoadedOk, loadedErr, loaded] = await loadIdPixels(preview.idUrl);
			if (!isLoadedOk) {
				if (import.meta.env.DEV) console.warn('[design] object ID image', loadedErr);
				return null;
			}
			pixels = loaded;
			this.idPixels = loaded;
		}
		const x = Math.min(pixels.width - 1, Math.max(0, Math.floor(u * pixels.width)));
		const y = Math.min(pixels.height - 1, Math.max(0, Math.floor(v * pixels.height)));
		const offset = (y * pixels.width + x) * 4;
		const hex = `#${[pixels.data[offset] ?? 0, pixels.data[offset + 1] ?? 0, pixels.data[offset + 2] ?? 0]
			.map((channel) => channel.toString(16).padStart(2, '0'))
			.join('')}`;
		return preview.ids[hex] ?? null;
	}

	/** Discards Blender changes of unlinked holders and lets the app drive them again */
	async relink(entityIds: string[]): Promise<boolean> {
		return this.enqueue(async () => {
			const applied = await this.sync({ relink: entityIds });
			if (applied) this.requestPreview(0);
			return applied;
		});
	}

	/** Rebuilds the follow camera after the user took it over in Blender; ask the user first */
	async regenerateCamera(): Promise<boolean> {
		return this.enqueue(async () => {
			const applied = await this.sync({ regenerateCamera: true });
			if (applied) this.requestPreview(0);
			return applied;
		});
	}

	/** Syncs the scene so a film render sees the project as it is now */
	prepareRender(): Promise<boolean> {
		return this.enqueue(() => this.sync());
	}

	/** One frame of the film from Blender, with the scene as it is now, for an agent to look at */
	renderStill(time: number, width: number): Promise<TResult<TPreviewFrameResult, Error>> {
		return this.enqueue(async () => {
			const isSynced = await this.sync();
			const packagePath = this.source.getPackagePath();
			if (!isSynced || packagePath == null) return Err(new Error(this.$error.get() ?? "Blender couldn't prepare the frame. Wait for the track to update, then try again."));
			this.$status.set('rendering');
			const [isFrameOk, frameErr, frame] = await blender.previewFrame(packagePath, { time, width });
			this.$status.set(isFrameOk ? 'ready' : 'error');
			return isFrameOk ? Ok(frame) : Err(new Error(frameErr.message));
		});
	}

	/** Reads link states of app-owned objects from Blender */
	async refreshLinks(): Promise<void> {
		const packagePath = this.startedFor;
		if (packagePath == null) return;
		this.inspectedAt = Date.now();
		const [isInspectOk, inspectErr, inspected] = await blender.inspect(packagePath);
		if (!isInspectOk) {
			if (import.meta.env.DEV) console.warn('[design] inspect', inspectErr);
			return;
		}
		const links: Record<string, TDesignLink> = {};
		for (const holder of inspected.holders) links[holder.mmId] = { link: holder.link, reason: holder.reason };
		this.$links.set(links);
		const objects = inspected.madeInBlender ?? [];
		if (JSON.stringify(objects) !== JSON.stringify($blenderObjects.get())) $blenderObjects.set(objects);
	}

	/** Saves and stops the worker of the package that was open */
	async close(): Promise<void> {
		clearTimeout(this.previewTimer);
		this.live.close();
		const packagePath = this.startedFor;
		this.startedFor = null;
		this.syncedKey = null;
		this.idPixels = null;
		this.$preview.set(null);
		this.$links.set({});
		$blenderObjects.set([]);
		this.$camera.set(null);
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

	private async sync(options: { relink?: string[]; regenerateCamera?: boolean } = {}): Promise<boolean> {
		const project = this.source.getProject();
		const result = this.source.getResult();
		const packagePath = this.source.getPackagePath();
		if (project == null || result == null || packagePath == null) return false;
		if (!(await this.ensureStarted(packagePath))) return false;
		const fps = renderFps(project);
		const key = `${packagePath}:${result.revision}:${fps}`;
		const isForced = (options.relink?.length ?? 0) > 0 || options.regenerateCamera === true;
		if (this.syncedKey === key && !isForced) {
			// An object added in Blender since the last look shows up in Layers once the app next talks to Blender
			if (Date.now() - this.inspectedAt > INSPECT_EVERY_MS) void this.refreshLinks();
			return true;
		}
		this.$status.set('syncing');
		const build = buildSceneDescription(project, result, { fps });
		const [isAppliedOk, appliedErr, applied] = await blender.applyScene(packagePath, build, options);
		if (!isAppliedOk) {
			this.fail(appliedErr.message);
			return false;
		}
		if (import.meta.env.DEV) console.debug('[design] apply_scene', applied);
		this.$camera.set(applied.camera);
		this.syncedKey = key;
		if (isForced) this.forcedApplies++;
		this.live.sceneApplied(packagePath, sceneSignature(build, String(this.forcedApplies)), applied);
		void this.refreshLinks();
		return true;
	}

	private async renderPreview(): Promise<void> {
		const generation = ++this.generation;
		if (!(await this.sync())) {
			this.clearOrbit();
			return;
		}
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
		if (this.orbitEndedAt != null && generation > this.orbitEndedAt) this.clearOrbit();
	}

	clearOrbit(): void {
		this.orbitEndedAt = null;
		this.$orbit.set(null);
	}

	private fail(message: string): void {
		this.clearOrbit();
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
	isPlaying: () => boolean;
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
	return getRenderPreset(project.design.renderPreset).fps;
}

export interface TDesignLink {
	link: 'linked' | 'unlinked';
	/** Why a holder is unlinked: `marked`, `transform` or `keyframes` */
	reason: string | null;
}

interface TIdPixels {
	url: string;
	width: number;
	height: number;
	data: Uint8ClampedArray;
}

function toPreview(frame: TPreviewFrameResult, revision: number): TDesignPreview {
	// Note: no query string for cache busting. Tauri's asset protocol reads it as part of the file path, and
	// the worker writes every render under a new file name anyway.
	return {
		url: convertFileSrc(frame.path),
		idUrl: convertFileSrc(frame.idPath),
		ids: frame.ids,
		width: frame.width,
		height: frame.height,
		time: frame.time,
		revision,
		renderMs: frame.renderMs
	};
}

/**
 * Decodes the object ID image from its bytes. Drawing an asset-protocol `<img>` into a canvas can taint it,
 * so the pixels are read from a fetched blob, which is never cross-origin.
 */
async function loadIdPixels(url: string): Promise<TResult<TIdPixels, Error>> {
	try {
		const response = await fetch(url);
		if (!response.ok) return Err(new Error(`The object ID image could not be loaded (${response.status})`));
		const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
		const canvas = document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const context = canvas.getContext('2d', { willReadFrequently: true });
		if (context == null) return Err(new Error('No 2D canvas for the object ID image'));
		context.drawImage(bitmap, 0, 0);
		bitmap.close();
		return Ok({ url, width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data });
	} catch (error) {
		return Err(error instanceof Error ? error : new Error(String(error)));
	}
}
