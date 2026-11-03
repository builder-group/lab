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
