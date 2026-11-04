import { createState } from 'feature-state';
import { blender, type TApplySceneResult, type TPreviewRenderStatus } from '@/modules/blender';
import {
	frameIndexAt,
	LIVE_PREVIEW_FPS,
	LIVE_PREVIEW_LEAD,
	LIVE_PREVIEW_REFINE,
	LIVE_PREVIEW_WIDTH,
	previewFrameOrder,
	previewTimeline,
	refineFrames,
	type TLivePreviewFrames
} from './live-preview';

const STORAGE_KEY = 'mm.livePreview';
const POLL_MS = 400;
/** The job's target moves when the playhead is this many frames away from the last one */
const RETARGET_FRAMES = LIVE_PREVIEW_FPS / 2;
/** A finished job restarts at most this often for frames it has not rendered yet */
const RESTART_MS = 3000;
/** A running job whose status has not changed for this long is taken as stopped */
const SILENT_MS = 30_000;

/**
 * Background Blender preview frames for Film playback, like Final Cut's background render: after each scene
 * sync a separate Blender process renders small Flat Light frames around and ahead of the playhead, then outward,
 * then refines the frames ahead of the playhead with Fast lighting. Film shows them while playing or scrubbing.
 */
export class LivePreviewCx {
	/** Live Preview in the Blender chip's menu; on by default, off saves CPU and battery */
	readonly $enabled = createState(readEnabled());
	/** Frames of the current scene on disk */
	readonly $frames = createState<TLivePreviewFrames | null>(null);
	/** Whether the job is rendering, for the Blender chip and the render bar's tooltip */
	readonly $isRendering = createState(false);
	/** The job's last status, with its timing */
	readonly $status = createState<TPreviewRenderStatus | null>(null);

	private packagePath: string | null = null;
	private signature: string | null = null;
	private timeline: { fps: number; startTime: number; total: number } | null = null;
	private isActive = false;
	private isRunning = false;
	private isStarting = false;
	private lastStartAt = -Infinity;
	private targetFrame: number | null = null;
	private pid: number | null = null;
	private pollTimer: ReturnType<typeof setInterval> | undefined;

	constructor(private readonly source: { getPlayhead: () => number; isPlaying: () => boolean }) {}

	/** The scene Blender has now; a new signature starts a new job and the old frames stop showing */
	sceneApplied(packagePath: string, signature: string, applied: Pick<TApplySceneResult, 'fps' | 'frameStart' | 'frameEnd'>): void {
		if (this.signature === signature && this.packagePath === packagePath) return;
		this.stopJob();
		this.packagePath = packagePath;
		this.signature = signature;
		this.timeline = previewTimeline(applied);
		const { fps, startTime, total } = this.timeline;
		this.$frames.set({ signature, folder: '', fps, startTime, total, flat: new Set(), fast: new Set() });
		void this.refresh();
		this.ensureJob(true);
	}

	/** Film is open; outside it the job stops and its frames stay for later */
	setActive(isActive: boolean): void {
		this.isActive = isActive;
		if (isActive) this.ensureJob(true);
		else this.stopJob();
	}

	setEnabled(isEnabled: boolean): void {
		this.$enabled.set(isEnabled);
		writeEnabled(isEnabled);
		if (isEnabled) this.ensureJob(true);
		else this.stopJob();
	}

	/**
	 * The playhead moved: the job renders around the new place first. `isForced` retargets even for a small move,
	 * such as when playback stops and the refine pass may start.
	 */
	follow(time: number, isForced = false): void {
		const timeline = this.timeline;
		if (timeline == null || !this.canRender()) return;
		const frame = frameIndexAt(time, timeline.fps, timeline.startTime);
		if (this.isRunning) {
			if (isForced || this.targetFrame == null || Math.abs(frame - this.targetFrame) >= RETARGET_FRAMES) void this.retarget(frame);
			return;
		}
		this.ensureJob(false);
	}

	/** Stops the job and forgets the scene, when the project closes */
	close(): void {
		this.stopJob();
		this.packagePath = null;
		this.signature = null;
		this.timeline = null;
		this.$frames.set(null);
		this.$status.set(null);
	}

	// MARK: - Internals

	private canRender(): boolean {
		return this.isActive && this.$enabled.get() && this.packagePath != null && this.signature != null && blender.isAvailable();
	}

	private target(frame: number): { order: number[]; refine: number[] } {
		const total = this.timeline?.total ?? 0;
		// Fast frames take about 15 times longer than Flat Light ones and could never keep up with playback
		const refine = this.source.isPlaying() ? [] : refineFrames(frame, total, LIVE_PREVIEW_REFINE);
		return { order: previewFrameOrder(frame, total, LIVE_PREVIEW_LEAD), refine };
	}

	/** Starts the job when frames near the playhead are missing; `force` skips the restart throttle */
	private ensureJob(force: boolean): void {
		const timeline = this.timeline;
		const frames = this.$frames.get();
		if (!this.canRender() || timeline == null || frames == null || this.isRunning || this.isStarting) return;
		if (!force && Date.now() - this.lastStartAt < RESTART_MS) return;
		const frame = frameIndexAt(this.source.getPlayhead(), timeline.fps, timeline.startTime);
		const target = this.target(frame);
		const isComplete = frames.flat.size >= timeline.total && target.refine.every((index) => frames.fast.has(index));
		if (isComplete && frames.folder !== '') return;
		void this.start(frame, target);
	}

	private async start(frame: number, target: { order: number[]; refine: number[] }): Promise<void> {
		const packagePath = this.packagePath;
		const signature = this.signature;
		if (packagePath == null || signature == null) return;
		this.isStarting = true;
		this.lastStartAt = Date.now();
		const [isStartedOk, startedErr, started] = await blender.startPreviewRender(packagePath, {
			signature,
			fps: LIVE_PREVIEW_FPS,
			width: LIVE_PREVIEW_WIDTH,
			...target
		});
		this.isStarting = false;
		if (signature !== this.signature || !this.canRender()) {
			if (isStartedOk) void blender.cancelPreviewRender(packagePath, signature);
			return;
		}
		if (!isStartedOk) {
			if (import.meta.env.DEV) console.warn('[live preview] start', startedErr);
			return;
		}
		this.timeline = { fps: started.fps, startTime: started.startTime, total: started.frames };
		this.targetFrame = frame;
		this.pid = started.pid;
		this.setRunning(true);
		this.startPolling();
	}

	private async retarget(frame: number): Promise<void> {
		const packagePath = this.packagePath;
		const signature = this.signature;
		if (packagePath == null || signature == null) return;
		this.targetFrame = frame;
		const [isTargetOk, targetErr] = await blender.targetPreviewRender(packagePath, signature, this.target(frame));
		if (!isTargetOk && import.meta.env.DEV) console.warn('[live preview] target', targetErr);
	}

	private stopJob(): void {
		clearInterval(this.pollTimer);
		this.pollTimer = undefined;
		if (this.isRunning && this.packagePath != null && this.signature != null) void blender.cancelPreviewRender(this.packagePath, this.signature);
		this.targetFrame = null;
		this.setRunning(false);
	}

	private setRunning(isRunning: boolean): void {
		this.isRunning = isRunning;
		this.$isRendering.set(isRunning);
	}

	private startPolling(): void {
		clearInterval(this.pollTimer);
		this.pollTimer = setInterval(() => void this.refresh(), POLL_MS);
	}

	/** Reads the frames on disk and the job's status */
	private async refresh(): Promise<void> {
		const packagePath = this.packagePath;
		const signature = this.signature;
		const timeline = this.timeline;
		if (packagePath == null || signature == null || timeline == null || !blender.isAvailable()) return;
		const [isListedOk, listedErr, listed] = await blender.previewFrames(packagePath, signature);
		if (signature !== this.signature) return;
		if (!isListedOk) {
			if (import.meta.env.DEV) console.warn('[live preview] frames', listedErr);
			return;
		}
		const current = this.$frames.get();
		if (current == null || current.folder !== listed.folder || current.flat.size !== listed.flat.length || current.fast.size !== listed.fast.length) {
			this.$frames.set({ signature, folder: listed.folder, ...timeline, flat: new Set(listed.flat), fast: new Set(listed.fast) });
		}
		this.$status.set(listed.status);
		// Only this run's status counts; the folder keeps the status of an earlier run until the new one writes
		const status = listed.status?.pid === this.pid ? listed.status : null;
		// A job stopped without a last word (the worker restarted) leaves a status that no longer updates
		const isSilent = Date.now() - Math.max(this.lastStartAt, (status?.updatedAt ?? 0) * 1000) > SILENT_MS;
		if (this.isRunning && ((status != null && status.state !== 'rendering') || isSilent)) {
			clearInterval(this.pollTimer);
			this.pollTimer = undefined;
			this.setRunning(false);
			if (status?.state === 'failed' && import.meta.env.DEV) console.warn('[live preview] failed', status.error);
			if (status?.state === 'done') this.ensureJob(false);
		}
	}
}

function readEnabled(): boolean {
	try {
		return localStorage.getItem(STORAGE_KEY) !== 'off';
	} catch {
		return true;
	}
}

function writeEnabled(isEnabled: boolean): void {
	try {
		localStorage.setItem(STORAGE_KEY, isEnabled ? 'on' : 'off');
	} catch {
		// A blocked storage keeps the choice for this session only
	}
}
