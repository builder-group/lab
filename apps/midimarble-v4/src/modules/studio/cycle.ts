// Cycle, like Logic's: a range on the ruler that playback loops, to rehearse one spot. It is a preview only: view
// state for this session, never saved in the project and unrelated to Seamless Loop, which shapes the film.

export interface TCycle {
	projectId: string;
	isOn: boolean;
	start: number;
	end: number;
}

export interface TCycleRange {
	start: number;
	end: number;
}

/** How a drag on the ruler's cycle strip changes the range */
export type TCycleDrag = { mode: 'new'; anchor: number } | { mode: 'start' | 'end'; range: TCycleRange } | { mode: 'move'; range: TCycleRange; grabbedAt: number };

const MIN_CYCLE_LENGTH = 0.25;
const DEFAULT_CYCLE_LENGTH = 4;
const GRID = 0.05;

function toGrid(time: number): number {
	return Math.round(time / GRID) * GRID;
}

/** The range between two times, in order, on a 0.05 s grid, inside the project and at least 0.25 s long */
export function cycleRange(a: number, b: number, projectEnd: number): TCycleRange {
	const limit = Math.max(projectEnd, MIN_CYCLE_LENGTH);
	const start = Math.min(limit, Math.max(0, toGrid(Math.min(a, b))));
	const end = Math.min(limit, Math.max(0, toGrid(Math.max(a, b))));
	if (end - start >= MIN_CYCLE_LENGTH) return { start, end };
	return start + MIN_CYCLE_LENGTH <= limit ? { start, end: start + MIN_CYCLE_LENGTH } : { start: limit - MIN_CYCLE_LENGTH, end: limit };
}

/** The range a drag on the cycle strip has reached at `time` */
export function draggedCycleRange(drag: TCycleDrag, time: number, projectEnd: number): TCycleRange {
	switch (drag.mode) {
		case 'new':
			return cycleRange(drag.anchor, time, projectEnd);
		case 'start':
			return cycleRange(time, drag.range.end, projectEnd);
		case 'end':
			return cycleRange(drag.range.start, time, projectEnd);
		case 'move': {
			const length = drag.range.end - drag.range.start;
			const start = Math.max(0, Math.min(Math.max(0, projectEnd - length), toGrid(drag.range.start + time - drag.grabbedAt)));
			return { start, end: start + length };
		}
	}
}

/** The project's cycle range, on or off, kept inside its length; null without one or for another project's */
export function shownCycle(cycle: TCycle | null, projectId: string | undefined, projectEnd: number): (TCycleRange & { isOn: boolean }) | null {
	if (cycle == null || cycle.projectId !== projectId) return null;
	return { ...cycleRange(cycle.start, cycle.end, projectEnd), isOn: cycle.isOn };
}

/** C: Cycle on or off. Without a range yet it starts with the 4 s from the playhead, or the last 4 s near the end. */
export function toggledCycle(cycle: TCycle | null, projectId: string, projectEnd: number, playhead: number): TCycle {
	if (cycle?.projectId === projectId) return { ...cycle, isOn: !cycle.isOn };
	const start = Math.max(0, Math.min(playhead, projectEnd - DEFAULT_CYCLE_LENGTH));
	return { projectId, isOn: true, ...cycleRange(start, start + DEFAULT_CYCLE_LENGTH, projectEnd) };
}

/** The time playback jumps back to once it reaches the range's end; null while it plays on */
export function cycleRestart(time: number, range: TCycleRange | null): number | null {
	return range != null && time >= range.end ? range.start : null;
}

/** Where Play starts with Cycle on: at the playhead inside the range, else at the range's start, so it loops at once */
export function cyclePlayFrom(playhead: number, range: TCycleRange | null): number {
	return range != null && (playhead < range.start || playhead >= range.end) ? range.start : playhead;
}
