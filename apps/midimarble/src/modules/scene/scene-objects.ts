import type { TPerformance, TResolvedObject, TSceneObject, TVec3 } from '../project';

/** Keeps direct edits visible while the worker rebuilds downstream physics. */
export function getVisualObjects(
	objects: TSceneObject[],
	performance: TPerformance | null
): TResolvedObject[] {
	const baked = new Map(performance?.objects.map((object) => [object.id, object]) ?? []);
	return objects.map((object) => {
		const resolved = baked.get(object.id);
		let position = object.position;
		if ((object.binding != null || object.trajectoryAnchor != null) && resolved != null) {
			position = resolved.position;

			const sameNote = object.binding != null && resolved.binding?.noteId === object.binding.noteId;
			const sameTime =
				object.trajectoryAnchor != null &&
				resolved.trajectoryAnchor?.time === object.trajectoryAnchor.time;
			const offset = object.binding?.offset ?? object.trajectoryAnchor?.offset;
			const previousOffset = sameNote
				? resolved.binding?.offset
				: sameTime
					? resolved.trajectoryAnchor?.offset
					: null;
			if (offset && previousOffset)
				position = resolved.position.map(
					(value, index) => value + (offset[index] ?? 0) - (previousOffset[index] ?? 0)
				) as TVec3;
		}
		return { ...resolved, ...object, position };
	});
}
