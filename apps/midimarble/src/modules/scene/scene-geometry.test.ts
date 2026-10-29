import { createWorldObject } from '../project/fixtures/sample-project';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { reconcileSceneObjects } from './scene-geometry';

describe('reconcileSceneObjects function', () => {
	it('should rebuild construction when a panel changes to a rail bed', () => {
		const root = new THREE.Group(),
			groups = new Map<string, THREE.Group>(),
			signatures = new Map<string, string>();
		const object = createWorldObject('bar', [0, 0, 0]);
		const build = () => new THREE.Group();
		reconcileSceneObjects(root, groups, signatures, [object], -0.7, build, () => {});
		const pins = groups.get(object.id);
		reconcileSceneObjects(
			root,
			groups,
			signatures,
			[{ ...object, mountStyle: 'rack' }],
			-0.7,
			build,
			() => {}
		);
		expect(groups.get(object.id)).not.toBe(pins);
	});

	it('should rebuild a changed metal finish without moving the object', () => {
		const root = new THREE.Group(),
			groups = new Map<string, THREE.Group>(),
			signatures = new Map<string, string>();
		const object = createWorldObject('bar', [1, 2, 3]);
		const build = () => new THREE.Group();
		reconcileSceneObjects(root, groups, signatures, [object], -0.7, build, () => {});
		const bare = groups.get(object.id);
		reconcileSceneObjects(
			root,
			groups,
			signatures,
			[{ ...object, materialFinish: 'painted' }],
			-0.7,
			build,
			() => {}
		);
		expect(groups.get(object.id)).not.toBe(bare);
		expect(groups.get(object.id)?.position.toArray()).toEqual(object.position);
	});

	it('should rebuild a rounded nose while reusing the legacy blunt profile', () => {
		const root = new THREE.Group(), groups = new Map<string, THREE.Group>(), signatures = new Map<string, string>();
		const object = { ...createWorldObject('bar', [1, 2, 3]), modelId: 'key-spoon' as const };
		const build = () => new THREE.Group();
		reconcileSceneObjects(root, groups, signatures, [object], -0.7, build, () => {});
		const blunt = groups.get(object.id);
		reconcileSceneObjects(root, groups, signatures, [{ ...object, roundedNose: false }], -0.7, build, () => {});
		expect(groups.get(object.id)).toBe(blunt);
		reconcileSceneObjects(root, groups, signatures, [{ ...object, roundedNose: true }], -0.7, build, () => {});
		expect(groups.get(object.id)).not.toBe(blunt);
		expect(groups.get(object.id)?.position.toArray()).toEqual(object.position);
	});

	it('should rebuild the material when a glow gradient is added or removed', () => {
		const root = new THREE.Group(),
			groups = new Map<string, THREE.Group>(),
			signatures = new Map<string, string>();
		const object = createWorldObject('bar', [0, 0, 0]);
		const build = () => new THREE.Group();
		reconcileSceneObjects(root, groups, signatures, [object], -0.7, build, () => {});
		const single = groups.get(object.id);
		reconcileSceneObjects(
			root,
			groups,
			signatures,
			[{ ...object, glowEndColor: '#8124cf' }],
			-0.7,
			build,
			() => {}
		);
		const gradient = groups.get(object.id);
		expect(gradient).not.toBe(single);
		reconcileSceneObjects(root, groups, signatures, [object], -0.7, build, () => {});
		expect(groups.get(object.id)).not.toBe(gradient);
	});

	it('should retain GPU geometry when a partial bake only changes planar placement', () => {
		const root = new THREE.Group(),
			groups = new Map<string, THREE.Group>(),
			signatures = new Map<string, string>();
		const object = createWorldObject('bar', [0, 0, 0]);
		let builds = 0;
		const build = () => {
			builds++;
			return new THREE.Group();
		};
		reconcileSceneObjects(root, groups, signatures, [object], -0.7, build, () => {});
		const first = groups.get(object.id);
		reconcileSceneObjects(
			root,
			groups,
			signatures,
			[{ ...object, position: [3, -5, 0] }],
			-0.7,
			build,
			() => {}
		);
		expect(builds).toBe(1);
		expect(groups.get(object.id)).toBe(first);
		expect(first?.position.toArray()).toEqual([3, -5, 0]);
	});
	it('should preserve an active drag while the worker streams a newer anchor', () => {
		const root = new THREE.Group(),
			groups = new Map<string, THREE.Group>(),
			signatures = new Map<string, string>();
		const object = createWorldObject('rail', [0, 0, 0]);
		reconcileSceneObjects(
			root,
			groups,
			signatures,
			[object],
			-0.7,
			() => new THREE.Group(),
			() => {}
		);
		groups.get(object.id)?.position.set(10, 20, 30);
		reconcileSceneObjects(
			root,
			groups,
			signatures,
			[{ ...object, position: [3, -5, 1] }],
			-0.7,
			() => new THREE.Group(),
			() => {},
			new Set([object.id])
		);
		expect(groups.get(object.id)?.position.toArray()).toEqual([10, 20, 30]);
	});
});
