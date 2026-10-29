import type { TPerformance, TProject, TSceneObject } from '../project/types';
import { getFrontFlangeGeometry } from './key-geometry';
import { getMotionSignature } from './motion-signature';
import { getRailGeometry } from './rail-geometry';

/** Reuses a bake only when changed world solids cannot reach any recorded predictor or playback sweep. */
export function canReuseWorldEdit(
	project: TProject,
	previous: { project: TProject; performance: TPerformance }
): boolean {
	const bounds = previous.performance.influenceBounds;
	if (
		bounds == null ||
		!Array.isArray(bounds.min) ||
		!Array.isArray(bounds.max) ||
		bounds.min.length !== 3 ||
		bounds.max.length !== 3 ||
		![...bounds.min, ...bounds.max].every(Number.isFinite) ||
		bounds.min.some((value, axis) => value > (bounds.max[axis] ?? -Infinity))
	)
		return false;
	const withoutWorld = (document: TProject) => ({
		...document,
		objects: document.objects.filter((object) => !isWorldObject(object))
	});
	if (
		getMotionSignature(withoutWorld(project)) !== getMotionSignature(withoutWorld(previous.project))
	)
		return false;
	const before = new Map(
		previous.project.objects.filter(isWorldObject).map((object) => [object.id, object])
	);
	const after = new Map(project.objects.filter(isWorldObject).map((object) => [object.id, object]));
	for (const id of new Set([...before.keys(), ...after.keys()])) {
		const oldObject = before.get(id);
		const newObject = after.get(id);
		if (JSON.stringify(oldObject) === JSON.stringify(newObject)) continue;
		for (const object of [oldObject, newObject]) {
			if (object == null || object.disabled) continue;
			const radius = getCollisionRadius(object);
			if (!Number.isFinite(radius)) return false;
			const outside = object.position.some(
				(value, axis) =>
					value + radius < (bounds.min[axis] ?? -Infinity) ||
					value - radius > (bounds.max[axis] ?? Infinity)
			);
			if (!outside) return false;
		}
	}
	return true;
}

function isWorldObject(object: TSceneObject): boolean {
	return object.binding == null && object.trajectoryAnchor == null;
}

function getCollisionRadius(object: TSceneObject): number {
	if (object.kind === 'rail' && object.path != null) {
		const geometry = getRailGeometry(object);
		return (
			Math.max(...geometry.paths.flat().map((point) => Math.hypot(...point))) + geometry.radius
		);
	}
	const [width = 0.04, height = 0.04, depth = 0.04] = object.size.map((value) =>
		Math.max(0.04, value)
	);
	// Rotation-independent spheres include the physical bowl rim and folded front lip.
	let radius = Math.hypot(width, height, depth) / 2;
	if (object.kind === 'bowl') {
		const overhang = (width * Math.PI) / 40 + Math.min(0.08, height * 0.3) / 2;
		radius = Math.hypot(width / 2 + overhang, height / 2, depth / 2 + overhang);
	}
	const flange = getFrontFlangeGeometry(object);
	if (flange != null)
		radius = Math.max(radius, Math.hypot(...flange.position) + Math.hypot(...flange.size) / 2);
	return radius + 0.01;
}
