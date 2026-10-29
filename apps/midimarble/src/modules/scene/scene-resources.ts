import * as THREE from 'three';

/** Releases owned scene assets while preserving the shared material and texture pool. */
export function clearGroup(
	group: THREE.Object3D,
	shared: Set<THREE.Material>,
	sharedTexture: THREE.Texture
) {
	const materials = new Set<THREE.Material>();
	const sharedTextures = new Set<THREE.Texture>([sharedTexture]);
	for (const material of shared) {
		if ('map' in material && material.map instanceof THREE.Texture)
			sharedTextures.add(material.map);
	}
	group.traverse((child) => {
		const surface = child.userData['surfaceMaterial'] as THREE.Material | undefined;
		if (surface != null && !shared.has(surface)) materials.add(surface);
		if (!(
			child instanceof THREE.Mesh ||
			child instanceof THREE.Line ||
			child instanceof THREE.Sprite
		))
			return;
		if ('geometry' in child) child.geometry.dispose();
		const original = child.userData['renderMaterial'] as
			THREE.Material | THREE.Material[] | undefined;
		const materialSource = original ?? child.material;
		for (const material of Array.isArray(materialSource) ? materialSource : [materialSource]) {
			if (!shared.has(material)) materials.add(material);
		}
		if (child instanceof THREE.Mesh) {
			if (child.customDepthMaterial != null) materials.add(child.customDepthMaterial);
			if (child.customDistanceMaterial != null) materials.add(child.customDistanceMaterial);
		}
	});
	const textures = new Set<THREE.Texture>();
	for (const material of materials) {
		if (
			'map' in material &&
			material.map instanceof THREE.Texture &&
			!sharedTextures.has(material.map)
		)
			textures.add(material.map);
		material.dispose();
	}
	for (const texture of textures) texture.dispose();
	group.clear();
}
