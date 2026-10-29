import type * as THREE from 'three';

/** Three's raycaster intersects hidden descendants unless the editor filters their full hierarchy. */
export function isScenePickVisible(object: THREE.Object3D): boolean {
	let current: THREE.Object3D | null = object;
	while (current) {
		if (!current.visible) return false;
		current = current.parent;
	}
	return true;
}
