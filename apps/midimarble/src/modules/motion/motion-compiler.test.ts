import { createDemoProject } from '../project/fixtures/sample-project';
import { describe, expect, it, vi } from 'vitest';

import type { TPerformance, TProject } from '../project/types';
import { createMotionCompiler, type TMotionWorker } from './motion-compiler';

describe('createMotionCompiler function', () => {
	it('should keep the same bake for distant world edits and include their current poses', async () => {
		const { compiler, workers } = createCompilerWithFakeWorkers();
		const project = createDemoProject();
		const pending = compiler.compile(project);
		const bake = createPerformance(project);
		bake.influenceBounds = { min: [-10, -10, -10], max: [10, 10, 10] };
		workers[0]?.complete(bake);
		await pending;
		const model = project.objects[0];
		if (model == null) throw new Error('Expected an instrument.');
		const edited = structuredClone(project);
		edited.objects.push({ ...model, id: 'distant', binding: null, position: [100, 100, 100] });
		const added = await compiler.compile(edited);
		expect(added.samples).toBe(bake.samples);
		expect(added.objects.find((object) => object.id === 'distant')?.position).toEqual([100, 100, 100]);
		const object = edited.objects.find((object) => object.id === 'distant');
		if (object == null) throw new Error('Expected the added world object.');
		object.position = [110, 100, 100];
		const moved = await compiler.compile(edited);
		expect(moved.objects.find((candidate) => candidate.id === 'distant')?.position).toEqual([110, 100, 100]);
		expect(workers).toHaveLength(1);
		object.position = [0, 0, 0];
		const rebuilt = compiler.compile(edited);
		expect(workers).toHaveLength(2);
		workers[1]?.complete(createPerformance(edited));
		await rebuilt;
		compiler.dispose();
	});

	it('should project added and retimed music-only notes onto the same cached samples', async () => {
		const project = createDemoProject();
		const bake = createPerformance(project);
		bake.dt = 1;
		bake.samples = [0, 1, 2, 3].map((time) => ({ time, position: [time * 2, 4, 0], rotation: [0, 0, 0, 1] }));
		const load = vi.fn().mockResolvedValue(bake);
		const { compiler, workers } = createCompilerWithFakeWorkers(load);
		await compiler.compile(project);
		const edited = structuredClone(project);
		const firstNote = edited.notes[0];
		if (firstNote == null) throw new Error('Expected a demo note');
		const musicNote = { ...firstNote, id: 'music-only', time: 1.25 };
		edited.notes.push(musicNote);
		const added = await compiler.compile(edited);
		expect(added.samples).toBe(bake.samples);
		expect(added.noteMarkers.find((marker) => marker.noteId === 'music-only')).toMatchObject({
			time: 1.25, position: [2.5, 4, 0], objectId: null, error: null
		});
		musicNote.time = 2.5;
		const moved = await compiler.compile(edited);
		expect(moved.noteMarkers.find((marker) => marker.noteId === 'music-only')?.position).toEqual([5, 4, 0]);
		expect(workers).toHaveLength(0);
		expect(load).toHaveBeenCalledOnce();
		compiler.dispose();
	});

	it('should use a loaded bake before allocating a worker and retain it in the normal cache', async () => {
		const project = createDemoProject();
		const bake = createPerformance(project);
		const load = vi.fn().mockResolvedValue(bake);
		const { compiler, workers } = createCompilerWithFakeWorkers(load);

		const result = await compiler.compile(project);
		const cached = await compiler.compile(structuredClone(project));

		expect(workers).toHaveLength(0);
		expect(load).toHaveBeenCalledOnce();
		expect(load).toHaveBeenCalledWith(project, expect.any(String));
		expect(result.samples).toBe(bake.samples);
		expect(cached.samples).toBe(bake.samples);
		compiler.dispose();
	});

	it.each(['unavailable', 'rejected'])(
		'should fall back to a worker when a loaded bake is %s',
		async (outcome) => {
			const load =
				outcome === 'unavailable'
					? vi.fn().mockResolvedValue(null)
					: vi.fn().mockRejectedValue(new Error('Asset missing'));
			const { compiler, workers } = createCompilerWithFakeWorkers(load);
			const project = createDemoProject();
			const pending = compiler.compile(project);
			expect(workers).toHaveLength(0);
			await Promise.resolve();
			expect(workers).toHaveLength(1);
			workers[0]?.complete(createPerformance(project));
			await expect(pending).resolves.toMatchObject({ duration: project.duration });
			compiler.dispose();
		}
	);

	it('should discard an obsolete loaded bake without spawning a worker or caching its result', async () => {
		const project = createDemoProject();
		const stale = createDeferred<TPerformance | null>();
		const load = vi.fn().mockResolvedValue(null).mockReturnValueOnce(stale.promise);
		const { compiler, workers } = createCompilerWithFakeWorkers(load);
		const original = compiler.compile(project);
		const aborted = expect(original).rejects.toMatchObject({ name: 'AbortError' });
		const next = compiler.compile({ ...project, gravity: project.gravity + 1 });
		await aborted;

		stale.resolve(createPerformance(project));
		await Promise.resolve();
		expect(workers).toHaveLength(1);
		workers[0]?.complete(createPerformance(project));
		await next;
		const retried = compiler.compile(project);
		await Promise.resolve();
		expect(workers).toHaveLength(2);
		workers[1]?.complete(createPerformance(project));
		await retried;
		compiler.dispose();
	});

	it('should discard a loaded bake that arrives after disposal', async () => {
		const stale = createDeferred<TPerformance | null>();
		const { compiler, workers } = createCompilerWithFakeWorkers(() => stale.promise);
		const project = createDemoProject();
		const pending = compiler.compile(project);
		const aborted = expect(pending).rejects.toMatchObject({ name: 'AbortError' });

		compiler.dispose();
		stale.resolve(createPerformance(project));
		await aborted;
		expect(workers).toHaveLength(0);
	});

	it('should reuse an earlier physical bake when undo returns to its inputs', async () => {
		const { compiler, workers } = createCompilerWithFakeWorkers();
		const original = createDemoProject();
		const first = await completeCompilation(compiler, workers, original);
		const changed = { ...original, gravity: original.gravity + 1 };
		await completeCompilation(compiler, workers, changed);

		const restored = await compiler.compile(structuredClone(original));

		expect(workers).toHaveLength(2);
		expect(restored.samples).toBe(first.samples);
		expect(restored.impacts).toBe(first.impacts);
		compiler.dispose();
	});

	it('should preserve cached poses while applying the current object appearance', async () => {
		const { compiler, workers } = createCompilerWithFakeWorkers();
		const project = createDemoProject();
		const pending = compiler.compile(project);
		const performance = createPerformance(project);
		const resolved = performance.objects[0];
		if (resolved == null) throw new Error('Expected a demo object.');
		resolved.position = [3, 4, 5];
		workers[0]?.complete(performance);
		await pending;
		const visualEdit = structuredClone(project);
		const object = visualEdit.objects[0];
		if (object == null) throw new Error('Expected a demo object.');
		object.name = 'New name';
		object.material = 'glass';
		object.color = '#123456';
		object.locked = true;

		const result = await compiler.compile(visualEdit);

		expect(workers).toHaveLength(1);
		expect(result.objects[0]).toMatchObject({
			name: 'New name',
			material: 'glass',
			color: '#123456',
			locked: true,
			position: [3, 4, 5]
		});
		expect(result.samples).toBe(performance.samples);
		compiler.dispose();
	});

	it('should cancel a pending prediction before returning a cached bake and ignore its late result', async () => {
		const { compiler, workers } = createCompilerWithFakeWorkers();
		const original = createDemoProject();
		const baked = await completeCompilation(compiler, workers, original);
		const changed = { ...original, gravity: original.gravity + 1 };
		const pending = compiler.compile(changed);
		const aborted = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
		const obsolete = workers[1];
		if (obsolete == null || obsolete.onmessage == null)
			throw new Error('Expected a pending worker.');
		const lateMessage = obsolete.onmessage;
		const request = obsolete.requests[0];
		if (request == null) throw new Error('Expected a worker request.');

		const restored = await compiler.compile(original);
		await aborted;
		lateMessage({
			data: { id: request.id, performance: createPerformance(changed) }
		} as MessageEvent);

		expect(restored.samples).toBe(baked.samples);
		expect(obsolete.terminate).toHaveBeenCalledOnce();
		expect(obsolete.onmessage).toBeNull();
		await completeCompilation(compiler, workers, changed);
		expect(workers).toHaveLength(3);
		compiler.dispose();
	});

	it('should keep four recent successful bakes and evict the least recently used one', async () => {
		const { compiler, workers } = createCompilerWithFakeWorkers();
		const project = createDemoProject();
		const projects = Array.from({ length: 5 }, (_, index) => ({ ...project, gravity: 5 + index }));
		for (const candidate of projects.slice(0, 4))
			await completeCompilation(compiler, workers, candidate);
		const first = projects[0];
		const second = projects[1];
		const fifth = projects[4];
		if (first == null || second == null || fifth == null)
			throw new Error('Expected five variants.');
		await compiler.compile(first);
		await completeCompilation(compiler, workers, fifth);

		await compiler.compile(first);
		expect(workers).toHaveLength(5);
		await completeCompilation(compiler, workers, second);
		expect(workers).toHaveLength(6);
		compiler.dispose();
	});

	it('should terminate failed workers and allow a fresh attempt without caching the failure', async () => {
		const { compiler, workers } = createCompilerWithFakeWorkers();
		const project = createDemoProject();
		const pending = compiler.compile(project);
		const failure = expect(pending).rejects.toThrow('Physics failed');
		const worker = workers[0];
		if (worker == null) throw new Error('Expected a worker.');
		worker.fail('Physics failed');
		await failure;

		await completeCompilation(compiler, workers, project);

		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(workers).toHaveLength(2);
		compiler.dispose();
	});

	it('should release cached bakes and reject pending work when disposed', async () => {
		const { compiler, workers } = createCompilerWithFakeWorkers();
		const project = createDemoProject();
		await completeCompilation(compiler, workers, project);
		const pending = compiler.compile({ ...project, gravity: project.gravity + 1 });
		const aborted = expect(pending).rejects.toMatchObject({ name: 'AbortError' });

		compiler.dispose();
		await aborted;
		expect(workers[1]?.terminate).toHaveBeenCalledOnce();
		await completeCompilation(compiler, workers, project);
		expect(workers).toHaveLength(3);
		compiler.dispose();
	});

	it('should stream progress without finishing the worker and ignore obsolete partial results', async () => {
		const { compiler, workers } = createCompilerWithFakeWorkers();
		const project = createDemoProject();
		const onProgress = vi.fn();
		const pending = compiler.compile(project, { onProgress });
		const aborted = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
		const worker = workers[0];
		const listener = worker?.onmessage;
		const id = worker?.requests[0]?.id;
		if (worker == null || listener == null || id == null)
			throw new Error('Expected a worker request.');
		const progress = { phase: 'placement' as const, completed: 2, total: 5, reused: 0 };
		listener({ data: { id, progress } } as MessageEvent);
		expect(onProgress).toHaveBeenCalledExactlyOnceWith(progress);
		expect(worker.terminate).not.toHaveBeenCalled();
		const replacement = compiler.compile({ ...project, gravity: 7 });
		await aborted;
		listener({ data: { id, progress } } as MessageEvent);
		expect(onProgress).toHaveBeenCalledOnce();
		workers[1]?.complete(createPerformance(project));
		await replacement;
		compiler.dispose();
	});

	it('should ignore a reply for a different request ID', async () => {
		const { compiler, workers } = createCompilerWithFakeWorkers();
		const project = createDemoProject();
		const pending = compiler.compile(project);
		const worker = workers[0];
		if (worker == null) throw new Error('Expected a worker.');
		worker.onmessage?.({
			data: { id: -1, performance: createPerformance(project) }
		} as MessageEvent);
		expect(worker.terminate).not.toHaveBeenCalled();
		worker.complete(createPerformance(project));
		await expect(pending).resolves.toMatchObject({ duration: project.duration });
		compiler.dispose();
	});
});

function createCompilerWithFakeWorkers(
	loadPerformance?: (project: TProject, signature: string) => Promise<TPerformance | null>
) {
	const workers: FakeMotionWorker[] = [];
	const compiler = createMotionCompiler({
		loadPerformance,
		createWorker: () => {
			const worker = new FakeMotionWorker();
			workers.push(worker);
			return worker;
		}
	});
	return { compiler, workers };
}

class FakeMotionWorker implements TMotionWorker {
	onmessage: TMotionWorker['onmessage'] = null;
	onerror: TMotionWorker['onerror'] = null;
	requests: { id: number; project: TProject }[] = [];
	terminate = vi.fn();
	postMessage(request: { id: number; project: TProject }) {
		this.requests.push(request);
	}
	complete(performance: TPerformance) {
		const request = this.requests[0];
		if (request == null) throw new Error('Expected a worker request.');
		this.onmessage?.({ data: { id: request.id, performance } } as MessageEvent);
	}
	fail(message: string) {
		this.onerror?.({ message } as ErrorEvent);
	}
}

async function completeCompilation(
	compiler: ReturnType<typeof createMotionCompiler>,
	workers: FakeMotionWorker[],
	project: TProject
) {
	const pending = compiler.compile(project);
	const worker = workers[workers.length - 1];
	if (worker == null) throw new Error('Expected a new worker.');
	worker.complete(createPerformance(project));
	return pending;
}

function createPerformance(project: TProject): TPerformance {
	return {
		duration: project.duration,
		dt: 1 / 240,
		samples: [{ time: 0, position: [...project.launch.position], rotation: [0, 0, 0, 1] }],
		objects: structuredClone(project.objects),
		impacts: [],
		noteMarkers: [],
		warnings: [],
		bounds: { min: [0, 0, 0], max: [1, 1, 1] }
	};
}

function createDeferred<T>() {
	let complete: ((value: T) => void) | null = null;
	const promise = new Promise<T>((resolve) => {
		complete = resolve;
	});
	return {
		promise,
		resolve(value: T) {
			if (complete == null) throw new Error('Deferred was not initialized.');
			complete(value);
		}
	};
}
