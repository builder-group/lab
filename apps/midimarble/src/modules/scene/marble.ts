import * as THREE from 'three';
import type { TProject } from '../project';

export function makeMarble(
	radius: number,
	color: string,
	style?: TProject['marbleStyle'],
	settings?: Pick<TProject, 'marbleEffect' | 'marbleEffectSpeed'>
): THREE.Group {
	const group = new THREE.Group();
	group.userData['entity'] = 'marble';
	group.userData['effectSpeed'] = settings?.marbleEffectSpeed ?? 1;
	group.userData['effect'] = settings?.marbleEffect ?? 'none';
	if (style === 'chrome') {
		const chrome = new THREE.Mesh(
			new THREE.SphereGeometry(radius, 48, 32),
			new THREE.MeshStandardMaterial({ color, roughness: 0.09, metalness: 1 })
		);
		chrome.castShadow = true;
		animateMaterial(
			chrome.material,
			settings?.marbleEffect ?? 'none',
			settings?.marbleEffectSpeed ?? 1
		);
		group.add(chrome);
		return group;
	}
	const isRibbon = style === 'ribbon';
	const primary = new THREE.Color(color);
	const white = new THREE.Color('#ffffff');
	const glass = new THREE.MeshPhysicalMaterial({
		color: primary.clone().lerp(white, isRibbon ? 0.96 : 0.9),
		metalness: 0,
		roughness: 0.018,
		transmission: 0.98,
		thickness: radius * 1.15,
		ior: 1.48,
		clearcoat: isRibbon ? 0 : 0.45,
		clearcoatRoughness: 0.035,
		envMapIntensity: 0.85,
		attenuationColor: primary.clone().lerp(white, 0.78),
		attenuationDistance: isRibbon ? 3 : 2
	});
	animateMaterial(glass, settings?.marbleEffect ?? 'none', settings?.marbleEffectSpeed ?? 1);
	const shell = new THREE.Mesh(new THREE.SphereGeometry(radius, 56, 40), glass);
	shell.castShadow = true;
	shell.renderOrder = 2;
	group.add(shell);
	if (style === 'glass') return group;
	const hue = primary.getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace).h;
	const warmRibbon = hue > 0.08 && hue < 0.22;
	const berryRibbon = isRibbon && hue > 0.68 && hue < 0.98;
	let colors = [color, '#eee7c8', color];
	if (berryRibbon) {
		colors = [
			`#${primary.clone().offsetHSL(0, 0.24, -0.12).getHexString()}`,
			'#cf2850',
			`#${primary.clone().offsetHSL(-0.13, 0.24, -0.1).getHexString()}`
		];
	} else if (isRibbon) {
		colors = [
			`#${primary.clone().offsetHSL(0, 0.16, -0.15).getHexString()}`,
			'#ffac3a',
			`#${primary.clone().offsetHSL(warmRibbon ? 0.035 : -0.13, 0.08, -0.12).getHexString()}`,
			`#${primary.clone().offsetHSL(warmRibbon ? -0.025 : 0.05, -0.05, 0.08).getHexString()}`
		];
	}
	for (let petal = 0; petal < colors.length; petal++) {
		const positions: number[] = [];
		const indices: number[] = [];
		for (let step = 0; step <= 60; step++) {
			const t = step / 60;
			const y = (t * 2 - 1) * radius * 0.82;
			const amplitude = (0.18 + Math.sin(t * Math.PI) * 0.67) * radius;
			const angle = t * Math.PI * (berryRibbon ? 1.25 : 2.15) + (petal * Math.PI * 2) / colors.length;
			const spread =
				(isRibbon ? 0.11 + Math.sin(t * Math.PI) * 0.3 : 0.15 + Math.sin(t * Math.PI) * 0.39) *
				(berryRibbon ? (petal === 1 ? 0.6 : 1.1) : 1);
			for (const side of [-1, 1])
				positions.push(
					Math.cos(angle + side * spread) * amplitude,
					y,
					Math.sin(angle + side * spread) * amplitude
				);
			if (step < 60) {
				const a = step * 2;
				indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
			}
		}
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		geometry.setIndex(indices);
		geometry.computeVertexNormals();
		const ribbon = new THREE.Mesh(
			geometry,
			new THREE.MeshStandardMaterial({
				color: colors[petal],
				roughness: 0.16,
				metalness: 0.08,
				side: THREE.DoubleSide
			})
		);
		animateMaterial(
			ribbon.material,
			settings?.marbleEffect ?? 'none',
			settings?.marbleEffectSpeed ?? 1
		);
		group.add(ribbon);
	}
	if (!isRibbon) {
		const core = new THREE.Mesh(
			new THREE.SphereGeometry(radius * 0.56, 32, 24),
			new THREE.MeshStandardMaterial({ color: '#e6e3c6', roughness: 0.25 })
		);
		group.add(core);
	}
	return group;
}

/** Animation is sampled by project time, so scrubbing and export produce the same material. */
export function updateMarbleAppearance(group: THREE.Group, time: number): void {
	const speed = (group.userData['effectSpeed'] as number | undefined) ?? 1;
	group.traverse((child) => {
		if (!(child instanceof THREE.Mesh)) return;
		const source =
			(child.userData['renderMaterial'] as THREE.Material | THREE.Material[] | undefined) ??
			child.material;
		const materials = Array.isArray(source) ? source : [source];
		for (const material of materials) {
			const uniform = material.userData['marbleTime'] as { value: number } | undefined;
			if (uniform)
				uniform.value = time * ((material.userData['marbleSpeed'] as number | undefined) ?? speed);
		}
	});
}
function animateMaterial(
	material: THREE.MeshStandardMaterial,
	effect: NonNullable<TProject['marbleEffect']>,
	speed = 1
): void {
	if (effect === 'none') return;
	const clock = { value: 0 };
	const tintStrength =
		material instanceof THREE.MeshPhysicalMaterial ? 0.18 : material.metalness > 0.9 ? 0.5 : 0.06;
	material.userData['marbleTime'] = clock;
	material.userData['marbleSpeed'] = speed;
	material.onBeforeCompile = (shader) => {
		shader.uniforms['uMarbleTime'] = clock;
		shader.vertexShader = 'varying vec3 vMarblePosition;\n' + shader.vertexShader;
		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			'#include <begin_vertex>\n vMarblePosition=position;'
		);
		shader.fragmentShader =
			'uniform float uMarbleTime; varying vec3 vMarblePosition;\n' + shader.fragmentShader;
		const expression =
			effect === 'iridescent'
				? `float tintAmount=pow(1.0-abs(dot(normalize(normal),normalize(vViewPosition))),2.0)*${tintStrength.toFixed(2)}; float huePhase=uMarbleTime*.035+vMarblePosition.y*.12;`
				: 'float wave=.5+.5*sin(vMarblePosition.y*18.0+sin(vMarblePosition.x*13.0+uMarbleTime*.7)*2.0+uMarbleTime*.9); float huePhase=wave*.35+uMarbleTime*.025; float tintAmount=.34;';
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <normal_fragment_maps>',
			`#include <normal_fragment_maps>\n ${expression} vec3 marbleTint=.5+.5*cos(6.2831853*(vec3(0.0,.33,.67)+huePhase)); diffuseColor.rgb=mix(diffuseColor.rgb,marbleTint,tintAmount);`
		);
	};
	material.customProgramCacheKey = () => `marble-appearance-${effect}-${tintStrength}-v2`;
}
