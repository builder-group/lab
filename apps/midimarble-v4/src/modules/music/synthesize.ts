import {
	SPESSA_BUFSIZE,
	SpessaLog,
	SpessaSynthProcessor,
	type BasicSoundBank
} from 'spessasynth_core';
import type { TLane } from '@/modules/project';

export const DEFAULT_HIT_PITCH = 76;
export const DEFAULT_HIT_VELOCITY = 0.8;
export const MAX_NOTE_LENGTH = 0.6;

export function renderLanes(lanes: TLane[], options: TRenderLanesOptions): TStereoAudio {
	const { sampleRate, duration, bank } = options;
	const length = Math.max(1, Math.ceil(duration * sampleRate));
	const left = new Float32Array(length);
	const right = new Float32Array(length);
	const events = createLaneEvents(lanes, sampleRate);
	if (!events.length) return { sampleRate, left, right };

	SpessaLog.setLogLevel(false, false, false);
	const synth = new SpessaSynthProcessor(sampleRate, {
		eventsEnabled: false,
		effectsEnabled: true
	});
	synth.soundBankManager.addSoundBank(bank, 'marble-instruments');
	for (const [index, lane] of lanes.entries()) {
		const channel = laneChannel(index);
		while (synth.midiChannels.length <= channel) synth.createMIDIChannel();
		synth.midiChannels[channel]?.setDrums(false);
		synth.programChange(channel, lane.instrument);
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

export interface TRenderLanesOptions {
	sampleRate: number;
	duration: number;
	bank: BasicSoundBank;
}

export interface TStereoAudio {
	sampleRate: number;
	left: Float32Array;
	right: Float32Array;
}

// Note events sorted by sample; at equal samples note-offs come first so a repeated pitch retriggers
export function createLaneEvents(lanes: TLane[], sampleRate: number): TLaneEvent[] {
	const events: TLaneEvent[] = [];
	for (const [index, lane] of lanes.entries()) {
		const channel = laneChannel(index);
		const hits = [...lane.hits].sort((a, b) => a.time - b.time);
		for (const [hitIndex, hit] of hits.entries()) {
			const next = hits[hitIndex + 1];
			const length = Math.min(
				MAX_NOTE_LENGTH,
				next == null ? MAX_NOTE_LENGTH : next.time - hit.time
			);
			const pitch = hit.pitch ?? DEFAULT_HIT_PITCH;
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
	return events.sort(
		(a, b) => a.sample - b.sample || (a.kind === b.kind ? 0 : a.kind === 'off' ? -1 : 1)
	);
}

export interface TLaneEvent {
	kind: 'on' | 'off';
	sample: number;
	channel: number;
	pitch: number;
	velocity: number;
}

// Skips channel 10, which General MIDI reserves for drums
function laneChannel(index: number): number {
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
