/** Taps closer than a marble can strike twice merge into one hit, so a double press adds one */
export const TAP_MERGE_SECONDS = 0.05;

/**
 * Song seconds after the press that started playback in which taps record nothing, like Logic's count-in: the
 * starting press and a quick second press while the audio starts would land on hits no marble can reach
 */
export const TAP_COUNT_IN_SECONDS = 0.3;

/**
 * The time a tap at `now` records on a track with `hits`, rounded to 0.1 ms, or null when an existing hit is
 * within TAP_MERGE_SECONDS and the tap merges into it, or when it falls in the count-in before `countInEnd`
 */
export function tapTime(hits: readonly { time: number }[], now: number, countInEnd = -Infinity): number | null {
	if (now < countInEnd) return null;
	const time = Math.round(now * 10000) / 10000;
	if (hits.some((hit) => Math.abs(hit.time - time) < TAP_MERGE_SECONDS)) return null;
	return time;
}
