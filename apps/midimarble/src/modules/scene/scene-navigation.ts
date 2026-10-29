import * as THREE from 'three';
import type { TVec3 } from '../project';

/** Rotates both eye and look target around a chosen pivot without recentering the selection. */
export function orbitAroundPivot(
	position: TVec3,
	target: TVec3,
	pivot: TVec3,
	yaw: number,
	pitch: number
): { position: TVec3; target: TVec3 } {
	const eye = new THREE.Vector3(...position),
		look = new THREE.Vector3(...target),
		center = new THREE.Vector3(...pivot);
	const forward = look.clone().sub(eye).normalize();
	const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
	if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
	const rotation = new THREE.Quaternion()
		.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
		.multiply(
			new THREE.Quaternion().setFromAxisAngle(
				right,
				THREE.MathUtils.clamp(pitch, -Math.PI * 0.45, Math.PI * 0.45)
			)
		);
	return {
		position: eye.sub(center).applyQuaternion(rotation).add(center).toArray() as TVec3,
		target: look.sub(center).applyQuaternion(rotation).add(center).toArray() as TVec3
	};
}
