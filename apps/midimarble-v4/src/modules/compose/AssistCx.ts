import { createState } from 'feature-state';
import { builtRunCommands } from './group-commands';
import { applyProjectCommands, createId, DEFAULT_MARBLE_RADIUS, type TEntity, type TProject, type TProjectCommand, type TVec2 } from '@/modules/project';
import {
	gapPieceReads,
	hitOwners,
	isSuperseded,
	layoutOf,
	openLongGaps,
	release,
	changedEntities,
	type TAutoPlaceAnswer,
	type TContinueAnswer,
	type TGapPieceType,
	type THitResult,
	type TResolvedPiece,
	type TSimulationResult
} from '@/modules/simulation';
import { formatTime } from '@/modules/studio/format';
import { parseHitKey, toHitKey } from '@/modules/studio/selection';
import type { StudioCx } from '@/modules/studio/StudioCx';
import { preflightExport, problemSummary } from '@/modules/design/export-preflight';
import { buildOneStep, buildTrack, type TBuildGapPreference, type TBuildOutcome, type TBuildProgress, type TBuildTrackDeps } from './build-track';
import { addedProblems, brokenHits, fixHelps, fixMessage, fixPiece, fixTrack, hasFixes, replaceCommands, type TFixDeps, type TFixOutcome } from './fix-it';
import { findBowl } from './bowl-assist';
import { createEstimate } from './progress-estimate';
import { canMakeBacking, hitReach, isUnreachable, reachMessage, releaseFixFor } from './reachability';
import { unreachableActions } from './unreachable-fixes';
import { displayPiece } from './attach-edit';
import { newlyBroken } from './bowl-assist';
import { acceptableCount, ghostReducer, initialGhostState, type TGhostAction, type TGhostState, type TPlaceAnswer } from './ghosts';
import { commitAtHit, findStepTarget, pieceForHit, selectedPieceIds } from './step-loop';

/** How long Fix tries to bring a marble back to pieces waiting behind a break, before it says it can't */
const FIX_HELD_BUDGET_MS = 10000;

const DEGREE = Math.PI / 180;

/** Longest wait for Auto place before a clicked dot gets the default angle and is refined afterward */
export const AUTO_PLACE_WAIT_MS = 150;

/**
 * Owns the assists of the step loop: Next, Auto place, Continue ghosts and rail suggestions for long
 * gaps. Every question goes to the assist worker with the newest project, so the canvas never waits on
 * a search, and answers for an older revision are dropped.
 */
export class AssistCx {
	readonly $ghosts = createState<TGhostState>(initialGhostState);
	/** Wall time of the latest answer per assist, in milliseconds, for the status readout and checks */

	/** Next presses made while a placement or its run was still on the way, shown on the build bar as "Next ×5" */
	readonly $queuedNext = createState(0);

	private continueKey: string | null = null;
	/** The Continue question on its way, so an agent's next call sees its answer and Next acts the same at any speed */
	private pendingContinue: string | null = null;
	/** The gap Next found no way past, for the revision it asked at; the next press places at the note after it */
	private stuckGap: string | null = null;
	/** Type and time of the latest queued Next press; the presses run one by one as each run arrives */
	private queuedNext: { type: string; at: number } | null = null;
	private isMounted = false;
	/** Selection key of the hit whose click shows the current suggestion; selecting anything else cancels it */
	private previewKey: string | null = null;
	/** Counts previews, so an Auto place answer for an older one is dropped */
	private previewRun = 0;

	constructor(private readonly studio: StudioCx) {}

	mount(): () => void {
		this.isMounted = true;
		const unlisten = [
			this.studio.simulation.$result.listen(() => {
				this.offerFixIt();
				this.runQueuedNext();
				this.refresh();
			}),
			this.studio.$selection.listen(({ value }) => {
				if (this.previewKey != null && (value.length !== 1 || value[0] !== this.previewKey)) this.cancelPreview();
				this.refresh();
			}),
			this.studio.$history.listen(({ value }) => {
				if (value != null) this.dispatch({ type: 'revision', revision: value.present.revision });
				if (!this.hasGhosts) this.previewKey = null;
			})
		];
		if (this.studio.project != null) this.dispatch({ type: 'revision', revision: this.studio.project.revision });
		// The run shown at mount is what the first edit is compared with
		this.offerFixIt();
		this.refresh();
		return () => {
			this.isMounted = false;
			for (const stop of unlisten) stop();
		};
	}

	get hasGhosts(): boolean {
		const state = this.$ghosts.get();
		return state.ghost != null || state.pendingGap != null;
	}

	// MARK: - Next and Auto place

	/**
	 * Return and N. Accepts ghosts when some are shown; otherwise acts on the focused marble's next open
	 * hit: a long gap asks for a rail, with the Switchback layout when a straight one won't do, and any other gap gets an
	 * auto placed piece. Before a long gap Auto place launches the marble into the coming rail.
	 */
	next(type = 'platform'): void {
		if (this.$ghosts.get().ghost != null) {
			this.acceptGhosts();
			return;
		}
		const project = this.studio.project;
		const result = this.currentResult();
		if (project == null) return;
		if (result == null || this.isPlacing) {
			// Pressing Next quickly in a row must not lose a press while the run re-simulates
			this.queuedNext = { type, at: performance.now() };
			this.$queuedNext.set(this.$queuedNext.get() + 1);
			return;
		}
		const target = findStepTarget(project, result, this.studio.$selection.get());
		// A long gap after the last piece comes first: across it the marble may fall too far to leave a dot
		const gap = project.music.lanes
			.flatMap((lane) => openLongGaps(project, lane.id))
			.filter((item) => target == null || item.laneId === target.laneId || item.to <= target.targetTime)
			.sort((a, b) => a.to - b.to)[0];
		if (gap != null && (target == null || gap.to <= target.targetTime + 1e-9)) {
			// A suggestion waits for the user to accept it, so presses queued behind it end here
			this.clearQueuedNext();
			const key = `${project.revision}:${gap.laneId}/${gap.toHitId}`;
			if (this.stuckGap === key) {
				this.placeAfterStuckGap(result, gap.laneId, gap.toHitId, type);
				return;
			}
			this.suggestGapPiece('rail', gap.laneId, gap.fromHitId, gap.toHitId, {
				fallback: 'switchback',
				// An agent's Next places the bridge in the same call, so its reply says what happened
				accept: this.studio.isInAgentStep,
				onFailed: (message) => void this.stepPastGap(key, message)
			});
			return;
		}
		const unreachable = this.firstUnreachable(project, result, target);
		if (unreachable != null) {
			this.clearQueuedNext();
			this.explainUnreachable(project, result, unreachable);
			return;
		}
		if (target == null) {
			this.clearQueuedNext();
			this.studio.notify(everyNotePlacedMessage(project, this.studio.$selection.get()));
			return;
		}
		void this.place(target, type);
	}

	/**
	 * The earliest open hit before `target` (or anywhere, without one) on the focused marble that cannot get a
	 * platform, so Next explains it instead of skipping it silently or placing a platform that cannot play
	 */
	private firstUnreachable(project: TProject, result: TSimulationResult, target: THitResult | null): THitResult | null {
		const laneId = target?.laneId ?? focusedLaneId(project, this.studio.$selection.get());
		const open = result.hits.filter((hit) => hit.status === 'open' && (laneId == null || hit.laneId === laneId) && (target == null || hit.targetTime <= target.targetTime)).sort((a, b) => a.targetTime - b.targetTime);
		return open.find((hit) => isUnreachable(hitReach(project, result, hit))) ?? null;
	}

	/** N's message for an unreachable hit, with the fixes as actions: Move Release Earlier or Later and Make Backing */
	explainUnreachable(project: TProject, result: TSimulationResult, hit: THitResult): void {
		const reach = hitReach(project, result, hit);
		const lane = project.music.lanes.find((item) => item.id === hit.laneId);
		const index = lane?.hits.findIndex((item) => item.id === hit.hitId) ?? -1;
		const fix = releaseFixFor(project, hit, reach);
		const message = reachMessage(reach, { hit: `Hit ${index + 1}`, marble: lane?.name ?? 'The marble' }, fix, canMakeBacking(project));
		if (message == null) return;
		this.studio.$selection.set([toHitKey(hit.laneId, hit.hitId)]);
		if (!this.studio.$playing.get()) this.studio.$playhead.set(hit.targetTime);
		this.studio.notify(message, 'info', { actions: unreachableActions(this.studio, hit, fix) });
	}

	/**
	 * No rail fits the gap, so Next takes the step Build Track would: another tilt before the gap, a turn
	 * of what's in the way, or a platform for the note after it. When none works it says so and the next press puts a
	 * platform at that note regardless, so N never repeats itself.
	 */
	private async stepPastGap(key: string, message: string): Promise<void> {
		const project = this.studio.project;
		const deps = this.buildDeps(() => this.studio.project?.revision !== project?.revision);
		if (project == null || deps == null || this.isPlacing) return;
		this.isPlacing = true;
		try {
			const step = await buildOneStep(project, deps);
			if (this.studio.project?.revision !== project.revision) return;
			if (step != null && step.commands.length > 0 && this.studio.execute(step.commands)) {
				const placed = step.project.entities.find((entity) => entity.components.hitLink?.hitId === step.target.hitId);
				if (placed != null) this.studio.$selection.set([placed.id]);
				if (!this.studio.$playing.get()) this.studio.$playhead.set(step.target.targetTime);
				this.studio.notifyEdit(`${message} Next found another way past it.`);
				return;
			}
			this.stuckGap = key;
			this.studio.notify(`${message} Press N for a platform at the next note, or choose Build Track.`, 'info', { actions: [this.buildAction()] });
		} catch (error) {
			this.studio.notify(error instanceof Error ? error.message : String(error), 'error');
		} finally {
			this.isPlacing = false;
			this.runQueuedNext();
		}
	}

	/** The press after `stepPastGap` found nothing: a platform at the note after the gap, or what to do when it has no dot */
	private placeAfterStuckGap(result: TSimulationResult, laneId: string, hitId: string, type: string): void {
		const hit = result.hits.find((item) => item.laneId === laneId && item.hitId === hitId);
		if (hit?.dot != null) {
			void this.place(hit, type);
			return;
		}
		this.studio.notify("The marble falls too far to reach the note after this gap. Turn the platform before the gap, or choose Build Track.", 'info', { actions: [this.buildAction()] });
	}

	private runQueuedNext(): void {
		const queued = this.queuedNext;
		if (queued == null || this.currentResult() == null || this.isPlacing) return;
		const count = this.$queuedNext.get() - 1;
		this.queuedNext = count > 0 ? { ...queued, at: performance.now() } : null;
		this.$queuedNext.set(Math.max(0, count));
		// A press older than this belongs to a moment the user has moved on from; while the queue runs, each
		// placement counts as the latest press
		if (performance.now() - queued.at < 1500) this.next(queued.type);
		else this.clearQueuedNext();
	}

	/** Drops Next presses still queued, when Next stops at something to read or accept, or on Escape */
	clearQueuedNext(): void {
		this.queuedNext = null;
		if (this.$queuedNext.get() !== 0) this.$queuedNext.set(0);
	}


	/**
	 * Places a piece at an open hit. Platforms and windmills ask Auto place for the angle and wait up to
	 * 150 ms; a slower answer refines the default angle afterward within the same undo step.
	 */
	async place(hit: THitResult, type: string): Promise<void> {
		this.isPlacing = true;
		try {
			await this.placeNow(hit, type);
		} finally {
			this.isPlacing = false;
			this.runQueuedNext();
		}
	}

	private isPlacing = false;

	private async placeNow(hit: THitResult, type: string): Promise<void> {
		const project = this.studio.project;
		const client = this.studio.simulation.assists;
		if (project == null || hit.dot == null) return;
		const layout = layoutOf(type);
		const id = createId('piece');
		if (client == null || layout === 'path' || layout === 'tube') {
			commitAtHit(this.studio, hit, pieceForHit(project, hit, type, 'default', id));
			return;
		}
		const ask = (): Promise<TAutoPlaceAnswer | 'failed' | 'superseded'> =>
			client.autoPlace({ project, laneId: hit.laneId, hitId: hit.hitId, type, entityId: id }).then(
				(answer) => answer,
				(error: unknown) => (isSuperseded(error) ? 'superseded' : 'failed')
			);
		const request = ask();
		const quick = await Promise.race([request, wait(AUTO_PLACE_WAIT_MS).then(() => 'slow' as const)]);
		const present = this.studio.project;
		if (present == null) return;
		if (typeof quick === 'object' && present.revision === project.revision) {
			commitAtHit(this.studio, hit, quick.entity);
			return;
		}
		// Only the wait for the picture depends on timing: the piece shows at the default tilt until the answer comes, and
		// the answer then gives it the same tilt and bounce a quick answer would have, so the track is the same either way
		const fallback = pieceForHit(present, hit, type, 'default', id);
		if (!commitAtHit(this.studio, hit, fallback)) return;
		const placedRevision = this.studio.project?.revision;
		const placedGroup = this.studio.editGroup ?? undefined;
		let answer: TAutoPlaceAnswer | 'failed' | 'superseded' | 'slow' = quick;
		if (answer === 'slow') answer = await request;
		// A newer request replaced this one in the queue, not an answer about this hit
		if (answer === 'superseded') answer = await ask();
		if (answer === 'failed' || answer === 'superseded') {
			if (this.studio.project?.revision === placedRevision) this.studio.notify('No tilt keeps the next note in the frame, so the platform has the default tilt. Turn it by hand if the track needs it.');
			return;
		}
		const latest = this.studio.project;
		// Only refine while nothing else happened since the default placement; the tilt undoes with it
		if (latest == null || latest.revision !== placedRevision) return;
		const commands = replaceCommands(latest, answer.entity);
		if (commands.length > 0) this.studio.execute(commands, { group: placedGroup });
	}

	// MARK: - Dot previews

	/**
	 * The first click on an open dot: selects the hit and draws the piece it would get, with the next note's dot where
	 * that piece sends the marble. Nothing changes in the project until it is accepted. It shows at once at the default
	 * tilt, and Auto place's answer takes its place.
	 */
	preview(hit: THitResult, type = 'platform'): void {
		const project = this.studio.project;
		const client = this.studio.simulation.assists;
		const { dot, velocity } = hit;
		if (project == null || dot == null) return;
		const run = ++this.previewRun;
		const key = toHitKey(hit.laneId, hit.hitId);
		this.previewKey = key;
		this.studio.$selection.set([key]);
		const id = createId('piece');
		const radius = project.entities.find((entity) => entity.components.marble?.laneId === hit.laneId)?.components.marble?.radius ?? DEFAULT_MARBLE_RADIUS;
		const show = (entity: TEntity, angle: number, nextDot: TVec2 | null, isSolved: boolean, isOk: boolean): void => {
			const piece = displayPiece(entity, { pose: { position: dot, angle }, dot, velocity }, radius);
			this.dispatch({ type: 'preview', answer: { revision: project.revision, laneId: hit.laneId, hit, type, entity, piece, nextDot, isSolved, isOk } });
		};
		const guess = pieceForHit(project, hit, type, 'default', id);
		const guessAngle = guess.components.hitLink?.angle ?? 0;
		const layout = layoutOf(type);
		if (client == null || layout === 'path' || layout === 'tube') {
			show(guess, guessAngle, null, true, true);
			return;
		}
		show(guess, guessAngle, null, false, true);
		client.autoPlace({ project, laneId: hit.laneId, hitId: hit.hitId, type, entityId: id }).then(
			(answer) => {
				if (run === this.previewRun && this.studio.project?.revision === project.revision) show(answer.entity, answer.angle, answer.nextDot, true, true);
			},
			(error: unknown) => {
				if (run === this.previewRun && !isSuperseded(error) && this.studio.project?.revision === project.revision) show(guess, guessAngle, null, true, false);
			}
		);
	}

	/** The first click on a long gap's dot: selects the hit and shows what bridges the gap, like `preview` */
	previewGap(hit: THitResult, fromHitId: string): void {
		const key = toHitKey(hit.laneId, hit.hitId);
		this.previewRun++;
		this.previewKey = key;
		this.studio.$selection.set([key]);
		this.suggestGapPiece('rail', hit.laneId, fromHitId, hit.hitId, { fallback: 'switchback' });
	}

	/** Whether a click on this dot's hit showed the suggestion that is up */
	isPreviewing(laneId: string, hitId: string): boolean {
		return this.previewKey === toHitKey(laneId, hitId) && this.hasGhosts;
	}

	/** The suggested piece a click would add: a dot's preview or a long gap's bridge. Continue ghosts are taken with Tab. */
	get clickableGhost(): TResolvedPiece | null {
		const { ghost } = this.$ghosts.get();
		return ghost == null || ghost.kind === 'continue' ? null : ghost.answer.piece;
	}

	/** Takes back what a dot's click showed; a Continue offer it replaced comes back */
	cancelPreview(): void {
		if (this.previewKey == null) return;
		this.previewKey = null;
		this.previewRun++;
		this.continueKey = null;
		this.dispatch({ type: 'previewCanceled' });
		this.refresh();
	}

	// MARK: - Ghosts

	/** Tab, or Return while ghosts show: adds every acceptable ghost as one edit */
	acceptGhosts(): boolean {
		const { ghost } = this.$ghosts.get();
		const project = this.studio.project;
		if (ghost == null || project == null || ghost.answer.revision !== project.revision) return false;
		// Committing selects the new piece, which is no cancel
		this.previewKey = null;
		if (ghost.kind === 'place') return this.acceptPreview(ghost.answer);
		const commands = ghost.answer.commands;
		if (!commands.length || !this.studio.execute(commands)) return false;
		this.dispatch({ type: 'accepted' });
		if (ghost.kind === 'continue') {
			const last = ghost.answer.suggestions.filter((suggestion) => suggestion.isOk).at(-1);
			const time = project.music.lanes.find((lane) => lane.id === ghost.answer.laneId)?.hits.find((hit) => hit.id === last?.hitId)?.time;
			if (last != null) this.studio.$selection.set([last.entity.id]);
			if (time != null && !this.studio.$playing.get()) this.studio.$playhead.set(time);
			this.studio.notifyEdit(`Added ${acceptableCount(ghost)} ${acceptableCount(ghost) === 1 ? 'platform' : 'platforms'}`);
		} else {
			this.studio.$selection.set([ghost.answer.entity.id]);
			if (!this.studio.$playing.get()) this.studio.$playhead.set(ghost.answer.piece?.entryTime ?? this.studio.$playhead.get());
		}
		return true;
	}

	private acceptPreview(answer: TPlaceAnswer): boolean {
		this.previewRun++;
		if (!answer.isSolved) {
			// Auto place hasn't answered: placing waits for it the way a direct placement does, the ghost up meanwhile
			if (!this.isPlacing) void this.place(answer.hit, answer.type).finally(() => this.dispatch({ type: 'accepted' }));
			return true;
		}
		if (!commitAtHit(this.studio, answer.hit, answer.entity)) return false;
		this.dispatch({ type: 'accepted' });
		if (!answer.isOk) this.studio.notify('No tilt keeps the next note in the frame, so the platform has the default tilt. Turn it by hand if the track needs it.');
		return true;
	}

	/** Escape: hides the ghosts until the next edit; a dot's preview only goes away */
	dismiss(): boolean {
		if (!this.hasGhosts) return false;
		if (this.previewKey != null) {
			this.cancelPreview();
			return true;
		}
		this.dispatch({ type: 'dismiss' });
		return true;
	}

	/**
	 * Asks for a rail or tunnel across a long gap and shows it as a ghost to accept. With
	 * `fallback`, a failed search asks for that type instead before telling the user.
	 */
	suggestGapPiece(type: TGapPieceType, laneId: string, fromHitId: string, toHitId: string, options: { accept?: boolean; fallback?: TGapPieceType; onFailed?: (message: string) => void } = {}): void {
		const project = this.studio.project;
		const client = this.studio.simulation.assists;
		if (project == null || client == null) return;
		this.dispatch({ type: 'requestGap', revision: project.revision, laneId, toHitId });
		client.gapPiece({ type, project, laneId, fromHitId, toHitId }).then(
			(answer) => {
				// A rail the pace or the frame can't follow leaves the gap to the Switchback layout, like Build Track
				if (options.fallback != null && options.fallback !== type && answer.check != null && !gapPieceReads(answer.check, this.currentResult()?.pace?.limit ?? Infinity)) {
					this.suggestGapPiece(options.fallback, laneId, fromHitId, toHitId, { accept: options.accept, onFailed: options.onFailed });
					return;
				}
				this.dispatch({ type: 'gapAnswer', answer });
				if (options.accept === true) this.acceptGhosts();
			},
			(error: unknown) => {
				this.dispatch({ type: 'gapFailed', revision: project.revision });
				if (isSuperseded(error)) return;
				if (options.fallback != null && options.fallback !== type) {
					this.suggestGapPiece(options.fallback, laneId, fromHitId, toHitId, { accept: options.accept, onFailed: options.onFailed });
					return;
				}
				const message = gapFailure(type, error instanceof Error ? error.message : String(error));
				if (options.onFailed != null) options.onFailed(message);
				else this.studio.notify(message);
			}
		);
	}

	// MARK: - Build Track

	/** How far the running Build Track is, null when none runs */
	readonly $building = createState<TBuildProgress | null>(null);
	/** What the latest Build Track of this session left, for `get_state` */
	readonly $lastBuild = createState<TBuildReport | null>(null);
	private buildRun: { isCanceled: boolean } | null = null;

	get isBuilding(): boolean {
		return this.buildRun != null;
	}

	/** Some hit has no platform yet, so Build Track has work to do */
	get hasOpenHits(): boolean {
		const project = this.studio.project;
		if (project == null) return false;
		return project.music.lanes.some((lane) => {
			const owners = hitOwners(project, lane.id);
			return lane.hits.some((hit) => !owners.has(hit.id));
		});
	}

	/** `build.stop` and Stop on an agent's pill: ends a running Build Track or Fix; what it did stays */
	stopBuild(): void {
		if (this.buildRun != null) this.buildRun.isCanceled = true;
		if (this.fixRun != null) this.fixRun.isCanceled = true;
	}

	private buildAction(): { label: string; title: string; run: () => void } {
		return { label: 'Build Track', title: 'Build every open hit, in time order', run: () => void this.buildTrack() };
	}

	/** The worker calls a build needs. Searches stop between their stages once `isCanceled` says so. */
	private buildDeps(isCanceled: () => boolean): TBuildTrackDeps | null {
		const client = this.studio.simulation.assists;
		if (client == null) return null;
		return {
			// The assists worker, so its runs resume from the snapshots of the run before
			simulate: (project) => client.simulateAssist(project),
			autoPlace: (request) => client.autoPlace(request, { isCanceled }),
			gapPiece: (request) => client.gapPiece(request, { isCanceled }),
			continueRun: (request) => client.continueRun(request),
			isCanceled
		};
	}

	/**
	 * Build Track: builds every open hit of every marble in time order and ends each marble in a Bowl, as one undo
	 * step. Each piece shows on the wall as it is found, with progress and Stop in the notice. Another edit stops it,
	 * like Fix, and what it built so far stays.
	 */
	async buildTrack(from?: { laneId: string; hitId: string }, gapPiece?: TBuildGapPreference): Promise<TBuildOutcome | null> {
		const project = this.studio.project;
		if (project == null || this.buildRun != null || this.fixRun != null) return null;
		if (!project.music.lanes.some((lane) => lane.hits.length > 0)) {
			this.studio.notify('Build Track needs notes. Import a song, or press T and tap along.');
			return null;
		}
		if (from == null && !this.hasOpenHits) {
			this.studio.notify('Every hit already has a platform');
			return null;
		}
		const run = { isCanceled: false };
		let expected = project.revision;
		const isCanceled = (): boolean => run.isCanceled || (this.studio.project?.revision ?? expected) !== expected;
		const deps = this.buildDeps(isCanceled);
		if (deps == null) return null;
		this.buildRun = run;
		this.clearQueuedNext();
		this.dispatch({ type: 'dismiss' });
		this.studio.$selection.set([]);
		const startedAt = performance.now();
		// A build's first hits come fast and say little about the stuck ones to come
		const estimate = createEstimate({ minElapsedMs: 10000 });
		const stop = { label: 'Stop', title: 'Keep the pieces built so far', run: () => (run.isCanceled = true) };
		// A back-up undoes steps; what the bar and the count show never goes back with it
		let furthest = { done: 0, fraction: 0 };
		// Hits a rebuild keeps were done from the start: the rate counts only what this build plays
		let doneAtStart: number | null = null;
		const progressText = (progress: TBuildProgress): string => {
			furthest = { done: Math.max(furthest.done, progress.done), fraction: Math.max(furthest.fraction, progress.fraction) };
			if (progress !== firstProgress) doneAtStart ??= progress.done;
			const kept = doneAtStart ?? 0;
			const left = estimate.update(performance.now() - startedAt, furthest.fraction, furthest.done - kept, progress.total - kept);
			return ['Building track', `${furthest.done} of ${progress.total} ${progress.total === 1 ? 'hit' : 'hits'}`, progress.restarts > 0 ? 'trying another start' : '', left].filter(Boolean).join(' · ');
		};
		const total = project.music.lanes.reduce((sum, lane) => sum + lane.hits.length, 0);
		const firstProgress: TBuildProgress = { done: 0, total, at: 0, fraction: 0, restarts: 0 };
		this.$building.set(firstProgress);
		const progressId = this.studio.notify(progressText(firstProgress), 'info', { progress: 0, actions: [stop] });
		let outcome: TBuildOutcome | null = null;
		try {
			outcome = await buildTrack(project, {
				...deps,
				commit: (commands, isFirst, hit) => {
					// Another edit since the last step stops the build rather than folding into it
					if (this.studio.project?.revision !== expected) return false;
					if (!this.studio.execute(commands, { amend: !isFirst })) return false;
					expected = this.studio.project?.revision ?? expected;
					if (hit != null && !this.studio.$playing.get()) {
						this.studio.$playhead.set(hit.targetTime);
						this.studio.$reveal.set({ ids: [toHitKey(hit.laneId, hit.hitId)] });
					}
					return true;
				},
				onProgress: (progress) => {
					this.$building.set(progress);
					this.studio.updateNotice(progressId, { message: progressText(progress), progress: progress.fraction });
				}
			}, { ...(from != null ? { from } : {}), ...(gapPiece != null ? { gapPiece } : {}) });
		} catch (error: unknown) {
			this.studio.notify(`Build Track stopped: ${error instanceof Error ? error.message : String(error)}`, 'error');
		} finally {
			this.buildRun = null;
			this.$building.set(null);
		}
		this.studio.updateNotice(progressId, { progress: undefined, actions: [] });
		if (outcome == null) return null;
		// What it built shows as plain Groups on the strip, in the build's Undo step
		if (this.studio.project?.revision === expected) {
			const runs = builtRunCommands(project, this.studio.project, outcome.result.hits);
			if (runs.length > 0) this.studio.execute(runs, { amend: true });
		}
		const present = this.studio.project;
		const result: TSimulationResult = { ...outcome.result, revision: present?.revision ?? outcome.project.revision };
		this.baseline = { projectId: project.id, revision: result.revision, hits: result.hits };
		this.lastFixRevision = result.revision;
		const summary = problemSummary(preflightExport(present ?? outcome.project, result));
		// The hit count alone, which the summary in the timeline reads the same however the camera's problems settle afterward
		const hitsLabel = `${summary.onTime} of ${summary.total} ${summary.total === 1 ? 'hit' : 'hits'} on time`;
		const report = buildReport(project, outcome, hitsLabel, summary.problems.length, Math.round(performance.now() - startedAt), from);
		this.$lastBuild.set(report);
		const changed = present?.revision !== project.revision;
		if (changed) {
			const broken = brokenHits(result.hits).length;
			this.studio.notifyEdit(report.message, broken > 0 && present != null ? [this.fixAction()] : [], { details: report.details });
		} else this.studio.notify(report.message);
		// A person's build ends with its result in view; an agent's leaves their view alone
		if (!this.studio.isInAgentStep) this.studio.$compose.get()?.fitOnceSimulated();
		return outcome;
	}

	/** The hit Rebuild From Here starts at: the selected hit, or the one the selected piece belongs to */
	get rebuildTarget(): { laneId: string; hitId: string } | null {
		const project = this.studio.project;
		const [key] = this.studio.$selection.get();
		if (project == null || key == null) return null;
		const hit = parseHitKey(key);
		if (hit != null) return hit;
		const link = project.entities.find((entity) => entity.id === key)?.components.hitLink;
		return link != null ? { laneId: link.laneId, hitId: link.hitId } : null;
	}

	// MARK: - Fix

	/** How far the running Fix is, null when none runs */
	readonly $fixing = createState<{ done: number; total: number } | null>(null);
	private fixRun: { isCanceled: boolean } | null = null;
	/** Hits of the latest current result, to tell which hits an edit broke */
	private baseline: { projectId: string; revision: number; hits: THitResult[] } | null = null;
	/** Per marble, its hits from the latest result in which none of them was broken, for moving a release back */
	private lastGood = new Map<string, THitResult[]>();
	private lastGoodProjectId: string | null = null;
	private lastFixRevision: number | null = null;

	private fixAction(): { label: string; title: string; run: () => void } {
		return { label: 'Fix', title: 'Try to play every note again; Undo goes back', run: () => void this.fix() };
	}

	/**
	 * After an edit, compares the new run with the one before it. When later hits became Blocked or Missed, the
	 * edit's notice gets Fix, or a notice says so; undo, redo and Fix itself do not ask.
	 */
	private offerFixIt(): void {
		const project = this.studio.project;
		const result = this.currentResult();
		if (project == null || result == null || this.studio.simulation.isSettling) return;
		const previous = this.baseline;
		if (previous?.projectId === project.id && previous.revision === result.revision) return;
		this.baseline = { projectId: project.id, revision: result.revision, hits: result.hits };
		// A run Fix made is not a reference for the next one: its release came from the reference itself
		if (this.fixRun == null && this.buildRun == null && result.revision !== this.lastFixRevision) this.rememberGood(project, result);
		if (previous == null || previous.projectId !== project.id || previous.revision > result.revision || this.fixRun != null || this.buildRun != null) return;
		if (this.studio.$historyReveal.get()?.revision === result.revision) return;
		const broken = newlyBroken(previous.hits, result.hits);
		if (!broken.length) return;
		const action = this.fixAction();
		const notice = this.studio.$notice.get();
		// A run under way, such as Gravity's re-fit, keeps its progress and Stop
		if (notice?.progress != null) return;
		if (notice != null && notice.revision === result.revision) {
			this.studio.updateNotice(notice.id, { actions: [...(notice.actions ?? []), action] });
			return;
		}
		// Counts every hit the edit broke, the edited one included, so "later" would miscount
		const words = broken.length === 1 ? '1 hit is' : `${broken.length} hits are`;
		this.studio.notifyEdit(`${words} now Blocked, Missed or Stopped`, [action], { isUndoFirst: true });
	}

	private rememberGood(project: TProject, result: TSimulationResult): void {
		if (this.lastGoodProjectId !== project.id) this.lastGood.clear();
		this.lastGoodProjectId = project.id;
		for (const lane of project.music.lanes) {
			const hits = result.hits.filter((hit) => hit.laneId === lane.id);
			if (hits.some((hit) => hit.pieceEntityId != null) && !brokenHits(hits).length) this.lastGood.set(lane.id, hits);
		}
	}

	get isFixing(): boolean {
		return this.fixRun != null;
	}

	/** An assist is still working on the latest edit: what it answers next can change the project or what Next does */
	get isAnswering(): boolean {
		return this.studio.simulation.isSettling || this.isPlacing || this.fixRun != null || this.buildRun != null || this.pendingContinue != null || this.$ghosts.get().pendingGap != null;
	}

	/** The worker calls Fix and Add Bowl need: runs, Auto place and a new bridge for a long gap */
	private fixDeps(isCanceled?: () => boolean): Pick<TFixDeps, 'simulate' | 'autoPlace' | 'gapPiece' | 'settle'> | null {
		const client = this.studio.simulation.assists;
		if (client == null) return null;
		const options = isCanceled != null ? { isCanceled } : undefined;
		return {
			// The assists worker, so Auto place resumes from the run Fix just simulated
			simulate: async (next) => client.simulateAssist(next),
			autoPlace: async (next, hit, entity) => (await client.autoPlace({ project: next, laneId: hit.laneId, hitId: hit.hitId, type: entity.components.piece?.type ?? 'platform', entityId: entity.id }, options)).entity,
			gapPiece: async (next, gap, type, entityId) => (await client.gapPiece({ type, project: next, laneId: gap.laneId, fromHitId: gap.fromHitId, toHitId: gap.toHitId, entityId }, options)).entity,
			settle: async (before, after) => (await client.settle({ before, after })).entities
		};
	}

	/**
	 * A, and Fix on the Track menu: the one selected piece, or the whole run. Fix tries on a copy where it can, says why
	 * when it can't and is one undo step. Pieces waiting behind a break come first, whatever is selected.
	 */
	fixSelection(): void {
		const project = this.studio.project;
		if (project == null) return;
		const selected = this.studio.$selection.get();
		const hit = selected.length === 1 && selected[0] != null ? parseHitKey(selected[0]) : null;
		const ids = selectedPieceIds(project, selected);
		const piece = hit != null ? pieceForHitKey(project, hit) : ids.length === 1 ? ids[0] : undefined;
		void this.fix(piece);
	}

	/** Fix for one piece, or the whole run */
	async fix(entityId?: string): Promise<void> {
		const project = this.studio.project;
		const result = this.currentResult();
		if (project == null || this.fixRun != null || this.buildRun != null) return;
		if (result == null) {
			this.studio.notify('The run is still being checked. Press Fix again in a moment.');
			return;
		}
		if (project.entities.some((entity) => entity.components.hitLink?.held != null)) await this.fixHeld(project, result);
		else if (entityId != null) await this.fixOnePiece(project, result, entityId);
		else if (hasFixes(project, result)) await this.fixWholeRun(project, result);
		else this.studio.notify(this.nothingToFixWords(project, result));
	}

	/** With problems Fix doesn't mend left, says which needs a hand instead of "Nothing to fix" */
	private nothingToFixWords(project: TProject, result: TSimulationResult): string {
		const [first] = problemSummary(preflightExport(project, { ...result, revision: project.revision })).problems;
		return first != null ? `Fix mends broken hits, double hits, rolls and touching pieces. ${first.title} needs moving by hand.` : 'Nothing to fix';
	}

	private async fixOnePiece(project: TProject, result: TSimulationResult, entityId: string): Promise<void> {
		const deps = this.fixDeps();
		if (deps == null) return;
		this.fixRun = { isCanceled: false };
		this.$fixing.set({ done: 0, total: 1 });
		try {
			const fix = await fixPiece(project, result, entityId, deps);
			// Another edit while the what-if ran makes it stale
			if (this.studio.project?.revision !== project.revision) return;
			const { rebuildFrom } = fix;
			if (fix.commands != null) {
				if (this.studio.execute(fix.commands)) this.studio.notifyEdit(fix.message);
			} else if (rebuildFrom != null) {
				this.studio.notify(fix.message, 'info', { actions: [{ label: 'Rebuild From Here', title: 'Keep the track before this hit and build the rest again', run: () => void this.buildTrack(rebuildFrom) }] });
			} else this.studio.notify(fix.message);
		} catch (error) {
			if (!isSuperseded(error)) this.studio.notify(`Fix stopped: ${error instanceof Error ? error.message : String(error)}`, 'error');
		} finally {
			this.fixRun = null;
			this.$fixing.set(null);
		}
	}

	/**
	 * Runs Auto place again from the first broken hit onward, on a copy so nothing shows until it's known to help: as one
	 * undo step when the run ends with fewer problems, or not at all, and the notice says so. Progress and Stop in the notice.
	 */
	private async fixWholeRun(project: TProject, result: TSimulationResult): Promise<void> {
		const run = { isCanceled: false };
		const isCanceled = (): boolean => run.isCanceled || this.studio.project?.revision !== project.revision;
		const deps = this.fixDeps(isCanceled);
		if (deps == null) return;
		this.fixRun = run;
		this.dispatch({ type: 'dismiss' });
		const stop = { label: 'Stop', title: 'Keep the hits fixed so far', run: () => (run.isCanceled = true) };
		const progressId = this.studio.notify('Fixing', 'info', { progress: 0, actions: [stop] });
		const commands: TProjectCommand[] = [];
		let furthest = 0;
		let outcome: TFixOutcome | null = null;
		try {
			outcome = await fixTrack(
				project,
				result,
				{
					...deps,
					commit: (next, step) => {
						const [isOk, , applied] = applyProjectCommands(next, step);
						if (!isOk) return null;
						commands.push(...step);
						return applied;
					},
					onProgress: (done, total, fraction) => {
						this.$fixing.set({ done, total });
						// A try that backs up never moves the bar back
						furthest = Math.max(furthest, Math.min(1, Math.max(0, fraction)));
						this.studio.updateNotice(progressId, { message: `Fixing · ${done} of ${total} hits`, progress: furthest });
					},
					isCanceled
				},
				[...this.lastGood.values()].flat()
			);
			this.studio.updateNotice(progressId, { progress: undefined, actions: [] });
			// Another edit while it ran makes the copy stale
			if (outcome != null && this.studio.project?.revision === project.revision) this.landWholeRun(project, result, outcome, commands, run.isCanceled);
		} catch (error: unknown) {
			this.studio.updateNotice(progressId, { progress: undefined, actions: [] });
			this.studio.notify(`Fix stopped: ${error instanceof Error ? error.message : String(error)}`, 'error');
		} finally {
			this.fixRun = null;
			this.$fixing.set(null);
		}
	}

	/** Lands what Fix found on its copy if it leaves the run better, and says how the run stands */
	private landWholeRun(project: TProject, result: TSimulationResult, outcome: TFixOutcome, commands: TProjectCommand[], isStopped: boolean): void {
		if (!commands.length) {
			this.studio.notify('No new tilt helps these pieces without adding a problem. Turn them by hand, or undo the edit that broke them.');
			return;
		}
		// How the run stands comes from the one problem model, the same as the hit summary and the export sheet
		const before = problemSummary(preflightExport(project, { ...result, revision: project.revision }));
		const summary = problemSummary(preflightExport(outcome.project, { ...outcome.result, revision: outcome.project.revision }));
		if (!fixHelps(before, summary)) {
			this.studio.notifyEdit(fixWorseWords(before.problems.length, summary.problems.length), [], { isUndoFirst: true });
			return;
		}
		const added = addedProblems(project, result, outcome.project, outcome.result);
		if (!this.studio.execute(commands)) return;
		const revision = this.studio.project?.revision ?? outcome.result.revision;
		this.baseline = { projectId: project.id, revision, hits: outcome.result.hits };
		this.lastFixRevision = revision;
		const message = fixMessage(project, result.hits, outcome, { label: summary.label, hitProblems: summary.hitProblems, added });
		this.studio.notifyEdit(outcome.isStopped && !isStopped ? `${message} · stopped by another edit` : message);
	}

	/**
	 * Fix for pieces waiting behind a break. A note with no piece gets what Next gives it, at once. Then the marble is
	 * brought back to the pieces, which moves nothing else. When no tilt reaches them, Fix tries on a copy from where they
	 * wait, a limited time, and lands only if every hit plays and the run has fewer problems: a try that leaves tens of hits
	 * broken is no fix, so the pieces go on waiting and the notice offers Rebuild From Here.
	 */
	private async fixHeld(project: TProject, result: TSimulationResult): Promise<void> {
		const client = this.studio.simulation.assists;
		if (client == null) return;
		const open = findStepTarget(project, result, []);
		const firstHeld = heldHit(project);
		if (open?.dot != null && firstHeld != null && open.targetTime <= firstHeld.time) {
			await this.place(open, this.studio.$compose.get()?.placementType() ?? 'platform');
			const lane = project.music.lanes.find((item) => item.id === open.laneId);
			const number = (lane?.hits.findIndex((hit) => hit.id === open.hitId) ?? -1) + 1;
			if (this.studio.project?.revision !== project.revision) this.studio.notifyEdit(`Placed a platform at Hit ${number}. Fix again for the pieces still waiting.`);
			return;
		}
		const run = { isCanceled: false };
		const startedAt = performance.now();
		const isCanceled = (): boolean => run.isCanceled || this.studio.project?.revision !== project.revision || performance.now() - startedAt > FIX_HELD_BUDGET_MS;
		const deps = this.fixDeps(isCanceled);
		if (deps == null) return;
		this.fixRun = run;
		const stop = { label: 'Stop', title: 'Stop trying; the pieces go on waiting', run: () => (run.isCanceled = true) };
		const progressId = this.studio.notify('Fixing the break', 'info', { progress: 0, actions: [stop] });
		let fixed: TProject | null = null;
		let isWorse = false;
		try {
			const back = await client.reconnect(project);
			if (back != null) fixed = withSettled(project, back.entities);
			else {
				const released = release(project);
				const outcome = await fixTrack(released, await client.simulateAssist(released), {
					...deps,
					commit: (next, commands) => {
						const [isOk, , applied] = applyProjectCommands(next, commands);
						return isOk ? applied : null;
					},
					onProgress: (done, total, fraction) => {
						this.studio.updateNotice(progressId, { message: `Fixing the break · ${done} of ${total} hits`, progress: Math.min(1, Math.max(0, fraction)) });
					},
					isCanceled
				});
				if (!outcome.isStopped && !brokenHits(outcome.result.hits).length) {
					const before = problemSummary(preflightExport(project, { ...result, revision: project.revision }));
					const after = problemSummary(preflightExport(outcome.project, { ...outcome.result, revision: outcome.project.revision }));
					if (fixHelps(before, after)) fixed = outcome.project;
					else isWorse = true;
				}
			}
		} catch (error) {
			if (!isSuperseded(error)) this.studio.notify(`Fix stopped: ${error instanceof Error ? error.message : String(error)}`, 'error');
		} finally {
			this.fixRun = null;
		}
		this.studio.updateNotice(progressId, { progress: undefined, actions: [] });
		if (this.studio.project?.revision !== project.revision) return;
		if (fixed == null) {
			const from = firstHeld != null ? { laneId: firstHeld.laneId, hitId: firstHeld.hitId } : null;
			const rebuild = from != null ? [{ label: 'Rebuild From Here', title: 'Keep the track before this hit and build the rest again', run: () => void this.buildTrack(from) }] : [];
			const words = isWorse ? 'Fix would add problems, so nothing changed. Undo the edit, or rebuild from the break.' : run.isCanceled ? 'The pieces go on waiting where they were.' : 'No tilt brings the marble back to the pieces waiting for it. Undo the edit, or rebuild from the break.';
			this.studio.notifyEdit(words, rebuild, { isUndoFirst: true });
			return;
		}
		const changed = changedEntities(project, fixed);
		this.studio.simulation.landSettled(changed, false);
		this.studio.notifyEdit(`${tiltChange(project, changed)}The marble is back on its run`);
	}

	/** The marble Add Bowl is searching a Bowl for, while it runs */
	readonly $addingBowl = createState<string | null>(null);

	/**
	 * Add Bowl: a Bowl on the marble's fall after its last note, which what-if runs found to catch it, break no
	 * hit and touch no other marble or its pieces, as one undo step. The film length follows when it follows the song.
	 */
	async addBowl(laneId: string): Promise<void> {
		const project = this.studio.project;
		const deps = this.fixDeps();
		if (project == null || deps == null || this.$addingBowl.get() != null) return;
		this.$addingBowl.set(laneId);
		try {
			const placed = await findBowl(project, laneId, { simulate: deps.simulate });
			// Another edit while the what-ifs ran makes them stale
			if (this.studio.project?.revision !== project.revision) return;
			if ('error' in placed) {
				this.studio.notify(placed.error);
				return;
			}
			if (!this.studio.execute(placed.commands)) return;
			this.studio.$selection.set([placed.entity.id]);
			this.studio.notifyEdit(placed.message);
		} catch (error) {
			this.studio.notify(error instanceof Error ? error.message : String(error), 'error');
		} finally {
			this.$addingBowl.set(null);
		}
	}

	/** Asks for Continue ghosts for the focused marble when the shown result is current */
	private refresh(): void {
		if (!this.isMounted) return;
		const project = this.studio.project;
		const result = this.currentResult();
		const client = this.studio.simulation.assists;
		if (project == null || result == null || client == null || this.buildRun != null) return;
		const state = this.$ghosts.get();
		if (state.dismissedRevision === project.revision || state.pendingGap != null || state.ghost?.kind === 'gap' || state.ghost?.kind === 'place') return;
		const target = findStepTarget(project, result, this.studio.$selection.get());
		const laneId = target?.laneId ?? null;
		const key = `${project.revision}:${laneId}`;
		if (key === this.continueKey) return;
		this.continueKey = key;
		if (laneId == null) {
			this.dispatch({ type: 'continueAnswer', revision: project.revision, answer: null });
			return;
		}
		this.pendingContinue = key;
		const done = (): void => {
			if (this.pendingContinue === key) this.pendingContinue = null;
		};
		client.continueRun({ project, laneId }).then(
			(answer: TContinueAnswer | null) => {
				done();
				this.dispatch({ type: 'continueAnswer', revision: project.revision, answer });
			},
			() => {
				done();
				// A failed or replaced search simply offers nothing; a newer request is on its way
				if (this.continueKey === key) this.continueKey = null;
			}
		);
	}

	/** The result for the project as it is now, outside drag previews */
	private currentResult(): TSimulationResult | null {
		const simulation = this.studio.simulation;
		const result = simulation.$result.get();
		const project: TProject | null = this.studio.project;
		if (result == null || project == null || simulation.isPreviewing || result.revision !== project.revision) return null;
		return result;
	}

	private dispatch(action: TGhostAction): void {
		const next = ghostReducer(this.$ghosts.get(), action);
		if (next !== this.$ghosts.get()) this.$ghosts.set(next);
	}

}


/** The earliest hit whose piece waits behind a break */
function heldHit(project: TProject): { laneId: string; hitId: string; time: number } | null {
	const held = project.entities.flatMap((entity) => {
		const link = entity.components.hitLink;
		const time = link?.held != null ? project.music.lanes.find((lane) => lane.id === link.laneId)?.hits.find((hit) => hit.id === link.hitId)?.time : undefined;
		return link != null && time != null ? [{ laneId: link.laneId, hitId: link.hitId, time }] : [];
	});
	return held.sort((a, b) => a.time - b.time)[0] ?? null;
}

/** Why a Fix didn't land: "Fix would leave 17 problems where there are 8, so nothing changed." */
function fixWorseWords(before: number, after: number): string {
	if (after > before) return `Fix would leave ${after} problems where there ${before === 1 ? 'is 1' : `are ${before}`}, so nothing changed. Undo the edit, or turn the pieces by hand.`;
	return 'Fix found nothing better than the run as it is, so nothing changed. Undo the edit, or turn the pieces by hand.';
}

/** `project` with these entities in place of the ones of the same id */
function withSettled(project: TProject, entities: TEntity[]): TProject {
	const changed = new Map(entities.map((entity) => [entity.id, entity]));
	return { ...project, entities: project.entities.map((entity) => changed.get(entity.id) ?? entity) };
}

/** What a fix did to a person's tilts, so it never rewrites an edit quietly: "Platform 8 went from 22.9° to 40°. " */
function tiltChange(project: TProject, changed: TEntity[]): string {
	const tilts = changed.flatMap((entity) => {
		const before = project.entities.find((item) => item.id === entity.id)?.components.hitLink?.angle;
		const after = entity.components.hitLink?.angle;
		return before != null && after != null && Math.abs(after - before) > DEGREE / 10 && entity.components.piece?.type === 'platform' ? [{ name: entity.name ?? 'A platform', before, after }] : [];
	});
	const degrees = (angle: number): string => `${Math.round((angle / DEGREE) * 10) / 10}°`;
	const [first] = tilts;
	if (first == null) return '';
	if (tilts.length === 1) return `${first.name} went from ${degrees(first.before)} to ${degrees(first.after)}. `;
	return `Tilted ${tilts.length} platforms again, from ${first.name}. `;
}

/** The piece that plays this hit, if any */
function pieceForHitKey(project: TProject, hit: { laneId: string; hitId: string }): string | undefined {
	return project.entities.find((entity) => entity.components.piece != null && entity.components.hitLink?.laneId === hit.laneId && entity.components.hitLink.hitId === hit.hitId)?.id;
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The simulation's reason a gap piece found no place, in the app's words, with what to do */
function gapFailure(type: TGapPieceType, message: string): string {
	const piece: string = type;
	if (message.includes('fall freely')) return `No ${piece} fits this gap. Tilt the platform before the gap so the marble flies off it, then try again.`;
	if (message.includes('fall below')) return `No ${piece} fits this gap. The marble doesn't fall far enough before the next note; try a rail or a tunnel.`;
	if (message.includes('crosses the earlier trajectory')) return `No ${piece} fits this gap. Every spot crosses the marble's earlier fall or another marble's lane; move the pieces around the gap.`;
	if (message.includes('does not reach the hit')) return `No ${piece} fits this gap. The marble doesn't reach the note before the gap; fix that platform first.`;
	return `No ${piece} fits this gap. ${message}.`;
}

/** Next's message when it has nothing left to place, naming the marble in focus */
function everyNotePlacedMessage(project: TProject, selection: string[]): string {
	const laneId = focusedLaneId(project, selection);
	const marble = laneId != null ? project.music.lanes.find((lane) => lane.id === laneId)?.name : undefined;
	if (marble != null) return `Every note ${marble} reaches already has a platform`;
	return project.music.lanes.length === 1 ? `Every note ${project.music.lanes[0]?.name ?? 'the marble'} reaches already has a platform` : 'Every note the marbles reach already has a platform';
}

/** The lane of the selected hit or piece, if any */
function focusedLaneId(project: TProject, selection: string[]): string | null {
	for (const key of selection) {
		const entity = project.entities.find((item) => item.id === key);
		const laneId = entity?.components.hitLink?.laneId ?? entity?.components.marble?.laneId;
		if (laneId != null) return laneId;
		const lane = project.music.lanes.find((item) => key.startsWith(`hit:${item.id}:`));
		if (lane != null) return lane.id;
	}
	return null;
}

/** What a Build Track left, in the words of its notice and for `get_state` */
export interface TBuildReport {
	/** The two-line notice */
	message: string;
	/** Everything it did, behind Details */
	details: string;
	isStopped: boolean;
	seconds: number;
	added: number;
	turned: string[];
	releaseShift: number;
	bowls: string[];
	/** Hits that are not on time, as `marble`, 1-based `hit`, `time` and `status` */
	attention: { marble: string; laneId: string; hitId: string; hit: number; time: number; status: string }[];
}

function buildReport(project: TProject, outcome: TBuildOutcome, label: string, problems: number, ms: number, from?: { laneId: string; hitId: string }): TBuildReport {
	const nameOf = (laneId: string): string => project.music.lanes.find((lane) => lane.id === laneId)?.name ?? 'The marble';
	const attention = outcome.attention.map((hit) => ({ marble: nameOf(hit.laneId), laneId: hit.laneId, hitId: hit.hitId, hit: hit.index + 1, time: hit.time, status: hit.status }));
	const pieces = `${outcome.added} ${outcome.added === 1 ? 'piece' : 'pieces'}`;
	const named = attention.slice(0, 3).map((hit) => `${hit.marble} hit ${hit.hit}`);
	const needs = attention.length > 0 ? `${attention.length === 1 ? '1 hit needs' : `${attention.length} hits need`} attention: ${named.join(', ')}${attention.length > named.length ? ' and more' : ''}.` : '';
	const turned = outcome.turned.length > 0 ? `Turned ${outcome.turned.length} of your ${outcome.turned.length === 1 ? 'platform' : 'platforms'}.` : '';
	const moved = outcome.releaseShift !== 0 ? `Moved the releases ${Math.abs(outcome.releaseShift * 100).toFixed(1)} cm.` : '';
	const fromLane = from != null ? project.music.lanes.find((lane) => lane.id === from.laneId) : undefined;
	const rebuilt = from != null ? `Rebuilt after Hit ${(fromLane?.hits.findIndex((hit) => hit.id === from.hitId) ?? 0) + 1} of ${fromLane?.name ?? 'the marble'}` : null;
	const first = outcome.isStopped ? `Stopped building: ${label}. The pieces so far stay.` : problems === 0 ? `${rebuilt ?? 'Built the track'}: ${label}, ${pieces}.` : `${rebuilt ?? 'Built what fits'}: ${label}, ${pieces}.`;
	const message = [first, turned, moved, outcome.isStopped ? '' : needs].filter(Boolean).join(' ');
	const details = [...outcome.bowls, `Took ${Math.max(1, Math.round(ms / 1000))} s.`, ...attention.map((hit) => `${hit.marble} hit ${hit.hit} at ${formatTime(hit.time)}: ${hit.status}.`)].join(' ');
	return { message, details, isStopped: outcome.isStopped, seconds: Math.round(ms / 100) / 10, added: outcome.added, turned: outcome.turned, releaseShift: outcome.releaseShift, bowls: outcome.bowls, attention };
}
