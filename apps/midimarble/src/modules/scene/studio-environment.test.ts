import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createStudioEnvironment } from './studio-environment';

const captured = vi.hoisted(() => ({
	texture: undefined as THREE.DataTexture | undefined,
	textureDisposed: false,
	generatorDisposed: false
}));

vi.mock('three', async (importOriginal) => {
	const actual = await importOriginal<typeof import('three')>();
	return {
		...actual,
		PMREMGenerator: class {
			fromEquirectangular(texture: THREE.DataTexture) {
				captured.texture = texture;
				texture.addEventListener('dispose', () => {
					captured.textureDisposed = true;
				});
				return new actual.WebGLRenderTarget(1, 1);
			}
			dispose() {
				captured.generatorDisposed = true;
			}
		}
	};
});

describe('createStudioEnvironment function', () => {
	it('should supply warm and cool HDR reflections and release temporary generation resources', () => {
		const target = createStudioEnvironment({} as THREE.WebGLRenderer);
		const texture = captured.texture;
		if (texture == null) throw new Error('Expected generated environment texture.');
		expect(texture.mapping).toBe(THREE.EquirectangularReflectionMapping);
		expect(texture.type).toBe(THREE.FloatType);
		const pixels = texture.image.data as Float32Array;
		let warm = 0;
		let cool = 0;
		let room = 0;
		let finiteRadiance = true;
		for (let offset = 0; offset < pixels.length; offset += 4) {
			const red = pixels[offset] ?? 0;
			const green = pixels[offset + 1] ?? 0;
			const blue = pixels[offset + 2] ?? 0;
			finiteRadiance &&= [red, green, blue].every(
				(channel) => Number.isFinite(channel) && channel > 0
			);
			if (red > 2 && red > blue * 1.1) warm++;
			if (blue > 2 && blue > red * 1.2) cool++;
			if (Math.max(red, green, blue) < 0.5) room++;
		}
		expect(warm).toBeGreaterThan(100);
		expect(finiteRadiance).toBe(true);
		expect(cool).toBeGreaterThan(100);
		expect(room).toBeGreaterThan(pixels.length / 8);
		expect(captured.textureDisposed).toBe(true);
		expect(captured.generatorDisposed).toBe(true);
		target.dispose();
	});
});
