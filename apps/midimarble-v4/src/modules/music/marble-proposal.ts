import type { TMidiNote } from './midi';

/** Shortest gap a marble can play between two strikes */
export const MIN_HIT_GAP = 0.18;

// Notes closer than this are treated as one chord
const CHORD_WINDOW = 0.03;

/**
 * Assigns notes to marbles. A marble plays one note at a time with at least `minGap` between strikes,
 * so chords spread across marbles or keep only their top note. Notes no marble can play become Backing.
 */
export function proposeMarbles(notes: TMidiNote[], options: TProposeMarblesOptions = {}): TMarbleProposal {
	const { strategy = 'split', maxMarbles = 4, minGap = MIN_HIT_GAP } = options;
	const chords = groupChords(notes);
	const marbles: TMidiNote[][] = [];
	const backing: TBackingNote[] = [];

	for (const chord of chords) {
		const candidates = strategy === 'melody' ? chord.slice(0, 1) : chord;
		if (strategy === 'melody') {
			for (const note of chord.slice(1)) backing.push({ note, reason: 'chord' });
		}
		const used = new Set<number>();
		for (const note of candidates) {
			const marbleIndex = chooseMarble(marbles, note, used, minGap);
			if (marbleIndex != null) {
				marbles[marbleIndex]?.push(note);
				used.add(marbleIndex);
				continue;
			}
			if (marbles.length < (strategy === 'melody' ? 1 : maxMarbles)) {
				marbles.push([note]);
				used.add(marbles.length - 1);
				continue;
			}
			backing.push({ note, reason: candidates.length > 1 && strategy === 'split' ? 'tooManyVoices' : 'tooClose' });
		}
	}

	return { marbles, backing };
}

/** Whether how chords spread is a question for these tracks: one of them plays chords, or there are more than marbles */
export function asksAboutChords(tracks: readonly { notes: readonly TMidiNote[] }[], maxMarbles = 4): boolean {
	return tracks.length > maxMarbles || tracks.some((track) => groupChords([...track.notes]).some((chord) => chord.length > 1));
}

/**
 * Names the proposed marbles after the MIDI tracks most of their notes come from: "Melody", "Bass". Null where a track
 * has no name in the file or two marbles would share it, which keeps "Marble 1".
 */
export function marbleNamesFromTracks(marbles: readonly (readonly TMidiNote[])[], tracks: readonly { name: string; hasName: boolean; notes: readonly TMidiNote[] }[]): (string | null)[] {
	const trackOf = new Map(tracks.flatMap((track) => track.notes.map((note) => [note, track] as const)));
	const names = marbles.map((notes) => {
		const counts = new Map<(typeof tracks)[number], number>();
		for (const note of notes) {
			const track = trackOf.get(note);
			if (track != null) counts.set(track, (counts.get(track) ?? 0) + 1);
		}
		const [top] = [...counts].sort((a, b) => b[1] - a[1]);
		return top?.[0].hasName === true ? top[0].name : null;
	});
	return names.map((name) => (name != null && names.filter((item) => item === name).length === 1 ? name : null));
}

export interface TProposeMarblesOptions {
	strategy?: 'split' | 'melody';
	maxMarbles?: number;
	minGap?: number;
}

export interface TMarbleProposal {
	marbles: TMidiNote[][];
	backing: TBackingNote[];
}

/** A note left to Backing, with why no marble plays it */
export interface TBackingNote {
	note: TMidiNote;
	reason: 'chord' | 'tooClose' | 'tooManyVoices';
}

/** Moves all notes so the first one starts at `start`, keeping every interval */
export function alignNotes(notes: TMidiNote[], start: number): TMidiNote[] {
	const first = notes.reduce((min, note) => Math.min(min, note.time), Number.POSITIVE_INFINITY);
	if (!Number.isFinite(first)) return notes;
	return notes.map((note) => ({ ...note, time: note.time - first + start }));
}

function groupChords(notes: TMidiNote[]): TMidiNote[][] {
	const sorted = [...notes].sort((a, b) => a.time - b.time || b.pitch - a.pitch);
	const chords: TMidiNote[][] = [];
	for (const note of sorted) {
		const chord = chords[chords.length - 1];
		const head = chord?.[0];
		if (chord != null && head != null && note.time - head.time <= CHORD_WINDOW) chord.push(note);
		else chords.push([note]);
	}
	// Highest note first so the melody stays on the first marble
	return chords.map((chord) => chord.sort((a, b) => b.pitch - a.pitch));
}

/** Picks the free marble whose last pitch is closest, which keeps voices smooth */
function chooseMarble(marbles: TMidiNote[][], note: TMidiNote, used: Set<number>, minGap: number): number | null {
	let best: number | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const [index, marble] of marbles.entries()) {
		if (used.has(index)) continue;
		const last = marble[marble.length - 1];
		if (last != null && note.time - last.time < minGap - 1e-9) continue;
		const distance = last == null ? 0 : Math.abs(last.pitch - note.pitch) + index * 0.01;
		if (distance < bestDistance) {
			best = index;
			bestDistance = distance;
		}
	}
	return best;
}
