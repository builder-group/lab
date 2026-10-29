import * as THREE from 'three';
import type { TVec3 } from '../project/types';
import type { TCameraPose } from './scene-camera';

/** Creates selectable authoring overlays; the scene owner controls when they are visible. */
export function createSceneEditHelpers(): TSceneEditHelpers {
	const group = new THREE.Group();
	group.name = 'scene-edit-helpers';
	group.visible = false;
	const camera = createEntityGroup('camera');
	const lighting = createEntityGroup('lighting');
	group.add(camera, lighting);
	const cameraMaterial = createLineMaterial();
	const lightingMaterial = createLineMaterial();
	const cameraBody = createLines(cameraBodySegments(), cameraMaterial, 'camera-body');
	const cameraFrustum = createLines(frustumSegments(38, 9 / 16), cameraMaterial, 'camera-frustum');
	camera.add(cameraBody, cameraFrustum);
	const lightIcon = createLines(lightIconSegments(), lightingMaterial, 'light-icon');
	const lightAim = createLines(aimSegments(2), lightingMaterial, 'light-aim');
	lighting.add(lightIcon, lightAim);
	const pickables: THREE.Object3D[] = [camera, lighting];
	const orientation = new THREE.Matrix4();
	const target = new THREE.Vector3();
	const up = new THREE.Vector3(0, 1, 0);
	let lastFov = 38;
	let lastAspect = 9 / 16;
	let lastAimLength = 2;
	let disposed = false;

	return {
		group,
		camera,
		lighting,
		pickables,
		update(state) {
			if (disposed) return;
			group.visible = state.visible;
			camera.position.fromArray(state.cameraPose.position);
			target.fromArray(state.cameraPose.target);
			orientation.lookAt(camera.position, target, up);
			camera.quaternion.setFromRotationMatrix(orientation);
			lighting.position.fromArray(state.lightingPosition);
			target.fromArray(state.lightingTarget);
			orientation.lookAt(lighting.position, target, up);
			lighting.quaternion.setFromRotationMatrix(orientation);
			const aimLength = Math.min(2.5, lighting.position.distanceTo(target));
			if (lastAimLength !== aimLength) {
				updateSegments(lightAim, aimSegments(aimLength));
				lastAimLength = aimLength;
			}
			if (lastFov !== state.cameraPose.fov || lastAspect !== state.aspect) {
				updateSegments(cameraFrustum, frustumSegments(state.cameraPose.fov, state.aspect));
				lastFov = state.cameraPose.fov;
				lastAspect = state.aspect;
			}
			const neutral = state.darkBackground ? '#c8ced7' : '#33404b';
			const selected = state.darkBackground ? '#ed9a50' : '#cf6510';
			cameraMaterial.color.set(state.selectedEntity === 'camera' ? selected : neutral);
			lightingMaterial.color.set(state.selectedEntity === 'lighting' ? selected : neutral);
			group.updateMatrixWorld(true);
		},
		getPickEntity(object) {
			if (disposed || !group.visible) return null;
			let ancestor: THREE.Object3D | null = object;
			while (ancestor != null && ancestor !== group) {
				if (ancestor === camera) return 'camera';
				if (ancestor === lighting) return 'lighting';
				ancestor = ancestor.parent;
			}
			return null;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			group.visible = false;
			group.removeFromParent();
			for (const lines of [cameraBody, cameraFrustum, lightIcon, lightAim])
				lines.geometry.dispose();
			cameraMaterial.dispose();
			lightingMaterial.dispose();
			pickables.length = 0;
			camera.clear();
			lighting.clear();
			group.clear();
		}
	};
}

export type TSceneEditEntity = 'camera' | 'lighting';

export interface TSceneEditHelperState {
	cameraPose: TCameraPose;
	aspect: number;
	lightingPosition: TVec3;
	lightingTarget: TVec3;
	selectedEntity: TSceneEditEntity | null;
	visible: boolean;
	darkBackground?: boolean;
}

export interface TSceneEditHelpers {
	group: THREE.Group;
	camera: THREE.Group;
	lighting: THREE.Group;
	/** Raycast recursively, with a line threshold appropriate to the viewport zoom. */
	pickables: THREE.Object3D[];
	update(state: TSceneEditHelperState): void;
	getPickEntity(object: THREE.Object3D): TSceneEditEntity | null;
	dispose(): void;
}

function createEntityGroup(entity: TSceneEditEntity): THREE.Group {
	const group = new THREE.Group();
	group.name = `${entity}-edit-helper`;
	group.userData['entity'] = entity;
	return group;
}

function createLineMaterial(): THREE.LineBasicMaterial {
	return new THREE.LineBasicMaterial({
		color: '#33404b',
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
		transparent: true,
		opacity: 1
	});
}

function createLines(
	positions: number[],
	material: THREE.LineBasicMaterial,
	name: string
): THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	const lines = new THREE.LineSegments(geometry, material);
	lines.name = name;
	lines.renderOrder = 1000;
	return lines;
}

function updateSegments(lines: THREE.LineSegments, positions: number[]): void {
	const attribute = lines.geometry.getAttribute('position');
	for (let index = 0; index < attribute.count; index++) {
		attribute.setXYZ(
			index,
			positions[index * 3] ?? 0,
			positions[index * 3 + 1] ?? 0,
			positions[index * 3 + 2] ?? 0
		);
	}
	attribute.needsUpdate = true;
	lines.geometry.computeBoundingSphere();
	lines.geometry.computeBoundingBox();
}

function cameraBodySegments(): number[] {
	const vertices: TVec3[] = [
		[-0.28, -0.19, 0.06],
		[0.28, -0.19, 0.06],
		[0.28, 0.19, 0.06],
		[-0.28, 0.19, 0.06],
		[-0.28, -0.19, 0.48],
		[0.28, -0.19, 0.48],
		[0.28, 0.19, 0.48],
		[-0.28, 0.19, 0.48]
	];
	const edges = [
		[0, 1],
		[1, 2],
		[2, 3],
		[3, 0],
		[4, 5],
		[5, 6],
		[6, 7],
		[7, 4],
		[0, 4],
		[1, 5],
		[2, 6],
		[3, 7]
	];
	const positions = edges.flatMap((edge) => edge.flatMap((index) => vertices[index] ?? []));
	positions.push(-0.15, 0.21, 0.25, 0, 0.4, 0.25, 0, 0.4, 0.25, 0.15, 0.21, 0.25);
	return positions;
}

function frustumSegments(fov: number, aspect: number): number[] {
	const depth = 1.4;
	const height = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * depth;
	const width = height * aspect;
	const corners: TVec3[] = [
		[-width, -height, -depth],
		[width, -height, -depth],
		[width, height, -depth],
		[-width, height, -depth]
	];
	return corners.flatMap((corner, index) => [
		0,
		0,
		0,
		...corner,
		...corner,
		...(corners[(index + 1) % 4] ?? corner)
	]);
}

function lightIconSegments(): number[] {
	const positions: number[] = [];
	for (let index = 0; index < 32; index++) {
		const angle = (index * Math.PI) / 16;
		const next = ((index + 1) * Math.PI) / 16;
		positions.push(
			Math.cos(angle) * 0.3,
			Math.sin(angle) * 0.3,
			0,
			Math.cos(next) * 0.3,
			Math.sin(next) * 0.3,
			0
		);
	}
	for (let index = 0; index < 12; index++) {
		const angle = (index * Math.PI) / 6;
		positions.push(
			Math.cos(angle) * 0.4,
			Math.sin(angle) * 0.4,
			0,
			Math.cos(angle) * 0.55,
			Math.sin(angle) * 0.55,
			0
		);
	}
	return positions;
}

function aimSegments(length: number): number[] {
	const arrowLength = Math.min(length, 0.18);
	const arrowWidth = arrowLength * 0.6;
	return [
		0,
		0,
		0,
		0,
		0,
		-length,
		0,
		0,
		-length,
		-arrowWidth,
		0,
		-length + arrowLength,
		0,
		0,
		-length,
		arrowWidth,
		0,
		-length + arrowLength
	];
}
