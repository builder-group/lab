import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createCatalogObject } from '../project';
import { mergeInstrumentHardware } from './instrument-hardware';
import { createMaterials, makeInstrument } from './scene-assets';
import { clearGroup } from './scene-resources';

describe('mergeInstrumentHardware function', () => {
	it('should preserve transformed vertices, normals, colors and triangles in a single material draw', () => {
		const material = new THREE.MeshStandardMaterial({ color: '#c4b39a', vertexColors: true });
		const parent = new THREE.Group();
		parent.position.set(3, -12, 2);
		parent.rotation.set(0.3, -0.2, 0.4);
		const parts = [
			new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 10), material),
			new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), material),
			new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.03), material)
		];
		for (const [index, part] of parts.entries()) {
			part.position.set(index * 0.7, -0.04, index * -0.6);
			part.rotation.set(0.2 * index, -0.3, 0.4);
			part.scale.set(1, 1 + index * 0.2, 0.8);
			part.castShadow = true;
			part.receiveShadow = true;
			const colors = new Float32Array(part.geometry.getAttribute('position').count * 3);
			for (let vertex = 0; vertex < colors.length; vertex++) colors[vertex] = (vertex % 3) * 0.3;
			part.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
			parent.add(part);
		}
		parent.updateMatrixWorld(true);
		const bounds = new THREE.Box3().setFromObject(parent, true);
		const expected = parts.flatMap((part) => {
			const normalMatrix = new THREE.Matrix3().getNormalMatrix(part.matrixWorld);
			const position = part.geometry.getAttribute('position');
			const normal = part.geometry.getAttribute('normal');
			const color = part.geometry.getAttribute('color');
			return Array.from({ length: position.count }, (_, index) => ({
				position: new THREE.Vector3()
					.fromBufferAttribute(position, index)
					.applyMatrix4(part.matrixWorld),
				normal: new THREE.Vector3()
					.fromBufferAttribute(normal, index)
					.applyNormalMatrix(normalMatrix),
				color: new THREE.Vector3().fromBufferAttribute(color, index)
			}));
		});
		const triangles = parts.reduce((sum, part) => sum + (part.geometry.index?.count ?? 0) / 3, 0);
		const merged = mergeInstrumentHardware(parts, 'mount-hardware');
		parent.remove(...parts);
		parent.add(merged);
		parent.updateMatrixWorld(true);

		expect(parent.children).toHaveLength(1);
		expect(merged.geometry.groups).toHaveLength(0);
		expect(merged.geometry.index?.count).toBe(triangles * 3);
		expect(merged.material).toBe(material);
		expect(material.color.getHexString()).toBe('c4b39a');
		expect(merged.castShadow).toBe(true);
		expect(merged.receiveShadow).toBe(true);
		const actualBounds = new THREE.Box3().setFromObject(parent, true);
		expect(actualBounds.min.distanceTo(bounds.min)).toBeLessThan(1e-6);
		expect(actualBounds.max.distanceTo(bounds.max)).toBeLessThan(1e-6);
		const normalMatrix = new THREE.Matrix3().getNormalMatrix(merged.matrixWorld);
		for (const [index, vertex] of expected.entries()) {
			const position = new THREE.Vector3()
				.fromBufferAttribute(merged.geometry.getAttribute('position'), index)
				.applyMatrix4(merged.matrixWorld);
			const normal = new THREE.Vector3()
				.fromBufferAttribute(merged.geometry.getAttribute('normal'), index)
				.applyNormalMatrix(normalMatrix);
			const color = new THREE.Vector3().fromBufferAttribute(
				merged.geometry.getAttribute('color'),
				index
			);
			expect(position.distanceTo(vertex.position)).toBeLessThan(1e-6);
			expect(normal.distanceTo(vertex.normal)).toBeLessThan(1e-6);
			expect(color).toEqual(vertex.color);
		}
		clearGroup(parent, new Set(), new THREE.Texture());
	});

	it('should dispose consumed geometries and the merged geometry once while retaining shared materials', () => {
		const material = new THREE.MeshStandardMaterial();
		const parts = [
			new THREE.Mesh(new THREE.CylinderGeometry(), material),
			new THREE.Mesh(new THREE.SphereGeometry(), material)
		];
		const originalDisposals = parts.map((part) => vi.spyOn(part.geometry, 'dispose'));
		const materialDisposal = vi.spyOn(material, 'dispose');
		const merged = mergeInstrumentHardware(parts, 'hardware');
		for (const disposal of originalDisposals) expect(disposal).toHaveBeenCalledOnce();
		expect(materialDisposal).not.toHaveBeenCalled();
		const geometryDisposal = vi.spyOn(merged.geometry, 'dispose');
		const parent = new THREE.Group();
		parent.add(merged);
		clearGroup(parent, new Set([material]), new THREE.Texture());
		expect(geometryDisposal).toHaveBeenCalledOnce();
		expect(materialDisposal).not.toHaveBeenCalled();
		for (const disposal of originalDisposals) expect(disposal).toHaveBeenCalledOnce();
		material.dispose();
	});

	it.each([
		['pins', 6],
		['rack', 4],
		['folded-front', 7],
		['folded', 4]
	] as const)(
		'should reduce %s hardware while retaining the surface, flex and named parts',
		(mountStyle, count) => {
			vi.stubGlobal('document', {
				createElement: () => ({ width: 0, height: 0, getContext: () => null })
			});
			const materials = createMaterials();
			const object = { ...createCatalogObject('key-spoon'), mountStyle, glowEndColor: '#a823cd' };
			const group = makeInstrument(object, materials, -0.7, true);
			try {
				const meshes: THREE.Mesh[] = [];
				group.traverse((child) => {
					if (child instanceof THREE.Mesh) meshes.push(child);
				});
				expect(meshes).toHaveLength(count);
				expect(group.userData['objectId']).toBe(object.id);
				const surface = group.userData['surfaceMesh'] as THREE.Mesh;
				expect(surface.parent?.name).toBe('flex');
				expect(surface.customDepthMaterial).toBeDefined();
				expect(surface.customDistanceMaterial).toBeDefined();
				expect(surface.material).toBe(group.userData['surfaceMaterial']);
				const material = surface.material as THREE.MeshStandardMaterial;
				expect(material.customProgramCacheKey()).toContain('glow-gradient');
				expect(group.getObjectByName('impact-glow')?.parent?.name).toBe('flex');
				expect(group.getObjectByName('wall-mount-hardware')?.parent).toBe(group);
				if (mountStyle === 'pins' || mountStyle === 'folded-front') {
					expect(group.getObjectByName('key-mount-bridge')).toBeDefined();
					expect(group.getObjectByName('key-fasteners')?.parent?.name).toBe('flex');
					expect(group.getObjectByName('key-felt-pads')?.parent).toBe(group);
					if (mountStyle === 'folded-front')
						expect(group.getObjectByName('folded-front-flange')?.parent?.name).toBe('flex');
				} else if (mountStyle === 'rack')
					expect(group.getObjectByName('key-rail-bed')?.parent?.name).toBe('flex');
				else expect(group.getObjectByName('folded-rear-flange')?.parent?.name).toBe('flex');
			} finally {
				clearGroup(group, materials.shared, materials.glowTexture);
				materials.dispose();
				vi.unstubAllGlobals();
			}
		}
	);
});
