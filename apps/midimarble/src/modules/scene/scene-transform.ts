import * as THREE from 'three';
import type { TSceneObject, TVec3 } from '../project';

/** Finds drag motion on a world axis, including depth axes facing the camera. */
export function axisDragDistance(
	camera: THREE.PerspectiveCamera,
	origin: THREE.Vector3,
	axis: THREE.Vector3,
	start: THREE.Vector2,
	current: THREE.Vector2
): number {
	const raycaster = new THREE.Raycaster();
	const offset = camera.getWorldPosition(new THREE.Vector3()).sub(origin);
	const projectedOrigin = origin.clone().project(camera);
	const projectedEnd = origin.clone().add(axis).project(camera);
	const direction = new THREE.Vector2(
		projectedEnd.x - projectedOrigin.x,
		projectedEnd.y - projectedOrigin.y
	);
	function closestCoordinate(pointer: THREE.Vector2): number | null {
		if (direction.lengthSq() < 0.00001) return null;
		const projection =
			(pointer.x - projectedOrigin.x) * direction.x + (pointer.y - projectedOrigin.y) * direction.y;
		const snapped = new THREE.Vector2(projectedOrigin.x, projectedOrigin.y).addScaledVector(
			direction,
			projection / direction.lengthSq()
		);
		raycaster.setFromCamera(snapped, camera);
		const alignment = axis.dot(raycaster.ray.direction);
		const denominator = 1 - alignment * alignment;
		if (denominator < 0.002) return null;
		return (axis.dot(offset) - alignment * raycaster.ray.direction.dot(offset)) / denominator;
	}
	const a = closestCoordinate(start);
	const b = closestCoordinate(current);
	if (a != null && b != null) return b - a;
	return (
		-(current.y - start.y) * offset.length() * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
	);
}

/** Keeps viewport edits inside the same limits as the saved project format. */
export function boundTransform(
	source: TSceneObject,
	position: TVec3,
	rotation: TVec3,
	scale: TVec3
): TBoundTransform {
	const finite = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);
	const boundedPosition = position.map((value, index) =>
		THREE.MathUtils.clamp(finite(value, source.position[index] ?? 0), -1e6, 1e6)
	) as TVec3;
	const boundedRotation = rotation.map(
		(value, index) =>
			THREE.MathUtils.euclideanModulo(
				finite(value, source.rotation[index] ?? 0) + Math.PI,
				Math.PI * 2
			) - Math.PI
	) as TVec3;
	const size = source.size.map((value, index) =>
		THREE.MathUtils.clamp(finite(Math.abs(value * (scale[index] ?? 1)), value), 0.02, 50)
	) as TVec3;
	const path = source.path?.map(
		(point) =>
			point.map((value, index) =>
				THREE.MathUtils.clamp(finite(value * (scale[index] ?? 1), value), -100, 100)
			) as TVec3
	);
	return {
		position: boundedPosition,
		rotation: boundedRotation,
		size,
		...(path == null ? {} : { path })
	};
}

interface TBoundTransform {
	position: TVec3;
	rotation: TVec3;
	size: TVec3;
	path?: TVec3[];
}
