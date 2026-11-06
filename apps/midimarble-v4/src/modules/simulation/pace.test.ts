import { describe, expect, it } from 'vitest';
import { MARBLE_SPACING } from '@/modules/project';
import { createBareRunProject } from './fixture-projects';
import { COLUMN_CLEARANCE, columnRate, descentPace, descentPoints, longGapThreshold, paceAt, paceRate, PACE_LIMIT } from './pace';
import { frameBand } from './placement';

function evenTimes(count: number, gap: number, start = 0.5): number[] {
	return Array.from({ length: count }, (_, i) => Math.round((start + gap * i) * 1000) / 1000);
}

describe('pace', () => {
	describe('paceRate function', () => {
		it('should be the default bounce descent at the median interval', () => {
			const project = createBareRunProject({
			gravity: 1,
				id: 'pace',
				title: 'Pace',
				end: 4,
				marbles: [{ x: 0, y: 0.6, releaseTime: 0, hitTimes: evenTimes(8, 0.3) }]
			});
			// (1 − 0.65) / (1 + 0.65) · g · 0.3 / 2
			expect(paceRate(project)).toBeCloseTo((0.35 / 1.65) * 9.81 * 0.15, 6);
		});

		it('should share one rate between marbles and ignore long notes', () => {
			const project = createBareRunProject({
			gravity: 1,
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

		it('should keep a zigzag of several marbles clear of the piece two hits back at half gravity', () => {
			const duet = (gravity: number, count: number) =>
				createBareRunProject({
					gravity,
					id: 'pace',
					title: 'Pace',
					end: 6,
					marbles: Array.from({ length: count }, (_, i) => ({
						x: i * MARBLE_SPACING,
						y: 0.6,
						releaseTime: 0,
						hitTimes: evenTimes(9, 0.5)
					}))
				});
			const g = 9.81 * 0.5;
			const bounceRate = (0.35 / 1.65) * g * 0.25;
			// One marble keeps the descent of its default bounce
			expect(paceRate(duet(0.5, 1))).toBeCloseTo(bounceRate, 6);
			// Two marbles descend faster, so a bounce at the pace stays COLUMN_CLEARANCE below the piece two hits back
			const rate = paceRate(duet(0.5, 2));
			expect(rate).toBeCloseTo(columnRate(0.5, g), 6);
			expect(rate).toBeGreaterThan(bounceRate * 1.1);
			const drop = rate * 0.5;
			const takeoff = (-drop + (g * 0.25) / 2) / 0.5;
			expect(drop - (takeoff * takeoff) / (2 * g)).toBeCloseTo(COLUMN_CLEARANCE, 6);
			// Full gravity at this rhythm already leaves the clearance with the default bounce
			expect(paceRate(duet(1, 2))).toBeCloseTo((0.35 / 1.65) * 9.81 * 0.25, 6);
		});

		it('should scale the bounce rise of a long gap with gravity', () => {
			const solo = (gravity: number) =>
				createBareRunProject({
					gravity,
					id: 'pace',
					title: 'Pace',
					end: 6,
					marbles: [{ x: 0, y: 0.6, releaseTime: 0, hitTimes: evenTimes(9, 0.5) }]
				});
			// Rise and pace both halve with gravity, so the threshold stays at about 0.68 s and a 0.75 s note
			// is a long gap at either speed
			expect(longGapThreshold(solo(0.5))).toBeCloseTo(longGapThreshold(solo(1)), 3);
			expect(longGapThreshold(solo(0.5))).toBeLessThan(0.75);
		});
	});

	describe('descentPace function', () => {
		it('should anchor at the earliest dot and fall at the rate', () => {
			const project = createBareRunProject({
			gravity: 1,
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
		it('should give each marble its own band, MARBLE_SPACING apart', () => {
			const project = createBareRunProject({
			gravity: 1,
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
			// The band covering every marble is at least the film frame, the limit of what stays in view
			expect(whole.halfWidth).toBeGreaterThanOrEqual(MARBLE_SPACING / 2 + frameBand(project, 'marble-1').halfWidth);
			// Marbles follow their releases from left to right; neighboring bands meet without a gap
			const left = frameBand(project, 'marble-2');
			const right = frameBand(project, 'marble-1');
			expect(left.centerX).toBeCloseTo(-MARBLE_SPACING / 2, 12);
			expect(right.centerX).toBeCloseTo(MARBLE_SPACING / 2, 12);
			expect(left.centerX + left.halfWidth).toBeGreaterThanOrEqual(right.centerX - right.halfWidth - 1e-12);
			// One marble gets 1.5 film frames: 36 mm over 30 mm of distance on the long side, 9:16 of that across
			const single = createBareRunProject({
			gravity: 1,
				id: 'single',
				title: 'Single',
				end: 1,
				marbles: [{ x: 0.1, y: 0.6, releaseTime: 0, hitTimes: [0.5] }]
			});
			expect(frameBand(single, 'marble-1').centerX).toBe(0.1);
			expect(frameBand(single, 'marble-1').halfWidth).toBeCloseTo((1.5 * single.film.camera.distance * 1.2 * (9 / 16)) / 2, 12);
		});
	});
});
