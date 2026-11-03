/** Formats seconds as `m:ss.cc`, like the Logic time display */
export function formatTime(seconds: number): string {
	const safe = Math.max(0, seconds);
	const minutes = Math.floor(safe / 60);
	const rest = safe - minutes * 60;
	return `${minutes}:${rest.toFixed(2).padStart(5, '0')}`;
}

export const noteNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export function noteName(pitch: number): string {
	return `${noteNames[pitch % 12] ?? 'C'}${Math.floor(pitch / 12) - 1}`;
}

/** Parses names like `C5`, `F#4`, `Bb3` or a MIDI number; empty clears the pitch, invalid returns undefined */
export function parseNoteName(value: string): number | null | undefined {
	const text = value.trim();
	if (!text.length) return null;
	if (/^\d+$/.test(text)) {
		const number = Number(text);
		return number >= 0 && number <= 127 ? number : undefined;
	}
	const match = /^([A-Ga-g])([#♯b♭]?)(-?\d)$/.exec(text);
	if (match == null) return undefined;
	const base = noteNames.indexOf((match[1] ?? '').toUpperCase());
	const accidental = match[2] === '#' || match[2] === '♯' ? 1 : match[2] === 'b' || match[2] === '♭' ? -1 : 0;
	const pitch = base + accidental + (Number(match[3]) + 1) * 12;
	return pitch < 0 || pitch > 127 ? undefined : pitch;
}

/** Moves a pitch by `semitones`, kept inside the MIDI range */
export function stepPitch(pitch: number, semitones: number): number {
	return Math.min(127, Math.max(0, pitch + semitones));
}
