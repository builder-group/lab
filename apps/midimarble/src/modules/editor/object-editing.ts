import { Euler, Quaternion, Vector3 } from 'three';
import type { TResolvedObject, TSceneObject, TVec3 } from '../project';

/** Converts a visible drag into an offset from the last baked anchor. */
export function getObjectMovePatch(
	object: TSceneObject,
	resolved: TResolvedObject | undefined,
	position: TVec3
): Partial<TSceneObject> | null {
	if (object.locked) return null;
	if (object.binding == null && object.trajectoryAnchor == null)
		return {
			position: position.map((value) => Math.max(-1_000_000, Math.min(1_000_000, value))) as TVec3
		};
	if (resolved == null) return null;
	const base =
		object.binding != null
			? resolved.binding?.noteId === object.binding.noteId
				? resolved.binding.offset
				: [0, 0, 0]
			: resolved.trajectoryAnchor?.time === object.trajectoryAnchor?.time
				? (resolved.trajectoryAnchor?.offset ?? [0, 0, 0])
				: [0, 0, 0];
	const offset = position.map((value, index) =>
		Math.max(
			-1_000_000,
			Math.min(1_000_000, value - (resolved.position[index] ?? 0) + (base[index] ?? 0))
		)
	) as TVec3;
	return object.binding
		? { binding: { ...object.binding, offset } }
		: object.trajectoryAnchor
			? { trajectoryAnchor: { ...object.trajectoryAnchor, offset } }
			: null;
}

/** Path length is encoded by its local X coordinates; the other dimensions are wire diameter and gauge. */
export function getObjectSizePatch(object: TSceneObject, size: TVec3): Partial<TSceneObject> {
	const patch: Partial<TSceneObject> = { size };
	if (object.kind === 'rail' && object.path && size[0] !== object.size[0]) {
		const ratio = size[0] / object.size[0];
		patch.path = object.path.map(([x, y, z]) => [Math.max(-100, Math.min(100, x * ratio)), y, z]);
	}
	return patch;
}

/** Moves the strike along the key while retaining its height and side offsets. */
export function getStrikePointPatch(
	object: TSceneObject,
	point: Exclude<TStrikePoint, 'custom'>
): Partial<TSceneObject> | null {
	const anchor = object.binding ?? object.trajectoryAnchor;
	if (object.kind !== 'bar' || anchor == null || object.locked) return null;
	const rotation = new Quaternion().setFromEuler(new Euler(...object.rotation));
	const offset = new Vector3(...anchor.offset).applyQuaternion(rotation.clone().invert());
	const axis = object.size[2] >= object.size[0] ? 'z' : 'x';
	const length = axis === 'z' ? object.size[2] : object.size[0];
	offset[axis] = point === 'tip' ? -length * 0.45 : point === 'mount' ? length * 0.45 : 0;
	const next = offset.applyQuaternion(rotation).toArray() as TVec3;
	return object.binding != null
		? { binding: { ...object.binding, offset: next } }
		: object.trajectoryAnchor != null
			? { trajectoryAnchor: { ...object.trajectoryAnchor, offset: next } }
			: null;
}

export function getStrikePoint(object: TSceneObject): TStrikePoint {
	const anchor = object.binding ?? object.trajectoryAnchor;
	if (anchor == null) return 'center';
	const rotation = new Quaternion().setFromEuler(new Euler(...object.rotation));
	const offset = new Vector3(...anchor.offset).applyQuaternion(rotation.invert());
	const axis = object.size[2] >= object.size[0] ? 'z' : 'x';
	const length = axis === 'z' ? object.size[2] : object.size[0];
	if (Math.abs(offset[axis]) < 0.0001) return 'center';
	if (Math.abs(offset[axis] + length * 0.45) < 0.0001) return 'tip';
	if (Math.abs(offset[axis] - length * 0.45) < 0.0001) return 'mount';
	return 'custom';
}

export type TStrikePoint = 'tip' | 'center' | 'mount' | 'custom';
