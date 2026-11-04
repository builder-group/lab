/**
 * "about 10 s left" for a long task such as Fix Hits, like Finder's copy progress. Finder waits before it names a
 * time and then counts down steadily; this does the same:
 *
 * - Nothing is said until `MIN_STEPS` steps are done, `MIN_ELAPSED_MS` have passed and `MIN_FRACTION` of the work,
 *   and two raw figures in a row agree within `MAX_FIRST_CHANGE`, so the first figure is not a guess
 * - The raw figure is the smaller of the rate by work (`fraction`) and the rate by steps (`done` of `total`), so
 *   one slow first step cannot promise five times the real time
 * - The shown figure counts down with the clock and moves toward the raw figure by `SMOOTHING` per update. It
 *   never rises, and falls no faster than `MAX_FALL_RATE` seconds per second, so it never jumps from 45 s to a few
 *   seconds
 */
export function createEstimate(): TEstimate {
	let lastRaw: number | null = null;
	let shown: { seconds: number; at: number } | null = null;
	return {
		update(elapsedMs, fraction, done = 0, total = 0) {
			const raw = estimateLeft(elapsedMs, fraction, done, total);
			if (raw == null) return '';
			if (shown == null) {
				const previous = lastRaw;
				lastRaw = raw;
				if (done < Math.min(MIN_STEPS, total) || previous == null || Math.abs(raw - previous) > MAX_FIRST_CHANGE * Math.max(previous, 1)) return '';
				shown = { seconds: raw, at: elapsedMs };
				return leftWords(raw);
			}
			const passed = Math.max(0, (elapsedMs - shown.at) / 1000);
			const counted = Math.max(0, shown.seconds - passed);
			const target = counted + SMOOTHING * (raw - counted);
			const seconds = Math.max(shown.seconds - passed * MAX_FALL_RATE, Math.min(counted, target));
			shown = { seconds: Math.max(0, seconds), at: elapsedMs };
			return leftWords(shown.seconds);
		}
	};
}

export interface TEstimate {
	/** The words for the time left after `elapsedMs`, with `fraction` (0 to 1) of the work and `done` of `total` steps done */
	update: (elapsedMs: number, fraction: number, done?: number, total?: number) => string;
}

/**
 * Seconds left at the rate so far, or null before `MIN_ELAPSED_MS` and `MIN_FRACTION` of the work. With steps, never
 * more than the time per step so far for each step left.
 */
export function estimateLeft(elapsedMs: number, fraction: number, done = 0, total = 0): number | null {
	if (elapsedMs < MIN_ELAPSED_MS || fraction < MIN_FRACTION || fraction >= 1) return null;
	const seconds = elapsedMs / 1000;
	const byWork = (seconds * (1 - fraction)) / fraction;
	const bySteps = done > 0 && total > done ? (seconds / done) * (total - done) : Infinity;
	return Math.min(byWork, bySteps);
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
const MIN_STEPS = 3;
const MAX_FIRST_CHANGE = 0.3;
const SMOOTHING = 0.3;
const MAX_FALL_RATE = 3;
