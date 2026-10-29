import { createDemoProject } from '../project/fixtures/sample-project';
import { describe, expect, it } from 'vitest';
import type { TAudioEngine } from '../music';
import { type TPerformance, type TProject } from '../project';
import {
	createTransportController,
	type TTransportController,
	type TTransportScheduler
} from './transport';

describe('createTransportController function', () => {
	it('should keep playing when presentation and safe world edits reuse physical motion', async () => {
		const project = createDemoProject();
		const audio = createTestAudio();
		const controller = createTransportController(project, {
			audioFactory: () => audio,
			scheduler: createScheduler()
		});
		const performance: TPerformance = {
			duration: project.duration,
			dt: 1 / 240,
			objects: project.objects,
			samples: [],
			impacts: [],
			surfaceContacts: [],
			noteMarkers: [],
			warnings: [],
			bounds: { min: [0, 0, 0], max: [0, 0, 0] }
		};
		controller.updatePerformance(performance);
		await startPlayback(controller, audio);
		controller.updatePerformance({ ...performance, objects: [], noteMarkers: [] });
		expect(controller.getSnapshot().playing).toBe(true);
		expect(audio.stopCalls).toBe(0);
		controller.updatePerformance({ ...performance, samples: [] });
		expect(controller.getSnapshot().playing).toBe(false);
		expect(audio.stopCalls).toBe(1);
		controller.dispose();
	});

	it('should cancel pending audio when a new physical bake arrives', async () => {
		const project = createDemoProject();
		const audio = createTestAudio();
		const controller = createTransportController(project, {
			audioFactory: () => audio,
			scheduler: createScheduler()
		});
		const pending = controller.play();
		await settle();
		controller.updatePerformance({
			duration: project.duration,
			dt: 1 / 240,
			objects: [],
			samples: [],
			impacts: [],
			noteMarkers: [],
			warnings: [],
			bounds: { min: [0, 0, 0], max: [0, 0, 0] }
		});
		audio.plays[0]?.pending.resolve(undefined);
		await pending;
		expect(controller.getSnapshot()).toMatchObject({ playing: false, startingAudio: false });
		controller.dispose();
	});

	it('should never let a cancelled playback completion stop a newer request', async () => {
		const audio = createTestAudio();
		const controller = createTransportController(createDemoProject(), {
			audioFactory: () => audio,
			scheduler: createScheduler()
		});
		const first = controller.play();
		await settle();
		expect(audio.plays).toHaveLength(1);
		await controller.play();
		expect(controller.getSnapshot().startingAudio).toBe(false);
		const latest = controller.play();
		await settle();
		expect(audio.plays).toHaveLength(2);
		const stopsBeforeOldCompletion = audio.stopCalls;
		audio.plays[0]?.pending.resolve(undefined);
		await first;
		expect(audio.stopCalls).toBe(stopsBeforeOldCompletion);
		expect(controller.getSnapshot().startingAudio).toBe(true);
		audio.plays[1]?.pending.resolve(undefined);
		await latest;
		expect(controller.getSnapshot().playing).toBe(true);
		controller.dispose();
	});

	it('should invoke the audio factory synchronously in the Play gesture and safely dispose a pending engine', async () => {
		const audio = createTestAudio();
		const factory = deferred<TAudioEngine>();
		let invoked = false;
		const errors: string[] = [];
		const controller = createTransportController(createDemoProject(), {
			audioFactory: () => {
				invoked = true;
				return factory.promise;
			},
			scheduler: createScheduler(),
			onError: (message) => errors.push(message)
		});
		const playing = controller.play();
		expect(invoked).toBe(true);
		controller.dispose();
		factory.resolve(audio);
		await playing;
		expect(audio.disposeCalls).toBe(1);
		expect(audio.plays).toHaveLength(0);
		expect(errors).toEqual([]);
	});

	it('should let a newer Play reuse pending engine creation without starting the cancelled request', async () => {
		const audio = createTestAudio();
		const factory = deferred<TAudioEngine>();
		const controller = createTransportController(createDemoProject(), {
			audioFactory: () => factory.promise,
			scheduler: createScheduler()
		});
		const first = controller.play();
		controller.stop();
		const latest = controller.play();
		factory.resolve(audio);
		await settle();
		expect(audio.plays).toHaveLength(1);
		audio.plays[0]?.pending.resolve(undefined);
		await Promise.all([first, latest]);
		expect(controller.getSnapshot().playing).toBe(true);
		controller.dispose();
	});

	it('should cancel pending audio on seek and preserve the requested position', async () => {
		const audio = createTestAudio();
		const controller = createTransportController(createDemoProject(), {
			audioFactory: () => audio,
			scheduler: createScheduler()
		});
		const playing = controller.play();
		await settle();
		controller.seek(4.25);
		audio.plays[0]?.pending.resolve(undefined);
		await playing;
		expect(controller.getSnapshot()).toMatchObject({
			playing: false,
			startingAudio: false,
			time: 4.25
		});
		expect(controller.timeRef.current).toBe(4.25);
		controller.dispose();
	});

	it('should stop old musical audio after score edits while allowing unrelated scene changes', async () => {
		const project = createDemoProject();
		const audio = createTestAudio();
		const controller = createTransportController(project, {
			audioFactory: () => audio,
			scheduler: createScheduler()
		});
		await startPlayback(controller, audio);
		const geometryEdit = structuredClone(project);
		geometryEdit.name = 'Renamed';
		geometryEdit.objects = [];
		geometryEdit.tracks = geometryEdit.tracks.map((track) => ({
			...track,
			name: 'Renamed track',
			color: '#abcdef'
		}));
		controller.updateProject(geometryEdit);
		expect(controller.getSnapshot().playing).toBe(true);
		const musicEdit = structuredClone(geometryEdit);
		musicEdit.tracks = musicEdit.tracks.map((track) => ({ ...track, muted: true }));
		audio.time = 1.25;
		controller.updateProject(musicEdit);
		expect(controller.getSnapshot()).toMatchObject({ playing: false, time: 1.25 });
		expect(audio.stopCalls).toBe(1);
		controller.dispose();
	});

	it('should cancel an in-flight old score when note expression changes', async () => {
		const project = createDemoProject();
		const audio = createTestAudio();
		const controller = createTransportController(project, {
			audioFactory: () => audio,
			scheduler: createScheduler()
		});
		const pending = controller.play();
		await settle();
		controller.updateProject({
			...project,
			notes: project.notes.map((note) => ({ ...note, midi: 60, velocity: 0.4, duration: 0.25 }))
		});
		audio.plays[0]?.pending.resolve(undefined);
		await pending;
		expect(controller.getSnapshot().playing).toBe(false);
		expect(controller.getSnapshot().startingAudio).toBe(false);
		controller.dispose();
	});

	it('should update the imperative clock every frame but publish timeline progress at most fifteen times per second', async () => {
		const audio = createTestAudio();
		const scheduler = createScheduler();
		const project = createDemoProject();
		const controller = createTransportController(project, { audioFactory: () => audio, scheduler });
		await startPlayback(controller, audio);
		let publications = 0;
		controller.subscribe(() => {
			publications++;
		});
		for (let frame = 0; frame < 5; frame++) {
			audio.time = 0.01 + frame * 0.016;
			scheduler.flush(frame * 16);
		}
		expect(controller.timeRef.current).toBeCloseTo(0.074);
		expect(controller.getSnapshot().time).toBe(0.01);
		expect(publications).toBe(1);
		audio.time = 0.09;
		scheduler.flush(80);
		expect(controller.getSnapshot().time).toBe(0.09);
		expect(publications).toBe(2);
		audio.time = project.duration;
		scheduler.flush(96);
		expect(controller.getSnapshot()).toMatchObject({ time: project.duration, playing: false });
		expect(controller.timeRef.current).toBe(project.duration);
		expect(scheduler.pendingFrames).toBe(0);
		controller.dispose();
	});

	it('should restart loop playback from zero at the exact project endpoint', async () => {
		const project = createDemoProject();
		const audio = createTestAudio();
		const scheduler = createScheduler();
		const controller = createTransportController(project, { audioFactory: () => audio, scheduler });
		controller.setLoop(true);
		await startPlayback(controller, audio);
		audio.time = project.duration;
		scheduler.flush(16);
		await settle();
		expect(audio.plays[1]?.offset).toBe(0);
		expect(controller.timeRef.current).toBe(0);
		audio.plays[1]?.pending.resolve(undefined);
		await settle();
		expect(controller.getSnapshot()).toMatchObject({ time: 0, playing: true, loop: true });
		controller.dispose();
	});

	it('should report a current playback error and allow a retry', async () => {
		const audio = createTestAudio();
		const errors: string[] = [];
		const controller = createTransportController(createDemoProject(), {
			audioFactory: () => audio,
			scheduler: createScheduler(),
			onError: (message) => errors.push(message)
		});
		const first = controller.play();
		await settle();
		audio.plays[0]?.pending.reject(new Error('Audio denied'));
		await first;
		expect(errors).toEqual(['Audio denied']);
		expect(controller.getSnapshot()).toMatchObject({ startingAudio: false, playing: false });
		await startPlayback(controller, audio);
		expect(controller.getSnapshot().playing).toBe(true);
		controller.dispose();
	});
});

function createTestAudio(): TTestAudio {
	return {
		time: 0,
		stopCalls: 0,
		disposeCalls: 0,
		plays: [],
		play(project, offset = 0) {
			const pending = deferred<undefined>();
			this.time = offset;
			this.plays.push({ project, offset, pending });
			return pending.promise;
		},
		getTime() {
			return this.time;
		},
		stop() {
			this.stopCalls++;
		},
		setVolume() {},
		dispose() {
			this.disposeCalls++;
		}
	};
}

interface TTestAudio extends TAudioEngine {
	time: number;
	stopCalls: number;
	disposeCalls: number;
	plays: { project: TProject; offset: number; pending: TDeferred<undefined> }[];
}

function createScheduler(): TTestScheduler {
	let next = 0;
	const callbacks = new Map<number, (timestamp: number) => void>();
	return {
		requestFrame(callback) {
			const id = ++next;
			callbacks.set(id, callback);
			return id;
		},
		cancelFrame(id) {
			callbacks.delete(id);
		},
		flush(timestamp) {
			const pending = [...callbacks.values()];
			callbacks.clear();
			for (const callback of pending) callback(timestamp);
		},
		get pendingFrames() {
			return callbacks.size;
		}
	};
}

interface TTestScheduler extends TTransportScheduler {
	flush(timestamp: number): void;
	readonly pendingFrames: number;
}

async function startPlayback(controller: TTransportController, audio: TTestAudio): Promise<void> {
	const playing = controller.play();
	await settle();
	const call = audio.plays.at(-1);
	if (call == null) throw new Error('Expected a pending audio playback.');
	call.pending.resolve(undefined);
	await playing;
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 6; turn++) await Promise.resolve();
}

function deferred<T>(): TDeferred<T> {
	let resolve: TDeferred<T>['resolve'] = () => {
		throw new Error('Promise is not ready.');
	};
	let reject: TDeferred<T>['reject'] = () => {
		throw new Error('Promise is not ready.');
	};
	const promise = new Promise<T>((accept, decline) => {
		resolve = accept;
		reject = decline;
	});
	return { promise, resolve, reject };
}

interface TDeferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
	reject(error: Error): void;
}
