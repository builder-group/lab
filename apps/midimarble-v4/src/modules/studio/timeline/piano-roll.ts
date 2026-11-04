import { BACKING_ID, type TProject, type TProjectCommand, type TSource } from '@/modules/project';
import { toHitKey } from '../selection';
import { round } from './timeline-layout';

// Semitones shown above the highest and below the lowest note of the Song's piano roll
const PITCH_MARGIN = 2;

/**
 * Pitch rows of the Song's piano roll, highest first like Logic's. Null when the song cannot expand: a recording
 * is a flat waveform, whatever pitches its marbles' hits have, and a song without pitched notes has nothing to show.
 */
export function songRollRange(project: TProject, song: TSource | undefined): TPitchRange | null {
	if (song?.kind === 'audio') return null;
	const pitches = [...project.music.lanes.flatMap((lane) => lane.hits), ...project.music.backing].flatMap((hit) => (hit.pitch == null ? [] : [hit.pitch]));
	if (!pitches.length) return null;
	return { low: Math.max(0, Math.min(...pitches) - PITCH_MARGIN), high: Math.min(127, Math.max(...pitches) + PITCH_MARGIN) };
}

/** The edit a note drag makes: every dragged hit or Backing note moves in time and, in the Song's piano roll, in pitch */
export function noteDragCommands(project: TProject, drag: { keys: string[]; delta: number; pitchDelta: number }, range: TPitchRange | null): TProjectCommand[] {
	const owners = [...project.music.lanes, { id: BACKING_ID, hits: project.music.backing }];
	return owners.flatMap((owner) => {
		const moved = owner.hits
			.filter((hit) => drag.keys.includes(toHitKey(owner.id, hit.id)))
			.map((hit) => ({
				...hit,
				time: round(Math.max(0, hit.time + drag.delta)),
				pitch: hit.pitch != null && range != null && drag.pitchDelta !== 0 ? clampPitch(hit.pitch + drag.pitchDelta, range) : hit.pitch
			}));
		return moved.length ? [{ type: 'upsertHits' as const, laneId: owner.id, hits: moved }] : [];
	});
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
