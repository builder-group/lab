import {
	SPESSA_BUFSIZE,
	SpessaLog,
	SpessaSynthProcessor,
	type BasicSoundBank
} from 'spessasynth_core';
import type { THit, TMarble, TProject } from '@/modules/project';

export const DEFAULT_HIT_VELOCITY = 0.8;
export const MAX_NOTE_LENGTH = 0.6;
/** Longest Backing note; held notes of a MIDI file end here so a stuck note cannot ring through the film */
export const MAX_BACKING_NOTE_LENGTH = 4;
/** General MIDI program of Backing when the project names none: Acoustic Grand Piano */
export const DEFAULT_BACKING_INSTRUMENT = 0;

/** Renders marbles as short strikes, one channel each, and each song's Backing on its own channel with the notes' own lengths */
export function renderMarbles(marbles: TMarble[], options: TRenderMarblesOptions): TStereoAudio {
	const { sampleRate, duration, bank, backing = [] } = options;
	const length = Math.max(1, Math.ceil(duration * sampleRate));
	const left = new Float32Array(length);
	const right = new Float32Array(length);
	const voices = backing.map((voice, index) => ({ ...voice, channel: marbleChannel(marbles.length + index) }));
	const events = [...createMarbleEvents(marbles, sampleRate), ...voices.flatMap((voice) => createBackingEvents(voice.hits, voice.channel, sampleRate))].sort(compareEvents);
	if (!events.length) return { sampleRate, left, right };

	SpessaLog.setLogLevel(false, false, false);
	const synth = new SpessaSynthProcessor(sampleRate, {
		eventsEnabled: false,
		effectsEnabled: true
	});
	synth.soundBankManager.addSoundBank(bank, 'marble-instruments');
	for (const [index, marble] of marbles.entries()) {
		const channel = marbleChannel(index);
		while (synth.midiChannels.length <= channel) synth.createMIDIChannel();
		synth.midiChannels[channel]?.setDrums(false);
		synth.programChange(channel, marble.sound);
	}
	for (const voice of voices) {
		while (synth.midiChannels.length <= voice.channel) synth.createMIDIChannel();
		synth.midiChannels[voice.channel]?.setDrums(false);
		synth.programChange(voice.channel, voice.instrument);
	}

	let cursor = 0;
	let eventIndex = 0;
	while (cursor < length) {
		while (eventIndex < events.length) {
			const event = events[eventIndex];
			if (event == null || event.sample > cursor) break;
			eventIndex++;
			if (event.kind === 'on') synth.noteOn(event.channel, event.pitch, event.velocity);
			else synth.noteOff(event.channel, event.pitch);
		}
		const nextEventSample = events[eventIndex]?.sample ?? length;
		const count = Math.min(SPESSA_BUFSIZE, length - cursor, Math.max(1, nextEventSample - cursor));
		synth.process(left, right, cursor, count);
		cursor += count;
	}
	// The bank is shared across renders; destroying the processor would destroy its presets
	synth.stopAll(true);
	return { sampleRate, left, right };
}

export interface TRenderMarblesOptions {
	sampleRate: number;
	duration: number;
	bank: BasicSoundBank;
	backing?: TBackingVoice[];
}

/** The notes no marble plays and the program they play with */
export interface TBackingVoice {
	instrument: number;
	hits: THit[];
}

/** Each song's Backing for rendering, for the songs that have notes */
export function backingVoices(project: Pick<TProject, 'songs'>): TBackingVoice[] {
	return project.songs.flatMap((song) => (song.backing.length > 0 ? [{ instrument: song.backingSound ?? DEFAULT_BACKING_INSTRUMENT, hits: song.backing }] : []));
}

/**
 * What the marbles play: a hit with a pitch plays with its marble's Sound, except one tied to a recording, which already
 * holds it. A hit without a pitch plays nothing.
 */
export function soundingMarbles(project: Pick<TProject, 'songs' | 'marbles'>): TMarble[] {
	const recordings = new Set(project.songs.filter((song) => song.kind === 'audio' && song.path != null).map((song) => song.id));
	return project.marbles.map((marble) => {
		const hits = marble.hits.filter((hit) => hit.pitch != null && (hit.songId == null || !recordings.has(hit.songId)));
		return hits.length === marble.hits.length ? marble : { ...marble, hits };
	});
}

export interface TStereoAudio {
	sampleRate: number;
	left: Float32Array;
	right: Float32Array;
}

/**
 * Note events sorted by sample; at equal samples note-offs come first so a repeated pitch retriggers. Only hits
 * from a MIDI note sound: a tapped hit has no pitch and plays nothing, and does not shorten the note before it.
 */
export function createMarbleEvents(marbles: TMarble[], sampleRate: number): TMarbleEvent[] {
	const events: TMarbleEvent[] = [];
	for (const [index, marble] of marbles.entries()) {
		const channel = marbleChannel(index);
		const hits = marble.hits.filter(hasPitch).sort((a, b) => a.time - b.time);
		for (const [hitIndex, hit] of hits.entries()) {
			const length = marbleNoteLength(hit, hits[hitIndex + 1]);
			const { pitch } = hit;
			const velocity = Math.round(1 + (hit.velocity ?? DEFAULT_HIT_VELOCITY) * 126);
			const onSample = Math.round(hit.time * sampleRate);
			events.push({ kind: 'on', sample: onSample, channel, pitch, velocity });
			events.push({
				kind: 'off',
				sample: Math.round((hit.time + length) * sampleRate),
				channel,
				pitch,
				velocity: 0
			});
		}
	}
	return events.sort(compareEvents);
}

/**
 * Backing note events on one channel. A note lasts its MIDI length, up to `MAX_BACKING_NOTE_LENGTH`, and ends
 * before the next note of the same pitch so that note sounds in full.
 */
export function createBackingEvents(hits: THit[], channel: number, sampleRate: number): TMarbleEvent[] {
	const events: TMarbleEvent[] = [];
	const sorted = hits.filter(hasPitch).sort((a, b) => a.time - b.time);
	for (const [index, hit] of sorted.entries()) {
		const { pitch } = hit;
		const next = sorted.slice(index + 1).find((item) => item.pitch === pitch);
		const length = backingNoteLength(hit, next);
		const velocity = Math.round(1 + (hit.velocity ?? DEFAULT_HIT_VELOCITY) * 126);
		events.push({ kind: 'on', sample: Math.round(hit.time * sampleRate), channel, pitch, velocity });
		events.push({ kind: 'off', sample: Math.round((hit.time + Math.max(0, length)) * sampleRate), channel, pitch, velocity: 0 });
	}
	return events.sort(compareEvents);
}

/** How long a marble's note sounds: its own length up to `MAX_NOTE_LENGTH`, and only until the marble's next note */
export function marbleNoteLength(hit: THit, next: THit | undefined): number {
	return Math.min(hit.duration ?? MAX_NOTE_LENGTH, MAX_NOTE_LENGTH, next == null ? MAX_NOTE_LENGTH : next.time - hit.time);
}

/** How long a Backing note sounds: its MIDI length up to `MAX_BACKING_NOTE_LENGTH`, and only until the next note of the same pitch */
export function backingNoteLength(hit: THit, nextSamePitch: THit | undefined): number {
	return Math.min(hit.duration ?? MAX_NOTE_LENGTH, MAX_BACKING_NOTE_LENGTH, nextSamePitch == null ? Infinity : nextSamePitch.time - hit.time);
}

function hasPitch(hit: THit): hit is THit & { pitch: number } {
	return hit.pitch != null;
}

function compareEvents(a: TMarbleEvent, b: TMarbleEvent): number {
	return a.sample - b.sample || (a.kind === b.kind ? 0 : a.kind === 'off' ? -1 : 1);
}

export interface TMarbleEvent {
	kind: 'on' | 'off';
	sample: number;
	channel: number;
	pitch: number;
	velocity: number;
}

// Skips channel 10, which General MIDI reserves for drums
function marbleChannel(index: number): number {
	return index >= 9 ? index + 1 : index;
}

// Adds a decoded source into `target` starting at `offsetSeconds`, resampling linearly when rates differ
export function mixAudioSource(
	target: TStereoAudio,
	decoded: TDecodedAudio,
	offsetSeconds: number
): void {
	const sourceLeft = decoded.channels[0];
	if (sourceLeft == null) return;
	const sourceRight = decoded.channels[1] ?? sourceLeft;
	const ratio = decoded.sampleRate / target.sampleRate;
	const offset = Math.round(offsetSeconds * target.sampleRate);
	const sourceLength = sourceLeft.length;
	const start = Math.max(0, offset);
	const end = Math.min(target.left.length, offset + Math.ceil(sourceLength / ratio));
	for (let index = start; index < end; index++) {
		const position = (index - offset) * ratio;
		const base = Math.floor(position);
		if (base >= sourceLength) break;
		const fraction = position - base;
		const nextIndex = Math.min(base + 1, sourceLength - 1);
		target.left[index] =
			(target.left[index] ?? 0) +
			(sourceLeft[base] ?? 0) * (1 - fraction) +
			(sourceLeft[nextIndex] ?? 0) * fraction;
		target.right[index] =
			(target.right[index] ?? 0) +
			(sourceRight[base] ?? 0) * (1 - fraction) +
			(sourceRight[nextIndex] ?? 0) * fraction;
	}
}

export interface TDecodedAudio {
	sampleRate: number;
	channels: Float32Array[];
}
