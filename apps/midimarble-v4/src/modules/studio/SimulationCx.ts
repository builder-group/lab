import { createState } from 'feature-state';
import type { TEntity, TProject, TVec2 } from '@/modules/project';
import { createSimulationClient, isSuperseded, laneEdits, type TSimulationClient, type TSimulationResult } from '@/modules/simulation';
import { onNextFrame } from './next-frame';
import type { StudioCx } from './StudioCx';

// Seconds past where an edit starts to change the run that a preview simulates while moving
const PREVIEW_HORIZON = 5;
// With no new preview for this long the pointer has paused, and the whole run follows
const PREVIEW_PAUSE_MS = 150;

/**
 * Keeps a simulation result for the open project. Every history change re-simulates once per animation
 * frame in the worker, on a timer when frames have stopped because the window is covered. Live drags send a temporary project through `preview` without touching history,
 * so the trajectory follows the pointer and the drag commits one history entry on release. While a preview keeps
 * moving only the stretch it changes is simulated; a pause or the release runs it whole, so far-off hits catch up then.
 */
export class SimulationCx {
	readonly $result = createState<TSimulationResult | null>(null);
	readonly $computing = createState(false);
	/** True from `startPreview` to `endPreview` */
	readonly $previewing = createState(false);
	/** Wall time from the newest request to its result, in milliseconds */

	private client: TSimulationClient | null = null;
	private preview: TProject | null = null;
	private previewMove: { laneId: string; hitId: string; dot: TVec2 } | null = null;
	/** True while an edit's run waits for the assists to settle it, so its first moment never shows */
	private isHeld = false;
	private isMoving = false;
	private pauseTimer: ReturnType<typeof setTimeout> | null = null;
	private cancelFrame: (() => void) | null = null;
	private sent = 0;
	private accepted = 0;

	constructor(private readonly studio: StudioCx) {}

	mount(): () => void {
		this.client = createSimulationClient();
		let projectId: string | null = null;
		const unlisten = this.studio.$history.subscribe(({ value }) => {
			if (value == null) {
				projectId = null;
				this.clearPreview();
				this.$result.set(null);
				return;
			}
			// Another project's result must not show while the new one simulates
			if (value.present.id !== projectId) {
				projectId = value.present.id;
				this.clearPreview();
				this.$result.set(null);
			}
			this.schedule();
		});
		return () => {
			unlisten();
			this.clearPreview();
			this.cancelFrame?.();
			this.cancelFrame = null;
			this.client?.dispose();
			this.client = null;
		};
	}

	/** True when the shown result belongs to the project as it is now, rather than an older edit */
	get isCurrent(): boolean {
		const result = this.$result.get();
		return result != null && result.revision === this.studio.project?.revision;
	}

	/**
	 * Simulates `project` in place of the history's present until `endPreview`. The next platforms take up the change as
	 * they will when the edit lands, so the preview is what the edit does; `move` is a dragged platform's new dot.
	 */
	startPreview(project: TProject, move: { laneId: string; hitId: string; dot: TVec2 } | null = null): void {
		this.previewMove = move;
		// The first preview runs whole, so a hover's what-if counts every hit it breaks; only the next ones are moving
		this.isMoving = this.preview != null;
		this.preview = project;
		this.$previewing.set(true);
		this.schedule();
		if (this.pauseTimer != null) clearTimeout(this.pauseTimer);
		this.pauseTimer = !this.isMoving
			? null
			: setTimeout(() => {
					this.pauseTimer = null;
					this.isMoving = false;
					this.schedule();
				}, PREVIEW_PAUSE_MS);
	}

	/** Returns to the history's present, usually right after the drag committed its edit */
	endPreview(): void {
		if (this.preview == null) return;
		this.clearPreview();
		this.schedule();
	}

	private clearPreview(): void {
		if (this.pauseTimer != null) clearTimeout(this.pauseTimer);
		this.pauseTimer = null;
		this.isMoving = false;
		this.preview = null;
		this.previewMove = null;
		this.$previewing.set(false);
	}

	get isPreviewing(): boolean {
		return this.preview != null;
	}

	/** The worker client for assists such as Auto place and Continue, while mounted */
	get assists(): TSimulationClient | null {
		return this.client;
	}

	/** The project the shown trajectory is computed for: the drag preview or the history's present */
	get previewProject(): TProject | null {
		return this.preview;
	}

	/** Holds the run of the edit just made until `releaseHold`, which the settled edit follows */
	hold(): void {
		this.isHeld = true;
	}

	releaseHold(): void {
		if (!this.isHeld) return;
		this.isHeld = false;
		this.schedule();
	}

	private schedule(): void {
		if (this.cancelFrame != null) return;
		this.cancelFrame = onNextFrame(() => {
			this.cancelFrame = null;
			this.run();
		});
	}

	private run(): void {
		const project = this.preview ?? this.studio.project;
		const client = this.client;
		if (project == null || client == null || (this.isHeld && this.preview == null)) return;
		const present = this.studio.project;
		const preview = this.preview;
		if (preview == null || present == null || (this.previewMove == null && !laneEdits(present, preview).length)) {
			this.send(client, project);
			return;
		}
		const move = this.previewMove;
		client.settle({ before: present, after: preview, isQuick: true, movedDot: move }).then(
			(answer) => {
				if (this.preview !== preview) return;
				this.send(client, withEntities(preview, answer.entities));
			},
			(error: unknown) => {
				if (!isSuperseded(error) && this.preview === preview) this.send(client, preview);
			}
		);
	}

	private send(client: TSimulationClient, project: TProject): void {
		const id = ++this.sent;
		this.$computing.set(true);
		client.simulate(project, this.isMoving ? PREVIEW_HORIZON : undefined).then(
			(result) => {
				// Requests replaced while waiting resolve with the same newer result, oldest first
				if (id < this.accepted || this.studio.project?.id !== project.id) return;
				this.accepted = id;
				if (result !== this.$result.get()) this.$result.set(result);
				if (id === this.sent) this.$computing.set(false);
			},
			(error: unknown) => {
				if (this.client == null) return;
				if (id === this.sent) this.$computing.set(false);
				this.studio.notify(`Simulation failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
			}
		);
	}
}

/** `project` with these entities in place of the ones of the same id */
function withEntities(project: TProject, entities: TEntity[]): TProject {
	const changed = new Map(entities.map((entity) => [entity.id, entity]));
	return { ...project, entities: project.entities.map((entity) => changed.get(entity.id) ?? entity) };
}
