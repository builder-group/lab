import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { TVec2 } from '@/modules/project';
import { getPieceDefinition, type TResolvedPiece } from '@/modules/simulation';
import { worldToScreen, type TView, type TViewport } from './view';

// Draws the wall content with WebGL over the CSS dot grid. Objects are kept between updates and only
// their buffers and transforms change. Frames render on demand through `invalidate`.

export interface TComposeCamera {
	mode: '2d' | 'orbit';
	view: TView;
	/** Orbit angles in radians around the view centre; ignored in 2D */
	yaw: number;
	pitch: number;
}

export interface TRenderPiece {
	piece: TResolvedPiece;
	ghost: boolean;
}

export interface TRenderMarble {
	entityId: string;
	color: string;
	radius: number;
	position: TVec2;
}

export interface TRenderTrack {
	entityId: string;
	color: string;
	/** Flat x, y pairs and the time of each point */
	points: Float32Array;
	times: Float32Array;
}

export interface TComposeTheme {
	canvas: string;
	guide: string;
}

/** Marble centres move in this plane, see `MARBLE_Z` in the simulation */
export const MARBLE_Z = 0.01;
const ORBIT_FOV = 35;

export class ComposeRenderer {
	private readonly renderer: THREE.WebGLRenderer;
	private readonly scene = new THREE.Scene();
	private readonly orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
	private readonly perspective = new THREE.PerspectiveCamera(ORBIT_FOV, 1, 0.005, 200);
	private readonly wall: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>;
	private readonly pieces = new Map<string, TPieceObject>();
	private readonly marbles = new Map<string, THREE.Mesh>();
	private readonly tracks = new Map<string, TrackLine>();
	private readonly guides: TrackLine;
	private readonly pieceGeometries = new Map<string, THREE.BufferGeometry>();
	private readonly nubGeometry = new THREE.CylinderGeometry(1, 1, 1, 20).rotateX(Math.PI / 2);
	private readonly sphereGeometry = new THREE.SphereGeometry(1, 32, 20);
	private readonly materials = new Map<string, THREE.Material>();
	private viewport: TViewport = { width: 1, height: 1 };
	private pixelRatio = 1;
	private camera: TComposeCamera = { mode: '2d', view: { center: { x: 0, y: 0 }, scale: 500 }, yaw: 0, pitch: 0 };
	private theme: TComposeTheme = { canvas: '#f2f1ee', guide: '#000000' };
	private playhead = 0;
	private frame: number | null = null;
	private isDisposed = false;

	constructor(canvas: HTMLCanvasElement) {
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true });
		this.renderer.setClearColor(0x000000, 0);

		// Lambert divides by π, so these intensities keep a face toward the camera at its flat colour
		this.scene.add(new THREE.AmbientLight(0xffffff, 0.72 * Math.PI));
		const light = new THREE.DirectionalLight(0xffffff, 0.36 * Math.PI);
		light.position.set(0.3, 1, 2);
		this.scene.add(light);

		this.orthographic.position.set(0, 0, 10);
		this.orthographic.lookAt(0, 0, 0);

		// The wall only shows in orbit, where the CSS grid cannot follow the perspective
		this.wall = new THREE.Mesh(
			new THREE.PlaneGeometry(1, 1),
			new THREE.MeshLambertMaterial({ map: createPegTexture(), transparent: true })
		);
		this.wall.renderOrder = -1;
		this.wall.visible = false;
		this.scene.add(this.wall);

		this.guides = new TrackLine(1);
		this.guides.mesh.renderOrder = 0;
		this.scene.add(this.guides.mesh);
	}

	// MARK: - Inputs

	setViewport(viewport: TViewport, pixelRatio: number): void {
		this.viewport = viewport;
		this.pixelRatio = pixelRatio;
		this.renderer.setPixelRatio(pixelRatio);
		this.renderer.setSize(viewport.width, viewport.height, false);
		this.updateCamera();
		this.invalidate();
	}

	setCamera(camera: TComposeCamera): void {
		this.camera = camera;
		this.updateCamera();
		this.invalidate();
	}

	setTheme(theme: TComposeTheme): void {
		this.theme = theme;
		for (const track of this.tracks.values()) track.setFutureMix(theme.canvas);
		this.guides.setColor(theme.guide);
		this.invalidate();
	}

	setPlayhead(time: number): void {
		this.playhead = time;
		for (const track of this.tracks.values()) track.setPlayhead(time);
		this.invalidate();
	}

	setPieces(items: TRenderPiece[]): void {
		const seen = new Set<string>();
		items.forEach((item, index) => {
			const { piece } = item;
			seen.add(piece.entityId);
			let object = this.pieces.get(piece.entityId);
			const length = piece.params['length'] ?? 0.06;
			const thickness = piece.params['thickness'] ?? 0.008;
			const depth = piece.params['depth'] ?? 0.03;
			const geometryKey = `${piece.type}:${length}:${thickness}:${depth}`;
			if (object == null) {
				object = createPieceObject();
				this.pieces.set(piece.entityId, object);
				this.scene.add(object.group);
			}
			if (object.geometryKey !== geometryKey) {
				object.bar.geometry = this.pieceGeometry(geometryKey, length, thickness, depth);
				object.geometryKey = geometryKey;
				const nubRadius = Math.min(thickness * 0.32, 0.0028);
				object.nub.scale.set(nubRadius, nubRadius, depth + 0.0012);
				object.nub.position.z = (depth + 0.0012) / 2;
				object.bar.position.z = depth / 2;
			}
			const definition = getPieceDefinition(piece.type);
			object.group.position.set(piece.position.x, piece.position.y, definition?.wallOffset ?? 0);
			object.group.rotation.z = piece.angle;
			object.bar.material = this.pieceMaterial(piece.type, 'bar', item.ghost);
			object.nub.material = this.pieceMaterial(piece.type, 'nub', item.ghost);
			// Ghosts draw after solid content so transparency blends over it
			object.group.renderOrder = item.ghost ? 2 + index : 1;
		});
		for (const [id, object] of this.pieces) {
			if (seen.has(id)) continue;
			this.scene.remove(object.group);
			this.pieces.delete(id);
		}
		this.invalidate();
	}

	setMarbles(items: TRenderMarble[]): void {
		const seen = new Set<string>();
		for (const item of items) {
			seen.add(item.entityId);
			let mesh = this.marbles.get(item.entityId);
			if (mesh == null) {
				mesh = new THREE.Mesh(this.sphereGeometry);
				mesh.renderOrder = 3;
				this.marbles.set(item.entityId, mesh);
				this.scene.add(mesh);
			}
			mesh.material = this.marbleMaterial(item.color);
			mesh.scale.setScalar(item.radius);
			mesh.position.set(item.position.x, item.position.y, MARBLE_Z);
		}
		for (const [id, mesh] of this.marbles) {
			if (seen.has(id)) continue;
			this.scene.remove(mesh);
			this.marbles.delete(id);
		}
		this.invalidate();
	}

	setTracks(items: TRenderTrack[]): void {
		const seen = new Set<string>();
		for (const item of items) {
			seen.add(item.entityId);
			let track = this.tracks.get(item.entityId);
			if (track == null) {
				track = new TrackLine(2);
				track.setPlayhead(this.playhead);
				this.tracks.set(item.entityId, track);
				this.scene.add(track.mesh);
			}
			track.setColor(item.color);
			track.setFutureMix(this.theme.canvas);
			track.setPoints(item.points, item.times, MARBLE_Z);
		}
		for (const [id, track] of this.tracks) {
			if (seen.has(id)) continue;
			this.scene.remove(track.mesh);
			track.dispose();
			this.tracks.delete(id);
		}
		this.invalidate();
	}

	/** Two vertical guides at the frame edges, spanning `fromY` to `toY` */
	setFrameGuides(band: { centerX: number; halfWidth: number } | null, fromY: number, toY: number): void {
		if (band == null) {
			this.guides.setPoints(new Float32Array(), new Float32Array(), 0);
			this.invalidate();
			return;
		}
		const left = band.centerX - band.halfWidth;
		const right = band.centerX + band.halfWidth;
		// A NaN point breaks the strip between the two guides
		const points = new Float32Array([left, toY, left, fromY, Number.NaN, Number.NaN, right, toY, right, fromY]);
		this.guides.setPoints(points, new Float32Array(5), 0);
		this.guides.setColor(this.theme.guide);
		this.invalidate();
	}

	// MARK: - Projection

	/** CSS pixel position of a wall point at depth `z` */
	project(point: TVec2, z = 0): TVec2 {
		if (this.camera.mode === '2d') return worldToScreen(this.camera.view, this.viewport, point);
		const vector = new THREE.Vector3(point.x, point.y, z).project(this.perspective);
		return { x: ((vector.x + 1) / 2) * this.viewport.width, y: ((1 - vector.y) / 2) * this.viewport.height };
	}

	// MARK: - Rendering

	invalidate(): void {
		if (this.frame != null || this.isDisposed) return;
		this.frame = requestAnimationFrame(() => {
			this.frame = null;
			this.render();
		});
	}

	render(): void {
		if (this.isDisposed) return;
		const resolution = new THREE.Vector2(this.viewport.width * this.pixelRatio, this.viewport.height * this.pixelRatio);
		for (const track of this.tracks.values()) track.setResolution(resolution, this.pixelRatio);
		this.guides.setResolution(resolution, this.pixelRatio);
		this.renderer.render(this.scene, this.camera.mode === '2d' ? this.orthographic : this.perspective);
	}

	dispose(): void {
		this.isDisposed = true;
		if (this.frame != null) cancelAnimationFrame(this.frame);
		for (const track of this.tracks.values()) track.dispose();
		this.guides.dispose();
		for (const geometry of this.pieceGeometries.values()) geometry.dispose();
		for (const material of this.materials.values()) material.dispose();
		this.nubGeometry.dispose();
		this.sphereGeometry.dispose();
		this.wall.geometry.dispose();
		this.wall.material.map?.dispose();
		this.wall.material.dispose();
		this.renderer.dispose();
	}

	private updateCamera(): void {
		const { view, mode } = this.camera;
		const { width, height } = this.viewport;
		const halfWidth = width / 2 / view.scale;
		const halfHeight = height / 2 / view.scale;
		this.orthographic.left = view.center.x - halfWidth;
		this.orthographic.right = view.center.x + halfWidth;
		this.orthographic.top = view.center.y + halfHeight;
		this.orthographic.bottom = view.center.y - halfHeight;
		this.orthographic.updateProjectionMatrix();

		const isOrbit = mode === 'orbit';
		this.wall.visible = isOrbit;
		if (!isOrbit) return;
		// The orbit camera sees the same wall area as the 2D view when it faces the wall
		const distance = halfHeight / Math.tan(THREE.MathUtils.degToRad(ORBIT_FOV / 2));
		const target = new THREE.Vector3(view.center.x, view.center.y, MARBLE_Z);
		const { yaw, pitch } = this.camera;
		this.perspective.aspect = width / height;
		this.perspective.near = distance / 100;
		this.perspective.far = distance * 100;
		this.perspective.position.set(
			target.x + distance * Math.sin(yaw) * Math.cos(pitch),
			target.y + distance * Math.sin(pitch),
			target.z + distance * Math.cos(yaw) * Math.cos(pitch)
		);
		this.perspective.lookAt(target);
		this.perspective.updateProjectionMatrix();
		// Projection for overlays happens between renders, so the matrices must be current now
		this.perspective.updateMatrixWorld();
		// A wall patch around the view, with the peg texture repeating every 2.5 cm
		const size = Math.max(halfWidth, halfHeight) * 8;
		this.wall.scale.set(size, size, 1);
		this.wall.position.set(view.center.x, view.center.y, 0);
		const texture = this.wall.material.map;
		if (texture != null) {
			texture.repeat.set(size / 0.025, size / 0.025);
			texture.offset.set(((view.center.x - size / 2) / 0.025) % 1, ((view.center.y - size / 2) / 0.025) % 1);
		}
	}

	private pieceGeometry(key: string, length: number, thickness: number, depth: number): THREE.BufferGeometry {
		let geometry = this.pieceGeometries.get(key);
		if (geometry == null) {
			const radius = Math.min(thickness * 0.45, 0.004);
			geometry = new RoundedBoxGeometry(length, thickness, depth, 3, radius);
			this.pieceGeometries.set(key, geometry);
		}
		return geometry;
	}

	private pieceMaterial(type: string, part: 'bar' | 'nub', ghost: boolean): THREE.Material {
		const key = `piece:${type}:${part}:${ghost}`;
		let material = this.materials.get(key);
		if (material == null) {
			const palette = piecePalette[type] ?? piecePalette['platform'];
			material = new THREE.MeshLambertMaterial({
				color: part === 'bar' ? palette?.bar : palette?.nub,
				transparent: ghost,
				opacity: ghost ? 0.32 : 1,
				depthWrite: !ghost
			});
			this.materials.set(key, material);
		}
		return material;
	}

	private marbleMaterial(color: string): THREE.Material {
		const key = `marble:${color}`;
		let material = this.materials.get(key);
		if (material == null) {
			material = new THREE.MeshStandardMaterial({ color, roughness: 0.28, metalness: 0.05, emissive: color, emissiveIntensity: 0.18 });
			this.materials.set(key, material);
		}
		return material;
	}
}

/** Flat toy colours per piece type, with a darker bracket nub */
export const piecePalette: Record<string, { bar: string; nub: string }> = {
	platform: { bar: '#f2845c', nub: '#c4603d' }
};

interface TPieceObject {
	group: THREE.Group;
	bar: THREE.Mesh;
	nub: THREE.Mesh;
	geometryKey: string;
}

function createPieceObject(): TPieceObject {
	const group = new THREE.Group();
	const bar = new THREE.Mesh();
	const nub = new THREE.Mesh();
	group.add(bar, nub);
	return { group, bar, nub, geometryKey: '' };
}

/** Pegboard holes for the orbit wall, one hole per texture repeat */
function createPegTexture(): THREE.Texture {
	const size = 64;
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const context = canvas.getContext('2d');
	if (context != null) {
		context.fillStyle = '#f2f1ee';
		context.fillRect(0, 0, size, size);
		context.fillStyle = 'rgba(0, 0, 0, 0.16)';
		context.beginPath();
		context.arc(size / 2, size / 2, size * 0.09, 0, Math.PI * 2);
		context.fill();
	}
	const texture = new THREE.CanvasTexture(canvas);
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 8;
	return texture;
}

// MARK: - Thick lines

const lineVertexShader = /* glsl */ `
	attribute vec3 aStart;
	attribute vec3 aEnd;
	attribute vec2 aTime;
	uniform vec2 uResolution;
	uniform float uWidth;
	varying float vTime;

	void main() {
		vec4 clipStart = projectionMatrix * modelViewMatrix * vec4(aStart, 1.0);
		vec4 clipEnd = projectionMatrix * modelViewMatrix * vec4(aEnd, 1.0);
		vec2 screenStart = clipStart.xy / clipStart.w * uResolution * 0.5;
		vec2 screenEnd = clipEnd.xy / clipEnd.w * uResolution * 0.5;
		vec2 direction = screenEnd - screenStart;
		float len = length(direction);
		direction = len > 1e-5 ? direction / len : vec2(1.0, 0.0);
		vec2 normal = vec2(-direction.y, direction.x);
		// The base quad's position holds the corner: x picks the segment end, y the side
		vec2 corner = position.xy;
		bool isStart = corner.x < 0.5;
		vec4 clip = isStart ? clipStart : clipEnd;
		// Extending each segment by half the width closes the gaps at joins
		vec2 offset = normal * corner.y * uWidth * 0.5 + direction * (isStart ? -0.5 : 0.5) * uWidth;
		clip.xy += offset / uResolution * 2.0 * clip.w;
		gl_Position = clip;
		vTime = isStart ? aTime.x : aTime.y;
	}
`;

const lineFragmentShader = /* glsl */ `
	uniform vec3 uColor;
	uniform vec3 uFutureColor;
	uniform float uPlayhead;
	varying float vTime;

	void main() {
		gl_FragColor = vec4(vTime <= uPlayhead ? uColor : uFutureColor, 1.0);
		#include <colorspace_fragment>
	}
`;

/**
 * Screen-space line strip drawn as one instanced quad per segment. Points before the playhead use the full
 * colour and later points a lighter mix with the canvas, so overlapping joins stay opaque.
 */
class TrackLine {
	readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
	private readonly uniforms = {
		uResolution: { value: new THREE.Vector2(1, 1) },
		uWidth: { value: 1 },
		uColor: { value: new THREE.Color() },
		uFutureColor: { value: new THREE.Color() },
		uPlayhead: { value: 0 }
	};
	private capacity = 0;
	private color = new THREE.Color();
	private canvasColor = new THREE.Color('#f2f1ee');

	constructor(private readonly cssWidth: number) {
		const geometry = createLineGeometry(0);
		const material = new THREE.ShaderMaterial({
			vertexShader: lineVertexShader,
			fragmentShader: lineFragmentShader,
			uniforms: this.uniforms
		});
		this.mesh = new THREE.Mesh(geometry, material);
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = 0;
	}

	setColor(color: string): void {
		this.color.set(color);
		this.updateColors();
	}

	setFutureMix(canvas: string): void {
		this.canvasColor.set(canvas);
		this.updateColors();
	}

	setPlayhead(time: number): void {
		this.uniforms.uPlayhead.value = time;
	}

	setResolution(resolution: THREE.Vector2, pixelRatio: number): void {
		this.uniforms.uResolution.value.copy(resolution);
		this.uniforms.uWidth.value = this.cssWidth * pixelRatio;
	}

	/** Replaces the strip. `points` holds x, y pairs; a NaN pair breaks the strip. */
	setPoints(points: Float32Array, times: Float32Array, z: number): void {
		const count = Math.max(0, points.length / 2 - 1);
		if (count > this.capacity) {
			// three.js caches the instance limit per geometry, so a larger strip needs a new geometry
			this.capacity = Math.max(count, Math.ceil(this.capacity * 1.5), 64);
			this.mesh.geometry.dispose();
			this.mesh.geometry = createLineGeometry(this.capacity);
		}
		const geometry = this.mesh.geometry;
		if (this.capacity === 0) {
			geometry.instanceCount = 0;
			return;
		}
		const start = geometry.getAttribute('aStart') as THREE.InstancedBufferAttribute;
		const end = geometry.getAttribute('aEnd') as THREE.InstancedBufferAttribute;
		const time = geometry.getAttribute('aTime') as THREE.InstancedBufferAttribute;
		const startArray = start.array as Float32Array;
		const endArray = end.array as Float32Array;
		const timeArray = time.array as Float32Array;
		let written = 0;
		for (let i = 0; i < count; i++) {
			const ax = points[i * 2] ?? Number.NaN;
			const ay = points[i * 2 + 1] ?? Number.NaN;
			const bx = points[i * 2 + 2] ?? Number.NaN;
			const by = points[i * 2 + 3] ?? Number.NaN;
			if (Number.isNaN(ax) || Number.isNaN(bx)) continue;
			startArray.set([ax, ay, z], written * 3);
			endArray.set([bx, by, z], written * 3);
			timeArray.set([times[i] ?? 0, times[i + 1] ?? 0], written * 2);
			written++;
		}
		start.needsUpdate = true;
		end.needsUpdate = true;
		time.needsUpdate = true;
		geometry.instanceCount = written;
	}

	dispose(): void {
		this.mesh.geometry.dispose();
		this.mesh.material.dispose();
	}

	private updateColors(): void {
		this.uniforms.uColor.value.copy(this.color);
		this.uniforms.uFutureColor.value.copy(this.color).lerp(this.canvasColor, 0.62);
	}
}

function createLineGeometry(capacity: number): THREE.InstancedBufferGeometry {
	const geometry = new THREE.InstancedBufferGeometry();
	// Named position so three.js derives the vertex count from it
	geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, -1, 0, 1, 1, 0, 0, 1, 0], 3));
	if (capacity > 0) {
		geometry.setAttribute('aStart', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
		geometry.setAttribute('aEnd', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
		geometry.setAttribute('aTime', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2));
	}
	geometry.instanceCount = 0;
	return geometry;
}
