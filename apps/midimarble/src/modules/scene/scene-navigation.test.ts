import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { orbitAroundPivot } from './scene-navigation';

describe('orbitAroundPivot function', () => {
	it('should orbit an off-center selection while preserving the view ray and pivot radius', () => {
		const position: [number, number, number] = [3, 4, 10],
			target: [number, number, number] = [0, 1, 0],
			pivot: [number, number, number] = [2, 0, 1];
		const pose = orbitAroundPivot(position, target, pivot, 0.6, 0.2);
		const p = new THREE.Vector3(...position),
			t = new THREE.Vector3(...target),
			center = new THREE.Vector3(...pivot);
		expect(new THREE.Vector3(...pose.position).distanceTo(center)).toBeCloseTo(
			p.distanceTo(center)
		);
		expect(new THREE.Vector3(...pose.target).distanceTo(center)).toBeCloseTo(t.distanceTo(center));
		expect(
			new THREE.Vector3(...pose.position).distanceTo(new THREE.Vector3(...pose.target))
		).toBeCloseTo(p.distanceTo(t));
	});
});
