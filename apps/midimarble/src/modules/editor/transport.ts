import { createAudioEngine, getAudioSignature, type TAudioEngine } from '../music';
import type { TPerformance, TProject } from '../project';

/** Owns audio, playback cancellation, and the single clock shared by the viewport and timeline. */
export function createTransportController(
	initialProject: TProject,
	options: TTransportOptions = {}
): TTransportController {
	let project = initialProject;
	let performance: TPerformance | null = null;
	let audioSignature = projectAudioSignature(project);
	let onError = options.onError;
	let audio: TAudioEngine | null = null;
	let audioRequest: Promise<TAudioEngine> | null = null;
	let requestId = 0;
	let disposed = false;
	let frame: number | null = null;
	let lastPublishedAt = -Infinity;
	let snapshot: TTransportSnapshot = {
		time: 0,
		playing: false,
		startingAudio: false,
		volume: 0.72,
		loop: false
	};
	const timeRef = { current: 0 };
	const listeners = new Set<() => void>();
	const scheduler = options.scheduler ?? browserScheduler;

	function publish(patch: Partial<TTransportSnapshot>): void {
		if (disposed) return;
		const next = { ...snapshot, ...patch };
		if (
			next.time === snapshot.time &&
			next.playing === snapshot.playing &&
			next.startingAudio === snapshot.startingAudio &&
			next.volume === snapshot.volume &&
			next.loop === snapshot.loop
		)
			return;
		snapshot = next;
		for (const listener of listeners) listener();
	}

	function cancelFrame(): void {
		if (frame != null) scheduler.cancelFrame(frame);
		frame = null;
	}

	function stop(): void {
		requestId++;
		cancelFrame();
		if (snapshot.playing && audio != null) {
			timeRef.current = clampTime(audio.getTime(), project.duration);
		}
		audio?.stop();
		publish({ time: timeRef.current, playing: false, startingAudio: false });
	}

	function getAudio(): Promise<TAudioEngine> {
		if (audio != null) return Promise.resolve(audio);
		if (audioRequest != null) return audioRequest;
		// Keep AudioContext creation inside the user's Play gesture, before the first await
		const created = (options.audioFactory ?? createAudioEngine)();
		const pending = Promise.resolve(created)
			.then((engine) => {
				if (disposed) {
					engine.dispose();
					throw new DOMException('The transport has been closed.', 'AbortError');
				}
				audio = engine;
				engine.setVolume(snapshot.volume);
				return engine;
			})
			.catch((error: unknown) => {
				if (audioRequest === pending) audioRequest = null;
				throw error;
			});
		audioRequest = pending;
		return pending;
	}

	function tick(now: number): void {
		frame = null;
		if (disposed || !snapshot.playing || audio == null) return;
		timeRef.current = clampTime(audio.getTime(), project.duration);
		if (timeRef.current >= project.duration - 1e-6) {
			timeRef.current = project.duration;
			audio.stop();
			publish({ time: project.duration, playing: false });
			if (snapshot.loop) {
				timeRef.current = 0;
				publish({ time: 0 });
				void play();
			}
			return;
		}
		if (now - lastPublishedAt >= 1000 / 15) {
			lastPublishedAt = now;
			publish({ time: timeRef.current });
		}
		frame = scheduler.requestFrame(tick);
	}

	async function play(): Promise<void> {
		if (disposed) return;
		if (snapshot.playing || snapshot.startingAudio) {
			stop();
			return;
		}
		const request = ++requestId;
		publish({ startingAudio: true });
		try {
			const engine = await getAudio();
			if (disposed || request !== requestId) return;
			const start = timeRef.current >= project.duration - 0.04 ? 0 : timeRef.current;
			await engine.play(project, start, performance);
			if (disposed || request !== requestId) return;
			timeRef.current = start;
			lastPublishedAt = -Infinity;
			publish({ time: start, playing: true, startingAudio: false });
			cancelFrame();
			frame = scheduler.requestFrame(tick);
		} catch (error) {
			if (disposed || request !== requestId) return;
			publish({ playing: false, startingAudio: false });
			onError?.(error instanceof Error ? error.message : 'The soundtrack could not be played.');
		}
	}

	return {
		timeRef,
		getSnapshot: () => snapshot,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		updateProject(nextProject, nextOnError = onError) {
			onError = nextOnError;
			if (disposed) return;
			const nextSignature = projectAudioSignature(nextProject);
			if (nextSignature !== audioSignature) stop();
			project = nextProject;
			audioSignature = nextSignature;
			const nextTime = clampTime(timeRef.current, project.duration);
			if (nextTime !== timeRef.current) {
				timeRef.current = nextTime;
				publish({ time: nextTime });
			}
		},
		updatePerformance(next: TPerformance | null) {
			const changed =
				next?.samples !== performance?.samples ||
				next?.additionalMarbles !== performance?.additionalMarbles ||
				next?.impacts !== performance?.impacts ||
				next?.surfaceContacts !== performance?.surfaceContacts;
			if (changed && (snapshot.playing || snapshot.startingAudio)) stop();
			performance = next;
		},
		play,
		stop,
		seek(time) {
			if (disposed) return;
			stop();
			timeRef.current = clampTime(time, project.duration);
			publish({ time: timeRef.current });
		},
		setVolume(value) {
			const next = typeof value === 'function' ? value(snapshot.volume) : value;
			if (!Number.isFinite(next) || disposed) return;
			const volume = Math.max(0, Math.min(1, next));
			audio?.setVolume(volume);
			publish({ volume });
		},
		setLoop(value) {
			if (disposed) return;
			publish({ loop: typeof value === 'function' ? value(snapshot.loop) : value });
		},
		dispose() {
			if (disposed) return;
			stop();
			disposed = true;
			audio?.dispose();
			audio = null;
			listeners.clear();
		}
	};
}

export interface TTransportSnapshot {
	time: number;
	playing: boolean;
	startingAudio: boolean;
	volume: number;
	loop: boolean;
}

export interface TTransportOptions {
	onError?: (message: string) => void;
	audioFactory?: () => TAudioEngine | Promise<TAudioEngine>;
	scheduler?: TTransportScheduler;
}

export interface TTransportScheduler {
	requestFrame(callback: (timestamp: number) => void): number;
	cancelFrame(id: number): void;
}

export interface TTransportController {
	timeRef: { current: number };
	getSnapshot(): TTransportSnapshot;
	subscribe(listener: () => void): () => void;
	updatePerformance(performance: TPerformance | null): void;
	updateProject(project: TProject, onError?: (message: string) => void): void;
	play(): Promise<void>;
	stop(): void;
	seek(time: number): void;
	setVolume(value: number | ((previous: number) => number)): void;
	setLoop(value: boolean | ((previous: boolean) => boolean)): void;
	dispose(): void;
}

const browserScheduler: TTransportScheduler = {
	requestFrame: (callback) => requestAnimationFrame(callback),
	cancelFrame: (id) => cancelAnimationFrame(id)
};

function projectAudioSignature(project: TProject): string {
	return JSON.stringify([getAudioSignature(project), project.audio]);
}

function clampTime(time: number, duration: number): number {
	return Number.isFinite(time) ? Math.max(0, Math.min(duration, time)) : 0;
}
