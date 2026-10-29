import type { TSceneObject, TVec3 } from '../project/types';

/** Keeps the physical front lip and its visible geometry aligned in object-local space. */
export function getFrontFlangeGeometry(object: TSceneObject): TFrontFlangeGeometry | null {
	if (object.kind !== 'bar' || object.mountStyle !== 'folded-front') return null;
	const [width, height, depth] = object.size;
	const alongDepth = depth > width;
	const thickness = Math.max(0.025, height * 0.6);
	return {
		size: [alongDepth ? width : thickness, 0.1, alongDepth ? thickness : depth],
		position: [alongDepth ? 0 : width * 0.5, height * 0.5 + 0.05, alongDepth ? depth * 0.5 : 0]
	};
}

interface TFrontFlangeGeometry {
	size: TVec3;
	position: TVec3;
}
