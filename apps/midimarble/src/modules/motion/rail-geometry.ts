import type { TSceneObject, TVec3 } from '../project/types';

/** Builds the paired wire centerlines shared by physical capsules and visible rail tubes. */
export function getRailGeometry(object: TSceneObject): TRailGeometry {
	const centerline = object.path ?? [
		[-object.size[0] / 2, 0, 0],
		[object.size[0] / 2, 0, 0]
	];
	const paths: [TVec3[], TVec3[]] = [[], []];
	for (let index = 0; index < centerline.length; index++) {
		const point = centerline[index];
		if (point == null) continue;
		const previous = centerline[Math.max(0, index - 1)] ?? point;
		const next = centerline[Math.min(centerline.length - 1, index + 1)] ?? point;
		const dx = next[0] - previous[0];
		const dz = next[2] - previous[2];
		const length = Math.hypot(dx, dz);
		const side: TVec3 = length > 1e-8 ? [-dz / length, 0, dx / length] : [0, 0, 1];
		for (const [sideIndex, sign] of [-1, 1].entries()) {
			paths[sideIndex]?.push(
				point.map((value, axis) => value + ((side[axis] ?? 0) * sign * object.size[2]) / 2) as TVec3
			);
		}
	}
	return { paths, radius: Math.max(0.01, object.size[1] / 2) };
}

export interface TRailGeometry {
	paths: [TVec3[], TVec3[]];
	radius: number;
}
