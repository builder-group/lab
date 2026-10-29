import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createSceneEditHelpers, type TSceneEditHelperState } from './scene-edit-helpers';

describe('createSceneEditHelpers function', () => {
	it('should orient the compact camera frustum along the saved camera negative Z direction', () => {
		const helpers = createSceneEditHelpers();
		const state = createState();
		state.cameraPose = { position: [3, 2, 8], target: [-2, -1, -6], fov: 60 };
		state.aspect = 2;
		helpers.update(state);
		const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(helpers.camera.quaternion);
		const expected = new THREE.Vector3(...state.cameraPose.target)
			.sub(helpers.camera.position)
			.normalize();
		expect(forward.distanceTo(expected)).toBeLessThan(1e-7);
		expect(helpers.camera.position.toArray()).toEqual(state.cameraPose.position);
		const frustum = helpers.camera.getObjectByName('camera-frustum');
		if (!(frustum instanceof THREE.LineSegments)) throw new Error('Missing wire camera frustum.');
		frustum.geometry.computeBoundingBox();
		const bounds = frustum.geometry.boundingBox;
		if (bounds == null) throw new Error('Missing frustum bounds.');
		expect(bounds.max.x / bounds.max.y).toBeCloseTo(2);
		expect((Math.atan(bounds.max.y / Math.abs(bounds.min.z)) * 180) / Math.PI).toBeCloseTo(30);
		expect(bounds.min.z).toBeGreaterThan(-2);
		expect(bounds.max.z).toBe(0);
		helpers.dispose();
	});

	it('should point the light icon toward its target while keeping a distant aim line compact', () => {
		const helpers = createSceneEditHelpers();
		const state = createState();
		state.lightingPosition = [4, 12, 6];
		state.lightingTarget = [4, -1000, 6];
		helpers.update(state);
		const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(helpers.lighting.quaternion);
		expect(forward.dot(new THREE.Vector3(0, -1, 0))).toBeGreaterThan(0.999999);
		expect(helpers.lighting.position.toArray()).toEqual(state.lightingPosition);
		const bounds = new THREE.Box3().setFromObject(helpers.lighting);
		expect(bounds.getSize(new THREE.Vector3()).length()).toBeLessThan(3.5);
		state.lightingTarget = [...state.lightingPosition];
		helpers.update(state);
		expect(helpers.lighting.quaternion.toArray().every(Number.isFinite)).toBe(true);
		helpers.dispose();
	});

	it('should raycast wire helpers to their selectable entities and suppress hidden picks', () => {
		const helpers = createSceneEditHelpers();
		helpers.update(createState());
		const raycaster = new THREE.Raycaster(new THREE.Vector3(-2, 0, 2), new THREE.Vector3(0, 0, -1));
		raycaster.params.Line.threshold = 0.08;
		const cameraHit = raycaster.intersectObjects(helpers.pickables, true)[0];
		if (cameraHit == null) throw new Error('Camera wire should be selectable.');
		expect(helpers.getPickEntity(cameraHit.object)).toBe('camera');
		raycaster.set(new THREE.Vector3(2, 0, 2), new THREE.Vector3(0, 0, -1));
		const lightHit = raycaster.intersectObjects(helpers.pickables, true)[0];
		if (lightHit == null) throw new Error('Light direction wire should be selectable.');
		expect(helpers.getPickEntity(lightHit.object)).toBe('lighting');
		expect(helpers.getPickEntity(new THREE.Group())).toBeNull();
		helpers.update({ ...createState(), visible: false });
		expect(helpers.group.visible).toBe(false);
		expect(helpers.getPickEntity(cameraHit.object)).toBeNull();
		helpers.dispose();
	});

	it('should highlight only the selected entity without opaque or depth-writing surfaces', () => {
		const helpers = createSceneEditHelpers();
		helpers.update({ ...createState(), selectedEntity: 'lighting' });
		const cameraLine = helpers.camera.children[0];
		const lightLine = helpers.lighting.children[0];
		if (!(cameraLine instanceof THREE.LineSegments) || !(lightLine instanceof THREE.LineSegments))
			throw new Error('Expected wire helpers.');
		const cameraMaterial = cameraLine.material as THREE.LineBasicMaterial;
		const lightMaterial = lightLine.material as THREE.LineBasicMaterial;
		expect(cameraMaterial.color.equals(lightMaterial.color)).toBe(false);
		expect(lightMaterial.color.r).toBeGreaterThan(lightMaterial.color.b);
		const darkNeutral = cameraMaterial.color.clone();
		helpers.update({ ...createState(), selectedEntity: 'lighting', darkBackground: true });
		expect(cameraMaterial.color.r).toBeGreaterThan(darkNeutral.r);
		expect(cameraMaterial.color.g).toBeGreaterThan(darkNeutral.g);
		expect(cameraMaterial.color.equals(lightMaterial.color)).toBe(false);
		helpers.group.traverse((object) => {
			expect(object instanceof THREE.Mesh).toBe(false);
			if (!(object instanceof THREE.LineSegments)) return;
			const material = object.material as THREE.LineBasicMaterial;
			expect(material.depthTest).toBe(false);
			expect(material.depthWrite).toBe(false);
		});
		helpers.dispose();
	});

	it('should release its geometries and shared materials exactly once', () => {
		const helpers = createSceneEditHelpers();
		const parent = new THREE.Scene();
		parent.add(helpers.group);
		const geometries = new Set<THREE.BufferGeometry>();
		const materials = new Set<THREE.Material>();
		helpers.group.traverse((object) => {
			if (!(object instanceof THREE.LineSegments)) return;
			geometries.add(object.geometry);
			for (const material of Array.isArray(object.material) ? object.material : [object.material])
				materials.add(material);
		});
		const spies = [...geometries, ...materials].map((resource) => vi.spyOn(resource, 'dispose'));
		helpers.dispose();
		helpers.dispose();
		for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
		expect(parent.children).toHaveLength(0);
		expect(helpers.pickables).toHaveLength(0);
		helpers.update(createState());
		expect(helpers.group.visible).toBe(false);
	});
});

function createState(): TSceneEditHelperState {
	return {
		cameraPose: { position: [-2, 0, 0], target: [-2, 0, -10], fov: 38 },
		aspect: 9 / 16,
		lightingPosition: [2, 0, 0],
		lightingTarget: [2, 0, -5],
		selectedEntity: null,
		visible: true
	};
}
