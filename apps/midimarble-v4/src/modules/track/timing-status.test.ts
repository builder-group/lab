import { describe, expect, it } from 'vitest';
import type { THitResult } from '@/modules/simulation';
import { timingStatus } from './timing-status';

function hitResult(patch: Partial<THitResult>): THitResult {
	return {
		marbleId: 'marble-1',
		hitId: 'hit-1',
		targetTime: 1,
		pieceId: 'piece-1',
		dot: null,
		velocity: null,
		actualTime: 1,
		error: 0,
		status: 'onTime',
		...patch
	};
}

describe('timingStatus function', () => {
	it('should say On Time in green, naming the marble and note, with the offset in the detail', () => {
		expect(timingStatus({ status: 'placed' }, hitResult({ error: 0.0012 }), { marble: 'Marble 1', note: 'C4' })).toEqual({
			tone: 'good',
			label: 'On Time',
			detail: 'Marble 1 hits C4 on time (+1.2 ms)'
		});
	});

	it('should name a drifting hit by how late or early it is', () => {
		const late = timingStatus({ status: 'placed' }, hitResult({ status: 'drifting', error: 0.0123 }));
		const early = timingStatus({ status: 'placed' }, hitResult({ status: 'drifting', error: -0.008 }));
		expect(late.tone).toBe('warn');
		expect(late.label).toBe('12 ms Late');
		expect(late.detail).toBe('Lands 12 ms after the note');
		expect(early.label).toBe('8 ms Early');
	});

	it('should report blocked and unreached pieces in red before the hit result', () => {
		expect(timingStatus({ status: 'blocked' }, hitResult({}))).toMatchObject({ tone: 'bad', label: 'Blocked' });
		expect(timingStatus({ status: 'unreached' }, undefined)).toMatchObject({ tone: 'bad', label: 'Missed' });
	});

	it('should tell a stopped marble from a miss', () => {
		expect(timingStatus({ status: 'placed' }, hitResult({ status: 'missed', reason: 'resting' }), { marble: 'Marble 1', piece: 'Platform 2' })).toMatchObject({
			label: 'Stopped',
			detail: 'Marble 1 stops on Platform 2 instead of striking it'
		});
		expect(timingStatus({ status: 'placed' }, hitResult({ status: 'missed', error: 0.04 }))).toMatchObject({ label: 'Missed', detail: 'Lands 40 ms after the note' });
	});

	it('should stay neutral while the run is simulating', () => {
		expect(timingStatus(undefined, undefined)).toEqual({ tone: 'neutral', label: 'Checking…' });
	});
});
