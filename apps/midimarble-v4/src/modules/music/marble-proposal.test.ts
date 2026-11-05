import { describe, expect, it } from 'vitest';
import { Midi } from '@tonejs/midi';
import { alignNotes, marbleNamesFromTracks, MIN_HIT_GAP, proposeMarbles } from './marble-proposal';
import { parseMidiFile, type TMidiNote } from './midi';

function note(time: number, pitch: number): TMidiNote {
	return { time, pitch, duration: 0.2, velocity: 0.8 };
}

function gaps(marble: TMidiNote[]): number[] {
	return marble.slice(1).map((item, index) => item.time - (marble[index]?.time ?? 0));
}

describe('proposeMarbles', () => {
	it('keeps a monophonic melody on one marble', () => {
		const notes = [note(0, 60), note(0.25, 62), note(0.5, 64)];
		const proposal = proposeMarbles(notes);
		expect(proposal.marbles).toHaveLength(1);
		expect(proposal.backing).toEqual([]);
	});

	it('spreads chords across marbles and respects the minimum gap', () => {
		const notes = [note(0, 72), note(0, 64), note(0, 60), note(0.5, 74), note(0.5, 65), note(0.6, 76)];
		const proposal = proposeMarbles(notes, { maxMarbles: 4 });
		expect(proposal.marbles.length).toBe(3);
		for (const marble of proposal.marbles) {
			for (const gap of gaps(marble)) expect(gap).toBeGreaterThanOrEqual(MIN_HIT_GAP - 1e-9);
		}
		const total = proposal.marbles.reduce((sum, marble) => sum + marble.length, 0) + proposal.backing.length;
		expect(total).toBe(notes.length);
	});

	it('keeps the highest note on the first marble', () => {
		const proposal = proposeMarbles([note(0, 60), note(0, 72), note(1, 62), note(1, 74)]);
		expect(proposal.marbles[0]?.map((item) => item.pitch)).toEqual([72, 74]);
	});

	it('drops notes when voices exceed the marble limit', () => {
		const chord = [note(0, 60), note(0, 64), note(0, 67), note(0, 72)];
		const proposal = proposeMarbles(chord, { maxMarbles: 2 });
		expect(proposal.marbles).toHaveLength(2);
		expect(proposal.backing.map((item) => item.reason)).toEqual(['tooManyVoices', 'tooManyVoices']);
	});

	it('keeps only top notes in melody mode', () => {
		const proposal = proposeMarbles([note(0, 60), note(0, 72), note(0.1, 74), note(0.4, 70)], { strategy: 'melody' });
		expect(proposal.marbles).toHaveLength(1);
		expect(proposal.marbles[0]?.map((item) => item.pitch)).toEqual([72, 70]);
		expect(proposal.backing.map((item) => item.reason).sort()).toEqual(['chord', 'tooClose']);
	});
});

describe('alignNotes', () => {
	it('moves the first note to the start and keeps intervals', () => {
		const aligned = alignNotes([note(2, 60), note(2.5, 62)], 1);
		expect(aligned.map((item) => item.time)).toEqual([1, 1.5]);
	});
});

describe('parseMidiFile', () => {
	it('reads tracks and notes from a written file', () => {
		const midi = new Midi();
		midi.header.setTempo(120);
		const track = midi.addTrack();
		track.name = 'Bells';
		track.addNote({ midi: 72, time: 0.5, duration: 0.25 });
		track.addNote({ midi: 74, time: 1, duration: 0.25 });
		midi.addTrack();
		const [isParsedOk, parsedErr, parsed] = parseMidiFile(midi.toArray());
		expect(parsedErr).toBeUndefined();
		expect(isParsedOk).toBe(true);
		expect(parsed?.tracks).toHaveLength(1);
		expect(parsed?.tracks[0]?.name).toBe('Bells');
		expect(parsed?.tracks[0]?.notes.map((item) => item.pitch)).toEqual([72, 74]);
	});

	it('rejects files that are not MIDI', () => {
		expect(parseMidiFile(new Uint8Array([1, 2, 3]))[0]).toBe(false);
	});
});

describe('marbleNamesFromTracks', () => {
	const melody = [note(0, 72), note(1, 74)];
	const bass = [note(0, 40), note(1, 42)];

	it('should name each marble after the track most of its notes come from', () => {
		const tracks = [{ name: 'Melody', hasName: true, notes: melody }, { name: 'Bass', hasName: true, notes: bass }];
		expect(marbleNamesFromTracks([melody, bass], tracks)).toEqual(['Melody', 'Bass']);
	});

	it('should keep Marble 1 for a track the file does not name, or that two marbles share', () => {
		expect(marbleNamesFromTracks([melody], [{ name: 'glockenspiel', hasName: false, notes: melody }])).toEqual([null]);
		expect(marbleNamesFromTracks([[melody[0] as TMidiNote], [melody[1] as TMidiNote]], [{ name: 'Piano', hasName: true, notes: melody }])).toEqual([null, null]);
	});

	it('should name the marbles of a real MIDI file from its tracks', () => {
		const file = new Midi();
		const notes = (midi: number, times: number[]): void => {
			const track = file.addTrack();
			track.name = midi > 60 ? 'Melody' : 'Bass';
			for (const time of times) track.addNote({ midi, time, duration: 0.2 });
		};
		notes(76, [0.5, 1, 1.5, 2, 2.5, 3]);
		// Struck together, so one marble can't play both
		notes(40, [0.5, 1, 1.5, 2, 2.5, 3]);
		const [isParsedOk, , midi] = parseMidiFile(file.toArray());
		expect(isParsedOk).toBe(true);
		const tracks = midi?.tracks ?? [];
		const { marbles } = proposeMarbles(tracks.flatMap((track) => track.notes));
		expect(marbleNamesFromTracks(marbles, tracks)).toEqual(['Melody', 'Bass']);
	});
});
