import * as THREE from 'three';

/** Warm and cool softboxes provide reflection edges without external HDR assets. */
export function createStudioEnvironment(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
	const width = 512;
	const height = 256;
	const pixels = new Float32Array(width * height * 4);
	for (let row = 0; row < height; row++)
		for (let column = 0; column < width; column++) {
			const u = column / width;
			const v = row / height;
			const key = Math.exp(-(((u - 0.31) / 0.04) ** 8 + ((v - 0.31) / 0.065) ** 8)) * 5;
			const rim = Math.exp(-(((u - 0.72) / 0.025) ** 8 + ((v - 0.42) / 0.13) ** 8)) * 3.2;
			const ceiling = Math.max(0, Math.sin(v * Math.PI));
			const offset = (row * width + column) * 4;
			pixels[offset] = 0.11 + ceiling * 0.14 + key + rim * 0.68;
			pixels[offset + 1] = 0.13 + ceiling * 0.15 + key * 0.94 + rim * 0.88;
			pixels[offset + 2] = 0.18 + ceiling * 0.18 + key * 0.84 + rim;
			pixels[offset + 3] = 1;
		}
	const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.FloatType);
	texture.mapping = THREE.EquirectangularReflectionMapping;
	texture.needsUpdate = true;
	const generator = new THREE.PMREMGenerator(renderer);
	const environment = generator.fromEquirectangular(texture);
	texture.dispose();
	generator.dispose();
	return environment;
}
