import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CAMERA_CLIP_END, CAMERA_CLIP_START, verticalFov, type TCameraPose } from '@/modules/camera';
import type { TVec2 } from '@/modules/project';
import { getPieceDefinition, layoutOf, rotorLocalShapes, shownDepth, type TResolvedPiece } from '@/modules/simulation';
import { pathMeshes } from './path-meshes';
import { worldToScreen, type TView, type TViewport } from './view';

// Draws the wall and what is on it with WebGL. Objects are kept between updates and only
// their buffers and transforms change. Frames render on demand through `invalidate`.

export interface TComposeCamera {
	/** `camera` looks through the film's follow camera, see `setFilm`; `orbit` is Track's free 3D view, see `setOrbit` */
	mode: '2d' | 'camera' | 'orbit';
	view: TView;
}

/** Track's free 3D view: how far around its target it stands, at the view's center and scale, and how wide it sees */
export interface TOrbitView {
	/** Radians around the wall's up axis; 0 is front-on */
	yaw: number;
	/** Radians up from front-on */
	pitch: number;
	/** Vertical field of view in degrees: near 0 looks flat, like the 2D view */
	fov: number;
	/** Depth of the point it turns around */
	z: number;
}

/** Film camera pose and where the film frame sits on the canvas, in CSS pixels */
export interface TFilmView {
	pose: TCameraPose;
	/** Film frame width over height */
	aspect: number;
	frame: { x: number; y: number; width: number; height: number };
}

export interface TRenderPiece {
	piece: TResolvedPiece;
	/** Current rotation, which differs from the resolved angle for moving pieces such as windmills */
	angle: number;
	/** Overrides the piece type's flat colors, for the Film Draft Preview's theme look */
	colors?: { bar: string; nub: string };
	/** The film's marble path depth, in the Draft Preview: a Windmill turns around it */
	pathZ?: number;
	/** Rails, Tunnels and Bowls as real meshes at `pathZ`, in Track's 3D view; elsewhere they are overlay lines */
	hasSolidPaths?: boolean;
}

/** Wall surface in the Camera view: its color and the peg hole color, or no holes for a plain wall */
export interface TWallLook {
	color: string;
	holes: string | null;
	/** Hole radius as a fraction of the 2.5 cm peg pitch; 0.09 when absent */
	holeRadius?: number;
}

export interface TRenderMarble {
	entityId: string;
	color: string;
	radius: number;
	position: TVec2;
	/** Depth from the wall; absent: the plane physics runs in */
	z?: number;
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

/** Marble centers move in this plane, see `MARBLE_Z` in the simulation */
export const MARBLE_Z = 0.01;
/** Marbles never shrink below this radius on screen, so a zoomed-out run still shows where they are */
export const MIN_MARBLE_PX = 3.5;

export class ComposeRenderer {
	private readonly renderer: THREE.WebGLRenderer;
	private readonly scene = new THREE.Scene();
	private readonly orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
	private readonly film = new THREE.PerspectiveCamera(30, 1, CAMERA_CLIP_START, CAMERA_CLIP_END);
	private filmView: TFilmView | null = null;
	private orbit: TOrbitView = { yaw: 0, pitch: 0, fov: 30, z: 0 };
	private readonly wall: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
	private readonly pieces = new Map<string, TPieceObject>();
	private readonly marbles = new Map<string, { mesh: THREE.Mesh; radius: number }>();
	private readonly tracks = new Map<string, TrackLine>();
	private readonly guides: TrackLine;
	private readonly pieceGeometries = new Map<string, THREE.BufferGeometry>();
	private readonly nubGeometry = new THREE.CylinderGeometry(1, 1, 1, 20).rotateX(Math.PI / 2);
	private readonly sphereGeometry = new THREE.SphereGeometry(1, 32, 20);
	private readonly materials = new Map<string, THREE.Material>();
	private readonly ambient = new THREE.AmbientLight(0xffffff, 0.72 * Math.PI);
	private readonly key = new THREE.DirectionalLight(0xffffff, 0.36 * Math.PI);
	private viewport: TViewport = { width: 1, height: 1 };
	private pixelRatio = 1;
	private camera: TComposeCamera = { mode: '2d', view: { center: { x: 0, y: 0 }, scale: 500 } };
	private theme: TComposeTheme = { canvas: '#f2f1ee', guide: '#000000' };
	private playhead = 0;
	private frame: number | null = null;
	private isDisposed = false;

	constructor(canvas: HTMLCanvasElement) {
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true });
		this.renderer.setClearColor(0x000000, 0);

		// Lambert divides by π, so these intensities keep a face toward the camera at its flat color
		this.scene.add(this.ambient);
		this.key.position.set(0.3, 1, 2);
		this.scene.add(this.key);

		this.orthographic.position.set(0, 0, 10);
		this.orthographic.lookAt(0, 0, 0);

		// The same wall in every view, so 3D is the flat view tilted, unlit so its color is the one chosen
		this.wall = new THREE.Mesh(
			new THREE.PlaneGeometry(1, 1),
			new THREE.MeshBasicMaterial({ map: createPegTexture(), transparent: true })
		);
		this.wall.renderOrder = -1;
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
		for (const marble of this.marbles.values()) this.scaleMarble(marble);
		this.invalidate();
	}

	/** Pose of the film camera for the Camera view; called every frame while it shows */
	setFilm(film: TFilmView | null): void {
		this.filmView = film;
		this.updateCamera();
		this.invalidate();
	}

	/** Where Track's 3D view stands; called every frame while it moves */
	setOrbit(orbit: TOrbitView): void {
		this.orbit = orbit;
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

	/** Repaints the wall texture: Track's wall, or a theme's in the Film Draft Preview */
	setWallLook(look: TWallLook): void {
		const material = this.wall.material;
		const previous = material.map;
		material.map = createPegTexture(look);
		if (previous != null) {
			material.map.repeat.copy(previous.repeat);
			material.map.offset.copy(previous.offset);
			previous.dispose();
		}
		material.needsUpdate = true;
		this.invalidate();
	}

	/** The Wall layer's eye: the views show the pieces on the bare canvas */
	setWallHidden(isHidden: boolean): void {
		if (this.wall.visible !== isHidden) return;
		this.wall.visible = !isHidden;
		this.invalidate();
	}

	/** Track's 3D view, like Blender's Solid mode: a stronger light from above, so a bar's top, front and sides read apart */
	setSolidLight(): void {
		this.ambient.intensity = 0.55 * Math.PI;
		this.key.intensity = 0.75 * Math.PI;
		this.key.position.set(0.4, 1.2, 1);
		this.invalidate();
	}

	/** Platforms and windmills; rails and tunnels are flat lines drawn by the canvas overlay */
	setPieces(items: TRenderPiece[]): void {
		const seen = new Set<string>();
		items.forEach((item) => {
			const { piece } = item;
			const kind = layoutOf(piece.type);
			if (kind !== 'box' && kind !== 'rotor') {
				if (item.hasSolidPaths === true) {
					seen.add(piece.entityId);
					this.setPathPiece(item);
				}
				return;
			}
			seen.add(piece.entityId);
			let object = this.pieces.get(piece.entityId);
			if (object == null) {
				object = { group: new THREE.Group(), parts: [], geometryKey: '' };
				this.pieces.set(piece.entityId, object);
				this.scene.add(object.group);
			}
			// A run's pieces are never changed in place, so the same one needs no second look at its params
			let isRebuilt = false;
			if (object.keySource !== piece) {
				object.keySource = piece;
				const geometryKey = `${piece.type}:${Object.entries(piece.params)
					.map(([name, value]) => `${name}=${value}`)
					.join(',')}`;
				if (object.geometryKey !== geometryKey) {
					object.group.clear();
					object.parts = kind === 'rotor' ? this.rotorParts(piece) : this.platformParts(piece);
					for (const part of object.parts) object.group.add(part.mesh);
					object.geometryKey = geometryKey;
					isRebuilt = true;
				}
			}
			const definition = getPieceDefinition(piece.type);
			// A Windmill turns around the marble's path
			const rotorZ = kind === 'rotor' && item.pathZ != null ? item.pathZ - (piece.params['depth'] ?? 0.03) * 0.4 : 0;
			object.group.position.set(piece.position.x, piece.position.y, (definition?.wallOffset ?? 0) + rotorZ);
			object.group.rotation.z = item.angle;
			if (isRebuilt || object.colors !== item.colors) {
				object.colors = item.colors;
				for (const part of object.parts) {
					part.mesh.material = this.pieceMaterial(piece.type, part.role, item.colors);
					part.mesh.renderOrder = 1;
				}
			}
			object.group.renderOrder = 1;
		});
		for (const [id, object] of this.pieces) {
			if (seen.has(id)) continue;
			this.scene.remove(object.group);
			disposeOwned(object);
			this.pieces.delete(id);
		}
		this.invalidate();
	}

	/** Turns a platform or windmill already set, for a playhead tick that changes nothing else; a path piece has no angle here */
	setPieceAngle(entityId: string, angle: number): void {
		const object = this.pieces.get(entityId);
		if (object != null && object.pathSource == null) object.group.rotation.z = angle;
	}

	/** A path piece's meshes in wall coordinates, rebuilt only when the piece or its depth changes */
	private setPathPiece(item: TRenderPiece): void {
		const { piece, pathZ = MARBLE_Z } = item;
		let object = this.pieces.get(piece.entityId);
		if (object == null) {
			object = { group: new THREE.Group(), parts: [], geometryKey: '' };
			this.pieces.set(piece.entityId, object);
			this.scene.add(object.group);
		}
		if (object.pathSource !== piece || object.pathZ !== pathZ) {
			object.group.clear();
			disposeOwned(object);
			const { wires, posts, shell } = pathMeshes(piece, pathZ);
			object.parts = [
				...(wires != null ? [{ mesh: new THREE.Mesh(wires), role: 'bar' as const }] : []),
				...(posts != null ? [{ mesh: new THREE.Mesh(posts), role: 'nub' as const }] : []),
				...(shell != null ? [{ mesh: new THREE.Mesh(shell), role: 'shell' as const }] : [])
			];
			for (const part of object.parts) {
				object.group.add(part.mesh);
				part.mesh.renderOrder = part.role === 'shell' ? 2 : 1;
			}
			object.ownsGeometry = true;
			object.pathSource = piece;
			object.pathZ = pathZ;
			object.geometryKey = '';
		}
		for (const part of object.parts) part.mesh.material = this.pieceMaterial(piece.type, part.role, item.colors);
	}

	setMarbles(items: TRenderMarble[]): void {
		const seen = new Set<string>();
		for (const item of items) {
			seen.add(item.entityId);
			let marble = this.marbles.get(item.entityId);
			if (marble == null) {
				const mesh = new THREE.Mesh(this.sphereGeometry);
				mesh.renderOrder = 3;
				marble = { mesh, radius: item.radius };
				this.marbles.set(item.entityId, marble);
				this.scene.add(mesh);
			}
			marble.radius = item.radius;
			marble.mesh.material = this.marbleMaterial(item.color);
			marble.mesh.position.set(item.position.x, item.position.y, item.z ?? MARBLE_Z);
			this.scaleMarble(marble);
		}
		for (const [id, marble] of this.marbles) {
			if (seen.has(id)) continue;
			this.scene.remove(marble.mesh);
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
			track.mesh.visible = this.camera.mode !== 'camera';
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
		const vector = new THREE.Vector3(point.x, point.y, z).project(this.activeCamera());
		if (vector.z > 1) return { x: Number.NaN, y: Number.NaN };
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
		// A direct draw covers the frame an input just asked for
		if (this.frame != null) cancelAnimationFrame(this.frame);
		this.frame = null;
		const resolution = new THREE.Vector2(this.viewport.width * this.pixelRatio, this.viewport.height * this.pixelRatio);
		for (const track of this.tracks.values()) track.setResolution(resolution, this.pixelRatio);
		this.guides.setResolution(resolution, this.pixelRatio);
		this.renderer.render(this.scene, this.activeCamera());
	}

	private activeCamera(): THREE.Camera {
		return this.camera.mode === '2d' ? this.orthographic : this.film;
	}

	dispose(): void {
		this.isDisposed = true;
		if (this.frame != null) cancelAnimationFrame(this.frame);
		for (const track of this.tracks.values()) track.dispose();
		this.guides.dispose();
		for (const object of this.pieces.values()) disposeOwned(object);
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

		const isFlat = mode === '2d';
		if (isFlat) this.placeWall(view.center, Math.max(width, height) / view.scale + 0.1);
		// Only the flat view shows trajectories and frame guides
		for (const track of this.tracks.values()) track.mesh.visible = isFlat;
		this.guides.mesh.visible = isFlat;
		if (mode === 'camera') this.updateFilmCamera();
		else if (mode === 'orbit') this.updateOrbitCamera();
	}

	/**
	 * Stands so the plane at the orbit's depth keeps the view's scale at its center: the same wall as the flat view, seen
	 * from an angle. Near a field of view of 0 it looks flat, which is how a change of view eases between the two.
	 */
	private updateOrbitCamera(): void {
		const { yaw, pitch, fov, z } = this.orbit;
		const { center, scale } = this.camera.view;
		const { width, height } = this.viewport;
		const halfHeight = height / 2 / scale;
		const distance = halfHeight / Math.tan(THREE.MathUtils.degToRad(fov / 2));
		orbitTarget.set(center.x, center.y, z);
		this.film.position.set(center.x + distance * Math.sin(yaw) * Math.cos(pitch), center.y + distance * Math.sin(pitch), z + distance * Math.cos(yaw) * Math.cos(pitch));
		this.film.up.set(0, 1, 0);
		this.film.lookAt(orbitTarget);
		this.film.aspect = width / height;
		this.film.fov = fov;
		this.film.near = distance * 0.02;
		this.film.far = distance * 200;
		this.film.clearViewOffset();
		this.film.updateProjectionMatrix();
		this.film.updateMatrixWorld();
		this.placeWall(center, Math.max(1, (halfHeight * Math.max(1, width / height)) * 60));
	}

	/**
	 * The film camera maps Blender's pose (x along the wall, y into it, z up) to the scene (x, y up the wall, z out
	 * of it). Its field of view makes the film frame rectangle show exactly the film's view; the canvas around it
	 * shows more of the wall, which the viewfinder mask dims.
	 */
	private updateFilmCamera(): void {
		const film = this.filmView;
		const { width, height } = this.viewport;
		if (film == null || film.frame.height <= 0) return;
		const { position, rotation } = film.pose;
		this.film.near = CAMERA_CLIP_START;
		this.film.far = CAMERA_CLIP_END;
		this.film.position.set(position[0], position[2], -position[1]);
		filmRotation.set(rotation[1], rotation[2], rotation[3], rotation[0]);
		this.film.quaternion.copy(blenderToScene).multiply(filmRotation);
		const halfFrame = Math.tan(THREE.MathUtils.degToRad(verticalFov(film.pose.lens, film.aspect) / 2));
		const pixelsPerUnit = film.frame.height / 2 / halfFrame;
		this.film.aspect = width / height;
		this.film.fov = THREE.MathUtils.radToDeg(2 * Math.atan(height / 2 / pixelsPerUnit));
		// A frame off the canvas center shifts the view so its center stays on the camera axis
		const offsetX = film.frame.x + film.frame.width / 2 - width / 2;
		const offsetY = film.frame.y + film.frame.height / 2 - height / 2;
		if (Math.abs(offsetX) > 0.5 || Math.abs(offsetY) > 0.5) this.film.setViewOffset(width, height, -offsetX, -offsetY, width, height);
		else this.film.clearViewOffset();
		this.film.updateProjectionMatrix();
		this.film.updateMatrixWorld();
		// The wall patch covers the view far along the steep wall
		const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.film.quaternion);
		const reach = forward.z < -1e-3 ? -this.film.position.z / forward.z : 1;
		const center = { x: this.film.position.x + forward.x * reach, y: this.film.position.y + forward.y * reach };
		this.placeWall(center, Math.max(1, this.film.position.z * 40));
	}

	/** A wall patch around `center`, with the peg texture repeating every 2.5 cm */
	private placeWall(center: TVec2, size: number): void {
		this.wall.scale.set(size, size, 1);
		this.wall.position.set(center.x, center.y, 0);
		const texture = this.wall.material.map;
		if (texture != null) {
			texture.repeat.set(size / 0.025, size / 0.025);
			texture.offset.set(((center.x - size / 2) / 0.025) % 1, ((center.y - size / 2) / 0.025) % 1);
		}
	}

	private scaleMarble(marble: { mesh: THREE.Mesh; radius: number }): void {
		// The film shows marbles at their real size
		const minimum = this.camera.mode === 'camera' ? 0 : MIN_MARBLE_PX / this.camera.view.scale;
		marble.mesh.scale.setScalar(Math.max(marble.radius, minimum));
	}

	private boxGeometry(length: number, thickness: number, depth: number): THREE.BufferGeometry {
		const key = `box:${length}:${thickness}:${depth}`;
		let geometry = this.pieceGeometries.get(key);
		if (geometry == null) {
			const radius = Math.min(thickness * 0.45, 0.004);
			geometry = new RoundedBoxGeometry(length, thickness, depth, 3, radius);
			this.pieceGeometries.set(key, geometry);
		}
		return geometry;
	}

	/** A bar on the wall with the round bracket nub that holds it */
	private platformParts(piece: TResolvedPiece): TPiecePart[] {
		const length = piece.params['length'] ?? 0.06;
		const thickness = piece.params['thickness'] ?? 0.008;
		const depth = shownDepth(piece);
		const bar = new THREE.Mesh(this.boxGeometry(length, thickness, depth));
		bar.position.z = depth / 2;
		const nub = new THREE.Mesh(this.nubGeometry);
		const nubRadius = Math.min(thickness * 0.32, 0.0028);
		nub.scale.set(nubRadius, nubRadius, depth + 0.0012);
		nub.position.z = (depth + 0.0012) / 2;
		return [
			{ mesh: bar, role: 'bar' },
			{ mesh: nub, role: 'nub' }
		];
	}

	/** Blades and hub of a windmill, posed at angle 0 around the hub so the group turns them */
	private rotorParts(piece: TResolvedPiece): TPiecePart[] {
		const depth = piece.params['depth'] ?? 0.03;
		const parts: TPiecePart[] = [];
		for (const shape of rotorLocalShapes(piece.params)) {
			if (shape.kind === 'box') {
				const { box } = shape;
				const blade = new THREE.Mesh(this.boxGeometry(box.halfLength * 2, box.halfThickness * 2, depth * 0.8));
				blade.position.set(box.cx, box.cy, depth * 0.4);
				blade.rotation.z = box.angle;
				parts.push({ mesh: blade, role: 'bar' });
			} else if (shape.kind === 'ball') {
				const hub = new THREE.Mesh(this.nubGeometry);
				hub.scale.set(shape.radius, shape.radius, depth);
				hub.position.set(shape.center.x, shape.center.y, depth / 2);
				parts.push({ mesh: hub, role: 'nub' });
			}
		}
		return parts;
	}

	private pieceMaterial(type: string, part: TPiecePart['role'], colors?: { bar: string; nub: string }): THREE.Material {
		const key = colors != null ? `piece:${colors.bar}:${colors.nub}:${part}` : `piece:${type}:${part}`;
		let material = this.materials.get(key);
		if (material == null) {
			const palette = colors ?? piecePalette[type] ?? piecePalette['platform'];
			const color = (part === 'nub' ? palette?.nub : palette?.bar) ?? '#888888';
			// A Tunnel's tube is clear, with both its sides showing
			material = part === 'shell' ? new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }) : new THREE.MeshLambertMaterial({ color });
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

/** Flat toy colors per piece type: the body and a darker shade for brackets, hubs and outlines */
export const piecePalette: Record<string, { bar: string; nub: string }> = {
	platform: { bar: '#f2845c', nub: '#c4603d' },
	rail: { bar: '#3c9ee0', nub: '#2373ad' },
	tunnel: { bar: '#9a7bf0', nub: '#6c4fd0' },
	windmill: { bar: '#4fb879', nub: '#2f8a52' },
	// Clear wires: pale steel
	bowl: { bar: '#8fa3b8', nub: '#5f7287' }
};

/** Blender world to scene: a quarter turn around x, so Blender's y (into the wall) becomes -z */
const blenderToScene = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const filmRotation = new THREE.Quaternion();
const orbitTarget = new THREE.Vector3();

export function paletteOf(type: string): { bar: string; nub: string } {
	return piecePalette[type] ?? (piecePalette['platform'] as { bar: string; nub: string });
}

interface TPiecePart {
	mesh: THREE.Mesh;
	role: 'bar' | 'nub' | 'shell';
}

interface TPieceObject {
	group: THREE.Group;
	parts: TPiecePart[];
	geometryKey: string;
	/** The piece `geometryKey` was last checked against */
	keySource?: TResolvedPiece;
	/** The palette its parts wear; the same palette is the same object, see `trackPieceColors` */
	colors?: { bar: string; nub: string } | undefined;
	/** A path piece: what its meshes were built from, and that it alone holds them */
	pathSource?: TResolvedPiece;
	pathZ?: number;
	ownsGeometry?: boolean;
}

function disposeOwned(object: TPieceObject): void {
	if (object.ownsGeometry !== true) return;
	for (const part of object.parts) part.mesh.geometry.dispose();
	object.parts = [];
	object.ownsGeometry = false;
}

/** How strong the holes stay in each smaller mip level: they fade out with distance and at grazing angles instead of shimmering */
const PEG_MIP_FADES = [1, 1, 1, 1, 0.7, 0.35, 0.1, 0, 0];

/** Pegboard holes for the wall, one hole per texture repeat, sharp up close and fading with distance through its mip levels */
function createPegTexture(look: TWallLook = { color: '#efeae1', holes: null }): THREE.Texture {
	const size = 256;
	const levels = PEG_MIP_FADES.map((fade, level) => {
		const side = size >> level;
		const canvas = document.createElement('canvas');
		canvas.width = side;
		canvas.height = side;
		const context = canvas.getContext('2d');
		if (context != null) {
			context.fillStyle = look.color;
			context.fillRect(0, 0, side, side);
			if (look.holes != null && fade > 0) {
				context.globalAlpha = fade;
				context.fillStyle = look.holes;
				context.beginPath();
				context.arc(side / 2, side / 2, side * (look.holeRadius ?? 0.09), 0, Math.PI * 2);
				context.fill();
			}
		}
		return canvas;
	});
	const texture = new THREE.CanvasTexture(levels[0] as HTMLCanvasElement);
	texture.mipmaps = levels;
	texture.generateMipmaps = false;
	texture.minFilter = THREE.LinearMipmapLinearFilter;
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 4;
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
 * color and later points a lighter mix with the canvas, so overlapping joins stay opaque.
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
