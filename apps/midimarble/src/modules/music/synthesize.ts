import {
	SpessaLog,
	SpessaSynthProcessor,
	type BasicSoundBank,
	type MIDIController
} from 'spessasynth_core';
import type { TProject } from '../project';
import { createAudioEvents } from './audio-events';

export async function synthesizeAudio(
	project: TProject,
	bank: BasicSoundBank,
	sampleRate: number
): Promise<TSynthesizedAudio> {
	SpessaLog.setLogLevel(false, false, false);
	const synth = new SpessaSynthProcessor(sampleRate, {
		eventsEnabled: false,
		effectsEnabled: true
	});
	synth.soundBankManager.addSoundBank(bank, 'general-user');
	SpessaLog.setLogLevel(false, true, false);
	for (const [channel, track] of project.tracks.entries()) {
		while (synth.midiChannels.length <= channel) synth.createMIDIChannel();
		synth.midiChannels[channel]?.setDrums(Boolean(track.percussion));
		synth.programChange(channel, track.instrument);
	}
	const length = Math.max(1, Math.ceil(project.duration * sampleRate));
	const left = new Float32Array(length);
	const right = new Float32Array(length);
	const blockLeft = new Float32Array(128);
	const blockRight = new Float32Array(128);
	const events = createAudioEvents(project, sampleRate);
	let cursor = 0;
	let eventIndex = 0;
	while (cursor < length) {
		while (eventIndex < events.length) {
			const event = events[eventIndex];
			if (event == null || event.sample > cursor) break;
			eventIndex++;
			if (event.kind === 'on') synth.noteOn(event.channel, event.value, event.velocity);
			if (event.kind === 'off') synth.noteOff(event.channel, event.value);
			if (event.kind === 'cc')
				synth.controllerChange(event.channel, event.value as MIDIController, event.velocity);
			if (event.kind === 'bend') synth.pitchWheel(event.channel, event.value);
		}
		const nextEventSample = events[eventIndex]?.sample ?? length;
		const count = Math.min(128, length - cursor, Math.max(1, nextEventSample - cursor));
		blockLeft.fill(0);
		blockRight.fill(0);
		synth.process(blockLeft, blockRight, 0, count);
		left.set(blockLeft.subarray(0, count), cursor);
		right.set(blockRight.subarray(0, count), cursor);
		cursor += count;
	}
	// The bank is shared across renders; destroying the processor would destroy its presets
	synth.stopAll(true);
	let peak = 0;
	for (let index = 0; index < length; index++)
		peak = Math.max(peak, Math.abs(left[index] ?? 0), Math.abs(right[index] ?? 0));
	const gain = peak > 0 ? Math.min(8, 0.9 / peak) : 1;
	const fadeLength = Math.min(length, Math.round(sampleRate * 0.025));
	for (let index = 0; index < length; index++) {
		const endFade = Math.min(1, (length - index - 1) / fadeLength);
		left[index] = (left[index] ?? 0) * gain * endFade;
		right[index] = (right[index] ?? 0) * gain * endFade;
	}
	return { left, right, sampleRate };
}

export interface TSynthesizedAudio {
	left: Float32Array;
	right: Float32Array;
	sampleRate: number;
}
