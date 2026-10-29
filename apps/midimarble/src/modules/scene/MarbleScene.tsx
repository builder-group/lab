import React from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import {
	getProjectMarbles,
	type TNote,
	type TPerformance,
	type TProject,
	type TResolvedObject,
	type TSceneObject,
	type TSceneStyle,
	type TSurfaceContact,
	type TVec3
} from '../project';
import {
	createMaterials,
	makeInstrument,
	makeMarble,
	makeNoteMarker,
	updateInstrumentReaction,
	updateMarbleAppearance
} from './scene-assets';
import { getPhysicalBounds, getWallPosition } from './scene-bounds';
import { evaluateCamera, samplePosition, type TCameraPose } from './scene-camera';
import { cameraContextFov, cameraPassepartout, fitCameraGate } from './scene-camera-gate';
import { createSceneEditHelpers } from './scene-edit-helpers';
import { reconcileSceneObjects } from './scene-geometry';
import { evaluateLighting } from './scene-lighting';
import { orbitAroundPivot } from './scene-navigation';
import { getVisualObjects } from './scene-objects';
import { isScenePickVisible } from './scene-picking';
import { clearGroup } from './scene-resources';
import { updateTrajectoryLine } from './scene-trajectories';
import { axisDragDistance, boundTransform } from './scene-transform';
import { createStudioEnvironment } from './studio-environment';
import { getViewTransformToneMapping } from './view-transform';

export const MarbleScene: React.FC<TMarbleSceneProps> = (props) => {
	const hostRef = React.useRef<HTMLDivElement>(null);
	const runtimeRef = React.useRef<TSceneRuntime | null>(null);
	const propsRef = React.useRef(props);
	React.useEffect(() => {
		propsRef.current = props;
	});

	React.useEffect(() => {
		const host = hostRef.current;
		if (host == null) return;
		let runtime: TSceneRuntime;
		try {
			runtime = createScene(host, () => propsRef.current);
		} catch (error) {
			propsRef.current.onError?.(error instanceof Error ? error.message : 'WebGL is unavailable.');
			return;
		}
		runtimeRef.current = runtime;
		propsRef.current.sceneRef.current = runtime.handle;
		runtime.rebuild();
		return () => {
			propsRef.current.sceneRef.current = null;
			runtime.dispose();
			runtimeRef.current = null;
		};
	}, []);

	React.useEffect(() => {
		runtimeRef.current?.rebuild();
	}, [props.project, props.performance]);
	React.useEffect(() => {
		runtimeRef.current?.invalidate();
	}, [props.scenePreview, props.simulationProgress, props.keepSceneVisible]);

	return (
		<div
			ref={hostRef}
			className="marble-scene"
			style={{ width: '100%', height: '100%', position: 'relative' }}
		/>
	);
};

export interface TMarbleSceneProps {
	project: TProject;
	scenePreview?: TSceneStyle | null;
	performance: TPerformance | null;
	timeRef: React.MutableRefObject<number>;
	selectedObjectId: string | null;
	selectedNoteId: string | null;
	showTrajectory: boolean;
	view: 'camera' | 'orbit';
	tool?: 'select' | 'move' | 'rotate' | 'scale' | 'hand' | 'link';
	shading?: 'rendered' | 'solid' | 'material';
	selectedMarble?: boolean;
	orbitAroundSelection?: boolean;
	simulationProgress?: { simulatedUntil: number; phase: string; ratio: number } | null;
	keepSceneVisible?: boolean;
	onSelectMarble?: (id?: string) => void;
	selectedMarbleId?: string | null;
	selectedEntity?: 'camera' | 'lighting' | null;
	showSceneHelpers?: boolean;
	onSelectEntity?: (entity: 'camera' | 'lighting') => void;
	onMoveEntity?: (entity: 'camera' | 'lighting', position: TVec3, target: TVec3) => void;
	onBeginTransform?: () => void;
	onRequestOrbit?: () => void;
	showGrid?: boolean;
	cameraDistance?: number;
	cameraContext?: boolean;
	onSelectObject: (id: string | null) => void;
	onSelectNote: (id: string) => void;
	onTransformObject?: (id: string, position: TVec3) => void;
	onUpdateObject?: (id: string, patch: Partial<TSceneObject>) => void;
	onLinkObject?: (objectId: string, noteId: string) => void;
	onError?: (message: string) => void;
	sceneRef: React.RefObject<TSceneHandle | null>;
}

export interface TSceneHandle {
	canvas: HTMLCanvasElement;
	renderAt: (time: number) => void;
	setExportSize: (width: number, height: number) => void;
	restoreSize: () => void;
	capture: (width?: number, height?: number) => string;
	getCameraPose: () => TCameraPose;
	getPlacementPoint: () => TVec3;
	frameSelected: (id?: string) => void;
	frameAll: () => void;
	setView: (view: 'front' | 'right' | 'top' | 'perspective') => void;
	setAxis: (axis: 'x' | 'y' | 'z' | null) => void;
	cancelTransform: () => void;
	beginTransform: (mode: 'move' | 'rotate' | 'scale') => boolean;
	isTransforming: () => boolean;
}

interface TSceneRuntime {
	handle: TSceneHandle;
	rebuild: () => void;
	invalidate: () => void;
	dispose: () => void;
}

function createScene(host: HTMLDivElement, getProps: () => TMarbleSceneProps): TSceneRuntime {
	const renderer = new THREE.WebGLRenderer({
		antialias: true,
		alpha: false,
		preserveDrawingBuffer: true
	});
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
	renderer.setClearColor('#d4d6ce');
	renderer.autoClear = false;
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 0.95;
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFShadowMap;
	renderer.domElement.style.display = 'block';
	renderer.domElement.style.width = '100%';
	renderer.domElement.style.height = '100%';
	renderer.domElement.setAttribute('aria-label', 'Interactive 3D marble run');
	renderer.domElement.setAttribute('role', 'img');
	host.appendChild(renderer.domElement);
	const interactionSurface = document.createElement('div');
	interactionSurface.style.position = 'absolute';
	interactionSurface.style.touchAction = 'none';
	interactionSurface.style.cursor = 'default';
	interactionSurface.setAttribute('aria-hidden', 'true');
	host.appendChild(interactionSurface);
	const cameraOverlay = document.createElement('div');
	Object.assign(cameraOverlay.style, {
		position: 'absolute',
		inset: '0',
		pointerEvents: 'none',
		display: 'none'
	});
	cameraOverlay.setAttribute('aria-hidden', 'true');
	const cameraMasks = Array.from({ length: 4 }, () => {
		const mask = document.createElement('div');
		Object.assign(mask.style, { position: 'absolute', background: 'rgba(19,21,25,.48)' });
		cameraOverlay.appendChild(mask);
		return mask;
	});
	const cameraFrame = document.createElement('div');
	Object.assign(cameraFrame.style, {
		position: 'absolute',
		boxSizing: 'border-box',
		border: '1px solid rgba(232,236,242,.65)',
		boxShadow: '0 0 0 1px rgba(0,0,0,.45)'
	});
	cameraFrame.dataset['cameraGate'] = 'true';
	cameraOverlay.appendChild(cameraFrame);
	host.appendChild(cameraOverlay);

	const transformStatus = document.createElement('div');
	Object.assign(transformStatus.style, {
		position: 'absolute',
		left: '14px',
		top: '48px',
		padding: '6px 9px',
		background: 'rgba(28,31,38,.9)',
		color: '#dce8f6',
		border: '1px solid #4d657f',
		borderRadius: '4px',
		font: '11px ui-monospace,monospace',
		pointerEvents: 'none',
		display: 'none'
	});
	transformStatus.setAttribute('role', 'status');
	host.appendChild(transformStatus);

	const scene = new THREE.Scene();
	const editHelpers = createSceneEditHelpers();
	scene.add(editHelpers.group);
	scene.background = new THREE.Color('#bbc2b7');
	const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 1500);
	camera.position.set(4.8, 3.4, 13);
	const orbit = new OrbitControls(camera, interactionSurface);
	orbit.enableDamping = true;
	orbit.dampingFactor = 0.08;
	orbit.minDistance = 0.4;
	orbit.mouseButtons.LEFT = null;
	orbit.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
	orbit.mouseButtons.RIGHT = THREE.MOUSE.PAN;
	orbit.maxDistance = 250;
	orbit.maxPolarAngle = Math.PI * 0.88;
	const transform = new TransformControls(camera, interactionSurface);
	transform.setMode('translate');
	transform.setSpace('world');
	transform.setSize(0.78);
	const transformHelper = transform.getHelper();
	scene.add(transformHelper);
	const objects = new THREE.Group();
	const guides = new THREE.Group();
	const marble = new THREE.Group();
	scene.add(objects, guides, marble);
	marble.userData['entity'] = 'marble';
	marble.userData['marbleId'] = 'main';
	const additionalMarbleGroups = new Map<string, THREE.Group>();
	const forecastGhost = new THREE.Mesh(
		new THREE.SphereGeometry(0.24, 24, 16),
		new THREE.MeshBasicMaterial({
			color: '#82dbef',
			transparent: true,
			opacity: 0.28,
			depthWrite: false,
			wireframe: true
		})
	);
	forecastGhost.visible = false;
	forecastGhost.raycast = () => {};
	scene.add(forecastGhost);

	const environment = createStudioEnvironment(renderer);
	scene.environment = environment.texture;
	scene.environmentIntensity = 0.55;

	const ambient = new THREE.HemisphereLight('#fffdf1', '#778675', 1.3);
	scene.add(ambient);
	const keyLight = new THREE.DirectionalLight('#fff8ed', 2.1);
	keyLight.position.set(-9, 13, 16);
	keyLight.castShadow = true;
	keyLight.shadow.mapSize.set(2048, 2048);
	keyLight.shadow.camera.left = -18;
	keyLight.shadow.camera.right = 18;
	keyLight.shadow.camera.top = 18;
	keyLight.shadow.camera.bottom = -18;
	keyLight.shadow.camera.near = 0.5;
	keyLight.shadow.camera.far = 65;
	keyLight.shadow.normalBias = 0.025;
	keyLight.shadow.bias = -0.0002;
	keyLight.shadow.radius = 4;
	scene.add(keyLight, keyLight.target);
	const rimLight = new THREE.DirectionalLight('#edf2ff', 0.8);
	rimLight.position.set(8, 1, 6);
	scene.add(rimLight);
	const warmFill = new THREE.PointLight('#ffe0bd', 0, 35, 2);
	scene.add(warmFill);

	const wallMaterial = new THREE.MeshStandardMaterial({ color: '#bfc5b8', roughness: 0.96 });
	const wallGradient = { value: 0 };
	const wallTintLeft = { value: new THREE.Color(0.74, 0.82, 1) };
	const wallTintRight = { value: new THREE.Color(1.4, 1.15, 0.98) };
	const wallAspect = { value: 1 };
	const wallTanHalfFov = { value: Math.tan(THREE.MathUtils.degToRad(18)) };
	wallMaterial.onBeforeCompile = (shader) => {
		shader.uniforms['uWallGradient'] = wallGradient;
		shader.uniforms['uWallTintLeft'] = wallTintLeft;
		shader.uniforms['uWallTintRight'] = wallTintRight;
		shader.uniforms['uWallAspect'] = wallAspect;
		shader.uniforms['uWallTanHalfFov'] = wallTanHalfFov;
		shader.fragmentShader = `uniform float uWallGradient;
			uniform vec3 uWallTintLeft;
			uniform vec3 uWallTintRight;
			uniform float uWallAspect;
			uniform float uWallTanHalfFov;
			${shader.fragmentShader}`;
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <color_fragment>',
			`#include <color_fragment>
			float wallNdcX=(-vViewPosition.x / max(vViewPosition.z,0.001)) / max(uWallTanHalfFov*uWallAspect,0.001);
			float wallBlend=smoothstep(-1.1,1.1,wallNdcX);
			vec3 wallTint=mix(uWallTintLeft,uWallTintRight,wallBlend);
			diffuseColor.rgb*=mix(vec3(1.0),wallTint,uWallGradient);`
		);
	};
	wallMaterial.customProgramCacheKey = () => 'midi-marble-studio-wall-v2';
	const wall = new THREE.Mesh(new THREE.PlaneGeometry(2500, 2500), wallMaterial);
	wall.position.set(0, -20, -2.25);
	wall.receiveShadow = true;
	scene.add(wall);

	const resources = createMaterials();
	const solidMaterial = new THREE.MeshStandardMaterial({
		color: '#87909b',
		roughness: 0.8,
		metalness: 0
	});
	resources.shared.add(solidMaterial);
	const grid = new THREE.GridHelper(200, 200, '#626772', '#3b4048');
	grid.position.y = -0.02;
	scene.add(grid);
	const axisGuide = new THREE.Line(
		new THREE.BufferGeometry().setFromPoints([
			new THREE.Vector3(-1000, 0, 0),
			new THREE.Vector3(1000, 0, 0)
		]),
		new THREE.LineBasicMaterial({
			color: '#ed7777',
			transparent: true,
			opacity: 0.65,
			depthTest: false
		})
	);
	axisGuide.visible = false;
	axisGuide.renderOrder = 15;
	scene.add(axisGuide);
	const impactLights = Array.from({ length: 3 }, () => {
		const light = new THREE.PointLight('#5ee8ff', 0, 4, 2);
		scene.add(light);
		return light;
	});
	const titleScene = new THREE.Scene();
	const titleCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
	titleCamera.position.z = 1;
	const titleSprites = new Map<string, THREE.Sprite>();
	const objectGroups = new Map<string, THREE.Group>();
	const objectGeometrySignatures = new Map<string, string>();
	const markerSignatures = new Map<string, string>();
	let marbleSignature = '';
	let titleSignature = '';
	let sceneStyleSignature = '';
	const trajectoryLines = new Map<string, THREE.Line>();
	const resolvedObjects = new Map<string, TResolvedObject>();
	const notesById = new Map<string, TNote>();
	const impactsByObject = new Map<string, { time: number; strength: number }[]>();
	const surfaceContactsByObject = new Map<string, TSurfaceContact[]>();
	const markerGroups = new Map<string, THREE.Group>();
	const markerTimesById = new Map<string, number>();
	const selection = new THREE.Box3Helper(new THREE.Box3(), '#f19b42');
	selection.visible = false;
	const selectionMaterials = Array.isArray(selection.material)
		? selection.material
		: [selection.material];
	for (const material of selectionMaterials) {
		material.transparent = true;
		material.opacity = 0.7;
		material.depthTest = false;
	}
	selection.renderOrder = 20;
	scene.add(selection);

	const raycaster = new THREE.Raycaster();
	const pointer = new THREE.Vector2();
	const target = new THREE.Vector3();
	const filmTarget = new THREE.Vector3();
	const markerOffset = new THREE.Vector3();
	const cameraForward = new THREE.Vector3();
	const marblePosition = new THREE.Vector3();

	const sampledRotation = new THREE.Quaternion();
	let pointerStart = { x: 0, y: 0 };
	let selectedOrbitDrag: {
		pointerId: number;
		x: number;
		y: number;
		position: TVec3;
		target: TVec3;
		pivot: TVec3;
	} | null = null;
	let lastView: TMarbleSceneProps['view'] | null = null;
	let lastSelection: string | null = null;
	let lastShading = '';
	let pendingOrbitFrame = false;
	let sceneProjectId: string | null = null;
	let savedOrbitPose: { position: THREE.Vector3; target: THREE.Vector3; fov: number } | null = null;
	let transformCancelled = false;
	let transformSnapshot: {
		position: THREE.Vector3;
		rotation: THREE.Euler;
		scale: THREE.Vector3;
	} | null = null;
	let linkSource: string | null = null;
	let hoveredNoteId: string | null = null;
	let suppressPointerUp = false;
	let modalTransform: {
		object: THREE.Group;
		id: string;
		mode: 'move' | 'rotate' | 'scale';
		axis: 'x' | 'y' | 'z' | null;
		numeric: string;
		position: THREE.Vector3;
		rotation: THREE.Euler;
		scale: THREE.Vector3;
		pointer: THREE.Vector2;
		plane: THREE.Plane;
		hit: THREE.Vector3;
	} | null = null;
	let exporting = false;
	let exportViewSnapshot: {
		position: THREE.Vector3;
		quaternion: THREE.Quaternion;
		target: THREE.Vector3;
		fov: number;
		view: TMarbleSceneProps['view'] | null;
	} | null = null;
	let disposed = false;
	let animationFrame = 0;
	let needsRender = true;
	let lastRenderedTime = Number.NaN;
	let lastRenderSettings = '';

	let gate = { x: 0, y: 0, width: 1, height: 1 };
	let gateStyle = '';
	let cameraContext = false;
	let outputCameraFov = camera.fov;
	const rendererSize = new THREE.Vector2();

	function invalidate() {
		needsRender = true;
	}
	orbit.addEventListener('change', invalidate);
	transform.addEventListener('change', invalidate);

	function resize() {
		if (exporting) return;
		const width = Math.max(1, host.clientWidth);
		const height = Math.max(1, host.clientHeight);
		const ratio = Math.min(window.devicePixelRatio, 1.75);
		if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
		renderer.getSize(rendererSize);
		if (rendererSize.x !== width || rendererSize.y !== height)
			renderer.setSize(width, height, false);
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
		needsRender = true;
	}
	const observer = new ResizeObserver(() => {
		if (exporting) return;
		resize();
		// Resizing clears the drawing buffer. Redraw before the browser paints it.
		needsRender = false;
		renderAt(getProps().timeRef.current);
	});
	observer.observe(host);
	resize();

	function rebuild() {
		const props = getProps();
		if (sceneProjectId !== props.project.id) {
			sceneProjectId = props.project.id;
			savedOrbitPose = null;
			lastView = null;
			pendingOrbitFrame = false;
		}

		const nextSceneStyle = JSON.stringify(props.project.scene);
		if (nextSceneStyle !== sceneStyleSignature) {
			sceneStyleSignature = nextSceneStyle;
			lastShading = '';
		}
		resolvedObjects.clear();
		notesById.clear();
		for (const note of props.project.notes) notesById.set(note.id, note);
		impactsByObject.clear();
		surfaceContactsByObject.clear();

		const resolved = getVisualObjects(props.project.objects, props.performance);
		const style = props.project.scene;
		const wallStudio = style?.theme === 'wall';
		wall.position.z = getWallPosition(style, props.project.launch.position[2], resolved);
		const background = style?.background ?? '#bbc2b7';
		scene.background = new THREE.Color(background);
		wallMaterial.color.set(background).multiplyScalar(wallStudio ? 0.85 : 1);
		keyLight.color.set(style?.keyColor ?? '#fff8ed');
		rimLight.color.set(style?.fillColor ?? '#edf2ff');
		warmFill.color.set(style?.fillColor ?? '#ffe0bd');
		keyLight.intensity = wallStudio ? 2.5 : 2.1;
		rimLight.intensity = wallStudio ? 0.75 : 0.8;
		ambient.intensity = wallStudio ? 0.6 : 1.3;
		ambient.groundColor.set(wallStudio ? '#596e9c' : '#778675');
		scene.environmentIntensity = wallStudio ? 0.7 : 0.55;
		renderer.toneMappingExposure = style?.exposure ?? 0.95;
		for (const impact of props.performance?.impacts ?? []) {
			const list = impactsByObject.get(impact.objectId) ?? [];
			list.push(impact);
			impactsByObject.set(impact.objectId, list);
		}

		for (const contact of props.performance?.surfaceContacts ?? []) {
			const list = surfaceContactsByObject.get(contact.objectId) ?? [];
			list.push(contact);
			surfaceContactsByObject.set(contact.objectId, list);
		}

		const nextTitleSignature = JSON.stringify(props.project.titles);
		if (nextTitleSignature !== titleSignature) {
			titleSignature = nextTitleSignature;
			clearGroup(titleScene, resources.shared, resources.glowTexture);
			titleSprites.clear();
			for (const title of props.project.titles ?? []) {
				const sprite = makeTitle(title.text);
				titleScene.add(sprite);
				titleSprites.set(title.id, sprite);
			}
		}
		for (const object of resolved) if (!object.disabled) resolvedObjects.set(object.id, object);
		const preservePose = new Set<string>();
		if (modalTransform) preservePose.add(modalTransform.id);
		if (transform.dragging && props.selectedObjectId) preservePose.add(props.selectedObjectId);
		reconcileSceneObjects(
			objects,
			objectGroups,
			objectGeometrySignatures,
			resolved,
			wall.position.z,
			(object) => makeInstrument(object, resources, wall.position.z, wallStudio),
			(group) => clearGroup(group, resources.shared, resources.glowTexture),
			preservePose
		);
		const definitions = getProjectMarbles(props.project);
		const nextMarbleSignature = JSON.stringify(definitions);
		if (nextMarbleSignature !== marbleSignature) {
			marbleSignature = nextMarbleSignature;
			clearGroup(marble, resources.shared, resources.glowTexture);
			for (const group of additionalMarbleGroups.values()) {
				scene.remove(group);
				clearGroup(group, resources.shared, resources.glowTexture);
			}
			additionalMarbleGroups.clear();
			for (const definition of definitions) {
				const group = makeMarble(definition.launch.radius, definition.color, definition.style, {
					marbleEffect: definition.effect,
					marbleEffectSpeed: definition.effectSpeed
				});
				group.userData['marbleId'] = definition.id;
				if (definition.id === 'main') marble.add(group);
				else {
					scene.add(group);
					additionalMarbleGroups.set(definition.id, group);
				}
			}
			lastShading = '';
		}

		const activePaths = new Set<string>();
		for (const definition of definitions) {
			const samples =
				definition.id === 'main'
					? props.performance?.samples
					: props.performance?.additionalMarbles?.find((item) => item.id === definition.id)
							?.samples;
			if (!samples) continue;
			activePaths.add(definition.id);
			const previous = trajectoryLines.get(definition.id);
			const line = updateTrajectoryLine(
				previous,
				samples,
				props.project.duration,
				definition.id === 'main' ? '#6dc9ed' : definition.color
			);
			if (line !== previous) {
				if (previous) guides.remove(previous);
				guides.add(line);
				trajectoryLines.set(definition.id, line);
			}
		}
		for (const [id, line] of trajectoryLines)
			if (!activePaths.has(id)) {
				guides.remove(line);
				line.geometry.dispose();
				(line.material as THREE.Material).dispose();
				trajectoryLines.delete(id);
			}

		const liveMarkers = new Set<string>();
		markerTimesById.clear();
		for (const marker of props.performance?.noteMarkers ?? []) {
			liveMarkers.add(marker.noteId);
			markerTimesById.set(marker.noteId, marker.time);
			const note = notesById.get(marker.noteId);
			const signature = JSON.stringify([note?.midi, note?.time, marker.objectId]);
			let group = markerGroups.get(marker.noteId);
			if (!group || markerSignatures.get(marker.noteId) !== signature) {
				if (group) {
					guides.remove(group);
					clearGroup(group, resources.shared, resources.glowTexture);
				}
				group = makeNoteMarker(marker.noteId, note, marker.objectId != null);
				markerGroups.set(marker.noteId, group);
				markerSignatures.set(marker.noteId, signature);
				guides.add(group);
			}
			group.position.fromArray(marker.position);
			group.position.z += props.project.launch.radius * 0.8;
		}
		for (const [id, group] of markerGroups)
			if (!liveMarkers.has(id)) {
				guides.remove(group);
				clearGroup(group, resources.shared, resources.glowTexture);
				markerGroups.delete(id);
				markerSignatures.delete(id);
			}

		lastShading = '';
		renderAt(props.timeRef.current);
	}

	function renderAt(time: number) {
		if (disposed) return;
		const props = getProps();
		const style = getSceneStyle();
		lastRenderedTime = time;
		lastRenderSettings = renderSettings(props);
		const performance = props.performance;
		samplePosition(
			performance,
			time,
			props.project.launch.position,
			marblePosition,
			sampledRotation
		);
		marble.position.copy(marblePosition);
		marble.quaternion.copy(sampledRotation);
		updateMarbleAppearance(marble, time);
		for (const definition of getProjectMarbles(props.project)) {
			if (definition.id === 'main') continue;
			const group = additionalMarbleGroups.get(definition.id);
			if (!group) continue;
			group.visible =
				time >= (definition.startTime ?? 0) &&
				(props.keepSceneVisible ||
					props.simulationProgress == null ||
					time <= props.simulationProgress.simulatedUntil);
			const track = performance?.additionalMarbles?.find((item) => item.id === definition.id);
			samplePosition(
				track ?? null,
				time,
				definition.launch.position,
				group.position,
				group.quaternion
			);
			updateMarbleAppearance(group, time);
		}
		const progress = props.simulationProgress;
		const confirmedTime = props.keepSceneVisible ? undefined : progress?.simulatedUntil;
		marble.visible = confirmedTime == null || time <= confirmedTime;
		for (const line of trajectoryLines.values()) {
			const total = line.userData['sampleCount'] as number;
			const until =
				confirmedTime == null
					? total
					: Math.floor(confirmedTime / Math.max(1e-6, (performance?.dt ?? 1 / 240) * 4)) + 1;
			line.geometry.setDrawRange(0, Math.min(total, until));
		}
		forecastGhost.visible =
			!props.keepSceneVisible &&
			progress != null &&
			progress.ratio < 1 &&
			performance != null &&
			performance.samples.length > 1 &&
			!exporting;
		if (forecastGhost.visible && performance) {
			samplePosition(
				performance,
				Math.min(
					progress?.simulatedUntil ?? 0,
					performance.samples[performance.samples.length - 1]?.time ?? 0
				),
				props.project.launch.position,
				forecastGhost.position
			);
			forecastGhost.scale.setScalar(props.project.launch.radius / 0.24);
		}
		const activeView = exporting ? 'camera' : props.view;
		updateGate(activeView);
		const [aspectWidth = 9, aspectHeight = 16] = props.project.aspectRatio.split(':').map(Number);
		const filmAspect = aspectWidth / aspectHeight;
		const filmPose = evaluateCamera(
			props.project,
			performance,
			time,
			filmAspect,
			props.cameraDistance
		);
		filmTarget.fromArray(filmPose.target);
		keyLight.target.position.copy(filmTarget);
		rimLight.position.set(filmTarget.x + 8, filmTarget.y + 1, filmTarget.z + 6);
		warmFill.position.set(filmTarget.x + 4, filmTarget.y - 0.5, filmTarget.z + 2);
		updateShading(exporting ? 'rendered' : (props.shading ?? 'rendered'));
		updateLighting(time);
		const cameraDrag = movingHelper('camera');
		editHelpers.update({
			cameraPose:
				cameraDrag == null
					? filmPose
					: { ...filmPose, position: cameraDrag.position.toArray() as TVec3 },
			aspect: filmAspect,
			lightingPosition: keyLight.position.toArray() as TVec3,
			lightingTarget: filmPose.target,
			selectedEntity: props.selectedEntity ?? null,
			darkBackground: lastShading === 'solid',
			visible: activeView === 'orbit' && props.showSceneHelpers !== false && !exporting
		});
		if (activeView === 'camera') {
			const holdCamera =
				!exporting && progress != null && time > progress.simulatedUntil && lastView != null;
			if (!holdCamera) {
				const pose = filmPose;
				camera.position.fromArray(pose.position);
				target.fromArray(pose.target);
				outputCameraFov = pose.fov;
				camera.fov = cameraContext
					? cameraContextFov(outputCameraFov, rendererSize.y, gate.height)
					: outputCameraFov;
				camera.updateProjectionMatrix();
				camera.lookAt(target);
			}
			orbit.enabled = false;
		} else {
			if (lastView === 'camera') {
				camera.fov = outputCameraFov;
				camera.updateProjectionMatrix();
			}
			if (lastView !== 'orbit' && !pendingOrbitFrame) {
				if (savedOrbitPose == null) {
					frameAll();
				} else {
					camera.position.copy(savedOrbitPose.position);
					orbit.target.copy(savedOrbitPose.target);
					camera.fov = savedOrbitPose.fov;
					camera.updateProjectionMatrix();
				}
			}
			pendingOrbitFrame = false;
			orbit.enabled = !transform.dragging && modalTransform == null && selectedOrbitDrag == null;
			orbit.mouseButtons.LEFT = props.tool === 'hand' ? THREE.MOUSE.PAN : null;
			orbit.update();
			target.copy(orbit.target);
			savedOrbitPose = {
				position: camera.position.clone(),
				target: orbit.target.clone(),
				fov: camera.fov
			};
		}
		lastView = activeView;
		// Keep the uniform wall behind the view even during long, unbuilt falls.
		wall.position.x = target.x;
		wall.position.y = target.y;
		grid.visible = (props.showGrid ?? false) && !exporting;
		wallGradient.value =
			lastShading === 'solid' ? 0 : props.project.scene?.theme === 'wall' ? 1 : 0;
		wallAspect.value = activeView === 'camera' ? gate.width / gate.height : camera.aspect;
		wallTanHalfFov.value = Math.tan(
			THREE.MathUtils.degToRad((activeView === 'camera' ? outputCameraFov : camera.fov) / 2)
		);
		guides.visible =
			(props.showTrajectory ||
				props.simulationProgress != null ||
				props.tool === 'link' ||
				(modalTransform?.mode === 'move' &&
					resolvedObjects.get(modalTransform.id)?.binding == null) ||
				(transform.dragging &&
					resolvedObjects.get(props.selectedObjectId ?? '')?.binding == null)) &&
			!exporting;
		const placedObjectIds =
			!props.keepSceneVisible && progress?.phase === 'placement'
				? new Set(performance?.objects.map((object) => object.id))
				: null;
		const activeImpacts: { energy: number; group: THREE.Group; object: TResolvedObject }[] = [];
		for (const [id, group] of objectGroups) {
			const object = resolvedObjects.get(id);
			if (object == null) continue;
			const noteTime =
				notesById.get(object.binding?.noteId ?? '')?.time ?? object.trajectoryAnchor?.time;
			group.visible =
				confirmedTime == null ||
				(object.binding == null && object.trajectoryAnchor == null) ||
				id === props.selectedObjectId ||
				(placedObjectIds != null
					? placedObjectIds.has(id)
					: noteTime != null && noteTime <= confirmedTime);
			const energy = updateInstrumentReaction(
				group,
				object,
				time,
				impactsByObject.get(id) ?? [],
				style?.bloom ?? 1,
				surfaceContactsByObject.get(id) ?? []
			);
			if (energy > 0.01 && (object.emission ?? 0) > 0)
				activeImpacts.push({ energy, group, object });
		}
		activeImpacts.sort((a, b) => b.energy - a.energy);
		for (const [index, light] of impactLights.entries()) {
			const impact = activeImpacts[index];
			light.intensity =
				impact == null || lastShading === 'solid'
					? 0
					: impact.energy * (impact.object.emission ?? 1) * 3 * (style?.bloom ?? 1);
			if (impact != null) {
				light.color.set((impact.group.userData['glowColor'] as string | undefined) ?? '#50d6ff');
				light.position.copy(impact.group.position);
				light.position.y += 0.35;
			}
		}

		cameraForward.copy(target).sub(camera.position).normalize();
		const pixelAngle =
			(2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) /
			Math.max(1, cameraContext ? rendererSize.y : gate.height);
		for (const [id, marker] of markerGroups) {
			if (!guides.visible) break;
			const selected = id === props.selectedNoteId;
			const markerTime = markerTimesById.get(id);
			marker.visible = confirmedTime == null || (markerTime != null && markerTime <= confirmedTime);
			const depth = Math.max(
				0.05,
				markerOffset.copy(marker.position).sub(camera.position).dot(cameraForward)
			);
			const worldPerPixel = depth * pixelAngle;
			const markerScale = worldPerPixel * 50 * (selected ? 1.45 : 1);
			marker.scale.setScalar(markerScale);
			const label = marker.getObjectByName('note-label');
			if (label) {
				label.visible = selected;
				label.scale.set(
					(132 * worldPerPixel) / markerScale,
					(41.25 * worldPerPixel) / markerScale,
					1
				);
				label.position.y = (32 * worldPerPixel) / markerScale;
			}
		}

		const selectedObject =
			props.selectedObjectId == null ? null : objectGroups.get(props.selectedObjectId);
		const helperSelection = editableHelper();
		const transformObject = selectedObject ?? helperSelection?.group;
		const selectedMarbleId = props.selectedMarbleId ?? (props.selectedMarble ? 'main' : null);
		const selectedMarbleGroup =
			selectedMarbleId === 'main' ? marble : additionalMarbleGroups.get(selectedMarbleId ?? '');
		selection.visible =
			(selectedObject != null || selectedMarbleGroup?.visible === true) && !exporting;
		if (selectedMarbleGroup)
			selection.box.copy(getPhysicalBounds(selectedMarbleGroup).expandByScalar(0.04));
		if (selectedObject != null) {
			selection.box.copy(
				getPhysicalBounds(selectedObject.getObjectByName('flex') ?? selectedObject)
			);
			selection.box.expandByScalar(0.08);
		}
		const canTransform =
			['move', 'rotate', 'scale'].includes(props.tool ?? 'select') &&
			transformObject != null &&
			(selectedObject != null || props.tool === 'move') &&
			modalTransform == null &&
			!resolvedObjects.get(props.selectedObjectId ?? '')?.locked &&
			!exporting;
		transform.setMode(
			props.tool === 'rotate' ? 'rotate' : props.tool === 'scale' ? 'scale' : 'translate'
		);
		transform.enabled = canTransform;
		transformHelper.visible = canTransform;
		if (
			canTransform &&
			(lastSelection !== props.selectedObjectId || transform.object !== transformObject)
		) {
			transform.attach(transformObject);
		} else if (!canTransform && transform.object != null) {
			transform.detach();
		}
		lastSelection = props.selectedObjectId;
		axisGuide.visible = modalTransform?.axis != null && !exporting;
		if (modalTransform != null && modalTransform.axis != null) {
			const axis = modalTransform.axis;
			axisGuide.position.copy(modalTransform.object.position);
			axisGuide.rotation.set(0, 0, axis === 'y' ? Math.PI / 2 : 0);
			if (axis === 'z') axisGuide.rotation.y = -Math.PI / 2;
			(axisGuide.material as THREE.LineBasicMaterial).color.set(
				axis === 'x' ? '#ed7777' : axis === 'y' ? '#8fcd73' : '#72a7ec'
			);
		}
		renderer.setScissorTest(false);
		renderer.setViewport(0, 0, rendererSize.x, rendererSize.y);
		renderer.setClearColor('#282b30');
		renderer.clear();
		const worldView = cameraContext
			? { x: 0, y: 0, width: rendererSize.x, height: rendererSize.y }
			: gate;
		renderer.setViewport(worldView.x, worldView.y, worldView.width, worldView.height);
		renderer.setScissor(worldView.x, worldView.y, worldView.width, worldView.height);
		renderer.setScissorTest(true);
		renderer.render(scene, camera);
		renderer.setViewport(gate.x, gate.y, gate.width, gate.height);
		renderer.setScissor(gate.x, gate.y, gate.width, gate.height);
		for (const title of props.project.titles ?? []) {
			const sprite = titleSprites.get(title.id);
			if (sprite == null) continue;
			const elapsed = time - title.time;
			sprite.visible = elapsed >= 0 && elapsed < title.duration && activeView === 'camera';
			(sprite.material as THREE.SpriteMaterial).opacity = Math.min(
				1,
				elapsed / 0.15,
				(title.duration - elapsed) / 0.2
			);
			sprite.scale.set(1.75, (0.22 * gate.width) / gate.height, 1);
			sprite.position.set(0, 0.52, 0);
		}
		renderer.clearDepth();
		renderer.render(titleScene, titleCamera);
		renderer.setScissorTest(false);
	}

	function updateGate(view: TMarbleSceneProps['view']) {
		renderer.getSize(rendererSize);
		const props = getProps();
		const [numerator, denominator] = props.project.aspectRatio.split(':').map(Number);
		const aspect = (numerator ?? 9) / (denominator ?? 16);
		gate =
			!exporting && view === 'camera'
				? fitCameraGate(rendererSize.x, rendererSize.y, aspect)
				: { x: 0, y: 0, width: rendererSize.x, height: rendererSize.y };
		cameraContext = !exporting && view === 'camera' && (props.cameraContext ?? false);
		camera.aspect = cameraContext ? rendererSize.x / rendererSize.y : gate.width / gate.height;
		if (view === 'camera')
			camera.fov = cameraContext
				? cameraContextFov(outputCameraFov, rendererSize.y, gate.height)
				: outputCameraFov;
		camera.updateProjectionMatrix();
		const style = `${gate.x}:${gate.y}:${gate.width}:${gate.height}:${rendererSize.x}:${rendererSize.y}:${view}:${exporting}:${cameraContext}`;
		if (style === gateStyle) return;
		gateStyle = style;
		const interaction = cameraContext
			? { x: 0, y: 0, width: rendererSize.x, height: rendererSize.y }
			: gate;
		interactionSurface.style.left = `${interaction.x}px`;
		interactionSurface.style.top = `${interaction.y}px`;
		interactionSurface.style.width = `${interaction.width}px`;
		interactionSurface.style.height = `${interaction.height}px`;
		interactionSurface.style.boxShadow =
			view === 'camera' && !exporting && !cameraContext
				? '0 0 0 1px rgba(65,72,61,.13), 0 6px 30px rgba(65,72,61,.06)'
				: 'none';
		interactionSurface.style.display = exporting ? 'none' : 'block';
		cameraOverlay.style.display = cameraContext ? 'block' : 'none';
		if (cameraContext) {
			const masks = cameraPassepartout(rendererSize.x, rendererSize.y, gate);
			for (const [index, mask] of cameraMasks.entries()) {
				const rect = masks[index];
				if (rect)
					Object.assign(mask.style, {
						left: `${rect.x}px`,
						top: `${rect.y}px`,
						width: `${rect.width}px`,
						height: `${rect.height}px`
					});
			}
			Object.assign(cameraFrame.style, {
				left: `${gate.x}px`,
				top: `${gate.y}px`,
				width: `${gate.width}px`,
				height: `${gate.height}px`
			});
		}
	}

	function animate() {
		animationFrame = window.requestAnimationFrame(animate);
		const props = getProps();
		const changed =
			needsRender ||
			props.timeRef.current !== lastRenderedTime ||
			renderSettings(props) !== lastRenderSettings;
		if (!exporting && changed) {
			needsRender = false;
			renderAt(props.timeRef.current);
		}
	}
	animate();

	function updatePointer(event: PointerEvent) {
		const bounds = interactionSurface.getBoundingClientRect();
		pointer.set(
			((event.clientX - bounds.left) / bounds.width) * 2 - 1,
			-((event.clientY - bounds.top) / bounds.height) * 2 + 1
		);
	}
	function pointerMove(event: PointerEvent) {
		if (selectedOrbitDrag) {
			const drag = selectedOrbitDrag;
			const factor = (Math.PI * 2) / Math.max(300, gate.height);
			const pose = orbitAroundPivot(
				drag.position,
				drag.target,
				drag.pivot,
				(drag.x - event.clientX) * factor,
				(drag.y - event.clientY) * factor
			);
			camera.position.fromArray(pose.position);
			orbit.target.fromArray(pose.target);
			camera.lookAt(orbit.target);
			orbit.update();
			invalidate();
			return;
		}
		updatePointer(event);
		if (modalTransform != null) {
			applyModalTransform();
			return;
		}
		const props = getProps();
		let hovered: string | null = null;
		if (props.tool === 'link' && guides.visible) {
			raycaster.setFromCamera(pointer, camera);
			for (const hit of raycaster.intersectObjects([...markerGroups.values()], true)) {
				if (!isScenePickVisible(hit.object)) continue;
				let node: THREE.Object3D | null = hit.object;
				while (node != null) {
					const id = node.userData['noteId'] as string | undefined;
					if (id != null) {
						hovered = id;
						break;
					}
					node = node.parent;
				}
				if (hovered != null) break;
			}
		} else if (
			transform.dragging &&
			transform.object != null &&
			resolvedObjects.get(props.selectedObjectId ?? '')?.binding == null
		) {
			const object = transform.object;
			hovered =
				props.performance?.noteMarkers.find(
					(marker) =>
						markerGroups.get(marker.noteId)?.visible !== false &&
						object.position.distanceTo(new THREE.Vector3(...marker.position)) < 0.55
				)?.noteId ?? null;
		}
		if (hovered !== hoveredNoteId) {
			hoveredNoteId = hovered;
			invalidate();
		}
		if (props.tool === 'link')
			interactionSurface.style.cursor = hovered == null ? 'crosshair' : 'pointer';
		else if (props.tool === 'hand') interactionSurface.style.cursor = 'grab';
	}
	function pointerDown(event: PointerEvent) {
		if (modalTransform != null) {
			event.preventDefault();
			event.stopImmediatePropagation();
			suppressPointerUp = true;
			if (event.button === 2) cancelTransform();
			else if (event.button === 0) commitModalTransform();
			return;
		}
		pointerStart = { x: event.clientX, y: event.clientY };
		const props = getProps();
		if (
			(event.button === 1 || event.button === 2) &&
			props.view === 'camera' &&
			props.onRequestOrbit
		) {
			props.onRequestOrbit();
			orbit.target.copy(target);
			orbit.enabled = true;
			pendingOrbitFrame = true;
		}
		if (event.button !== 1 || event.shiftKey || props.orbitAroundSelection === false) return;
		const group = props.selectedObjectId ? objectGroups.get(props.selectedObjectId) : null;
		const marbleId = props.selectedMarbleId ?? (props.selectedMarble ? 'main' : null);
		const selectedBall = marbleId === 'main' ? marble : additionalMarbleGroups.get(marbleId ?? '');
		const helper = props.selectedEntity == null ? null : editHelpers[props.selectedEntity];
		const pivot = selectedBall
			? selectedBall.position.clone()
			: group
				? getPhysicalBounds(group.getObjectByName('flex') ?? group).getCenter(new THREE.Vector3())
				: (helper?.position.clone() ?? null);
		if (!pivot) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		selectedOrbitDrag = {
			pointerId: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			position: camera.position.toArray() as TVec3,
			target: orbit.target.toArray() as TVec3,
			pivot: pivot.toArray() as TVec3
		};
		orbit.enabled = false;
		interactionSurface.setPointerCapture(event.pointerId);
		interactionSurface.style.cursor = 'grabbing';
	}

	function pointerCancel(event: PointerEvent) {
		if (selectedOrbitDrag?.pointerId === event.pointerId) pointerUp(event);
	}

	function pointerUp(event: PointerEvent) {
		if (selectedOrbitDrag) {
			const id = selectedOrbitDrag.pointerId;
			selectedOrbitDrag = null;
			if (interactionSurface.hasPointerCapture(id)) interactionSurface.releasePointerCapture(id);
			orbit.enabled = getProps().view === 'orbit';
			interactionSurface.style.cursor = 'default';
			invalidate();
			return;
		}
		if (suppressPointerUp) {
			suppressPointerUp = false;
			return;
		}
		if (event.button !== 0) return;
		if (
			Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5 ||
			transform.axis != null
		)
			return;
		const bounds = interactionSurface.getBoundingClientRect();
		pointer.set(
			((event.clientX - bounds.left) / bounds.width) * 2 - 1,
			(-(event.clientY - bounds.top) / bounds.height) * 2 + 1
		);
		raycaster.setFromCamera(pointer, camera);

		const props = getProps();
		const noteHits =
			props.tool === 'link' && guides.visible
				? raycaster.intersectObjects([guides], true).filter((hit) => isScenePickVisible(hit.object))
				: [];
		const intersections =
			noteHits.length > 0
				? noteHits
				: raycaster.intersectObjects(
						[
							marble,
							...additionalMarbleGroups.values(),
							objects,
							...(guides.visible ? [guides] : [])
						],
						true
					);
		if (!noteHits.length && editHelpers.group.visible && props.tool !== 'link') {
			raycaster.params.Line.threshold = 0.12;
			intersections.push(...raycaster.intersectObjects(editHelpers.pickables, true));
			intersections.sort((a, b) => a.distance - b.distance);
		}

		for (const intersection of intersections) {
			if (!isScenePickVisible(intersection.object)) continue;
			const helperEntity = editHelpers.getPickEntity(intersection.object);
			if (helperEntity != null && props.onSelectEntity != null) {
				props.onSelectEntity(helperEntity);
				return;
			}
			let current: THREE.Object3D | null = intersection.object;
			while (current != null) {
				if (current.userData['entity'] === 'marble') {
					getProps().onSelectMarble?.(
						(current.userData['marbleId'] as string | undefined) ?? 'main'
					);
					return;
				}
				const noteId = current.userData['noteId'] as string | undefined;
				const objectId = current.userData['objectId'] as string | undefined;
				if (noteId != null) {
					const props = getProps();
					if (props.tool === 'link' && (linkSource ?? props.selectedObjectId) != null) {
						props.onLinkObject?.((linkSource ?? props.selectedObjectId) as string, noteId);
						linkSource = null;
						return;
					}
					props.onSelectNote(noteId);
					return;
				}
				if (objectId != null) {
					if (getProps().tool === 'link') linkSource = objectId;
					getProps().onSelectObject(objectId);
					return;
				}
				current = current.parent;
			}
		}
		getProps().onSelectObject(null);
	}
	function transformBegin() {
		const object = transform.object;
		if (object == null) return;
		getProps().onBeginTransform?.();
		transformCancelled = false;
		transformSnapshot = {
			position: object.position.clone(),
			rotation: object.rotation.clone(),
			scale: object.scale.clone()
		};
	}
	function editableHelper() {
		const props = getProps();
		const entity = props.selectedEntity;
		if (
			exporting ||
			props.view !== 'orbit' ||
			props.showSceneHelpers === false ||
			entity == null ||
			props.onMoveEntity == null
		)
			return null;
		if (
			entity === 'camera'
				? props.project.camera?.keyframes.length
				: props.project.scene?.keyframes?.length
		)
			return null;
		return { entity, id: `entity:${entity}`, group: editHelpers[entity] };
	}
	function movingHelper(entity: 'camera' | 'lighting'): THREE.Object3D | null {
		if (modalTransform?.id === `entity:${entity}`) return modalTransform.object;
		return transform.dragging && transform.object === editHelpers[entity] ? transform.object : null;
	}
	function cancelTransform() {
		if (modalTransform != null) {
			const active = modalTransform;
			active.object.position.copy(active.position);
			active.object.rotation.copy(active.rotation);
			active.object.scale.copy(active.scale);
			modalTransform = null;
			transformStatus.style.display = 'none';
			hoveredNoteId = null;
			interactionSurface.style.cursor = 'default';
			orbit.enabled = getProps().view === 'orbit';
			invalidate();
			return;
		}
		const object = transform.object;
		if (object != null && transformSnapshot != null) {
			object.position.copy(transformSnapshot.position);
			object.rotation.copy(transformSnapshot.rotation);
			object.scale.copy(transformSnapshot.scale);
		}
		transformCancelled = true;
		transform.showX = true;
		transform.showY = true;
		transform.showZ = true;
		transform.reset();
		invalidate();
	}
	function commitObjectTransform(object: THREE.Object3D, mode: 'translate' | 'rotate' | 'scale') {
		const helperEntity = editHelpers.getPickEntity(object);
		if (helperEntity != null && mode === 'translate') {
			getProps().onMoveEntity?.(
				helperEntity,
				object.position.toArray() as TVec3,
				filmTarget.toArray() as TVec3
			);
			transformSnapshot = null;
			transform.showX = true;
			transform.showY = true;
			transform.showZ = true;
			return;
		}
		const id = object.userData['objectId'] as string | undefined;
		if (id == null) return;
		const props = getProps();
		const source = resolvedObjects.get(id);
		if (source == null) return;
		const patch = boundTransform(
			source,
			object.position.toArray() as TVec3,
			[object.rotation.x, object.rotation.y, object.rotation.z],
			object.scale.toArray() as TVec3
		);
		if (mode === 'translate') {
			object.position.fromArray(patch.position);
			if (props.onTransformObject != null) props.onTransformObject(id, patch.position);
			else props.onUpdateObject?.(id, { position: patch.position });
			if (source?.binding == null && props.onLinkObject != null) {
				const marker = props.performance?.noteMarkers.find(
					(marker) =>
						markerGroups.get(marker.noteId)?.visible !== false &&
						object.position.distanceTo(new THREE.Vector3(...marker.position)) < 0.38
				);
				if (marker != null) props.onLinkObject(id, marker.noteId);
			}
		} else if (mode === 'rotate') props.onUpdateObject?.(id, { rotation: patch.rotation });
		else
			props.onUpdateObject?.(id, {
				size: patch.size,
				...(patch.path == null ? {} : { path: patch.path })
			});
		transformSnapshot = null;
		transform.showX = true;
		transform.showY = true;
		transform.showZ = true;
	}
	function transformEnd() {
		const object = transform.object;
		if (object == null || transformCancelled) return;
		commitObjectTransform(object, transform.getMode());
	}
	function beginTransform(mode: 'move' | 'rotate' | 'scale'): boolean {
		if (exporting) return false;
		const props = getProps();
		const helper = mode === 'move' ? editableHelper() : null;
		const id = props.selectedObjectId ?? helper?.id;
		const object = objectGroups.get(id ?? '') ?? helper?.group;
		if (id == null || object == null || resolvedObjects.get(id)?.locked) return false;
		props.onBeginTransform?.();
		if (modalTransform != null) cancelTransform();
		const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
			camera.getWorldDirection(new THREE.Vector3()),
			object.position
		);
		raycaster.setFromCamera(pointer, camera);
		const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3()) ?? object.position.clone();
		modalTransform = {
			object,
			id,
			mode,
			axis: null,
			numeric: '',
			position: object.position.clone(),
			rotation: object.rotation.clone(),
			scale: object.scale.clone(),
			pointer: pointer.clone(),
			plane,
			hit
		};
		transform.detach();
		transformHelper.visible = false;
		orbit.enabled = false;
		interactionSurface.style.cursor = mode === 'move' ? 'move' : 'crosshair';
		updateTransformStatus();
		invalidate();
		return true;
	}
	function applyModalTransform() {
		const active = modalTransform;
		if (active == null) return;
		const numeric = Number.parseFloat(active.numeric);
		const hasNumeric = active.numeric.length > 0 && Number.isFinite(numeric);
		if (active.numeric.length > 1 && !Number.isFinite(numeric)) {
			updateTransformStatus();
			return;
		}
		const axis = new THREE.Vector3(
			active.axis === 'x' ? 1 : 0,
			active.axis === 'y' ? 1 : 0,
			active.axis === 'z' ? 1 : 0
		);
		if (active.mode === 'move') {
			let delta: THREE.Vector3;
			if (hasNumeric) {
				if (active.axis == null) axis.set(1, 0, 0);
				delta = axis.multiplyScalar(numeric);
			} else {
				raycaster.setFromCamera(pointer, camera);
				const hit = raycaster.ray.intersectPlane(active.plane, new THREE.Vector3());
				if (hit == null) return;
				delta = hit.sub(active.hit);
				if (active.axis != null)
					delta
						.copy(axis)
						.multiplyScalar(
							axisDragDistance(camera, active.position, axis, active.pointer, pointer)
						);
			}
			active.object.position.copy(active.position).add(delta);
			for (const axis of ['x', 'y', 'z'] as const)
				active.object.position[axis] = THREE.MathUtils.clamp(
					active.object.position[axis],
					-1e6,
					1e6
				);
		} else if (active.mode === 'rotate') {
			if (active.axis == null) camera.getWorldDirection(axis);
			const angle = hasNumeric
				? THREE.MathUtils.degToRad(numeric)
				: (pointer.x - active.pointer.x) * Math.PI * 2 - (pointer.y - active.pointer.y) * Math.PI;
			active.object.quaternion
				.setFromEuler(active.rotation)
				.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
		} else {
			const factor = Math.max(
				0.02,
				hasNumeric
					? Math.abs(numeric)
					: Math.exp((pointer.x - active.pointer.x) * 2.4 - (pointer.y - active.pointer.y) * 2.4)
			);
			active.object.scale.copy(active.scale);
			if (active.axis == null) active.object.scale.multiplyScalar(factor);
			else active.object.scale[active.axis] *= factor;
			const source = resolvedObjects.get(active.id);
			if (source != null)
				for (const [index, axis] of (['x', 'y', 'z'] as const).entries()) {
					const extent = source.size[index] ?? 1;
					const pathExtent = Math.max(
						0,
						...(source.path ?? []).map((point) => Math.abs(point[index] ?? 0))
					);
					active.object.scale[axis] = THREE.MathUtils.clamp(
						active.object.scale[axis],
						0.02 / extent,
						Math.min(50 / extent, pathExtent > 0 ? 100 / pathExtent : Infinity)
					);
				}
		}
		updateTransformStatus();
		const props = getProps();
		hoveredNoteId =
			active.mode === 'move' &&
			resolvedObjects.has(active.id) &&
			resolvedObjects.get(active.id)?.binding == null
				? (props.performance?.noteMarkers.find(
						(marker) =>
							markerGroups.get(marker.noteId)?.visible !== false &&
							active.object.position.distanceTo(new THREE.Vector3(...marker.position)) < 0.55
					)?.noteId ?? null)
				: null;
		invalidate();
	}
	function updateTransformStatus() {
		const active = modalTransform;
		if (active == null) return;
		transformStatus.style.display = 'block';
		transformStatus.textContent = `${active.mode.toUpperCase()}${active.axis == null ? '' : ` · ${active.axis.toUpperCase()}`} ${active.numeric}${active.numeric === '' ? '' : active.mode === 'rotate' ? '°' : active.mode === 'move' ? ' m' : '×'}   ·   X/Y/Z constrain   ·   Enter confirm   ·   Esc cancel`;
	}
	function commitModalTransform() {
		const active = modalTransform;
		if (active == null) return;
		modalTransform = null;
		transformStatus.style.display = 'none';
		hoveredNoteId = null;
		commitObjectTransform(active.object, active.mode === 'move' ? 'translate' : active.mode);
		interactionSurface.style.cursor = 'default';
		orbit.enabled = getProps().view === 'orbit';
		invalidate();
	}

	function frameBox(box: THREE.Box3) {
		if (lastView === 'camera') {
			camera.fov = outputCameraFov;
			camera.updateProjectionMatrix();
		}
		if (box.isEmpty()) {
			box.setFromCenterAndSize(
				new THREE.Vector3(...getProps().project.launch.position),
				new THREE.Vector3(5, 5, 5)
			);
		}
		const center = box.getCenter(new THREE.Vector3());
		const size = box.getSize(new THREE.Vector3());
		const distance = Math.max(
			2,
			(Math.max(size.y, size.x / Math.max(camera.aspect, 0.2), size.z) * 0.65) /
				Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
		);
		orbit.target.copy(center);
		camera.position
			.copy(center)
			.add(new THREE.Vector3(0.28, 0.18, 1).normalize().multiplyScalar(distance));
		camera.lookAt(center);
		orbit.update();
		pendingOrbitFrame = true;
		invalidate();
	}
	function frameAll() {
		const props = getProps();
		const box = new THREE.Box3();
		for (const group of objectGroups.values())
			box.union(getPhysicalBounds(group.getObjectByName('flex') ?? group));
		box.expandByPoint(new THREE.Vector3(...props.project.launch.position));
		const current = new THREE.Vector3();
		samplePosition(
			props.performance,
			props.timeRef.current,
			props.project.launch.position,
			current
		);
		box.expandByPoint(current);
		if (props.showSceneHelpers !== false) {
			box.union(new THREE.Box3().setFromObject(editHelpers.camera));
			box.union(new THREE.Box3().setFromObject(editHelpers.lighting));
		}
		frameBox(box.expandByScalar(props.project.launch.radius + 0.4));
	}
	function frameSelected(id?: string) {
		const props = getProps();
		const entity =
			id === 'entity:camera'
				? 'camera'
				: id === 'entity:lighting'
					? 'lighting'
					: id == null
						? props.selectedEntity
						: null;
		if (entity != null) {
			frameBox(new THREE.Box3().setFromObject(editHelpers[entity]).expandByScalar(0.6));
			return;
		}
		const explicitMarbleId = id?.startsWith('marble:') ? id.slice(7) : null;
		const marbleId =
			explicitMarbleId ?? props.selectedMarbleId ?? (props.selectedMarble ? 'main' : null);
		const selectedBall = marbleId === 'main' ? marble : additionalMarbleGroups.get(marbleId ?? '');
		if ((id == null || explicitMarbleId != null) && selectedBall) {
			frameBox(getPhysicalBounds(selectedBall).expandByScalar(0.5));
			return;
		}

		const group = objectGroups.get(id ?? getProps().selectedObjectId ?? '');
		if (group == null) {
			frameAll();
			return;
		}
		const flex = group.getObjectByName('flex') ?? group;
		frameBox(getPhysicalBounds(flex).expandByScalar(0.4));
	}
	function updateLighting(time: number) {
		const style = getSceneStyle();
		const lighting = evaluateLighting(style, time);
		const lightDrag = movingHelper('lighting');
		if (lightDrag != null) keyLight.position.copy(lightDrag.position);
		else keyLight.position.fromArray(lighting.keyPosition).add(keyLight.target.position);
		warmFill.intensity = lastShading === 'rendered' ? lighting.fillIntensity * 40 : 0;
		if (lastShading === 'solid') return;
		if (lastShading === 'rendered') {
			keyLight.intensity = lighting.keyIntensity;
			scene.environmentIntensity = lighting.environmentIntensity;
		}
		const wallStudio = style?.theme === 'wall';
		(scene.background as THREE.Color).set(lighting.background);
		wallMaterial.color.set(lighting.background).multiplyScalar(wallStudio ? 0.85 : 1);
		renderer.toneMappingExposure = lighting.exposure;
		keyLight.color.set(lastShading === 'material' ? '#fff6e8' : lighting.keyColor);
		rimLight.color.set(lighting.fillColor);
		warmFill.color.set(style == null ? '#ffe0bd' : lighting.fillColor);
		if (style?.keyframes?.some((key) => key.time <= time)) {
			wallTintLeft.value.set(lighting.fillColor).lerp(new THREE.Color(1, 1, 1), 0.55);
			wallTintRight.value.set(lighting.keyColor).lerp(new THREE.Color(1, 1, 1), 0.55);
			ambient.color.set(lighting.keyColor).lerp(new THREE.Color(lighting.fillColor), 0.5);
			ambient.groundColor.set(lighting.fillColor).multiplyScalar(0.4);
		} else {
			wallTintLeft.value.setRGB(0.74, 0.82, 1);
			wallTintRight.value.setRGB(1.4, 1.15, 0.98);
			ambient.color.set(wallStudio ? '#79b7e2' : '#fffdf1');
			ambient.groundColor.set(wallStudio ? '#246890' : '#778675');
		}
	}
	function getSceneStyle() {
		const props = getProps();
		return (!exporting ? props.scenePreview : null) ?? props.project.scene;
	}
	function updateShading(mode: string) {
		if (mode === lastShading) return;
		lastShading = mode;
		const solid = mode === 'solid';
		const materialPreview = mode === 'material';
		const style = getProps().project.scene;
		renderer.toneMapping = getViewTransformToneMapping(style?.viewTransform);
		const wallStudio = style?.theme === 'wall';
		scene.background = new THREE.Color(solid ? '#35383e' : (style?.background ?? '#bbc2b7'));
		wall.visible = true;
		wallMaterial.color
			.set(solid ? '#50545b' : (style?.background ?? '#bbc2b7'))
			.multiplyScalar(!solid && wallStudio ? 0.85 : 1);
		wallGradient.value = solid ? 0 : wallStudio ? 1 : 0;
		scene.environment = solid ? null : environment.texture;
		scene.environmentIntensity = solid ? 0 : wallStudio ? 0.7 : 0.55;
		renderer.shadowMap.enabled = mode === 'rendered';
		renderer.shadowMap.type = wallStudio ? THREE.VSMShadowMap : THREE.PCFShadowMap;
		keyLight.shadow.radius = wallStudio ? 3 : 2;
		keyLight.shadow.blurSamples = 8;
		renderer.toneMappingExposure = solid ? 1 : (style?.exposure ?? 0.95);
		keyLight.color.set(
			solid ? '#ffffff' : materialPreview ? '#fff6e8' : (style?.keyColor ?? '#fff8ed')
		);
		keyLight.intensity = solid ? 2 : materialPreview ? 2.8 : wallStudio ? 6 : 2.1;
		rimLight.color.set(solid ? '#ffffff' : (style?.fillColor ?? '#edf2ff'));
		rimLight.intensity = solid ? 0.45 : wallStudio ? 0.75 : 0.8;
		ambient.color.set(solid ? '#e8e9ee' : wallStudio ? '#79b7e2' : '#fffdf1');
		ambient.groundColor.set(solid ? '#51545b' : wallStudio ? '#246890' : '#778675');
		ambient.intensity = solid ? 1.8 : wallStudio ? 1.5 : 1.3;
		for (const group of [objects, marble, ...additionalMarbleGroups.values()])
			group.traverse((child) => {
				if (!(child instanceof THREE.Mesh)) return;
				if (child.name === 'impact-glow') {
					child.visible = !solid;
					return;
				}
				if (solid) {
					if (child.userData['renderMaterial'] == null)
						child.userData['renderMaterial'] = child.material;
					child.material = solidMaterial;
				} else if (child.userData['renderMaterial'] != null) {
					child.material = child.userData['renderMaterial'] as THREE.Material;
					delete child.userData['renderMaterial'];
				}
			});
	}
	function keyDown(event: KeyboardEvent) {
		if (modalTransform != null) {
			if (event.key === 'Escape') {
				event.preventDefault();
				cancelTransform();
				return;
			}
			if (event.key === 'Enter') {
				event.preventDefault();
				event.stopImmediatePropagation();
				commitModalTransform();
				return;
			}
			if (['x', 'y', 'z'].includes(event.key.toLowerCase())) {
				event.preventDefault();
				event.stopImmediatePropagation();
				modalTransform.axis = event.key.toLowerCase() as 'x' | 'y' | 'z';
				applyModalTransform();
				return;
			}
			if (/^[0-9.-]$/.test(event.key) || event.key === 'Backspace') {
				event.preventDefault();
				event.stopImmediatePropagation();
				const next =
					event.key === 'Backspace'
						? modalTransform.numeric.slice(0, -1)
						: modalTransform.numeric + event.key;
				if (/^-?\d*(\.\d*)?$/.test(next)) modalTransform.numeric = next;
				applyModalTransform();
				return;
			}
		}
		if (event.key === 'Escape' && transform.dragging) {
			event.preventDefault();
			cancelTransform();
		}
	}
	window.addEventListener('keydown', keyDown, true);

	function wheelNavigate() {
		const props = getProps();
		if (props.view === 'camera' && props.onRequestOrbit) {
			props.onRequestOrbit();
			orbit.target.copy(target);
			orbit.enabled = true;
			pendingOrbitFrame = true;
		}
	}
	interactionSurface.addEventListener('wheel', wheelNavigate, { capture: true, passive: true });
	interactionSurface.addEventListener('pointerdown', pointerDown, true);
	interactionSurface.addEventListener('pointermove', pointerMove);
	interactionSurface.addEventListener('pointerup', pointerUp);
	interactionSurface.addEventListener('pointercancel', pointerCancel);
	transform.addEventListener('mouseDown', transformBegin);
	transform.addEventListener('mouseUp', transformEnd);

	const handle: TSceneHandle = {
		canvas: renderer.domElement,
		getCameraPose() {
			return {
				position: camera.position.toArray() as TVec3,
				target: target.toArray() as TVec3,
				fov: lastView === 'camera' ? outputCameraFov : camera.fov
			};
		},
		getPlacementPoint() {
			return (getProps().view === 'orbit' ? orbit.target : marblePosition).toArray() as TVec3;
		},
		frameSelected,
		frameAll,
		cancelTransform,
		beginTransform,
		isTransforming() {
			return modalTransform != null || transform.dragging;
		},
		setAxis(axis) {
			if (modalTransform != null) {
				modalTransform.axis = axis;
				applyModalTransform();
				return;
			}
			transform.showX = axis == null || axis === 'x';
			transform.showY = axis == null || axis === 'y';
			transform.showZ = axis == null || axis === 'z';
			invalidate();
		},
		setView(view) {
			if (lastView !== 'orbit') {
				orbit.target.copy(target);
				camera.fov = outputCameraFov;
				camera.updateProjectionMatrix();
			}
			const distance = camera.position.distanceTo(orbit.target);
			const direction =
				view === 'front'
					? new THREE.Vector3(0, 0, 1)
					: view === 'right'
						? new THREE.Vector3(1, 0, 0)
						: view === 'top'
							? new THREE.Vector3(0, 1, 0.0001)
							: new THREE.Vector3(0.35, 0.25, 1).normalize();
			camera.position.copy(orbit.target).addScaledVector(direction, distance);
			camera.lookAt(orbit.target);
			orbit.update();
			pendingOrbitFrame = true;
			invalidate();
		},
		renderAt,
		setExportSize(width, height) {
			if (!exporting)
				exportViewSnapshot = {
					position: camera.position.clone(),
					quaternion: camera.quaternion.clone(),
					target: orbit.target.clone(),
					fov: camera.fov,
					view: lastView
				};
			exporting = true;
			renderer.setPixelRatio(1);
			renderer.setSize(width, height, false);
			camera.aspect = width / height;
			camera.updateProjectionMatrix();
		},
		restoreSize() {
			exporting = false;
			resize();
			if (exportViewSnapshot != null) {
				const snapshot = exportViewSnapshot;
				camera.position.copy(snapshot.position);
				camera.quaternion.copy(snapshot.quaternion);
				camera.fov = snapshot.fov;
				orbit.target.copy(snapshot.target);
				camera.updateProjectionMatrix();
				lastView = snapshot.view;
				if (getProps().view === 'orbit')
					savedOrbitPose = {
						position: snapshot.position.clone(),
						target: snapshot.target.clone(),
						fov: snapshot.fov
					};
				pendingOrbitFrame = true;
				exportViewSnapshot = null;
			}
			renderAt(getProps().timeRef.current);
		},
		capture(width, height) {
			const [numerator, denominator] = getProps().project.aspectRatio.split(':').map(Number);
			const aspect = (numerator ?? 9) / (denominator ?? 16);
			const captureWidth = width ?? (aspect >= 1 ? Math.round(720 * aspect) : 720);
			const captureHeight = height ?? (aspect >= 1 ? 720 : Math.round(720 / aspect));
			try {
				handle.setExportSize(captureWidth, captureHeight);
				renderAt(getProps().timeRef.current);
				return renderer.domElement.toDataURL('image/png');
			} finally {
				handle.restoreSize();
			}
		}
	};

	return {
		handle,
		rebuild,
		invalidate,
		dispose() {
			disposed = true;
			window.cancelAnimationFrame(animationFrame);
			observer.disconnect();
			interactionSurface.removeEventListener('wheel', wheelNavigate, true);
			interactionSurface.removeEventListener('pointerdown', pointerDown, true);
			interactionSurface.removeEventListener('pointermove', pointerMove);
			interactionSurface.removeEventListener('pointerup', pointerUp);
			interactionSurface.removeEventListener('pointercancel', pointerCancel);
			transform.removeEventListener('mouseUp', transformEnd);
			transform.removeEventListener('mouseDown', transformBegin);
			window.removeEventListener('keydown', keyDown, true);
			transform.removeEventListener('change', invalidate);
			orbit.removeEventListener('change', invalidate);
			transform.dispose();
			editHelpers.dispose();
			orbit.dispose();
			clearGroup(objects, resources.shared, resources.glowTexture);
			clearGroup(guides, resources.shared, resources.glowTexture);
			clearGroup(marble, resources.shared, resources.glowTexture);
			for (const group of additionalMarbleGroups.values())
				clearGroup(group, resources.shared, resources.glowTexture);
			clearGroup(titleScene, resources.shared, resources.glowTexture);
			axisGuide.geometry.dispose();
			(axisGuide.material as THREE.Material).dispose();
			forecastGhost.geometry.dispose();
			(forecastGhost.material as THREE.Material).dispose();
			grid.geometry.dispose();
			for (const material of Array.isArray(grid.material) ? grid.material : [grid.material])
				material.dispose();
			wall.geometry.dispose();
			wallMaterial.dispose();
			selection.geometry.dispose();
			for (const material of selectionMaterials) material.dispose();
			resources.dispose();
			environment.dispose();
			renderer.dispose();
			renderer.domElement.remove();
			interactionSurface.remove();
			cameraOverlay.remove();
			transformStatus.remove();
		}
	};
}

function renderSettings(props: TMarbleSceneProps): string {
	return `${props.view}:${props.tool}:${props.showTrajectory}:${props.selectedNoteId}:${props.selectedObjectId}:${props.project.aspectRatio}:${props.cameraDistance}:${props.cameraContext}:${props.shading}:${props.showGrid}:${props.selectedMarble}:${props.selectedMarbleId}:${props.orbitAroundSelection}:${props.selectedEntity}:${props.showSceneHelpers}`;
}

function makeTitle(text: string): THREE.Sprite {
	const canvas = document.createElement('canvas');
	canvas.width = 1536;
	canvas.height = 192;
	const context = canvas.getContext('2d');
	if (context != null) {
		context.textAlign = 'center';
		context.textBaseline = 'middle';
		context.font = '800 84px system-ui';
		context.lineJoin = 'round';
		context.strokeStyle = 'rgba(0,0,0,.8)';
		context.lineWidth = 12;
		context.strokeText(text, 768, 96, 1450);
		context.fillStyle = 'white';
		context.fillText(text, 768, 96, 1450);
	}
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	return new THREE.Sprite(
		new THREE.SpriteMaterial({
			map: texture,
			transparent: true,
			depthTest: false,
			toneMapped: false
		})
	);
}
