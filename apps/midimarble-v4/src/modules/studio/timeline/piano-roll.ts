import type { TLane } from '@/modules/project';

// Semitones shown above the highest and below the lowest note of an expanded track
export const PITCH_MARGIN = 2;

/** Pitch rows of an expanded track, highest first like Logic's piano roll; null for tracks without pitches */
export function pitchRange(lane: TLane): TPitchRange | null {
	let low = Number.POSITIVE_INFINITY;
	let high = Number.NEGATIVE_INFINITY;
	for (const hit of lane.hits) {
		if (hit.pitch == null) continue;
		low = Math.min(low, hit.pitch);
		high = Math.max(high, hit.pitch);
	}
	if (!Number.isFinite(low)) return null;
	return { low: Math.max(0, low - PITCH_MARGIN), high: Math.min(127, high + PITCH_MARGIN) };
}

/** Whether a track can expand into a piano roll: tap-along tracks on a recording have no pitches */
export function hasPitches(lane: TLane): boolean {
	return lane.hits.some((hit) => hit.pitch != null);
}

export function rowCount(range: TPitchRange): number {
	return range.high - range.low + 1;
}

/** Row index of a pitch, counted from the top row */
export function pitchToRow(pitch: number, range: TPitchRange): number {
	return range.high - pitch;
}

/** Pitch under a y offset within the piano roll, clamped to its rows */
export function rowToPitch(y: number, range: TPitchRange, rowHeight: number): number {
	const row = Math.floor(y / rowHeight);
	return clampPitch(range.high - row, range);
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
 * Scroll offset an expanded piano roll opens at, taller than its track: the first notes in time with their
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
