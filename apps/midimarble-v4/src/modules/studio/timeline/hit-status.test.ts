import { describe, expect, it } from 'vitest';
import type { THitResult } from '@/modules/simulation';
import { hitSummary, hitTiming } from './hit-status';

function result(hitId: string, status: THitResult['status'], targetTime: number, extra: Partial<THitResult> = {}): THitResult {
	return { laneId: 'lane-1', hitId, targetTime, pieceEntityId: null, dot: null, velocity: null, actualTime: null, error: null, status, ...extra };
}

describe('hitTiming function', () => {
	it('should name each timing status in the words of the app', () => {
		const names = { marble: 'Marble 1', pitch: 60, piece: 'Platform 3' };

		expect(hitTiming(result('a', 'onTime', 1), names)).toMatchObject({ label: 'On Time', tooltip: 'Marble 1 hits C4 on time' });
		expect(hitTiming(result('a', 'drifting', 1, { error: 0.012 }), names)).toMatchObject({ label: '12 ms Late', tooltip: 'Lands 12 ms after the note' });
		expect(hitTiming(result('a', 'drifting', 1, { error: -0.008 }), names).label).toBe('8 ms Early');
		expect(hitTiming(result('a', 'missed', 1), names).label).toBe('Missed');
		expect(hitTiming(result('a', 'missed', 1, { reason: 'resting' }), names).label).toBe('Stopped');
		expect(hitTiming(result('a', 'blocked', 1), names).tooltip).toContain('Platform 3');
		expect(hitTiming(undefined, names)).toMatchObject({ state: 'open', label: 'Open' });
		expect(hitTiming(result('a', 'open', 1), names, { label: 'Too Soon', detail: "Marble 1 can't reach a platform by 0:01.00" })).toMatchObject({ state: 'unreachable', label: 'Too Soon' });
	});
});

describe('hitSummary function', () => {
	it('should count hits on time when none needs attention', () => {
		expect(hitSummary([result('a', 'onTime', 1), result('b', 'onTime', 2)]).label).toBe('2 of 2 hits on time');
		expect(hitSummary([result('a', 'onTime', 1), result('b', 'open', 2)]).label).toBe('1 of 2 hits on time');
	});

	it('should list the hits that need attention in time order', () => {
		const summary = hitSummary([result('a', 'onTime', 1), result('late', 'missed', 3), result('early', 'drifting', 2, { error: 0.01 })]);

		expect(summary.label).toBe('2 hits need attention');
		expect(summary.problems.map((hit) => hit.hitId)).toEqual(['early', 'late']);
	});

	it('should count open hits that cannot get a platform as needing attention', () => {
		const tooSoon = result('first', 'open', 1);

		const summary = hitSummary([tooSoon, result('b', 'onTime', 2)], [tooSoon]);

		expect(summary.label).toBe('1 hit needs attention');
		expect(summary.problems).toEqual([tooSoon]);
	});
});
