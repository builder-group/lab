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

export interface TPitchRange {
	low: number;
	high: number;
}
