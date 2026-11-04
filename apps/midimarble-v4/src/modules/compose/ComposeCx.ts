import { createState } from 'feature-state';
import type React from 'react';
import * as THREE from 'three';
import { isEditingTarget } from '@/lib';
import type { TEntity, TPathNode, TProject, TVec2 } from '@/modules/project';
import {
	findLongGaps,
	frameBand,
	gravityOf,
	layoutOf,
	linkPieceToHit,
	resolvePieceParams,
	resolvePiecePath,
	soundsHit,
	trajectoryAt,
	type THitResult,
	type TResolvedPiece,
	type TSimulationResult
} from '@/modules/simulation';
import { formatTime, noteName } from '@/modules/studio/format';
import { CAMERA_KEY, parseHitKey, SONG_KEY, toHitKey } from '@/modules/studio/selection';
import type { StudioCx } from '@/modules/studio/StudioCx';
import { dragRotation, normalizeSurfaceAngle, screenAngle, snapAngle, toRadians, type TRotationDrag } from './angles';
import { AssistCx } from './AssistCx';
import { dotClickAction } from './reachability';
import {
	ANCHOR_LEAD,
	asAnchored,
	canLink,
	clearRotorPosition,
	createFreePiece,
	asPinned,
	displayPiece,
	isPathPieceType,
	KEEP_PLAYS_REACH,
	piecePose,
	playsDrop,
	railPath,
	rotateResolved,
	withEntity,
	withSnap,
	type TPlaysDrop,
	type TPose,
	type TSnap
} from './attach-edit';
import { rebaseNodes, withNodeHandle, withNodePoint } from './bezier';
import { ComposeRenderer, MARBLE_Z, type TComposeCamera } from './ComposeRenderer';
import { composeKeyAction, toolPieceType, type TComposeKeyAction, type TComposeTool, type TPathType } from './keys';
import { insertTool, type TInsertItem } from './library';
import { distanceToSegment, isOnGhost, pick, pickTrack, PLACED_DOT_PICK_RADIUS, piecesInRect, rectFromPoints, TRACK_PICK_RADIUS, type TPick, type TPickScene, type TScreenTrack } from './picking';
import {
	boundsOfPieces,
	contentBounds,
	firstHitsView,
	fitTargets,
	marblePositionAt,
	pathHandles,
	pathToLocal,
	pathToWorld,
	pieceAngleAt,
	pieceKind,
	pieceOutline,
	playheadSection,
	struckAt,
	rotationGrip,
	trackBuffers,
	withPathBend,
	withPathEnd
} from './scene';
import { newlyBroken } from './finish-assist';
import { asLaneFinish, commitAtHit, findStepTarget, followerAt, linkedPieces, pieceAngle, pieceAngleCommands, pieceForHit, selectedPieceIds, withPieceAngles, type TStepMode } from './step-loop';
import {
	boundsOf,
	fitBounds,
	fitContent,
	gridLayers,
	isBoundsVisible,
	panBy,
	screenToWorld,
	worldToScreen,
	zoomAt,
	ZOOM_100_SCALE,
	type TBounds,
	type TPadding,
	type TView,
	type TViewport
} from './view';
import { createViewMotion, FOLLOW_RATE, followMarble, isSettled, keepInView, NAVIGATE_RATE, stepViewMotion, type TViewMotion } from './view-follow';

export type { TComposeTool } from './keys';

/**
 * Owns the Compose canvas: camera, tools, pointer and keyboard interaction and the WebGL renderer. The
 * canvas is open like Figma: every element can be placed anywhere, moved and turned, and a drop decides
 * whether it stays free, links to a hit dot or anchors to a trajectory.
 */
export class ComposeCx {
	readonly $camera = createState<TComposeCamera>({ mode: '2d', view: { center: { x: 0, y: 0.4 }, scale: 900 } });
	readonly $viewport = createState<TViewport>({ width: 0, height: 0 });
	readonly $tool = createState<TComposeTool>('select');
	/** Piece the path tool draws, set by B (rail), U (tunnel) or the Insert library */
	readonly $pathType = createState<TPathType>('rail');
	/** The Insert library popover of the tool rail is open */
	readonly $libraryOpen = createState(false);
	/** Library item being dragged onto the canvas */
	readonly $inserting = createState<TInsertItem | null>(null);
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
	/**
	 * A platform added at a dot, shown at its first-guess pose (the default tilt on the dot) from the click
	 * until the placement commits, so it appears at once while Auto place solves the tilt
	 */
	readonly $placing = createState<TResolvedPiece | null>(null);
	/** What a drop does, beside the piece dragged in from the Insert library */
	readonly $insertSnap = createState<{ position: TVec2; snap: TSnap | null } | null>(null);
	readonly assist: AssistCx;
	/**
	 * Follow, like Logic's Catch Playhead: the Wall view glides with the focused marble as the playhead moves. Off by
	 * default and remembered per project on this device; panning or zooming by hand turns it off.
	 */
	readonly $follow = createState(false);
	/** The platform Play a Note… armed, which the next click on a note's dot links; any other click disarms it */
	readonly $playNoteFor = createState<string | null>(null);

	private renderer: ComposeRenderer | null = null;
	private container: HTMLElement | null = null;
	private framedProjectId: string | null = null;
	private spacePanned = false;
	private trackCache = new WeakMap<object, { points: Float32Array; times: Float32Array }>();
	/** Keeps the override until the result for the committed edit arrives, so a drop never flickers */
	private settleRevision: number | null = null;
	/** Spring that moves the view for Follow and navigation, with the view it last showed */
	private motion: { state: TViewMotion; view: TView } | null = null;
	/** Navigation such as a step to a hit is gliding to its goal, at the faster navigation rate */
	private isNavigating = false;
	private motionFrame = 0;
	private motionTime = 0;
	/** Project whose remembered Follow choice `$follow` holds */
	private followProjectId: string | null = null;

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
		};
		cleanups.push(
			this.$camera.subscribe(({ value }) => {
				renderer.setCamera(value);
				updateGrid();
				this.screenTracks = null;
			}),
			this.$viewport.listen(() => {
				this.screenTracks = null;
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
				this.frameIfNeeded();
				this.followPhysics(value);
				this.revealPlaced();
				this.revealHistory(value);
				this.fitFirstHits();
			}),
			this.studio.$fitFirstHits.listen(() => this.fitFirstHits()),
			this.studio.$playing.listen(() => this.fitFirstHits()),
			this.$override.listen(() => this.syncPieces()),
			this.$placing.listen(() => this.syncPieces()),
			this.studio.$hidden.listen(() => this.syncPieces()),
			this.studio.$playing.listen(() => this.wakeMotion()),
			this.studio.$playhead.subscribe(({ value }) => {
				renderer.setPlayhead(value);
				this.syncPieces();
				this.syncMarbles();
				this.wakeMotion();
			}),
			this.$follow.listen(({ value }) => {
				const projectId = this.project?.id;
				if (projectId != null) writeFollow(projectId, value);
				if (value) this.wakeMotion();
			}),
			this.studio.$history.listen(() => {
				// Release positions and newly placed platforms show immediately, before the new result arrives
				this.syncMarbles();
				this.syncGuides();
				this.syncPieces();
				this.loadFollow();
				// A newly opened project is framed at once, before its first run arrives
				this.frameIfNeeded();
			}),
			this.studio.$selection.listen(({ value }) => {
				this.syncPieces();
				this.followSelection(value);
			}),
			this.studio.$reveal.listen(({ value }) => {
				if (value != null) this.revealPending();
			}),
			// After the playhead moved, so the marble is read at its new time
			this.studio.$playheadReveal.listen(() => this.revealPlayhead()),
			// Switching tools finishes a rail in progress, like Figma's pen
			this.$tool.listen(({ value }) => {
				this.clearHoverPreview();
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

		this.loadFollow();
		this.studio.$compose.set(this);
		cleanups.push(() => {
			if (this.studio.$compose.get() === this) this.studio.$compose.set(null);
		});

		return () => {
			const projectId = this.project?.id;
			if (projectId != null && projectId === this.framedProjectId) this.studio.composeView = { projectId, view: this.$camera.get().view };
			for (const cleanup of cleanups) cleanup();
			this.studio.simulation.endPreview();
			window.clearTimeout(this.openingTimer);
			this.stopMotion();
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

	/**
	 * Pieces as the canvas shows them: the run's poses with the dragged piece where the pointer holds it, and
	 * platforms the run has not caught up with yet on their dots
	 */
	displayPieces(result: TSimulationResult | null = this.result): TResolvedPiece[] {
		const override = this.$override.get();
		const hidden = this.studio.$hidden.get();
		const pieces = (result?.pieces ?? []).filter((piece) => !hidden.includes(piece.entityId));
		pieces.push(...this.pendingPieces(result, hidden));
		const placing = this.$placing.get();
		if (placing != null) pieces.push(placing);
		if (override == null) return pieces;
		const index = pieces.findIndex((piece) => piece.entityId === override.entityId);
		if (index < 0) return [...pieces, override];
		return pieces.map((piece, i) => (i === index ? override : piece));
	}

	/**
	 * Platforms on a dot that the project has but the result does not yet, placed on their dot at their stored
	 * tilt the way the run will start them. A new run takes about a second on a long song; until then the
	 * placed platform shows here instead of nowhere.
	 */
	private pendingPieces(result: TSimulationResult | null, hidden: string[]): TResolvedPiece[] {
		const project = this.project;
		if (project == null || result == null || result.revision >= project.revision) return [];
		const pending: TResolvedPiece[] = [];
		for (const entity of project.entities) {
			const link = entity.components.hitLink;
			if (link == null || !soundsHit(entity.components.piece?.type ?? '', link) || hidden.includes(entity.id)) continue;
			if (result.pieces.some((piece) => piece.entityId === entity.id)) continue;
			const hit = result.hits.find((item) => item.laneId === link.laneId && item.hitId === link.hitId);
			if (hit?.dot == null) continue;
			pending.push(displayPiece(entity, { pose: { position: hit.dot, angle: link.angle }, dot: hit.dot, velocity: hit.velocity }, this.marbleRadius(link.laneId)));
		}
		return pending;
	}

	/**
	 * Adds an auto-placed platform at an open dot. The platform shows at once at the default tilt while Auto
	 * place looks for the tilt that lands the next note, then the solved one takes its place.
	 */
	placePlatform(hit: THitResult): void {
		const project = this.project;
		if (project != null && hit.dot != null) {
			const guess = pieceForHit(project, hit, 'platform', 'default', 'placing');
			const angle = guess.components.hitLink?.angle ?? 0;
			this.$placing.set(displayPiece(guess, { pose: { position: hit.dot, angle }, dot: hit.dot, velocity: hit.velocity }, this.marbleRadius(hit.laneId)));
		}
		void this.assist.place(hit, 'platform').finally(() => this.$placing.set(null));
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
		const hidden = this.studio.$hidden.get();
		const locked = this.studio.$locked.get();
		const selected = selectedPieceIds(project, this.studio.$selection.get()).filter((id) => !locked.includes(id));
		// The piece a hover what-if shows is not there yet, so the pointer never lands on it
		const previewId = this.hoverPreview?.entityId;
		const pieces = this.displayPieces(result).filter((piece) => piece.entityId !== previewId);
		for (const piece of pieces) {
			if (!locked.includes(piece.entityId)) scene.pieces.push({ entityId: piece.entityId, corners: this.screenOutline(piece) });
		}
		// An armed tool or Play a Note… is after open dots; placed ones select their hit only with the Move tool
		const pickPlaced = this.$tool.get() === 'select' && this.$playNoteFor.get() == null;
		for (const hit of result.hits) {
			if (hit.dot == null || (hit.status !== 'open' && !pickPlaced)) continue;
			scene.dots.push({ laneId: hit.laneId, hitId: hit.hitId, position: this.toScreen(hit.dot), radius: hit.status === 'open' ? undefined : PLACED_DOT_PICK_RADIUS });
		}
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

	/** Zooms by hand, which turns Follow off like scrolling turns off Logic's Catch Playhead */
	zoomBy(factor: number, anchor?: TVec2): void {
		this.takeView();
		const viewport = this.$viewport.get();
		const point = anchor ?? { x: viewport.width / 2, y: viewport.height / 2 };
		this.$camera.set((camera) => ({ ...camera, view: zoomAt(camera.view, viewport, point, factor) }));
	}

	/**
	 * ⇧1: fits the pieces, the releases and the run up to the last hit, zoomed no further out than a default
	 * platform at `MIN_FIT_PLATFORM_PX`. A run too long for that shows the playhead's section instead of specks;
	 * Zoom to Whole Run shows it all.
	 */
	fitAll(): void {
		const project = this.project;
		const viewport = this.$viewport.get();
		if (project == null || viewport.width <= 1) return;
		const { all, pieces } = fitTargets(project, this.result);
		const minScale = this.minFitScale();
		const whole = fitContent(all, pieces, viewport, canvasPadding, minScale);
		const result = this.result;
		const section = whole.scale < minScale && result != null ? playheadSection(project, result, this.studio.$playhead.get(), viewport, canvasPadding, minScale) : null;
		this.$camera.set((camera) => ({ ...camera, view: section != null ? fitBounds(section, viewport, canvasPadding) : whole }));
	}

	/** Zoom to Whole Run: everything Zoom to Fit would frame, however small that makes it */
	fitWholeRun(): void {
		const project = this.project;
		const viewport = this.$viewport.get();
		if (project == null || viewport.width <= 1) return;
		this.$camera.set((camera) => ({ ...camera, view: fitBounds(fitTargets(project, this.result).all, viewport, canvasPadding) }));
	}

	/** ⌘0: the wall at physical size around the centre of the view, like Figma's Zoom to 100% */
	zoomTo100(): void {
		this.zoomBy(ZOOM_100_SCALE / this.$camera.get().view.scale);
	}

	/** Pixels per metre at which a default platform is still `MIN_FIT_PLATFORM_PX` long */
	private minFitScale(): number {
		return MIN_FIT_PLATFORM_PX / (resolvePieceParams('platform', {})['length'] ?? 0.09);
	}

	/** After tapping or importing, the next open dots come into view with their hint and build bar, once the run shows them */
	private fitFirstHits(): void {
		const project = this.project;
		const result = this.result;
		const viewport = this.$viewport.get();
		if (!this.studio.$fitFirstHits.get() || project == null || result == null || result.revision !== project.revision || viewport.width <= 1) return;
		if (this.studio.$playing.get() || this.$drag.get() != null) return;
		this.studio.$fitFirstHits.set(false);
		const view = firstHitsView(project, result, this.$camera.get().view, viewport, canvasPadding, this.minFitScale());
		if (view != null) this.navigateTo(view);
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
		return this.marbleMotion()?.position ?? null;
	}

	/** Position and velocity of the selected or first marble at the playhead; still at its release before it starts */
	private marbleMotion(): { position: TVec2; velocity: TVec2 } | null {
		const project = this.project;
		if (project == null) return null;
		const selected = this.studio.$selection.get();
		const marbles = project.entities.filter((entity) => entity.components.marble != null);
		const marble = marbles.find((entity) => selected.includes(entity.id)) ?? marbles[0];
		if (marble == null) return null;
		const track = this.result?.marbles.find((item) => item.entityId === marble.id);
		const at = track == null ? null : trajectoryAt(track.samples, this.studio.$playhead.get(), gravityOf(project));
		if (at != null) return at;
		const release = marble.components.release?.position;
		return release != null ? { position: release, velocity: { x: 0, y: 0 } } : null;
	}

	// MARK: - Follow and gliding

	setFollow(isOn: boolean): void {
		this.$follow.set(isOn);
	}

	toggleFollow(): void {
		this.$follow.set(!this.$follow.get());
	}

	/** Reads the remembered Follow choice when another project opens */
	private loadFollow(): void {
		const projectId = this.project?.id ?? null;
		if (projectId === this.followProjectId) return;
		this.followProjectId = projectId;
		this.$follow.set(projectId != null && readFollow(projectId));
	}

	/** The user moves the view by hand: Follow turns off and a glide in progress stops where it is */
	private takeView(): void {
		if (this.$follow.get()) this.$follow.set(false);
		this.isNavigating = false;
		this.stopMotion();
	}

	/**
	 * Navigation glides to `view` with a critically damped spring, like the film camera, instead of jumping. Without
	 * a frame loop or with Reduce Motion it is set at once.
	 */
	private navigateTo(view: TView): void {
		const camera = this.$camera.get();
		if (typeof requestAnimationFrame === 'undefined' || prefersReducedMotion() || this.$viewport.get().width <= 1) {
			this.stopMotion();
			this.$camera.set({ ...camera, view });
			return;
		}
		const motion = this.syncMotion();
		motion.goal = { center: { ...view.center }, scale: view.scale };
		this.isNavigating = true;
		this.wakeMotion(true);
	}

	/** The spring's state, restarted at rest on the current view when anything else moved the view since */
	private syncMotion(): TViewMotion {
		const view = this.$camera.get().view;
		if (this.motion == null || this.motion.view !== view) this.motion = { state: createViewMotion(view), view };
		return this.motion.state;
	}

	/** Starts the frame loop when Follow or a glide has work to do */
	private wakeMotion(force = false): void {
		if (this.motionFrame !== 0 || this.renderer == null || typeof requestAnimationFrame === 'undefined') return;
		if (!force && !this.isNavigating && !this.$follow.get()) return;
		this.motionTime = performance.now();
		this.motionFrame = requestAnimationFrame(this.stepMotion);
	}

	private stopMotion(): void {
		if (this.motionFrame !== 0) cancelAnimationFrame(this.motionFrame);
		this.motionFrame = 0;
	}

	private readonly stepMotion = (now: number): void => {
		this.motionFrame = 0;
		const viewport = this.$viewport.get();
		if (this.renderer == null || viewport.width <= 1 || this.$drag.get()?.kind === 'pan') return;
		// A long frame, such as after the window was hidden, glides on instead of jumping to the end
		const dt = Math.min(Math.max(0, (now - this.motionTime) / 1000), 1 / 20);
		this.motionTime = now;
		const motion = this.syncMotion();
		const at = this.$follow.get() ? this.marbleMotion() : null;
		if (at != null) followMarble(motion, at.position, at.velocity, viewport, dt);
		let view = stepViewMotion(motion, dt, this.isNavigating ? NAVIGATE_RATE : FOLLOW_RATE);
		// The spring trails a fast fall; the marble itself never leaves the view
		if (at != null) {
			view = { ...view, center: keepInView(view.center, view.scale, viewport, at.position) };
			motion.center = { ...view.center };
		}
		const settled = isSettled(motion);
		if (settled) {
			view = { center: { ...motion.goal.center }, scale: motion.goal.scale };
			motion.center = { ...view.center };
			motion.velocity = { x: 0, y: 0 };
			motion.logScale = Math.log(view.scale);
			motion.scaleVelocity = 0;
			this.isNavigating = false;
		}
		const current = this.$camera.get();
		if (view.scale !== current.view.scale || view.center.x !== current.view.center.x || view.center.y !== current.view.center.y) {
			this.$camera.set({ ...current, view });
		}
		if (this.motion != null) this.motion.view = this.$camera.get().view;
		// While Follow is on and the song plays, every frame may move the marble
		if (!settled || (at != null && this.studio.$playing.get())) this.wakeMotion(true);
	};

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

	/** CSS pixels per wall metre, for strokes drawn at wall size */
	screenScale(): number {
		return this.$camera.get().view.scale;
	}

	private fit(bounds: TBounds): void {
		const viewport = this.$viewport.get();
		if (viewport.width <= 1) return;
		this.$camera.set((camera) => ({ ...camera, view: fitBounds(bounds, viewport, canvasPadding) }));
	}

	/**
	 * Frames each opened project once. The film-frame view needs only the project and the canvas size, so it is
	 * set before the first paint instead of after the first run; the run's first hits widen it when they arrive.
	 */
	private frameIfNeeded(): void {
		const project = this.project;
		if (project == null || this.$viewport.get().width <= 1) return;
		if (this.framedProjectId !== project.id) {
			this.framedProjectId = project.id;
			this.revealedProjectId = null;
			// Back from Film, the wall stays where the user left it
			const kept = this.studio.composeView;
			if (kept?.projectId === project.id) {
				this.$camera.set((camera) => ({ ...camera, view: kept.view }));
				this.revealedProjectId = project.id;
				this.revealPending();
				return;
			}
			// The releases and where each marble's free fall meets its first note frame the wall before any run,
			// so the run's first hits rarely need to widen it afterwards
			const opening = this.result == null ? openingPoints(project) : [];
			if (opening.length > 0) this.fitAround(project, boundsOf(opening));
			else this.fitFrame();
			// The first run may still widen the view to its first hits, so the wall stays hidden until it does
			// instead of showing a zoom jump, for at most a moment on a long song
			this.setOpening(true);
			window.clearTimeout(this.openingTimer);
			this.openingTimer = window.setTimeout(() => this.setOpening(false), OPENING_WAIT_MS);
		}
		if (this.result == null || this.revealedProjectId === project.id) return;
		this.revealedProjectId = project.id;
		this.revealFirstHits(project);
		this.setOpening(false);
		// A reveal sent while Compose was not mounted, such as from the export preflight in Design
		this.revealPending();
	}

	private openingTimer: number | undefined;

	private setOpening(isOpening: boolean): void {
		if (this.container == null) return;
		if (isOpening) this.container.dataset['opening'] = 'true';
		else delete this.container.dataset['opening'];
	}

	/** Project whose first hits the opening view has been widened to */
	private revealedProjectId: string | null = null;
	/** Physics the latest current run was made with, to notice a project-wide change such as Gravity */
	private physicsKey: { projectId: string; key: string } | null = null;

	/**
	 * A project-wide physics change, such as Gravity, moves every marble and piece. Once its run arrives
	 * the view pans to the marble at the playhead when it has left the view, keeping the zoom.
	 */
	private followPhysics(result: TSimulationResult | null): void {
		const project = this.project;
		if (project == null || result == null || result.revision !== project.revision) return;
		const key = JSON.stringify(project.physics ?? null);
		const previous = this.physicsKey;
		this.physicsKey = { projectId: project.id, key };
		if (previous == null || previous.projectId !== project.id || previous.key === key) return;
		const camera = this.$camera.get();
		const viewport = this.$viewport.get();
		const focus = this.marbleFocus();
		if (focus == null || this.$drag.get() != null || viewport.width <= 1) return;
		const margin = 0.02;
		if (isBoundsVisible(camera.view, viewport, { minX: focus.x - margin, maxX: focus.x + margin, minY: focus.y - margin, maxY: focus.y + margin }, 48)) return;
		const screen = worldToScreen(camera.view, viewport, focus);
		const isOutsideX = screen.x < 48 || screen.x > viewport.width - 48;
		this.navigateTo({ ...camera.view, center: { x: isOutsideX ? focus.x : camera.view.center.x, y: focus.y - (viewport.height * 0.18) / camera.view.scale } });
	}

	/**
	 * A run that falls a long way to its first piece would open on lone marbles, so the opening view widens
	 * to the releases and every marble's first hit at the playhead's side of the run
	 */
	private revealFirstHits(project: TProject): void {
		const result = this.result;
		const camera = this.$camera.get();
		if (result == null) return;
		const playhead = this.studio.$playhead.get();
		const points: TVec2[] = [];
		for (const entity of project.entities) {
			const release = entity.components.release;
			if (release != null && playhead <= 1e-3) points.push(release.position);
		}
		for (const lane of project.music.lanes) {
			const first = result.hits
				.filter((hit) => hit.laneId === lane.id && hit.dot != null && hit.targetTime >= playhead - 1e-3)
				.sort((a, b) => a.targetTime - b.targetTime)[0];
			if (first?.dot != null) points.push(first.dot);
		}
		const bounds = boundsOf(points);
		if (bounds == null || isBoundsVisible(camera.view, this.$viewport.get(), bounds, 40)) return;
		this.fitAround(project, bounds);
	}

	/** Fits the film frame's width widened to `bounds`, with room below for the fall after them */
	private fitAround(project: TProject, bounds: TBounds | null): void {
		if (bounds == null) return;
		const band = frameBand(project);
		const halfWidth = band.halfWidth * 1.35;
		this.fit({
			minX: Math.min(band.centerX - halfWidth, bounds.minX),
			maxX: Math.max(band.centerX + halfWidth, bounds.maxX),
			minY: bounds.minY - 0.1,
			maxY: bounds.maxY + 0.05
		});
	}

	/** Undo and redo pan to what they changed, like Figma, once the run for the restored revision arrives */
	private revealHistory(result: TSimulationResult | null): void {
		const pending = this.studio.$historyReveal.get();
		if (pending == null || result == null || result.revision < pending.revision) return;
		this.studio.$historyReveal.set(null);
		if (pending.ids.length > 0 && this.$drag.get() == null) this.reveal(pending.ids);
	}

	/**
	 * A typed time or a step to the previous or next hit glides the marble there into view, with Follow on or off:
	 * the hit dots struck at that moment, or the focused marble between hits. Nothing moves when they are already in
	 * view or while playing, when only Follow moves the view.
	 */
	private revealPlayhead(): void {
		const result = this.result;
		if (result == null || this.studio.$playing.get() || this.$drag.get() != null) return;
		const time = this.studio.$playhead.get();
		const struck = struckAt(result.hits, time);
		const focus = struck.length ? undefined : (this.marbleFocus() ?? undefined);
		if (struck.length || focus != null) this.reveal(struck, focus);
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
		if (isBoundsVisible(camera.view, viewport, bounds, 40)) return;
		const fitted = fitBounds(bounds, viewport, canvasPadding);
		this.navigateTo(fitted.scale < camera.view.scale ? fitted : { scale: camera.view.scale, center: fitted.center });
	}

	private onWheel(event: WheelEvent, container: HTMLElement): void {
		event.preventDefault();
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
		this.takeView();
		this.$camera.set((camera) => ({ ...camera, view: panBy(camera.view, -dx * unit, -dy * unit) }));
	}

	// MARK: - Pointer

	onPointerDown(event: React.PointerEvent<HTMLElement>): void {
		const point = localPoint(event);
		// A click places the piece itself; the hover what-if makes way for it
		this.clearHoverPreview();
		const tool = this.$tool.get();
		const isPan = event.button === 1 || tool === 'hand' || this.$spaceHeld.get();
		if (event.button !== 0 && event.button !== 1) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		this.$editingAngle.set(null);

		if (isPan) {
			this.takeView();
			this.$drag.set({ kind: 'pan', last: point });
			this.spacePanned = true;
			return;
		}
		const project = this.project;
		if (project == null) return;
		if (tool === 'path') {
			this.penDown(point);
			return;
		}

		const target = this.pickAt(point);
		if (this.$playNoteFor.get() != null) {
			this.finishPlayNote(target);
			return;
		}
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
				this.startMove(target.entityId, point);
				return;
			}
			case 'dot':
			case 'ghost':
			case 'track':
				this.$drag.set({ kind: 'click', target, start: point });
				return;
		}
		const type = toolPieceType[tool];
		if (type != null) {
			this.startPlace(type, point);
			return;
		}
		if (tool === 'select') {
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
			this.updateHoverPreview(point, hover);
			return;
		}
		const project = this.project;
		switch (drag.kind) {
			case 'pan': {
				const dx = point.x - drag.last.x;
				const dy = point.y - drag.last.y;
				this.$camera.set((camera) => ({ ...camera, view: panBy(camera.view, dx, dy) }));
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
				this.previewWhatIf(withPathPoints(project, drag.entityId, points));
				return;
			}
			case 'release': {
				if (project == null) return;
				const world = this.toWorld(point);
				const position = { x: world.x + drag.offset.x, y: world.y + drag.offset.y };
				this.$drag.set({ ...drag, position, moved: true });
				this.previewWhatIf(withRelease(project, drag.entityId, position));
				this.syncMarbles();
				return;
			}
			case 'marquee': {
				this.$drag.set({ ...drag, to: point });
				const ids = piecesInRect(rectFromPoints(drag.from, point), this.pickScene().pieces);
				this.studio.$selection.set([...new Set([...drag.base, ...ids])]);
				return;
			}
			case 'click': {
				// A placed hit's dot sits on its platform: pressing there and dragging still moves the platform
				const pieceId = drag.target?.kind === 'dot' ? this.placedPieceAt(drag.target.laneId, drag.target.hitId) : null;
				if (pieceId == null || Math.hypot(point.x - drag.start.x, point.y - drag.start.y) < 4) return;
				this.studio.$selection.set([pieceId]);
				this.startMove(pieceId, drag.start);
				return;
			}
		}
	}

	/** The unlocked platform playing a hit, if it has one */
	private placedPieceAt(laneId: string, hitId: string): string | null {
		const id = this.result?.hits.find((hit) => hit.laneId === laneId && hit.hitId === hitId)?.pieceEntityId ?? null;
		return id != null && !this.studio.$locked.get().includes(id) ? id : null;
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
				if (drag.candidate != null && this.commit([{ type: 'upsertEntity', entity: drag.candidate }]) && project != null) this.noticeOfDrop(project, drag);
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

	onPointerLeave(): void {
		if (this.$drag.get() == null) this.$hover.set(null);
		this.clearHoverPreview();
		const pen = this.$pen.get();
		if (pen != null && !pen.isDragging) this.$pen.set({ ...pen, pointer: null });
	}

	private onClick(target: TPick | null, point: TVec2, shiftKey: boolean): void {
		const tool = this.$tool.get();
		if (target?.kind === 'ghost') {
			this.assist.acceptGhosts();
			return;
		}
		if (target?.kind === 'dot') {
			const { laneId, hitId } = target;
			const hit = this.result?.hits.find((item) => item.laneId === laneId && item.hitId === hitId);
			this.$hover.set(null);
			if (hit == null) return;
			if (this.isSceneryTool()) {
				this.addFollower(laneId, hit.targetTime);
				return;
			}
			if (hit.status !== 'open') {
				const key = toHitKey(laneId, hitId);
				const selection = this.studio.$selection.get();
				this.studio.$selection.set(!shiftKey ? [key] : selection.includes(key) ? selection.filter((item) => item !== key) : [...selection, key]);
				return;
			}
			this.clickOpenDot(hit, tool === 'platform');
			if (tool === 'platform') this.$tool.set('select');
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

	/**
	 * A click on an open note's dot selects the hit and shows the platform it would get as a ghost, as the first-run
	 * hint says; a second click, Return or N adds it. A long gap shows what bridges it the same way and a note no
	 * platform can play says why, as Next does. With the Platform tool armed the piece is already chosen, so it is added
	 * at once. The other choices are in the dot's right-click menu.
	 */
	private clickOpenDot(hit: THitResult, isArmed: boolean): void {
		const project = this.project;
		const result = this.result;
		if (project == null || result == null) return;
		if (this.assist.isPreviewing(hit.laneId, hit.hitId)) {
			this.assist.acceptGhosts();
			return;
		}
		const action = dotClickAction(project, result, hit, this.longGapKeys(project).get(`${hit.laneId}:${hit.hitId}`));
		switch (action.kind) {
			case 'explain':
				this.assist.cancelPreview();
				this.assist.explainUnreachable(project, result, hit);
				return;
			case 'bridge':
				this.assist.previewGap(hit, action.fromHitId);
				return;
			case 'preview':
				if (isArmed) this.placePlatform(hit);
				else this.assist.preview(hit, action.type);
		}
	}

	/** What a pointer at `point` would act on, in canvas pixels */
	pickAt(point: TVec2): TPick | null {
		const picked = pick(point, this.pickScene());
		const ghost = this.assist.clickableGhost;
		if (ghost != null && picked?.kind !== 'dot' && this.$tool.get() === 'select' && isOnGhost(point, this.screenOutline(ghost))) return { kind: 'ghost' };
		if (picked != null || !this.isSceneryTool()) return picked;
		// Windmills and switchbacks can also start anywhere on a trajectory, not only at a hit
		return pickTrack(point, this.screenTrackPoints());
	}

	/** Piece type a click or Next places on a hit: always a platform, the only music piece */
	placementType(): string {
		return 'platform';
	}

	/** True for a scenery tool (windmill, switchback, finish), which anchors its piece where the trajectory is clicked */
	isSceneryTool(): boolean {
		const tool = this.$tool.get();
		return tool === 'windmill' || tool === 'switchback' || tool === 'finish';
	}

	/** Arms a tool; the path tool takes the piece it draws, a rail unless asked for a tunnel */
	armTool(tool: TComposeTool, pathType: TPathType = 'rail'): void {
		const pen = this.$pen.get();
		if (tool === 'path' && pathType !== this.$pathType.get()) {
			this.$pathType.set(pathType);
			// A path in progress takes the new type and the name that goes with it
			if (pen != null) {
				this.$pen.set({ ...pen, id: null });
				this.previewPen();
			}
		}
		this.$tool.set(tool);
		this.$libraryOpen.set(false);
	}

	// MARK: - Insert library

	/** A library item dragged out of the Insert popover, shown on the canvas while the pointer is over it */
	private insertDrag: TInsertDrag | null = null;

	/** A click on a library tile arms the tool that places it */
	armInsert(item: TInsertItem): void {
		const { tool, pathType } = insertTool(item);
		this.armTool(tool, pathType);
	}

	beginInsertDrag(item: TInsertItem): void {
		// Snap targets come from the run before the drop, like a move
		const dots = (this.result?.hits ?? []).flatMap((hit) =>
			hit.dot != null && hit.status === 'open' ? [{ laneId: hit.laneId, hitId: hit.hitId, dot: hit.dot, velocity: hit.velocity, screen: this.toScreen(hit.dot) }] : []
		);
		this.insertDrag = { item, entity: null, candidate: null, at: null, dots, tracks: this.screenTrackPoints() };
		this.$libraryOpen.set(false);
		this.$inserting.set(item);
	}

	/**
	 * Moves the dragged item to a client point. Over the wall a piece shows where it would land, with the
	 * snap, link and anchor rules of a move; ⌥ drops it free. Returns true when the canvas shows the piece.
	 */
	moveInsertDrag(client: TVec2, isFree: boolean): boolean {
		const drag = this.insertDrag;
		const project = this.project;
		const rect = this.container?.getBoundingClientRect();
		if (drag == null || project == null || rect == null) return false;
		const point = { x: client.x - rect.left, y: client.y - rect.top };
		const isOver = point.x >= 0 && point.y >= 0 && point.x <= rect.width && point.y <= rect.height;
		if (!isOver) {
			if (drag.candidate != null) {
				this.$override.set(null);
				this.studio.simulation.endPreview();
			}
			drag.candidate = null;
			drag.at = null;
			this.$insertSnap.set(null);
			return false;
		}
		const world = this.toWorld(point);
		drag.at = world;
		if (drag.item === 'marble') return false;
		const pose = { position: world, angle: 0 };
		// Rails and tunnels get their default run as an explicit path, so switching the type keeps the shape
		const path = isPathPieceType(drag.item) ? { points: resolvePiecePath(drag.item, undefined).map((item) => ({ ...item })) } : undefined;
		const entity = drag.entity ?? createFreePiece(drag.item, pose, project.entities, path);
		drag.entity = entity;
		const snap = !isFree && this.studio.$snapping.get() ? this.findSnap(entity, pose, drag) : null;
		// A marble has one Finish: dropped on its fall, the marble's own Finish moves there
		const snapped = withSnap(project, entity, pose, snap);
		const candidate = layoutOf(snapped.components.piece?.type ?? '') === 'catcher' && snapped.components.hitLink != null ? asLaneFinish(project, snapped, snap?.kind === 'anchor' ? this.velocityAt(snap.laneId, snap.time) : null) : snapped;
		const radius = this.marbleRadius(snap?.laneId);
		this.$override.set(snap?.kind === 'link' ? displayPiece(candidate, { pose, dot: snap.dot, velocity: snap.velocity }, radius) : displayPiece(candidate, { pose }, radius));
		this.$insertSnap.set({ position: world, snap });
		drag.candidate = candidate;
		this.previewWhatIf(withEntity(project, candidate));
		return true;
	}

	/** Drops the dragged item where the pointer is over the wall, or cancels it */
	endInsertDrag(isDrop: boolean): void {
		const drag = this.insertDrag;
		this.insertDrag = null;
		this.$inserting.set(null);
		this.$insertSnap.set(null);
		if (drag == null) return;
		if (drag.item === 'marble') {
			if (isDrop && drag.at != null && this.studio.addMarble(drag.at) != null) this.$tool.set('select');
			return;
		}
		const candidate = drag.candidate;
		this.studio.simulation.endPreview();
		if (!isDrop || candidate == null) {
			this.$override.set(null);
			return;
		}
		if (this.commit([{ type: 'upsertEntity', entity: candidate }])) {
			this.studio.$selection.set([candidate.id]);
			this.$tool.set('select');
		}
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

	/** The marble's velocity at `time` on the shown run, or null */
	private velocityAt(laneId: string, time: number): TVec2 | null {
		const project = this.project;
		const samples = this.result?.marbles.find((track) => track.laneId === laneId)?.samples ?? [];
		return project != null ? (trajectoryAt(samples, time, gravityOf(project))?.velocity ?? null) : null;
	}

	/** Adds a scenery piece the marble meets at `time`, chosen by clicking its trajectory or a dot */
	private addFollower(laneId: string, time: number): void {
		const made = this.followerFor(laneId, time);
		this.clearHoverPreview();
		if (made == null) return;
		if ('error' in made) {
			this.studio.notify(made.error);
			return;
		}
		const { entity } = made;
		if (!this.studio.execute([{ type: 'upsertEntity', entity }])) return;
		this.studio.$selection.set([entity.id]);
		this.$tool.set('select');
		if (!this.studio.$playing.get()) this.studio.$playhead.set(time);
	}

	/**
	 * The scenery piece the armed tool adds where the marble is at `time`, or why none fits. A windmill sits
	 * beside the fall, its arms clear of every marble's path, so adding one keeps the run; dragging it into the
	 * path afterwards makes the marble turn it. A switchback is laid out against the marble, since it holds it.
	 */
	private followerFor(laneId: string, time: number): { entity: TEntity; pose: TPose | null } | { error: string } | null {
		const project = this.project;
		const result = this.result;
		const type = toolPieceType[this.$tool.get()] ?? 'windmill';
		const samples = result?.marbles.find((track) => track.laneId === laneId)?.samples ?? [];
		const at = project != null ? trajectoryAt(samples, time, gravityOf(project)) : null;
		if (project == null || result == null || at == null) return null;
		if (layoutOf(type) === 'rotor') {
			const free = createFreePiece(type, { position: at.position, angle: 0 }, project.entities);
			const params = resolvePieceParams(type, free.components.piece?.params ?? {});
			const reach = (params['hubRadius'] ?? 0) + (params['bladeLength'] ?? 0);
			const position = clearRotorPosition(project, result, at, reach, laneId);
			const pose = { position, angle: 0 };
			// Before the lane's first hit the piece follows the marble from its release, counted back from that hit
			const entity = asAnchored(project, free, pose, laneId, time, at.position);
			return entity != null ? { entity, pose } : { error: "A piece can follow this marble only after its first hit. Drop it lower on the marble's fall." };
		}
		const [isOk, error, follower] = followerAt(project, laneId, type, time, at.position, at.velocity);
		if (isOk) return { entity: follower, pose: null };
		// Laid out against the marble the way a follower is
		const free = createFreePiece(type, { position: at.position, angle: 0 }, project.entities);
		const met = displayPiece(free, { pose: { position: at.position, angle: 0 }, dot: at.position, velocity: at.velocity }, this.marbleRadius(laneId));
		const pose = { position: met.position, angle: met.angle };
		const entity = asAnchored(project, free, pose, laneId, time, at.position);
		return entity != null ? { entity, pose } : { error: error.message };
	}

	// MARK: - What-if

	/** The run before the latest what-if started, which the "Breaks 86 hits" count compares the preview with */
	private whatIfBase: TSimulationResult | null = null;
	/** The piece an armed tool would add under the pointer, simulated as a what-if before the click */
	private hoverPreview: { key: string; entityId: string } | null = null;
	/** Screen point of the hover what-if, where its count shows */
	readonly $hoverPreview = createState<{ position: TVec2; label: string | null } | null>(null);

	/** Simulates `project` as a what-if in place of the run, remembering the run it is compared with */
	private previewWhatIf(project: TProject): void {
		const simulation = this.studio.simulation;
		if (!simulation.isPreviewing) this.whatIfBase = simulation.isCurrent ? this.result : null;
		simulation.startPreview(project);
	}

	/**
	 * How many hits the shown what-if breaks compared with the run before it, or null while there is no what-if
	 * or its run has not arrived yet
	 */
	whatIfBreaks(result: TSimulationResult | null = this.result): number | null {
		const base = this.whatIfBase;
		if (!this.studio.simulation.isPreviewing || base == null || result == null || result === base) return null;
		return newlyBroken(base.hits, result.hits).length;
	}

	/**
	 * While an armed Windmill or Switchback hovers over a trajectory or a dot, or the Platform tool over a
	 * trajectory, shows the piece a click would add and the run with it, like a drag's what-if
	 */
	private updateHoverPreview(point: TVec2, hover: TPick | null): void {
		const project = this.project;
		const result = this.result;
		const tool = this.$tool.get();
		if (project == null || result == null || this.$pen.get() != null) {
			this.clearHoverPreview();
			return;
		}
		if (this.isSceneryTool() && (hover?.kind === 'track' || hover?.kind === 'dot')) {
			const time = hover.kind === 'track' ? hover.time : result.hits.find((hit) => hit.laneId === hover.laneId && hit.hitId === hover.hitId)?.targetTime;
			if (time == null) return this.clearHoverPreview();
			const key = `${tool}:${hover.laneId}:${time.toFixed(3)}`;
			if (key === this.hoverPreview?.key) return;
			const made = this.followerFor(hover.laneId, time);
			if (made == null || 'error' in made) return this.clearHoverPreview();
			const lane = project.music.lanes.find((item) => item.id === hover.laneId)?.name ?? 'Marble';
			this.showHoverPreview(key, made.entity, made.pose, hover.kind === 'track' ? hover.position : point, hover.kind === 'dot' ? `Follows ${lane} at ${formatTime(time)}` : null);
			return;
		}
		if (tool === 'platform' && hover == null) {
			// A click on the wall drops a free platform; near a trajectory it changes the run
			const halfLength = ((resolvePieceParams('platform', {})['length'] ?? 0.09) / 2) * this.$camera.get().view.scale;
			if (pickTrack(point, this.screenTrackPoints(), Math.max(TRACK_PICK_RADIUS, halfLength + 6)) == null) return this.clearHoverPreview();
			const key = `platform:${Math.round(point.x)}:${Math.round(point.y)}`;
			if (key === this.hoverPreview?.key) return;
			const pose = { position: this.toWorld(point), angle: 0 };
			this.showHoverPreview(key, createFreePiece('platform', pose, project.entities), pose, point, null);
			return;
		}
		this.clearHoverPreview();
	}

	private showHoverPreview(key: string, entity: TEntity, pose: TPose | null, position: TVec2, label: string | null): void {
		const project = this.project;
		if (project == null) return;
		this.hoverPreview = { key, entityId: entity.id };
		const laneId = entity.components.hitLink?.laneId;
		this.$override.set(pose != null ? displayPiece(entity, { pose }, this.marbleRadius(laneId)) : null);
		this.$hoverPreview.set({ position, label });
		this.previewWhatIf(withEntity(project, entity));
	}

	private clearHoverPreview(): void {
		if (this.hoverPreview == null) return;
		this.hoverPreview = null;
		this.$hoverPreview.set(null);
		if (this.$drag.get() == null) this.$override.set(null);
		this.studio.simulation.endPreview();
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

	/** Selecting one piece moves the playhead to its hit, unless playing */
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
		const link = entity.components.hitLink;
		const plays = link != null && soundsHit(entity.components.piece?.type ?? '', link) ? { laneId: link.laneId, hitId: link.hitId, dot: this.result?.hits.find((hit) => hit.laneId === link.laneId && hit.hitId === link.hitId)?.dot ?? null } : null;
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
			tracks: this.screenTrackPoints(),
			plays,
			playsDrop: null,
			origin: resolved ?? null
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
		const found = !isFree && this.studio.$snapping.get() ? this.findSnap(entity, pose, drag) : null;
		const reach = Math.max(KEEP_PLAYS_REACH, 120 / this.$camera.get().view.scale);
		const drop = drag.plays != null ? playsDrop(drag.plays, drag.pose.position, pose.position, found, { isFree, reach }) : null;
		// A platform near its note keeps playing it, wherever a trajectory runs past
		const snap = drop === 'keeps' ? null : found;
		const radius = this.marbleRadius(snap?.laneId ?? drag.plays?.laneId);
		const candidate = drop === 'keeps' ? asPinned(entity, pose, radius) : withSnap(project, entity, pose, snap);
		const display = snap?.kind === 'link' ? displayPiece(candidate, { pose, dot: snap.dot, velocity: snap.velocity }, radius) : displayPiece(candidate, { pose }, radius);
		this.$override.set(display);
		this.$drag.set({ ...drag, current: pose, snap, candidate, moved: true, playsDrop: drop });
		this.previewWhatIf(withEntity(project, candidate));
	}

	/** A drop that changed which note a platform plays says so, with Undo */
	private noticeOfDrop(project: TProject, drag: TMoveDrag): void {
		const name = project.entities.find((entity) => entity.id === drag.entityId)?.name ?? 'The platform';
		if (drag.plays != null && drag.playsDrop === 'frees') this.studio.notifyEdit(`${name} no longer plays ${noteLabel(project, drag.plays.laneId, drag.plays.hitId)}`);
		else if (drag.playsDrop === 'otherNote' && drag.snap?.kind === 'link') this.studio.notifyEdit(`${name} now plays ${noteLabel(project, drag.snap.laneId, drag.snap.hitId)}`);
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
		const reach = Math.max(14, Math.min(halfLength, 40), bladeReach);
		// A bar also anchors where either end crosses the trajectory, so long platforms at a close zoom snap too
		const tangent = { x: Math.cos(pose.angle) * halfLength, y: -Math.sin(pose.angle) * halfLength };
		const probes = layoutOf(type) === 'box' ? [center, { x: center.x - tangent.x, y: center.y - tangent.y }, { x: center.x + tangent.x, y: center.y + tangent.y }] : [center];
		let near: TPick | null = null;
		let nearDistance = Number.POSITIVE_INFINITY;
		for (const probe of probes) {
			const found = pickTrack(probe, drag.tracks, probe === center ? reach : TRACK_PICK_RADIUS);
			const distance = found?.kind === 'track' ? Math.hypot(found.position.x - probe.x, found.position.y - probe.y) : Number.POSITIVE_INFINITY;
			if (distance < nearDistance) {
				near = found;
				nearDistance = distance;
			}
		}
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
		this.previewWhatIf(withEntity(project, candidate));
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
		this.previewWhatIf(withEntity(project, candidate));
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
		this.previewWhatIf(withPieceAngles(project, new Map([[drag.entityId, angle]])));
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
		this.previewWhatIf(withEntity(project, candidate));
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
		const entity = createFreePiece(this.$pathType.get(), { position: first.point, angle: 0 }, project.entities, railPath(local));
		return pen.id != null ? { ...entity, id: pen.id.id, name: pen.id.name } : entity;
	}

	private previewPen(): void {
		const project = this.project;
		let pen = this.$pen.get();
		if (project == null || pen == null) return;
		const entity = this.penEntity(pen, true);
		if (entity == null) return;
		if (pen.id == null) {
			pen = { ...pen, id: { id: entity.id, name: entity.name ?? 'Path' } };
			this.$pen.set(pen);
		}
		const transform = entity.components.transform;
		if (transform != null) this.$override.set(displayPiece(entity, { pose: transform }, this.marbleRadius()));
		this.previewWhatIf(withEntity(project, entity));
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
			this.studio.notify('Every note already has a platform');
			return;
		}
		commitAtHit(this.studio, target, pieceForHit(project, target, this.placementType(), mode));
		this.revealPoint(target.dot);
	}

	/** Rotates the selected pieces by `degrees`, as one edit */
	nudge(degrees: number): boolean {
		const project = this.project;
		if (project == null) return false;
		const ids = this.tiltTargets(project);
		const angles = new Map<string, number>();
		for (const entity of project.entities) {
			const angle = pieceAngle(entity);
			if (angle != null && ids.includes(entity.id)) angles.set(entity.id, angle + toRadians(degrees));
		}
		if (!angles.size) return false;
		// A hold or a quick run of presses is one undo step
		const now = performance.now();
		const group = this.lastNudge != null && now - this.lastNudge.at < NUDGE_FOLD_MS ? this.lastNudge.group : undefined;
		this.studio.execute(pieceAngleCommands(project, angles), { group });
		this.lastNudge = { at: now, group: this.studio.editGroup ?? 0 };
		return true;
	}

	private lastNudge: { at: number; group: number } | null = null;

	/** What ↑ ↓ tilt: the selected pieces and the platforms of the selected hits */
	private tiltTargets(project: TProject): string[] {
		const selection = this.studio.$selection.get();
		const ofHits = selection.flatMap((key) => {
			const parsed = parseHitKey(key);
			if (parsed == null) return [];
			const piece = project.entities.find((entity) => entity.components.piece != null && entity.components.hitLink?.laneId === parsed.laneId && entity.components.hitLink.hitId === parsed.hitId && soundsHit(entity.components.piece.type, entity.components.hitLink));
			return piece == null ? [] : [piece.id];
		});
		return [...selectedPieceIds(project, selection), ...ofHits];
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
		if (isBoundsVisible(camera.view, viewport, bounds, inset)) return;
		this.navigateTo({ ...camera.view, center: { x: point.x, y: point.y } });
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
			// A selected Song or Camera track is no Next target, so Return keeps its timeline meaning there
			hasSelection: selection.some((key) => key !== SONG_KEY && key !== CAMERA_KEY),
			hasGhosts: this.assist.hasGhosts,
			canTilt: project != null && this.tiltTargets(project).length > 0,
			isDrawing: this.$pen.get() != null,
			hasNotes: selection.length > 0 && selection.every((key) => parseHitKey(key) != null)
		});
		if (action == null) return;
		if (this.runKeyAction(action)) event.preventDefault();
	}

	/** Runs a keyboard action; returns false when it did nothing, so the key falls through */
	runKeyAction(action: TComposeKeyAction): boolean {
		switch (action.type) {
			case 'follow':
				this.toggleFollow();
				return true;
			case 'zoom':
				this.zoomBy(action.factor);
				return true;
			case 'zoom100':
				this.zoomTo100();
				return true;
			case 'fit':
				if (action.target === 'all') this.fitAll();
				else if (action.target === 'frame') this.fitFrame();
				else this.fitSelection();
				return true;
			case 'tool':
				this.armTool(action.tool, action.pathType);
				return true;
			case 'library':
				this.$libraryOpen.set(!this.$libraryOpen.get());
				return true;
			case 'next':
				this.next();
				return true;
			case 'buildTrack':
				void this.assist.buildTrack();
				return true;
			case 'acceptGhosts':
				return this.assist.acceptGhosts();
			case 'escape':
				this.escape();
				return true;
			case 'delete':
				return this.deleteSelection();
			case 'nudge':
				return this.nudge(action.degrees);
			case 'repeat':
				this.step('repeat');
				return true;
			case 'mirror':
				this.step('mirror');
				return true;
			case 'autoPlace':
				this.assist.autoPlace(this.placementType());
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

	/** Play a Note…: the next click on a note's dot links this platform to that note */
	armPlayNote(entityId: string): void {
		if (!this.result?.hits.some((hit) => hit.status === 'open')) {
			this.studio.notify('Every note already has a platform; Detach one to open its note');
			return;
		}
		this.$tool.set('select');
		this.$playNoteFor.set(entityId);
	}

	private finishPlayNote(target: TPick | null): void {
		const entityId = this.$playNoteFor.get();
		this.$playNoteFor.set(null);
		const project = this.project;
		const result = this.result;
		if (entityId == null || target?.kind !== 'dot' || project == null || result == null) return;
		const [isOk, error, value] = linkPieceToHit(project, result, entityId, target.laneId, target.hitId);
		if (!isOk) this.studio.notify(error.message);
		else this.studio.execute(value.commands);
	}

	/** Escape cancels a drag or a rail in progress, then dismisses ghosts, then leaves a tool, then clears the selection */
	escape(): void {
		if (this.$playNoteFor.get() != null) {
			this.$playNoteFor.set(null);
		} else if (this.assist.$queuedNext.get() > 0) {
			this.assist.clearQueuedNext();
		} else if (this.insertDrag != null) {
			this.endInsertDrag(false);
		} else if (this.$libraryOpen.get()) {
			this.$libraryOpen.set(false);
		} else if (this.$drag.get() != null) {
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
		this.renderer.setPieces(
			this.displayPieces().map((piece) => ({
				piece,
				angle: pieceAngleAt(piece, playhead)
			}))
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

/** "Hit 3 · C4", as the Plays row names a hit */
export function noteLabel(project: TProject, laneId: string, hitId: string): string {
	const hits = project.music.lanes.find((lane) => lane.id === laneId)?.hits ?? [];
	const index = hits.findIndex((hit) => hit.id === hitId);
	const pitch = hits[index]?.pitch;
	return `Hit ${index + 1}${pitch != null ? ` · ${noteName(pitch)}` : ''}`;
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
	/** The note a platform plays at the start of the drag, with its dot, for the live timing and the ghost */
	plays: { laneId: string; hitId: string; dot: TVec2 | null } | null;
	/** What a drop does to that note, once the pointer moved */
	playsDrop: TPlaysDrop | null;
	/** The piece where the drag began, drawn as a ghost while a platform that plays a note moves */
	origin: TResolvedPiece | null;
}

interface TInsertDrag {
	item: TInsertItem;
	/** The new piece, created when the pointer first reaches the wall so it keeps one id */
	entity: TEntity | null;
	candidate: TEntity | null;
	/** Wall point under the pointer, null while it is outside the canvas */
	at: TVec2 | null;
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
	| { kind: 'pan'; last: TVec2 }
	| TRotateDrag
	| TMoveDrag
	| TPlaceDrag
	| TNodeDrag
	| { kind: 'release'; entityId: string; offset: TVec2; position: TVec2; moved: boolean }
	| { kind: 'path'; entityId: string; handle: 'end' | 'bend'; points: TVec2[]; start: TVec2[]; moved: boolean }
	| { kind: 'marquee'; from: TVec2; to: TVec2; base: string[] }
	| { kind: 'click'; target: TPick | null; start: TVec2 };

/** Longest time a newly opened project's wall stays hidden while its first run frames it */
const OPENING_WAIT_MS = 400;

/** Zoom to Fit stops zooming out where a default platform is this many CSS pixels long */
const MIN_FIT_PLATFORM_PX = 24;

// Keeps framed content clear of the corner controls and the contextual bar
const canvasPadding: TPadding = { top: 56, right: 56, bottom: 72, left: 56 };

/**
 * Each marble's release and where its free fall from there reaches its first note: what the run's first hits
 * will show, known before the run, so an opened project is framed once
 */
function openingPoints(project: TProject): TVec2[] {
	const gravity = gravityOf(project);
	const points: TVec2[] = [];
	for (const entity of project.entities) {
		const { release, marble } = entity.components;
		if (release == null || marble == null) continue;
		points.push(release.position);
		const first = project.music.lanes.find((lane) => lane.id === marble.laneId)?.hits.reduce<number | null>((min, hit) => (min == null || hit.time < min ? hit.time : min), null);
		if (first == null) continue;
		const fall = Math.max(0, first - release.time);
		points.push({ x: release.position.x, y: release.position.y + 0.5 * gravity * fall * fall });
	}
	return points;
}

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

// ↑ ↓ presses this close together fold into one undo step
const NUDGE_FOLD_MS = 700;

const FOLLOW_KEY = 'midimarble-v4:follow';

function prefersReducedMotion(): boolean {
	return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Follow is view state: remembered per project on this device, never saved in the project file */
function readFollow(projectId: string): boolean {
	try {
		const stored = JSON.parse(localStorage.getItem(FOLLOW_KEY) ?? '{}') as unknown;
		return typeof stored === 'object' && stored != null && (stored as Record<string, unknown>)[projectId] === true;
	} catch {
		return false;
	}
}

function writeFollow(projectId: string, isOn: boolean): void {
	try {
		const stored = JSON.parse(localStorage.getItem(FOLLOW_KEY) ?? '{}') as Record<string, boolean>;
		const kept = Object.fromEntries(Object.entries(stored).filter(([id]) => id !== projectId));
		localStorage.setItem(FOLLOW_KEY, JSON.stringify(isOn ? { ...kept, [projectId]: true } : kept));
	} catch {
		// Storage can be unavailable; Follow then starts off next time
	}
}
