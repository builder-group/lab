import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createCatalogObject, type TObjectModelId } from '../project';
import {
	createMaterials,
	makeInstrument,
	updateInstrumentReaction,
	type TMaterials
} from './scene-assets';
import { clearGroup } from './scene-resources';

describe('createMaterials function', () => {
	it('should create refractive glass and preserve thin glass dimensions and metallic supports', () => {
		vi.stubGlobal('document', {
			createElement: () => ({ width: 0, height: 0, getContext: () => null })
		});
		const materials = createMaterials();
		try {
			expect(materials.glass.transmission).toBeGreaterThanOrEqual(0.85);
			expect(materials.glass.transmission).toBeLessThanOrEqual(1);
			expect(materials.glass.metalness).toBe(0);
			expect(materials.glass.ior).toBeGreaterThan(1);
			expect(materials.glass.clearcoat).toBe(0);
			const object = {
				...createCatalogObject('key-panel'),
				material: 'glass' as const,
				color: '#b5e0d8',
				size: [0.8, 0.045, 1.5] as [number, number, number]
			};
			const group = makeInstrument(object, materials, -0.7, true);
			const glass = group.userData['surfaceMaterial'] as THREE.MeshPhysicalMaterial;
			expect(glass.transmission).toBe(materials.glass.transmission);
			expect(glass.thickness).toBe(object.size[1]);
			expect(glass.color.getHexString()).toBe('b5e0d8');
			expect(glass).not.toBe(materials.glass);
			const bridge = group.getObjectByName('key-mount-bridge') as THREE.Mesh;
			expect(bridge.material).toBe(materials.metal);
			expect(
				[glass.thickness, glass.ior, glass.roughness, glass.transmission].every(Number.isFinite)
			).toBe(true);
		} finally {
			materials.dispose();
			vi.unstubAllGlobals();
		}
	});
});

describe('makeInstrument function', () => {
	it.each([
		[0.35, 0.12, 1.5],
		[1.5, 0.12, 0.35]
	])(
		'should bound a resonator body and dark endcap to its physical size (%s, %s, %s)',
		(width, height, depth) => {
			const object = {
				...createCatalogObject('key-block'),
				size: [width, height, depth] as [number, number, number],
				rotation: [0, 0, 0] as [number, number, number]
			};
			const materials = makeMaterials();
			const group = makeInstrument(object, materials);
			const body = group.userData['surfaceMesh'] as THREE.Mesh;
			const cap = group.getObjectByName('key-endcap') as THREE.Mesh;
			expect(cap).toBeInstanceOf(THREE.Mesh);
			const bounds = new THREE.Box3()
				.setFromObject(body)
				.union(new THREE.Box3().setFromObject(cap));
			const size = bounds.getSize(new THREE.Vector3()).toArray();
			for (const [axis, dimension] of object.size.entries()) {
				expect(size[axis]).toBeCloseTo(dimension, 6);
				expect(bounds.min.getComponent(axis)).toBeCloseTo(-dimension / 2, 6);
				expect(bounds.max.getComponent(axis)).toBeCloseTo(dimension / 2, 6);
			}
			const axis = depth > width ? 'z' : 'x';
			const capBounds = new THREE.Box3().setFromObject(cap);
			expect(capBounds.min[axis]).toBeGreaterThan(Math.max(width, depth) * 0.4);
			group.updateMatrixWorld(true);
			const hit = new THREE.Raycaster(
				new THREE.Vector3(0, 1, 0),
				new THREE.Vector3(0, -1, 0)
			).intersectObject(body)[0];
			expect(hit?.point.y).toBeCloseTo(height / 2, 6);
			expect((group.getObjectByName('key-mount-bridge') as THREE.Mesh).material).toBe(
				materials.metal
			);
			expect(group.getObjectByName('key-fasteners')).toBeDefined();
		}
	);

	it('should bend and illuminate the resonator endcap with the body while retaining its dark finish', () => {
		const object = createCatalogObject('key-block');
		const group = makeInstrument(object, makeMaterials());
		const material = group.userData['surfaceMaterial'] as THREE.MeshStandardMaterial;
		const cap = group.getObjectByName('key-endcap') as THREE.Mesh;
		const capMaterial = cap.material as THREE.MeshStandardMaterial;
		const shaders = [capMaterial, cap.customDepthMaterial, cap.customDistanceMaterial].map(
			(source) => {
				if (source == null) throw new Error('Expected resonator cap and shadow materials.');
				const shader = {
					uniforms: {},
					vertexShader: '#include <beginnormal_vertex>\n#include <begin_vertex>',
					fragmentShader: ''
				} as Parameters<THREE.Material['onBeforeCompile']>[0];
				source.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
				expect(shader.uniforms['uFlex']).toBe(material.userData['flexUniform']);
				return shader;
			}
		);
		expect(capMaterial.emissiveIntensity).toBe(0);
		updateInstrumentReaction(group, object, 1.04, [{ time: 1, strength: 1 }]);
		expect(material.emissiveIntensity).toBeGreaterThan(0);
		expect(capMaterial.emissiveIntensity).toBe(material.emissiveIntensity);
		expect(capMaterial.emissive.getHex()).toBe(material.emissive.getHex());
		expect(capMaterial.color.getHexString()).toBe('1c2025');
		for (const shader of shaders) expect(shader.uniforms['uFlex']?.value).toBeLessThan(0);
		updateInstrumentReaction(group, object, 3, [{ time: 1, strength: 1 }]);
		expect(capMaterial.emissiveIntensity).toBe(0);
	});

	it.each(['key-bar', 'key-panel', 'key-spoon', 'key-strip', 'key-block'] as const)(
		'should seat the flexing %s body on both pins and equip every reacting mesh',
		(model) => {
			const object = { ...createCatalogObject(model), mountStyle: 'pins' as const };
			const group = makeInstrument(object, makeMaterials());
			const body = group.userData['surfaceMesh'] as THREE.Mesh;
			const position = body.geometry.getAttribute('position');
			const axis = object.size[2] > object.size[0] ? 2 : 0;
			const length = Math.max(object.size[0], object.size[2]);
			for (const side of [-1, 1]) {
				const support = side * 0.31 * length;
				const vertices = Array.from({ length: position.count }, (_, index) => index).filter(
					(index) => Math.abs(position.getComponent(index, axis) - support) < 1e-6
				);
				expect(vertices.length).toBeGreaterThan(0);
				for (const index of vertices) {
					expect(body.geometry.getAttribute('aKeyFlex').getX(index)).toBeCloseTo(0, 10);
					expect(body.geometry.getAttribute('aKeyFlexSlope').getX(index)).toBeCloseTo(0, 5);
				}
			}
			group.traverse((mesh) => {
				if (!(mesh instanceof THREE.Mesh) || mesh.customDepthMaterial == null) return;
				const count = mesh.geometry.getAttribute('position').count;
				for (const name of ['aKeyFlex', 'aKeyFlexSlope']) {
					const attribute = mesh.geometry.getAttribute(name);
					expect(attribute.count).toBe(count);
					for (const value of attribute.array) expect(Number.isFinite(value)).toBe(true);
				}
			});
		}
	);

	it.each(['key-spoon', 'key-strip', 'key-block'] as const)(
		'should omit all mounting hardware from an unmounted %s and retain its reacting surfaces',
		(model) => {
			const object = { ...createCatalogObject(model), mountStyle: 'none' as const };
			const materials = makeMaterials();
			const group = makeInstrument(object, materials);
			const flex = group.getObjectByName('flex');
			expect(group.children).toEqual([flex]);
			const body = group.userData['surfaceMesh'] as THREE.Mesh;
			const glow = group.getObjectByName('impact-glow');
			const cap = group.getObjectByName('key-endcap');
			expect(flex?.children).toEqual(cap == null ? [body, glow] : [body, cap, glow]);
			expect(body.castShadow).toBe(true);
			expect(body.receiveShadow).toBe(true);
			expect(body.geometry.getAttribute('aKeyFlex')).toBeDefined();
			const material = body.material as THREE.MeshStandardMaterial;
			updateInstrumentReaction(group, object, 1.04, [{ time: 1, strength: 1 }]);
			expect(material.userData['flexUniform'].value).toBeLessThan(0);
			const owned = [material, body.customDepthMaterial, body.customDistanceMaterial];
			const disposals = owned.map((entry) => {
				if (entry == null) throw new Error('Expected surface and shadow material.');
				const shader = {
					uniforms: {},
					vertexShader: '#include <begin_vertex>',
					fragmentShader: ''
				} as Parameters<THREE.Material['onBeforeCompile']>[0];
				entry.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
				expect(shader.uniforms['uFlex']).toBe(material.userData['flexUniform']);
				return vi.spyOn(entry, 'dispose');
			});
			const geometryDisposal = vi.spyOn(body.geometry, 'dispose');
			clearGroup(group, materials.shared, materials.glowTexture);
			for (const disposal of disposals) expect(disposal).toHaveBeenCalledOnce();
			expect(geometryDisposal).toHaveBeenCalledOnce();
		}
	);

	it('should support rack-mounted panels with a bounded rigid metal frame under the strike face', () => {
		const materials = makeMaterials();
		const object = {
			...createCatalogObject('key-panel'),
			size: [1.4, 0.055, 1.5] as [number, number, number],
			rotation: [0, 0, 0] as [number, number, number],
			mountStyle: 'rack' as const,
			emission: 3
		};
		const group = makeInstrument(object, materials, -0.7, true);
		const rack = group.getObjectByName('key-rail-bed');
		if (rack == null) throw new Error('Expected rail bed.');
		expect(rack.parent?.name).toBe('flex');
		expect(rack.children).toHaveLength(1);
		expect(group.getObjectByName('key-mount-bridge')).toBeUndefined();
		expect(group.getObjectByName('folded-rear-flange')).toBeUndefined();
		const before = new THREE.Box3().setFromObject(rack);
		expect(before.min.x).toBeGreaterThanOrEqual(-object.size[0] / 2 - 1e-6);
		expect(before.max.x).toBeLessThanOrEqual(object.size[0] / 2 + 1e-6);
		expect(before.min.z).toBeGreaterThan(-object.size[2] / 2 - 0.02);
		expect(before.max.z).toBeLessThan(object.size[2] / 2 + 0.02);
		expect(before.max.y).toBeLessThan(-object.size[1] / 2);
		expect(before.min.y).toBeGreaterThan(-object.size[1] / 2 - 0.07);
		updateInstrumentReaction(group, object, 1.04, [{ time: 1, strength: 1 }]);
		expect(new THREE.Box3().setFromObject(rack)).toEqual(before);
		for (const child of rack.children as THREE.Mesh[]) {
			expect(child.material).toBe(materials.metal);
			expect(materials.metal.emissive.getHex()).toBe(0);
			expect(child.customDepthMaterial).toBeUndefined();
		}
	});

	it('should retain the configured metal response in an independent instrument material', () => {
		const materials = makeMaterials();
		materials.metal.roughness = 0.19;
		materials.metal.metalness = 0.97;
		const object = { ...createCatalogObject('key-spoon'), color: '#b5bcc6' };
		const group = makeInstrument(object, materials, -0.7, true);
		const material = group.userData['surfaceMaterial'] as THREE.MeshStandardMaterial;
		expect(material).not.toBe(materials.metal);
		expect(material.roughness).toBe(materials.metal.roughness);
		expect(material.metalness).toBe(materials.metal.metalness);
		expect(material.color.getHexString()).toBe('b5bcc6');
		const bare = makeInstrument({ ...object, materialFinish: 'bare' }, materials, -0.7, true);
		const bareMaterial = bare.userData['surfaceMaterial'] as THREE.MeshStandardMaterial;
		expect(bareMaterial.roughness).toBe(material.roughness);
		expect(bareMaterial.metalness).toBe(material.metalness);
	});

	it('should give painted metal a diffuse coating while preserving its authored color and emission', () => {
		const materials = makeMaterials();
		materials.metal.metalness = 0.93;
		materials.metal.roughness = 0.23;
		const object = {
			...createCatalogObject('key-panel'),
			color: '#4b4c58',
			materialFinish: 'painted' as const
		};
		const painted = makeInstrument(object, materials, -0.7, true);
		const material = painted.userData['surfaceMaterial'] as THREE.MeshStandardMaterial;
		expect(material.metalness).toBeLessThan(0.5);
		expect(material.metalness).toBeGreaterThan(0);
		expect(material.roughness).toBe(0.4);
		expect(material.color.getHexString()).toBe('4b4c58');
		expect(material.emissiveIntensity).toBe(0);
		expect(materials.metal.metalness).toBe(0.93);
		const wood = makeInstrument({ ...object, material: 'wood' }, materials, -0.7, true);
		const woodMaterial = wood.userData['surfaceMaterial'] as THREE.MeshStandardMaterial;
		expect(woodMaterial.metalness).toBe(materials.wood.metalness);
		expect(woodMaterial.roughness).toBe(materials.wood.roughness);
	});

	it('should give a broad spoon a blunt rounded face within its physical footprint', () => {
		const object = {
			...createCatalogObject('key-spoon'),
			roundedNose: false,
			size: [0.8, 0.045, 1.5] as [number, number, number]
		};
		const group = makeInstrument(object, makeMaterials(), -0.7, true);
		const surface = group.userData['surfaceMesh'] as THREE.Mesh;
		const positions = surface.geometry.getAttribute('position');
		const front: number[] = [];
		for (let index = 0; index < positions.count; index++) {
			expect(Math.abs(positions.getX(index))).toBeLessThanOrEqual(object.size[0] / 2 + 1e-6);
			expect(Math.abs(positions.getZ(index))).toBeLessThanOrEqual(object.size[2] / 2 + 1e-6);
			if (positions.getZ(index) >= object.size[2] * 0.499) front.push(positions.getX(index));
		}
		expect(Math.max(...front) - Math.min(...front)).toBeGreaterThan(object.size[0] * 0.3);
	});

	it.each<[number, number, number]>([
		[0.8, 0.045, 1.5],
		[1.5, 0.045, 0.8]
	])(
		'should round a spoon nose inside its footprint without moving its central strike face (%s, %s, %s)',
		(width, height, depth) => {
			const noseWidths: number[] = [];
			const frontHeights: number[] = [];
			const rearHeights: number[] = [];
			for (const roundedNose of [false, true]) {
				const object = {
					...createCatalogObject('key-spoon'),
					roundedNose,
					size: [width, height, depth] as [number, number, number],
					rotation: [0, 0, 0] as [number, number, number]
				};
				const group = makeInstrument(object, makeMaterials());
				const surface = group.userData['surfaceMesh'] as THREE.Mesh;
				const positions = surface.geometry.getAttribute('position');
				const nose: number[] = [];
				const noseY: number[] = [];
				const rearY: number[] = [];
				for (let index = 0; index < positions.count; index++) {
					const x = positions.getX(index),
						z = positions.getZ(index);
					expect(Math.abs(x)).toBeLessThanOrEqual(width / 2 + 1e-6);
					expect(Math.abs(z)).toBeLessThanOrEqual(depth / 2 + 1e-6);
					const along = depth > width ? z : x;
					if (along < -Math.max(width, depth) * 0.499) rearY.push(positions.getY(index));
					if (along > Math.max(width, depth) * 0.499) {
						nose.push(depth > width ? x : z);
						noseY.push(positions.getY(index));
					}
				}
				noseWidths.push(Math.max(...nose) - Math.min(...nose));
				frontHeights.push(Math.max(...noseY));
				rearHeights.push(Math.max(...rearY));
				group.updateMatrixWorld(true);
				for (const along of [-0.25, 0, 0.25]) {
					const origin =
						depth > width
							? new THREE.Vector3(0, 1, depth * along)
							: new THREE.Vector3(width * along, 1, 0);
					const hit = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0)).intersectObject(
						surface
					)[0];
					expect(hit?.point.y).toBeCloseTo(height / 2);
				}
			}
			expect(noseWidths[1]).toBeLessThan((noseWidths[0] ?? 0) * 0.1);
			expect(frontHeights[1]).toBeLessThan(frontHeights[0] ?? 0);
			expect(rearHeights[1]).toBe(rearHeights[0]);
		}
	);

	it.each<[number, number, number]>([
		[0.35, 0.045, 1.5],
		[1.5, 0.045, 0.35]
	])(
		'should give a strip shallow raised rims around its flat strike face (%s, %s, %s)',
		(width, height, depth) => {
			const object = {
				...createCatalogObject('key-strip'),
				size: [width, height, depth] as [number, number, number],
				rotation: [0, 0, 0] as [number, number, number]
			};
			const group = makeInstrument(object, makeMaterials(), -0.7, true);
			const surface = group.userData['surfaceMesh'] as THREE.Mesh;
			surface.geometry.computeBoundingBox();
			const bounds = surface.geometry.boundingBox;
			if (bounds == null) throw new Error('Expected strip geometry bounds.');
			const rimRise = bounds.max.y - height / 2;
			expect(rimRise).toBeGreaterThan(height * 0.5);
			expect(rimRise).toBeLessThan(height * 1.5);
			expect(bounds.min.y).toBeCloseTo(-height / 2);
			expect(bounds.max.x - bounds.min.x).toBeCloseTo(width);
			expect(bounds.max.z - bounds.min.z).toBeCloseTo(depth);
			group.updateMatrixWorld(true);
			for (const along of [-0.49, 0.49]) {
				for (const across of [-0.44, 0.44]) {
					const origin =
						depth > width
							? new THREE.Vector3(width * across, 1, depth * along)
							: new THREE.Vector3(width * along, 1, depth * across);
					expect(
						new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0)).intersectObject(surface)
					).toHaveLength(0);
				}
			}
			for (const fraction of [-0.25, 0, 0.25]) {
				const origin =
					depth > width
						? new THREE.Vector3(0, 1, depth * fraction)
						: new THREE.Vector3(width * fraction, 1, 0);
				const hit = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0)).intersectObject(
					surface
				)[0];
				expect(hit?.point.y).toBeCloseTo(height / 2);
			}
		}
	);

	it.each<[TObjectModelId, boolean]>([
		['key-strip', false],
		['key-spoon', false],
		['key-spoon', true]
	])(
		'should bevel the %s perimeter without shrinking its silhouette (rounded nose: %s)',
		(modelId, roundedNose) => {
			const object = {
				...createCatalogObject(modelId),
				roundedNose,
				size: [0.8, 0.045, 1.5] as [number, number, number],
				rotation: [0, 0, 0] as [number, number, number]
			};
			const group = makeInstrument(object, makeMaterials());
			const surface = group.userData['surfaceMesh'] as THREE.Mesh;
			group.updateMatrixWorld(true);
			const bounds = new THREE.Box3().setFromObject(surface);
			expect(bounds.min.x).toBeCloseTo(-0.4);
			expect(bounds.max.x).toBeCloseTo(0.4);
			expect(bounds.min.z).toBeCloseTo(-0.75);
			expect(bounds.max.z).toBeCloseTo(0.75);
			for (const side of [-1, 1]) {
				const hit = new THREE.Raycaster(
					new THREE.Vector3(side * (0.4 - 0.0045 / 2), 1, 0),
					new THREE.Vector3(0, -1, 0)
				).intersectObject(surface)[0];
				expect(hit).toBeDefined();
				expect(hit?.point.y).toBeGreaterThan(0);
				expect(hit?.point.y).toBeLessThan(0.045 / 2);
				expect(hit?.face?.normal.y).toBeGreaterThan(0);
				expect((hit?.face?.normal.x ?? 0) * side).toBeGreaterThan(0);
			}
			const normals = surface.geometry.getAttribute('normal');
			for (const value of normals.array) expect(Number.isFinite(value)).toBe(true);
		}
	);

	it.each<TObjectModelId>(['key-bar', 'key-panel', 'key-strip', 'key-spoon'])(
		'should keep the central contact face aligned with the %s collider',
		(modelId) => {
			const object = {
				...createCatalogObject(modelId),
				rotation: [0, 0, 0] as [number, number, number]
			};
			const group = makeInstrument(object, makeMaterials(), -0.7, true);
			const surface = group.userData['surfaceMesh'] as THREE.Mesh;
			group.updateMatrixWorld(true);
			for (const fraction of [-0.2, 0, 0.2]) {
				const ray = new THREE.Raycaster(
					new THREE.Vector3(object.size[0] * fraction, 5, 0),
					new THREE.Vector3(0, -1, 0)
				);
				const contact = ray.intersectObject(surface)[0];
				expect(contact).toBeDefined();
				expect(Math.abs((contact?.point.y ?? Infinity) - object.size[1] / 2)).toBeLessThan(0.014);
			}
		}
	);
	it.each<TObjectModelId>(['key-bar', 'key-panel', 'key-strip', 'key-spoon'])(
		'should orient the %s shape and strike area along a deep key',
		(modelId) => {
			const object = {
				...createCatalogObject(modelId),
				size: [0.42, 0.06, 1.5] as [number, number, number],
				mountStyle: 'pins' as const,
				rotation: [0, 0, 0] as [number, number, number]
			};
			const group = makeInstrument(object, makeMaterials(), -0.5, true);
			const surface = group.userData['surfaceMesh'] as THREE.Mesh;
			group.updateMatrixWorld(true);
			const bounds = new THREE.Box3().setFromObject(surface).getSize(new THREE.Vector3());
			expect(bounds.z).toBeGreaterThan(bounds.x * 3);
			for (const fraction of [-0.2, 0, 0.2]) {
				const ray = new THREE.Raycaster(
					new THREE.Vector3(0, 5, object.size[2] * fraction),
					new THREE.Vector3(0, -1, 0)
				);
				const contact = ray.intersectObject(surface)[0];
				expect(contact).toBeDefined();
				expect(Math.abs((contact?.point.y ?? Infinity) - object.size[1] / 2)).toBeLessThan(0.014);
			}
			const bridge = group.getObjectByName('key-mount-bridge');
			expect(bridge).toBeDefined();
			if (bridge) {
				const wire = new THREE.Box3().setFromObject(bridge).getSize(new THREE.Vector3());
				expect(wire.z).toBeGreaterThan(wire.x * 10);
			}
		}
	);
	it('should distinguish early pinned spoons from the final folded spoon mounting', () => {
		const spoon = { ...createCatalogObject('key-spoon'), mountStyle: 'pins' as const };
		const pinned = makeInstrument(spoon, makeMaterials(), -0.7, true);
		const folded = makeInstrument({ ...spoon, mountStyle: 'folded' }, makeMaterials(), -0.7, true);
		expect(pinned.getObjectByName('key-mount-bridge')).toBeDefined();
		expect(pinned.getObjectByName('folded-rear-flange')).toBeUndefined();
		expect(folded.getObjectByName('key-mount-bridge')).toBeUndefined();
		expect(folded.getObjectByName('folded-rear-flange')).toBeDefined();
	});

	it('should retain the legacy back flange for saved strips without an explicit mount', () => {
		const strip = createCatalogObject('key-strip');
		delete strip.mountStyle;
		const group = makeInstrument(strip, makeMaterials());
		expect(group.getObjectByName('folded-rear-flange')).toBeDefined();
		expect(group.getObjectByName('folded-front-flange')).toBeUndefined();
		expect(group.getObjectByName('key-mount-bridge')).toBeUndefined();
	});

	it.each<[number, number, number]>([
		[0.35, 0.045, 1.5],
		[1.5, 0.045, 0.35]
	])(
		'should put the front flange at the positive length-axis tip (%s, %s, %s)',
		(width, height, depth) => {
			const object = {
				...createCatalogObject('key-strip'),
				size: [width, height, depth] as [number, number, number],
				rotation: [0, 0, 0] as [number, number, number]
			};
			const group = makeInstrument(object, makeMaterials());
			const flange = group.getObjectByName('folded-front-flange') as THREE.Mesh;
			const surface = group.userData['surfaceMesh'] as THREE.Mesh;
			expect(flange.parent?.name).toBe('flex');
			expect(flange.material).toBe(surface.material);
			expect(flange.castShadow).toBe(true);
			expect(flange.receiveShadow).toBe(true);
			expect(flange.customDepthMaterial).toBe(surface.customDepthMaterial);
			expect(flange.customDistanceMaterial).toBe(surface.customDistanceMaterial);
			const bounds = new THREE.Box3().setFromObject(flange);
			const axis = depth > width ? 'z' : 'x';
			const across = depth > width ? 'x' : 'z';
			expect(bounds.getCenter(new THREE.Vector3())[axis]).toBeCloseTo(Math.max(width, depth) / 2);
			expect(bounds.getSize(new THREE.Vector3())[across]).toBeCloseTo(Math.min(width, depth));
			expect(bounds.min[axis]).toBeGreaterThan(Math.max(width, depth) * 0.45);
			expect(bounds.max.y).toBeCloseTo(height / 2 + 0.1);
			expect(group.getObjectByName('key-fasteners')).toBeDefined();
			expect(group.getObjectByName('key-mount-bridge')).toBeDefined();
			expect(group.getObjectByName('folded-rear-flange')).toBeUndefined();
		}
	);
});

describe('updateInstrumentReaction function', () => {
	it('should keep rails unlit during impacts and continuous contact even with saved glow settings', () => {
		const object = {
			...createCatalogObject('rail-wave'),
			emission: 8,
			glowMode: 'contact' as const
		};
		const mesh = makeInstrument(object, makeMaterials(), -0.7, true);
		const material = mesh.userData['surfaceMaterial'] as THREE.MeshStandardMaterial;
		for (const glowMode of ['contact', 'impact'] as const) {
			expect(
				updateInstrumentReaction(
					mesh,
					{ ...object, glowMode },
					1.04,
					[{ time: 1, strength: 1 }],
					1,
					[{ start: 1, end: 2 }]
				)
			).toBe(0);
			expect(material.emissiveIntensity).toBe(0);
		}
	});

	it('should sample authored afterglow live while preserving legacy decay and bend duration', () => {
		const object = { ...createCatalogObject('key-panel'), emission: 2 };
		const mesh = makeInstrument(object, makeMaterials());
		const impacts = [{ time: 1, strength: 1 }];
		expect(updateInstrumentReaction(mesh, object, 1.5, impacts)).toBe(Math.exp(-3));
		expect(updateInstrumentReaction(mesh, object, 2.41, impacts)).toBe(0);
		const short = { ...object, glowFade: 0.35 };
		const long = { ...object, glowFade: 3 };
		expect(updateInstrumentReaction(mesh, short, 1.35, impacts)).toBeCloseTo(0.01);
		expect(updateInstrumentReaction(mesh, long, 2.5, impacts)).toBeCloseTo(0.1);
		const material = mesh.userData['surfaceMaterial'] as THREE.MeshStandardMaterial;
		expect(material.emissiveIntensity).toBeCloseTo(0.2);
		expect(material.userData['flexUniform'].value).toBe(0);
		expect(updateInstrumentReaction(mesh, long, 4, impacts)).toBeCloseTo(0.01);
		expect(updateInstrumentReaction(mesh, long, 4.01, impacts)).toBe(0);
		expect(updateInstrumentReaction(mesh, short, 0.9, impacts)).toBe(0);
		expect(updateInstrumentReaction(mesh, long, 2.5, impacts)).toBeCloseTo(0.1);
	});

	it('should ignore afterglow duration for measured contact holds and their release fade', () => {
		const object = { ...createCatalogObject('key-panel'), glowMode: 'contact' as const };
		const mesh = makeInstrument(object, makeMaterials());
		const contacts = [{ start: 1, end: 2 }];
		for (const glowFade of [0.05, 3]) {
			const changed = { ...object, glowFade };
			expect(updateInstrumentReaction(mesh, changed, 1.5, [], 1, contacts)).toBe(1);
			expect(updateInstrumentReaction(mesh, changed, 2.06, [], 1, contacts)).toBeCloseTo(0.5);
			expect(updateInstrumentReaction(mesh, changed, 2.13, [], 1, contacts)).toBe(0);
		}
	});

	it('should drive two-color key emission only from measured impact energy and reset on seek', () => {
		const object = {
			...createCatalogObject('key-spoon'),
			glowColor: '#20dfef',
			glowEndColor: '#8124cf',
			emission: 3
		};
		const group = makeInstrument(object, makeMaterials(), -0.7, true);
		const material = group.userData['surfaceMaterial'] as THREE.MeshStandardMaterial;
		const shader = {
			uniforms: {},
			vertexShader: '#include <begin_vertex>',
			fragmentShader: '#include <emissivemap_fragment>'
		} as Parameters<THREE.Material['onBeforeCompile']>[0];
		material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
		expect(shader.vertexShader).toContain('position.z / uBarWidth + 0.5');
		expect(shader.fragmentShader).toContain(
			'mix(uGlowEndColor, uGlowStartColor, glowWeight) * uGlowEnergy'
		);
		expect((shader.uniforms['uGlowStartColor']?.value as THREE.Color).getHexString()).toBe(
			'20dfef'
		);
		expect((shader.uniforms['uGlowEndColor']?.value as THREE.Color).getHexString()).toBe('8124cf');
		const impacts = [{ time: 2, strength: 0.8 }];
		updateInstrumentReaction(group, object, 1, impacts);
		expect(shader.uniforms['uGlowEnergy']?.value).toBe(0);
		updateInstrumentReaction(group, object, 2.05, impacts);
		const energy = shader.uniforms['uGlowEnergy']?.value;
		expect(energy).toBeGreaterThan(0);
		expect(energy).toBe(material.emissiveIntensity);
		updateInstrumentReaction(group, object, 4, impacts);
		expect(shader.uniforms['uGlowEnergy']?.value).toBe(0);
		updateInstrumentReaction(group, object, 2.05, impacts);
		expect(shader.uniforms['uGlowEnergy']?.value).toBe(energy);
		const unlit = { ...object, emission: 0 };
		const unlitGroup = makeInstrument(unlit, makeMaterials(), -0.7, true);
		updateInstrumentReaction(unlitGroup, unlit, 2.05, impacts);
		const unlitMaterial = unlitGroup.userData['surfaceMaterial'] as THREE.MeshStandardMaterial;
		expect(unlitMaterial.userData['glowEnergyUniform'].value).toBe(0);
	});

	it('should bias the glow gradient live without changing its endpoints or impact energy', () => {
		const object = { ...createCatalogObject('key-panel'), glowEndColor: '#ffff00', emission: 2 };
		const group = makeInstrument(object, makeMaterials());
		const material = group.userData['surfaceMaterial'] as THREE.MeshStandardMaterial;
		const shader = {
			uniforms: {},
			vertexShader: '#include <begin_vertex>',
			fragmentShader: '#include <emissivemap_fragment>'
		} as Parameters<THREE.Material['onBeforeCompile']>[0];
		material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
		expect(shader.uniforms['uGlowBalance']?.value).toBe(0.5);
		expect(material.customProgramCacheKey()).toContain('glow-gradient-v2');
		const expression = shader.fragmentShader.match(/float glowWeight = ([^;]+);/)?.[1];
		if (expression == null) throw new Error('Expected glow weighting expression.');
		// This arithmetic-only GLSL expression is also valid JavaScript; sample the emitted shader.
		const weight = new Function('vGlowMix', 'uGlowBalance', `return ${expression};`) as (
			position: number,
			balance: number
		) => number;
		for (const position of [0, 0.1, 0.5, 0.9, 1]) expect(weight(position, 0.5)).toBe(position);
		const impacts = [{ time: 1, strength: 0.8 }];
		const energy = updateInstrumentReaction(group, object, 1.05, impacts);
		for (const glowBalance of [0.05, 0.1, 0.9, 0.95]) {
			expect(updateInstrumentReaction(group, { ...object, glowBalance }, 1.05, impacts)).toBe(
				energy
			);
			expect(shader.uniforms['uGlowBalance']?.value).toBe(glowBalance);
			expect(weight(0.5, glowBalance)).toBeCloseTo(glowBalance);
			expect(weight(0, glowBalance)).toBe(0);
			expect(weight(1, glowBalance)).toBe(1);
			expect(shader.uniforms['uGlowEnergy']?.value).toBe(energy * object.emission);
		}
		updateInstrumentReaction(group, object, 0, impacts);
		expect(shader.uniforms['uGlowBalance']?.value).toBe(0.5);
		expect(shader.uniforms['uGlowEnergy']?.value).toBe(0);
	});

	it('should share the visible bend with directional and point-light shadow shaders', () => {
		const object = createCatalogObject('key-spoon');
		const group = makeInstrument(object, makeMaterials(), -0.7, true);
		const surface = group.userData['surfaceMesh'] as THREE.Mesh;
		const material = surface.material as THREE.MeshStandardMaterial;
		const shaders = [material, surface.customDepthMaterial, surface.customDistanceMaterial].map(
			(source) => {
				if (source == null) throw new Error('Expected surface and shadow materials.');
				const shader = {
					uniforms: {},
					vertexShader: '#include <beginnormal_vertex>\n#include <begin_vertex>',
					fragmentShader: ''
				} as Parameters<THREE.Material['onBeforeCompile']>[0];
				source.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
				expect(shader.vertexShader).toContain('transformed.y += aKeyFlex * uFlex');
				expect(shader.vertexShader).toContain(
					'objectNormal.z -= aKeyFlexSlope * uFlex * objectNormal.y'
				);
				expect(shader.uniforms['uFlex']).toBe(material.userData['flexUniform']);
				return shader;
			}
		);
		updateInstrumentReaction(group, object, 1.04, [{ time: 1, strength: 0.8 }]);
		for (const shader of shaders) expect(shader.uniforms['uFlex']?.value).toBeLessThan(0);
		updateInstrumentReaction(group, object, 0.9, [{ time: 1, strength: 0.8 }]);
		for (const shader of shaders) expect(shader.uniforms['uFlex']?.value).toBe(0);
	});

	it('should deflect downward on impact and rebound with less motion independently of seek order', () => {
		const object = { ...createCatalogObject('key-bar'), flex: 0.6 };
		const mesh = makeInstrument(object, makeMaterials(), -0.7, true);
		const material = mesh.userData['surfaceMaterial'] as THREE.MeshStandardMaterial;
		const flex = material.userData['flexUniform'] as { value: number };
		const impacts = [{ time: 2, strength: 0.8 }];
		updateInstrumentReaction(mesh, object, 1.99, impacts);
		expect(flex.value).toBe(0);
		updateInstrumentReaction(mesh, object, 2, impacts);
		expect(flex.value).toBe(0);
		updateInstrumentReaction(mesh, object, 2.04, impacts);
		const loading = flex.value;
		expect(loading).toBeLessThan(0);
		updateInstrumentReaction(mesh, object, 2.13, impacts);
		expect(flex.value).toBeGreaterThan(0);
		expect(flex.value).toBeLessThan(Math.abs(loading));
		updateInstrumentReaction(mesh, object, 3.5, impacts);
		expect(flex.value).toBe(0);
		updateInstrumentReaction(mesh, object, 2.04, impacts);
		expect(flex.value).toBe(loading);
	});

	it('should brighten weak linked contacts without amplifying the physical bend or inventing a contact', () => {
		const world = { ...createCatalogObject('key-bar'), emission: 3 };
		const linked = {
			...world,
			binding: { noteId: 'note', offset: [0, 0, 0] as [number, number, number] }
		};
		const worldMesh = makeInstrument(world, makeMaterials(), -0.7, true);
		const linkedMesh = makeInstrument(linked, makeMaterials(), -0.7, true);
		const contacts = [{ time: 10, strength: 0.1 }];
		expect(updateInstrumentReaction(linkedMesh, linked, 9.99, contacts)).toBe(0);
		expect(updateInstrumentReaction(linkedMesh, linked, 10.05, [])).toBe(0);
		const worldEnergy = updateInstrumentReaction(worldMesh, world, 10.05, contacts);
		const linkedEnergy = updateInstrumentReaction(linkedMesh, linked, 10.05, contacts);
		expect(linkedEnergy).toBeGreaterThan(worldEnergy * 2.5);
		const worldMaterial = worldMesh.userData['surfaceMaterial'] as THREE.MeshStandardMaterial;
		const linkedMaterial = linkedMesh.userData['surfaceMaterial'] as THREE.MeshStandardMaterial;
		expect(linkedMaterial.userData['flexUniform'].value).toBe(
			worldMaterial.userData['flexUniform'].value
		);
		expect(linkedMaterial.emissiveIntensity).toBeGreaterThan(worldMaterial.emissiveIntensity * 2.5);
		expect(updateInstrumentReaction(linkedMesh, linked, 10.2, contacts)).toBeGreaterThan(
			linkedEnergy * 0.35
		);
	});
	it('should keep a rolling pad lit only over measured contact intervals and a short exit fade', () => {
		const object = {
			...createCatalogObject('key-panel'),
			glowMode: 'contact' as const,
			emission: 3,
			binding: { noteId: 'note', offset: [0, 0, 0] as [number, number, number] }
		};
		const mesh = makeInstrument(object, makeMaterials(), -0.7, true);
		const contacts = [{ start: 4.5125, end: 5.1417 }];
		const impacts = [{ time: 4.487, strength: 0.1 }];
		expect(updateInstrumentReaction(mesh, object, 4.49, impacts, 1, contacts)).toBe(0);
		expect(updateInstrumentReaction(mesh, object, 5, impacts, 1, contacts)).toBe(1);
		expect(updateInstrumentReaction(mesh, object, 5.2017, impacts, 1, contacts)).toBeCloseTo(0.5);
		expect(updateInstrumentReaction(mesh, object, 5.3, impacts, 1, contacts)).toBe(0);
		expect(updateInstrumentReaction(mesh, object, 5, impacts)).toBe(0);
	});

	it('should bridge tiny contact gaps without changing impact-driven bending', () => {
		const base = { ...createCatalogObject('key-panel'), emission: 3 };
		const contact = { ...base, glowMode: 'contact' as const };
		const impactMesh = makeInstrument(base, makeMaterials(), -0.7, true);
		const contactMesh = makeInstrument(contact, makeMaterials(), -0.7, true);
		const impacts = [{ time: 2, strength: 0.5 }];
		const intervals = [
			{ start: 2, end: 2.1 },
			{ start: 2.13, end: 2.4 }
		];
		expect(
			updateInstrumentReaction(contactMesh, contact, 2.115, impacts, 1, intervals)
		).toBeGreaterThan(0.9);
		expect(updateInstrumentReaction(contactMesh, contact, 2.13, impacts, 1, intervals)).toBe(1);
		updateInstrumentReaction(impactMesh, base, 2.13, impacts);
		const impactMaterial = impactMesh.userData['surfaceMaterial'] as THREE.MeshStandardMaterial;
		const contactMaterial = contactMesh.userData['surfaceMaterial'] as THREE.MeshStandardMaterial;
		expect(contactMaterial.userData['flexUniform'].value).toBe(
			impactMaterial.userData['flexUniform'].value
		);
	});
});

function makeMaterials(): TMaterials {
	const material = new THREE.MeshPhysicalMaterial();
	return {
		wood: material,
		metal: material,
		rubber: material,
		glass: material,
		bronze: material,
		felt: material,
		skin: material,
		marbleCore: material,
		shared: new Set([material]),
		glowTexture: new THREE.CanvasTexture(),
		dispose() {
			material.dispose();
		}
	};
}
