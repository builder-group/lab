import type { TProject } from '@/modules/project';
import type { TPatternAnswer, TPatternWorkerRequest, TPatternWorkerResponse } from './pattern.worker';
import type { TGroupChange, TGroupRunProgress } from './run-group';

/** A preview running longer than this is ended for a newer one; a quicker one finishes first, as starting the worker costs more */
const PREVIEW_PATIENCE = 800;

export class PatternCanceledError extends Error {
	constructor() {
		super('The Pattern run was stopped');
		this.name = 'PatternCanceledError';
	}
}

export interface TPatternClient {
	/** Runs a Group change for real, ending whatever runs now */
	run: (project: TProject, change: TGroupChange, onProgress?: (progress: TGroupRunProgress) => void) => Promise<TPatternAnswer>;
	/** Asks for the ghost of a change. Only the newest waiting one runs; older ones reject as canceled */
	preview: (project: TProject, change: TGroupChange) => Promise<TPatternAnswer>;
	/** Ends what runs and what waits */
	cancel: () => void;
	dispose: () => void;
}

interface TJob {
	project: TProject;
	change: TGroupChange;
	isPreview: boolean;
	onProgress?: ((progress: TGroupRunProgress) => void) | undefined;
	resolve: (answer: TPatternAnswer) => void;
	reject: (error: Error) => void;
}

export function createPatternClient(): TPatternClient {
	let worker: Worker | null = null;
	let current: (TJob & { id: number; startedAt: number }) | null = null;
	let waiting: TJob | null = null;
	let nextId = 0;

	function ensureWorker(): Worker {
		if (worker != null) return worker;
		const created = new Worker(new URL('./pattern.worker.ts', import.meta.url), { type: 'module' });
		created.addEventListener('message', (event: MessageEvent<TPatternWorkerResponse>) => {
			const response = event.data;
			if (current?.id !== response.id) return;
			if (response.kind === 'progress') {
				current.onProgress?.(response.progress);
				return;
			}
			const job = current;
			current = null;
			if (response.kind === 'done') job.resolve(response.answer);
			else job.reject(new Error(response.message));
			startWaiting();
		});
		created.addEventListener('error', (event) => {
			const job = current;
			current = null;
			worker?.terminate();
			worker = null;
			job?.reject(new Error(event.message || 'The Pattern worker failed'));
			startWaiting();
		});
		worker = created;
		return created;
	}

	function start(job: TJob): void {
		const id = ++nextId;
		current = { ...job, id, startedAt: performance.now() };
		const request: TPatternWorkerRequest = { id, project: job.project, change: job.change, isPreview: job.isPreview };
		ensureWorker().postMessage(request);
	}

	function startWaiting(): void {
		const job = waiting;
		waiting = null;
		if (job != null) start(job);
	}

	function endCurrent(): void {
		if (current == null) return;
		const job = current;
		current = null;
		worker?.terminate();
		worker = null;
		job.reject(new PatternCanceledError());
	}

	function dropWaiting(): void {
		waiting?.reject(new PatternCanceledError());
		waiting = null;
	}

	return {
		run(project, change, onProgress) {
			dropWaiting();
			endCurrent();
			return new Promise((resolve, reject) => start({ project, change, isPreview: false, onProgress, resolve, reject }));
		},
		preview(project, change) {
			return new Promise((resolve, reject) => {
				const job: TJob = { project, change, isPreview: true, resolve, reject };
				dropWaiting();
				if (current == null) return start(job);
				if (!current.isPreview) return reject(new PatternCanceledError());
				if (performance.now() - current.startedAt < PREVIEW_PATIENCE) {
					waiting = job;
					return;
				}
				endCurrent();
				start(job);
			});
		},
		cancel() {
			dropWaiting();
			endCurrent();
		},
		dispose() {
			dropWaiting();
			endCurrent();
			worker?.terminate();
			worker = null;
		}
	};
}
