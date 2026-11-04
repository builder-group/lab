import type { TProject } from '@/modules/project';
import { createRequestQueue, type TRequestQueue } from './request-queue';
import type { TSimulationWorkerRequest, TSimulationWorkerResponse } from './simulation.worker';
import type { TSimulationResult } from './types';
import type { TAutoPlaceAnswer, TContinueAnswer, TGapAnswer, TWorkerRequest } from './worker-protocol';

export interface TSimulationClient {
	/**
	 * Simulates in the worker. Only the newest request waiting behind a running one is run; requests it
	 * replaced resolve with its result, whose `revision` tells callers which project it belongs to.
	 */
	simulate: (project: TProject) => Promise<TSimulationResult>;
	/**
	 * Simulates in the assists worker, for assists that alternate their own runs with Auto place, such as
	 * Re-place: both resume from the snapshots of that worker's latest run instead of rebuilding it
	 */
	simulateAssist: (project: TProject) => Promise<TSimulationResult>;
	/**
	 * Assists run in a second worker so a slow search never holds up the live trajectory. Each kind keeps
	 * only its newest waiting request; replaced requests reject with a `SupersededError`.
	 */
	autoPlace: (request: Omit<Extract<TWorkerRequest, { kind: 'autoPlace' }>, 'kind'>) => Promise<TAutoPlaceAnswer>;
	continueRun: (request: Omit<Extract<TWorkerRequest, { kind: 'continue' }>, 'kind'>) => Promise<TContinueAnswer | null>;
	gapPiece: (request: Omit<Extract<TWorkerRequest, { kind: 'gapPiece' }>, 'kind'>) => Promise<TGapAnswer>;
	dispose: () => void;
}

// Placing at a clicked dot and Re-place's runs are waited on, a long-gap piece was asked for, Continue is background work
const assistPriority: Record<string, number> = { autoPlace: 0, simulate: 0, gapPiece: 1, continue: 2 };

export function createSimulationClient(): TSimulationClient {
	const simulation = connect();
	const assists = connect((channel) => assistPriority[channel] ?? 3);

	return {
		simulate(project) {
			return simulation.queue.enqueue<TSimulationResult>('simulate', { kind: 'simulate', project }, { merge: true });
		},
		simulateAssist(project) {
			return assists.queue.enqueue<TSimulationResult>('simulate', { kind: 'simulate', project });
		},
		autoPlace(request) {
			return assists.queue.enqueue<TAutoPlaceAnswer>('autoPlace', { kind: 'autoPlace', ...request });
		},
		continueRun(request) {
			return assists.queue.enqueue<TContinueAnswer | null>('continue', { kind: 'continue', ...request });
		},
		gapPiece(request) {
			return assists.queue.enqueue<TGapAnswer>('gapPiece', { kind: 'gapPiece', ...request });
		},
		dispose() {
			simulation.dispose();
			assists.dispose();
		}
	};
}

function connect(priority?: (channel: string) => number): { queue: TRequestQueue<TWorkerRequest>; dispose: () => void } {
	const worker = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' });
	const queue = createRequestQueue<TWorkerRequest>({
		send: (id, message) => {
			const request: TSimulationWorkerRequest = { ...message, id };
			worker.postMessage(request);
		},
		priority
	});
	worker.addEventListener('message', (event: MessageEvent<TSimulationWorkerResponse>) => {
		queue.receive(event.data);
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
