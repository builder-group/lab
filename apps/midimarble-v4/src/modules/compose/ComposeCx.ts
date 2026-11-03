import { createState } from 'feature-state';
import type React from 'react';
import * as THREE from 'three';
import { openContextMenu } from '@/components';
import { isEditingTarget } from '@/lib';
import { createCameraPose, followCameraTrack, sampleCameraTrack, verticalFov, type TCameraTrack } from '@/modules/camera';
import { renderFps } from '@/modules/design/DesignCx';
import type { TEntity, TPathNode, TProject, TVec2 } from '@/modules/project';
import {
	findLongGaps,
	frameBand,
	gravityOf,
	layoutOf,
	resolvePieceParams,
	resolvePiecePath,
	trajectoryAt,
	type THitResult,
	type TResolvedPiece,
	type TSimulationResult
} from '@/modules/simulation';
import { parseHitKey } from '@/modules/studio/selection';
import type { StudioCx } from '@/modules/studio/StudioCx';
import { dragRotation, normalizeSurfaceAngle, screenAngle, snapAngle, toRadians, type TRotationDrag } from './angles';
import { AssistCx } from './AssistCx';
import {
	ANCHOR_LEAD,
	asAnchored,
	canLink,
	createFreePiece,
	displayPiece,
	piecePose,
	railPath,
	rotateResolved,
	withEntity,
	withSnap,
	type TPose,
	type TSnap
} from './attach-edit';
import { rebaseNodes, withNodeHandle, withNodePoint } from './bezier';
import { ComposeRenderer, MARBLE_Z, type TComposeCamera, type TFilmView } from './ComposeRenderer';
import { composeKeyAction, toolPieceType, type TComposeKeyAction, type TComposeTool } from './keys';
import { dotMenu } from './menus';
import { distanceToSegment, pick, pickTrack, piecesInRect, rectFromPoints, type TPick, type TPickScene, type TScreenTrack } from './picking';
import {
	boundsOfPieces,
	contentBounds,
	marblePositionAt,
	pathHandles,
	pathToLocal,
	pathToWorld,
	pieceAngleAt,
	pieceKind,
	pieceOutline,
	pieceTime,
	rotationGrip,
	trackBuffers,
	withPathBend,
	withPathEnd
} from './scene';
import { commitAtHit, findStepTarget, followerAt, linkedPieces, pieceAngle, pieceAngleCommands, pieceForHit, pinCommands, selectedPieceIds, withPieceAngles, type TStepMode } from './step-loop';
import {
	boundsOf,
	filmFrameRect,
	fitBounds,
	gridLayers,
	isBoundsVisible,
	panBy,
	screenToWorld,
	worldToScreen,
	zoomAt,
	type TBounds,
	type TPadding,
	type TViewport
} from './view';

export type { TComposeTool } from './keys';

/**
 * Owns the Compose canvas: camera, tools, pointer and keyboard interaction and the WebGL renderer. The
 * canvas is open like Figma: every element can be placed anywhere, moved and turned, and a drop decides
 * whether it stays free, links to a hit dot or anchors to a trajectory.
 */
export class ComposeCx {
	readonly $camera = createState<TComposeCamera>({ mode: '2d', view: { center: { x: 0, y: 0.4 }, scale: 900 }, yaw: -0.55, pitch: 0.28 });
	readonly $viewport = createState<TViewport>({ width: 0, height: 0 });
	readonly $tool = createState<TComposeTool>('select');
	readonly $hover = createState<TPick | null>(null);
	readonly $drag = createState<TComposeDrag | null>(null);
	readonly $spaceHeld = createState(false);
	/** Entity whose angle readout is being typed into */
	readonly $editingAngle = createState<string | null>(null);
	/** Rail being drawn with the path tool, in world coordinates */
	readonly $pen = createState<TPen | null>(null);
	/**
	 * Where the dragged or drawn piece is shown before the run catches up, so it follows the pointer every
	 * frame while the what-if trajectory arrives from the worker
	 */
	readonly $override = createState<TResolvedPiece | null>(null);
	readonly assist: AssistCx;
	/**
	 * What the Camera view shows: the film frame on the canvas and the follow camera's pose at the playhead. Null
	 * outside the Camera view; `pose` is null when the film has no follow camera (manual mode or no motion).
	 */
	readonly $film = createState<TFilmState | null>(null);

	private renderer: ComposeRenderer | null = null;
	private container: HTMLElement | null = null;
	private framedProjectId: string | null = null;
	private spacePanned = false;
	private trackCache = new WeakMap<object, { points: Float32Array; times: Float32Array }>();
	/** Keeps the override until the result for the committed edit arrives, so a drop never flickers */
	private settleRevision: number | null = null;
	/** Follow camera baked once per result and camera settings, sampled every frame in the Camera view */
	private filmTrack: { result: TSimulationResult; key: string; track: TCameraTrack | null } | null = null;
	private filmPose = createCameraPose();
	/** View to return to when the Camera view toggles off */
	private editMode: '2d' | 'orbit' = '2d';

	constructor(readonly studio: StudioCx) {
		this.assist = new AssistCx(studio);
	}

	get project(): TProject | null {
		return this.studio.project;
	}

	get result(): TSimulationResult | null {
		return this.studio.simulation.$result.get();
	}

	// MARK: - Lifecycle

	mount(container: HTMLElement, canvas: HTMLCanvasElement): () => void {
		const renderer = new ComposeRenderer(canvas);
		this.renderer = renderer;
		this.container = container;
		const cleanups: (() => void)[] = [];

		const scheme = window.matchMedia('(prefers-color-scheme: dark)');
		const applyTheme = (): void => {
			const style = getComputedStyle(container);
			const canvasColor = style.getPropertyValue('--canvas').trim() || '#f2f1ee';
			const guide = new THREE.Color(canvasColor).lerp(new THREE.Color(scheme.matches ? '#ffffff' : '#000000'), 0.13);
			renderer.setTheme({ canvas: canvasColor, guide: `#${guide.getHexString()}` });
		};
		applyTheme();
		scheme.addEventListener('change', applyTheme);
		cleanups.push(() => scheme.removeEventListener('change', applyTheme));

		cleanups.push(this.assist.mount());

		const observer = new ResizeObserver(() => {
			const rect = container.getBoundingClientRect();
			const viewport = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
			renderer.setViewport(viewport, Math.min(window.devicePixelRatio || 1, 3));
			this.$viewport.set(viewport);
			this.frameIfNeeded();
		});
		observer.observe(container);
		cleanups.push(() => observer.disconnect());

		const updateGrid = (): void => {
			const camera = this.$camera.get();
			const grid = gridLayers(camera.view, this.$viewport.get());
			container.style.setProperty('--grid', `${grid.size}px`);
			container.style.setProperty('--grid-x', `${grid.offset.x}px`);
			container.style.setProperty('--grid-y', `${grid.offset.y}px`);
			container.style.setProperty('--grid-fine', `${grid.fineSize}px`);
			container.style.setProperty('--grid-fine-x', `${grid.fineOffset.x}px`);
			container.style.setProperty('--grid-fine-y', `${grid.fineOffset.y}px`);
			container.style.setProperty('--grid-fine-alpha', `${grid.fineAlpha}`);
			container.dataset['mode'] = camera.mode;
		};
		cleanups.push(
			this.$camera.subscribe(({ value }) => {
				renderer.setCamera(value);
				updateGrid();
				this.screenTracks = null;
				this.syncFilm();
			}),
			this.$viewport.listen(() => {
				this.screenTracks = null;
				this.syncFilm();
			}),
			this.$viewport.listen(updateGrid),
			this.studio.simulation.$result.subscribe(({ value }) => {
				this.screenTracks = null;
				if (this.settleRevision != null && value != null && value.revision >= this.settleRevision) {
					this.settleRevision = null;
					this.$override.set(null);
				}
				this.syncTracks();
				this.syncPieces();
				this.syncMarbles();
				this.syncGuides();
				this.syncFilm();
				this.frameIfNeeded();
				this.revealPlaced();
			}),
			this.$override.listen(() => this.syncPieces()),
			this.studio.$hidden.listen(() => this.syncPieces()),
			this.studio.$playhead.subscribe(({ value }) => {
				// The film camera moves first, so the overlays drawn for this playhead project through its new pose
				this.syncFilm();
				renderer.setPlayhead(value);
				this.syncPieces();
				this.syncMarbles();
				this.followPlayback();
			}),
			this.studio.$history.listen(() => {
				// Release positions show immediately, before the new result arrives
				this.syncMarbles();
				this.syncGuides();
			}),
			this.studio.$selection.listen(({ value }) => {
				this.syncPieces();
				this.followSelection(value);
			}),
			this.studio.$reveal.listen(({ value }) => {
				if (value != null) this.revealPending();
			}),
			// Switching tools finishes a rail in progress, like Figma's pen
			this.$tool.listen(({ value }) => {
				if (value !== 'path' && this.$pen.get() != null) this.finishPen();
			})
		);

		const onWheel = (event: WheelEvent): void => this.onWheel(event, container);
		container.addEventListener('wheel', onWheel, { passive: false });
		cleanups.push(() => container.removeEventListener('wheel', onWheel));

		// Capture runs before the studio's window shortcuts, which skip events handled here
		const onKeyDown = (event: KeyboardEvent): void => this.onKeyDown(event);
		const onKeyUp = (event: KeyboardEvent): void => this.onKeyUp(event);
		window.addEventListener('keydown', onKeyDown, true);
		window.addEventListener('keyup', onKeyUp, true);
		cleanups.push(() => {
			window.removeEventListener('keydown', onKeyDown, true);
			window.removeEventListener('keyup', onKeyUp, true);
		});

		this.studio.$compose.set(this);
		cleanups.push(() => {
			if (this.studio.$compose.get() === this) this.studio.$compose.set(null);
		});

		return () => {
			for (const cleanup of cleanups) cleanup();
			this.studio.simulation.endPreview();
			renderer.dispose();
			this.renderer = null;
			this.container = null;
		};
	}

	// MARK: - Projection

	/** CSS pixel position inside the canvas of a wall point at depth `z` */
	toScreen(point: TVec2, z = MARBLE_Z): TVec2 {
		const renderer = this.renderer;
		if (renderer == null) return point;
		return renderer.project(point, z);
	}

	/** Wall point under a canvas pixel in the 2D view */
	toWorld(point: TVec2): TVec2 {
		return screenToWorld(this.$camera.get().view, this.$viewport.get(), point);
	}

	/** Pieces as the canvas shows them: the run's poses with the dragged piece where the pointer holds it */
	displayPieces(result: TSimulationResult | null = this.result): TResolvedPiece[] {
		const override = this.$override.get();
		const hidden = this.studio.$hidden.get();
		const pieces = (result?.pieces ?? []).filter((piece) => !hidden.includes(piece.entityId));
		if (override == null) return pieces;
		const index = pieces.findIndex((piece) => piece.entityId === override.entityId);
		if (index < 0) return [...pieces, override];
		return pieces.map((piece, i) => (i === index ? override : piece));
	}

	/** Grip and pivot of the selected piece's rotation handle in screen space */
	screenGrip(piece: TResolvedPiece): { pivot: TVec2; grip: TVec2 } {
		const { pivot, grip } = rotationGrip(piece);
		const depth = piece.params['depth'] ?? 0.03;
		const screenPivot = this.toScreen(pivot, depth);
		const screenEnd = this.toScreen(grip, depth);
		const dx = screenEnd.x - screenPivot.x;
		const dy = screenEnd.y - screenPivot.y;
		const length = Math.hypot(dx, dy) || 1;
		// The grip sits just past the end of the bar so it never covers the bar itself
		return { pivot: screenPivot, grip: { x: screenEnd.x + (dx / length) * 14, y: screenEnd.y + (dy / length) * 14 } };
	}

	/** Outline of a piece in screen space, see `pieceOutline` */
	screenOutline(piece: TResolvedPiece): TVec2[] {
		const depth = piece.params['depth'] ?? 0.03;
		return pieceOutline(piece).map((corner) => this.toScreen(corner, depth));
	}

	/** End and bend handles of a selected rail or tunnel without drawn nodes, in screen space */
	screenPathHandles(piece: TResolvedPiece): { end: TVec2; bend: TVec2; entry: TVec2 } | null {
		const controls = this.pathControls(piece.entityId);
		const handles = controls != null ? pathHandles(controls) : null;
		if (controls == null || handles == null) return null;
		const toScreen = (point: TVec2): TVec2 => this.toScreen(pathToWorld(piece, controls, point));
		return { end: toScreen(handles.end), bend: toScreen(handles.bend), entry: toScreen({ x: 0, y: 0 }) };
	}

	/** Local control points of a rail or tunnel, from the drag in progress or the project */
	pathControls(entityId: string): TVec2[] | null {
		const drag = this.$drag.get();
		if (drag?.kind === 'path' && drag.entityId === entityId) return drag.points;
		const piece = this.project?.entities.find((entity) => entity.id === entityId)?.components;
		if (piece?.piece == null) return null;
		const kind = layoutOf(piece.piece.type);
		if (kind !== 'path' && kind !== 'tube') return null;
		return resolvePiecePath(piece.piece.type, piece.path?.points);
	}

	/**
	 * Bézier nodes of a drawn rail with the frame that maps them to the wall, from the node drag in progress
	 * or the run. Null for rails without nodes and for rails whose origin follows the marble without an offset.
	 */
	railFrame(entityId: string): { nodes: TPathNode[]; base: TPose } | null {
		const drag = this.$drag.get();
		if (drag?.kind === 'node' && drag.entityId === entityId) return { nodes: drag.nodes, base: drag.base };
		const entity = this.project?.entities.find((item) => item.id === entityId);
		const nodes = entity?.components.path?.nodes;
		const link = entity?.components.hitLink;
		if (entity == null || nodes == null || (link != null && link.offset == null)) return null;
		const resolved = this.displayPieces().find((piece) => piece.entityId === entityId);
		if (resolved == null) return null;
		return { nodes, base: { position: resolved.position, angle: resolved.angle } };
	}

	/** Maps a node's local point to the canvas through a rail frame */
	frameToScreen(base: TPose, point: TVec2): TVec2 {
		const cos = Math.cos(base.angle);
		const sin = Math.sin(base.angle);
		return this.toScreen({ x: base.position.x + point.x * cos - point.y * sin, y: base.position.y + point.x * sin + point.y * cos });
	}

	pickScene(): TPickScene {
		const project = this.project;
		const result = this.result;
		const scene: TPickScene = { handles: [], dots: [], pieces: [] };
		if (project == null || result == null) return scene;
		const is2d = this.$camera.get().mode === '2d';
		const hidden = this.studio.$hidden.get();
		const locked = this.studio.$locked.get();
		const selected = selectedPieceIds(project, this.studio.$selection.get()).filter((id) => !locked.includes(id));
		const pieces = this.displayPieces(result);
		for (const piece of pieces) {
			if (!locked.includes(piece.entityId)) scene.pieces.push({ entityId: piece.entityId, corners: this.screenOutline(piece) });
		}
		if (this.$camera.get().mode === 'camera') return scene;
		for (const hit of result.hits) {
			if (hit.status === 'open' && hit.dot != null) {
				scene.dots.push({ laneId: hit.laneId, hitId: hit.hitId, position: this.toScreen(hit.dot) });
			}
		}
		if (!is2d) return scene;
		for (const entity of project.entities) {
			const release = entity.components.release;
			if (release == null || entity.components.marble == null || hidden.includes(entity.id) || locked.includes(entity.id)) continue;
			scene.handles.push({ kind: 'release', entityId: entity.id, position: this.toScreen(release.position), radius: 9 });
		}
		const single = selected.length === 1 ? pieces.find((piece) => piece.entityId === selected[0]) : undefined;
		const kind = single != null ? pieceKind(single) : null;
		const frame = single != null ? this.railFrame(single.entityId) : null;
		if (single != null && frame != null) {
			frame.nodes.forEach((node, index) => {
				const add = (handle: 'in' | 'out'): void => {
					const offset = node[handle];
					if (offset == null || Math.hypot(offset.x, offset.y) < 1e-9) return;
					const position = this.frameToScreen(frame.base, { x: node.point.x + offset.x, y: node.point.y + offset.y });
					scene.handles.push({ kind: handle === 'in' ? 'nodeIn' : 'nodeOut', entityId: single.entityId, index, position, radius: 4 });
				};
				add('in');
				add('out');
				scene.handles.push({ kind: 'node', entityId: single.entityId, index, position: this.frameToScreen(frame.base, node.point), radius: 5 });
			});
		} else if (single != null && (kind === 'path' || kind === 'tube')) {
			const handles = this.screenPathHandles(single);
			if (handles != null) {
				scene.handles.push({ kind: 'pathBend', entityId: single.entityId, position: handles.bend, radius: 5 });
				scene.handles.push({ kind: 'pathEnd', entityId: single.entityId, position: handles.end, radius: 6 });
			}
		} else if (single != null && (kind === 'box' || kind === 'rotor')) {
			scene.handles.push({ kind: 'rotate', entityId: single.entityId, position: this.screenGrip(single).grip, radius: 6 });
		}
		return scene;
	}

	// MARK: - Navigation

	zoomBy(factor: number, anchor?: TVec2): void {
		const viewport = this.$viewport.get();
		const point = anchor ?? { x: viewport.width / 2, y: viewport.height / 2 };
		this.$camera.set((camera) => ({ ...camera, view: zoomAt(camera.view, viewport, point, factor) }));
	}

	fitAll(): void {
		const project = this.project;
		if (project == null) return;
		this.fit(contentBounds(project, this.result));
	}

	/**
	 * Zooms to the width of the film frame and centres the focused marble at the playhead. This is the
	 * working view: pieces read at their real size, like the camera of the finished film.
	 */
	fitFrame(): void {
		const project = this.project;
		const viewport = this.$viewport.get();
		if (project == null || viewport.width <= 1) return;
		const band = frameBand(project);
		const focus = this.marbleFocus() ?? { x: band.centerX, y: 0 };
		const halfWidth = band.halfWidth * 1.35;
		this.fit({ minX: band.centerX - halfWidth, maxX: band.centerX + halfWidth, minY: focus.y - 0.02, maxY: focus.y + 0.02 });
		// The marble sits in the upper third so the path ahead stays visible, like the film camera
		this.$camera.set((camera) => ({
			...camera,
			view: { ...camera.view, center: { x: band.centerX, y: focus.y - (viewport.height * 0.18) / camera.view.scale } }
		}));
	}

	/** Position of the selected or first marble at the playhead, or its release before it starts */
	private marbleFocus(): TVec2 | null {
		const project = this.project;
		if (project == null) return null;
		const selected = this.studio.$selection.get();
		const marbles = project.entities.filter((entity) => entity.components.marble != null);
		const marble = marbles.find((entity) => selected.includes(entity.id)) ?? marbles[0];
		if (marble == null) return null;
		const track = this.result?.marbles.find((item) => item.entityId === marble.id);
		const at = track == null ? null : trajectoryAt(track.samples, this.studio.$playhead.get(), gravityOf(project));
		return at?.position ?? marble.components.release?.position ?? null;
	}

	/** While playing, keeps the marble inside the middle of the canvas by panning vertically */
	private followPlayback(): void {
		const camera = this.$camera.get();
		const viewport = this.$viewport.get();
		if (!this.studio.$playing.get() || camera.mode !== '2d' || viewport.height <= 1) return;
		const focus = this.marbleFocus();
		if (focus == null) return;
		const screen = worldToScreen(camera.view, viewport, focus);
		if (screen.y > viewport.height * 0.2 && screen.y < viewport.height * 0.6) return;
		const centerY = focus.y - (viewport.height * 0.18) / camera.view.scale;
		this.$camera.set({ ...camera, view: { ...camera.view, center: { x: camera.view.center.x, y: centerY } } });
	}

	fitSelection(): void {
		const project = this.project;
		const result = this.result;
		if (project == null || result == null) return;
		const selection = this.studio.$selection.get();
		const pieces = result.pieces.filter((piece) => selection.includes(piece.entityId));
		const points: TVec2[] = pieces.flatMap(pieceOutline);
		for (const key of selection) {
			const parsed = parseHitKey(key);
			const dot = result.hits.find((hit) => hit.laneId === parsed?.laneId && hit.hitId === parsed.hitId)?.dot;
			if (dot != null) points.push(dot);
			const entity = project.entities.find((item) => item.id === key);
			const release = entity?.components.release;
			if (release != null) points.push(release.position);
			// A piece placed a moment ago may not be in the result yet, but its hit dot is
			const link = entity?.components.hitLink;
			const linkDot = result.hits.find((hit) => hit.laneId === link?.laneId && hit.hitId === link.hitId)?.dot;
			if (linkDot != null) points.push(linkDot);
		}
		const bounds = boundsOf(points);
		if (bounds == null) {
			this.fitAll();
			return;
		}
		// Single points get some room around them instead of filling the screen
		const margin = 0.15;
		this.fit({ minX: bounds.minX - margin, minY: bounds.minY - margin, maxX: bounds.maxX + margin, maxY: bounds.maxY + margin });
	}

	setMode(mode: TComposeCamera['mode']): void {
		if (mode !== 'camera') this.editMode = mode;
		else if (this.$pen.get() != null) this.finishPen();
		this.$drag.set(null);
		this.$camera.set((camera) => ({ ...camera, mode }));
		this.$hover.set(null);
		this.syncPieces();
	}

	/** 0 and Numpad 0 like Blender: into the Camera view, and back to the view it came from */
	toggleCameraView(): void {
		this.setMode(this.$camera.get().mode === 'camera' ? this.editMode : 'camera');
	}

	/** CSS pixels per wall metre around the followed point, for strokes drawn at wall size */
	screenScale(): number {
		const camera = this.$camera.get();
		const film = this.$film.get();
		if (camera.mode !== 'camera' || film?.pose == null) return camera.view.scale;
		const halfFrame = Math.tan((verticalFov(film.pose.lens, film.aspect) * Math.PI) / 360);
		return film.frame.height / 2 / (halfFrame * Math.max(film.pose.focus, 1e-3));
	}

	/** Follow camera of the current run at the film's frame rate, baked once per result and camera settings */
	cameraTrack(): TCameraTrack | null {
		const project = this.project;
		const result = this.result;
		if (project == null || result == null) return null;
		const fps = renderFps(project);
		const key = `${fps}:${JSON.stringify(project.design.camera)}:${project.frame.width}x${project.frame.height}:${project.design.loop}`;
		if (this.filmTrack?.result !== result || this.filmTrack.key !== key) {
			this.filmTrack = { result, key, track: followCameraTrack(project, result, fps) };
		}
		return this.filmTrack.track;
	}

	/** Moves the film camera to the playhead while the Camera view shows */
	private syncFilm(): void {
		const renderer = this.renderer;
		const project = this.project;
		if (renderer == null) return;
		if (this.$camera.get().mode !== 'camera' || project == null) {
			if (this.$film.get() != null) {
				this.$film.set(null);
				renderer.setFilm(null);
			}
			return;
		}
		const aspect = project.frame.width / project.frame.height;
		const frame = filmFrameRect(this.$viewport.get(), aspect);
		const track = this.cameraTrack();
		if (track == null) {
			this.$film.set({ pose: null, aspect, frame });
			renderer.setFilm(null);
			return;
		}
		const film: TFilmView = { pose: sampleCameraTrack(track, this.studio.$playhead.get(), this.filmPose), aspect, frame };
		renderer.setFilm(film);
		this.$film.set(film);
	}

	private fit(bounds: TBounds): void {
		const viewport = this.$viewport.get();
		if (viewport.width <= 1) return;
		this.$camera.set((camera) => ({ ...camera, view: fitBounds(bounds, viewport, canvasPadding) }));
	}

	/** Frames the run once per opened project, as soon as there is something to show */
	private frameIfNeeded(): void {
		const project = this.project;
		if (project == null || this.framedProjectId === project.id || this.result == null || this.$viewport.get().width <= 1) return;
		this.framedProjectId = project.id;
		this.fitFrame();
		// A reveal sent while Compose was not mounted, such as from the export preflight in Design
		this.revealPending();
	}

	/** Handles the studio's pending reveal once the canvas can frame it */
	private revealPending(): void {
		const pending = this.studio.$reveal.get();
		if (pending == null || this.result == null || this.$viewport.get().width <= 1) return;
		this.studio.$reveal.set(null);
		this.reveal(pending.ids, pending.point);
	}

	/**
	 * Pans to pieces, hit dots and a point that are out of view, keeping the zoom unless they do not fit.
	 * Hit keys reveal their dot.
	 */
	private reveal(ids: string[], point?: TVec2): void {
		const result = this.result;
		if (result == null) return;
		const points: TVec2[] = point != null ? [point] : [];
		for (const id of ids) {
			const key = parseHitKey(id);
			const dot = key != null ? result.hits.find((hit) => hit.laneId === key.laneId && hit.hitId === key.hitId)?.dot : null;
			if (dot != null) points.push(dot);
			const release = this.project?.entities.find((entity) => entity.id === id)?.components.release;
			if (release != null) points.push(release.position);
		}
		const margin = 0.03;
		const bounds = [
			boundsOfPieces(result.pieces.filter((piece) => ids.includes(piece.entityId))),
			...points.map((item) => ({ minX: item.x - margin, minY: item.y - margin, maxX: item.x + margin, maxY: item.y + margin }))
		].reduce<TBounds | null>(
			(union, item) =>
				item == null
					? union
					: union == null
						? item
						: { minX: Math.min(union.minX, item.minX), minY: Math.min(union.minY, item.minY), maxX: Math.max(union.maxX, item.maxX), maxY: Math.max(union.maxY, item.maxY) },
			null
		);
		if (bounds == null) return;
		const viewport = this.$viewport.get();
		const camera = this.$camera.get();
		if (camera.mode === '2d' && isBoundsVisible(camera.view, viewport, bounds, 40)) return;
		const fitted = fitBounds(bounds, viewport, canvasPadding);
		this.$camera.set({
			...camera,
			view: fitted.scale < camera.view.scale ? fitted : { scale: camera.view.scale, center: fitted.center }
		});
	}

	private onWheel(event: WheelEvent, container: HTMLElement): void {
		event.preventDefault();
		// The Camera view looks through the film camera, which only the playhead moves
		if (this.$camera.get().mode === 'camera') return;
		const rect = container.getBoundingClientRect();
		const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
		// Line-based wheels report rows instead of pixels
		const unit = event.deltaMode === 1 ? 16 : 1;
		if (event.ctrlKey || event.metaKey) {
			// Pinch arrives as ctrl-wheel with small deltas; ⌘-scroll from a mouse wheel moves in larger steps
			const factor = Math.exp(-event.deltaY * unit * (event.ctrlKey ? 0.01 : 0.003));
			this.zoomBy(factor, anchor);
			return;
		}
		const dx = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
		const dy = event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY;
		this.$camera.set((camera) => ({ ...camera, view: panBy(camera.view, -dx * unit, -dy * unit) }));
	}

	// MARK: - Pointer

	onPointerDown(event: React.PointerEvent<HTMLElement>): void {
		const point = localPoint(event);
		const camera = this.$camera.get();
		const tool = this.$tool.get();
		const is2d = camera.mode === '2d';
		if (camera.mode === 'camera') {
			// The Camera view previews: a click selects a piece, nothing moves
			if (event.button === 0) this.selectInFilm(this.pickAt(point), event.shiftKey);
			return;
		}
		const isPan = event.button === 1 || tool === 'hand' || this.$spaceHeld.get() || (!is2d && event.button === 0 && this.pickAt(point) == null);
		if (event.button !== 0 && event.button !== 1) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		this.$editingAngle.set(null);

		if (isPan) {
			// In orbit, dragging turns the camera unless Shift or the hand tool asks for a pan
			const orbit = !is2d && !event.shiftKey && tool !== 'hand' && !this.$spaceHeld.get();
			this.$drag.set({ kind: 'pan', last: point, orbit });
			this.spacePanned = true;
			return;
		}
		const project = this.project;
		if (project == null) return;
		if (tool === 'path' && is2d) {
			this.penDown(point);
			return;
		}

		const target = this.pickAt(point);
		switch (target?.kind) {
			case 'rotate':
				this.startRotate(target.entityId, point);
				return;
			case 'node':
			case 'nodeIn':
			case 'nodeOut':
				this.startNodeDrag(target.entityId, target.index, target.kind === 'node' ? 'point' : target.kind === 'nodeIn' ? 'in' : 'out');
				return;
			case 'pathEnd':
			case 'pathBend': {
				const points = this.pathControls(target.entityId);
				if (points == null) return;
				this.$drag.set({ kind: 'path', entityId: target.entityId, handle: target.kind === 'pathEnd' ? 'end' : 'bend', points, start: points, moved: false });
				return;
			}
			case 'release': {
				const release = project.entities.find((entity) => entity.id === target.entityId)?.components.release;
				if (release == null) return;
				const world = this.toWorld(point);
				const offset = { x: release.position.x - world.x, y: release.position.y - world.y };
				this.$drag.set({ kind: 'release', entityId: target.entityId, offset, position: release.position, moved: false });
				return;
			}
			case 'piece': {
				const selection = this.studio.$selection.get();
				if (event.shiftKey) {
					const has = selection.includes(target.entityId);
					this.studio.$selection.set(has ? selection.filter((id) => id !== target.entityId) : [...selection, target.entityId]);
					this.$drag.set({ kind: 'click', target, start: point });
					return;
				}
				if (!selection.includes(target.entityId)) this.studio.$selection.set([target.entityId]);
				if (is2d) this.startMove(target.entityId, point);
				else this.$drag.set({ kind: 'click', target, start: point });
				return;
			}
			case 'dot':
			case 'track':
				this.$drag.set({ kind: 'click', target, start: point });
				return;
		}
		const type = toolPieceType[tool];
		if (type != null && is2d) {
			this.startPlace(type, point);
			return;
		}
		if (tool === 'select' && is2d) {
			const base = event.shiftKey ? this.studio.$selection.get() : [];
			this.$drag.set({ kind: 'marquee', from: point, to: point, base });
			return;
		}
		this.$drag.set({ kind: 'click', target: null, start: point });
	}

	onPointerMove(event: React.PointerEvent<HTMLElement>): void {
		const point = localPoint(event);
		const drag = this.$drag.get();
		const pen = this.$pen.get();
		if (pen != null && drag == null) {
			this.penMove(point, event.altKey);
			return;
		}
		if (drag == null) {
			const tool = this.$tool.get();
			const hover = this.$spaceHeld.get() || tool === 'hand' || tool === 'path' ? null : this.pickAt(point);
			if (!isSamePick(hover, this.$hover.get())) this.$hover.set(hover);
			return;
		}
		const project = this.project;
		switch (drag.kind) {
			case 'pan': {
				const dx = point.x - drag.last.x;
				const dy = point.y - drag.last.y;
				if (drag.orbit) {
					this.$camera.set((camera) => ({
						...camera,
						yaw: camera.yaw - dx * 0.006,
						pitch: Math.max(-1.2, Math.min(1.2, camera.pitch + dy * 0.006))
					}));
				} else {
					this.$camera.set((camera) => ({ ...camera, view: panBy(camera.view, dx, dy) }));
				}
				this.$drag.set({ ...drag, last: point });
				return;
			}
			case 'rotate':
				this.moveRotate(drag, point, event.shiftKey);
				return;
			case 'move':
				this.moveMove(drag, point, event.altKey, event.shiftKey);
				return;
			case 'place':
				this.movePlace(drag, point, event.shiftKey);
				return;
			case 'node':
				this.moveNode(drag, point, event.altKey);
				return;
			case 'path': {
				const piece = this.result?.pieces.find((item) => item.entityId === drag.entityId);
				if (project == null || piece == null) return;
				const local = pathToLocal(piece, drag.start, this.toWorld(point));
				const points = drag.handle === 'end' ? withPathEnd(drag.start, local) : withPathBend(drag.start, local);
				this.$drag.set({ ...drag, points, moved: true });
				this.studio.simulation.startPreview(withPathPoints(project, drag.entityId, points));
				return;
			}
			case 'release': {
				if (project == null) return;
				const world = this.toWorld(point);
				const position = { x: world.x + drag.offset.x, y: world.y + drag.offset.y };
				this.$drag.set({ ...drag, position, moved: true });
				this.studio.simulation.startPreview(withRelease(project, drag.entityId, position));
				this.syncMarbles();
				return;
			}
			case 'marquee': {
				this.$drag.set({ ...drag, to: point });
				const ids = piecesInRect(rectFromPoints(drag.from, point), this.pickScene().pieces);
				this.studio.$selection.set([...new Set([...drag.base, ...ids])]);
				return;
			}
			case 'click':
				return;
		}
	}

	onPointerUp(event: React.PointerEvent<HTMLElement>): void {
		const point = localPoint(event);
		const drag = this.$drag.get();
		if (this.$pen.get() != null && drag == null) {
			this.penUp();
			return;
		}
		this.$drag.set(null);
		if (drag == null) return;
		const project = this.project;
		switch (drag.kind) {
			case 'pan':
				return;
			case 'rotate': {
				if (project != null) this.commit(pieceAngleCommands(project, new Map([[drag.entityId, drag.angle]])));
				this.studio.simulation.endPreview();
				return;
			}
			case 'move': {
				if (!drag.moved) {
					this.$override.set(null);
					return;
				}
				if (drag.candidate != null) this.commit([{ type: 'upsertEntity', entity: drag.candidate }]);
				this.studio.simulation.endPreview();
				return;
			}
			case 'place': {
				const entity = drag.candidate;
				this.studio.simulation.endPreview();
				if (this.commit([{ type: 'upsertEntity', entity }])) {
					this.studio.$selection.set([entity.id]);
					this.$tool.set('select');
				}
				return;
			}
			case 'node': {
				if (drag.moved && drag.candidate != null) this.commit([{ type: 'upsertEntity', entity: drag.candidate }]);
				else this.$override.set(null);
				this.studio.simulation.endPreview();
				return;
			}
			case 'path': {
				if (drag.moved && project != null) {
					this.studio.execute([{ type: 'setComponent', entityId: drag.entityId, component: { name: 'path', value: { points: drag.points } } }]);
				}
				this.studio.simulation.endPreview();
				return;
			}
			case 'release': {
				const release = project?.entities.find((entity) => entity.id === drag.entityId)?.components.release;
				if (drag.moved && release != null) {
					this.studio.execute([
						{ type: 'setComponent', entityId: drag.entityId, component: { name: 'release', value: { ...release, position: drag.position } } }
					]);
				} else {
					this.studio.$selection.set([drag.entityId]);
				}
				this.studio.simulation.endPreview();
				return;
			}
			case 'marquee': {
				const isClick = Math.hypot(point.x - drag.from.x, point.y - drag.from.y) < 3;
				if (isClick && !drag.base.length) this.studio.$selection.set([]);
				return;
			}
			case 'click': {
				const isClick = Math.hypot(point.x - drag.start.x, point.y - drag.start.y) < 4;
				if (!isClick) return;
				this.onClick(drag.target, point, event.shiftKey);
				return;
			}
		}
	}

	private selectInFilm(target: TPick | null, shiftKey: boolean): void {
		const selection = this.studio.$selection.get();
		if (target?.kind !== 'piece') {
			if (!shiftKey) this.studio.$selection.set([]);
			return;
		}
		const has = selection.includes(target.entityId);
		if (!shiftKey) this.studio.$selection.set([target.entityId]);
		else this.studio.$selection.set(has ? selection.filter((id) => id !== target.entityId) : [...selection, target.entityId]);
	}

	onPointerLeave(): void {
		if (this.$drag.get() == null) this.$hover.set(null);
		const pen = this.$pen.get();
		if (pen != null && !pen.isDragging) this.$pen.set({ ...pen, pointer: null });
	}

	private onClick(target: TPick | null, point: TVec2, shiftKey: boolean): void {
		const tool = this.$tool.get();
		if (target?.kind === 'dot') {
			const { laneId, hitId } = target;
			const hit = this.result?.hits.find((item) => item.laneId === laneId && item.hitId === hitId);
			this.$hover.set(null);
			if (hit == null) return;
			if (tool === 'platform') {
				// The fast path: with the Platform tool a dot gets an auto placed platform right away
				void this.assist.place(hit, 'platform');
				this.$tool.set('select');
			} else if (tool === 'tunnel' || tool === 'windmill') {
				this.addFollower(laneId, hit.targetTime);
			} else {
				this.openInsertMenu(hit, point);
			}
			return;
		}
		if (target?.kind === 'track') {
			this.addFollower(target.laneId, target.time);
			this.$hover.set(null);
			return;
		}
		if (target?.kind === 'piece' && !shiftKey) {
			this.studio.$selection.set([target.entityId]);
			return;
		}
		if (target == null && tool === 'marble') {
			this.studio.addMarble(this.toWorld(point));
			this.$tool.set('select');
			return;
		}
		if (target == null) this.studio.$selection.set([]);
	}

	/** The insert menu of an open hit dot, opened at the dot like a Figma popover */
	openInsertMenu(hit: THitResult, point: TVec2): void {
		const rect = this.container?.getBoundingClientRect();
		const entries = dotMenu(this, hit.laneId, hit.hitId);
		openContextMenu({ clientX: (rect?.left ?? 0) + point.x + 10, clientY: (rect?.top ?? 0) + point.y + 10, preventDefault: () => undefined }, entries);
	}

	/** What a pointer at `point` would act on, in canvas pixels */
	pickAt(point: TVec2): TPick | null {
		const picked = pick(point, this.pickScene());
		if (picked != null || !this.isPathTool()) return picked;
		// Tunnels and windmills can also start anywhere on a trajectory, not only at a hit
		return pickTrack(point, this.screenTrackPoints());
	}

	/** Piece type a click or Next places on a hit: always a platform, the only music piece */
	placementType(): string {
		return 'platform';
	}

	/** True for a scenery tool (tunnel, windmill), which anchors its piece where the trajectory is clicked */
	isPathTool(): boolean {
		const tool = this.$tool.get();
		return tool === 'tunnel' || tool === 'windmill';
	}

	private screenTracks: TScreenTrack[] | null = null;

	/** Trajectory points in screen space, thinned to about one per 8 ms, cached until the view changes */
	screenTrackPoints(): TScreenTrack[] {
		if (this.screenTracks != null) return this.screenTracks;
		const project = this.project;
		const result = this.result;
		this.screenTracks = (result?.marbles ?? []).map((track) => {
			const laneId = project?.entities.find((entity) => entity.id === track.entityId)?.components.marble?.laneId ?? track.laneId;
			const points: TVec2[] = [];
			const times: number[] = [];
			track.samples.forEach((sample, index) => {
				if (index % 2 !== 0) return;
				points.push(this.toScreen(sample.position));
				times.push(sample.time);
			});
			return { laneId, points, times };
		});
		return this.screenTracks;
	}

	/** Adds a scenery piece the marble meets at `time`, chosen by clicking its trajectory or a dot */
	private addFollower(laneId: string, time: number): void {
		const project = this.project;
		const type = toolPieceType[this.$tool.get()] ?? 'windmill';
		const samples = this.result?.marbles.find((track) => track.laneId === laneId)?.samples ?? [];
		const at = project != null ? trajectoryAt(samples, time, gravityOf(project)) : null;
		if (project == null || at == null) return;
		const [isOk, error, entity] = followerAt(project, laneId, type, time, at.position, at.velocity);
		if (!isOk) {
			this.studio.notify(error.message);
			return;
		}
		if (!this.studio.execute([{ type: 'upsertEntity', entity }])) return;
		this.studio.$selection.set([entity.id]);
		this.$tool.set('select');
		if (!this.studio.$playing.get()) this.studio.$playhead.set(time);
	}

	/** True when the hit ends a gap too long for a bounce that no rail or tunnel bridges yet */
	isLongGapDot(laneId: string, hitId: string): boolean {
		const project = this.project;
		if (project == null) return false;
		return this.longGapKeys(project).has(`${laneId}:${hitId}`);
	}

	private longGapCache: { project: TProject; keys: Map<string, { fromHitId: string; duration: number }> } | null = null;

	/** Unbridged long gaps keyed by `laneId:toHitId` */
	longGapKeys(project: TProject): Map<string, { fromHitId: string; duration: number }> {
		if (this.longGapCache?.project === project) return this.longGapCache.keys;
		const keys = new Map<string, { fromHitId: string; duration: number }>();
		for (const lane of project.music.lanes) {
			for (const gap of findLongGaps(project, lane.id)) {
				if (gap.bridgedBy == null) keys.set(`${lane.id}:${gap.toHitId}`, { fromHitId: gap.fromHitId, duration: gap.duration });
			}
		}
		this.longGapCache = { project, keys };
		return keys;
	}

	/** Piece selected by an assist, such as Next, whose pose arrives with the next run */
	private placedId: string | null = null;

	/** Pans to a piece an assist just placed once the run shows where it is, like Figma scrolling to a new layer */
	private revealPlaced(): void {
		const id = this.placedId;
		const piece = id != null ? this.result?.pieces.find((item) => item.entityId === id) : undefined;
		if (piece == null || this.$drag.get() != null) return;
		this.placedId = null;
		this.revealPoint(piece.contactPoint ?? piece.position);
	}

	/** Selecting one piece moves the playhead to its hit, so it is not shown ghosted, unless playing */
	private followSelection(selection: string[]): void {
		const only = selection.length === 1 ? selection[0] : undefined;
		this.placedId = only != null && this.result?.pieces.some((piece) => piece.entityId === only) !== true ? only : null;
		if (selection.length !== 1 || this.studio.$playing.get()) return;
		const project = this.project;
		if (project == null) return;
		// Selecting in the timeline or the layers pans to it when it is off screen, like Final Cut's viewer
		const hitKey = parseHitKey(only ?? '');
		const hit = hitKey != null ? this.result?.hits.find((item) => item.laneId === hitKey.laneId && item.hitId === hitKey.hitId) : undefined;
		const piece = this.result?.pieces.find((item) => item.entityId === only);
		this.revealPoint(hit?.dot ?? piece?.contactPoint ?? piece?.position ?? null, 0, 0);
		const linked = linkedPieces(project).find((item) => item.entity.id === selection[0]);
		if (linked == null) return;
		const delay = linked.entity.components.piece?.params['entryDelay'] ?? 0;
		this.studio.$playhead.set(linked.time + delay);
	}

	// MARK: - Moving, placing and turning

	private entity(entityId: string): TEntity | undefined {
		return this.project?.entities.find((item) => item.id === entityId);
	}

	private marbleRadius(laneId?: string): number | undefined {
		return this.result?.marbles.find((track) => laneId == null || track.laneId === laneId)?.radius;
	}

	/** Applies an edit and keeps the shown override until the run for it arrives */
	private commit(commands: Parameters<StudioCx['execute']>[0]): boolean {
		if (!commands.length || !this.studio.execute(commands)) {
			this.$override.set(null);
			return false;
		}
		if (this.$override.get() != null) this.settleRevision = this.project?.revision ?? null;
		return true;
	}

	private startMove(entityId: string, point: TVec2): void {
		const entity = this.entity(entityId);
		const resolved = this.result?.pieces.find((piece) => piece.entityId === entityId);
		if (entity == null || this.studio.$locked.get().includes(entityId)) return;
		const pose = piecePose(entity, resolved, this.marbleRadius(entity.components.hitLink?.laneId));
		if (pose == null) {
			this.$drag.set({ kind: 'click', target: { kind: 'piece', entityId }, start: point });
			return;
		}
		// Snap targets come from the run before the drag, since the dragged piece changes the run after it
		const dots = (this.result?.hits ?? []).flatMap((hit) =>
			hit.dot != null && (hit.status === 'open' || hit.pieceEntityId === entityId)
				? [{ laneId: hit.laneId, hitId: hit.hitId, dot: hit.dot, velocity: hit.velocity, screen: this.toScreen(hit.dot) }]
				: []
		);
		this.$drag.set({
			kind: 'move',
			entityId,
			start: point,
			startWorld: this.toWorld(point),
			pose,
			current: pose,
			snap: null,
			candidate: null,
			moved: false,
			dots,
			tracks: this.screenTrackPoints()
		});
	}

	private moveMove(drag: TMoveDrag, point: TVec2, isFree: boolean, isAxis: boolean): void {
		const project = this.project;
		const entity = this.entity(drag.entityId);
		if (project == null || entity == null) return;
		if (!drag.moved && Math.hypot(point.x - drag.start.x, point.y - drag.start.y) < 3) return;
		const world = this.toWorld(point);
		let dx = world.x - drag.startWorld.x;
		let dy = world.y - drag.startWorld.y;
		// Shift keeps the move on one axis, like Figma
		if (isAxis) {
			if (Math.abs(dx) > Math.abs(dy)) dy = 0;
			else dx = 0;
		}
		const pose = { position: { x: drag.pose.position.x + dx, y: drag.pose.position.y + dy }, angle: drag.pose.angle };
		const snap = !isFree && this.studio.$snapping.get() ? this.findSnap(entity, pose, drag) : null;
		const candidate = withSnap(project, entity, pose, snap);
		const radius = this.marbleRadius(snap?.laneId);
		const display = snap?.kind === 'link' ? displayPiece(candidate, { pose, dot: snap.dot, velocity: snap.velocity }, radius) : displayPiece(candidate, { pose }, radius);
		this.$override.set(display);
		this.$drag.set({ ...drag, current: pose, snap, candidate, moved: true });
		this.studio.simulation.startPreview(withEntity(project, candidate));
	}

	/**
	 * A hit dot the piece would link to, else a trajectory moment it would anchor to. Platforms link to a dot
	 * near their bar; any piece anchors near a trajectory, a moment ahead of where it touches it.
	 */
	private findSnap(entity: TEntity, pose: TPose, drag: { dots: TSnapDot[]; tracks: TScreenTrack[] }): TSnap | null {
		const project = this.project;
		const result = this.result;
		if (project == null || result == null) return null;
		const type = entity.components.piece?.type ?? 'platform';
		const scale = this.$camera.get().view.scale;
		const center = this.toScreen(pose.position);
		const halfLength = ((entity.components.piece?.params['length'] ?? 0.09) / 2) * scale;
		if (canLink(entity) && layoutOf(type) === 'box') {
			const tangent = { x: Math.cos(pose.angle) * halfLength, y: -Math.sin(pose.angle) * halfLength };
			const a = { x: center.x - tangent.x, y: center.y - tangent.y };
			const b = { x: center.x + tangent.x, y: center.y + tangent.y };
			const reach = Math.max(14, (this.marbleRadius() ?? 0.012) * scale + 10);
			let best: TSnapDot | null = null;
			let bestDistance = reach;
			for (const dot of drag.dots) {
				const distance = distanceToSegment(dot.screen, a, b);
				if (distance <= bestDistance) {
					best = dot;
					bestDistance = distance;
				}
			}
			if (best != null) return { kind: 'link', laneId: best.laneId, hitId: best.hitId, dot: best.dot, velocity: best.velocity };
		}
		// A windmill meets the marble with its blades, so it anchors wherever its blade circle crosses a trajectory
		const params = resolvePieceParams(type, entity.components.piece?.params ?? {});
		const bladeReach = layoutOf(type) === 'rotor' ? ((params['bladeLength'] ?? 0) + (params['hubRadius'] ?? 0)) * scale : 0;
		const near = pickTrack(center, drag.tracks, Math.max(14, Math.min(halfLength, 40), bladeReach));
		if (near?.kind !== 'track') return null;
		const time = near.time - ANCHOR_LEAD;
		const track = result.marbles.find((item) => item.laneId === near.laneId);
		const at = track != null ? trajectoryAt(track.samples, time, gravityOf(project)) : null;
		if (at == null) return null;
		// Anchoring needs a hit of the lane to count the moment from
		return asAnchored(project, entity, pose, near.laneId, time, at.position) != null ? { kind: 'anchor', laneId: near.laneId, time, marble: at.position } : null;
	}

	private startPlace(type: string, point: TVec2): void {
		const project = this.project;
		if (project == null) return;
		const at = this.toWorld(point);
		// Tunnels start level and windmills upright; a platform starts level until dragged
		const pose = { position: at, angle: 0 };
		const candidate = createFreePiece(type, pose, project.entities);
		this.$override.set(displayPiece(candidate, { pose }, this.marbleRadius()));
		this.$drag.set({ kind: 'place', type, start: point, at, angle: 0, candidate, moved: false });
		this.studio.simulation.startPreview(withEntity(project, candidate));
	}

	private movePlace(drag: TPlaceDrag, point: TVec2, isSnap: boolean): void {
		const project = this.project;
		if (project == null) return;
		const dx = point.x - drag.start.x;
		const dy = point.y - drag.start.y;
		if (!drag.moved && Math.hypot(dx, dy) < 6) return;
		// Dragging orients the piece along the drag; Shift snaps to 15° like Figma's rotation snapping
		let angle = Math.atan2(-dy, dx);
		if (layoutOf(drag.type) === 'box') angle = normalizeSurfaceAngle(angle);
		if (isSnap) angle = snapAngle(angle, 15);
		const pose = { position: drag.at, angle };
		const candidate = { ...drag.candidate, components: { ...drag.candidate.components, transform: pose } };
		this.$override.set(displayPiece(candidate, { pose }, this.marbleRadius()));
		this.$drag.set({ ...drag, angle, candidate, moved: true });
		this.studio.simulation.startPreview(withEntity(project, candidate));
	}

	private startRotate(entityId: string, point: TVec2): void {
		const entity = this.entity(entityId);
		const piece = this.displayPieces().find((item) => item.entityId === entityId);
		const startAngle = entity != null ? pieceAngle(entity) : null;
		if (entity == null || piece == null || startAngle == null) return;
		const { pivot } = this.screenGrip(piece);
		const drag: TRotationDrag = { startAngle, startPointer: screenAngle(pivot, point) };
		this.$drag.set({ kind: 'rotate', entityId, pivot, pivotWorld: rotationGrip(piece).pivot, drag, angle: startAngle, startAngle, pointer: point, base: piece });
	}

	private moveRotate(drag: TRotateDrag, point: TVec2, isSnap: boolean): void {
		const project = this.project;
		const entity = this.entity(drag.entityId);
		if (project == null || entity == null) return;
		const angle = dragRotation(drag.drag, drag.pivot, point, isSnap);
		const transform = entity.components.transform;
		const display =
			entity.components.hitLink == null && transform != null
				? displayPiece(entity, { pose: { position: transform.position, angle } }, this.marbleRadius())
				: rotateResolved(drag.base, drag.pivotWorld, angle - drag.startAngle);
		this.$override.set(display);
		this.$drag.set({ ...drag, angle, pointer: point });
		this.studio.simulation.startPreview(withPieceAngles(project, new Map([[drag.entityId, angle]])));
	}

	private startNodeDrag(entityId: string, index: number, handle: 'point' | 'in' | 'out'): void {
		const frame = this.railFrame(entityId);
		if (frame == null) return;
		this.$drag.set({ kind: 'node', entityId, index, handle, start: frame.nodes, nodes: frame.nodes, base: frame.base, candidate: null, moved: false });
	}

	private moveNode(drag: TNodeDrag, point: TVec2, isBroken: boolean): void {
		const project = this.project;
		const entity = this.entity(drag.entityId);
		const node = drag.start[drag.index];
		if (project == null || entity == null || node == null) return;
		const world = this.toWorld(point);
		const cos = Math.cos(drag.base.angle);
		const sin = Math.sin(drag.base.angle);
		const dx = world.x - drag.base.position.x;
		const dy = world.y - drag.base.position.y;
		const local = { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
		// ⌥ breaks the handle symmetry, like Figma
		const nodes =
			drag.handle === 'point'
				? withNodePoint(drag.start, drag.index, local)
				: withNodeHandle(drag.start, drag.index, drag.handle, { x: local.x - node.point.x, y: local.y - node.point.y }, !isBroken);
		const { nodes: rebased, shift } = rebaseNodes(nodes);
		const move = { x: shift.x * cos - shift.y * sin, y: shift.x * sin + shift.y * cos };
		const base = { position: { x: drag.base.position.x + move.x, y: drag.base.position.y + move.y }, angle: drag.base.angle };
		const link = entity.components.hitLink;
		const components = { ...entity.components, path: railPath(rebased) };
		if (link?.offset != null) components.hitLink = { ...link, offset: { x: link.offset.x + move.x, y: link.offset.y + move.y } };
		else components.transform = { position: base.position, angle: base.angle };
		const candidate = { ...entity, components };
		this.$override.set(displayPiece(candidate, { pose: base }, this.marbleRadius(link?.laneId)));
		this.$drag.set({ ...drag, nodes, candidate, moved: true });
		this.studio.simulation.startPreview(withEntity(project, candidate));
	}

	// MARK: - Path tool

	private penDown(point: TVec2): void {
		const world = this.toWorld(point);
		const pen = this.$pen.get();
		if (pen == null) {
			this.$pen.set({ id: null, nodes: [{ point: world }], pointer: world, isDragging: true, downAt: point, tracks: this.screenTrackPoints() });
			return;
		}
		const first = pen.nodes[0];
		const last = pen.nodes[pen.nodes.length - 1];
		const isNear = (node: TPathNode | undefined): boolean => node != null && Math.hypot(this.toScreen(node.point).x - point.x, this.toScreen(node.point).y - point.y) <= 8;
		// Clicking the first or the last point finishes the rail
		if (pen.nodes.length >= 2 && (isNear(first) || isNear(last))) {
			this.finishPen();
			return;
		}
		this.$pen.set({ ...pen, nodes: [...pen.nodes, { point: world }], pointer: world, isDragging: true, downAt: point });
		this.previewPen();
	}

	private penMove(point: TVec2, isBroken: boolean): void {
		const pen = this.$pen.get();
		if (pen == null) return;
		const world = this.toWorld(point);
		if (!pen.isDragging) {
			this.$pen.set({ ...pen, pointer: world });
			this.previewPen();
			return;
		}
		if (Math.hypot(point.x - pen.downAt.x, point.y - pen.downAt.y) < 3) return;
		// Dragging from a new point pulls out its handles; ⌥ moves only the outgoing one
		const last = pen.nodes[pen.nodes.length - 1] as TPathNode;
		const out = { x: world.x - last.point.x, y: world.y - last.point.y };
		const node: TPathNode = { point: last.point, out, in: isBroken ? last.in : { x: -out.x, y: -out.y } };
		this.$pen.set({ ...pen, nodes: [...pen.nodes.slice(0, -1), node], pointer: world });
		this.previewPen();
	}

	private penUp(): void {
		const pen = this.$pen.get();
		if (pen != null) this.$pen.set({ ...pen, isDragging: false });
	}

	/** The rail in progress as an entity: placed nodes, plus the pointer as the next point while moving */
	private penEntity(pen: TPen, withPointer: boolean): TEntity | null {
		const project = this.project;
		const nodes = withPointer && pen.pointer != null && !pen.isDragging ? [...pen.nodes, { point: pen.pointer }] : pen.nodes;
		const first = nodes[0];
		if (project == null || first == null || nodes.length < 2) return null;
		const local = nodes.map((node) => ({ ...node, point: { x: node.point.x - first.point.x, y: node.point.y - first.point.y } }));
		const entity = createFreePiece('rail', { position: first.point, angle: 0 }, project.entities, railPath(local));
		return pen.id != null ? { ...entity, id: pen.id.id, name: pen.id.name } : entity;
	}

	private previewPen(): void {
		const project = this.project;
		let pen = this.$pen.get();
		if (project == null || pen == null) return;
		const entity = this.penEntity(pen, true);
		if (entity == null) return;
		if (pen.id == null) {
			pen = { ...pen, id: { id: entity.id, name: entity.name ?? 'Rail' } };
			this.$pen.set(pen);
		}
		const transform = entity.components.transform;
		if (transform != null) this.$override.set(displayPiece(entity, { pose: transform }, this.marbleRadius()));
		this.studio.simulation.startPreview(withEntity(project, entity));
	}

	/** Return, or a click on the first or last point: adds the rail, anchored when it starts on a trajectory */
	finishPen(): void {
		const pen = this.$pen.get();
		const project = this.project;
		this.$pen.set(null);
		this.studio.simulation.endPreview();
		const entity = pen != null ? this.penEntity(pen, false) : null;
		const transform = entity?.components.transform;
		if (project == null || entity == null || transform == null || pen == null) {
			this.$override.set(null);
			return;
		}
		let rail = entity;
		const start = this.toScreen(transform.position);
		const near = this.studio.$snapping.get() ? pickTrack(start, pen.tracks, 12) : null;
		if (near?.kind === 'track') {
			const time = near.time - ANCHOR_LEAD;
			const track = this.result?.marbles.find((item) => item.laneId === near.laneId);
			const at = track != null ? trajectoryAt(track.samples, time, gravityOf(project)) : null;
			if (at != null) rail = asAnchored(project, entity, transform, near.laneId, time, at.position) ?? entity;
		}
		if (this.commit([{ type: 'upsertEntity', entity: rail }])) {
			this.studio.$selection.set([rail.id]);
			this.$tool.set('select');
		}
	}

	cancelPen(): void {
		if (this.$pen.get() == null) return;
		this.$pen.set(null);
		this.$override.set(null);
		this.studio.simulation.endPreview();
	}

	private undoPenPoint(): void {
		const pen = this.$pen.get();
		if (pen == null) return;
		if (pen.nodes.length <= 1) {
			this.cancelPen();
			return;
		}
		this.$pen.set({ ...pen, nodes: pen.nodes.slice(0, -1) });
		this.previewPen();
	}

	// MARK: - Step loop

	/** Repeat and Mirror place the next dot with the previous piece's angle, as is or mirrored */
	step(mode: TStepMode): void {
		const project = this.project;
		const result = this.result;
		if (project == null || result == null) return;
		const target = findStepTarget(project, result, this.studio.$selection.get());
		if (target == null) {
			this.studio.notify('There is no open hit to place');
			return;
		}
		commitAtHit(this.studio, target, pieceForHit(project, target, this.placementType(), mode));
		this.revealPoint(target.dot);
	}

	togglePin(): void {
		const project = this.project;
		if (project == null) return;
		const ids = selectedPieceIds(project, this.studio.$selection.get());
		const commands = pinCommands(project, this.result, ids);
		if (!commands.length) return;
		this.studio.execute(commands);
		const pinned = commands.some((command) => command.type === 'setComponent' && command.component.name === 'hitLink' && command.component.value.pinned);
		this.studio.notify(pinned ? 'Pinned: stays in place when the run changes' : 'Unpinned: follows the run again');
	}

	/** Rotates the selected pieces by `degrees`, as one edit */
	nudge(degrees: number): boolean {
		const project = this.project;
		if (project == null) return false;
		const ids = selectedPieceIds(project, this.studio.$selection.get());
		const angles = new Map<string, number>();
		for (const entity of project.entities) {
			const angle = pieceAngle(entity);
			if (angle != null && ids.includes(entity.id)) angles.set(entity.id, angle + toRadians(degrees));
		}
		if (!angles.size) return false;
		this.studio.execute(pieceAngleCommands(project, angles));
		return true;
	}

	/** Deletes the selected pieces, and selected marbles with their lanes while another marble remains */
	deleteSelection(): boolean {
		const project = this.project;
		if (project == null) return false;
		const selection = this.studio.$selection.get();
		const ids = selectedPieceIds(project, selection);
		const lanes = project.entities.filter((entity) => selection.includes(entity.id) && entity.components.marble != null).map((entity) => entity.components.marble?.laneId ?? '');
		const removable = lanes.slice(0, Math.max(0, project.music.lanes.length - 1));
		const commands = [
			...(ids.length ? [{ type: 'removeEntities' as const, entityIds: ids }] : []),
			...removable.map((laneId) => ({ type: 'removeLane' as const, laneId }))
		];
		if (!commands.length || !this.studio.execute(commands)) return false;
		this.studio.$selection.set([]);
		return true;
	}

	/**
	 * Centres the view on `point` unless it and `margin` metres around it lie at least `inset` pixels inside
	 * the canvas
	 */
	private revealPoint(point: TVec2 | null, inset = 60, margin = 0.03): void {
		if (point == null) return;
		const camera = this.$camera.get();
		const viewport = this.$viewport.get();
		const bounds = { minX: point.x - margin, minY: point.y - margin, maxX: point.x + margin, maxY: point.y + margin };
		if (camera.mode !== '2d' || isBoundsVisible(camera.view, viewport, bounds, inset)) return;
		this.$camera.set({ ...camera, view: { ...camera.view, center: { x: point.x, y: point.y } } });
	}

	// MARK: - Keyboard

	private onKeyDown(event: KeyboardEvent): void {
		if (isEditingTarget(event) || this.studio.$workspace.get() !== 'compose') return;
		if (event.key === ' ' && !event.metaKey && !event.ctrlKey && !event.altKey) {
			// Space and drag pans like Figma; a plain press still plays and pauses on release
			event.preventDefault();
			if (!event.repeat) {
				this.spacePanned = false;
				this.$spaceHeld.set(true);
			}
			return;
		}
		const project = this.project;
		const selection = this.studio.$selection.get();
		const action = composeKeyAction(event, {
			hasPieces: project != null && (selectedPieceIds(project, selection).length > 0 || project.entities.some((entity) => selection.includes(entity.id) && entity.components.marble != null)),
			hasSelection: selection.length > 0,
			hasGhosts: this.assist.hasGhosts,
			isDrawing: this.$pen.get() != null
		});
		if (action == null) return;
		if (this.runKeyAction(action)) event.preventDefault();
	}

	/** Runs a keyboard action; returns false when it did nothing, so the key falls through */
	runKeyAction(action: TComposeKeyAction): boolean {
		// The Camera view previews; keys that edit or navigate the wall wait for the Wall view
		if (this.$camera.get().mode === 'camera' && action.type !== 'cameraView' && action.type !== 'escape') return false;
		switch (action.type) {
			case 'cameraView':
				this.toggleCameraView();
				return true;
			case 'zoom':
				this.zoomBy(action.factor);
				return true;
			case 'fit':
				if (action.target === 'all') this.fitAll();
				else if (action.target === 'frame') this.fitFrame();
				else this.fitSelection();
				return true;
			case 'tool':
				this.$tool.set(action.tool);
				return true;
			case 'next':
				this.next();
				return true;
			case 'acceptGhosts':
				return this.assist.acceptGhosts();
			case 'escape':
				this.escape();
				return true;
			case 'delete':
				return this.deleteSelection();
			case 'nudge': {
				const project = this.project;
				// Arrow keys turn pieces; with only a marble selected they keep moving between hits
				if (project == null || !selectedPieceIds(project, this.studio.$selection.get()).length) return false;
				return this.nudge(action.degrees);
			}
			case 'repeat':
				this.step('repeat');
				return true;
			case 'mirror':
				this.step('mirror');
				return true;
			case 'autoPlace':
				this.assist.autoPlace(this.placementType());
				return true;
			case 'pin':
				this.togglePin();
				return true;
			case 'finishPath':
				this.finishPen();
				return true;
			case 'undoPathPoint':
				this.undoPenPoint();
				return true;
		}
	}

	/** Return and N */
	next(): void {
		const before = this.studio.$selection.get();
		this.assist.next(this.placementType());
		const after = this.studio.$selection.get();
		if (after !== before) this.revealSelection();
	}

	/** Escape cancels a drag or a rail in progress, then dismisses ghosts, then leaves a tool, then clears the selection */
	escape(): void {
		if (this.$drag.get() != null) {
			this.$drag.set(null);
			this.$override.set(null);
			this.studio.simulation.endPreview();
			this.syncMarbles();
		} else if (this.$pen.get() != null) {
			this.cancelPen();
		} else if (this.assist.dismiss()) {
			return;
		} else if (this.$tool.get() !== 'select') {
			this.$tool.set('select');
		} else {
			this.studio.$selection.set([]);
		}
	}

	private revealSelection(): void {
		const result = this.result;
		const id = this.studio.$selection.get()[0];
		const piece = result?.pieces.find((item) => item.entityId === id);
		if (piece?.contactPoint != null) this.revealPoint(piece.contactPoint);
	}

	private onKeyUp(event: KeyboardEvent): void {
		if (event.key !== ' ' || !this.$spaceHeld.get()) return;
		this.$spaceHeld.set(false);
		if (!this.spacePanned) this.studio.$playing.set(!this.studio.$playing.get());
	}

	// MARK: - Renderer sync

	private syncTracks(): void {
		const result = this.result;
		const project = this.project;
		if (this.renderer == null) return;
		const tracks = (result?.marbles ?? []).map((track) => {
			let buffers = this.trackCache.get(track);
			if (buffers == null) {
				buffers = trackBuffers(track);
				this.trackCache.set(track, buffers);
			}
			const color = project?.entities.find((entity) => entity.id === track.entityId)?.components.marble?.color ?? '#3478f6';
			return { entityId: track.entityId, color, ...buffers };
		});
		this.renderer.setTracks(tracks);
	}

	private syncPieces(): void {
		if (this.renderer == null) return;
		const playhead = this.studio.$playhead.get();
		const isFilm = this.$camera.get().mode === 'camera';
		// Selected pieces stay solid so the piece being edited is never washed out
		const selection = this.studio.$selection.get();
		this.renderer.setPieces(
			this.displayPieces().map((piece) => {
				const time = pieceTime(piece);
				return {
					piece,
					// The film shows every piece solid; the wall views fade pieces the marble has not reached yet
					ghost: !isFilm && time != null && time > playhead + 1e-4 && !selection.includes(piece.entityId),
					angle: pieceAngleAt(piece, playhead)
				};
			})
		);
	}

	syncMarbles(): void {
		const project = this.project;
		if (this.renderer == null || project == null) return;
		const result = this.result;
		const playhead = this.studio.$playhead.get();
		const drag = this.$drag.get();
		const hidden = this.studio.$hidden.get();
		const marbles = project.entities.flatMap((entity) => {
			const { marble, release } = entity.components;
			if (marble == null || release == null || hidden.includes(entity.id)) return [];
			const releasePosition = drag?.kind === 'release' && drag.entityId === entity.id ? drag.position : release.position;
			const track = result?.marbles.find((item) => item.entityId === entity.id);
			// Until the dragged release has a new result, keep the marble on the handle
			const isDragged = drag?.kind === 'release' && drag.entityId === entity.id;
			const position = isDragged && playhead <= release.time ? releasePosition : marblePositionAt(track, playhead, releasePosition);
			return [{ entityId: entity.id, color: marble.color, radius: marble.radius, position }];
		});
		this.renderer.setMarbles(marbles);
	}

	private syncGuides(): void {
		const project = this.project;
		if (this.renderer == null || project == null) return;
		const bounds = contentBounds(project, this.result);
		const height = bounds.maxY - bounds.minY;
		this.renderer.setFrameGuides(frameBand(project), bounds.minY - height - 1, bounds.maxY + height + 1);
	}
}

export interface TSnapDot {
	laneId: string;
	hitId: string;
	dot: TVec2;
	velocity: TVec2 | null;
	screen: TVec2;
}

export interface TPen {
	/** Id and name of the rail being drawn, kept stable across previews */
	id: { id: string; name: string } | null;
	nodes: TPathNode[];
	/** Pointer on the wall while moving, drawn as the next segment */
	pointer: TVec2 | null;
	isDragging: boolean;
	downAt: TVec2;
	/** Trajectories when drawing started, for anchoring the rail's start */
	tracks: TScreenTrack[];
}

interface TMoveDrag {
	kind: 'move';
	entityId: string;
	start: TVec2;
	startWorld: TVec2;
	pose: TPose;
	current: TPose;
	snap: TSnap | null;
	candidate: TEntity | null;
	moved: boolean;
	dots: TSnapDot[];
	tracks: TScreenTrack[];
}

interface TPlaceDrag {
	kind: 'place';
	type: string;
	start: TVec2;
	at: TVec2;
	angle: number;
	candidate: TEntity;
	moved: boolean;
}

interface TRotateDrag {
	kind: 'rotate';
	entityId: string;
	pivot: TVec2;
	pivotWorld: TVec2;
	drag: TRotationDrag;
	angle: number;
	startAngle: number;
	pointer: TVec2;
	base: TResolvedPiece;
}

interface TNodeDrag {
	kind: 'node';
	entityId: string;
	index: number;
	handle: 'point' | 'in' | 'out';
	start: TPathNode[];
	nodes: TPathNode[];
	base: TPose;
	candidate: TEntity | null;
	moved: boolean;
}

export type TComposeDrag =
	| { kind: 'pan'; last: TVec2; orbit: boolean }
	| TRotateDrag
	| TMoveDrag
	| TPlaceDrag
	| TNodeDrag
	| { kind: 'release'; entityId: string; offset: TVec2; position: TVec2; moved: boolean }
	| { kind: 'path'; entityId: string; handle: 'end' | 'bend'; points: TVec2[]; start: TVec2[]; moved: boolean }
	| { kind: 'marquee'; from: TVec2; to: TVec2; base: string[] }
	| { kind: 'click'; target: TPick | null; start: TVec2 };

// Keeps framed content clear of the corner controls and the contextual bar
const canvasPadding: TPadding = { top: 56, right: 56, bottom: 72, left: 56 };

function withRelease(project: TProject, entityId: string, position: TVec2): TProject {
	return {
		...project,
		entities: project.entities.map((entity) => {
			const release = entity.components.release;
			if (entity.id !== entityId || release == null) return entity;
			return { ...entity, components: { ...entity.components, release: { ...release, position } } };
		})
	};
}

function withPathPoints(project: TProject, entityId: string, points: TVec2[]): TProject {
	return {
		...project,
		entities: project.entities.map((entity) => (entity.id === entityId ? { ...entity, components: { ...entity.components, path: { points } } } : entity))
	};
}

function localPoint(event: React.PointerEvent<HTMLElement>): TVec2 {
	const rect = event.currentTarget.getBoundingClientRect();
	return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function isSamePick(a: TPick | null, b: TPick | null): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/** The Camera view without a follow camera keeps its frame but has no pose */
export type TFilmState = TFilmView | { pose: null; aspect: number; frame: TFilmView['frame'] };
