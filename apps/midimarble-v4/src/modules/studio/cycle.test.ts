import { describe, expect, it } from 'vitest';
import { cyclePlayFrom, cycleRange, cycleRestart, draggedCycleRange, shownCycle, toggledCycle, type TCycle } from './cycle';

describe('cycleRange', () => {
	it('should order the times, keep them inside the project and snap to the grid', () => {
		expect(cycleRange(5.02, 2.01, 10)).toEqual({ start: 2, end: 5 });
		expect(cycleRange(-3, 40, 10)).toEqual({ start: 0, end: 10 });
	});

	it('should keep a range long enough to loop, even at the end of the project', () => {
		expect(cycleRange(3, 3, 10)).toEqual({ start: 3, end: 3.25 });
		expect(cycleRange(10, 10, 10)).toEqual({ start: 9.75, end: 10 });
	});
});

describe('draggedCycleRange', () => {
	it('should draw a new range from where the drag began, either way', () => {
		expect(draggedCycleRange({ mode: 'new', anchor: 4 }, 6, 10)).toEqual({ start: 4, end: 6 });
		expect(draggedCycleRange({ mode: 'new', anchor: 4 }, 1, 10)).toEqual({ start: 1, end: 4 });
	});

	it('should move one edge, or the whole range inside the project', () => {
		const range = { start: 2, end: 5 };
		expect(draggedCycleRange({ mode: 'start', range }, 3, 10)).toEqual({ start: 3, end: 5 });
		expect(draggedCycleRange({ mode: 'end', range }, 7, 10)).toEqual({ start: 2, end: 7 });
		expect(draggedCycleRange({ mode: 'move', range, grabbedAt: 3 }, 4, 10)).toEqual({ start: 3, end: 6 });
		expect(draggedCycleRange({ mode: 'move', range, grabbedAt: 3 }, 30, 10)).toEqual({ start: 7, end: 10 });
		expect(draggedCycleRange({ mode: 'move', range, grabbedAt: 3 }, -30, 10)).toEqual({ start: 0, end: 3 });
	});
});

describe('toggledCycle', () => {
	it('should start with 4 s from the playhead, or the last 4 s near the end', () => {
		expect(toggledCycle(null, 'p', 20, 3)).toEqual({ projectId: 'p', isOn: true, start: 3, end: 7 });
		expect(toggledCycle(null, 'p', 20, 19)).toEqual({ projectId: 'p', isOn: true, start: 16, end: 20 });
	});

	it('should keep the range when turned off and on, and drop another project\'s', () => {
		const cycle: TCycle = { projectId: 'p', isOn: true, start: 1, end: 2 };
		expect(toggledCycle(cycle, 'p', 20, 9)).toEqual({ ...cycle, isOn: false });
		expect(toggledCycle(cycle, 'q', 20, 9)).toEqual({ projectId: 'q', isOn: true, start: 9, end: 13 });
	});
});

describe('shownCycle', () => {
	it('should show only this project\'s range, inside a length that shrank', () => {
		const cycle: TCycle = { projectId: 'p', isOn: false, start: 8, end: 12 };
		expect(shownCycle(cycle, 'q', 20)).toBeNull();
		expect(shownCycle(cycle, 'p', 10)).toEqual({ isOn: false, start: 8, end: 10 });
	});
});

describe('playback in a cycle', () => {
	const range = { start: 2, end: 5 };

	it('should jump back when the range ends and play on before it', () => {
		expect(cycleRestart(4.99, range)).toBeNull();
		expect(cycleRestart(5, range)).toBe(2);
		expect(cycleRestart(5, null)).toBeNull();
	});

	it('should start inside the range, wherever the playhead is', () => {
		expect(cyclePlayFrom(3, range)).toBe(3);
		expect(cyclePlayFrom(0, range)).toBe(2);
		expect(cyclePlayFrom(5, range)).toBe(2);
		expect(cyclePlayFrom(7, null)).toBe(7);
	});
});
