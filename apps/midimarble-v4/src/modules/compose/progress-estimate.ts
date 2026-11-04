/**
 * "about 10 s left" for a long task such as Re-place, like Finder's copy progress: the time left at the rate so
 * far, smoothed so it does not jump with every step. Nothing is said until the rate is known, and the figure
 * never grows by more than its rounding between two updates.
 */
export function createEstimate(): { update: (elapsedMs: number, fraction: number) => string } {
	let smoothed: number | null = null;
	return {
		update(elapsedMs, fraction) {
			const left = estimateLeft(elapsedMs, fraction);
			if (left == null) return '';
			smoothed = smoothed == null ? left : smoothed + SMOOTHING * (left - smoothed);
			return leftWords(smoothed);
		}
	};
}

/** Seconds left at the rate so far, or null before `MIN_ELAPSED_MS` and `MIN_FRACTION` of the work */
export function estimateLeft(elapsedMs: number, fraction: number): number | null {
	if (elapsedMs < MIN_ELAPSED_MS || fraction < MIN_FRACTION || fraction >= 1) return null;
	return ((elapsedMs / 1000) * (1 - fraction)) / fraction;
}

/** "a few seconds left", "about 8 s left", "about 25 s left", "about 2 min left" */
export function leftWords(seconds: number): string {
	if (seconds < 5) return 'a few seconds left';
	if (seconds < 15) return `about ${Math.round(seconds)} s left`;
	if (seconds < 90) return `about ${Math.round(seconds / 5) * 5} s left`;
	return `about ${Math.round(seconds / 60)} min left`;
}

// The first steps say little about the rate
const MIN_ELAPSED_MS = 1500;
const MIN_FRACTION = 0.05;
const SMOOTHING = 0.3;
