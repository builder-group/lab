import type { TNote } from '../project';

/** Highlights held MIDI keys; sustain keeps sounding after a key is released. */
export function getPlayingPitches(notes: readonly TNote[], time: number): Set<number> {
	return new Set(
		notes
			.filter((note) => note.velocity > 0 && time >= note.time && time < note.time + note.duration)
			.map((note) => note.midi)
	);
}
