import type { TProject } from '@/modules/project';
import type { TResolvedPiece } from '@/modules/simulation';
import type { TPatternAnswer, TPatternWorkerRequest, TPatternWorkerResponse } from './pattern.worker';
import type { TPatternAsk } from './check-pattern';
import type { TGroupRunProgress } from './run-group';

/** A preview running longer than this is ended for a newer one; a quicker one finishes first, as starting the worker costs more */
const PREVIEW_PATIENCE = 800;

export class PatternCanceledError extends Error {
	constructor() {
		super('The Pattern run was stopped');
		this.name = 'PatternCanceledError';
	}
}

export interface TPatternClient {
	/** Runs a Pattern for real, ending whatever runs now, unless that's this same question asked by resting on its tile: it takes that answer */
	run: (project: TProject, change: TPatternAsk, onProgress?: (progress: TGroupRunProgress) => void, isChecked?: boolean) => Promise<TPatternAnswer>;
	/** Asks a Pattern for a resting pointer, the ghost first. Only the newest waiting one runs; older ones reject as canceled */
	preview: (project: TProject, change: TPatternAsk, onGhost: (pieces: TResolvedPiece[]) => void) => Promise<TPatternAnswer>;
	/** Ends a resting pointer's question, running or waiting. A run a click took over goes on */
	cancelPreview: () => void;
	/** Ends what runs and what waits */
	cancel: () => void;
	dispose: () => void;
}

interface TJob {
	project: TProject;
	change: TPatternAsk;
	isPreview: boolean;
	isChecked: boolean;
	onProgress?: ((progress: TGroupRunProgress) => void) | undefined;
	onGhost?: ((pieces: TResolvedPiece[]) => void) | undefined;
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
			if (response.kind === 'ghost') {
				current.onGhost?.(response.pieces);
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
		const request: TPatternWorkerRequest = { id, project: job.project, change: job.change, isPreview: job.isPreview, isChecked: job.isChecked };
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
		run(project, change, onProgress, isChecked = true) {
			dropWaiting();
			const asking = current;
			if (asking?.isPreview === true && isChecked && asking.project === project && JSON.stringify(asking.change) === JSON.stringify(change)) {
				const { resolve: resolvePreview, reject: rejectPreview } = asking;
				return new Promise((resolve, reject) => {
					asking.isPreview = false;
					asking.onProgress = onProgress;
					asking.resolve = (answer) => {
						resolvePreview(answer);
						resolve(answer);
					};
					asking.reject = (error) => {
						rejectPreview(error);
						reject(error);
					};
				});
			}
			endCurrent();
			return new Promise((resolve, reject) => start({ project, change, isPreview: false, isChecked, onProgress, resolve, reject }));
		},
		preview(project, change, onGhost) {
			return new Promise((resolve, reject) => {
				const job: TJob = { project, change, isPreview: true, isChecked: true, onGhost, resolve, reject };
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
		cancelPreview() {
			dropWaiting();
			if (current?.isPreview === true) endCurrent();
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
