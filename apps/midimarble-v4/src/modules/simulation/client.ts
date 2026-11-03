import type { TProject } from '@/modules/project';
import type { TSimulationWorkerRequest, TSimulationWorkerResponse } from './simulation.worker';
import type { TSimulationResult } from './types';

export interface TSimulationClient {
	/**
	 * Simulates in the worker. Only the newest request waiting behind a running one is run; requests it
	 * replaced resolve with its result, whose `revision` tells callers which project it belongs to.
	 */
	simulate: (project: TProject) => Promise<TSimulationResult>;
	dispose: () => void;
}

interface TPendingRequest {
	project: TProject;
	waiters: { resolve: (result: TSimulationResult) => void; reject: (error: Error) => void }[];
}

export function createSimulationClient(): TSimulationClient {
	const worker = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' });
	let nextId = 1;
	let running: { id: number; request: TPendingRequest } | null = null;
	let pending: TPendingRequest | null = null;
	let isDisposed = false;

	function runNext(): void {
		if (running != null || pending == null || isDisposed) return;
		const request = pending;
		pending = null;
		running = { id: nextId++, request };
		const message: TSimulationWorkerRequest = { id: running.id, project: request.project };
		worker.postMessage(message);
	}

	worker.addEventListener('message', (event: MessageEvent<TSimulationWorkerResponse>) => {
		const response = event.data;
		if (running == null || response.id !== running.id) return;
		const { waiters } = running.request;
		running = null;
		for (const waiter of waiters) {
			if (response.ok) waiter.resolve(response.result);
			else waiter.reject(new Error(response.error));
		}
		runNext();
	});

	worker.addEventListener('error', (event) => {
		const error = new Error(event.message || 'The simulation worker failed');
		for (const waiter of running?.request.waiters ?? []) waiter.reject(error);
		running = null;
		runNext();
	});

	return {
		simulate(project) {
			if (isDisposed) return Promise.reject(new Error('The simulation client is disposed'));
			return new Promise<TSimulationResult>((resolve, reject) => {
				const waiters = [...(pending?.waiters ?? []), { resolve, reject }];
				pending = { project, waiters };
				runNext();
			});
		},
		dispose() {
			isDisposed = true;
			const error = new Error('The simulation client is disposed');
			for (const waiter of [...(running?.request.waiters ?? []), ...(pending?.waiters ?? [])])
				waiter.reject(error);
			running = null;
			pending = null;
			worker.terminate();
		}
	};
}
