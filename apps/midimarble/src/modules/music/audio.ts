import type { TPerformance, TProject, TTrack } from '../project';
import { getAudioSignature } from './audio-signature';
import { mixSurfaceAudio } from './surface-audio';

export async function createAudioEngine(): Promise<TAudioEngine> {
	const context = new AudioContext({ sampleRate: 44100 });
	void context.resume().catch(() => undefined);
	const gain = context.createGain();
	gain.gain.value = 0.72;
	gain.connect(context.destination);
	let source: AudioBufferSourceNode | null = null;
	let startTime = 0;
	let offset = 0;
	let duration = 0;
	let generation = 0;
	let disposed = false;

	function getTime(): number {
		return source == null ? offset : Math.min(duration, offset + context.currentTime - startTime);
	}

	function stop(): void {
		generation++;
		offset = getTime();
		if (source != null) {
			source.onended = null;
			source.stop();
			source.disconnect();
			source = null;
		}
	}

	return {
		async play(project, from = 0, performance) {
			if (disposed) throw new Error('The audio engine has been closed.');
			stop();
			const request = generation;
			const [buffer] = await Promise.all([
				renderPerformanceAudio(project, performance),
				unlockAudio(context)
			]);
			if (request !== generation || disposed) return;
			offset = Math.max(0, Math.min(from, project.duration));
			duration = project.duration;
			if (offset >= duration) return;
			startTime = context.currentTime;
			const nextSource = context.createBufferSource();
			nextSource.buffer = buffer;
			nextSource.connect(gain);
			nextSource.onended = () => {
				if (source !== nextSource) return;
				offset = duration;
				source.disconnect();
				source = null;
			};
			source = nextSource;
			nextSource.start(startTime, offset);
		},
		stop,
		getTime,
		setVolume(value) {
			gain.gain.setTargetAtTime(Math.max(0, Math.min(1, value)), context.currentTime, 0.02);
		},
		dispose() {
			stop();
			disposed = true;
			gain.disconnect();
			void context.close();
		}
	};
}

export interface TAudioEngine {
	play(project: TProject, offset?: number, performance?: TPerformance | null): Promise<void>;
	stop(): void;
	getTime(): number;
	setVolume(value: number): void;
	dispose(): void;
}

export async function renderProjectAudio(project: TProject): Promise<AudioBuffer> {
	if (typeof AudioBuffer === 'undefined' || typeof Worker === 'undefined') {
		throw new Error('Audio playback requires a browser with Web Audio support.');
	}
	if (!Number.isFinite(project.duration) || project.duration <= 0 || project.duration > 120) {
		throw new Error('Audio rendering supports projects up to 120 seconds.');
	}
	const signature = getAudioSignature(project);
	const cached = audioCache.get(signature);
	if (cached != null) return cached;
	const rendering = requestAudio(project)
		.then((result) => {
			const buffer = new AudioBuffer({
				length: result.left.length,
				numberOfChannels: 2,
				sampleRate: result.sampleRate
			});
			buffer.copyToChannel(new Float32Array(result.left), 0);
			buffer.copyToChannel(new Float32Array(result.right), 1);
			return buffer;
		})
		.catch((error: unknown) => {
			audioCache.delete(signature);
			throw error;
		});
	audioCache.set(signature, rendering);
	while (audioCache.size > 2) {
		const oldest = audioCache.keys().next().value;
		if (oldest == null) break;
		audioCache.delete(oldest);
	}
	return rendering;
}

interface TAudioResult {
	id: number;
	left: Float32Array;
	right: Float32Array;
	sampleRate: number;
	error?: string;
}

const audioCache = new Map<string, Promise<AudioBuffer>>();
const pending = new Map<
	number,
	{ resolve: (result: TAudioResult) => void; reject: (error: Error) => void }
>();
let audioWorker: Worker | null = null;
let nextRequestId = 0;

function requestAudio(project: TProject): Promise<TAudioResult> {
	if (audioWorker == null) {
		audioWorker = new Worker(new URL('./audio.worker.ts', import.meta.url), { type: 'module' });
		audioWorker.onmessage = (event: MessageEvent<TAudioResult>) => {
			const request = pending.get(event.data.id);
			if (request == null) return;
			pending.delete(event.data.id);
			if (event.data.error != null) request.reject(new Error(event.data.error));
			else request.resolve(event.data);
		};
		audioWorker.onerror = () => {
			for (const request of pending.values())
				request.reject(new Error('The instrument renderer stopped. Please try playing again.'));
			pending.clear();
			audioWorker?.terminate();
			audioWorker = null;
		};
	}
	const worker = audioWorker;
	const id = ++nextRequestId;
	return new Promise((resolve, reject) => {
		pending.set(id, { resolve, reject });
		worker.postMessage({ id, project, sampleRate: 44100 });
	});
}

async function unlockAudio(context: AudioContext): Promise<void> {
	if (context.state === 'running') return;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			context.resume(),
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() =>
						reject(
							new Error(
								'The browser has not enabled sound. Keep this tab visible and press Play again.'
							)
						),
					5000
				);
			})
		]);
	} finally {
		clearTimeout(timer);
	}
}

export async function renderPerformanceAudio(
	project: TProject,
	performance?: TPerformance | null
): Promise<AudioBuffer> {
	const music = await renderProjectAudio(project);
	const mixed = new AudioBuffer({
		length: music.length,
		numberOfChannels: 2,
		sampleRate: music.sampleRate
	});
	mixed.copyToChannel(music.getChannelData(0), 0);
	mixed.copyToChannel(music.getChannelData(1), 1);
	mixSurfaceAudio(
		mixed.getChannelData(0),
		mixed.getChannelData(1),
		project,
		performance ?? null,
		music.sampleRate
	);
	return mixed;
}
let auditionContext: AudioContext | null = null;
let auditionGeneration = 0;
const auditionCache = new Map<string, Promise<AudioBuffer>>();
export async function auditionNote(midi: number, track: TTrack): Promise<void> {
	auditionContext ??= new AudioContext({ sampleRate: 44100 });
	const context = auditionContext;
	void context.resume();
	const generation = ++auditionGeneration;
	const preview: TProject = {
		version: 1,
		id: 'audition',
		name: 'Audition',
		bpm: 120,
		duration: 0.65,
		notes: [{ id: 'audition', trackId: track.id, time: 0, duration: 0.3, midi, velocity: 0.7 }],
		tracks: [{ ...track, muted: false, controls: [], pitchBends: [] }],
		objects: [],
		launch: { position: [0, 0, 0], velocity: [0, 0, 0], radius: 0.24 },
		gravity: 9.81,
		restitution: 0.35,
		aspectRatio: '9:16',
		marbleColor: '#e775bf'
	};
	const key = JSON.stringify([midi, track.instrument, track.percussion]);
	let rendering = auditionCache.get(key);
	if (!rendering) {
		rendering = requestAudio(preview)
			.then((result) => {
				const buffer = new AudioBuffer({
					length: result.left.length,
					numberOfChannels: 2,
					sampleRate: result.sampleRate
				});
				buffer.copyToChannel(new Float32Array(result.left), 0);
				buffer.copyToChannel(new Float32Array(result.right), 1);
				return buffer;
			})
			.catch((error: unknown) => {
				auditionCache.delete(key);
				throw error;
			});
		auditionCache.set(key, rendering);
		if (auditionCache.size > 48) {
			const oldest = auditionCache.keys().next().value;
			if (oldest) auditionCache.delete(oldest);
		}
	}
	const buffer = await rendering;
	if (generation !== auditionGeneration) return;
	const source = context.createBufferSource();
	source.buffer = buffer;
	const gain = context.createGain();
	gain.gain.value = 0.55;
	source.connect(gain);
	gain.connect(context.destination);
	source.start();
	source.onended = () => {
		source.disconnect();
		gain.disconnect();
	};
}
