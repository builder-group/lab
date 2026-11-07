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

	it('should never say more than the time per step so far for each step left', () => {
		// 2 s for 3 of 9 steps is 4 s more, though the work share alone reads 18 s
		expect(estimateLeft(2000, 0.1, 3, 9)).toBeCloseTo(4);
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
	it('should wait for a few steps and two figures that agree', () => {
		const estimate = createEstimate();

		expect(estimate.update(1000, 0.2, 1, 10)).toBe('');
		// Three steps done, but the first figure has nothing to agree with
		expect(estimate.update(2000, 0.2, 3, 10)).toBe('');
		expect(estimate.update(2200, 0.21, 3, 10)).toBe('about 5 s left');
	});

	it('should count down without rising when the work stalls', () => {
		const estimate = createEstimate();
		estimate.update(2000, 0.2, 3, 30);
		expect(estimate.update(2100, 0.2, 3, 30)).toBe('about 8 s left');

		// A stall that alone would read 18 s and more keeps the figure, which counts down with the clock
		expect(estimate.update(4500, 0.2, 3, 30)).toBe('about 6 s left');
	});

	it('should not jump from 45 s to a few seconds when many hits get fixed at once', () => {
		// Fix Hits of 37 hits in 10.8 s: slow at first, then many hits fixed at once
		const updates: [number, number, number][] = [
			[1000, 0.02, 0],
			[2300, 0.05, 3],
			[2800, 0.06, 4],
			[3300, 0.07, 5],
			[3800, 0.08, 6],
			[4300, 0.1, 7],
			[4900, 0.26, 14],
			[6000, 0.45, 20],
			[7500, 0.62, 26],
			[9500, 0.85, 33],
			[10500, 0.97, 36]
		];
		const estimate = createEstimate();
		const shown: { at: number; seconds: number }[] = [];
		for (const [at, fraction, done] of updates) {
			const words = estimate.update(at, fraction, done, 37);
			const match = /about (\d+) s left/.exec(words);
			if (words === 'a few seconds left') shown.push({ at, seconds: 4 });
			else if (match != null) shown.push({ at, seconds: Number(match[1]) });
		}

		expect(shown.length).toBeGreaterThan(3);
		// The work share alone read 44 s at 2.8 s; the rate by steps keeps the first figure lower
		expect(Math.max(...shown.map((item) => item.seconds))).toBeLessThanOrEqual(25);
		for (let index = 1; index < shown.length; index++) {
			const before = shown[index - 1];
			const after = shown[index];
			if (before == null || after == null) continue;
			expect(after.seconds).toBeLessThanOrEqual(before.seconds);
			// Falls about as fast as the clock, at most three times faster, plus rounding
			expect(before.seconds - after.seconds).toBeLessThanOrEqual(((after.at - before.at) / 1000) * 3 + 5);
		}
	});
});
