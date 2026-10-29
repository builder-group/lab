import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { clearGroup } from './scene-resources';

describe('clearGroup function', () => {
	it('should release owned surface and shadow materials without disposing shared assets', () => {
		const sharedTexture = new THREE.Texture();
		const shared = new THREE.MeshStandardMaterial({ map: sharedTexture });
		const owned = shared.clone();
		const mesh = new THREE.Mesh(new THREE.BoxGeometry(), shared);
		mesh.userData['renderMaterial'] = owned;
		mesh.customDepthMaterial = new THREE.MeshDepthMaterial();
		mesh.customDistanceMaterial = new THREE.MeshDistanceMaterial();
		const disposals = [owned, mesh.customDepthMaterial, mesh.customDistanceMaterial].map(
			(material) => vi.spyOn(material, 'dispose')
		);
		const sharedDisposal = vi.spyOn(shared, 'dispose');
		const textureDisposal = vi.spyOn(sharedTexture, 'dispose');
		const geometryDisposal = vi.spyOn(mesh.geometry, 'dispose');
		const group = new THREE.Group();
		const flange = new THREE.Mesh(new THREE.BoxGeometry(), owned);
		flange.customDepthMaterial = mesh.customDepthMaterial;
		flange.customDistanceMaterial = mesh.customDistanceMaterial;
		const flangeGeometryDisposal = vi.spyOn(flange.geometry, 'dispose');
		group.add(mesh, flange);

		clearGroup(group, new Set([shared]), sharedTexture);

		for (const disposal of disposals) expect(disposal).toHaveBeenCalledOnce();
		expect(geometryDisposal).toHaveBeenCalledOnce();
		expect(flangeGeometryDisposal).toHaveBeenCalledOnce();
		expect(sharedDisposal).not.toHaveBeenCalled();
		expect(textureDisposal).not.toHaveBeenCalled();
		expect(group.children).toHaveLength(0);
	});

	it('should release an owned texture once when several materials reference it', () => {
		const texture = new THREE.Texture();
		const textureDisposal = vi.spyOn(texture, 'dispose');
		const first = new THREE.MeshBasicMaterial({ map: texture });
		const second = first.clone();
		const group = new THREE.Group();
		group.add(new THREE.Mesh(new THREE.BoxGeometry(), [first, second]));

		clearGroup(group, new Set(), new THREE.Texture());

		expect(textureDisposal).toHaveBeenCalledOnce();
	});
});
