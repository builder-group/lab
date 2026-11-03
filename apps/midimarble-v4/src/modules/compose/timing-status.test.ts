import { describe, expect, it } from 'vitest';
import type { THitResult } from '@/modules/simulation';
import { lateness, timingStatus } from './timing-status';

function hitResult(patch: Partial<THitResult>): THitResult {
	return {
		laneId: 'lane-1',
		hitId: 'hit-1',
		targetTime: 1,
		pieceEntityId: 'piece-1',
		dot: null,
		velocity: null,
		actualTime: 1,
		error: 0,
		status: 'onTime',
		...patch
	};
}

describe('timingStatus function', () => {
	it('should say On time in green with the offset in the detail', () => {
		expect(timingStatus({ status: 'placed' }, hitResult({ error: 0.0012 }))).toEqual({ tone: 'good', label: 'On time', detail: '+1.2 ms from the note' });
	});

	it('should name a drifting hit by how late or early it is', () => {
		const late = timingStatus({ status: 'placed' }, hitResult({ status: 'drifting', error: 0.0123 }));
		const early = timingStatus({ status: 'placed' }, hitResult({ status: 'drifting', error: -0.008 }));
		expect(late.tone).toBe('warn');
		expect(late.label).toBe('12 ms late');
		expect(early.label).toBe('8 ms early');
	});

	it('should report blocked and unreached pieces in red before the hit result', () => {
		expect(timingStatus({ status: 'blocked' }, hitResult({}))).toMatchObject({ tone: 'bad', label: 'Blocked' });
		expect(timingStatus({ status: 'unreached' }, undefined)).toMatchObject({ tone: 'bad', label: 'Missed' });
	});

	it('should tell a resting contact from a miss', () => {
		expect(timingStatus({ status: 'placed' }, hitResult({ status: 'missed', reason: 'resting' })).label).toBe('Resting');
		expect(timingStatus({ status: 'placed' }, hitResult({ status: 'missed', error: 0.04 }))).toMatchObject({ label: 'Missed', detail: 'The marble arrives 40 ms late.' });
	});

	it('should stay neutral while the run is simulating', () => {
		expect(timingStatus(undefined, undefined)).toEqual({ tone: 'neutral', label: 'Simulating…' });
	});
});

describe('lateness function', () => {
	it('should round to whole milliseconds with the direction', () => {
		expect(lateness(0.0004)).toBe('0 ms late');
		expect(lateness(-0.0216)).toBe('22 ms early');
	});
});
