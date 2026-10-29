import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeMarble, updateMarbleAppearance } from './marble';

describe('makeMarble function', () => {
	it('should keep visible ruby and purple ribbons enclosed in an uncoated glass sphere', () => {
		const radius = 0.24;
		const marble = makeMarble(radius, '#d653b5', 'ribbon');
		const shell = marble.children[0] as THREE.Mesh;
		const glass = shell.material as THREE.MeshPhysicalMaterial;
		expect(glass.transmission).toBeGreaterThan(0.9);
		expect(glass.metalness).toBe(0);
		expect(glass.clearcoat).toBe(0);
		const ribbons = marble.children.slice(1) as THREE.Mesh[];
		expect(ribbons).toHaveLength(3);
		const widths: number[] = [];
		let rubyWidth = 0;
		let purpleRibbons = 0;
		for (const ribbon of ribbons) {
			const color = (ribbon.material as THREE.MeshStandardMaterial).color.getHSL(
				{
					h: 0,
					s: 0,
					l: 0
				},
				THREE.SRGBColorSpace
			);
			const positions = ribbon.geometry.getAttribute('position');
			const width = new THREE.Vector3()
				.fromBufferAttribute(positions, 60)
				.distanceTo(new THREE.Vector3().fromBufferAttribute(positions, 61));
			widths.push(width);
			if ((color.h > 0.95 || color.h < 0.03) && color.s > 0.5) rubyWidth = width;
			if (color.h > 0.68 && color.h < 0.95) {
				purpleRibbons++;
				expect(color.l).toBeGreaterThan(0.3);
			}
			for (let index = 0; index < positions.count; index++)
				expect(new THREE.Vector3().fromBufferAttribute(positions, index).length()).toBeLessThan(
					radius
				);
		}
		expect(rubyWidth).toBeGreaterThan(Math.max(...widths) * 0.4);
		expect(rubyWidth).toBeLessThan(Math.max(...widths));
		expect(purpleRibbons).toBe(2);
	});

	it('should leave clear sightlines between berry ribbons as the marble rotates', () => {
		const marble = makeMarble(1, '#d653b5', 'ribbon');
		const ribbons = marble.children.slice(1);
		const ray = new THREE.Raycaster();
		let clear = 0;
		let samples = 0;
		for (let view = 0; view < 8; view++) {
			marble.rotation.y = (view * Math.PI) / 4;
			marble.updateMatrixWorld(true);
			for (let x = -0.8; x <= 0.8; x += 0.1) {
				for (let y = -0.8; y <= 0.8; y += 0.1) {
					if (x * x + y * y > 0.64) continue;
					ray.set(new THREE.Vector3(x, y, 2), new THREE.Vector3(0, 0, -1));
					if (ray.intersectObjects(ribbons).length === 0) clear++;
					samples++;
				}
			}
		}
		expect(clear / samples).toBeGreaterThan(0.3);
	});

	it('should recognize authored amber as a warm ribbon palette', () => {
		const marble = makeMarble(0.24, '#d79a16', 'ribbon');
		for (const ribbon of marble.children.slice(1) as THREE.Mesh[]) {
			const color = (ribbon.material as THREE.MeshStandardMaterial).color.getHSL(
				{ h: 0, s: 0, l: 0 },
				THREE.SRGBColorSpace
			);
			expect(color.h).toBeGreaterThan(0.04);
			expect(color.h).toBeLessThan(0.18);
		}
	});
});

describe('updateMarbleAppearance function', () => {
	it('should preserve finite deterministic shader clocks inside the primary marble container', () => {
		const container = new THREE.Group();
		container.add(
			makeMarble(0.24, '#df6ec2', 'ribbon', { marbleEffect: 'iridescent', marbleEffectSpeed: 0.6 })
		);
		updateMarbleAppearance(container, 12.5);
		let clocks = 0;
		container.traverse((child) => {
			if (!(child instanceof THREE.Mesh)) return;
			const material = child.material as THREE.Material;
			const clock = material.userData['marbleTime'] as { value: number } | undefined;
			if (clock) {
				clocks++;
				expect(clock.value).toBe(7.5);
			}
		});
		expect(clocks).toBe(4);
		updateMarbleAppearance(container, 0);
		container.traverse((child) => {
			if (!(child instanceof THREE.Mesh)) return;
			const clock = (child.material as THREE.Material).userData['marbleTime'] as
				{ value: number } | undefined;
			if (clock) expect(clock.value).toBe(0);
		});
	});
	it('should keep the authored shader time current while solid shading substitutes its material', () => {
		const marble = makeMarble(0.24, '#d653b5', 'glass', {
			marbleEffect: 'flow',
			marbleEffectSpeed: 0.5
		});
		const shell = marble.children[0] as THREE.Mesh;
		const original = shell.material as THREE.Material;
		shell.userData['renderMaterial'] = original;
		shell.material = new THREE.MeshStandardMaterial();
		updateMarbleAppearance(marble, 10);
		expect((original.userData['marbleTime'] as { value: number }).value).toBe(5);
	});
});
