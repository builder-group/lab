/** Formats seconds as `m:ss.cc`, like the Logic time display */
export function formatTime(seconds: number): string {
	const safe = Math.max(0, seconds);
	const minutes = Math.floor(safe / 60);
	const rest = safe - minutes * 60;
	return `${minutes}:${rest.toFixed(2).padStart(5, '0')}`;
}
