import { createId } from '@/modules/project';
import { runAutoPlaceSearch, type TAngleEvaluation, type TAngleTry, type TAutoPlacePlan } from './assists';
import { gapSearch, type TGapEvaluation, type TGapPieceProposal, type TGapSearchPlan, type TGapTry } from './gap-pieces';
import { createRequestQueue, type TQueueResponse } from './request-queue';
import type { TAutoPlaceAnswer, TGapAnswer, TSearchBatch, TSearchRequest, TWorkerMessage, TWorkerRequest } from './worker-protocol';

// A pool of assists workers that share one search at a time: Auto place's angles or a long gap's switchbacks,
// rails and tunnels. Each stage's tries are split into small chunks and handed to whichever worker is free; the
// answers are put back in the order the tries were asked and reduced there, so the choice is the one a single
// worker makes, whatever the pool size or the timing. Every worker simulates and prepares the search's project
// once, the first time it gets a chunk of it.

/** One worker of the pool, a Web Worker in the browser or a worker thread in a Node benchmark */
export interface TPoolWorker {
	post: (message: TWorkerMessage) => void;
	listen: (onAnswer: (response: TQueueResponse<unknown>) => void, onError: (error: Error) => void) => void;
	terminate: () => void;
}

export interface TAssistPoolOptions {
	size: number;
	createWorker: () => TPoolWorker;
}

export type TAutoPlaceRequest = Omit<Extract<TWorkerRequest, { kind: 'autoPlace' }>, 'kind' | 'launchAngles'>;
export type TGapPieceRequest = Omit<Extract<TWorkerRequest, { kind: 'gapPiece' }>, 'kind'>;

export interface TSearchRunOptions {
	/** Checked between the search's stages; a stopped search rejects */
	isCancelled?: () => boolean;
}

export interface TAssistPool {
	readonly size: number;
	/**
	 * Like the assists worker's Auto place and gap pieces. One search runs at a time; a request waiting behind it
	 * is replaced by a newer one of its kind and rejects with a `SupersededError`.
	 */
	autoPlace: (request: TAutoPlaceRequest, options?: TSearchRunOptions) => Promise<TAutoPlaceAnswer>;
	gapPiece: (request: TGapPieceRequest, options?: TSearchRunOptions) => Promise<TGapAnswer>;
	dispose: () => void;
}

/** Workers for this machine: one per core besides the page's own thread, at most `MAX_POOL_SIZE`; 0 or 1 means no pool */
export function assistPoolSize(cores: number | undefined): number {
	if (cores == null || !Number.isFinite(cores)) return 0;
	return Math.max(0, Math.min(MAX_POOL_SIZE, Math.floor(cores) - 1));
}

// More workers stop paying off around here on an 11-core Mac: each search's stages wait for their slowest try
const MAX_POOL_SIZE = 6;

interface TSlot {
	worker: TPoolWorker | null;
	/** Id of the job the worker is computing */
	pending: number | null;
	/** The search the worker has prepared */
	search: string | null;
}

type TJob = { tries: TAngleTry[] | TGapTry[]; from: number } | { proposal: TGapPieceProposal };

interface TBatch {
	search: string;
	prepare: TSearchRequest;
	jobs: TJob[];
	next: number;
	left: number;
	/** Evaluations at the index of their try */
	evaluations: (TAngleEvaluation | TGapEvaluation)[];
	plan: TAutoPlacePlan | TGapSearchPlan | null;
	value: unknown;
	resolve: (batch: TBatch) => void;
	reject: (error: Error) => void;
}

type TRun =
	| { assist: 'autoPlace'; request: TAutoPlaceRequest; options: TSearchRunOptions }
	| { assist: 'gapPiece'; request: TGapPieceRequest; options: TSearchRunOptions };

export function createAssistPool(options: TAssistPoolOptions): TAssistPool {
	const { size, createWorker } = options;
	const slots: TSlot[] = Array.from({ length: size }, () => ({ worker: null, pending: null, search: null }));
	const sent = new Map<number, { batch: TBatch; job: TJob }>();
	let batch: TBatch | null = null;
	let nextJobId = 1;
	let nextSearch = 1;
	let isDisposed = false;

	function workerOf(slot: TSlot): TPoolWorker {
		if (slot.worker != null) return slot.worker;
		const worker = createWorker();
		worker.listen(
			(response) => receive(slot, response),
			(error) => crash(slot, error)
		);
		slot.worker = worker;
		return worker;
	}

	function receive(slot: TSlot, response: TQueueResponse<unknown>): void {
		const sentJob = sent.get(response.id);
		if (sentJob == null || slot.pending !== response.id) return;
		sent.delete(response.id);
		slot.pending = null;
		const { batch: owner, job } = sentJob;
		// An answer for a search that was stopped or failed only frees the worker
		if (owner === batch) {
			if (!response.ok) {
				finish(owner, new Error(response.error));
			} else if ('proposal' in job) {
				owner.value = response.value;
				owner.left--;
			} else {
				const answer = response.value as TSearchBatch;
				owner.plan ??= answer.plan;
				answer.evaluations.forEach((evaluation, index) => (owner.evaluations[job.from + index] = evaluation));
				owner.left--;
			}
			if (owner.left === 0) finish(owner, null);
		}
		dispatch();
	}

	function crash(slot: TSlot, error: Error): void {
		const sentJob = slot.pending != null ? sent.get(slot.pending) : undefined;
		if (slot.pending != null) sent.delete(slot.pending);
		slot.worker?.terminate();
		slot.worker = null;
		slot.pending = null;
		slot.search = null;
		if (sentJob != null) finish(sentJob.batch, error);
		dispatch();
	}

	function finish(done: TBatch, error: Error | null): void {
		if (batch !== done) return;
		batch = null;
		if (error != null) done.reject(error);
		else done.resolve(done);
	}

	/** Hands the next jobs to free workers; a finished search's answer goes to a worker that prepared it */
	function dispatch(): void {
		const current = batch;
		if (current == null || isDisposed) return;
		for (const slot of slots) {
			const job = current.jobs[current.next];
			if (job == null) return;
			if (slot.pending != null) continue;
			const isPrepared = slot.search === current.search;
			if ('proposal' in job && !isPrepared) continue;
			current.next++;
			const id = nextJobId++;
			slot.search = current.search;
			slot.pending = id;
			sent.set(id, { batch: current, job });
			workerOf(slot).post(
				'proposal' in job
					? { id, kind: 'gapAnswer', search: current.search, proposal: job.proposal }
					: { id, kind: 'searchTries', search: current.search, ...(isPrepared ? {} : { prepare: current.prepare }), tries: job.tries }
			);
		}
	}

	function runJobs(search: string, prepare: TSearchRequest, jobs: TJob[]): Promise<TBatch> {
		return new Promise<TBatch>((resolve, reject) => {
			batch = { search, prepare, jobs, next: 0, left: jobs.length, evaluations: [], plan: null, value: null, resolve, reject };
			dispatch();
		});
	}

	/** Answers one stage of tries; no tries prepares the search on every worker and brings its plan */
	async function evaluate(search: string, prepare: TSearchRequest, tries: TAngleTry[] | TGapTry[]): Promise<TSearchBatch> {
		const jobs: TJob[] = [];
		if (tries.length === 0) {
			for (let i = 0; i < size; i++) jobs.push({ tries: [], from: 0 });
		} else {
			// Two chunks per worker even out tries that end early on a failed check against ones simulated to the next hit
			const length = Math.max(1, Math.ceil(tries.length / (2 * size)));
			for (let from = 0; from < tries.length; from += length) jobs.push({ tries: tries.slice(from, from + length) as TAngleTry[] | TGapTry[], from });
		}
		const done = await runJobs(search, prepare, jobs);
		if (done.plan == null) throw new Error('The assists pool lost the search');
		return { plan: done.plan, evaluations: done.evaluations };
	}

	async function run(item: TRun): Promise<TAutoPlaceAnswer | TGapAnswer> {
		const startedAt = performance.now();
		const search = `search-${nextSearch++}`;
		const isCancelled = (): boolean => isDisposed || item.options.isCancelled?.() === true;
		// One id for every worker, which would otherwise each name a new piece differently
		const entityId = item.request.entityId ?? createId('piece');
		if (item.assist === 'autoPlace') {
			const prepare: TSearchRequest = { assist: 'autoPlace', ...item.request, entityId };
			const [isOk, error, placement] = await runAutoPlaceSearch(
				async (tries) => {
					const answer = await evaluate(search, prepare, tries);
					return { plan: answer.plan as TAutoPlacePlan, evaluations: answer.evaluations as TAngleEvaluation[] };
				},
				{ isCancelled }
			);
			if (!isOk) throw error;
			return {
				entity: placement.entity,
				angle: placement.angle,
				nextDot: placement.nextDot,
				paceError: placement.paceError ?? null,
				computeMs: performance.now() - startedAt
			};
		}
		const prepare: TSearchRequest = { assist: 'gapPiece', ...item.request, entityId };
		const { plan } = await evaluate(search, prepare, []);
		const steps = gapSearch(plan as TGapSearchPlan);
		let step = steps.next();
		while (step.done !== true) {
			if (isCancelled()) throw new Error('The gap search was stopped');
			const answer = await evaluate(search, prepare, step.value);
			step = steps.next(answer.evaluations as TGapEvaluation[]);
		}
		const [isOk, error, proposal] = step.value;
		if (!isOk) throw error;
		const done = await runJobs(search, prepare, [{ proposal }]);
		return { ...(done.value as TGapAnswer), computeMs: performance.now() - startedAt };
	}

	// One search at a time, since a search keeps every worker busy; a clicked Auto place goes before a gap piece
	const queue = createRequestQueue<TRun>({
		send: (id, message) => {
			run(message).then(
				(value) => queue.receive({ id, ok: true, value }),
				(error: unknown) => queue.receive({ id, ok: false, error: error instanceof Error ? error.message : String(error) })
			);
		},
		priority: (channel) => (channel === 'autoPlace' ? 0 : 1)
	});

	return {
		size,
		autoPlace(request, runOptions = {}) {
			return queue.enqueue<TAutoPlaceAnswer>('autoPlace', { assist: 'autoPlace', request, options: runOptions });
		},
		gapPiece(request, runOptions = {}) {
			return queue.enqueue<TGapAnswer>('gapPiece', { assist: 'gapPiece', request, options: runOptions });
		},
		dispose() {
			isDisposed = true;
			queue.dispose();
			if (batch != null) finish(batch, new Error('The assists pool is disposed'));
			for (const slot of slots) {
				slot.worker?.terminate();
				slot.worker = null;
				slot.pending = null;
			}
			sent.clear();
		}
	};
}
