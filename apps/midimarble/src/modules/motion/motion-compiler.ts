import type { TPerformance, TProject } from '../project/types';
import type { TCompileOptions, TMotionProgress } from './motion-progress';
import { getMotionSignature } from './motion-signature';
import { createNoteMarkers } from './note-markers';
import { canReuseWorldEdit } from './reuse-world-edit';

/** Reuses four recent physical bakes and cancels obsolete predictions before they can replace newer results. */
export function createMotionCompiler(options: TMotionCompilerOptions = {}): TMotionCompiler {
	let worker: TMotionWorker | null = null;
	let rejectPending: ((reason: Error) => void) | null = null;
	let revision = 0;
	let previous: TCompileOptions['previous'];
	let controller: AbortController | null = null;
	const cache = new Map<string, TPerformance>();

	function cancelPending(message: string) {
		revision++;
		controller?.abort();
		controller = null;
		rejectPending?.(new DOMException(message, 'AbortError'));
		rejectPending = null;
		if (worker != null) {
			worker.onmessage = null;
			worker.onerror = null;
			worker.terminate();
			worker = null;
		}
	}

	function reuse(project: TProject): TPerformance | null {
		const signature = getMotionSignature(project);
		const cached = cache.get(signature) ??
			(previous != null && canReuseWorldEdit(project, previous) ? previous.performance : undefined);
		if (cached == null) return null;
		cancelPending('An existing bake replaced this prediction.');
		cache.delete(signature);
		const refreshed = refreshObjectPresentation(cached, project);
		cache.set(signature, refreshed);
		if (cache.size > 4) {
			const oldest = cache.keys().next().value;
			if (oldest != null) cache.delete(oldest);
		}
		previous = { project: structuredClone(project), performance: refreshed };
		return refreshed;
	}

	return {
		reuse,
		compile(project, compileOptions = {}) {
			const cached = reuse(project);
			if (cached != null) return Promise.resolve(cached);
			cancelPending('A newer scene replaced this prediction.');
			const id = revision;
			controller = new AbortController();
			const signal = controller.signal;
			const signature = getMotionSignature(project);

			return new Promise<TPerformance>((resolve, reject) => {
				let settled = false;
				rejectPending = reject;
				function finish(performance: TPerformance | null, error?: Error) {
					if (settled || id !== revision) return;
					settled = true;
					rejectPending = null;
					if (worker != null) {
						worker.onmessage = null;
						worker.onerror = null;
						worker.terminate();
						worker = null;
					}
					if (performance == null) {
						reject(error ?? new Error('Simulation failed.'));
						return;
					}
					performance = refreshObjectPresentation(performance, project);
					cache.set(signature, performance);
					if (cache.size > 4) {
						const oldest = cache.keys().next().value;
						if (oldest != null) cache.delete(oldest);
					}
					previous = { project: structuredClone(project), performance };
					resolve(performance);
				}

				function publishProgress(progress: TMotionProgress) {
					if (!settled && id === revision) compileOptions.onProgress?.(progress);
				}

				function startWorker() {
					if (settled || id !== revision) return;
					try {
						if (options.createWorker == null && typeof Worker === 'undefined') {
							void compilePerformance(project, {
								previous,
								signal,
								onProgress: publishProgress,
								yieldControl: () => new Promise((resume) => setTimeout(resume, 0))
							}).then(
								(performance) => finish(performance),
								(error: unknown) =>
									finish(null, error instanceof Error ? error : new Error('Simulation failed.'))
							);
							return;
						}
						const activeWorker: TMotionWorker =
							options.createWorker?.() ??
							new Worker(new URL('./motion.worker.ts', import.meta.url), { type: 'module' });
						worker = activeWorker;
						activeWorker.onmessage = (event) => {
							if (event.data.id !== id) return;
							if (event.data.progress != null) {
								publishProgress(event.data.progress);
								return;
							}
							finish(
								event.data.performance ?? null,
								new Error(event.data.error ?? 'Simulation failed.')
							);
						};
						activeWorker.onerror = (event) =>
							finish(
								null,
								new Error(event.message || 'The simulation worker stopped unexpectedly.')
							);
						activeWorker.postMessage({ id, project, previous });
					} catch (error) {
						finish(
							null,
							error instanceof Error ? error : new Error('The simulation worker could not start.')
						);
					}
				}

				if (options.loadPerformance == null) {
					startWorker();
					return;
				}
				try {
					void options.loadPerformance(project, signature).then(
						(performance) => {
							if (settled || id !== revision) return;
							if (performance != null) finish(refreshObjectPresentation(performance, project));
							else startWorker();
						},
						() => startWorker()
					);
				} catch {
					startWorker();
				}
			});
		},
		dispose() {
			cancelPending('Simulation was closed.');
			cache.clear();
			previous = undefined;
		}
	};
}

export interface TMotionCompiler {
	/** Returns a reusable bake immediately, cancelling obsolete work only on success. */
	reuse(project: TProject): TPerformance | null;
	compile(project: TProject, options?: Pick<TCompileOptions, 'onProgress'>): Promise<TPerformance>;
	dispose(): void;
}

interface TMotionCompilerOptions {
	loadPerformance?(project: TProject, signature: string): Promise<TPerformance | null>;
	createWorker?(): TMotionWorker;
}

/** The worker boundary is injectable so cancellation can be verified without running the physics engine. */
export interface TMotionWorker {
	onmessage:
		| ((
				event: MessageEvent<{
					id: number;
					performance?: TPerformance;
					progress?: TMotionProgress;
					error?: string;
				}>
		  ) => void)
		| null;
	onerror: ((event: ErrorEvent) => void) | null;
	postMessage(message: {
		id: number;
		project: TProject;
		previous?: TCompileOptions['previous'];
	}): void;
	terminate(): void;
}

function refreshObjectPresentation(performance: TPerformance, project: TProject): TPerformance {
	const resolved = new Map(performance.objects.map((object) => [object.id, object]));
	return {
		...performance,
		noteMarkers: createNoteMarkers(project.notes, performance),
		objects: project.objects.map((current) => {
			const baked = resolved.get(current.id);
			if (baked == null || (current.binding == null && current.trajectoryAnchor == null)) return current;
			return { ...current, position: baked.position, rotation: baked.rotation, binding: baked.binding };
		})
	};
}

/** Loads the physics engine only when a caller explicitly requests compilation outside the worker. */
export async function compilePerformance(
	project: TProject,
	options: TCompileOptions = {}
): Promise<TPerformance> {
	const physics = await import('./compile-performance');
	return physics.compilePerformance(project, options);
}
