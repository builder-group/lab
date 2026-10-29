import type { TNote } from '../project';
import { snapTimelineTime, timelineSnapStep, type TTimelineSnap } from './timeline-editing';

/** Returns a padded, chromatic range that contains every note without compressing semitones. */
export function getPianoPitchRange(notes: Pick<TNote, 'midi'>[]): TPianoPitchRange {
	if (!notes.length) return { minPitch: 48, maxPitch: 72 };
	const low = Math.min(...notes.map((note) => note.midi));
	const high = Math.max(...notes.map((note) => note.midi));
	const count = Math.min(128, Math.max(25, high - low + 7));
	const minPitch = Math.max(0, Math.min(128 - count, Math.floor((low + high - count + 1) / 2)));
	return { minPitch, maxPitch: minPitch + count - 1 };
}

export interface TPianoPitchRange {
	minPitch: number;
	maxPitch: number;
}

/** Fits a pitch span with one semitone of breathing room while keeping every MIDI row reachable. */
export function fitPianoPitchView(
	notes: readonly Pick<TNote, 'midi'>[],
	range: TPianoPitchRange,
	viewportHeight: number
): TPianoPitchView {
	const pitches = notes.length > 0 ? notes.map((note) => note.midi) : [60];
	const low = Math.max(range.minPitch, Math.min(...pitches));
	const high = Math.min(range.maxPitch, Math.max(...pitches));
	const rowHeight =
		notes.length > 0
			? Math.max(4, Math.min(24, Math.floor(viewportHeight / (high - low + 3))))
			: 14;
	const center = pianoPitchTop((low + high) / 2, range, rowHeight) + rowHeight / 2;
	const maximumScroll = Math.max(
		0,
		(range.maxPitch - range.minPitch + 1) * rowHeight - viewportHeight
	);
	return {
		rowHeight,
		scrollTop: Math.max(0, Math.min(maximumScroll, center - viewportHeight / 2))
	};
}

export interface TPianoPitchView {
	rowHeight: number;
	scrollTop: number;
}

/** Keeps the same pitch under a viewport anchor when semitone rows change height. */
export function pianoPitchZoomAnchor(
	scrollTop: number,
	viewportY: number,
	previousRowHeight: number,
	nextRowHeight: number
): number {
	return Math.max(0, ((scrollTop + viewportY) / previousRowHeight) * nextRowHeight - viewportY);
}

export function pianoPitchTop(midi: number, range: TPianoPitchRange, rowHeight: number): number {
	return (range.maxPitch - midi) * rowHeight;
}

export function pianoPitchAtY(y: number, range: TPianoPitchRange, rowHeight: number): number {
	return Math.max(
		range.minPitch,
		Math.min(range.maxPitch, range.maxPitch - Math.floor(y / rowHeight))
	);
}

/** Selects notes touched by a box in grid coordinates, including sustained notes and short clips. */
export function getPianoMarquee(
	notes: readonly TNote[],
	start: { x: number; y: number },
	end: { x: number; y: number },
	range: TPianoPitchRange,
	rowHeight: number,
	zoom: number
): TPianoMarquee {
	const left = Math.min(start.x, end.x);
	const right = Math.max(start.x, end.x);
	const top = Math.min(start.y, end.y);
	const bottom = Math.max(start.y, end.y);
	const ids = notes
		.filter((note) => {
			const noteLeft = note.time * zoom;
			const noteTop = pianoPitchTop(note.midi, range, rowHeight) + 1;
			return (
				noteLeft < right &&
				noteLeft + Math.max(8, note.duration * zoom) > left &&
				noteTop < bottom &&
				noteTop + rowHeight - 2 > top
			);
		})
		.map((note) => note.id);
	return { left, top, width: right - left, height: bottom - top, ids };
}

export interface TPianoMarquee {
	left: number;
	top: number;
	width: number;
	height: number;
	ids: string[];
}

export function isPianoBlackKey(midi: number): boolean {
	return [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
}

/** Pencil gestures work in either direction and commit a single, bounded musical note. */
export function drawPianoNote(
	start: number,
	end: number,
	duration: number,
	snap: TTimelineSnap,
	defaultLength: number
): Pick<TNote, 'time' | 'duration'> {
	const minimum = Math.min(duration, 1 / Math.max(1, snap.fps));
	const snappedStart = Math.max(0, Math.min(duration - minimum, snapTimelineTime(start, snap)));
	const snappedEnd = Math.max(0, Math.min(duration, snapTimelineTime(end, snap)));
	const time = Math.max(0, Math.min(duration - minimum, Math.min(snappedStart, snappedEnd)));
	const length =
		Math.abs(snappedEnd - snappedStart) < minimum
			? defaultLength
			: Math.abs(snappedEnd - snappedStart);
	return { time, duration: Math.max(minimum, Math.min(duration - time, length)) };
}

export function editPianoVelocity(initial: number, deltaY: number, laneHeight: number): number {
	return Math.max(
		1 / 127,
		Math.min(1, Math.round((initial - deltaY / Math.max(1, laneHeight)) * 127) / 127)
	);
}

/** Moves a phrase by one bounded delta, preserving its timing and pitch intervals. */
export function movePianoNotes(
	notes: readonly TNote[],
	timeDelta: number,
	pitchDelta: number,
	duration: number,
	snap: TTimelineSnap,
	anchorId?: string
): TPianoNoteMove[] {
	const anchor = notes.find((note) => note.id === anchorId) ?? notes[0];
	if (anchor == null) return [];
	const snappedDelta =
		timeDelta === 0 ? 0 : snapTimelineTime(anchor.time + timeDelta, snap) - anchor.time;
	const delta = Math.max(
		-Math.min(...notes.map((note) => note.time)),
		Math.min(duration - Math.max(...notes.map((note) => note.time + note.duration)), snappedDelta)
	);
	const semitones = Math.max(
		-Math.min(...notes.map((note) => note.midi)),
		Math.min(127 - Math.max(...notes.map((note) => note.midi)), Math.round(pitchDelta))
	);
	return notes.map((note) => ({
		id: note.id,
		patch: { time: note.time + delta, midi: note.midi + semitones, duration: note.duration }
	}));
}

export interface TPianoNoteMove {
	id: string;
	patch: Pick<TNote, 'time' | 'midi' | 'duration'>;
}

/** Places a copy after the complete phrase; project bounds are validated atomically on add. */
export function duplicatePianoNotes(notes: readonly TNote[], snap: TTimelineSnap): TNote[] {
	if (!notes.length) return [];
	const start = Math.min(...notes.map((note) => note.time));
	const end = Math.max(...notes.map((note) => note.time + note.duration));
	const step = timelineSnapStep(snap);
	const nextStart = step === 0 ? end : Math.ceil(end / step) * step;
	return notes.map((note) => ({
		...note,
		id: crypto.randomUUID(),
		time: note.time + nextStart - start
	}));
}

/** Keeps beat labels legible while subdivisions stay locked to the project grid tempo. */
export function pianoBeatTickStep(zoom: number, bpm: number): number {
	const beat = 60 / Math.max(1, bpm);
	return ([1, 2, 4, 8, 16, 32, 64].find((count) => count * beat * zoom >= 60) ?? 64) * beat;
}
