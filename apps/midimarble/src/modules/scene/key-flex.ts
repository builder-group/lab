import * as THREE from 'three';
import { TessellateModifier } from 'three/addons/modifiers/TessellateModifier.js';
import type { TSceneObject } from '../project';

/** Stores the bend and its derivative once for visible and shadow vertex shaders. */
export function prepareKeyFlexGeometry(geometry: THREE.BufferGeometry, object: TSceneObject): void {
	const axis = object.size[2] > object.size[0] ? 2 : 0;
	const length = Math.max(object.size[0], object.size[2]);
	const mount = object.mountStyle ?? (object.modelId === 'key-strip' ? 'folded' : 'pins');
	const pinned = mount === 'pins' || mount === 'folded-front';
	if (pinned) subdivideUnsupportedSpan(geometry, axis, length);
	const positions = geometry.getAttribute('position');
	if (pinned) alignSupportColumns(positions, axis, length);
	const flex = new Float32Array(positions.count);
	const slope = new Float32Array(positions.count);
	for (let index = 0; index < positions.count; index++) {
		const along = positions.getComponent(index, axis) / length;
		if (!pinned) {
			flex[index] = Math.sin((along + 0.5) * Math.PI);
			slope[index] = (Math.cos((along + 0.5) * Math.PI) * Math.PI) / length;
		} else if (Math.abs(along) <= 0.31) {
			const ratio = along / 0.31;
			flex[index] = (1 - ratio * ratio) ** 2;
			slope[index] = (-4 * ratio * (1 - ratio * ratio)) / (0.31 * length);
		} else {
			const ratio = (Math.abs(along) - 0.31) / 0.19;
			flex[index] = -0.08 * ratio * ratio;
			slope[index] = (-0.16 * ratio * Math.sign(along)) / (0.19 * length);
		}
	}
	geometry.setAttribute('aKeyFlex', new THREE.BufferAttribute(flex, 1));
	geometry.setAttribute('aKeyFlexSlope', new THREE.BufferAttribute(slope, 1));
}

/** Rounded boxes otherwise have long flat faces with vertices only at their ends. */
function subdivideUnsupportedSpan(
	geometry: THREE.BufferGeometry,
	axis: number,
	length: number
): void {
	const positions = geometry.getAttribute('position');
	let minimum = Infinity;
	let maximum = -Infinity;
	let hasInterior = false;
	for (let index = 0; index < positions.count; index++) {
		const along = positions.getComponent(index, axis);
		minimum = Math.min(minimum, along);
		maximum = Math.max(maximum, along);
		if (Math.abs(along) < length * 0.4) hasInterior = true;
	}
	if (hasInterior || minimum > -length * 0.31 || maximum < length * 0.31) return;
	const subdivided = new TessellateModifier(length * 0.12, 5).modify(geometry);
	geometry.copy(subdivided);
	subdivided.dispose();
}

/** Interior column alignment prevents triangles from bridging across a stationary support. */
function alignSupportColumns(
	positions: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
	axis: number,
	length: number
): void {
	for (const sign of [-1, 1]) {
		const support = sign * length * 0.31;
		let nearest = Infinity;
		for (let index = 0; index < positions.count; index++) {
			const along = positions.getComponent(index, axis);
			if (Math.abs(along - support) < Math.abs(nearest - support)) nearest = along;
		}
		if (Math.abs(nearest - support) > length * 0.08) continue;
		for (let index = 0; index < positions.count; index++) {
			if (Math.abs(positions.getComponent(index, axis) - nearest) < length * 1e-6)
				positions.setComponent(index, axis, support);
		}
	}
	positions.needsUpdate = true;
}

export function configureKeyFlex(
	material: THREE.Material,
	lengthAxis: 'x' | 'z',
	length: number,
	flexUniform: { value: number }
): void {
	material.onBeforeCompile = (shader) => {
		shader.uniforms['uFlex'] = flexUniform;
		shader.uniforms['uBarWidth'] = { value: length };
		shader.vertexShader =
			'uniform float uFlex; uniform float uBarWidth; attribute float aKeyFlex; attribute float aKeyFlexSlope;\n' +
			shader.vertexShader;
		shader.vertexShader = shader.vertexShader.replace(
			'#include <beginnormal_vertex>',
			`#include <beginnormal_vertex>\n objectNormal.${lengthAxis} -= aKeyFlexSlope * uFlex * objectNormal.y;`
		);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			'#include <begin_vertex>\n transformed.y += aKeyFlex * uFlex;'
		);
	};
	material.customProgramCacheKey = () => `marble-flex-bar-${lengthAxis}-attributes-v5`;
}
