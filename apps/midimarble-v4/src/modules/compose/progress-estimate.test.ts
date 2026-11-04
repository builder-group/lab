import { describe, expect, it } from 'vitest';
import { createEstimate, estimateLeft, leftWords } from './progress-estimate';

describe('estimateLeft function', () => {
	it('should wait until the rate is known', () => {
		expect(estimateLeft(500, 0.5)).toBeNull();
		expect(estimateLeft(3000, 0.01)).toBeNull();
	});

	it('should extrapolate the rate so far', () => {
		expect(estimateLeft(4000, 0.25)).toBeCloseTo(12);
	});
});

describe('leftWords function', () => {
	it('should round like Finder, coarser for longer waits', () => {
		expect(leftWords(3)).toBe('a few seconds left');
		expect(leftWords(8.4)).toBe('about 8 s left');
		expect(leftWords(23)).toBe('about 25 s left');
		expect(leftWords(130)).toBe('about 2 min left');
	});
});

describe('createEstimate function', () => {
	it('should smooth the estimate between updates', () => {
		const estimate = createEstimate();

		expect(estimate.update(1000, 0.2)).toBe('');
		expect(estimate.update(2000, 0.2)).toBe('about 8 s left');
		// A stall that alone would read 18 s moves the figure only part of the way
		expect(estimate.update(4500, 0.2)).toBe('about 11 s left');
	});
});
