/** Taps closer than a marble can strike twice merge into one hit, so a double press adds one */
export const TAP_MERGE_SECONDS = 0.05;

/**
 * The time a tap at `now` records on a track with `hits`, rounded to 0.1 ms, or null when an existing hit is
 * within TAP_MERGE_SECONDS and the tap merges into it
 */
export function tapTime(hits: readonly { time: number }[], now: number): number | null {
	const time = Math.round(now * 10000) / 10000;
	if (hits.some((hit) => Math.abs(hit.time - time) < TAP_MERGE_SECONDS)) return null;
	return time;
}
