import { createState } from 'feature-state';
import type { TEntity, TProject, TProjectHistory, TVec2 } from '@/modules/project';
import { createSimulationClient, isSuperseded, laneEdits, type TSettleAnswer, type TSimulationClient, type TSimulationResult } from '@/modules/simulation';
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
	/** Why the platform being dragged can't play its note where the pointer is, for its chip */
	readonly $moveLimit = createState<TMoveLimit | null>(null);
	/** Wall time from the newest request to its result, in milliseconds */

	private client: TSimulationClient | null = null;
	private preview: TProject | null = null;
	private previewMove: { laneId: string; hitId: string; dot: TVec2 } | null = null;
	private isMoving = false;
	/** The pointer has paused, so the preview asks what the drop will do: every way, not the first */
	private isPaused = false;
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
				this.settled = null;
				return;
			}
			// Another project's result must not show while the new one simulates
			if (value.present.id !== projectId) {
				projectId = value.present.id;
				this.clearPreview();
				this.$result.set(null);
			}
			this.settleLatestEdit(value);
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
		this.isPaused = false;
		this.preview = project;
		this.$previewing.set(true);
		this.schedule();
		if (this.pauseTimer != null) clearTimeout(this.pauseTimer);
		this.pauseTimer = !this.isMoving
			? null
			: setTimeout(() => {
					this.pauseTimer = null;
					this.isMoving = false;
					this.isPaused = true;
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
		this.isPaused = false;
		this.preview = null;
		this.previewMove = null;
		if (this.$moveLimit.get() != null) this.$moveLimit.set(null);
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

	// MARK: - Local edits

	/** The history whose present has settled: what the next edit is compared with */
	private settled: TProjectHistory | null = null;
	private seenHistory: TProjectHistory | null = null;
	private settleRun = 0;
	private isLanding = false;
	/** True from an edit until the platforms taking up its change have landed; its own run waits until then */
	isSettling = false;

	/**
	 * After an edit, the next platforms take up the change so the rest of the run stays as it was, folded into the edit's
	 * undo step. Until the answer lands the edit's own run stays back, so a marble's first wild moment never shows. Undo,
	 * redo and what Build Track and Fix Hits commit themselves are left alone. This is the one way edits reach the run, a
	 * person's or an agent's.
	 */
	private settleLatestEdit(history: TProjectHistory): void {
		if (this.isLanding) return;
		const known = this.settled;
		const seen = this.seenHistory;
		this.seenHistory = history;
		const assist = this.studio.$compose.get()?.assist;
		const isStep = seen != null && (seen.past.at(-1)?.entities === history.present.entities || seen.future[0]?.entities === history.present.entities);
		if (known == null || this.client == null || known.present.id !== history.present.id || isStep || assist?.isBuilding === true || assist?.isReplacing === true) {
			this.settleRun++;
			this.settled = history;
			this.stopSettling();
			return;
		}
		const before = known.present;
		const after = history.present;
		if (!laneEdits(before, after).length) {
			if (!this.isSettling) this.settled = history;
			return;
		}
		const run = ++this.settleRun;
		this.isSettling = true;
		this.client.settle({ before, after }).then(
			(answer) => {
				if (run !== this.settleRun || this.studio.project?.revision !== after.revision) return;
				this.landSettled(answer.entities, true);
				this.sayBreak(answer, after);
			},
			(error: unknown) => {
				if (run !== this.settleRun || isSuperseded(error)) return;
				this.landSettled([], true);
				this.studio.notify(`The rest of the run couldn't be kept: ${error instanceof Error ? error.message : String(error)}`, 'error');
			}
		);
	}

	/** Lands what a settle found, in the edit's undo step or as its own */
	landSettled(entities: TEntity[], isAmend: boolean): void {
		this.isLanding = true;
		try {
			if (entities.length > 0) this.studio.execute(entities.map((entity) => ({ type: 'upsertEntity', entity })), { amend: isAmend });
		} finally {
			this.isLanding = false;
		}
		const history = this.studio.$history.get();
		this.settled = history;
		this.seenHistory = history;
		this.stopSettling();
	}

	private stopSettling(): void {
		if (!this.isSettling) return;
		this.isSettling = false;
		this.schedule();
	}

	/**
	 * A platform dragged off its dot: the platform before it sends the marble to the new spot and the next ones bring it
	 * back on the old run, as one undo step. A spot it can't send the marble to takes the platform as far as it can; one
	 * that fixes the spot (a ride, or the first note) leaves it where it was. Either way a notice says why.
	 */
	async moveDot(move: { laneId: string; hitId: string; dot: TVec2 }): Promise<void> {
		const project = this.studio.project;
		if (project == null || this.client == null) return;
		const run = ++this.settleRun;
		this.isSettling = true;
		try {
			const answer = await this.client.settle({ before: project, after: project, movedDot: move });
			if (run !== this.settleRun || this.studio.project?.revision !== project.revision) return;
			const limit = moveLimit(project, move, answer);
			// Nothing moved, so nothing lands: no undo step for a drop that didn't happen
			this.landSettled(limit?.isStuck === true ? [] : answer.entities, false);
			if (limit?.isStuck === true) this.studio.notify(limit.notice);
			else if (limit != null) this.studio.notifyEdit(limit.notice);
			this.sayBreak(answer, project);
		} catch (error) {
			if (run !== this.settleRun || isSuperseded(error)) return;
			this.landSettled([], false);
			this.studio.notify(`The platform couldn't be moved: ${error instanceof Error ? error.message : String(error)}`, 'error');
		}
	}

	/** A break to name, once the run of the edit shows the hit really is broken, so the notice agrees with the summary */
	private pendingBreak: { first: TSettleAnswer['heldFrom'][number]; project: TProject; revision: number } | null = null;

	/** Names what happened only when it matters: a break the next platforms couldn't take up */
	private sayBreak(answer: TSettleAnswer, project: TProject): void {
		const [first] = answer.heldFrom;
		if (first == null) return;
		this.pendingBreak = { first, project, revision: this.studio.project?.revision ?? 0 };
	}

	private sayPendingBreak(result: TSimulationResult): void {
		const pending = this.pendingBreak;
		if (pending == null || result.revision < pending.revision) return;
		this.pendingBreak = null;
		const { first, project } = pending;
		const status = result.hits.find((hit) => hit.laneId === first.laneId && hit.hitId === first.hitId)?.status;
		if (result.revision !== pending.revision || status == null || status === 'onTime' || status === 'drifting' || status === 'waiting') return;
		const lane = project.music.lanes.find((item) => item.id === first.laneId);
		const number = (lane?.hits.findIndex((hit) => hit.id === first.hitId) ?? -1) + 1;
		const waiting = project.entities.filter((entity) => entity.components.hitLink?.laneId === first.laneId && (lane?.hits.find((hit) => hit.id === entity.components.hitLink?.hitId)?.time ?? -1) > first.time).length;
		const later = waiting === 1 ? 'The piece after it waits' : `The ${waiting} pieces after it wait`;
		this.studio.notifyEdit(`This edit keeps ${lane?.name ?? 'the marble'} from Hit ${number}. ${later} where ${waiting === 1 ? 'it was' : 'they were'}.`, [], { isUndoFirst: true });
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
		if (project == null || client == null || (this.isSettling && this.preview == null)) return;
		const present = this.studio.project;
		const preview = this.preview;
		if (preview == null || present == null || (this.previewMove == null && !laneEdits(present, preview).length)) {
			this.send(client, project);
			return;
		}
		const move = this.previewMove;
		client.settle({ before: present, after: preview, isQuick: !this.isPaused, movedDot: move }).then(
			(answer) => {
				if (this.preview !== preview) return;
				const limit = move != null ? moveLimit(present, move, answer) : null;
				if (limit?.chip !== this.$moveLimit.get()?.chip) this.$moveLimit.set(limit);
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
				if (this.preview == null) this.sayPendingBreak(result);
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

/** Why a dragged platform can't go all the way: `chip` beside the drag, `notice` after the drop */
export interface TMoveLimit {
	chip: string;
	notice: string;
	/** It stays where it was */
	isStuck: boolean;
}

// How near a moved dot has to land to count as there, and how far to count as moved
const MOVE_LANDED = 0.003;
const MOVE_MOVED = 0.001;

/** Null when the platform landed where it was dragged */
export function moveLimit(project: TProject, move: { laneId: string; hitId: string }, answer: Pick<TSettleAnswer, 'move'>): TMoveLimit | null {
	const outcome = answer.move;
	if (outcome == null || outcome.missed <= MOVE_LANDED) return null;
	const lane = project.music.lanes.find((item) => item.id === move.laneId);
	const name = project.entities.find((entity) => entity.components.hitLink?.laneId === move.laneId && entity.components.hitLink.hitId === move.hitId)?.name ?? 'The platform';
	const from = project.entities.find((entity) => entity.id === outcome.fromId)?.name;
	if (outcome.isFixed) {
		if (from == null) return { chip: "Stays: it's the first note", notice: `${name} stays where it is: it plays ${lane?.name ?? 'the marble'}'s first note. Move the release to change its spot.`, isStuck: true };
		return { chip: `Stays: the marble leaves ${from} here`, notice: `${name} stays where it is: the marble leaves ${from} here. Move ${from} to change its spot.`, isStuck: true };
	}
	const source = from ?? 'the piece before it';
	if (outcome.moved < MOVE_MOVED) return { chip: `Stays: out of reach from ${source}`, notice: `${name} stays where it is: ${source} can't send the marble there on time.`, isStuck: true };
	const cm = (metres: number): string => `${(metres * 100).toFixed(1)} cm`;
	return { chip: `Goes ${cm(outcome.moved)}: the marble reaches no further`, notice: `${name} moved ${cm(outcome.moved)} of ${cm(outcome.moved + outcome.missed)}: ${source} can't send the marble further on time.`, isStuck: false };
}
