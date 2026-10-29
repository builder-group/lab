import type { TNote } from '../project';
import { snapTimelineTime, type TTimelineSnap } from './timeline-editing';

/** Copies musical values only; pasted notes never carry scene bindings or source identities. */
export function serializePianoClipboard(notes: readonly TNote[]): string | null {
	if (!notes.length || notes.length > MAX_NOTES) return null;
	const start = Math.min(...notes.map((note) => note.time));
	const phrase = notes.map(({ time, duration, midi, velocity }) => ({
		time: time - start,
		duration,
		midi,
		velocity
	}));
	if (!phrase.every(validClipboardNote)) return null;
	const text = PREFIX + JSON.stringify({ version: 1, notes: phrase });
	return text.length <= MAX_TEXT_LENGTH ? text : null;
}

/** Foreign clipboard content stays native; malformed MidiMarble data gets explicit feedback. */
export function parsePianoClipboard(text: string): TPianoClipboardResult {
	if (!text.startsWith(PREFIX)) return { kind: 'foreign' };
	if (text.length > MAX_TEXT_LENGTH) return { kind: 'invalid' };
	try {
		const data: unknown = JSON.parse(text.slice(PREFIX.length));
		if (data == null || typeof data !== 'object') return { kind: 'invalid' };
		const payload = data as Record<string, unknown>;
		const notes = payload['notes'];
		if (
			payload['version'] !== 1 ||
			!Array.isArray(notes) ||
			!notes.length ||
			notes.length > MAX_NOTES ||
			!notes.every(validClipboardNote) ||
			!notes.some((note) => note.time === 0)
		)
			return { kind: 'invalid' };
		return {
			kind: 'notes',
			notes: notes.map(({ time, duration, midi, velocity }) => ({ time, duration, midi, velocity }))
		};
	} catch {
		return { kind: 'invalid' };
	}
}

export type TPianoClipboardResult =
	{ kind: 'foreign' } | { kind: 'invalid' } | { kind: 'notes'; notes: TPianoClipboardNote[] };

/** Snaps the phrase anchor once, preserving every internal onset and duration. */
export function pastePianoNotes(
	notes: readonly TPianoClipboardNote[],
	trackId: string,
	time: number,
	snap: TTimelineSnap
): TNote[] {
	const start = snapTimelineTime(time, snap);
	return notes.map(({ time: offset, duration, midi, velocity }) => ({
		id: crypto.randomUUID(),
		trackId,
		time: start + offset,
		duration,
		midi,
		velocity
	}));
}

interface TPianoClipboardNote {
	time: number;
	duration: number;
	midi: number;
	velocity: number;
}

function validClipboardNote(value: unknown): value is TPianoClipboardNote {
	if (value == null || typeof value !== 'object') return false;
	const note = value as Record<string, unknown>;
	const { time, duration, midi, velocity } = note;
	return (
		typeof time === 'number' &&
		Number.isFinite(time) &&
		time >= 0 &&
		typeof duration === 'number' &&
		Number.isFinite(duration) &&
		duration >= 0.001 &&
		time + duration <= 120 + 1e-9 &&
		typeof midi === 'number' &&
		Number.isInteger(midi) &&
		midi >= 0 &&
		midi <= 127 &&
		typeof velocity === 'number' &&
		Number.isFinite(velocity) &&
		velocity >= 0 &&
		velocity <= 1
	);
}

const PREFIX = 'MidiMarble piano\n';
const MAX_NOTES = 2000;
const MAX_TEXT_LENGTH = 512_000;
