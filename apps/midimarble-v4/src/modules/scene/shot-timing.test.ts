import { describe, expect, it } from 'vitest';
import type { TShot } from '@/modules/project';
import { shotEvents } from '@/modules/camera';
import { shotHold, shotSpans } from './shot-timing';

const shot = (id: string, time: number, hold?: number): TShot => ({
	id,
	time,
	distance: 0.5,
	...(hold != null ? { hold } : {})
});

describe('shots', () => {
	it('holds for its hold, and until the next shot without one', () => {
		expect(shotHold(shot('a', 0, 3))).toBe(3);
		expect(shotHold(shot('a', 0))).toBeNull();
		expect(shotHold(shot('a', 0, 0))).toBeNull();
	});

	it('spans each shot to its release, the next shot or the end', () => {
		const spans = shotSpans([shot('c', 9), shot('a', 1, 2), shot('b', 4, 5)], 12);
		expect(spans.map((span) => [span.shotId, span.start, span.end, span.isRelease])).toEqual([
			['a', 1, 3, true],
			['b', 4, 9, false],
			['c', 9, 12, false]
		]);
	});

	it('eases back to the rig only when the hold ends before the next shot', () => {
		const events = shotEvents([{ time: 1, distance: 0.4, length: 2 }, { time: 2.5, distance: 0.3, length: 2 }], 0.7);
		expect(events).toEqual([
			{ time: 1, distance: 0.4, isRelease: false },
			{ time: 2.5, distance: 0.3, isRelease: false },
			{ time: 4.5, distance: 0.7, isRelease: true }
		]);
	});
});
