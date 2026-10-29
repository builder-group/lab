import { createWorldObject } from '../project/fixtures/sample-project';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../project';
import { getPhysicalBounds, getWallPosition } from './scene-bounds';

describe('getPhysicalBounds function', () => {
	it('should frame a transformed instrument without including its invisible impact halo', () => {
		const instrument = new THREE.Group();
		instrument.position.set(2, -3, 1);
		const key = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 0.5));
		instrument.add(key);
		const halo = new THREE.Mesh(new THREE.PlaneGeometry(10, 10));
		halo.name = 'impact-glow';
		instrument.add(halo);
		const bounds = getPhysicalBounds(instrument);
		expect(bounds.getSize(new THREE.Vector3()).x).toBeCloseTo(2);
		expect(bounds.getSize(new THREE.Vector3()).z).toBeCloseTo(0.5);
		expect(bounds.getCenter(new THREE.Vector3()).toArray()).toEqual([2, -3, 1]);
		key.geometry.dispose();
		halo.geometry.dispose();
	});
});

describe('getWallPosition function', () => {
	it('should keep a studio wall fixed when an unrelated object moves behind it', () => {
		const project = createEmptyProject();
		const object = createWorldObject('bar', [100, 2, -50]);
		expect(getWallPosition(project.scene, project.launch.position[2], [object])).toBe(0);
		object.position[2] = -500;
		expect(getWallPosition(project.scene, project.launch.position[2], [object])).toBe(0);
	});
	it('should retain the automatic wall fit for legacy files without a fixed wall', () => {
		const object = createWorldObject('bar', [0, 0, -5]);
		object.rotation = [0, 0, 0];
		expect(getWallPosition(undefined, 0, [object])).toBeCloseTo(-5 - object.size[2] / 2 - 0.65);
	});
});
