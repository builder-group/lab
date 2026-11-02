import { describe, expect, it } from 'vitest';
import { createPart } from '../project/model';
import {
	getDisplaySize,
	orthogonalizeRoute,
	orthogonalRoute,
	polylineLengthM,
	readableWireWidth,
	rotateAnchor
} from './geometry';

describe('physical canvas geometry', () => {
	it('should measure model-space metres independently from viewport zoom', () => {
		const route = orthogonalRoute({ x: 0, y: 0 }, { x: 2000, y: 1000 });
		expect(polylineLengthM(route)).toBe(3);
		expect(
			route.every((p, i) => i === 0 || p.x === route[i - 1]?.x || p.y === route[i - 1]?.y)
		).toBe(true);
	});
	it('should rotate a normalized terminal with its physical device', () => {
		expect(rotateAnchor({ x: 0.2, y: 1 }, 90)).toEqual({ x: 0, y: 0.2 });
		expect(rotateAnchor({ x: 0.2, y: 1 }, 180)).toEqual({ x: 0.8, y: 0 });
	});
	it('should persist orthogonal bends rather than measure a hidden diagonal', () => {
		const points = orthogonalizeRoute([
			{ x: 0, y: 0 },
			{ x: 300, y: 400 }
		]);
		expect(polylineLengthM(points)).toBe(0.7);
	});
	it('should make thicker conductor profiles readable without claiming physical diameter', () => {
		expect(readableWireWidth(35)).toBeGreaterThan(readableWireWidth(6));
		expect(readableWireWidth(null)).toBeGreaterThan(0);
	});
	it('should keep an unsized part envelope in world millimetres without claiming calibration', () => {
		const part = createPart('Unsized custom photo');
		expect(getDisplaySize(part, 0)).toEqual({ width: 160, height: 110, calibrated: false });
		expect(getDisplaySize(part, 90)).toEqual({ width: 110, height: 160, calibrated: false });
	});
});
