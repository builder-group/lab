import { describe, expect, it } from 'vitest';
import { createBareRunProject } from './fixture-projects';
import { descentPace, descentPoints, longGapThreshold, paceAt, paceRate, PACE_LIMIT } from './pace';
import { frameBand } from './placement';

function evenTimes(count: number, gap: number, start = 0.5): number[] {
	return Array.from({ length: count }, (_, i) => Math.round((start + gap * i) * 1000) / 1000);
}

describe('pace', () => {
	describe('paceRate function', () => {
		it('should be the default bounce descent at the median interval', () => {
			const project = createBareRunProject({
				id: 'pace',
				title: 'Pace',
				end: 4,
				marbles: [{ x: 0, y: 0.6, releaseTime: 0, hitTimes: evenTimes(8, 0.3) }]
			});
			// (1 − 0.65) / (1 + 0.65) · g · 0.3 / 2
			expect(paceRate(project)).toBeCloseTo((0.35 / 1.65) * 9.81 * 0.15, 6);
		});

		it('should share one rate between lanes and ignore long notes', () => {
			const project = createBareRunProject({
				id: 'pace',
				title: 'Pace',
				end: 8,
				marbles: [
					{ x: -0.1, y: 0.6, releaseTime: 0, hitTimes: [...evenTimes(5, 0.5), 5, 7] },
					{ x: 0.1, y: 0.6, releaseTime: 0, hitTimes: evenTimes(9, 0.5) }
				]
			});
			expect(paceRate(project)).toBeCloseTo((0.35 / 1.65) * 9.81 * 0.25, 6);
			// A bounce at 0.52 m/s rises past 0.4 m above about 0.68 s
			expect(longGapThreshold(project)).toBeCloseTo(0.677, 2);
		});
	});

	describe('descentPace function', () => {
		it('should anchor at the earliest dot and fall at the rate', () => {
			const project = createBareRunProject({
				id: 'pace',
				title: 'Pace',
				end: 2,
				marbles: [{ x: 0, y: 0.6, releaseTime: 0, hitTimes: evenTimes(4, 0.3) }]
			});
			const pace = descentPace(project, [
				{ targetTime: 0.8, dot: { x: 0, y: -1 } },
				{ targetTime: 0.5, dot: { x: 0, y: -0.5 } },
				{ targetTime: 0.2, dot: null }
			]);
			expect(pace).toMatchObject({ anchorTime: 0.5, anchorY: -0.5, limit: PACE_LIMIT });
			if (pace == null) throw new Error('No pace');
			expect(paceAt(pace, 1.5)).toBeCloseTo(-0.5 - pace.rate, 12);
			expect(descentPace(project, [{ targetTime: 0.5, dot: null }])).toBeNull();
			const points = descentPoints(pace, 0, 1.2);
			expect(points.map((point) => point.time)).toEqual([0, 0.5, 1, 1.2]);
			expect(points[3]?.y).toBeCloseTo(paceAt(pace, 1.2), 12);
		});
	});

	describe('frameBand function', () => {
		it('should give each lane its own band side by side in a wider frame', () => {
			const project = createBareRunProject({
				id: 'bands',
				title: 'Bands',
				end: 2,
				marbles: [
					{ x: 0.16, y: 0.6, releaseTime: 0, hitTimes: [0.5] },
					{ x: -0.16, y: 0.6, releaseTime: 0, hitTimes: [0.5] }
				]
			});
			const whole = frameBand(project);
			expect(whole.centerX).toBeCloseTo(0, 12);
			expect(whole.halfWidth).toBeCloseTo(0.315, 12);
			// Lanes follow their releases from left to right, with a gutter between them
			const left = frameBand(project, 'lane-2');
			const right = frameBand(project, 'lane-1');
			expect(left.centerX).toBeCloseTo(-0.1575, 12);
			expect(right.centerX).toBeCloseTo(0.1575, 12);
			expect(right.centerX - right.halfWidth - (left.centerX + left.halfWidth)).toBeCloseTo(0.024, 12);
			// One marble keeps the 0.45 m frame
			const single = createBareRunProject({
				id: 'single',
				title: 'Single',
				end: 1,
				marbles: [{ x: 0.1, y: 0.6, releaseTime: 0, hitTimes: [0.5] }]
			});
			expect(frameBand(single, 'lane-1')).toEqual({ centerX: 0.1, halfWidth: 0.225 });
		});
	});
});
