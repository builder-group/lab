import { SoundBankLoader, SpessaLog, type BasicSoundBank } from 'spessasynth_core';
import type { TLane, TProject, TSource } from '@/modules/project';
import {
	backingVoice,
	mixAudioSource,
	renderLanes,
	type TDecodedAudio,
	type TStereoAudio
} from './synthesize';
import { hasSong } from './parts';
import { createScrubber } from './scrub';
import { decodeAudioFile } from './waveform';

const SAMPLE_RATE = 48000;
const BANK_URL = '/audio/marble-instruments.sf2';

/**
 * Seconds the soundtrack fades out over at the film end, so a note still ringing after `SONG_TAIL` is not cut off.
 */
export const FILM_AUDIO_FADE = 0.4;

export function createAudioEngine(): TAudioEngine {
	const context = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' });
	const master = context.createGain();
	master.connect(context.destination);
	const auditionCache = new Map<string, AudioBuffer>();
	let timeline: AudioBuffer | null = null;
	let signature: string | null = null;
	let source: AudioBufferSourceNode | null = null;
	let startedAt = 0;
	let startOffset = 0;
	const scrubber = createScrubber(context, master);
	// A drag that ended while its soundtrack was rendering must not start playing when the render lands
	let scrubSession = 0;

	function getTime(): number {
		if (source == null) return startOffset;
		const time = startOffset + (context.currentTime - startedAt);
		return timeline == null ? time : Math.min(time, timeline.duration);
	}

	function stop(): void {
		if (source == null) return;
		startOffset = getTime();
		const current = source;
		source = null;
		current.onended = null;
		current.stop();
		current.disconnect();
	}

	function endScrub(): void {
		scrubSession++;
		scrubber.end();
	}

	async function prepare(project: TProject, resolveSourceUrl: TResolveSourceUrl): Promise<void> {
		const nextSignature = createAudioSignature(project, resolveSourceUrl);
		if (nextSignature === signature && timeline != null) return;
		const audio = await renderProjectAudio(project, resolveSourceUrl, {
			sampleRate: SAMPLE_RATE
		});
		const buffer = context.createBuffer(2, audio.left.length, audio.sampleRate);
		buffer.copyToChannel(audio.left as Float32Array<ArrayBuffer>, 0);
		buffer.copyToChannel(audio.right as Float32Array<ArrayBuffer>, 1);
		const wasPlaying = source != null;
		const time = getTime();
		timeline = buffer;
		signature = nextSignature;
		if (wasPlaying) await play(time);
	}

	async function play(from: number): Promise<void> {
		endScrub();
		stop();
		startOffset = Math.max(0, from);
		if (context.state !== 'running') await context.resume();
		if (timeline == null || startOffset >= timeline.duration) return;
		const node = context.createBufferSource();
		node.buffer = timeline;
		node.connect(master);
		node.onended = () => {
			if (source !== node) return;
			startOffset = getTime();
			source = null;
		};
		startedAt = context.currentTime;
		node.start(0, startOffset);
		source = node;
	}

	return {
		prepare,
		play,
		stop,
		getTime,
		isPlaying: () => source != null,
		async beginScrub(project, resolveSourceUrl) {
			endScrub();
			const session = scrubSession;
			scrubber.begin();
			// Resumed before anything awaits, while this is still the press's gesture
			const resumed = context.state === 'running' ? undefined : context.resume();
			await Promise.all([resumed, prepare(project, resolveSourceUrl)]);
			if (session === scrubSession) scrubber.setBuffer(timeline);
		},
		scrubTo: (time) => scrubber.move(time),
		endScrub,
		async audition(lane, pitch) {
			const key = `${lane.instrument}:${pitch}`;
			let buffer = auditionCache.get(key);
			if (buffer == null) {
				const bank = await loadInstrumentBank();
				const audio = renderLanes(
					[{ ...lane, hits: [{ id: 'audition', time: 0, pitch }] }],
					{ sampleRate: SAMPLE_RATE, duration: 1, bank }
				);
				fadeOut(audio, 0.05);
				buffer = context.createBuffer(2, audio.left.length, SAMPLE_RATE);
				buffer.copyToChannel(audio.left as Float32Array<ArrayBuffer>, 0);
				buffer.copyToChannel(audio.right as Float32Array<ArrayBuffer>, 1);
				auditionCache.set(key, buffer);
			}
			if (context.state !== 'running') await context.resume();
			const node = context.createBufferSource();
			node.buffer = buffer;
			node.connect(master);
			node.onended = () => node.disconnect();
			node.start();
		},
		setVolume(volume) {
			master.gain.setTargetAtTime(Math.max(0, volume), context.currentTime, 0.01);
		},
		dispose() {
			endScrub();
			stop();
			auditionCache.clear();
			timeline = null;
			void context.close();
		}
	};
}

export interface TAudioEngine {
	// Renders the timeline `[0, project.end]` unless its audio inputs are unchanged
	prepare: (project: TProject, resolveSourceUrl: TResolveSourceUrl) => Promise<void>;
	play: (from: number) => Promise<void>;
	stop: () => void;
	// Timeline seconds; while stopped, the time playback stopped at
	getTime: () => number;
	isPlaying: () => boolean;
	// Starts a playhead drag: renders `project` if it changed, then plays snippets at the positions given to `scrubTo`
	beginScrub: (project: TProject, resolveSourceUrl: TResolveSourceUrl) => Promise<void>;
	scrubTo: (time: number) => void;
	endScrub: () => void;
	// Plays one note of the Song; a hit without a pitch has nothing to play
	audition: (lane: TLane, pitch: number) => Promise<void>;
	setVolume: (volume: number) => void;
	dispose: () => void;
}

export type TResolveSourceUrl = (source: TSource) => string | null;

/**
 * The Song is the only sound. Imported recordings already contain the music, so lanes and Backing are synthesized
 * only without an audio source, and a project without a Song renders as silence, whatever pitches its hits keep.
 */
export async function renderProjectAudio(
	project: TProject,
	resolveSourceUrl: TResolveSourceUrl,
	options: { sampleRate?: number } = {}
): Promise<TStereoAudio> {
	const { sampleRate = SAMPLE_RATE } = options;
	if (!hasSong(project)) return silentAudio(project.end, sampleRate);
	const audioSources = project.music.sources.filter((source) => source.kind === 'audio');
	if (!audioSources.length) {
		const bank = await loadInstrumentBank();
		const audio = renderLanes(project.music.lanes, { sampleRate, duration: project.end, bank, backing: backingVoice(project) });
		fadeOut(audio, FILM_AUDIO_FADE);
		return audio;
	}
	const audio = silentAudio(project.end, sampleRate);
	const decodedSources = await Promise.all(
		audioSources.map(async (source) => ({
			source,
			decoded: await loadSource(resolveSourceUrl(source))
		}))
	);
	for (const { source, decoded } of decodedSources)
		if (decoded != null) mixAudioSource(audio, decoded, source.offset);
	fadeOut(audio, FILM_AUDIO_FADE);
	return audio;
}

// Stable key of everything `renderProjectAudio` reads
export function createAudioSignature(
	project: TProject,
	resolveSourceUrl: TResolveSourceUrl
): string {
	const audioSources = project.music.sources
		.filter((source) => source.kind === 'audio')
		.map((source) => ({ url: resolveSourceUrl(source), offset: source.offset }));
	const isSynthesized = !audioSources.length && hasSong(project);
	const lanes = isSynthesized
		? project.music.lanes.map((lane) => ({
				instrument: lane.instrument,
				hits: lane.hits.flatMap((hit) => (hit.pitch == null ? [] : [[hit.time, hit.pitch, hit.velocity ?? null, hit.duration ?? null]]))
			}))
		: [];
	const backing = isSynthesized ? backingVoice(project) : undefined;
	const backingKey = backing == null ? null : { instrument: backing.instrument, hits: backing.hits.map((hit) => [hit.time, hit.pitch ?? null, hit.velocity ?? null, hit.duration ?? null]) };
	return JSON.stringify({ end: project.end, audioSources, lanes, backing: backingKey });
}

let bankPromise: Promise<BasicSoundBank> | null = null;

export function loadInstrumentBank(): Promise<BasicSoundBank> {
	bankPromise ??= (async () => {
		const response = await fetch(BANK_URL);
		if (!response.ok) throw new Error(`Failed to load ${BANK_URL}: ${response.status}`);
		SpessaLog.setLogLevel(false, false, false);
		return SoundBankLoader.fromArrayBuffer(await response.arrayBuffer());
	})();
	bankPromise.catch(() => {
		bankPromise = null;
	});
	return bankPromise;
}

const sourceCache = new Map<string, Promise<TDecodedAudio | null>>();

function loadSource(url: string | null): Promise<TDecodedAudio | null> {
	if (url == null) return Promise.resolve(null);
	let decoded = sourceCache.get(url);
	if (decoded == null) {
		decoded = (async () => {
			const response = await fetch(url);
			if (!response.ok) return null;
			return decodeAudioFile(await response.arrayBuffer());
		})();
		decoded.catch(() => sourceCache.delete(url));
		sourceCache.set(url, decoded);
	}
	return decoded;
}

function silentAudio(seconds: number, sampleRate: number): TStereoAudio {
	const length = Math.max(1, Math.ceil(seconds * sampleRate));
	return { sampleRate, left: new Float32Array(length), right: new Float32Array(length) };
}

function fadeOut(audio: TStereoAudio, seconds: number): void {
	const length = audio.left.length;
	const fadeLength = Math.min(length, Math.round(audio.sampleRate * seconds));
	for (let index = length - fadeLength; index < length; index++) {
		const gain = (length - index - 1) / fadeLength;
		audio.left[index] = (audio.left[index] ?? 0) * gain;
		audio.right[index] = (audio.right[index] ?? 0) * gain;
	}
}

// 16-bit PCM stereo WAV
export function encodeWav(left: Float32Array, right: Float32Array, sampleRate: number): Uint8Array {
	const frames = Math.min(left.length, right.length);
	const dataSize = frames * 4;
	const bytes = new Uint8Array(44 + dataSize);
	const view = new DataView(bytes.buffer);
	const writeText = (offset: number, text: string): void => {
		for (let index = 0; index < text.length; index++)
			view.setUint8(offset + index, text.charCodeAt(index));
	};
	writeText(0, 'RIFF');
	view.setUint32(4, 36 + dataSize, true);
	writeText(8, 'WAVE');
	writeText(12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 2, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 4, true);
	view.setUint16(32, 4, true);
	view.setUint16(34, 16, true);
	writeText(36, 'data');
	view.setUint32(40, dataSize, true);
	for (let frame = 0; frame < frames; frame++) {
		view.setInt16(44 + frame * 4, toInt16(left[frame] ?? 0), true);
		view.setInt16(46 + frame * 4, toInt16(right[frame] ?? 0), true);
	}
	return bytes;
}

// 16-bit PCM mono WAV, half the size of stereo for a recording that has no stereo image
export function encodeMonoWav(samples: Float32Array, sampleRate: number): Uint8Array {
	const dataSize = samples.length * 2;
	const bytes = new Uint8Array(44 + dataSize);
	const view = new DataView(bytes.buffer);
	const writeText = (offset: number, text: string): void => {
		for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index));
	};
	writeText(0, 'RIFF');
	view.setUint32(4, 36 + dataSize, true);
	writeText(8, 'WAVE');
	writeText(12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	writeText(36, 'data');
	view.setUint32(40, dataSize, true);
	for (let index = 0; index < samples.length; index++) view.setInt16(44 + index * 2, toInt16(samples[index] ?? 0), true);
	return bytes;
}

function toInt16(sample: number): number {
	const clamped = Math.max(-1, Math.min(1, sample));
	return Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
}
