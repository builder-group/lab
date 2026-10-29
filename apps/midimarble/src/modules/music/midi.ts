import { Midi } from '@tonejs/midi';
import type { TNote, TProject, TTrack } from '../project';
import { instrumentName, instrumentOptions, type TInstrumentOption } from './instruments';

export { instrumentName, instrumentOptions, type TInstrumentOption } from './instruments';

export async function importMidi(file: File): Promise<TImportedMidi> {
	if (file.size > 5 * 1024 * 1024) {
		throw new Error('Choose a MIDI file smaller than 5 MB.');
	}
	let midi: Midi;
	try {
		midi = new Midi(await file.arrayBuffer());
	} catch {
		throw new Error('This file could not be read as MIDI. Choose a .mid or .midi file.');
	}
	const playableTracks = midi.tracks.filter((track) => track.notes.length > 0);
	if (!playableTracks.length) {
		throw new Error('This MIDI file has no notes.');
	}
	if (playableTracks.length > 32) {
		throw new Error(
			'This piece has more than 32 musical tracks. Export a smaller selection from your MIDI editor.'
		);
	}
	const noteCount = playableTracks.reduce((count, track) => count + track.notes.length, 0);
	if (noteCount > 2000) {
		throw new Error('Choose an arrangement with up to 2,000 notes. No notes were imported.');
	}
	let duration = Math.max(4, midi.duration + 1.5);
	if (!Number.isFinite(duration) || duration > 120) {
		throw new Error(
			'Choose a MIDI excerpt that fits within 120 seconds, including a 1.5-second sound tail. No notes were imported.'
		);
	}
	const tempos = midi.header.tempos.map((tempo) => ({ time: tempo.time ?? 0, bpm: tempo.bpm }));
	if (tempos.length > 10000) throw new Error('This MIDI file contains too many tempo changes.');
	if (
		tempos.some((tempo) => !validNumber(tempo.time, 0, 120) || !validNumber(tempo.bpm, 10, 1000))
	) {
		throw new Error(
			'This MIDI file contains an unsupported tempo. Use tempos between 10 and 1,000 BPM.'
		);
	}
	for (const tempo of tempos) duration = Math.max(duration, tempo.time + 1.5);
	let expressionEvents = 0;
	const notes: TNote[] = [];
	const tracks: TTrack[] = [];
	for (const [index, track] of playableTracks.entries()) {
		const id = `track-${index}-${crypto.randomUUID()}`;
		const controls = Object.values(track.controlChanges).flatMap((changes) =>
			(changes ?? []).map((change) => ({
				number: change.number,
				time: change.time,
				value: change.value
			}))
		);
		if (
			!Number.isInteger(track.instrument.number) ||
			!validNumber(track.instrument.number, 0, 127)
		) {
			throw new Error('This MIDI file contains an invalid instrument assignment.');
		}
		const pitchBends = track.pitchBends.map((bend) => ({ time: bend.time, value: bend.value }));
		if (
			controls.length + pitchBends.length > 100000 ||
			controls.some(
				(control) =>
					!Number.isInteger(control.number) ||
					!validNumber(control.number, 0, 127) ||
					!validNumber(control.time, 0, 120) ||
					!validNumber(control.value, 0, 1)
			) ||
			pitchBends.some((bend) => !validNumber(bend.time, 0, 120) || !validNumber(bend.value, -1, 1))
		) {
			throw new Error('This MIDI file contains invalid or excessive controller events.');
		}
		expressionEvents += controls.length + pitchBends.length;
		for (const event of [...controls, ...pitchBends])
			duration = Math.max(duration, event.time + 1.5);
		tracks.push({
			id,
			name: (track.name.trim() || titleCase(track.instrument.name) || `Track ${index + 1}`).slice(
				0,
				160
			),
			color: trackColors[index % trackColors.length] ?? '#8c74d4',
			instrument: track.instrument.number,
			percussion: track.instrument.percussion,
			muted: false,
			controls,
			pitchBends
		});
		for (const note of track.notes) {
			if (
				!validNumber(note.time, 0, 120) ||
				!validNumber(note.duration, 0, 120) ||
				!Number.isInteger(note.midi) ||
				!validNumber(note.midi, 0, 127) ||
				!validNumber(note.velocity, 0, 1)
			) {
				throw new Error('This MIDI file contains invalid note timing.');
			}
			notes.push({
				id: crypto.randomUUID(),
				trackId: id,
				time: note.time,
				duration: Math.max(0.001, note.duration),
				midi: note.midi,
				velocity: note.velocity
			});
		}
	}
	if (duration > 120)
		throw new Error(
			'Choose a MIDI excerpt that fits within 120 seconds, including its controller events and a 1.5-second sound tail. No notes were imported.'
		);
	if (expressionEvents > 100000)
		throw new Error('This MIDI file contains more than 100,000 controller events.');
	return {
		name: (midi.name.trim() || file.name.replace(/\.(mid|midi)$/i, '')).slice(0, 160),
		bpm: midi.header.tempos[0]?.bpm ?? 120,
		duration,
		tempos,
		notes: notes.sort((a, b) => a.time - b.time),
		tracks
	};
}

export interface TImportedMidi {
	name: string;
	bpm: number;
	duration: number;
	tempos: { time: number; bpm: number }[];
	notes: TNote[];
	tracks: TTrack[];
}

export function exportMidi(project: TProject): Uint8Array {
	if (project.tracks.filter((track) => !track.percussion).length > 15) {
		throw new Error(
			'MIDI download supports up to 15 melodic tracks. Audio and video still support all tracks.'
		);
	}
	const midi = new Midi();
	midi.header.name = project.name;
	const tempos = project.tempos?.length ? project.tempos : [{ time: 0, bpm: project.bpm }];
	let previousTime = 0;
	let previousBpm = project.bpm;
	let ticks = 0;
	midi.header.tempos = [...tempos]
		.sort((a, b) => a.time - b.time)
		.map((tempo) => {
			ticks += (((tempo.time - previousTime) * previousBpm) / 60) * midi.header.ppq;
			previousTime = tempo.time;
			previousBpm = tempo.bpm;
			return { ticks: Math.round(ticks), bpm: tempo.bpm };
		});
	midi.header.update();
	let melodicIndex = 0;
	for (const projectTrack of project.tracks) {
		const track = midi.addTrack();
		track.name = projectTrack.name;
		track.channel = projectTrack.percussion ? 9 : nonDrumChannel(melodicIndex++);
		track.instrument.number = projectTrack.instrument;
		for (const note of project.notes.filter((item) => item.trackId === projectTrack.id)) {
			track.addNote({
				midi: note.midi,
				time: note.time,
				duration: note.duration,
				velocity: note.velocity
			});
		}
		for (const control of projectTrack.controls ?? []) {
			track.addCC(control);
		}
		for (const bend of projectTrack.pitchBends ?? []) {
			track.addPitchBend({
				time: bend.time,
				value: Math.max(-8192, Math.min(8191, Math.round(bend.value * 8192)))
			});
		}
	}
	return midi.toArray();
}

export function noteName(midi: number): string {
	return `${pitchNames[((Math.round(midi) % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export function getTrackInstrumentOptions(track: TTrack): TInstrumentOption[] {
	const options = track.percussion ? drumKitOptions : instrumentOptions;
	if (options.some((option) => option.value === track.instrument)) return [...options];
	const label = track.percussion
		? `MIDI drum kit ${track.instrument + 1}`
		: instrumentName(track.instrument);
	return [{ value: track.instrument, label: `${label} · imported` }, ...options];
}

const drumKitOptions = [
	{ value: 0, label: 'Standard 1 kit' },
	{ value: 1, label: 'Standard 2 kit' },
	{ value: 2, label: 'Standard 3 kit' },
	{ value: 8, label: 'Room kit' },
	{ value: 16, label: 'Power kit' },
	{ value: 24, label: 'Electronic kit' },
	{ value: 25, label: '808/909 kit' },
	{ value: 26, label: 'Dance kit' },
	{ value: 32, label: 'Jazz kit' },
	{ value: 40, label: 'Brush kit' },
	{ value: 48, label: 'Orchestral kit' },
	{ value: 56, label: 'SFX kit' },
	{ value: 127, label: 'CM-64/32L kit' }
];

const trackColors = ['#8c74d4', '#da9d55', '#5b9c88', '#689dc1', '#cd7d93', '#7f9d52'];
const pitchNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

function titleCase(value: string): string {
	return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function nonDrumChannel(index: number): number {
	const channel = index % 15;
	return channel >= 9 ? channel + 1 : channel;
}

function validNumber(value: number, min: number, max: number): boolean {
	return Number.isFinite(value) && value >= min && value <= max;
}
