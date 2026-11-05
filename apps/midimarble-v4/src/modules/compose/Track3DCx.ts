import { createState } from 'feature-state';
import { draftWall } from '@/modules/design/draft-look';
import { pickPiece, pieceScreenOutline } from '@/modules/design/draft-outline';
import { trackPieceColors } from '@/modules/design/label-colors';
import type { TVec2 } from '@/modules/project';
import type { TResolvedPiece } from '@/modules/simulation';
import { pathDepth } from '@/modules/simulation/pieces';
import { createCameraPose, sampleCameraTrack } from '@/modules/camera';
import { FilmCameraCache } from '@/modules/design/film-camera';
import type { ComposeCx } from './ComposeCx';
import { ComposeRenderer, MARBLE_Z } from './ComposeRenderer';
import { WALL_KEY } from '@/modules/studio/selection';
import { marblePositionAt, pieceAngleAt } from './scene';

/** The field of view of the free look, wide enough for depth to read */
const ORBIT_FOV = 30;
/** The field of view the 2D view eases to: near enough to flat that the change doesn't show */
const FLAT_FOV = 1.5;
const EASE_SECONDS = 0.38;
/** How far the view turns; past this the wall would hide everything */
export const MAX_ORBIT = (75 / 180) * Math.PI;

/** Pixels around the film frame in the Camera view */
const FRAME_INSET = 40;

/**
 * Track's 3D and Camera views, like Blender's viewport and its Camera view: their own canvas over the flat one. 3D stands
 * on the same center and scale of `compose.$camera`, so wheel, pinch and the zoom commands move both; Camera looks through
 * the film's camera, with the frame's edge marked. The Pegboard look whatever the project's theme, pieces and marbles in
 * their label colors. They look and select; nothing drags here.
 */
export class Track3DCx {
	/** Bumps after every draw, so the overlay's outlines reproject */
	readonly $frame = createState(0);
	/** 0 flat to 1 fully in 3D */
	readonly $amount = createState(0);
	private renderer: ComposeRenderer | null = null;
	private animation: number | null = null;
	private pathZ = MARBLE_Z;
	private size = { width: 1, height: 1 };
	private view: 'orbit' | 'camera' = 'orbit';
	private wallColor: string | undefined;
	private readonly cameras = new FilmCameraCache();
	private readonly scratchPose = createCameraPose();
	/** The film frame in the Camera view, in CSS pixels; null in 3D */
	filmFrame: { x: number; y: number; width: number; height: number } | null = null;

	constructor(readonly compose: ComposeCx) {}

	mount(container: HTMLElement, canvas: HTMLCanvasElement): () => void {
		const renderer = new ComposeRenderer(canvas);
		this.renderer = renderer;
		renderer.setSolidLight();
		this.paintWall(renderer);
		const observer = new ResizeObserver(() => {
			const rect = container.getBoundingClientRect();
			this.size = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
			renderer.setViewport(this.size, Math.min(window.devicePixelRatio || 1, 3));
			this.draw();
		});
		observer.observe(container);
		const studio = this.compose.studio;
		const cleanups = [
			studio.$history.listen(() => this.draw()),
			studio.simulation.$result.listen(() => this.draw()),
			studio.$playhead.listen(() => this.draw()),
			studio.$hidden.listen(() => this.draw()),
			studio.$trackAngles.listen(() => this.draw()),
			studio.design.$orbit.listen(() => this.draw()),
			this.compose.$camera.listen(() => this.draw()),
			this.$amount.listen(() => this.draw())
		];
		this.draw();
		return () => {
			observer.disconnect();
			for (const cleanup of cleanups) cleanup();
			if (this.animation != null) cancelAnimationFrame(this.animation);
			this.animation = null;
			renderer.dispose();
			this.renderer = null;
		};
	}

	/** Eases the view toward 3D or flat, and calls `onDone` when it arrives */
	easeTo(target: 0 | 1, onDone?: () => void): void {
		if (this.animation != null) cancelAnimationFrame(this.animation);
		const start = this.$amount.get();
		const startedAt = performance.now();
		const step = (now: number): void => {
			const share = Math.min(1, (now - startedAt) / 1000 / EASE_SECONDS);
			this.$amount.set(start + (target - start) * easeInOut(share));
			if (share < 1) {
				this.animation = requestAnimationFrame(step);
				return;
			}
			this.animation = null;
			onDone?.();
		};
		this.animation = requestAnimationFrame(step);
	}

	/** Which view it draws; when going back to 2D it keeps the last so the ease has something to leave */
	setView(view: 'orbit' | 'camera'): void {
		this.view = view;
		this.draw();
	}

	turn(dx: number, dy: number): void {
		const angles = this.compose.studio.$trackAngles.get();
		this.compose.studio.$trackAngles.set({
			yaw: clamp(angles.yaw - dx * TURN_PER_PIXEL, MAX_ORBIT),
			pitch: clamp(angles.pitch + dy * TURN_PER_PIXEL, MAX_ORBIT)
		});
	}

	/** Pans so the wall follows the pointer, which takes a longer way on a wall seen at an angle */
	pan(dx: number, dy: number): void {
		const { yaw, pitch } = this.compose.studio.$trackAngles.get();
		this.compose.panView(dx / Math.max(0.3, Math.cos(yaw)), dy / Math.max(0.3, Math.cos(pitch)));
	}

	toScreen(point: TVec2, z: number): TVec2 {
		return this.renderer?.project(point, z) ?? { x: Number.NaN, y: Number.NaN };
	}

	pieces(): TResolvedPiece[] {
		const hidden = this.compose.studio.$hidden.get();
		return (this.compose.studio.simulation.$result.get()?.pieces ?? []).filter((piece) => !hidden.includes(piece.entityId));
	}

	outline(piece: TResolvedPiece): TVec2[] {
		return pieceScreenOutline(piece, (point, z) => this.toScreen(point, z), this.pathZ);
	}

	pick(point: TVec2): string | null {
		return pickPiece(this.pieces(), point, (at, z) => this.toScreen(at, z), this.pathZ);
	}

	/** The plain Pegboard wall in the Wall layer's color */
	private paintWall(renderer: ComposeRenderer): void {
		const wallColor = this.compose.studio.project?.design.wall.labelColor;
		renderer.setWallLook(draftWall('pegboard', wallColor != null ? { wallColor } : {}));
		this.wallColor = wallColor;
	}

	private draw(): void {
		const renderer = this.renderer;
		const studio = this.compose.studio;
		const project = studio.project;
		if (renderer == null || project == null) return;
		if (project.design.wall.labelColor !== this.wallColor) this.paintWall(renderer);
		const pieces = this.pieces();
		const playhead = studio.$playhead.get();
		const radius = project.entities.find((entity) => entity.components.marble != null)?.components.marble?.radius ?? 0.012;
		this.pathZ = pathDepth(pieces, radius);
		const result = studio.simulation.$result.get();
		const view = this.compose.$camera.get().view;
		const filmTrack = this.view === 'camera' && result != null ? this.cameras.at(project, result, studio.design.$orbit.get()).track : null;
		const pose = filmTrack != null ? sampleCameraTrack(filmTrack, playhead, this.scratchPose) : null;
		if (pose != null) {
			const aspect = project.frame.width / project.frame.height;
			const height = Math.max(1, Math.min(this.size.height - FRAME_INSET * 2, (this.size.width - FRAME_INSET * 2) / aspect));
			const width = height * aspect;
			this.filmFrame = { x: (this.size.width - width) / 2, y: (this.size.height - height) / 2, width, height };
			renderer.setCamera({ mode: 'camera', view });
			renderer.setFilm({ pose, aspect, frame: this.filmFrame });
		} else {
			const amount = this.$amount.get();
			const { yaw, pitch } = studio.$trackAngles.get();
			this.filmFrame = null;
			renderer.setOrbit({ yaw: yaw * amount, pitch: pitch * amount, fov: FLAT_FOV + (ORBIT_FOV - FLAT_FOV) * amount, z: this.pathZ });
			renderer.setCamera({ mode: 'orbit', view });
		}
		renderer.setPieces(
			pieces.map((piece) => ({
				piece,
				angle: pieceAngleAt(piece, playhead),
				colors: trackPieceColors(project, piece.entityId, piece.type),
				pathZ: this.pathZ,
				hasSolidPaths: true
			}))
		);
		const hidden = studio.$hidden.get();
		renderer.setWallHidden(hidden.includes(WALL_KEY));
		renderer.setMarbles(
			project.entities.flatMap((entity) => {
				const { marble, release } = entity.components;
				if (marble == null || release == null || hidden.includes(entity.id)) return [];
				const color = project.music.lanes.find((lane) => lane.id === marble.laneId)?.color ?? '#3478f6';
				const motion = result?.marbles.find((item) => item.entityId === entity.id);
				return [{ entityId: entity.id, color, radius: marble.radius, position: marblePositionAt(motion, playhead, release.position), z: this.pathZ }];
			})
		);
		renderer.render();
		this.$frame.set((value) => value + 1);
	}
}

const TURN_PER_PIXEL = 0.005;

function clamp(value: number, limit: number): number {
	return Math.max(-limit, Math.min(limit, value));
}

function easeInOut(share: number): number {
	return share < 0.5 ? 4 * share ** 3 : 1 - (-2 * share + 2) ** 3 / 2;
}
