import * as THREE from 'three';
import { getRailGeometry } from '../motion';
import type { TSceneObject, TSceneStyle } from '../project';

export function getWallPosition(
	style: TSceneStyle | undefined,
	launchZ: number,
	objects: TSceneObject[]
): number {
	if (style?.wallPosition != null) return style.wallPosition;
	const wallStudio = style?.theme === 'wall';
	const clearance = style?.wallClearance ?? (wallStudio ? 0.06 : 0.65);
	const minZ = Math.min(
		launchZ,
		...objects.filter((object) => !object.disabled).map((object) => getObjectBounds(object).min.z)
	);
	return Math.min(wallStudio ? 0 : -1.1, minZ - clearance);
}

/** Editor framing follows tangible surfaces rather than additive light halos. */
export function getPhysicalBounds(root: THREE.Object3D): THREE.Box3 {
	const bounds = new THREE.Box3();
	root.updateWorldMatrix(true, true);
	root.traverse((child) => {
		if (!(child instanceof THREE.Mesh) || child.name === 'impact-glow') return;
		if (child.geometry.boundingBox == null) child.geometry.computeBoundingBox();
		if (child.geometry.boundingBox != null)
			bounds.union(child.geometry.boundingBox.clone().applyMatrix4(child.matrixWorld));
	});
	return bounds;
}

/** Includes pending world edits before a new physics bake has supplied its bounds. */
export function getObjectBounds(object: TSceneObject): THREE.Box3 {
	const local = new THREE.Box3();
	let padding = 0;
	if (object.kind === 'rail' && object.path != null) {
		const rail = getRailGeometry(object);
		for (const point of [...rail.paths[0], ...rail.paths[1]])
			local.expandByPoint(new THREE.Vector3(...point));
		padding = rail.radius;
	} else {
		const size =
			object.kind === 'bumper'
				? new THREE.Vector3().setScalar(Math.max(...object.size))
				: new THREE.Vector3(...object.size);
		local.setFromCenterAndSize(new THREE.Vector3(), size);
	}
	const matrix = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...object.rotation));
	matrix.setPosition(...object.position);
	return local.applyMatrix4(matrix).expandByScalar(padding);
}
