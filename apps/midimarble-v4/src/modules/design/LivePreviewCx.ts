import { createState } from 'feature-state';
import { blender, type TApplySceneResult } from '@/modules/blender';
import {
	frameIndexAt,
	LIVE_PREVIEW_FPS,
	LIVE_PREVIEW_LEAD,
	LIVE_PREVIEW_WIDTH,
	previewFrameOrder,
	previewTimeline,
	type TLivePreviewFrames
} from './live-preview';

const STORAGE_KEY = 'mm.draftPreview';
const POLL_MS = 400;
/** Milliseconds without an edit, a scrub or playback before the job renders again, like Final Cut's background render */
const IDLE_MS = 1500;
/** A finished job restarts at most this often for frames it has not rendered yet */
const RESTART_MS = 3000;
/** A running job whose status has not changed for this long is taken as stopped; its first Eevee frames can take a while */
const SILENT_MS = 60_000;

/**
 * The real look of Film in the background, like Final Cut's and After Effects' background render: after each scene
 * sync a separate Blender process renders small frames with Fast lighting around and ahead of the playhead, then
 * outward. Film plays them where they exist and draws the Draft Preview where not. The job pauses while the person
 * works, plays or scrubs, and goes on from the playhead a moment after they stop.
 */
export class LivePreviewCx {
	/** Whether Film shows the real look; the View menu's Draft Preview turns it off, which also saves CPU and battery */
	readonly $enabled = createState(!readIsDraftPreview());
	/** Frames of the current scene on disk */
	readonly $frames = createState<TLivePreviewFrames | null>(null);
	/** Whether the job is rendering now, for the Blender chip and the render bar's tooltip */
	readonly $isRendering = createState(false);

	private packagePath: string | null = null;
	private signature: string | null = null;
	private timeline: { fps: number; startTime: number; total: number } | null = null;
	private isActive = false;
	private isRunning = false;
	private isStarting = false;
	private isWorking = false;
	private lastStartAt = -Infinity;
	private failedSignature: string | null = null;
	private pid: number | null = null;
	private pollTimer: ReturnType<typeof setInterval> | undefined;
	private idleTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly source: { getPlayhead: () => number; isPlaying: () => boolean }) {}

	/** The scene Blender has now; a new signature starts a new job and the old frames stop showing */
	sceneApplied(packagePath: string, signature: string, applied: Pick<TApplySceneResult, 'fps' | 'frameStart' | 'frameEnd'>): void {
		if (this.signature === signature && this.packagePath === packagePath) return;
		this.stopJob();
		this.packagePath = packagePath;
		this.signature = signature;
		this.timeline = previewTimeline(applied);
		const { fps, startTime, total } = this.timeline;
		this.$frames.set({ signature, folder: '', fps, startTime, total, rendered: new Set() });
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
		writeIsDraftPreview(!isEnabled);
		if (isEnabled) this.ensureJob(true);
		else this.stopJob();
	}

	/** The person is working: the job holds still, keeping its scene and shaders, and goes on from the playhead a moment after they stop */
	pauseForWork(): void {
		clearTimeout(this.idleTimer);
		this.idleTimer = setTimeout(() => this.resume(), IDLE_MS);
		if (this.isWorking) return;
		this.isWorking = true;
		this.updateIsRendering();
		if (this.isRunning) this.sendTarget({ order: [], paused: true });
	}

	/** Stops the job and forgets the scene, when the project closes */
	close(): void {
		clearTimeout(this.idleTimer);
		this.isWorking = false;
		this.stopJob();
		this.packagePath = null;
		this.signature = null;
		this.timeline = null;
		this.failedSignature = null;
		this.$frames.set(null);
	}

	// MARK: - Internals

	private canRender(): boolean {
		return this.isActive && this.$enabled.get() && this.packagePath != null && this.signature != null && this.signature !== this.failedSignature && blender.isAvailable();
	}

	/** The idle timer ran out; playback counts as work until it stops, which starts the timer again */
	private resume(): void {
		if (this.source.isPlaying()) return;
		this.isWorking = false;
		this.updateIsRendering();
		if (this.isRunning) this.sendTarget(this.targetAtPlayhead());
		else this.ensureJob(true);
	}

	private targetAtPlayhead(): { order: number[]; paused: boolean } {
		const timeline = this.timeline;
		if (timeline == null) return { order: [], paused: this.isWorking };
		const frame = frameIndexAt(this.source.getPlayhead(), timeline.fps, timeline.startTime);
		return { order: previewFrameOrder(frame, timeline.total, LIVE_PREVIEW_LEAD), paused: this.isWorking };
	}

	/** Starts the job when frames are missing; `force` skips the restart throttle */
	private ensureJob(force: boolean): void {
		const timeline = this.timeline;
		const frames = this.$frames.get();
		if (!this.canRender() || timeline == null || frames == null || this.isRunning || this.isStarting || this.isWorking) return;
		if (!force && Date.now() - this.lastStartAt < RESTART_MS) return;
		if (frames.rendered.size >= timeline.total && frames.folder !== '') return;
		void this.start();
	}

	private async start(): Promise<void> {
		const packagePath = this.packagePath;
		const signature = this.signature;
		if (packagePath == null || signature == null) return;
		this.isStarting = true;
		this.lastStartAt = Date.now();
		const [isStartedOk, startedErr, started] = await blender.startPreviewRender(packagePath, {
			signature,
			fps: LIVE_PREVIEW_FPS,
			width: LIVE_PREVIEW_WIDTH,
			...this.targetAtPlayhead()
		});
		this.isStarting = false;
		if (signature !== this.signature || !this.canRender()) {
			if (isStartedOk) void blender.cancelPreviewRender(packagePath, signature);
			// The scene changed while Blender saved the old one
			this.ensureJob(true);
			return;
		}
		if (!isStartedOk) {
			if (import.meta.env.DEV) console.warn('[live preview] start', startedErr);
			return;
		}
		this.timeline = { fps: started.fps, startTime: started.startTime, total: started.frames };
		this.pid = started.pid;
		this.setRunning(true);
		this.startPolling();
		// The person went back to work while Blender saved the scene
		if (this.isWorking) this.sendTarget({ order: [], paused: true });
	}

	private sendTarget(target: { order: number[]; paused: boolean }): void {
		const packagePath = this.packagePath;
		const signature = this.signature;
		if (packagePath == null || signature == null) return;
		void blender.targetPreviewRender(packagePath, signature, target).then(([isTargetOk, targetErr]) => {
			if (!isTargetOk && import.meta.env.DEV) console.warn('[live preview] target', targetErr);
		});
	}

	private stopJob(): void {
		clearInterval(this.pollTimer);
		this.pollTimer = undefined;
		if (this.isRunning && this.packagePath != null && this.signature != null) void blender.cancelPreviewRender(this.packagePath, this.signature);
		this.setRunning(false);
	}

	private setRunning(isRunning: boolean): void {
		this.isRunning = isRunning;
		this.updateIsRendering();
	}

	private updateIsRendering(): void {
		this.$isRendering.set(this.isRunning && !this.isWorking);
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
		if (current == null || current.folder !== listed.folder || current.rendered.size !== listed.frames.length) {
			this.$frames.set({ signature, folder: listed.folder, ...timeline, rendered: new Set(listed.frames) });
		}
		// Only this run's status counts; the folder keeps the status of an earlier run until the new one writes
		const status = listed.status?.pid === this.pid ? listed.status : null;
		// A job stopped without a last word (the worker restarted) leaves a status that no longer updates
		const isSilent = Date.now() - Math.max(this.lastStartAt, (status?.updatedAt ?? 0) * 1000) > SILENT_MS;
		if (this.isRunning && ((status != null && status.state !== 'rendering') || isSilent)) {
			clearInterval(this.pollTimer);
			this.pollTimer = undefined;
			this.setRunning(false);
			if (status?.state === 'failed' || isSilent) {
				// Starting a job that can't run again and again would save the scene each time for nothing
				this.failedSignature = signature;
				if (import.meta.env.DEV) console.warn('[live preview] failed', status?.error ?? 'no status');
			} else {
				this.ensureJob(false);
			}
		}
	}
}

function readIsDraftPreview(): boolean {
	try {
		return localStorage.getItem(STORAGE_KEY) === 'on';
	} catch {
		return false;
	}
}

function writeIsDraftPreview(isDraft: boolean): void {
	try {
		localStorage.setItem(STORAGE_KEY, isDraft ? 'on' : 'off');
	} catch {
		// A blocked storage keeps the choice for this session only
	}
}
