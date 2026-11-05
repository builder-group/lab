import { describe, expect, it } from 'vitest';
import type { THitResult } from '@/modules/simulation';
import { hitLandings, landedBetween, offsetLabel } from './hit-flash';

function hit(hitId: string, status: THitResult['status'], targetTime: number, actualTime: number | null = null): THitResult {
	return { marbleId: 'marble', hitId, status, targetTime, actualTime, error: actualTime == null ? null : actualTime - targetTime, pieceEntityId: null, dot: { x: 0, y: 0 }, velocity: null };
}

describe('hitLandings function', () => {
	it('should give each landing its status color in time order and leave out open hits', () => {
		const landings = hitLandings([hit('late', 'drifting', 2, 2.02), hit('on', 'onTime', 1, 1.001), hit('open', 'open', 0.5), hit('miss', 'missed', 3), hit('blocked', 'blocked', 4)]);

		expect(landings.map((item) => [item.hitId, item.tone, item.time])).toEqual([
			['on', 'good', 1.001],
			['late', 'warn', 2.02],
			['miss', 'bad', 3],
			['blocked', 'bad', 4]
		]);
	});
});

describe('landedBetween function', () => {
	const landings = hitLandings([hit('a', 'onTime', 1, 1), hit('b', 'onTime', 1.01, 1.01)]);

	it('should flash each landing once as the playhead crosses it', () => {
		expect(landedBetween(landings, 0.99, 1).map((item) => item.hitId)).toEqual(['a']);
		expect(landedBetween(landings, 1, 1.016).map((item) => item.hitId)).toEqual(['b']);
		expect(landedBetween(landings, 1.016, 1.03)).toEqual([]);
	});

	it('should flash nothing for a seek back or a jump', () => {
		expect(landedBetween(landings, 2, 0.5)).toEqual([]);
		expect(landedBetween(landings, 0, 2)).toEqual([]);
	});
});

describe('offsetLabel function', () => {
	it('should sign the offset in milliseconds', () => {
		expect(offsetLabel(0.0124)).toBe('+12 ms');
		expect(offsetLabel(-0.003)).toBe('−3 ms');
		expect(offsetLabel(0.0001)).toBe('0 ms');
	});
});
