import type { TProject } from '@/modules/project';
import { assistPoolSize, createAssistPool, type TAssistPool, type TSearchRunOptions, type TPoolWorker } from './assist-pool';
import { createRequestQueue, type TRequestQueue, isPackedResult, unpackResult, type TSimulationResult } from '@/modules/simulation';
import { type TEditAnswer, type TEditRequest } from './edit-rule';
import type { TSimulationWorkerRequest, TSimulationWorkerResponse } from './simulation.worker';
import type { TAutoPlaceAnswer, TContinueAnswer, TGapAnswer, TWorkerRequest } from './worker-protocol';

export interface TSimulationClient {
	/**
	 * Simulates in the worker. Only the newest request waiting behind a running one is run; requests it
	 * replaced resolve with its result, whose `revision` tells callers which project it belongs to. With a
	 * `horizon`, see `TSimulator`.
	 */
	simulate: (project: TProject, horizon?: number) => Promise<TSimulationResult>;
	/**
	 * Simulates in the assists worker, for assists that alternate their own runs with Auto place, such as
	 * Fix: both resume from the snapshots of that worker's latest run instead of rebuilding it.
	 */
	simulateAssist: (project: TProject) => Promise<TSimulationResult>;
	/**
	 * What an edit does to the run (`answerEdit`); a newer request replaces a waiting one. A preview's waits in its own line
	 * behind an edit's, so a drag never takes the place of an edit that hasn't landed. In the trajectory worker, whose hops it reuses.
	 */
	settle: (request: TEditRequest, options?: { isPreview?: boolean }) => Promise<TEditAnswer>;
	/** Brings the marble back to pieces waiting for it, null when no way plays every hit */
	reconnect: (project: TProject) => Promise<Pick<TEditAnswer, 'pieces' | 'marbles'> | null>;
	/**
	 * Assists run in a second worker so a slow search never holds up the live trajectory. Each kind keeps
	 * only its newest waiting request; replaced requests reject with a `SupersededError`. Auto place spreads its
	 * tries over a pool of assists workers, started on its first use, when the machine has the cores for it;
	 * the pool picks the angle the single worker would. `isCanceled` stops a pool search between its stages.
	 */
	autoPlace: (request: Omit<Extract<TWorkerRequest, { kind: 'autoPlace' }>, 'kind'>, options?: TSearchRunOptions) => Promise<TAutoPlaceAnswer>;
	continueRun: (request: Omit<Extract<TWorkerRequest, { kind: 'continue' }>, 'kind'>) => Promise<TContinueAnswer | null>;
	/** Spread over the same pool as Auto place when there is one */
	gapPiece: (request: Omit<Extract<TWorkerRequest, { kind: 'gapPiece' }>, 'kind'>, options?: TSearchRunOptions) => Promise<TGapAnswer>;
	dispose: () => void;
}

// Placing at a clicked dot and Fix's runs are waited on, a long-gap piece was asked for, Continue is background work
const assistPriority: Record<string, number> = { settle: 0, reconnect: 0, autoPlace: 0, simulate: 0, gapPiece: 1, continue: 2 };

export function createSimulationClient(): TSimulationClient {
	const simulation = connect((channel) => (channel === 'previewSettle' ? 1 : 0));
	const assists = connect((channel) => assistPriority[channel] ?? 3);
	const poolSize = assistPoolSize(typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined);
	let pool: TAssistPool | null = null;
	const startPool = (): TAssistPool => (pool ??= createAssistPool({ size: poolSize, createWorker: createPoolWorker }));

	return {
		simulate(project, horizon) {
			return simulation.queue.enqueue<TSimulationResult>('simulate', { kind: 'simulate', project, ...(horizon != null ? { horizon } : {}) }, { merge: true });
		},
		simulateAssist(project) {
			return assists.queue.enqueue<TSimulationResult>('simulate', { kind: 'simulate', project });
		},
		autoPlace(request, options) {
			if (poolSize < 2)
				return assists.queue.enqueue<TAutoPlaceAnswer>('autoPlace', { kind: 'autoPlace', ...request });
			return startPool().autoPlace(request, options);
		},
		settle(request, options) {
			return simulation.queue.enqueue<TEditAnswer>(options?.isPreview === true ? 'previewSettle' : 'settle', { kind: 'settle', ...request });
		},
		reconnect(project) {
			return assists.queue.enqueue<Pick<TEditAnswer, 'pieces' | 'marbles'> | null>('reconnect', { kind: 'reconnect', project });
		},
		continueRun(request) {
			return assists.queue.enqueue<TContinueAnswer | null>('continue', { kind: 'continue', ...request });
		},
		gapPiece(request, options) {
			if (poolSize < 2) return assists.queue.enqueue<TGapAnswer>('gapPiece', { kind: 'gapPiece', ...request });
			return startPool().gapPiece(request, options);
		},
		dispose() {
			simulation.dispose();
			assists.dispose();
			pool?.dispose();
			pool = null;
		}
	};
}

function createSimulationWorker(): Worker {
	return new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' });
}

function createPoolWorker(): TPoolWorker {
	const worker = createSimulationWorker();
	return {
		post: (message) => worker.postMessage(message),
		listen: (onAnswer, onError) => {
			worker.addEventListener('message', (event: MessageEvent<TSimulationWorkerResponse>) => onAnswer(event.data));
			worker.addEventListener('error', (event) => onError(new Error(event.message || 'An assists worker failed')));
		},
		terminate: () => worker.terminate()
	};
}

function connect(priority?: (channel: string) => number): { queue: TRequestQueue<TWorkerRequest>; dispose: () => void } {
	const worker = createSimulationWorker();
	const queue = createRequestQueue<TWorkerRequest>({
		send: (id, message) => {
			const request: TSimulationWorkerRequest = { ...message, id };
			worker.postMessage(request);
		},
		priority
	});
	worker.addEventListener('message', (event: MessageEvent<TSimulationWorkerResponse>) => {
		const response = event.data;
		queue.receive(response.ok && isPackedResult(response.value) ? { ...response, value: unpackResult(response.value) } : response);
	});
	worker.addEventListener('error', (event) => {
		queue.fail(new Error(event.message || 'The simulation worker failed'));
	});
	return {
		queue,
		dispose() {
			queue.dispose();
			worker.terminate();
		}
	};
}
