import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { parseProject } from '../project';
import { createDemoProject, createWorldObject } from '../project/fixtures/sample-project';
import { axisDragDistance, boundTransform } from './scene-transform';

describe('axisDragDistance function', () => {
	it('should follow a projected world axis without leaking into other axes', () => {
		const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 100);
		camera.position.set(0, 0, 10);
		camera.lookAt(0, 0, 0);
		camera.updateMatrixWorld();
		const distance = axisDragDistance(
			camera,
			new THREE.Vector3(),
			new THREE.Vector3(1, 0, 0),
			new THREE.Vector2(),
			new THREE.Vector2(0.2, 0.8)
		);
		expect(distance).toBeCloseTo(2);
	});
	it('should remain usable when the selected axis points directly at the camera', () => {
		const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 100);
		camera.position.set(0, 0, 10);
		camera.lookAt(0, 0, 0);
		camera.updateMatrixWorld();
		const distance = axisDragDistance(
			camera,
			new THREE.Vector3(),
			new THREE.Vector3(0, 0, 1),
			new THREE.Vector2(),
			new THREE.Vector2(0, 0.2)
		);
		expect(distance).toBeCloseTo(-2);
	});
	it('should keep extreme numeric transforms valid when saved and reopened', () => {
		const project = createDemoProject();
		const object = createWorldObject('rail', [0, 0, 0]);
		object.path = [
			[0, 0, 0],
			[1, 0.5, 1]
		];
		const patch = boundTransform(
			object,
			[1e20, -1e20, Infinity],
			[999999, -999999, NaN],
			[1000, 1000, 1000]
		);
		Object.assign(object, patch);
		project.objects.push(object);
		expect(patch.position).toEqual([1e6, -1e6, 0]);
		expect(patch.rotation.every((value) => Math.abs(value) <= Math.PI)).toBe(true);
		expect(patch.size.every((value) => value >= 0.02 && value <= 50)).toBe(true);
		expect(patch.path?.flat().every((value) => Math.abs(value) <= 100)).toBe(true);
		expect(() => parseProject(JSON.stringify(project))).not.toThrow();
	});
});
