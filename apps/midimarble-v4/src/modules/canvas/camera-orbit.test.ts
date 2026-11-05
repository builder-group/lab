import { describe, expect, it } from 'vitest';
import { MAX_TILT_DEGREES, orbitedAngles } from './camera-orbit';

const DEGREE = Math.PI / 180;

describe('orbitedAngles function', () => {
	const start = { turn: 95 * DEGREE, tilt: 1 };

	it('should change Turn with left and right, and Tilt with up and down', () => {
		const right = orbitedAngles(start, 100, 0);
		expect(right.turn).toBeCloseTo(55 * DEGREE);
		expect(right.tilt).toBe(1);
		const down = orbitedAngles(start, 0, 100);
		expect(down.turn).toBeCloseTo(start.turn);
		expect(down.tilt).toBeCloseTo(1 - 40 * DEGREE);
	});

	it('should take Turn all the way around', () => {
		expect(orbitedAngles(start, 300, 0).turn).toBeCloseTo(335 * DEGREE);
		expect(orbitedAngles(start, -700, 0).turn).toBeCloseTo(15 * DEGREE);
	});

	it('should stop Tilt straight at the wall and short of lying flat against it', () => {
		expect(orbitedAngles(start, 0, 1000).tilt).toBe(0);
		expect(orbitedAngles(start, 0, -1000).tilt).toBeCloseTo(MAX_TILT_DEGREES * DEGREE);
	});
});
