import { describe, expect, it } from 'vitest';
import { MAX_TILT_DEGREES, orbitedAngles } from './camera-orbit';

const DEGREE = Math.PI / 180;

describe('orbitedAngles function', () => {
	const start = { side: 95 * DEGREE, pitch: 1 };

	it('should change Turn with left and right, and Tilt with up and down', () => {
		const right = orbitedAngles(start, 100, 0);
		expect(right.side).toBeCloseTo(55 * DEGREE);
		expect(right.pitch).toBe(1);
		const down = orbitedAngles(start, 0, 100);
		expect(down.side).toBeCloseTo(start.side);
		expect(down.pitch).toBeCloseTo(1 - 40 * DEGREE);
	});

	it('should take Turn all the way around', () => {
		expect(orbitedAngles(start, 300, 0).side).toBeCloseTo(335 * DEGREE);
		expect(orbitedAngles(start, -700, 0).side).toBeCloseTo(15 * DEGREE);
	});

	it('should stop Tilt straight at the wall and short of lying flat against it', () => {
		expect(orbitedAngles(start, 0, 1000).pitch).toBe(0);
		expect(orbitedAngles(start, 0, -1000).pitch).toBeCloseTo(MAX_TILT_DEGREES * DEGREE);
	});
});
