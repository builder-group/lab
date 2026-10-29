import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Consumes owned, same-material hardware geometries and bakes their parent-local transforms. */
export function mergeInstrumentHardware(meshes: readonly THREE.Mesh[], name: string): THREE.Mesh {
	const first = meshes[0];
	if (first == null) throw new Error('Instrument hardware needs at least one mesh.');
	const geometries = meshes.map((mesh) => {
		mesh.updateMatrix();
		return mesh.geometry.applyMatrix4(mesh.matrix);
	});
	const geometry = mergeGeometries(geometries, false);
	for (const part of geometries) part.dispose();
	if (geometry == null)
		throw new Error('Instrument hardware geometries must have matching attributes.');
	const merged = new THREE.Mesh(geometry, first.material);
	merged.name = name;
	merged.castShadow = first.castShadow;
	merged.receiveShadow = first.receiveShadow;
	return merged;
}
