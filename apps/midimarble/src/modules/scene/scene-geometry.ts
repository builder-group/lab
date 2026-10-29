import * as THREE from 'three';
import type { TResolvedObject } from '../project';

/** Keeps GPU meshes alive when a physics update changes only world placement. */
export function reconcileSceneObjects(
	root: THREE.Group,
	groups: Map<string, THREE.Group>,
	signatures: Map<string, string>,
	objects: TResolvedObject[],
	wallZ: number,
	build: (object: TResolvedObject) => THREE.Group,
	dispose: (group: THREE.Group) => void,
	preservePose: Set<string> = new Set()
): void {
	const live = new Set<string>();
	for (const object of objects) {
		if (object.disabled) continue;
		live.add(object.id);
		let group = groups.get(object.id);
		if (group && preservePose.has(object.id)) continue;
		const signature = JSON.stringify([
			object.kind,
			object.modelId,
			object.mountStyle,
			object.roundedNose ?? false,
			object.size,
			object.path,
			object.material,
			object.materialFinish,
			object.color,
			object.glowColor,
			object.glowEndColor,
			object.emission,
			object.position[2],
			object.rotation,
			wallZ
		]);
		if (group == null || signature !== signatures.get(object.id)) {
			if (group) {
				root.remove(group);
				dispose(group);
			}
			group = build(object);
			groups.set(object.id, group);
			signatures.set(object.id, signature);
			root.add(group);
		}
		group.position.fromArray(object.position);
		group.rotation.set(...object.rotation);
		group.scale.set(1, 1, 1);
	}
	for (const [id, group] of groups)
		if (!live.has(id)) {
			root.remove(group);
			dispose(group);
			groups.delete(id);
			signatures.delete(id);
		}
}
