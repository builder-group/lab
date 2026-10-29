import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { isScenePickVisible } from './scene-picking';

describe('isScenePickVisible function', () => {
	it('should reject a raycast hit on a marble whose launch has not started', () => {
		const group = new THREE.Group();
		const surface = new THREE.Mesh(new THREE.SphereGeometry(0.24));
		group.add(surface);
		group.visible = false;
		expect(isScenePickVisible(surface)).toBe(false);
		group.visible = true;
		expect(isScenePickVisible(surface)).toBe(true);
		surface.geometry.dispose();
	});
});
