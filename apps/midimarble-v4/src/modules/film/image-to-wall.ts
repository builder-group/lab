import * as THREE from 'three';
import { verticalFov, type TCameraPose } from '@/modules/camera';
import type { TVec2 } from '@/modules/project';

/**
 * Wall point under a point of the film frame, in 0..1 image coordinates, seen through the film camera's pose.
 * Null when the ray misses the wall.
 */
export function imageToWall(pose: TCameraPose, aspect: number, u: number, v: number): TVec2 | null {
	const halfHeight = Math.tan((verticalFov(pose.lens, aspect) * Math.PI) / 360);
	const halfWidth = halfHeight * aspect;
	// Blender camera space: x right, y up, looking along -z
	const ray = new THREE.Vector3((u * 2 - 1) * halfWidth, (1 - v * 2) * halfHeight, -1);
	const [w, x, y, z] = pose.rotation;
	ray.applyQuaternion(new THREE.Quaternion(x, y, z, w));
	const [px, py, pz] = pose.position;
	// The wall surface is Blender's y = 0, the camera stands in front of it at negative y
	if (Math.abs(ray.y) < 1e-9) return null;
	const reach = -py / ray.y;
	if (reach <= 0) return null;
	return { x: px + ray.x * reach, y: pz + ray.z * reach };
}
