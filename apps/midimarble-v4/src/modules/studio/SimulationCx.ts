import { createComputed, createState } from 'feature-state';
import { checkRun, pendingPreflight, type TExportPreflight } from '@/modules/building';
import { type TPiece, type TProject, type TProjectCommand, type TProjectHistory, type TVec2, tieOf } from '@/modules/project';
import { createSimulationClient, isSameRunInput, isSuperseded, marbleEdits, type TRunInput, type TSettleAnswer, type TSimulationClient, type TSimulationResult } from '@/modules/simulation';
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
	/** What a drag keeps showing, so no pointer move checks the whole run on the main thread */
	private heldProblems: TExportPreflight | null = null;
	private problems: ReturnType<SimulationCx['createProblems']> | null = null;

	/**
	 * The open project's problems, the one source for the hit summary, its menu, Layers, the inspectors, the export
	 * sheet, the Camera track and an agent's replies. Pending until the run has caught up with the project and while
	 * Build Track works, so no step checks the whole run. Made on first read, as the states it reads are made after this Cx.
	 */
	get $problems(): ReturnType<SimulationCx['createProblems']> {
		this.problems ??= this.createProblems();
		return this.problems;
	}

	private createProblems() {
		const { $history, film, assist } = this.studio;
		return createComputed([$history, this.$result, this.$previewing, film.$blenderObjects, assist.$building] as const, ([history, result, isPreviewing, blenderObjects, building]) => {
			const project = history?.present ?? null;
			if (project == null || building != null) return pendingPreflight(project);
			if (isPreviewing && this.heldProblems != null) return this.heldProblems;
			this.heldProblems = result != null && result.revision === project.revision ? checkRun(project, result, blenderObjects) : null;
			return this.heldProblems ?? pendingPreflight(project);
		});
	}

	/** Why the platform being dragged can't play its note where the pointer is, for its chip */
	readonly $moveLimit = createState<TMoveLimit | null>(null);
	/** Wall time from the newest request to its result, in milliseconds */

	private client: TSimulationClient | null = null;
	private preview: TProject | null = null;
	private previewMove: { marbleId: string; hitId: string; dot: TVec2 } | null = null;
	private isMoving = false;
	/** The pointer has paused, so the preview asks what the drop will do: every way, not the first */
	private isPaused = false;
	private pauseTimer: ReturnType<typeof setTimeout> | null = null;
	private cancelFrame: (() => void) | null = null;
	private sent = 0;
	private accepted = 0;
	/** What the newest request runs, when it runs whole: a project with the same input needs no run of its own */
	private wholeRun: TRunInput | null = null;
	/** The latest whole runs, newest first, so Undo and Redo show theirs at once */
	private recentRuns: { input: TRunInput; result: TSimulationResult }[] = [];

	constructor(private readonly studio: StudioCx) {}

	mount(): () => void {
		this.client = createSimulationClient();
		let projectId: string | null = null;
		const unlisten = this.studio.$history.subscribe(({ value }) => {
			if (value == null) {
				projectId = null;
				this.clearPreview();
				this.$result.set(null);
				this.wholeRun = null;
				this.recentRuns = [];
				this.settled = null;
				return;
			}
			// Another project's result must not show while the new one simulates
			if (value.present.id !== projectId) {
				projectId = value.present.id;
				this.clearPreview();
				this.$result.set(null);
				this.wholeRun = null;
				this.recentRuns = [];
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
			this.wholeRun = null;
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
	startPreview(project: TProject, move: { marbleId: string; hitId: string; dot: TVec2 } | null = null): void {
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
	private settleRun = 0;
	private isLanding = false;
	/** True from an edit until the platforms taking up its change have landed; its own run waits until then */
	isSettling = false;

	/**
	 * After an edit, the next platforms take up the change so the rest of the run stays as it was, folded into the edit's
	 * undo step. Until the answer lands the edit's own run stays back, so a marble's first wild moment never shows. Undo,
	 * redo and what Build Track and Fix commit themselves are left alone. This is the one way edits reach the run, a
	 * person's or an agent's.
	 */
	private settleLatestEdit(history: TProjectHistory): void {
		if (this.isLanding) return;
		const known = this.settled;
		if (known == null || this.client == null || known.present.id !== history.present.id || history.isStep === true || this.studio.assist.isBuilding || this.studio.assist.isFixing === true) {
			this.settleRun++;
			this.settled = history;
			this.stopSettling();
			return;
		}
		const before = known.present;
		const after = history.present;
		if (!marbleEdits(before, after).length) {
			if (!this.isSettling) this.settled = history;
			return;
		}
		const run = ++this.settleRun;
		this.isSettling = true;
		this.client.settle({ before, after }).then(
			(answer) => {
				if (run !== this.settleRun || this.studio.project?.revision !== after.revision) return;
				this.landSettled(answer.pieces, true);
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
	landSettled(pieces: TPiece[], isAmend: boolean): void {
		this.landWorkedOut(pieces.map((piece) => ({ type: 'addPiece', piece })), { amend: isAmend });
	}

	/** Lands an edit that already worked out how the run goes on, so nothing folds into it: a settle would decide again */
	landWorkedOut(commands: TProjectCommand[], options: { amend?: boolean; label?: string }): boolean {
		this.isLanding = true;
		let isDone = false;
		try {
			isDone = commands.length > 0 && this.studio.execute(commands, options);
		} finally {
			this.isLanding = false;
		}
		this.settled = this.studio.$history.get();
		this.stopSettling();
		return isDone;
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
	async moveDot(move: { marbleId: string; hitId: string; dot: TVec2 }): Promise<void> {
		const project = this.studio.project;
		if (project == null || this.client == null) return;
		const run = ++this.settleRun;
		this.isSettling = true;
		this.dropsLanding++;
		// The drag's last preview must not take this drop's place in the worker's queue, which left a quick drop where it began
		this.cancelFrame?.();
		this.cancelFrame = null;
		if (this.pauseTimer != null) clearTimeout(this.pauseTimer);
		this.pauseTimer = null;
		try {
			const answer = await this.client.settle({ before: project, after: project, movedDot: move });
			if (run !== this.settleRun || this.studio.project?.revision !== project.revision) return;
			const limit = moveLimit(project, move, answer);
			// Nothing moved, so nothing lands: no undo step for a drop that didn't happen
			this.landSettled(limit?.isStuck === true ? [] : answer.pieces, false);
			if (limit?.isStuck === true) this.studio.notify(limit.notice);
			else if (limit != null) this.studio.notifyEdit(limit.notice);
			this.sayBreak(answer, project);
		} catch (error) {
			if (run !== this.settleRun) return;
			if (isSuperseded(error)) {
				if (this.studio.project?.revision === project.revision) await this.moveDot(move);
				return;
			}
			this.landSettled([], false);
			this.studio.notify(`The platform couldn't be moved: ${error instanceof Error ? error.message : String(error)}`, 'error');
		} finally {
			this.dropsLanding--;
		}
	}

	/** Drops on their way to the worker, which the run of the drag's preview waits for */
	private dropsLanding = 0;

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
		const status = result.hits.find((hit) => hit.marbleId === first.marbleId && hit.hitId === first.hitId)?.status;
		if (result.revision !== pending.revision || status == null || status === 'onTime' || status === 'drifting' || status === 'waiting') return;
		const marble = project.marbles.find((item) => item.id === first.marbleId);
		const number = (marble?.hits.findIndex((hit) => hit.id === first.hitId) ?? -1) + 1;
		const waiting = project.track.pieces.filter((piece) => tieOf(piece)?.marbleId === first.marbleId && (marble?.hits.find((hit) => hit.id === tieOf(piece)?.hitId)?.time ?? -1) > first.time).length;
		const later = waiting === 1 ? 'The piece after it waits.' : `The ${waiting} pieces after it wait.`;
		this.studio.notifyEdit(`${marble?.name ?? 'The marble'} misses Hit ${number}. ${later}`, [], { isUndoFirst: true });
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
		if (project == null || client == null || this.dropsLanding > 0 || (this.isSettling && this.preview == null)) return;
		const present = this.studio.project;
		const preview = this.preview;
		if (preview == null || present == null || (this.previewMove == null && !marbleEdits(present, preview).length)) {
			this.send(client, project);
			return;
		}
		const move = this.previewMove;
		client.settle({ before: present, after: preview, isQuick: !this.isPaused, movedDot: move }).then(
			(answer) => {
				if (this.preview !== preview) return;
				const limit = move != null ? moveLimit(present, move, answer) : null;
				if (limit?.chip !== this.$moveLimit.get()?.chip) this.$moveLimit.set(limit);
				this.send(client, withPieces(preview, answer.pieces));
			},
			(error: unknown) => {
				if (!isSuperseded(error) && this.preview === preview) this.send(client, preview);
			}
		);
	}

	private remember(input: TRunInput, result: TSimulationResult): void {
		this.recentRuns = [{ input, result }, ...this.recentRuns.filter((run) => !isSameRunInput(run.input, input))].slice(0, RECENT_RUNS);
	}

	private send(client: TSimulationClient, project: TProject): void {
		if (this.wholeRun != null && isSameRunInput(this.wholeRun, project)) {
			// A film edit leaves the run as it was. A request on its way stamps its own result when it lands.
			const shown = this.$result.get();
			if (shown != null && !this.$computing.get()) this.$result.set(atRevision(shown, project.revision));
			return;
		}
		const id = ++this.sent;
		const horizon = this.isMoving ? PREVIEW_HORIZON : undefined;
		this.wholeRun = horizon == null ? project : null;
		// The run is still asked for, as the worker's snapshots should follow the project, but what shows needn't wait for it
		const known = horizon == null ? this.recentRuns.find((run) => isSameRunInput(run.input, project)) : undefined;
		if (known != null) {
			this.accepted = id;
			this.$result.set(atRevision(known.result, project.revision));
		} else this.$computing.set(true);
		client.simulate(project, horizon).then(
			(answer) => {
				// Requests replaced while waiting resolve with the same newer result, oldest first
				if (id < this.accepted || this.studio.project?.id !== project.id) return;
				this.accepted = id;
				// Only the newest request's answer is its own run, and what has changed since may be film alone
				const latest = this.preview ?? this.studio.project;
				const result = id === this.sent && latest != null && isSameRunInput(project, latest) ? atRevision(answer, latest.revision) : answer;
				// Before the result goes out, so what it broke offers its Fix on this notice
				if (this.preview == null) this.sayPendingBreak(result);
				if (known == null && result !== this.$result.get()) this.$result.set(result);
				if (horizon == null && id === this.sent && this.preview == null) this.remember(project, answer);
				if (id === this.sent) this.$computing.set(false);
			},
			(error: unknown) => {
				if (this.client == null) return;
				if (id === this.sent) {
					this.wholeRun = null;
					this.$computing.set(false);
				}
				this.studio.notify(`Simulation failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
			}
		);
	}
}

const RECENT_RUNS = 4;

/** A run under the revision it also answers for, since the edits after it left its input alone */
function atRevision(result: TSimulationResult, revision: number): TSimulationResult {
	return result.revision === revision ? result : { ...result, revision };
}

/** `project` with these pieces in place of the ones of the same id */
function withPieces(project: TProject, pieces: TPiece[]): TProject {
	const changed = new Map(pieces.map((piece) => [piece.id, piece]));
	return { ...project, track: { ...project.track, pieces: project.track.pieces.map((piece) => changed.get(piece.id) ?? piece) } };
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
export function moveLimit(project: TProject, move: { marbleId: string; hitId: string }, answer: Pick<TSettleAnswer, 'move'>): TMoveLimit | null {
	const outcome = answer.move;
	if (outcome == null || outcome.missed <= MOVE_LANDED) return null;
	const marble = project.marbles.find((item) => item.id === move.marbleId);
	const name = project.track.pieces.find((piece) => tieOf(piece)?.marbleId === move.marbleId && tieOf(piece)?.hitId === move.hitId)?.name ?? 'The platform';
	const from = project.track.pieces.find((piece) => piece.id === outcome.fromId)?.name;
	if (outcome.isFixed) {
		if (from == null) return { chip: "Stays: it's the first note", notice: `${name} stays where it is: it plays ${marble?.name ?? 'the marble'}'s first note. Move the release to change its spot.`, isStuck: true };
		return { chip: `Stays: the marble leaves ${from} here`, notice: `${name} stays where it is: the marble leaves ${from} here. Move ${from} to change its spot.`, isStuck: true };
	}
	const source = from ?? 'the piece before it';
	if (outcome.moved < MOVE_MOVED) return { chip: `Stays: out of reach from ${source}`, notice: `${name} stays where it is: ${source} can't send the marble there on time.`, isStuck: true };
	const cm = (meters: number): string => `${(meters * 100).toFixed(1)} cm`;
	return { chip: `Goes ${cm(outcome.moved)}: the marble reaches no further`, notice: `${name} moved ${cm(outcome.moved)} of ${cm(outcome.moved + outcome.missed)}: ${source} can't send the marble further on time.`, isStuck: false };
}
