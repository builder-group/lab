import { createState } from 'feature-state';
import { createId, type TProject } from '@/modules/project';
import {
	defaultPlatformAngle,
	findLongGaps,
	frameBand,
	isSuperseded,
	layoutOf,
	type TAutoPlaceAnswer,
	type TContinueAnswer,
	type THitResult,
	type TSimulationResult
} from '@/modules/simulation';
import type { StudioCx } from '@/modules/studio/StudioCx';
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
	 * hit: a long gap asks for a rail, any other gap gets an auto placed piece.
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
		if (target == null) {
			this.studio.notify('Every reachable hit of this marble has a piece');
			return;
		}
		const gap = findLongGaps(project, target.laneId).find((item) => item.toHitId === target.hitId && item.bridgedBy == null);
		if (gap != null) {
			this.suggestGapPiece('rail', target.laneId, gap.fromHitId, gap.toHitId);
			return;
		}
		void this.place(target, type, 'next');
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
			else this.studio.notify('Select a piece or leave an open hit to auto place');
			return;
		}
		const kind = layoutOf(pieceType);
		if (kind === 'path' || kind === 'tube') {
			this.studio.notify('Auto place sets platform and windmill angles; drag the rail handles to shape it');
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
					this.studio.notify('Auto place keeps this angle');
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
		const request = client.autoPlace({ project, laneId: hit.laneId, hitId: hit.hitId, type, entityId: id, launchAngles: launchAngles(project, hit) });
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
		if (quick === 'failed') this.studio.notify('Auto place found no angle that keeps the next dot in frame, so the default lean is used');
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
			this.studio.notify(`Continued ${acceptableCount(ghost)} ${acceptableCount(ghost) === 1 ? 'piece' : 'pieces'}`);
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

	/** Asks for a rail or tunnel across a long gap and shows it as a ghost to accept */
	suggestGapPiece(type: 'rail' | 'tunnel', laneId: string, fromHitId: string, toHitId: string, options: { accept?: boolean } = {}): void {
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
				const label = type === 'rail' ? 'rail' : 'tunnel';
				const message = error instanceof Error ? error.message : String(error);
				const hint = message.includes('fall freely') ? ' Tilt the piece before the gap so the marble flies off it, then try again.' : '';
				this.studio.notify(`No ${label} fits this gap. ${message}.${hint}`);
			}
		);
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
 * Before a long gap the marble has to fly off sideways so a rail can catch it. Auto place would keep the
 * next dot in frame, which a 1.5 s fall cannot do, and settles on a nearly flat piece that bounces the
 * marble in place. Instead clear leans are tried, mirroring the previous piece first like a zigzag.
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
	if (error instanceof Error && error.message.startsWith('No angle')) return 'Auto place found no angle that keeps the next dot on time and in frame';
	return `Auto place failed: ${error instanceof Error ? error.message : String(error)}`;
}
