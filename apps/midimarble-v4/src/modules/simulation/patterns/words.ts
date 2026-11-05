/** "1.21 s" */
export function formatSeconds(seconds: number): string {
	return `${seconds.toFixed(2)} s`;
}

/** "0:09": where a note is in the song */
export function wordsForHitTime(time: number): string {
	const whole = Math.max(0, Math.round(time));
	return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
