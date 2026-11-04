import * as toneMidi from '@tonejs/midi';
import { Err, Ok, type TResult } from 'tuple-result';

// Node loads the package's CommonJS build, whose exports sit on `default`; bundlers expose them directly
const { Midi } = (toneMidi as unknown as { default?: typeof toneMidi }).default ?? toneMidi;

/** Parses a Standard MIDI File into note lists per track and channel */
export function parseMidiFile(bytes: ArrayBuffer | Uint8Array): TResult<TMidiFile, Error> {
	let midi: InstanceType<typeof Midi>;
	try {
		midi = new Midi(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
	} catch (error) {
		return Err(new Error(`This is not a readable MIDI file: ${(error as Error).message}`));
	}
	const tracks: TMidiTrack[] = [];
	for (const [index, track] of midi.tracks.entries()) {
		if (!track.notes.length) continue;
		tracks.push({
			id: `track-${index}`,
			name: track.name.trim() || track.instrument.name || `Track ${index + 1}`,
			hasName: track.name.trim() !== '',
			channel: track.channel,
			program: track.instrument.number,
			isDrums: track.instrument.percussion || track.channel === 9,
			notes: track.notes
				.map((note) => ({
					time: note.time,
					duration: note.duration,
					pitch: note.midi,
					velocity: note.velocity
				}))
				.sort((a, b) => a.time - b.time || b.pitch - a.pitch)
		});
	}
	if (!tracks.length) return Err(new Error('The MIDI file contains no notes'));
	return Ok({ name: midi.name, duration: midi.duration, tempo: midi.header.tempos[0]?.bpm ?? null, tracks });
}

export interface TMidiFile {
	name: string;
	duration: number;
	tempo: number | null;
	tracks: TMidiTrack[];
}

export interface TMidiTrack {
	id: string;
	name: string;
	/** The file itself names it, as opposed to falling back on its instrument */
	hasName: boolean;
	channel: number;
	program: number;
	isDrums: boolean;
	notes: TMidiNote[];
}

export interface TMidiNote {
	time: number;
	duration: number;
	pitch: number;
	velocity: number;
}
