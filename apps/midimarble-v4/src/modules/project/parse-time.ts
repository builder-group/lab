/**
 * Reads a typed time like the Logic LCD accepts it: `m:ss.cc`, `m:ss` or plain seconds. Returns null
 * for text that is not a time.
 */
export function parseTime(text: string): number | null {
	const value = text.trim().replace(',', '.');
	if (!value.length) return null;
	const match = /^(?:(\d+):)?(\d+(?:\.\d*)?|\.\d+)$/.exec(value);
	if (match == null) return null;
	const minutes = match[1] == null ? 0 : Number(match[1]);
	const seconds = Number(match[2]);
	// After a colon the seconds stay below a minute, as in 1:75 being a typo rather than 2:15
	if (match[1] != null && seconds >= 60) return null;
	const time = minutes * 60 + seconds;
	return Number.isFinite(time) ? time : null;
}
