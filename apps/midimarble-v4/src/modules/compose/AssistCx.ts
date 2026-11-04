import { createState } from 'feature-state';
import { createId, DEFAULT_MARBLE_RADIUS, type TEntity, type TProject, type TVec2 } from '@/modules/project';
import {
	defaultPlatformAngle,
	findLongGaps,
	frameBand,
	gapPieceReads,
	hitOwners,
	isMusicalPiece,
	isSuperseded,
	layoutOf,
	openLongGaps,
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
import { addedProblems, blockedScenery, brokenHits, fixPiece, lookPieces, replaceBroken, replaceCommands, replacePlan, replaceResultMessage, replaceResultSummary,type TPieceFix, type TReplaceDeps, type TReplaceOutcome, type TReplacePlan, type TSceneryFixKind } from './fix-it';
import { findFinish } from './finish-assist';
import { createEstimate } from './progress-estimate';
import { canMakeBacking, hitReach, isUnreachable, reachMessage, releaseFixFor } from './reachability';
import { unreachableActions } from './unreachable-fixes';
import { displayPiece } from './attach-edit';
import { newlyBroken } from './finish-assist';
import { acceptableCount, ghostReducer, initialGhostState, type TGhostAction, type TGhostState, type TPlaceAnswer } from './ghosts';
import { commitAtHit, findStepTarget, pieceForHit, previousPiece, selectedPieceIds } from './step-loop';

/** Longest wait for Auto place before a clicked dot gets the default angle and is refined afterwards */
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
	 * hit: a long gap asks for a switchback, or a rail when no switchback fits, and any other gap gets an
	 * auto placed piece. Before a long gap Auto place launches the marble into the coming switchback.
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
	 * No switchback or rail fits the gap, so Next takes the step Build Track would: another tilt before the gap, a turn
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

	/** A: re-solves the selected piece's angle, or places the next open hit like Next */
	autoPlace(type = 'platform'): void {
		const project = this.studio.project;
		const result = this.currentResult();
		const client = this.studio.simulation.assists;
		if (project == null || result == null || client == null) return;
		const ids = selectedPieceIds(project, this.studio.$selection.get());
		const entity = ids.length === 1 ? project.entities.find((item) => item.id === ids[0]) : undefined;
		const link = entity?.components.hitLink;
		const pieceType = entity?.components.piece?.type;
		if (entity == null || link == null || pieceType == null) {
			const target = findStepTarget(project, result, this.studio.$selection.get());
			if (target != null) void this.place(target, type);
			else this.studio.notify('No note is open for a platform. Select a platform to tilt it again, or add a note in the timeline.');
			return;
		}
		if (!isMusicalPiece(pieceType)) {
			const kind = layoutOf(pieceType);
			this.studio.notify(kind === 'path' || kind === 'tube' ? "Add Platform tilts platforms only. Drag the path's handles to shape it." : 'Add Platform tilts platforms only. Turn this piece by hand.');
			return;
		}
		client.autoPlace({ project, laneId: link.laneId, hitId: link.hitId, type: pieceType, entityId: entity.id }).then(
			(answer) => {
				const present = this.studio.project;
				if (present == null || present.revision !== project.revision) return;
				// The tilt and bounce together, and a platform a drag left where it lay goes back on its note
				const commands = replaceCommands(present, answer.entity);
				if (!commands.length) {
					this.studio.notify('This platform already lands on time');
					return;
				}
				this.studio.execute(commands);
			},
			(error: unknown) => {
				if (!isSuperseded(error)) this.studio.notify(autoPlaceFailure(error));
			}
		);
	}

	/**
	 * Places a piece at an open hit. Platforms and windmills ask Auto place for the angle and wait up to
	 * 150 ms; a slower answer refines the default angle afterwards within the same undo step.
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
		this.dispatch({ type: 'previewCancelled' });
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
	 * Asks for a switchback, rail or tunnel across a long gap and shows it as a ghost to accept. With
	 * `fallback`, a failed search asks for that type instead before telling the user.
	 */
	suggestGapPiece(type: TGapPieceType, laneId: string, fromHitId: string, toHitId: string, options: { accept?: boolean; fallback?: TGapPieceType; onFailed?: (message: string) => void } = {}): void {
		const project = this.studio.project;
		const client = this.studio.simulation.assists;
		if (project == null || client == null) return;
		this.dispatch({ type: 'requestGap', revision: project.revision, laneId, toHitId });
		client.gapPiece({ type, project, laneId, fromHitId, toHitId }).then(
			(answer) => {
				// A rail the pace or the frame can't follow leaves the gap to the switchback, like Build Track
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
	private buildRun: { isCancelled: boolean } | null = null;

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

	/** `build.stop` and Stop on an agent's pill: ends a running Build Track or Re-place; what it did stays */
	stopBuild(): void {
		if (this.buildRun != null) this.buildRun.isCancelled = true;
		if (this.replaceRun != null) this.replaceRun.isCancelled = true;
	}

	private buildAction(): { label: string; title: string; run: () => void } {
		return { label: 'Build Track', title: 'Build every open hit, in time order', run: () => void this.buildTrack() };
	}

	/** The worker calls a build needs. Searches stop between their stages once `isCancelled` says so. */
	private buildDeps(isCancelled: () => boolean): TBuildTrackDeps | null {
		const client = this.studio.simulation.assists;
		if (client == null) return null;
		return {
			// The assists worker, so its runs resume from the snapshots of the run before
			simulate: (project) => client.simulateAssist(project),
			autoPlace: (request) => client.autoPlace(request, { isCancelled }),
			gapPiece: (request) => client.gapPiece(request, { isCancelled }),
			continueRun: (request) => client.continueRun(request),
			isCancelled
		};
	}

	/**
	 * Build Track: builds every open hit of every marble in time order and ends each marble in a Finish, as one undo
	 * step. Each piece shows on the wall as it is found, with progress and Stop in the notice. Another edit stops it,
	 * like Re-place, and what it built so far stays.
	 */
	async buildTrack(from?: { laneId: string; hitId: string }, gapPiece?: TBuildGapPreference): Promise<TBuildOutcome | null> {
		const project = this.studio.project;
		if (project == null || this.buildRun != null || this.replaceRun != null) return null;
		if (!project.music.lanes.some((lane) => lane.hits.length > 0)) {
			this.studio.notify('Build Track needs notes. Import a song, or press T and tap along.');
			return null;
		}
		if (from == null && !this.hasOpenHits) {
			this.studio.notify('Every hit already has a platform');
			return null;
		}
		const run = { isCancelled: false };
		let expected = project.revision;
		const isCancelled = (): boolean => run.isCancelled || (this.studio.project?.revision ?? expected) !== expected;
		const deps = this.buildDeps(isCancelled);
		if (deps == null) return null;
		this.buildRun = run;
		this.clearQueuedNext();
		this.dispatch({ type: 'dismiss' });
		this.studio.$selection.set([]);
		const startedAt = performance.now();
		const estimate = createEstimate();
		const stop = { label: 'Stop', title: 'Keep the pieces built so far', run: () => (run.isCancelled = true) };
		const progressText = (progress: TBuildProgress): string => {
			const left = estimate.update(performance.now() - startedAt, progress.fraction, progress.done, progress.total);
			return ['Building track', `${progress.done} of ${progress.total} ${progress.total === 1 ? 'hit' : 'hits'}`, progress.restarts > 0 ? 'trying another start' : '', left].filter(Boolean).join(' · ');
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
		const present = this.studio.project;
		const result: TSimulationResult = { ...outcome.result, revision: present?.revision ?? outcome.project.revision };
		this.baseline = { projectId: project.id, revision: result.revision, hits: result.hits };
		this.replacedRevision = result.revision;
		const summary = problemSummary(preflightExport(present ?? outcome.project, result));
		const report = buildReport(project, outcome, summary.label, summary.problems.length, Math.round(performance.now() - startedAt), from);
		this.$lastBuild.set(report);
		const changed = present?.revision !== project.revision;
		if (changed) {
			const lastFix: TLastFix = { projectId: project.id, message: report.message, details: report.details, revision: present?.revision ?? outcome.project.revision };
			this.$lastFix.set(lastFix);
			const broken = brokenHits(result.hits).length;
			this.studio.notifyEdit(report.message, broken > 0 && present != null ? [{ label: this.replacePlan(present, result).label, title: 'Re-place the broken platforms', run: () => void this.replace() }] : [], { details: report.details });
		} else this.studio.notify(report.message);
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

	// MARK: - Fix-its

	/**
	 * Fix-its of pieces checked by a what-if before they are offered, per piece, for the revision they were checked
	 * on: the inspector's Fix-it and the hit summary's menu show only a fix that passed
	 */
	readonly $pieceFixes = createState<Record<string, TPieceFixCheck>>({});
	/** The run Re-place is working on, if any; Stop sets `isCancelled` */
	readonly $replacing = createState<{ done: number; total: number } | null>(null);
	/**
	 * The result of the latest Re-place in this project, its two-line notice and the full text, so the hit
	 * summary's Show Last Fix brings it back after the notice is gone, like Xcode's report navigator
	 */
	readonly $lastFix = createState<TLastFix | null>(null);
	private replaceRun: { isCancelled: boolean } | null = null;
	/** Hits of the latest current result, to tell which hits an edit broke */
	private baseline: { projectId: string; revision: number; hits: THitResult[] } | null = null;
	/** Per marble, its hits from the latest result in which none of them was broken, for moving a release back */
	private lastGood = new Map<string, THitResult[]>();
	private lastGoodProjectId: string | null = null;
	private replacedRevision: number | null = null;

	/**
	 * After an edit, compares the new run with the one before it. When later hits became Blocked or Missed, the
	 * edit's notice gets "Fix N Hits", or a notice says so; undo, redo and Re-place itself do not ask.
	 */
	private offerFixIt(): void {
		const project = this.studio.project;
		const result = this.currentResult();
		if (project == null || result == null) return;
		const previous = this.baseline;
		if (previous?.projectId === project.id && previous.revision === result.revision) return;
		this.baseline = { projectId: project.id, revision: result.revision, hits: result.hits };
		// A run Re-place made is not a reference for the next one: its release came from the reference itself
		if (this.replaceRun == null && this.buildRun == null && result.revision !== this.replacedRevision) this.rememberGood(project, result);
		if (previous == null || previous.projectId !== project.id || previous.revision > result.revision || this.replaceRun != null || this.buildRun != null) return;
		if (this.studio.$historyReveal.get()?.revision === result.revision) return;
		const broken = newlyBroken(previous.hits, result.hits);
		if (!broken.length) return;
		const plan = this.replacePlan(project, result);
		const action = { label: plan.label, title: plan.title, run: () => void this.replace() };
		const notice = this.studio.$notice.get();
		if (notice != null && notice.revision === result.revision && notice.progress == null) {
			this.studio.updateNotice(notice.id, { actions: [action, ...(notice.actions ?? [])] });
			return;
		}
		// Counts every hit the edit broke, the edited one included, so "later" would miscount
		const words = broken.length === 1 ? '1 hit is' : `${broken.length} hits are`;
		this.studio.notifyEdit(`${words} now Blocked, Missed or Stopped`, [action]);
	}

	private rememberGood(project: TProject, result: TSimulationResult): void {
		if (this.lastGoodProjectId !== project.id) this.lastGood.clear();
		this.lastGoodProjectId = project.id;
		for (const lane of project.music.lanes) {
			const hits = result.hits.filter((hit) => hit.laneId === lane.id);
			if (hits.some((hit) => hit.pieceEntityId != null) && !brokenHits(hits).length) this.lastGood.set(lane.id, hits);
		}
	}

	get isReplacing(): boolean {
		return this.replaceRun != null;
	}

	/** An assist is still working on the latest edit: what it answers next can change the project or what Next does */
	get isAnswering(): boolean {
		return this.isPlacing || this.replaceRun != null || this.buildRun != null || this.pendingContinue != null || this.$ghosts.get().pendingGap != null;
	}

	/** Shows the latest Re-place result of this project again, with its Details */
	showLastFix(): void {
		const last = this.$lastFix.get();
		if (last == null || last.projectId !== this.studio.project?.id) return;
		this.studio.notify(last.message, 'info', { details: last.details });
	}

	/** What Re-place Broken Platforms will change for the run as it is, for its label in the notice and the hit summary */
	replacePlan(project: TProject, result: TSimulationResult): TReplacePlan {
		const kinds = new Map<string, TSceneryFixKind | null>();
		for (const [id, check] of Object.entries(this.$pieceFixes.get())) {
			if (check.revision === project.revision && check.fix != null) kinds.set(id, check.fix.kind ?? null);
		}
		return replacePlan(project, result, [...this.lastGood.values()].flat(), kinds);
	}

	/** The worker calls a what-if needs: runs, Auto place and a new bridge for a long gap */
	private fixDeps(): Pick<TReplaceDeps, 'simulate' | 'autoPlace' | 'gapPiece'> | null {
		const client = this.studio.simulation.assists;
		if (client == null) return null;
		return {
			simulate: async (next) => client.simulateAssist(next),
			autoPlace: async (next, hit, entity) => {
				const answer = await client.autoPlace({ project: next, laneId: hit.laneId, hitId: hit.hitId, type: entity.components.piece?.type ?? 'platform', entityId: entity.id });
				return answer.entity;
			},
			gapPiece: async (next, gap, type, entityId) => {
				const answer = await client.gapPiece({ type, project: next, laneId: gap.laneId, fromHitId: gap.fromHitId, toHitId: gap.toHitId, entityId });
				return answer.entity;
			}
		};
	}

	/**
	 * Runs the what-if of a piece's Fix-it for the run as it is, once per revision, so the Fix-it is offered only
	 * when it will work, like Xcode's Fix-its: Move Clear, Place Again or Delete for scenery, Re-place for a
	 * platform another marble hits. The answer lands in `$pieceFixes`.
	 */
	checkPieceFix(entityId: string): void {
		const project = this.studio.project;
		const result = this.currentResult();
		const deps = this.fixDeps();
		if (project == null || result == null || deps == null || this.replaceRun != null || this.buildRun != null) return;
		const known = this.$pieceFixes.get()[entityId];
		if (known?.revision === project.revision) return;
		this.setPieceFix(entityId, { revision: project.revision, fix: null });
		fixPiece(project, result, entityId, deps).then(
			(fix) => {
				if (this.$pieceFixes.get()[entityId]?.revision === project.revision) this.setPieceFix(entityId, { revision: project.revision, fix });
			},
			(error: unknown) => {
				const message = error instanceof Error ? error.message : String(error);
				if (this.$pieceFixes.get()[entityId]?.revision === project.revision) this.setPieceFix(entityId, { revision: project.revision, fix: { commands: null, message } });
			}
		);
	}

	private setPieceFix(entityId: string, check: TPieceFixCheck): void {
		this.$pieceFixes.set({ ...this.$pieceFixes.get(), [entityId]: check });
	}

	/**
	 * Re-place: runs Auto place again from the first broken hit onward as one undo step, with progress in the
	 * notice and Stop. With `only` (`laneId/hitId` keys), just those platforms.
	 */
	async replace(only?: string[]): Promise<TReplaceOutcome | null> {
		const project = this.studio.project;
		const result = this.currentResult();
		const client = this.studio.simulation.assists;
		if (project == null || result == null || client == null || this.replaceRun != null || this.buildRun != null) return null;
		const targets = brokenHits(result.hits, only);
		const scenery = only == null ? blockedScenery(project, result) : [];
		if (!targets.length && !scenery.length && (only != null || lookPieces(project, result).length === 0)) {
			this.studio.notify(only == null ? 'Every platform lands its note; nothing to re-place' : 'This platform already lands on time');
			return null;
		}
		const run = { isCancelled: false };
		this.replaceRun = run;
		this.dispatch({ type: 'dismiss' });
		const startRevision = project.revision;
		let expected = startRevision;
		const stop = { label: 'Stop', title: 'Keep the platforms re-placed so far', run: () => (run.isCancelled = true) };
		const from = Math.min(targets[0]?.targetTime ?? Infinity, ...scenery.map((piece) => piece.entryTime ?? piece.hitTime ?? Infinity));
		// Like Finder's copy progress: how far, in broken hits fixed, and how long is left once the rate is known
		const startedAt = performance.now();
		const estimate = createEstimate();
		const progressText = (at: number, done: number, total: number, fraction: number): string => {
			if (only != null) return `Re-placing the platform at ${formatTime(at)}`;
			const left = estimate.update(performance.now() - startedAt, fraction, done, total);
			return [`Re-placing platforms · ${done} of ${total} broken ${total === 1 ? 'hit' : 'hits'} fixed`, left].filter(Boolean).join(' · ');
		};
		const progressId = this.studio.notify(progressText(from, 0, targets.length, 0), 'info', { progress: 0, actions: [stop] });
		const before = only == null ? [...this.lastGood.values()].flat() : undefined;
		const isCancelled = (): boolean => run.isCancelled || (this.studio.project?.revision ?? expected) !== expected;
		let outcome: TReplaceOutcome | null = null;
		try {
			outcome = await replaceBroken(
				project,
				result,
				{
					// The assists worker, so Auto place resumes from the run Re-place just simulated
					simulate: async (next) => client.simulateAssist(next),
					// Stop also ends a search spread over the assists pool between its stages
					autoPlace: async (next, hit, entity) => {
						const request = { project: next, laneId: hit.laneId, hitId: hit.hitId, type: entity.components.piece?.type ?? 'platform', entityId: entity.id };
						const answer = await client.autoPlace(request, { isCancelled });
						return answer.entity;
					},
					gapPiece: async (next, gap, type, entityId) => {
						const answer = await client.gapPiece({ type, project: next, laneId: gap.laneId, fromHitId: gap.fromHitId, toHitId: gap.toHitId, entityId }, { isCancelled });
						return answer.entity;
					},
					commit: (_next, commands, isFirst) => {
						// Another edit since the last step stops the run rather than folding into it
						if (this.studio.project?.revision !== expected) return null;
						if (!this.studio.execute(commands, { amend: !isFirst })) return null;
						expected = this.studio.project?.revision ?? expected;
						return this.studio.project;
					},
					onProgress: (done, total, at, fraction) => {
						this.$replacing.set({ done, total });
						this.studio.updateNotice(progressId, { message: progressText(at, done, total, fraction), progress: Math.min(1, Math.max(0, fraction)) });
					},
					isCancelled
				},
				{ only, before }
			);
		} catch (error: unknown) {
			this.studio.notify(`Re-place stopped: ${error instanceof Error ? error.message : String(error)}`, 'error');
		} finally {
			this.replaceRun = null;
			this.$replacing.set(null);
		}
		if (outcome == null) return null;
		this.baseline = { projectId: project.id, revision: outcome.result.revision, hits: outcome.result.hits };
		this.replacedRevision = outcome.result.revision;
		this.studio.updateNotice(progressId, { progress: undefined, actions: [] });
		const changed = this.studio.project?.revision !== startRevision;
		// How the run stands comes from the one problem model, the same as the hit summary and the export sheet
		const summary = problemSummary(preflightExport(outcome.project, { ...outcome.result, revision: outcome.project.revision }));
		const added = addedProblems(project, result, outcome.project, outcome.result);
		const message = !changed
			? only != null
				? "No tilt lands this platform on time. Choose Re-place Broken Platforms in the hit summary's menu, or turn it by hand."
				: 'No new tilt helps these platforms without adding a problem. Turn them by hand, or undo the edit that broke them.'
			: replaceResultMessage(project, result.hits, outcome, { label: summary.label, hitProblems: summary.hitProblems, added });
		if (changed) {
			// Two lines, with everything it changed behind Details and in the hit summary's Show Last Fix
			const standing = { label: summary.label, hitProblems: summary.hitProblems, added };
			const short = only != null ? message : replaceResultSummary(project, result.hits, outcome, standing);
			const stopped = outcome.isStopped && !run.isCancelled ? ' · stopped by another edit' : '';
			const details = outcome.isStopped && !run.isCancelled ? `${message} Stopped by another edit.` : message;
			const lastFix: TLastFix = { projectId: project.id, message: `${short}${stopped}`, details, revision: this.studio.project?.revision ?? outcome.project.revision };
			this.$lastFix.set(lastFix);
			this.studio.notifyEdit(lastFix.message, [], { details: lastFix.details });
		} else this.studio.notify(message);
		return outcome;
	}

	/** The marble Add Finish is searching a Finish for, while it runs */
	readonly $addingFinish = createState<string | null>(null);

	/**
	 * Add Finish: a Finish on the marble's fall after its last note, which what-if runs found to catch it, break no
	 * hit and touch no other marble or its pieces, as one undo step. The film length follows when it follows the song.
	 */
	async addFinish(laneId: string): Promise<void> {
		const project = this.studio.project;
		const deps = this.fixDeps();
		if (project == null || deps == null || this.$addingFinish.get() != null) return;
		this.$addingFinish.set(laneId);
		try {
			const placed = await findFinish(project, laneId, { simulate: deps.simulate });
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
			this.$addingFinish.set(null);
		}
	}

	/**
	 * The Fix-it of a piece that follows a marble and is Blocked or hit by another marble (Move Clear, or Re-place
	 * of the other marble's platform before the hit), applied only when its what-if run breaks no hit and adds no
	 * problem, as one undo step
	 */
	async fixPiece(entityId: string): Promise<void> {
		const project = this.studio.project;
		const result = this.currentResult();
		const deps = this.fixDeps();
		if (project == null || result == null || deps == null || this.replaceRun != null) return;
		// The what-if that made the Fix-it's label, when it belongs to this revision
		const checked = this.$pieceFixes.get()[entityId];
		const fix = checked?.revision === project.revision && checked.fix != null ? checked.fix : await fixPiece(project, result, entityId, deps);
		// Another edit while the what-if ran makes it stale
		if (this.studio.project?.revision !== project.revision) return;
		if (fix.rebuildFrom != null) {
			await this.buildTrack(fix.rebuildFrom);
			return;
		}
		if (fix.commands == null) {
			this.studio.notify(fix.message);
			return;
		}
		if (this.studio.execute(fix.commands)) this.studio.notifyEdit(fix.message);
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


const DEGREE = Math.PI / 180;

/**
 * Clear leans for the hit before a long gap, mirroring the previous piece first like a zigzag. Auto
 * place launches the marble into a switchback itself, so Compose no longer sends these; they remain for
 * a rail that needs a steeper launch.
 */
export function launchAngles(project: TProject, hit: THitResult): number[] | undefined {
	const gap = findLongGaps(project, hit.laneId).find((item) => item.fromHitId === hit.hitId && item.bridgedBy == null);
	if (gap == null) return undefined;
	const previous = previousPiece(project, hit.laneId, hit.targetTime)?.angle;
	const lean = previous != null && Math.abs(previous) > DEGREE ? -Math.sign(previous) : Math.sign(defaultPlatformAngle(hit.dot ?? { x: 0, y: 0 }, hit.velocity, frameBand(project).centerX));
	return [17, 12, 22, 28].flatMap((degrees) => [lean * degrees * DEGREE, -lean * degrees * DEGREE]);
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function autoPlaceFailure(error: unknown): string {
	if (error instanceof Error && error.message.startsWith('No angle')) return 'No tilt lands the marble on time with the next note in the frame. Turn the platform by hand or move the note.';
	return `The platform couldn't be tilted: ${error instanceof Error ? error.message : String(error)}`;
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
	finishes: string[];
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
	const details = [message, ...outcome.finishes, `Took ${Math.max(1, Math.round(ms / 1000))} s.`, ...attention.map((hit) => `${hit.marble} hit ${hit.hit} at ${formatTime(hit.time)}: ${hit.status}.`)].join(' ');
	return { message, details, isStopped: outcome.isStopped, seconds: Math.round(ms / 100) / 10, added: outcome.added, turned: outcome.turned, releaseShift: outcome.releaseShift, finishes: outcome.finishes, attention };
}

/** A piece's Fix-it as its what-if found it for `revision`; `fix` is null while the what-if runs */
export interface TPieceFixCheck {
	revision: number;
	fix: TPieceFix | null;
}

/** A Re-place result as its notice showed it */
export interface TLastFix {
	projectId: string;
	/** The two-line notice */
	message: string;
	/** Everything it changed, behind Details */
	details: string;
	/** Revision right after the fix */
	revision: number;
}
