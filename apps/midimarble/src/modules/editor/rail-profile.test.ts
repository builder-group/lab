import { describe, expect, it } from 'vitest';
import { createCatalogRailPath, type TVec3 } from '../project';
import { deformRailProfile, getRailProfileHandles, getRailProfileProjection } from './rail-profile';

describe('rail profile editing functions', () => {
	it('should move the selected handle smoothly without changing distant points, source data or depth', () => {
		const path: TVec3[] = Array.from({ length: 21 }, (_, index) => [index * 0.1, 0, index * 0.02]);
		const before = structuredClone(path);
		const changed = deformRailProfile(path, 10, [0.2, 0.5]);
		expect(path).toEqual(before);
		expect(changed[10]).toEqual([1.2, 0.5, 0.2]);
		expect(changed[9]?.[1]).toBeGreaterThan(changed[8]?.[1] ?? Infinity);
		expect(changed[8]?.[1]).toBeGreaterThan(0);
		expect(changed[0]).toEqual(path[0]);
		expect(changed.at(-1)).toEqual(path.at(-1));
		expect(changed.map((point) => point[2])).toEqual(path.map((point) => point[2]));
		expect(changed[0]).not.toBe(path[0]);
	});

	it('should clamp moved coordinates while keeping the original depth', () => {
		const changed = deformRailProfile(
			[
				[99.9, -99.9, 0.3],
				[1, 1, 0.2]
			],
			0,
			[5, -5]
		);
		expect(changed[0]).toEqual([100, -100, 0.3]);
	});

	it('should expose coarse wave extrema and endpoints instead of every physical vertex', () => {
		const path = createCatalogRailPath('rail-wave', 6.4);
		if (path == null) throw new Error('Expected a wave path.');
		const handles = getRailProfileHandles(path);
		expect(handles[0]).toBe(0);
		expect(handles.at(-1)).toBe(path.length - 1);
		expect(handles.length).toBeGreaterThanOrEqual(4);
		expect(handles.length).toBeLessThanOrEqual(7);
		const low = path.reduce(
			(best, point, index) => (point[1] < (path[best]?.[1] ?? Infinity) ? index : best),
			0
		);
		expect(handles).toContain(low);
	});

	it('should place a few evenly spaced handles on a dense straight rail', () => {
		const path: TVec3[] = Array.from({ length: 65 }, (_, index) => [index / 10, 0, 0]);
		expect(getRailProfileHandles(path)).toEqual([0, 16, 32, 48, 64]);
	});

	it('should keep a finite, uniform side-view scale for a flat or vertical profile', () => {
		for (const path of [
			[
				[0, 0, 0],
				[6, 0, 0]
			],
			[
				[0, -2, 0],
				[0, 2, 0]
			]
		] as TVec3[][]) {
			const projection = getRailProfileProjection(path);
			expect(Number.isFinite(projection.scale)).toBe(true);
			for (const point of path) {
				expect(Math.abs((point[0] - projection.x) * projection.scale)).toBeLessThanOrEqual(102);
				expect(Math.abs((point[1] - projection.y) * projection.scale)).toBeLessThanOrEqual(34);
			}
		}
	});
});
