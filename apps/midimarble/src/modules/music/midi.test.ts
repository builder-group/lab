import { Midi } from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import type { TNote, TProject, TTrack } from '../project';
import { createAudioEvents } from './audio-events';
import { exportMidi, getTrackInstrumentOptions, importMidi } from './midi';

describe('MIDI import and export functions', () => {
	it('should export normalized pitch bends across the signed MIDI range', () => {
		const piece: TProject = {
			...project,
			tracks: [
				{
					...melodyTrack,
					pitchBends: [-1, 0.5, 1].map((value, index) => ({ time: index * 0.1, value }))
				}
			]
		};
		const exported = new Midi(exportMidi(piece));
		expect(exported.tracks[0]?.pitchBends.map((bend) => bend.value)).toEqual([
			-1,
			0.5,
			8191 / 8192
		]);
	});
	it('should export the complete arrangement regardless of Solo and mute mix settings', () => {
		const piece: TProject = {
			...project,
			tracks: [
				{ ...melodyTrack, solo: true },
				{
					...melodyTrack,
					id: 'other',
					muted: true,
					controls: [{ number: 64, time: 0, value: 1 }],
					pitchBends: [{ time: 0.25, value: 0.5 }]
				}
			],
			notes: [firstNote, { ...firstNote, id: 'other-note', trackId: 'other', midi: 60 }]
		};
		const exported = new Midi(exportMidi(piece));
		expect(exported.tracks.map((track) => track.notes.map((note) => note.midi))).toEqual([
			[72],
			[60]
		]);
		expect(exported.tracks[1]?.controlChanges[64]?.[0]?.value).toBe(1);
		expect(exported.tracks[1]?.pitchBends[0]?.value).toBeCloseTo(0.5);
	});
	it('should preserve tempo changes, instrument assignments, and note timing', async () => {
		const midi = new Midi();
		midi.header.tempos = [
			{ ticks: 0, bpm: 120 },
			{ ticks: 960, bpm: 80 }
		];
		midi.header.update();
		const track = midi.addTrack();
		track.instrument.number = 12;
		track.addNote({ midi: 72, time: 0.5, duration: 0.3, velocity: 0.8 });
		track.addNote({ midi: 75, time: 2, duration: 0.5, velocity: 0.65 });
		track.addCC({ number: 64, time: 1, value: 1 });
		const imported = await importMidi(new File([new Uint8Array(midi.toArray())], 'melody.mid'));
		const exported = new Midi(exportMidi({ ...project, ...imported }));
		expect(imported.tracks[0]?.instrument).toBe(12);
		expect(imported.tempos.map((tempo) => tempo.bpm)).toEqual([120, 80]);
		expect(exported.tracks[0]?.notes[1]?.time).toBeCloseTo(2, 3);
		expect(exported.tracks[0]?.notes[1]?.duration).toBeCloseTo(0.5, 3);
		expect(exported.tracks[0]?.controlChanges[64]?.[0]?.value).toBe(1);
	});

	it('should preserve percussion without assigning melodic tracks to the drum channel', async () => {
		const piece: TProject = {
			...project,
			tracks: [
				{
					id: 'drum',
					name: 'Drums',
					instrument: 0,
					percussion: true,
					color: '#000000',
					muted: false
				},
				{ id: 'melody', name: 'Melody', instrument: 12, color: '#000000', muted: false }
			],
			notes: [
				{ id: 'kick', trackId: 'drum', time: 0, midi: 36, duration: 0.2, velocity: 0.8 },
				{ id: 'melody-note', trackId: 'melody', time: 0, midi: 60, duration: 0.2, velocity: 0.8 }
			]
		};
		const imported = await importMidi(new File([new Uint8Array(exportMidi(piece))], 'duet.mid'));
		expect(imported.tracks.map((track) => track.percussion)).toEqual([true, false]);
		expect(imported.tracks[1]?.instrument).toBe(12);
	});

	it('should include late controller events in the project duration', async () => {
		const midi = new Midi();
		const track = midi.addTrack();
		track.addNote({ midi: 72, time: 0, duration: 0.2, velocity: 0.8 });
		track.addCC({ number: 64, time: 100, value: 0 });
		const imported = await importMidi(new File([new Uint8Array(midi.toArray())], 'expression.mid'));
		expect(imported.duration).toBeCloseTo(101.5, 3);
	});

	it('should reject an excerpt that exceeds 120 seconds including its sound tail', async () => {
		const midi = new Midi();
		midi.addTrack().addNote({ midi: 72, time: 118.6, duration: 0.2, velocity: 0.8 });
		await expect(
			importMidi(new File([new Uint8Array(midi.toArray())], 'long.mid'))
		).rejects.toThrow('120 seconds');
	});

	it('should reject more than 2,000 notes without truncating the arrangement', async () => {
		const midi = new Midi();
		const track = midi.addTrack();
		for (let index = 0; index < 2001; index++)
			track.addNote({ midi: 72, time: index * 0.01, duration: 0.005, velocity: 0.8 });
		await expect(
			importMidi(new File([new Uint8Array(midi.toArray())], 'dense.mid'))
		).rejects.toThrow('2,000 notes');
	});

	it('should reject invalid MIDI with an actionable error', async () => {
		await expect(importMidi(new File(['this is not midi'], 'bad.mid'))).rejects.toThrow(
			'could not be read'
		);
	});
});

describe('getTrackInstrumentOptions function', () => {
	it('should expose every melodic program by name without changing its zero-based value', () => {
		const options = getTrackInstrumentOptions({ ...melodyTrack, instrument: 40 });
		expect(options).toHaveLength(128);
		expect(options.map((option) => option.value)).toEqual(
			Array.from({ length: 128 }, (_, index) => index)
		);
		expect(options.find((option) => option.value === 40)?.label).toBe('Violin');
		expect(options.find((option) => option.value === 12)?.label).toBe('Marimba');
		expect(options.find((option) => option.value === 115)?.label).toBe('Woodblock');
		expect(options.find((option) => option.value === 127)?.label).toBe('Gunshot');
	});

	it('should organize melodic programs into the sixteen eight-sound families', () => {
		const options = getTrackInstrumentOptions(melodyTrack);
		const families = new Set(options.map((option) => option.family));
		expect(families.size).toBe(16);
		for (const family of families)
			expect(options.filter((option) => option.family === family)).toHaveLength(8);
		expect(options.find((option) => option.value === 73)?.family).toBe('Pipe');
		expect(options.find((option) => option.value === 115)?.family).toBe('Percussive');
	});

	it('should label percussion programs as drum kits rather than melodic instruments', () => {
		const options = getTrackInstrumentOptions({ ...melodyTrack, percussion: true, instrument: 8 });
		expect(options.find((option) => option.value === 8)?.label).toBe('Room kit');
		expect(options.some((option) => option.label === 'Celesta' || option.label === 'Marimba')).toBe(
			false
		);
		expect(options.find((option) => option.value === 0)?.label).toBe('Standard 1 kit');
	});

	it('should preserve an unfamiliar imported drum kit program', () => {
		const options = getTrackInstrumentOptions({ ...melodyTrack, percussion: true, instrument: 61 });
		expect(options.find((option) => option.value === 61)?.label).toBe(
			'MIDI drum kit 62 · imported'
		);
	});
});

describe('createAudioEvents function', () => {
	it('should keep sound timing independent of scene geometry', () => {
		const first = createAudioEvents(project, 44100);
		const modified = {
			...project,
			gravity: 3,
			launch: { ...project.launch, velocity: [20, 0, 0] as [number, number, number] }
		};
		expect(createAudioEvents(modified, 44100)).toEqual(first);
		expect(first.find((event) => event.kind === 'on')?.sample).toBe(22050);
	});

	it('should exclude muted tracks and release one note before retriggering the same pitch', () => {
		const repeated: TProject = {
			...project,
			notes: [
				{ ...firstNote, time: 0, duration: 0.5 },
				{ ...firstNote, id: 'second', time: 0.5, duration: 0.5 }
			]
		};
		const events = createAudioEvents(repeated, 44100).filter((event) => event.sample === 22050);
		expect(events.map((event) => event.kind)).toEqual(['off', 'on']);
		expect(
			createAudioEvents({ ...project, tracks: [{ ...melodyTrack, muted: true }] }, 44100)
		).toEqual([]);
	});
});

const firstNote: TNote = {
	id: 'first',
	trackId: 'melody',
	time: 0.5,
	duration: 0.5,
	midi: 72,
	velocity: 0.8
};
const melodyTrack: TTrack = {
	id: 'melody',
	name: 'Marimba',
	instrument: 12,
	color: '#8770cc',
	muted: false
};

const project: TProject = {
	version: 1,
	id: 'test',
	name: 'Test',
	bpm: 120,
	duration: 4,
	tracks: [{ id: 'melody', name: 'Marimba', instrument: 12, color: '#8770cc', muted: false }],
	notes: [{ id: 'first', trackId: 'melody', time: 0.5, duration: 0.5, midi: 72, velocity: 0.8 }],
	objects: [],
	launch: { position: [0, 5, 0], velocity: [1, 0, 0], radius: 0.2 },
	gravity: 9.81,
	restitution: 0.6,
	aspectRatio: '9:16',
	marbleColor: '#48a66d'
};
