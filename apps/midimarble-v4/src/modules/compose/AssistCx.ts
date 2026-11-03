import { createState } from 'feature-state';
import { BACKING_ID, createId, type TProject } from '@/modules/project';
import {
	defaultPlatformAngle,
	findLongGaps,
	frameBand,
	isMusicalPiece,
	isSuperseded,
	layoutOf,
	openLongGaps,
	type TAutoPlaceAnswer,
	type TContinueAnswer,
	type TGapPieceType,
	type THitResult,
	type TSimulationResult
} from '@/modules/simulation';
import { toHitKey } from '@/modules/studio/selection';
import type { StudioCx } from '@/modules/studio/StudioCx';
import { handNotes } from '@/modules/studio/timeline/hand-notes';
import { hitSummary } from '@/modules/studio/timeline/hit-status';
import { brokenHits, newlyBroken, replaceBroken, replaceLabel, type TReplaceOutcome } from './fix-it';
import { hitReach, isUnreachable, reachMessage, releaseFixFor } from './reachability';
import { acceptableCount, ghostReducer, initialGhostState, type TGhostAction, type TGhostState } from './ghosts';
import { commitAtHit, findStepTarget, pieceAngleCommands, pieceForHit, previousPiece, selectedPieceIds } from './step-loop';

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
	readonly $latency = createState<Partial<Record<TAssistKind, number>>>({});

	private continueKey: string | null = null;
	/** Next pressed while the result was still catching up with the latest edit; runs when it arrives */
	private queuedNext: { type: string; at: number } | null = null;
	private isMounted = false;

	constructor(private readonly studio: StudioCx) {}

	mount(): () => void {
		this.isMounted = true;
		const unlisten = [
			this.studio.simulation.$result.listen(() => {
				this.offerFixIt();
				this.runQueuedNext();
				this.refresh();
			}),
			this.studio.$selection.listen(() => this.refresh()),
			this.studio.$history.listen(({ value }) => {
				if (value != null) this.dispatch({ type: 'revision', revision: value.present.revision });
			})
		];
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
			return;
		}
		const target = findStepTarget(project, result, this.studio.$selection.get());
		// A long gap after the last piece comes first: across it the marble may fall too far to leave a dot
		const gap = project.music.lanes
			.flatMap((lane) => openLongGaps(project, lane.id))
			.filter((item) => target == null || item.laneId === target.laneId || item.to <= target.targetTime)
			.sort((a, b) => a.to - b.to)[0];
		if (gap != null && (target == null || gap.to <= target.targetTime + 1e-9)) {
			this.suggestGapPiece('switchback', gap.laneId, gap.fromHitId, gap.toHitId, { fallback: 'rail' });
			return;
		}
		const unreachable = this.firstUnreachable(project, result, target);
		if (unreachable != null) {
			this.explainUnreachable(project, result, unreachable);
			return;
		}
		if (target == null) {
			this.studio.notify('Every note this marble reaches already has a platform');
			return;
		}
		void this.place(target, type, 'next');
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
		const message = reachMessage(reach, { hit: `Hit ${index + 1}`, marble: lane?.name ?? 'The marble' }, fix);
		if (message == null) return;
		this.studio.$selection.set([toHitKey(hit.laneId, hit.hitId)]);
		if (!this.studio.$playing.get()) this.studio.$playhead.set(hit.targetTime);
		this.studio.notify(message, 'info', { actions: unreachableActions(this.studio, hit, fix) });
	}

	private runQueuedNext(): void {
		const queued = this.queuedNext;
		if (queued == null || this.currentResult() == null || this.isPlacing) return;
		this.queuedNext = null;
		// A press older than this belongs to a moment the user has moved on from
		if (performance.now() - queued.at < 1500) this.next(queued.type);
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
			if (target != null) void this.place(target, type, 'autoPlace');
			else this.studio.notify('No note is open for a platform. Select a platform to tilt it again, or add a note in the timeline.');
			return;
		}
		if (!isMusicalPiece(pieceType)) {
			const kind = layoutOf(pieceType);
			this.studio.notify(kind === 'path' || kind === 'tube' ? "Add Platform tilts platforms only. Drag the path's handles to shape it." : 'Add Platform tilts platforms only. Turn this piece by hand.');
			return;
		}
		const startedAt = performance.now();
		client.autoPlace({ project, laneId: link.laneId, hitId: link.hitId, type: pieceType, entityId: entity.id }).then(
			(answer) => {
				this.record('autoPlace', startedAt);
				const present = this.studio.project;
				if (present == null || present.revision !== project.revision) return;
				const commands = pieceAngleCommands(present, new Map([[entity.id, answer.angle]]));
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
	async place(hit: THitResult, type: string, kind: TAssistKind = 'autoPlace'): Promise<void> {
		this.isPlacing = true;
		try {
			await this.placeNow(hit, type, kind);
		} finally {
			this.isPlacing = false;
			this.runQueuedNext();
		}
	}

	private isPlacing = false;

	private async placeNow(hit: THitResult, type: string, kind: TAssistKind): Promise<void> {
		const project = this.studio.project;
		const client = this.studio.simulation.assists;
		if (project == null || hit.dot == null) return;
		const startedAt = performance.now();
		const layout = layoutOf(type);
		const id = createId('piece');
		if (client == null || layout === 'path' || layout === 'tube') {
			commitAtHit(this.studio, hit, pieceForHit(project, hit, type, 'default', id));
			this.record(kind, startedAt);
			return;
		}
		const request = client.autoPlace({ project, laneId: hit.laneId, hitId: hit.hitId, type, entityId: id });
		const quick = await Promise.race([
			request.then(
				(answer): TAutoPlaceAnswer | 'failed' => answer,
				(error: unknown): 'failed' | 'superseded' => (isSuperseded(error) ? 'superseded' : 'failed')
			),
			wait(AUTO_PLACE_WAIT_MS).then(() => 'slow' as const)
		]);
		const present = this.studio.project;
		if (present == null) return;
		if (typeof quick === 'object' && present.revision === project.revision) {
			commitAtHit(this.studio, hit, quick.entity);
			this.record(kind, startedAt);
			return;
		}
		const fallback = pieceForHit(present, hit, type, 'default', id);
		if (!commitAtHit(this.studio, hit, fallback)) return;
		this.record(kind, startedAt);
		if (quick === 'failed') this.studio.notify('No tilt keeps the next note in the frame, so the platform has the default tilt. Turn it by hand if the run needs it.');
		if (quick !== 'slow') return;
		const placedRevision = this.studio.project?.revision;
		request.then(
			(answer) => {
				this.record('autoPlace', startedAt);
				const latest = this.studio.project;
				const link = latest?.entities.find((entity) => entity.id === id)?.components.hitLink;
				// Only refine while nothing else happened since the default placement
				if (latest == null || link == null || latest.revision !== placedRevision) return;
				this.studio.execute(pieceAngleCommands(latest, new Map([[id, answer.angle]])), { amend: true });
			},
			() => undefined
		);
	}

	// MARK: - Ghosts

	/** Tab, or Return while ghosts show: adds every acceptable ghost as one edit */
	acceptGhosts(): boolean {
		const { ghost } = this.$ghosts.get();
		const project = this.studio.project;
		if (ghost == null || project == null || ghost.answer.revision !== project.revision) return false;
		const startedAt = performance.now();
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
		this.record('accept', startedAt);
		return true;
	}

	/** Escape: hides the ghosts until the next edit */
	dismiss(): boolean {
		if (!this.hasGhosts) return false;
		this.dispatch({ type: 'dismiss' });
		return true;
	}

	/**
	 * Asks for a switchback, rail or tunnel across a long gap and shows it as a ghost to accept. With
	 * `fallback`, a failed search asks for that type instead before telling the user.
	 */
	suggestGapPiece(type: TGapPieceType, laneId: string, fromHitId: string, toHitId: string, options: { accept?: boolean; fallback?: TGapPieceType } = {}): void {
		const project = this.studio.project;
		const client = this.studio.simulation.assists;
		if (project == null || client == null) return;
		const startedAt = performance.now();
		this.dispatch({ type: 'requestGap', revision: project.revision, laneId, toHitId });
		client.gapPiece({ type, project, laneId, fromHitId, toHitId }).then(
			(answer) => {
				this.record('gap', startedAt);
				this.dispatch({ type: 'gapAnswer', answer });
				if (options.accept === true) this.acceptGhosts();
			},
			(error: unknown) => {
				this.dispatch({ type: 'gapFailed', revision: project.revision });
				if (isSuperseded(error)) return;
				if (options.fallback != null && options.fallback !== type) {
					this.suggestGapPiece(options.fallback, laneId, fromHitId, toHitId, { accept: options.accept });
					return;
				}
				this.studio.notify(gapFailure(type, error instanceof Error ? error.message : String(error)));
			}
		);
	}

	// MARK: - Fix-its

	/** The run Re-place is working on, if any; Stop sets `isCancelled` */
	readonly $replacing = createState<{ done: number; total: number } | null>(null);
	private replaceRun: { isCancelled: boolean } | null = null;
	/** Hits of the latest current result, to tell which hits an edit broke */
	private baseline: { projectId: string; revision: number; hits: THitResult[] } | null = null;
	/** Per marble, its hits from the latest result in which none of them was broken, for moving a release back */
	private lastGood = new Map<string, THitResult[]>();
	private lastGoodProjectId: string | null = null;

	/**
	 * After an edit, compares the new run with the one before it. When later hits became Blocked or Missed, the
	 * edit's notice gets "Re-place N Platforms", or a notice says so; undo, redo and Re-place itself do not ask.
	 */
	private offerFixIt(): void {
		const project = this.studio.project;
		const result = this.currentResult();
		if (project == null || result == null) return;
		const previous = this.baseline;
		if (previous?.projectId === project.id && previous.revision === result.revision) return;
		this.baseline = { projectId: project.id, revision: result.revision, hits: result.hits };
		this.rememberGood(project, result);
		if (previous == null || previous.projectId !== project.id || previous.revision > result.revision || this.replaceRun != null) return;
		if (this.studio.$historyReveal.get()?.revision === result.revision) return;
		const broken = newlyBroken(previous.hits, result.hits);
		if (!broken.length) return;
		const count = brokenHits(result.hits).length;
		const action = { label: replaceLabel(count), title: 'Run Auto place again from the first broken hit', run: () => void this.replace() };
		const notice = this.studio.$notice.get();
		if (notice != null && notice.revision === result.revision && notice.progress == null) {
			this.studio.updateNotice(notice.id, { actions: [action, ...(notice.actions ?? [])] });
			return;
		}
		const words = broken.length === 1 ? '1 later hit is' : `${broken.length} later hits are`;
		this.studio.notifyEdit(`${words} now Blocked or Missed`, [action]);
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

	/**
	 * Re-place: runs Auto place again from the first broken hit onward as one undo step, with progress in the
	 * notice and Stop. With `only` (`laneId/hitId` keys), just those platforms.
	 */
	async replace(only?: string[]): Promise<TReplaceOutcome | null> {
		const project = this.studio.project;
		const result = this.currentResult();
		const client = this.studio.simulation.assists;
		if (project == null || result == null || client == null || this.replaceRun != null) return null;
		const targets = brokenHits(result.hits, only);
		if (!targets.length) {
			this.studio.notify(only == null ? 'Every platform lands its note; nothing to re-place' : 'This platform already lands on time');
			return null;
		}
		const run = { isCancelled: false };
		this.replaceRun = run;
		this.dispatch({ type: 'dismiss' });
		const startRevision = project.revision;
		let expected = startRevision;
		const stop = { label: 'Stop', title: 'Keep the platforms re-placed so far', run: () => (run.isCancelled = true) };
		const progressId = this.studio.notify(`Re-placing platforms · 0 of ${targets.length}`, 'info', { progress: 0, actions: [stop] });
		const before = only == null ? [...this.lastGood.values()].flat() : undefined;
		let outcome: TReplaceOutcome | null = null;
		try {
			outcome = await replaceBroken(
				project,
				result,
				{
					simulate: async (next) => client.simulate(next),
					autoPlace: async (next, hit, entity) => {
						const answer = await client.autoPlace({ project: next, laneId: hit.laneId, hitId: hit.hitId, type: entity.components.piece?.type ?? 'platform', entityId: entity.id });
						return answer.entity;
					},
					gapPiece: async (next, gap, type, entityId) => {
						const answer = await client.gapPiece({ type, project: next, laneId: gap.laneId, fromHitId: gap.fromHitId, toHitId: gap.toHitId, entityId });
						return answer.entity;
					},
					commit: (_next, commands, isFirst) => {
						// Another edit since the last step stops the run rather than folding into it
						if (this.studio.project?.revision !== expected) return null;
						if (!this.studio.execute(commands, { amend: !isFirst })) return null;
						expected = this.studio.project?.revision ?? expected;
						return this.studio.project;
					},
					onProgress: (done, total) => {
						this.$replacing.set({ done, total });
						this.studio.updateNotice(progressId, { message: `Re-placing platforms · ${Math.min(done, total)} of ${total}`, progress: total > 0 ? Math.min(1, done / total) : 0 });
					},
					isCancelled: () => run.isCancelled || (this.studio.project?.revision ?? expected) !== expected
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
		this.rememberGood(outcome.project, outcome.result);
		this.studio.updateNotice(progressId, { progress: undefined, actions: [] });
		const changed = this.studio.project?.revision !== startRevision;
		const summary = hitSummary(outcome.result.hits);
		const releases = outcome.releases.map((laneId) => outcome.project.music.lanes.find((lane) => lane.id === laneId)?.name ?? 'the marble');
		const moved = releases.length ? `${releases.join(' and ')} now starts just before its first note. ` : '';
		const message = !changed
			? only != null
				? "No tilt lands this platform on time. Choose Re-place Broken Platforms in the hit summary's menu, or turn it by hand."
				: 'No new tilt helps these platforms. Turn them by hand, or undo the edit that broke them.'
			: summary.problems.length === 0
				? `${moved}Re-placed ${outcome.replaced} ${outcome.replaced === 1 ? 'platform' : 'platforms'}: ${summary.label}`
				: `${moved}Re-placed ${outcome.replaced} ${outcome.replaced === 1 ? 'platform' : 'platforms'}. ${summary.label}: turn them by hand or undo the edit.`;
		if (changed) this.studio.notifyEdit(outcome.isStopped && !run.isCancelled ? `${message} Stopped by another edit.` : message);
		else this.studio.notify(message);
		return outcome;
	}

	/** Asks for Continue ghosts for the focused marble when the shown result is current */
	private refresh(): void {
		if (!this.isMounted) return;
		const project = this.studio.project;
		const result = this.currentResult();
		const client = this.studio.simulation.assists;
		if (project == null || result == null || client == null) return;
		const state = this.$ghosts.get();
		if (state.dismissedRevision === project.revision || state.pendingGap != null || state.ghost?.kind === 'gap') return;
		const target = findStepTarget(project, result, this.studio.$selection.get());
		const laneId = target?.laneId ?? null;
		const key = `${project.revision}:${laneId}`;
		if (key === this.continueKey) return;
		this.continueKey = key;
		if (laneId == null) {
			this.dispatch({ type: 'continueAnswer', revision: project.revision, answer: null });
			return;
		}
		const startedAt = performance.now();
		client.continueRun({ project, laneId }).then(
			(answer: TContinueAnswer | null) => {
				this.record('continue', startedAt);
				this.dispatch({ type: 'continueAnswer', revision: project.revision, answer });
			},
			() => {
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

	private record(kind: TAssistKind, startedAt: number): void {
		this.$latency.set({ ...this.$latency.get(), [kind]: Math.round(performance.now() - startedAt) });
	}
}

export type TAssistKind = 'next' | 'autoPlace' | 'continue' | 'gap' | 'accept';

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
	if (message.includes('crosses the earlier trajectory')) return `No ${piece} fits this gap. Every spot crosses the marble's earlier fall; move the pieces around the gap.`;
	if (message.includes('does not reach the hit')) return `No ${piece} fits this gap. The marble doesn't reach the note before the gap; fix that platform first.`;
	return `No ${piece} fits this gap. ${message}.`;
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

/** Actions for an unreachable hit: the release change that fixes it, when one does, and Make Backing */
export function unreachableActions(studio: StudioCx, hit: THitResult, fix: ReturnType<typeof releaseFixFor>): { label: string; title?: string; run: () => void }[] {
	const backing = { label: 'Make Backing', title: 'Heard in the film, no platform needed (0)', run: () => void handNotes(studio, [toHitKey(hit.laneId, hit.hitId)], BACKING_ID) };
	if (fix == null) return [backing];
	return [{ label: fix.label, run: () => void studio.execute(fix.commands) }, backing];
}
