import { describe, expect, it } from 'vitest';
import { TAP_COUNT_IN_SECONDS, tapTime } from './tap';

describe('tapTime', () => {
	it('should round the tap to 0.1 ms', () => {
		expect(tapTime([], 1.234567)).toBe(1.2346);
	});

	it('should merge a tap within 50 ms of an existing hit', () => {
		expect(tapTime([{ time: 1 }], 1.03)).toBeNull();
		expect(tapTime([{ time: 1 }], 0.96)).toBeNull();
	});

	it('should add a tap 50 ms or more from every hit', () => {
		expect(tapTime([{ time: 1 }], 1.06)).toBe(1.06);
		expect(tapTime([{ time: 1 }, { time: 2 }], 1.5)).toBe(1.5);
	});

	it('should record nothing in the count-in after the press that started playback', () => {
		// Playback started at 0:00
		const countInEnd = TAP_COUNT_IN_SECONDS;
		expect(tapTime([], 0, countInEnd)).toBeNull();
		expect(tapTime([], 0.06, countInEnd)).toBeNull();
		expect(tapTime([], 0.31, countInEnd)).toBe(0.31);
	});
});
