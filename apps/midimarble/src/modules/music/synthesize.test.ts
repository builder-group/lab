import { readFileSync } from 'node:fs';
import { SoundBankLoader } from 'spessasynth_core';
import { describe, expect, it } from 'vitest';
import type { TProject } from '../project';
import { synthesizeAudio } from './synthesize';

describe('synthesizeAudio function', () => {
	it('should render audible samples on repeated use of the same sound bank', async () => {
		const bytes = readFileSync(
			new URL('../../../public/audio/general-user-gs.sf2', import.meta.url)
		);
		const bank = SoundBankLoader.fromArrayBuffer(new Uint8Array(bytes).buffer);
		const first = await synthesizeAudio(project, bank, 22050);
		const second = await synthesizeAudio(project, bank, 22050);
		expect(first.left.some((sample) => Math.abs(sample) > 0.01)).toBe(true);
		expect(second.left.some((sample) => Math.abs(sample) > 0.01)).toBe(true);
		expect(second.left.length).toBe(22050);
		expect(second.left.every(Number.isFinite)).toBe(true);
	});

	it('should respect MIDI instrument choices and track mute', async () => {
		const bytes = readFileSync(
			new URL('../../../public/audio/general-user-gs.sf2', import.meta.url)
		);
		const bank = SoundBankLoader.fromArrayBuffer(new Uint8Array(bytes).buffer);
		const marimba = await synthesizeAudio(project, bank, 22050);
		const piano = await synthesizeAudio(
			{ ...project, tracks: project.tracks.map((track) => ({ ...track, instrument: 0 })) },
			bank,
			22050
		);
		const muted = await synthesizeAudio(
			{ ...project, tracks: project.tracks.map((track) => ({ ...track, muted: true })) },
			bank,
			22050
		);
		expect(
			piano.left.some((sample, index) => Math.abs(sample - (marimba.left[index] ?? 0)) > 0.01)
		).toBe(true);
		expect(muted.left.every((sample) => sample === 0)).toBe(true);
	});
});

const project: TProject = {
	version: 1,
	id: 'test',
	name: 'Test',
	bpm: 120,
	duration: 1,
	tracks: [{ id: 'melody', name: 'Marimba', instrument: 12, color: '#8770cc', muted: false }],
	notes: [{ id: 'first', trackId: 'melody', time: 0.1, duration: 0.4, midi: 72, velocity: 0.8 }],
	objects: [],
	launch: { position: [0, 5, 0], velocity: [1, 0, 0], radius: 0.2 },
	gravity: 9.81,
	restitution: 0.6,
	aspectRatio: '9:16',
	marbleColor: '#48a66d'
};
