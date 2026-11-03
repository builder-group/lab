import { describe, expect, it } from 'vitest';
import type { TShot } from '@/modules/project';
import { shotEvents } from './follow-camera';
import { shotLength, shotSpans } from './shots';

const shot = (id: string, time: number, kind: TShot['kind'], length?: number): TShot => ({
	id,
	time,
	kind,
	roll: 0,
	distance: 0.5,
	...(length != null ? { length } : {})
});

describe('shots', () => {
	it('holds close shots for 2 s and the others until the next shot', () => {
		expect(shotLength(shot('a', 0, 'pushIn'))).toBe(2);
		expect(shotLength(shot('a', 0, 'closeUp'))).toBe(2);
		expect(shotLength(shot('a', 0, 'wide'))).toBeNull();
		expect(shotLength(shot('a', 0, 'follow', 3))).toBe(3);
		expect(shotLength(shot('a', 0, 'pushIn', 0))).toBeNull();
	});

	it('spans each shot to its release, the next shot or the end', () => {
		const spans = shotSpans([shot('c', 9, 'wide'), shot('a', 1, 'pushIn'), shot('b', 4, 'closeUp', 5)], 12);
		expect(spans.map((span) => [span.shotId, span.start, span.end, span.isRelease])).toEqual([
			['a', 1, 3, true],
			['b', 4, 9, false],
			['c', 9, 12, false]
		]);
	});

	it('eases back to the rig only when the hold ends before the next shot', () => {
		const events = shotEvents([{ time: 1, roll: 0.1, distance: 0.4, length: 2 }, { time: 2.5, roll: 0, distance: 0.3, length: 2 }], 0.7);
		expect(events).toEqual([
			{ time: 1, distance: 0.4, roll: 0.1, isRelease: false },
			{ time: 2.5, distance: 0.3, roll: 0, isRelease: false },
			{ time: 4.5, distance: 0.7, roll: 0, isRelease: true }
		]);
	});
});
