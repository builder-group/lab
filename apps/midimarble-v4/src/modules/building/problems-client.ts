import type { TProject } from '@/modules/project';
import { createRequestQueue, packResult, type TSimulationResult } from '@/modules/simulation';
import type { TPreflightIssue } from './export-preflight';
import type { TProblemsWorkerRequest, TProblemsWorkerResponse } from './problems.worker';

export interface TProblemsClient {
	/** The run's problems, found in the problems worker; a newer question replaces one still waiting, which rejects as superseded */
	check: (project: TProject, result: TSimulationResult) => Promise<TPreflightIssue[]>;
	dispose: () => void;
}

/** A client of the problems worker, started on the first question */
export function createProblemsClient(): TProblemsClient {
	let worker: Worker | null = null;
	const queue = createRequestQueue<Omit<TProblemsWorkerRequest, 'id' | 'result'> & { result: TSimulationResult }>({
		send: (id, message) => {
			// Packed only when sent: a question replaced while waiting costs nothing
			const { packed, transfer } = packResult(message.result);
			const request: TProblemsWorkerRequest = { id, project: message.project, result: packed };
			ensureWorker().postMessage(request, transfer);
		}
	});

	function ensureWorker(): Worker {
		if (worker != null) return worker;
		const created = new Worker(new URL('./problems.worker.ts', import.meta.url), { type: 'module' });
		created.addEventListener('message', (event: MessageEvent<TProblemsWorkerResponse>) => {
			queue.receive(event.data);
		});
		created.addEventListener('error', (event) => {
			queue.fail(new Error(event.message || 'The problems worker failed'));
		});
		worker = created;
		return created;
	}

	return {
		check: (project, result) => queue.enqueue<TPreflightIssue[]>('check', { project, result }),
		dispose() {
			queue.dispose();
			worker?.terminate();
			worker = null;
		}
	};
}
