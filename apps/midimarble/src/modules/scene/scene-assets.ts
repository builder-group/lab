import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getRailGeometry } from '../motion';
import { getFrontFlangeGeometry } from '../motion/key-geometry';
import type { TNote, TResolvedObject, TSceneObject, TSurfaceContact } from '../project';
import { mergeInstrumentHardware } from './instrument-hardware';
import { configureKeyFlex, prepareKeyFlexGeometry } from './key-flex';

export function makeInstrument(
	object: TResolvedObject,
	materials: TMaterials,
	wallZ = -2.25,
	wallStudio = false
): THREE.Group {
	const root = new THREE.Group();
	root.position.fromArray(object.position);
	root.rotation.set(...object.rotation);
	root.userData['objectId'] = object.id;
	const flex = new THREE.Group();
	flex.name = 'flex';
	root.add(flex);
	const [width, height, depth] = object.size;
	const material = materials[object.material].clone();
	if (object.material === 'glass' && material instanceof THREE.MeshPhysicalMaterial)
		material.thickness = Math.min(width, height, depth);
	if (object.material === 'metal' && object.materialFinish === 'painted') {
		material.metalness = 0.3;
		material.roughness = 0.4;
	}
	material.color.set(
		object.color ??
			(wallStudio && object.kind === 'bar' && object.material === 'metal'
				? '#24232c'
				: materials[object.material].color)
	);
	material.emissive.set(object.glowColor ?? impactColor(object.id));
	material.emissiveIntensity = 0;
	root.userData['surfaceMaterial'] = material;
	const reactionMaterials = [material];
	root.userData['reactionMaterials'] = reactionMaterials;
	root.userData['emission'] = object.emission ?? (wallStudio ? 2.5 : 0);
	root.userData['glowColor'] = object.glowColor ?? impactColor(object.id);
	const flexUniform = { value: 0 };
	const lengthAxis = depth > width ? 'z' : 'x';
	material.userData['flexUniform'] = flexUniform;
	if (object.kind === 'bar')
		configureKeyFlex(material, lengthAxis, Math.max(width, depth), flexUniform);
	if (object.kind === 'bar' && object.glowEndColor != null)
		configureKeyGlow(material, lengthAxis, object.glowEndColor);

	if (object.kind === 'bar') {
		const bar = new THREE.Mesh(makeKeyGeometry(object), material);
		root.userData['surfaceMesh'] = bar;
		const surfaces = [bar];
		if (object.modelId === 'key-block') {
			const capMaterial = new THREE.MeshStandardMaterial({
				color: '#1c2025',
				metalness: 0.1,
				roughness: 0.5,
				emissive: material.emissive,
				emissiveIntensity: 0
			});
			configureKeyFlex(capMaterial, lengthAxis, Math.max(width, depth), flexUniform);
			if (object.glowEndColor != null)
				configureKeyGlow(capMaterial, lengthAxis, object.glowEndColor);
			reactionMaterials.push(capMaterial);
			const cap = new THREE.Mesh(makeResonatorGeometry(object, true), capMaterial);
			cap.name = 'key-endcap';
			surfaces.push(cap);
		}
		for (const surface of surfaces) {
			prepareKeyFlexGeometry(surface.geometry, object);
			surface.customDepthMaterial = new THREE.MeshDepthMaterial({
				depthPacking: THREE.RGBADepthPacking
			});
			surface.customDistanceMaterial = new THREE.MeshDistanceMaterial();
			for (const shadowMaterial of [surface.customDepthMaterial, surface.customDistanceMaterial])
				configureKeyFlex(shadowMaterial, lengthAxis, Math.max(width, depth), flexUniform);
			surface.castShadow = true;
			surface.receiveShadow = true;
			flex.add(surface);
		}
		const frontFlange = getFrontFlangeGeometry(object);
		if (frontFlange != null) {
			const flange = new THREE.Mesh(new THREE.BoxGeometry(...frontFlange.size), material);
			flange.geometry.translate(...frontFlange.position);
			prepareKeyFlexGeometry(flange.geometry, object);
			flange.name = 'folded-front-flange';
			flange.customDepthMaterial = bar.customDepthMaterial;
			flange.customDistanceMaterial = bar.customDistanceMaterial;
			flange.castShadow = true;
			flange.receiveShadow = true;
			flex.add(flange);
		}
		const folded =
			(object.mountStyle ?? (object.modelId === 'key-strip' ? 'folded' : 'pins')) === 'folded';
		if (object.mountStyle === 'rack') {
			const rack = new THREE.Group();
			rack.name = 'key-rail-bed';
			const radius = Math.min(0.014, width * 0.08, depth * 0.08);
			const y = -height * 0.5 - 0.045;
			const supports: THREE.Mesh[] = [];
			for (const side of [-1, 1]) {
				supports.push(
					cylinderBetween(
						new THREE.Vector3(-width * 0.5, y, side * depth * 0.5),
						new THREE.Vector3(width * 0.5, y, side * depth * 0.5),
						radius,
						materials.metal
					)
				);
				supports.push(
					cylinderBetween(
						new THREE.Vector3(side * width * 0.3, y, -depth * 0.5),
						new THREE.Vector3(side * width * 0.3, y, depth * 0.5),
						radius * 0.8,
						materials.metal
					)
				);
			}
			rack.add(mergeInstrumentHardware(supports, 'rack-hardware'));
			flex.add(rack);
		} else if (folded) {
			const flange = new THREE.Mesh(
				new THREE.BoxGeometry(width, 0.1, Math.max(0.025, height * 0.6)),
				material
			);
			flange.geometry.translate(0, height * 0.5 + 0.05, -depth * 0.5);
			prepareKeyFlexGeometry(flange.geometry, object);
			flange.name = 'folded-rear-flange';
			flange.castShadow = true;
			flex.add(flange);
		} else if (object.mountStyle !== 'none') {
			const longZ = depth > width;
			const length = Math.max(width, depth),
				breadth = Math.min(width, depth);
			const fasteners: THREE.Mesh[] = [];
			const pads: THREE.Mesh[] = [];
			for (const along of [-length * 0.31, length * 0.31]) {
				const fastener = new THREE.Mesh(
					new THREE.CylinderGeometry(0.035, 0.035, 0.018, 12),
					materials.metal
				);
				fastener.position.set(
					longZ ? breadth * 0.24 : along,
					height * 0.5 + 0.008,
					longZ ? along : breadth * 0.24
				);
				fasteners.push(fastener);
				const felt = new THREE.Mesh(
					new THREE.CylinderGeometry(
						object.modelId === 'key-panel' ? Math.min(0.15, breadth * 0.23) : 0.05,
						object.modelId === 'key-panel' ? Math.min(0.15, breadth * 0.23) : 0.05,
						0.028,
						20
					),
					materials.felt
				);
				felt.position.set(longZ ? 0 : along, -height * 0.5 - 0.024, longZ ? along : 0);
				pads.push(felt);
			}
			flex.add(mergeInstrumentHardware(fasteners, 'key-fasteners'));
			root.add(mergeInstrumentHardware(pads, 'key-felt-pads'));
			const bridge = cylinderBetween(
				new THREE.Vector3(
					longZ ? 0 : -length * 0.31,
					-height * 0.5 - 0.055,
					longZ ? -length * 0.31 : 0
				),
				new THREE.Vector3(
					longZ ? 0 : length * 0.31,
					-height * 0.5 - 0.055,
					longZ ? length * 0.31 : 0
				),
				0.012,
				materials.metal
			);
			bridge.name = 'key-mount-bridge';
			root.add(bridge);
		}
	} else if (object.kind === 'rail' && object.path != null && object.path.length > 1) {
		const rail = getRailGeometry(object);
		const segments: THREE.BufferGeometry[] = [];
		for (const points of rail.paths) {
			for (let index = 1; index < points.length; index++) {
				const a = points[index - 1];
				const b = points[index];
				if (a == null || b == null) continue;
				const segment = cylinderBetween(
					new THREE.Vector3(...a),
					new THREE.Vector3(...b),
					rail.radius,
					material
				);
				segment.updateMatrix();
				segment.geometry.applyMatrix4(segment.matrix);
				segments.push(segment.geometry);
			}
			for (let index = 1; index < points.length - 1; index++) {
				const point = points[index];
				if (point == null) continue;
				const joint = new THREE.Mesh(new THREE.SphereGeometry(rail.radius, 8, 6), material);
				joint.position.fromArray(point);
				joint.updateMatrix();
				joint.geometry.applyMatrix4(joint.matrix);
				segments.push(joint.geometry);
			}
		}
		const geometry = mergeGeometries(segments, false);
		for (const segment of segments) segment.dispose();
		if (geometry != null) {
			const wire = new THREE.Mesh(geometry, material);
			wire.castShadow = true;
			wire.receiveShadow = true;
			flex.add(wire);
		}
		for (const index of [0, Math.floor((object.path.length - 1) / 2), object.path.length - 1]) {
			const first = rail.paths[0][index];
			const second = rail.paths[1][index];
			if (first == null || second == null) continue;
			const a = new THREE.Vector3(...first);
			const b = new THREE.Vector3(...second);
			a.y -= rail.radius * 1.5;
			b.y -= rail.radius * 1.5;
			root.add(cylinderBetween(a, b, rail.radius * 0.7, material));
		}
	} else if (object.kind === 'rail') {
		const railRadius = Math.max(0.025, Math.min(0.055, height * 0.24));
		const base = new THREE.Mesh(
			new RoundedBoxGeometry(width, Math.max(0.035, height * 0.18), depth * 0.72, 2, 0.018),
			material
		);
		base.position.y = -height * 0.36;
		base.castShadow = true;
		flex.add(base);
		for (const side of [-1, 1]) {
			const points = [
				new THREE.Vector3(-width * 0.5, height * 0.35, side * depth * 0.42),
				new THREE.Vector3(-width * 0.28, height * 0.25, side * depth * 0.42),
				new THREE.Vector3(width * 0.28, height * 0.25, side * depth * 0.42),
				new THREE.Vector3(width * 0.5, height * 0.35, side * depth * 0.42)
			];
			const rail = new THREE.Mesh(
				new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 30, railRadius, 10, false),
				material
			);
			rail.castShadow = true;
			flex.add(rail);
		}
		for (const x of [-width * 0.35, 0, width * 0.35]) {
			const sleeper = cylinderBetween(
				new THREE.Vector3(x, -height * 0.4, -depth * 0.5),
				new THREE.Vector3(x, -height * 0.4, depth * 0.5),
				0.03,
				material
			);
			root.add(sleeper);
		}
	} else if (object.kind === 'drum') {
		const radius = Math.min(width, depth) * 0.5;
		const body = new THREE.Mesh(
			new THREE.CylinderGeometry(radius, radius * 0.96, height, 48),
			material
		);
		body.castShadow = true;
		flex.add(body);
		const skin = new THREE.Mesh(
			new THREE.CylinderGeometry(radius * 0.96, radius * 0.96, 0.022, 48),
			materials.skin
		);
		skin.position.y = height * 0.5 + 0.005;
		skin.receiveShadow = true;
		flex.add(skin);
		for (const y of [-height * 0.45, height * 0.47]) {
			const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.026, 8, 48), materials.metal);
			rim.rotation.x = Math.PI * 0.5;
			rim.position.y = y;
			flex.add(rim);
		}
	} else if (object.kind === 'bowl') {
		const radius = Math.min(width, depth) * 0.5;
		const profile = [
			new THREE.Vector2(0, -height * 0.42),
			new THREE.Vector2(radius * 0.35, -height * 0.4),
			new THREE.Vector2(radius * 0.67, -height * 0.15),
			new THREE.Vector2(radius * 0.88, height * 0.2),
			new THREE.Vector2(radius, height * 0.5)
		];
		const bowlMaterial = material;
		bowlMaterial.side = THREE.DoubleSide;
		const bowl = new THREE.Mesh(new THREE.LatheGeometry(profile, 48), bowlMaterial);
		bowl.castShadow = true;
		bowl.receiveShadow = true;
		flex.add(bowl);
		const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.026, 8, 48), bowlMaterial);
		rim.rotation.x = Math.PI * 0.5;
		rim.position.y = height * 0.5;
		flex.add(rim);
	} else {
		const radius = Math.max(width, height, depth) * 0.5;
		const body = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 24), material);
		body.castShadow = true;
		body.receiveShadow = true;
		flex.add(body);
		const ring = new THREE.Mesh(
			new THREE.TorusGeometry(radius * 1.015, 0.017, 8, 36),
			materials.metal
		);
		ring.rotation.x = Math.PI * 0.5;
		flex.add(ring);
	}
	if (object.kind !== 'bar' || object.mountStyle !== 'none')
		addMount(root, object, materials, wallZ);
	if (object.kind !== 'rail' && object.kind !== 'bumper') {
		const glow = new THREE.Mesh(
			new THREE.PlaneGeometry(width * 2.1, depth * 4.2),
			new THREE.MeshBasicMaterial({
				map: materials.glowTexture,
				color: object.glowColor ?? impactColor(object.id),
				transparent: true,
				opacity: 0,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
				toneMapped: false,
				side: THREE.DoubleSide
			})
		);
		glow.rotation.x = -Math.PI / 2;
		glow.position.y = height / 2 + 0.012;
		glow.name = 'impact-glow';
		glow.raycast = () => {};
		glow.renderOrder = 3;
		flex.add(glow);
	}

	return root;
}

function configureKeyGlow(
	material: THREE.MeshStandardMaterial,
	lengthAxis: 'x' | 'z',
	endColor: string
): void {
	const energy = { value: 0 };
	const balance = { value: 0.5 };
	material.userData['glowEnergyUniform'] = energy;
	material.userData['glowBalanceUniform'] = balance;
	const compile = material.onBeforeCompile;
	const programKey = material.customProgramCacheKey();
	material.onBeforeCompile = (shader, renderer) => {
		compile.call(material, shader, renderer);
		shader.uniforms['uGlowEnergy'] = energy;
		shader.uniforms['uGlowBalance'] = balance;
		shader.uniforms['uGlowStartColor'] = { value: material.emissive.clone() };
		shader.uniforms['uGlowEndColor'] = { value: new THREE.Color(endColor) };
		shader.vertexShader = 'varying float vGlowMix;\n' + shader.vertexShader;
		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			`#include <begin_vertex>\n vGlowMix = clamp(position.${lengthAxis} / uBarWidth + 0.5, 0.0, 1.0);`
		);
		shader.fragmentShader =
			'varying float vGlowMix; uniform float uGlowEnergy; uniform float uGlowBalance; uniform vec3 uGlowStartColor; uniform vec3 uGlowEndColor;\n' +
			shader.fragmentShader;
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <emissivemap_fragment>',
			'#include <emissivemap_fragment>\n float glowWeight = vGlowMix / ((1.0 / uGlowBalance - 2.0) * (1.0 - vGlowMix) + 1.0);\n totalEmissiveRadiance = mix(uGlowEndColor, uGlowStartColor, glowWeight) * uGlowEnergy;'
		);
	};
	material.customProgramCacheKey = () => `${programKey}-glow-gradient-v2`;
}

/** Every variant retains the flat central strike face used by its box collider. */
function makeKeyGeometry(object: TSceneObject): THREE.BufferGeometry {
	if (object.modelId === 'key-block') return makeResonatorGeometry(object, false);
	const longZ = object.size[2] > object.size[0];
	const [width, height, depth] = longZ
		? [object.size[2], object.size[1], object.size[0]]
		: object.size;
	const model = object.modelId ?? 'key-bar';
	let geometry: THREE.BufferGeometry;
	if (model === 'key-spoon' || model === 'key-strip') {
		// Subdivision keeps the flat strike area independent from the bent outer lips.
		geometry = new THREE.BoxGeometry(width, height, depth, 48, 2, 12);
		if (model === 'key-spoon') {
			const positions = geometry.getAttribute('position');
			const radius = depth / (object.roundedNose ? 2 : 4);
			const center = width / 2 - radius;
			for (let index = 0; index < positions.count; index++) {
				const x = positions.getX(index);
				if (x > center) {
					const extent =
						depth / 2 - radius + Math.sqrt(Math.max(0, radius * radius - (x - center) ** 2));
					positions.setZ(index, (positions.getZ(index) * extent) / (depth / 2));
				}
			}
		}
		if (model === 'key-strip') clipKeyCorners(geometry, width, height, depth);
	} else if (model === 'key-bar' || model === 'key-panel') {
		geometry = new THREE.BoxGeometry(width, height, depth, 24, 2, 6);
		clipKeyCorners(geometry, width, height, depth, Math.min(0.008, height * 0.1));
		geometry.computeVertexNormals();
	} else geometry = new RoundedBoxGeometry(width, height, depth, 3, Math.min(0.025, height * 0.18));
	if (model === 'key-strip' || model === 'key-spoon') {
		const positions = geometry.getAttribute('position');
		for (let index = 0; index < positions.count; index++) {
			const x = positions.getX(index);
			const edge = THREE.MathUtils.smoothstep(Math.abs(x), width * 0.32, width * 0.5);
			const frontBend = object.roundedNose ? -0.07 : -0.035;
			const bend =
				model === 'key-spoon' ? edge * depth * (x < 0 ? 0.1 : frontBend) : edge * depth * 0.14;
			if (Math.abs(positions.getY(index)) > height * 0.49) {
				const bevel = Math.min(0.008, height * 0.1, depth * 0.1);
				let insetX = THREE.MathUtils.clamp(x, -width / 2 + bevel, width / 2 - bevel);
				let extent = depth / 2;
				let insetExtent = extent - bevel;
				if (model === 'key-spoon') {
					const radius = depth / (object.roundedNose ? 2 : 4);
					const center = width / 2 - radius;
					if (x > center) {
						const arc = Math.sqrt(Math.max(0, 1 - ((x - center) / radius) ** 2));
						extent = depth / 2 - radius + radius * arc;
						insetExtent = depth / 2 - radius + (radius - bevel) * arc;
						insetX = center + ((x - center) * (radius - bevel)) / radius;
					}
				} else {
					const corner = Math.min(width * 0.055, depth * 0.18);
					extent -= Math.max(0, Math.abs(x) - (width / 2 - corner));
					insetExtent = extent - bevel;
				}
				positions.setX(index, insetX);
				positions.setZ(index, extent > 0 ? (positions.getZ(index) * insetExtent) / extent : 0);
			}
			positions.setY(index, positions.getY(index) + bend);
		}
		positions.needsUpdate = true;
		geometry.computeVertexNormals();
	}
	if (longZ) geometry.rotateY(-Math.PI / 2);
	return geometry;
}

function makeResonatorGeometry(object: TSceneObject, endcap: boolean): THREE.BufferGeometry {
	const [width, height, depth] = object.size;
	const longZ = depth > width;
	const length = Math.max(width, depth);
	const breadth = Math.min(width, depth);
	const capLength = Math.min(0.08, length * 0.12);
	const segmentLength = endcap ? capLength : length - capLength;
	const geometry = new RoundedBoxGeometry(
		segmentLength,
		height,
		breadth,
		3,
		Math.min(0.003, height * 0.08, breadth * 0.08)
	);
	geometry.translate(endcap ? (length - capLength) / 2 : -capLength / 2, 0, 0);
	if (longZ) geometry.rotateY(-Math.PI / 2);
	return geometry;
}

function clipKeyCorners(
	geometry: THREE.BufferGeometry,
	width: number,
	height: number,
	depth: number,
	bevel = 0
): void {
	const positions = geometry.getAttribute('position');
	const corner = Math.min(width * 0.055, depth * 0.18);
	for (let index = 0; index < positions.count; index++) {
		let x = positions.getX(index),
			z = positions.getZ(index);
		const extent = depth / 2 - Math.max(0, Math.abs(x) - (width / 2 - corner));
		z *= extent / (depth / 2);
		if (bevel > 0 && Math.abs(positions.getY(index)) > height * 0.49) {
			x = Math.sign(x) * Math.min(Math.abs(x), width / 2 - bevel);
			z = Math.sign(z) * Math.min(Math.abs(z), extent - bevel);
		}
		positions.setX(index, x);
		positions.setZ(index, z);
	}
}

function addMount(
	root: THREE.Group,
	object: TResolvedObject,
	materials: TMaterials,
	wallZ: number
) {
	const [width, height, depth] = object.size;
	const endpoints =
		object.path != null && object.path.length > 1
			? [object.path[0], object.path[object.path.length - 1]]
					.filter((point): point is [number, number, number] => point != null)
					.map((point) => new THREE.Vector3(...point))
			: object.kind === 'bar' && depth > width
				? [new THREE.Vector3(0, -height * 0.5 - 0.055, -depth * 0.31)]
				: [-Math.min(0.7, width * 0.3), Math.min(0.7, width * 0.3)].map(
						(x) => new THREE.Vector3(x, -Math.max(0.07, height * 0.6), -depth * 0.12)
					);
	root.updateMatrixWorld(true);
	const supports: THREE.Mesh[] = [];
	for (const start of endpoints) {
		const worldStart = root.localToWorld(start.clone());
		const worldEnd = new THREE.Vector3(worldStart.x, worldStart.y, wallZ + 0.02);
		const end = root.worldToLocal(worldEnd);
		supports.push(cylinderBetween(start, end, 0.016, materials.metal));
		const folded =
			object.kind === 'bar' &&
			(object.mountStyle === 'folded' ||
				(object.mountStyle == null && object.modelId === 'key-strip'));
		const anchor = new THREE.Mesh(
			folded
				? new THREE.BoxGeometry(Math.min(width, 0.5), 0.06, 0.03)
				: new THREE.SphereGeometry(0.045, 12, 8),
			materials.metal
		);
		anchor.position.copy(end);
		anchor.castShadow = true;
		supports.push(anchor);
	}
	root.add(mergeInstrumentHardware(supports, 'wall-mount-hardware'));
}

function cylinderBetween(
	from: THREE.Vector3,
	to: THREE.Vector3,
	radius: number,
	material: THREE.Material
): THREE.Mesh {
	const direction = to.clone().sub(from);
	const mesh = new THREE.Mesh(
		new THREE.CylinderGeometry(radius, radius, direction.length(), 10),
		material
	);
	mesh.position.copy(from).add(to).multiplyScalar(0.5);
	mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
	mesh.castShadow = true;
	return mesh;
}

export { makeMarble, updateMarbleAppearance } from './marble';

export function updateInstrumentReaction(
	group: THREE.Group,
	object: TSceneObject,
	time: number,
	impacts: { time: number; strength: number }[],
	bloom = 1,
	contacts: readonly Pick<TSurfaceContact, 'start' | 'end'>[] = []
): number {
	let bend = 0;
	let energy = 0;
	const glowFade = object.glowMode === 'contact' ? undefined : object.glowFade;
	const glowDecay = glowFade == null ? 6 : Math.log(100) / glowFade;
	const cutoff = Math.max(1.4, glowFade ?? 0);
	for (const impact of impacts) {
		const elapsed = time - impact.time;
		if (elapsed < 0 || elapsed > cutoff) continue;
		const strength = Math.max(0.25, Math.min(1, impact.strength));
		if (elapsed <= 1.4) bend -= Math.sin(elapsed * 35) * Math.exp(-elapsed * 7) * strength;
		const triggerStrength = object.binding != null ? Math.max(0.65, strength) : strength;
		energy += Math.exp(-elapsed * glowDecay) * triggerStrength;
	}
	if (object.glowMode === 'contact') {
		energy = 0;
		for (const contact of contacts) {
			if (time < contact.start || time > contact.end + 0.12) continue;
			energy = Math.max(
				energy,
				time <= contact.end
					? 1
					: 1 - THREE.MathUtils.smoothstep(time, contact.end, contact.end + 0.12)
			);
		}
	}
	if (object.kind === 'rail') energy = 0;
	const flex = group.getObjectByName('flex');
	const scale = object.flex ?? 0.35;
	if (flex != null) {
		flex.position.y = object.kind === 'bar' ? 0 : bend * 0.035 * scale;
		flex.rotation.x = object.kind === 'bar' ? 0 : bend * 0.035 * scale;
	}
	const reactionMaterials =
		(group.userData['reactionMaterials'] as THREE.MeshStandardMaterial[] | undefined) ??
		[group.userData['surfaceMaterial'] as THREE.MeshStandardMaterial | undefined];
	for (const material of reactionMaterials) {
		if (material == null) continue;
		const uniform = material.userData['flexUniform'] as { value: number } | undefined;
		if (uniform != null) uniform.value = bend * 0.22 * scale;
		material.emissiveIntensity = energy * ((group.userData['emission'] as number) ?? 0);
		const glowEnergy = material.userData['glowEnergyUniform'] as { value: number } | undefined;
		if (glowEnergy != null) glowEnergy.value = material.emissiveIntensity;
		const glowBalance = material.userData['glowBalanceUniform'] as { value: number } | undefined;
		if (glowBalance != null) glowBalance.value = object.glowBalance ?? 0.5;
	}
	const glow = group.getObjectByName('impact-glow');
	if (glow instanceof THREE.Mesh && glow.material instanceof THREE.MeshBasicMaterial)
		glow.material.opacity = Math.min(0.8, energy * (object.emission ?? 1) * 0.08 * bloom);
	return energy;
}

function impactColor(id: string): string {
	let hash = 0;
	for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
	return ['#26dbff', '#a35cff', '#ffa847', '#ff65c9'][Math.abs(hash) % 4] ?? '#26dbff';
}

export function makeNoteMarker(
	noteId: string,
	note: TNote | undefined,
	linked: boolean
): THREE.Group {
	const group = new THREE.Group();
	group.userData['noteId'] = noteId;
	group.userData['linked'] = linked;
	const material = new THREE.MeshBasicMaterial({
		color: linked ? '#6ecaf3' : '#a5b3c4',
		transparent: true,
		opacity: 0.8,
		depthTest: false
	});
	const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.016, 6, 28), material);
	ring.renderOrder = 10;
	group.add(ring);
	const center = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), material);
	center.renderOrder = 10;
	group.add(center);
	if (note != null) {
		const canvas = document.createElement('canvas');
		canvas.width = 256;
		canvas.height = 80;
		const context = canvas.getContext('2d');
		if (context != null) {
			context.fillStyle = '#242830';
			context.beginPath();
			context.roundRect(2, 2, 252, 76, 20);
			context.fill();
			context.font = '500 28px system-ui';
			context.textAlign = 'center';
			context.textBaseline = 'middle';
			context.fillStyle = '#d9e7f2';
			const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
			context.fillText(
				`${names[note.midi % 12]}${Math.floor(note.midi / 12) - 1}  ·  ${note.time.toFixed(2)}s`,
				128,
				42
			);
			const texture = new THREE.CanvasTexture(canvas);
			texture.colorSpace = THREE.SRGBColorSpace;
			const label = new THREE.Sprite(
				new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
			);
			label.name = 'note-label';
			label.raycast = () => {};
			label.scale.set(1.45, 0.45, 1);
			label.position.set(0.92, 0.22, 0.1);
			label.renderOrder = 20;
			label.visible = false;
			group.add(label);
		}
	}
	return group;
}

export function createMaterials(): TMaterials {
	const grainCanvas = document.createElement('canvas');
	grainCanvas.width = 512;
	grainCanvas.height = 128;
	const context = grainCanvas.getContext('2d');
	if (context != null) {
		context.fillStyle = '#b99373';
		context.fillRect(0, 0, 512, 128);
		let seed = 483;
		for (let index = 0; index < 180; index += 1) {
			seed = (seed * 16807) % 2147483647;
			const y = seed % 128;
			context.beginPath();
			context.strokeStyle = index % 3 === 0 ? 'rgba(92,51,24,.14)' : 'rgba(255,238,203,.14)';
			context.lineWidth = index % 4 === 0 ? 1.4 : 0.5;
			context.moveTo(0, y);
			context.bezierCurveTo(145, y - 4, 375, y + 4, 512, y + 1);
			context.stroke();
		}
	}
	const grain = new THREE.CanvasTexture(grainCanvas);
	grain.colorSpace = THREE.SRGBColorSpace;
	grain.wrapS = THREE.RepeatWrapping;
	grain.wrapT = THREE.RepeatWrapping;
	grain.anisotropy = 4;
	const wood = new THREE.MeshStandardMaterial({
		map: grain,
		color: '#dbc5af',
		roughness: 0.4,
		metalness: 0.025
	});
	const brushCanvas = document.createElement('canvas');
	brushCanvas.width = 512;
	brushCanvas.height = 128;
	const brushContext = brushCanvas.getContext('2d');
	if (brushContext != null) {
		brushContext.fillStyle = '#808080';
		brushContext.fillRect(0, 0, 512, 128);
		let seed = 71;
		for (let row = 0; row < 128; row++) {
			seed = (seed * 16807) % 2147483647;
			brushContext.fillStyle = `rgba(${seed % 2 === 0 ? '255,255,255' : '0,0,0'},${0.02 + (seed % 8) * 0.004})`;
			brushContext.fillRect(0, row, 512, 1);
		}
	}
	const brush = new THREE.CanvasTexture(brushCanvas);
	brush.wrapS = THREE.RepeatWrapping;
	brush.wrapT = THREE.RepeatWrapping;
	brush.repeat.set(2, 3);
	brush.anisotropy = 4;
	const metal = new THREE.MeshStandardMaterial({
		color: '#bdc5c1',
		bumpMap: brush,
		bumpScale: 0.004,
		roughness: 0.23,
		metalness: 0.93
	});
	const rubber = new THREE.MeshStandardMaterial({ color: '#d3a27d', roughness: 0.65 });
	const glass = new THREE.MeshPhysicalMaterial({
		color: '#c3d3ce',
		metalness: 0,
		roughness: 0.08,
		transmission: 0.9,
		thickness: 0.1,
		ior: 1.48,
		clearcoat: 0
	});
	const bronze = new THREE.MeshStandardMaterial({
		color: '#c6a166',
		metalness: 0.76,
		roughness: 0.28,
		side: THREE.DoubleSide
	});
	const felt = new THREE.MeshStandardMaterial({ color: '#71766c', roughness: 1 });
	const skin = new THREE.MeshStandardMaterial({ color: '#efe3cc', roughness: 0.78 });
	const marbleCore = new THREE.MeshStandardMaterial({ color: '#e9fff3', roughness: 0.18 });
	const glowCanvas = document.createElement('canvas');
	glowCanvas.width = 128;
	glowCanvas.height = 128;
	const glowContext = glowCanvas.getContext('2d');
	if (glowContext != null) {
		const gradient = glowContext.createRadialGradient(64, 64, 0, 64, 64, 64);
		gradient.addColorStop(0, 'rgba(255,255,255,1)');
		gradient.addColorStop(0.25, 'rgba(255,255,255,.65)');
		gradient.addColorStop(1, 'rgba(255,255,255,0)');
		glowContext.fillStyle = gradient;
		glowContext.fillRect(0, 0, 128, 128);
	}
	const glowTexture = new THREE.CanvasTexture(glowCanvas);
	const shared = new Set<THREE.Material>([
		wood,
		metal,
		rubber,
		glass,
		bronze,
		felt,
		skin,
		marbleCore
	]);
	return {
		wood,
		metal,
		rubber,
		glass,
		bronze,
		felt,
		skin,
		marbleCore,
		shared,
		glowTexture,
		dispose() {
			grain.dispose();
			brush.dispose();
			glowTexture.dispose();
			for (const material of shared) material.dispose();
		}
	};
}

export interface TMaterials {
	wood: THREE.MeshStandardMaterial;
	metal: THREE.MeshStandardMaterial;
	rubber: THREE.MeshStandardMaterial;
	glass: THREE.MeshPhysicalMaterial;
	bronze: THREE.MeshStandardMaterial;
	felt: THREE.MeshStandardMaterial;
	skin: THREE.MeshStandardMaterial;
	marbleCore: THREE.MeshStandardMaterial;
	shared: Set<THREE.Material>;
	glowTexture: THREE.CanvasTexture;
	dispose: () => void;
}
