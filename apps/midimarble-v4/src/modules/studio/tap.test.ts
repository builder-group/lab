import { describe, expect, it } from 'vitest';
import { tapTime } from './tap';

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
});
