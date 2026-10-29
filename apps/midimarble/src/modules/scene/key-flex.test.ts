import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createCatalogObject } from '../project';
import { prepareKeyFlexGeometry } from './key-flex';

describe('prepareKeyFlexGeometry function', () => {
	it.each(['x', 'z'] as const)(
		'should anchor displacement and slope at both pins along %s with a bounded free tip',
		(axis) => {
			const length = 1.5;
			const along = [-0.5, -0.31, -0.15, 0, 0.15, 0.31, 0.5];
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute(
				'position',
				new THREE.Float32BufferAttribute(
					along.flatMap((value) => axis === 'x' ? [value * length, 0, 0] : [0, 0, value * length]),
					3
				)
			);
			const object = createCatalogObject('key-strip');
			object.size = axis === 'x' ? [length, 0.045, 0.35] : [0.35, 0.045, length];

			prepareKeyFlexGeometry(geometry, object);

			const flex = geometry.getAttribute('aKeyFlex');
			const slope = geometry.getAttribute('aKeyFlexSlope');
			for (const index of [1, 5]) {
				expect(flex.getX(index)).toBeCloseTo(0, 10);
				expect(slope.getX(index)).toBeCloseTo(0, 5);
			}
			expect(flex.getX(3)).toBe(1);
			expect(slope.getX(3)).toBeCloseTo(0);
			for (const index of [0, 6]) expect(flex.getX(index)).toBeCloseTo(-0.08);
			expect(slope.getX(0)).toBeCloseTo(0.16 / (0.19 * length));
			expect(slope.getX(6)).toBeCloseTo(-0.16 / (0.19 * length));
			for (let index = 0; index < along.length; index++) {
				expect(Number.isFinite(slope.getX(index))).toBe(true);
				expect(flex.getX(index)).toBeGreaterThanOrEqual(-0.081);
				expect(flex.getX(index)).toBeLessThanOrEqual(1);
			}
		}
	);

	it.each(['rack', 'folded'] as const)('should preserve the legacy %s profile', (mountStyle) => {
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute(
			'position',
			new THREE.Float32BufferAttribute([0, 0, -0.5, 0, 0, 0, 0, 0, 0.5], 3)
		);
		const object = {
			...createCatalogObject('key-strip'),
			mountStyle,
			size: [0.3, 0.05, 1] as [number, number, number]
		};
		prepareKeyFlexGeometry(geometry, object);
		const flex = geometry.getAttribute('aKeyFlex');
		const slope = geometry.getAttribute('aKeyFlexSlope');
		expect(flex.getX(0)).toBeCloseTo(0);
		expect(flex.getX(1)).toBe(1);
		expect(flex.getX(2)).toBeCloseTo(0);
		expect(slope.getX(0)).toBeCloseTo(Math.PI);
		expect(slope.getX(2)).toBeCloseTo(-Math.PI);
	});
});
