import { describe, expect, it } from 'vitest';
import { LANE_SPACING } from '@/modules/project';
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
			gravityScale: 1,
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
			gravityScale: 1,
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
			gravityScale: 1,
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
		it('should give each lane its own band, LANE_SPACING apart', () => {
			const project = createBareRunProject({
			gravityScale: 1,
				id: 'bands',
				title: 'Bands',
				end: 2,
				marbles: [
					{ x: 0.0825, y: 0.6, releaseTime: 0, hitTimes: [0.5] },
					{ x: -0.0825, y: 0.6, releaseTime: 0, hitTimes: [0.5] }
				]
			});
			const whole = frameBand(project);
			expect(whole.centerX).toBeCloseTo(0, 12);
			expect(whole.halfWidth).toBeCloseTo(LANE_SPACING / 2 + frameBand(project, 'lane-1').halfWidth, 12);
			// Lanes follow their releases from left to right; neighbouring bands meet without a gap
			const left = frameBand(project, 'lane-2');
			const right = frameBand(project, 'lane-1');
			expect(left.centerX).toBeCloseTo(-LANE_SPACING / 2, 12);
			expect(right.centerX).toBeCloseTo(LANE_SPACING / 2, 12);
			expect(left.centerX + left.halfWidth).toBeGreaterThanOrEqual(right.centerX - right.halfWidth - 1e-12);
			// One marble gets the film frame: 0.45 m at the original 0.65 m camera distance, wider further away
			const single = createBareRunProject({
			gravityScale: 1,
				id: 'single',
				title: 'Single',
				end: 1,
				marbles: [{ x: 0.1, y: 0.6, releaseTime: 0, hitTimes: [0.5] }]
			});
			expect(frameBand(single, 'lane-1').centerX).toBe(0.1);
			expect(frameBand(single, 'lane-1').halfWidth).toBeCloseTo((0.225 * single.design.camera.distance) / 0.65, 12);
		});
	});
});
