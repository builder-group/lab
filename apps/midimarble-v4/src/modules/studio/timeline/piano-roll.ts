import { MAX_BACKING_NOTE_LENGTH, MAX_NOTE_LENGTH } from '@/modules/music';
import { BACKING_ID, createId, type THit, type TProject, type TProjectCommand, type TSource, toHitKey } from '@/modules/project';
import { round } from './timeline-layout';

// Semitones shown above the highest and below the lowest note of the Song's piano roll
const PITCH_MARGIN = 2;

/**
 * Pitch rows of the Song's piano roll, highest first like Logic's. Null when the song cannot expand: a recording
 * is a flat waveform, whatever pitches its marbles' hits have, and a song without pitched notes has nothing to show.
 */
export function songRollRange(project: TProject, song: TSource | undefined): TPitchRange | null {
	if (song?.kind === 'audio') return null;
	const pitches = [...project.music.marbles.flatMap((marble) => marble.hits), ...project.music.backing].flatMap((hit) => (hit.pitch == null ? [] : [hit.pitch]));
	if (!pitches.length) return null;
	return { low: Math.max(0, Math.min(...pitches) - PITCH_MARGIN), high: Math.min(127, Math.max(...pitches) + PITCH_MARGIN) };
}

/** The edit a note drag makes: every dragged hit or Backing note moves in time and, in the Song's piano roll, in pitch */
export function noteDragCommands(project: TProject, drag: { keys: string[]; delta: number; pitchDelta: number }, range: TPitchRange | null): TProjectCommand[] {
	const owners = [...project.music.marbles, { id: BACKING_ID, hits: project.music.backing }];
	return owners.flatMap((owner) => {
		const moved = owner.hits
			.filter((hit) => drag.keys.includes(toHitKey(owner.id, hit.id)))
			.map((hit) => ({
				...hit,
				time: round(Math.max(0, hit.time + drag.delta)),
				pitch: hit.pitch != null && range != null && drag.pitchDelta !== 0 ? clampPitch(hit.pitch + drag.pitchDelta, range) : hit.pitch
			}));
		return moved.length ? [{ type: 'upsertHits' as const, marbleId: owner.id, hits: moved }] : [];
	});
}

/** A new note's length until one has been resized, in seconds */
export const DEFAULT_NOTE_LENGTH = 0.25;

const MIN_NOTE_LENGTH = 0.05;

// A new note only snaps to the grid when the pointer is this close to a line
const NOTE_SNAP_PIXELS = 6;
// Sixteenths of the song's tempo, or this many seconds without one
const FREE_GRID = 0.05;

/** The time a double-click adds a note at: the nearest sixteenth when the pointer is close to it, otherwise where it is */
export function snapNoteTime(time: number, bpm: number | undefined, zoom: number): number {
	const step = bpm != null && bpm > 0 ? 60 / bpm / 4 : FREE_GRID;
	const grid = Math.round(time / step) * step;
	return Math.max(0, round(Math.abs(grid - time) * zoom <= NOTE_SNAP_PIXELS ? grid : time));
}

/**
 * The edit that adds a note: a hit with a pitch in a marble's marble, so the run gets a dot for it, or a Backing note.
 * One command, so one undo step.
 */
export function addNoteCommands(ownerId: string, note: { time: number; pitch: number; duration: number }): { hit: THit; commands: TProjectCommand[] } {
	const hit: THit = { id: createId('hit'), time: round(note.time), pitch: note.pitch, duration: round(note.duration) };
	return { hit, commands: [{ type: 'upsertHits', marbleId: ownerId, hits: [hit] }] };
}

/** The longest a note of this owner can be resized to: what it can sound for */
export function maxNoteLength(ownerId: string): number {
	return ownerId === BACKING_ID ? MAX_BACKING_NOTE_LENGTH : MAX_NOTE_LENGTH;
}

/** The length a right-edge drag gives a note */
export function resizedNoteLength(ownerId: string, start: number, deltaX: number, zoom: number): number {
	return round(Math.min(maxNoteLength(ownerId), Math.max(MIN_NOTE_LENGTH, start + deltaX / zoom)));
}

export function rowCount(range: TPitchRange): number {
	return range.high - range.low + 1;
}

/** Row index of a pitch, counted from the top row */
export function pitchToRow(pitch: number, range: TPitchRange): number {
	return range.high - pitch;
}

export function clampPitch(pitch: number, range: TPitchRange): number {
	return Math.min(range.high, Math.max(range.low, pitch));
}

/** Semitones a vertical drag moves a note, up being positive */
export function pitchDeltaFor(deltaY: number, rowHeight: number): number {
	return Math.round(-deltaY / rowHeight) || 0;
}

export function isBlackKey(pitch: number): boolean {
	return [1, 3, 6, 8, 10].includes(((pitch % 12) + 12) % 12);
}

/** Notes the piano roll opens on: the song's first ones in time */
export const OPENING_NOTES = 8;

/** Space kept above the opening notes' top row, so a drag there selects notes instead of reaching the ruler */
export const OPENING_GAP = 6;

/**
 * Scroll offset the Song's piano roll opens at, taller than its track: the first notes in time with their
 * highest row just below the top edge, so the melody's opening reads at once instead of sitting under the ruler.
 * Notes are `{ time, pitch }` in any order; without pitches the roll opens at its top.
 */
export function openingRollOffset(notes: readonly { time: number; pitch?: number | null }[], range: TPitchRange, rowHeight: number, viewHeight: number): number {
	const maxOffset = Math.max(0, rowCount(range) * rowHeight - viewHeight);
	const opening = notes
		.filter((note): note is { time: number; pitch: number } => note.pitch != null)
		.sort((a, b) => a.time - b.time)
		.slice(0, OPENING_NOTES);
	if (!opening.length) return 0;
	const high = Math.max(...opening.map((note) => note.pitch));
	const top = pitchToRow(clampPitch(high, range), range) * rowHeight - OPENING_GAP;
	return Math.min(maxOffset, Math.max(0, top));
}

export interface TPitchRange {
	low: number;
	high: number;
}
