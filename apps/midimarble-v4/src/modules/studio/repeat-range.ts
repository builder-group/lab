// Repeat Range, like Logic's cycle: a range on the ruler that playback loops, to rehearse one spot. It is a preview only: view
// state for this session, never saved in the project and unrelated to Seamless Loop, which shapes the film.

export interface TRepeatRange {
	projectId: string;
	isOn: boolean;
	start: number;
	end: number;
}

export interface TRepeatSpan {
	start: number;
	end: number;
}

/** How a drag on the ruler's repeat strip changes the range */
export type TRepeatRangeDrag = { mode: 'new'; anchor: number } | { mode: 'start' | 'end'; range: TRepeatSpan } | { mode: 'move'; range: TRepeatSpan; grabbedAt: number };

const MIN_REPEAT_LENGTH = 0.25;
const DEFAULT_REPEAT_LENGTH = 4;
const GRID = 0.05;

function toGrid(time: number): number {
	return Math.round(time / GRID) * GRID;
}

/** The range between two times, in order, on a 0.05 s grid, inside the project and at least 0.25 s long */
export function repeatSpan(a: number, b: number, projectEnd: number): TRepeatSpan {
	const limit = Math.max(projectEnd, MIN_REPEAT_LENGTH);
	const start = Math.min(limit, Math.max(0, toGrid(Math.min(a, b))));
	const end = Math.min(limit, Math.max(0, toGrid(Math.max(a, b))));
	if (end - start >= MIN_REPEAT_LENGTH) return { start, end };
	return start + MIN_REPEAT_LENGTH <= limit ? { start, end: start + MIN_REPEAT_LENGTH } : { start: limit - MIN_REPEAT_LENGTH, end: limit };
}

/** The range a drag on the repeat strip has reached at `time` */
export function draggedRepeatSpan(drag: TRepeatRangeDrag, time: number, projectEnd: number): TRepeatSpan {
	switch (drag.mode) {
		case 'new':
			return repeatSpan(drag.anchor, time, projectEnd);
		case 'start':
			return repeatSpan(time, drag.range.end, projectEnd);
		case 'end':
			return repeatSpan(drag.range.start, time, projectEnd);
		case 'move': {
			const length = drag.range.end - drag.range.start;
			const start = Math.max(0, Math.min(Math.max(0, projectEnd - length), toGrid(drag.range.start + time - drag.grabbedAt)));
			return { start, end: start + length };
		}
	}
}

/** The project's Repeat Range, on or off, kept inside its length; null without one or for another project's */
export function shownRepeatRange(range: TRepeatRange | null, projectId: string | undefined, projectEnd: number): (TRepeatSpan & { isOn: boolean }) | null {
	if (range == null || range.projectId !== projectId) return null;
	return { ...repeatSpan(range.start, range.end, projectEnd), isOn: range.isOn };
}

/** C: Repeat Range on or off. Without a range yet it starts with the 4 s from the playhead, or the last 4 s near the end. */
export function toggledRepeatRange(range: TRepeatRange | null, projectId: string, projectEnd: number, playhead: number): TRepeatRange {
	if (range?.projectId === projectId) return { ...range, isOn: !range.isOn };
	const start = Math.max(0, Math.min(playhead, projectEnd - DEFAULT_REPEAT_LENGTH));
	return { projectId, isOn: true, ...repeatSpan(start, start + DEFAULT_REPEAT_LENGTH, projectEnd) };
}

/** The time playback jumps back to once it reaches the range's end; null while it plays on */
export function repeatRestart(time: number, range: TRepeatSpan | null): number | null {
	return range != null && time >= range.end ? range.start : null;
}

/** Where Play starts with Repeat Range on: at the playhead inside the range, else at the range's start, so it loops at once */
export function repeatPlayFrom(playhead: number, range: TRepeatSpan | null): number {
	return range != null && (playhead < range.start || playhead >= range.end) ? range.start : playhead;
}
