import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { TSceneObject } from '../project';
import { createMaterials, makeInstrument } from './scene-assets';
import { getPhysicalBounds } from './scene-bounds';
import { clearGroup } from './scene-resources';

/** Renders a catalog batch in one reusable context rather than mounting a canvas per card. */
export async function renderAssetPreviews(
	items: TAssetPreviewItem[]
): Promise<Record<string, string>> {
	const output: Record<string, string> = {};
	const missing: TAssetPreviewItem[] = [];
	for (const item of items) {
		const cached = previewCache.get(previewKey(item.object));
		if (cached) output[item.id] = cached;
		else missing.push(item);
	}
	if (!missing.length) return output;
	const renderer = new THREE.WebGLRenderer({
		antialias: true,
		alpha: false,
		preserveDrawingBuffer: true
	});
	renderer.setSize(640, 480, false);
	renderer.setPixelRatio(1);
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.25;
	const room = new RoomEnvironment();
	const generator = new THREE.PMREMGenerator(renderer);
	const environment = generator.fromScene(room, 0.04);
	room.dispose();
	generator.dispose();
	const scene = new THREE.Scene();
	scene.background = new THREE.Color('#77818e');
	scene.environment = environment.texture;
	scene.environmentIntensity = 1.6;
	const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
	scene.add(new THREE.HemisphereLight('#fff6e9', '#596c8c', 1.6));
	const key = new THREE.DirectionalLight('#ffedd8', 3.5);
	key.position.set(-3, 7, 5);
	scene.add(key);
	const fill = new THREE.DirectionalLight('#b8d8ff', 1.4);
	fill.position.set(4, 1, -2);
	scene.add(fill);
	const materials = createMaterials();
	try {
		for (const item of missing) {
			const model = makeInstrument(
				{ ...item.object, position: [0, 0, 0], rotation: [0, 0, 0] },
				materials,
				-0.75,
				true
			);
			const mountChildren = model.children.filter((child) => child.name !== 'flex');
			for (const child of mountChildren) child.visible = false;
			scene.add(model);
			const box = getPhysicalBounds(model.getObjectByName('flex') ?? model);
			const center = box.getCenter(new THREE.Vector3());
			const span = Math.max(box.getSize(new THREE.Vector3()).length(), 0.5);
			const direction =
				item.object.kind === 'rail'
					? new THREE.Vector3(0.25, 0.55, 1.5)
					: new THREE.Vector3(0.65, 1.05, 1.45);
			camera.position.copy(center).addScaledVector(direction.normalize(), span * 2);
			camera.lookAt(center);
			camera.near = span * 0.01;
			camera.far = span * 4;
			camera.updateMatrixWorld(true);
			const viewSize = box
				.clone()
				.applyMatrix4(camera.matrixWorldInverse)
				.getSize(new THREE.Vector3());
			const halfHeight = Math.max(viewSize.y, viewSize.x / (4 / 3), 0.05) * 0.56;
			camera.top = halfHeight;
			camera.bottom = -halfHeight;
			camera.right = halfHeight * (4 / 3);
			camera.left = -camera.right;
			camera.updateProjectionMatrix();
			renderer.render(scene, camera);
			const url = renderer.domElement.toDataURL('image/webp', 0.9);
			output[item.id] = url;
			previewCache.set(previewKey(item.object), url);
			if (previewCache.size > 64) {
				const first = previewCache.keys().next().value;
				if (first) previewCache.delete(first);
			}
			scene.remove(model);
			clearGroup(model, materials.shared, materials.glowTexture);
		}
	} finally {
		materials.dispose();
		environment.dispose();
		renderer.dispose();
		renderer.forceContextLoss();
	}
	return output;
}
export interface TAssetPreviewItem {
	id: string;
	object: TSceneObject;
}
const previewCache = new Map<string, string>();
function previewKey(object: TSceneObject): string {
	return JSON.stringify([
		object.kind,
		object.modelId,
		object.mountStyle,
		object.roundedNose,
		object.materialFinish,
		object.size,
		object.path,
		object.material,
		object.color
	]);
}
