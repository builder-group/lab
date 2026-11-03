import { createState } from 'feature-state';
import type React from 'react';
import * as THREE from 'three';
import type { TProject, TVec2 } from '@/modules/project';
import { frameBand, type TResolvedPiece, type TSimulationResult } from '@/modules/simulation';
import { parseHitKey } from '@/modules/studio/selection';
import type { StudioCx } from '@/modules/studio/StudioCx';
import { dragRotation, screenAngle, toRadians, type TRotationDrag } from './angles';
import { ComposeRenderer, MARBLE_Z, type TComposeCamera } from './ComposeRenderer';
import { pick, piecesInRect, rectFromPoints, type TPick, type TPickScene } from './picking';
import { boundsOfPieces, contentBounds, marblePositionAt, pieceCorners, rotationGrip, trackBuffers } from './scene';
import {
	findStepTarget,
	focusHit,
	pieceAngleCommands,
	pinCommands,
	placeAtHit,
	selectedPieceIds,
	withPieceAngles,
	type TStepMode
} from './step-loop';
import {
	boundsOf,
	fitBounds,
	gridLayers,
	isBoundsVisible,
	panBy,
	screenToWorld,
	zoomAt,
	type TBounds,
	type TPadding,
	type TViewport
} from './view';

/** Owns the Compose canvas: camera, tools, pointer and keyboard interaction and the WebGL renderer */
export class ComposeCx {
	readonly $camera = createState<TComposeCamera>({ mode: '2d', view: { center: { x: 0, y: 0.4 }, scale: 900 }, yaw: -0.55, pitch: 0.28 });
	readonly $viewport = createState<TViewport>({ width: 0, height: 0 });
	readonly $tool = createState<TComposeTool>('select');
	/** Piece type that clicking a dot places */
	readonly $pieceType = createState('platform');
	readonly $hover = createState<TPick | null>(null);
	readonly $drag = createState<TComposeDrag | null>(null);
	readonly $spaceHeld = createState(false);
	/** Entity whose angle readout is being typed into */
	readonly $editingAngle = createState<string | null>(null);

	private renderer: ComposeRenderer | null = null;
	private framedProjectId: string | null = null;
	private spacePanned = false;
	private trackCache = new WeakMap<object, { points: Float32Array; times: Float32Array }>();

	constructor(readonly studio: StudioCx) {}

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
			}),
			this.$viewport.listen(updateGrid),
			this.studio.simulation.$result.subscribe(() => {
				this.syncTracks();
				this.syncPieces();
				this.syncMarbles();
				this.syncGuides();
				this.frameIfNeeded();
			}),
			this.studio.$playhead.subscribe(({ value }) => {
				renderer.setPlayhead(value);
				this.syncPieces();
				this.syncMarbles();
			}),
			this.studio.$history.listen(() => {
				// Release positions show immediately, before the new result arrives
				this.syncMarbles();
				this.syncGuides();
			}),
			this.studio.$selection.listen(() => this.syncPieces()),
			this.studio.$reveal.listen(({ value }) => {
				if (value != null) this.reveal(value.ids);
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

		return () => {
			for (const cleanup of cleanups) cleanup();
			this.studio.simulation.endPreview();
			renderer.dispose();
			this.renderer = null;
		};
	}

	// MARK: - Projection

	/** CSS pixel position inside the canvas of a wall point at depth `z` */
	toScreen(point: TVec2, z = MARBLE_Z): TVec2 {
		const renderer = this.renderer;
		if (renderer == null) return point;
		return renderer.project(point, z);
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

	screenCorners(piece: TResolvedPiece): TVec2[] {
		const depth = piece.params['depth'] ?? 0.03;
		return pieceCorners(piece).map((corner) => this.toScreen(corner, depth));
	}

	pickScene(): TPickScene {
		const project = this.project;
		const result = this.result;
		const scene: TPickScene = { handles: [], dots: [], pieces: [] };
		if (project == null || result == null) return scene;
		const is2d = this.$camera.get().mode === '2d';
		const selected = selectedPieceIds(project, this.studio.$selection.get());
		for (const piece of result.pieces) scene.pieces.push({ entityId: piece.entityId, corners: this.screenCorners(piece) });
		for (const hit of result.hits) {
			if (hit.status === 'open' && hit.dot != null) {
				scene.dots.push({ laneId: hit.laneId, hitId: hit.hitId, position: this.toScreen(hit.dot) });
			}
		}
		if (!is2d) return scene;
		for (const entity of project.entities) {
			const release = entity.components.release;
			if (release == null || entity.components.marble == null) continue;
			scene.handles.push({ kind: 'release', entityId: entity.id, position: this.toScreen(release.position), radius: 9 });
		}
		const single = selected.length === 1 ? result.pieces.find((piece) => piece.entityId === selected[0]) : undefined;
		if (single?.contactPoint != null) {
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

	fitSelection(): void {
		const project = this.project;
		const result = this.result;
		if (project == null || result == null) return;
		const selection = this.studio.$selection.get();
		const pieces = result.pieces.filter((piece) => selection.includes(piece.entityId));
		const points: TVec2[] = pieces.flatMap(pieceCorners);
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
		this.$camera.set((camera) => ({ ...camera, mode }));
		this.$hover.set(null);
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
		this.fitAll();
	}

	/** Pans to entities that are out of view, keeping the zoom unless they do not fit */
	private reveal(ids: string[]): void {
		const result = this.result;
		if (result == null) return;
		const bounds = boundsOfPieces(result.pieces.filter((piece) => ids.includes(piece.entityId)));
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
		const isPan =
			event.button === 1 || this.$tool.get() === 'hand' || this.$spaceHeld.get() || (camera.mode === 'orbit' && event.button === 0 && this.pickAt(point) == null);
		if (event.button !== 0 && event.button !== 1) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		this.$editingAngle.set(null);

		if (isPan) {
			// In orbit, dragging turns the camera unless Shift or the hand tool asks for a pan
			const orbit = camera.mode === 'orbit' && !event.shiftKey && this.$tool.get() !== 'hand' && !this.$spaceHeld.get();
			this.$drag.set({ kind: 'pan', last: point, orbit });
			this.spacePanned = true;
			return;
		}

		const target = this.pickAt(point);
		const project = this.project;
		if (project == null) return;

		if (target?.kind === 'rotate') {
			const piece = this.result?.pieces.find((item) => item.entityId === target.entityId);
			const link = project.entities.find((entity) => entity.id === target.entityId)?.components.hitLink;
			if (piece == null || link == null) return;
			const { pivot } = this.screenGrip(piece);
			const drag: TRotationDrag = { startAngle: link.angle, startPointer: screenAngle(pivot, point) };
			this.$drag.set({ kind: 'rotate', entityId: target.entityId, pivot, drag, angle: link.angle, pointer: point });
			return;
		}
		if (target?.kind === 'release') {
			const release = project.entities.find((entity) => entity.id === target.entityId)?.components.release;
			if (release == null) return;
			const world = screenToWorld(camera.view, this.$viewport.get(), point);
			const offset = { x: release.position.x - world.x, y: release.position.y - world.y };
			this.$drag.set({ kind: 'release', entityId: target.entityId, offset, position: release.position, moved: false });
			return;
		}
		if (target?.kind === 'piece') {
			const selection = this.studio.$selection.get();
			if (event.shiftKey) {
				const has = selection.includes(target.entityId);
				this.studio.$selection.set(has ? selection.filter((id) => id !== target.entityId) : [...selection, target.entityId]);
			} else if (!selection.includes(target.entityId)) {
				this.studio.$selection.set([target.entityId]);
			}
			this.$drag.set({ kind: 'click', target, start: point });
			return;
		}
		if (target?.kind === 'dot') {
			this.$drag.set({ kind: 'click', target, start: point });
			return;
		}
		if (this.$tool.get() === 'select' && camera.mode === '2d') {
			const base = event.shiftKey ? this.studio.$selection.get() : [];
			this.$drag.set({ kind: 'marquee', from: point, to: point, base });
			return;
		}
		this.$drag.set({ kind: 'click', target: null, start: point });
	}

	onPointerMove(event: React.PointerEvent<HTMLElement>): void {
		const point = localPoint(event);
		const drag = this.$drag.get();
		if (drag == null) {
			const hover = this.$spaceHeld.get() || this.$tool.get() === 'hand' ? null : this.pickAt(point);
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
			case 'rotate': {
				if (project == null) return;
				const angle = dragRotation(drag.drag, drag.pivot, point, event.shiftKey);
				this.$drag.set({ ...drag, angle, pointer: point });
				this.studio.simulation.startPreview(withPieceAngles(project, new Map([[drag.entityId, angle]])));
				return;
			}
			case 'release': {
				if (project == null) return;
				const world = screenToWorld(this.$camera.get().view, this.$viewport.get(), point);
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
		this.$drag.set(null);
		if (drag == null) return;
		const project = this.project;
		switch (drag.kind) {
			case 'pan':
				return;
			case 'rotate': {
				if (project != null) this.studio.execute(pieceAngleCommands(project, new Map([[drag.entityId, drag.angle]])));
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
				if (drag.target?.kind === 'dot') {
					const { laneId, hitId } = drag.target;
					const hit = this.result?.hits.find((item) => item.laneId === laneId && item.hitId === hitId);
					if (hit != null) placeAtHit(this.studio, hit, this.$pieceType.get());
					this.$hover.set(null);
					return;
				}
				if (drag.target?.kind === 'piece' && !event.shiftKey) this.studio.$selection.set([drag.target.entityId]);
				if (drag.target == null) this.studio.$selection.set([]);
				return;
			}
		}
	}

	onPointerLeave(): void {
		if (this.$drag.get() == null) this.$hover.set(null);
	}

	private pickAt(point: TVec2): TPick | null {
		return pick(point, this.pickScene());
	}

	// MARK: - Step loop

	/** Return: on a piece, moves to the next open dot of its marble; on a focused dot, places a piece there */
	accept(): boolean {
		const project = this.project;
		const result = this.result;
		if (project == null || result == null) return false;
		const selection = this.studio.$selection.get();
		const target = findStepTarget(project, result, selection);
		const focusedKey = selection.length === 1 ? parseHitKey(selection[0] ?? '') : null;
		const isFocused = target != null && focusedKey?.laneId === target.laneId && focusedKey.hitId === target.hitId;
		if (isFocused) {
			placeAtHit(this.studio, target, this.$pieceType.get());
			return true;
		}
		if (!selectedPieceIds(project, selection).length) return false;
		if (target == null) {
			this.studio.notify('Every reachable hit of this marble has a piece');
			return true;
		}
		focusHit(this.studio, target);
		this.revealPoint(target.dot);
		return true;
	}

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
		placeAtHit(this.studio, target, this.$pieceType.get(), mode);
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
			const link = entity.components.hitLink;
			if (link != null && ids.includes(entity.id)) angles.set(entity.id, link.angle + toRadians(degrees));
		}
		if (!angles.size) return false;
		this.studio.execute(pieceAngleCommands(project, angles));
		return true;
	}

	deleteSelection(): boolean {
		const project = this.project;
		if (project == null) return false;
		const selection = this.studio.$selection.get();
		const ids = selectedPieceIds(project, selection);
		if (!ids.length) return false;
		if (!this.studio.execute([{ type: 'removeEntities', entityIds: ids }])) return false;
		this.studio.$selection.set(selection.filter((id) => !ids.includes(id)));
		return true;
	}

	private revealPoint(point: TVec2 | null): void {
		if (point == null) return;
		const camera = this.$camera.get();
		const viewport = this.$viewport.get();
		const margin = 0.03;
		const bounds = { minX: point.x - margin, minY: point.y - margin, maxX: point.x + margin, maxY: point.y + margin };
		if (camera.mode !== '2d' || isBoundsVisible(camera.view, viewport, bounds, 60)) return;
		this.$camera.set({ ...camera, view: { ...camera.view, center: { x: point.x, y: point.y } } });
	}

	// MARK: - Keyboard

	private onKeyDown(event: KeyboardEvent): void {
		if (isTyping(event) || this.studio.$workspace.get() !== 'compose') return;
		const key = event.key.toLowerCase();

		if (event.metaKey && !event.ctrlKey && !event.altKey) {
			if (key === '=' || key === '+') this.handled(event, () => this.zoomBy(2));
			else if (key === '-') this.handled(event, () => this.zoomBy(0.5));
			return;
		}
		if (event.metaKey || event.ctrlKey || event.altKey) return;

		if (event.shiftKey && (event.code === 'Digit1' || event.code === 'Digit2')) {
			this.handled(event, () => (event.code === 'Digit1' ? this.fitAll() : this.fitSelection()));
			return;
		}
		if (event.key === ' ') {
			// Space and drag pans like Figma; a plain press still plays and pauses on release
			event.preventDefault();
			if (!event.repeat) {
				this.spacePanned = false;
				this.$spaceHeld.set(true);
			}
			return;
		}

		const project = this.project;
		const hasPieces = project != null && selectedPieceIds(project, this.studio.$selection.get()).length > 0;
		switch (event.key) {
			case 'Enter':
				if (this.accept()) event.preventDefault();
				return;
			case 'Escape':
				if (this.$drag.get() != null) {
					this.$drag.set(null);
					this.studio.simulation.endPreview();
					this.syncMarbles();
				} else if (this.$tool.get() !== 'select') {
					this.$tool.set('select');
				} else {
					this.studio.$selection.set([]);
				}
				event.preventDefault();
				return;
			case 'Backspace':
			case 'Delete':
				if (this.deleteSelection()) event.preventDefault();
				return;
			case 'ArrowLeft':
			case 'ArrowRight':
				if (!hasPieces) return;
				// Positive angles turn counter-clockwise, so Right turns the bar clockwise like a dial
				this.handled(event, () => this.nudge((event.key === 'ArrowRight' ? -1 : 1) * (event.shiftKey ? 5 : 1)));
				return;
		}
		if (event.shiftKey) return;
		switch (key) {
			case 'v':
				this.handled(event, () => this.$tool.set('select'));
				return;
			case 'h':
				this.handled(event, () => this.$tool.set('hand'));
				return;
			case 'r':
				this.handled(event, () => this.step('repeat'));
				return;
			case 'm':
				this.handled(event, () => this.step('mirror'));
				return;
			case 'p':
				if (hasPieces) this.handled(event, () => this.togglePin());
				return;
		}
	}

	private onKeyUp(event: KeyboardEvent): void {
		if (event.key !== ' ' || !this.$spaceHeld.get()) return;
		this.$spaceHeld.set(false);
		if (!this.spacePanned) this.studio.$playing.set(!this.studio.$playing.get());
	}

	private handled(event: KeyboardEvent, action: () => void): void {
		event.preventDefault();
		action();
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
		const result = this.result;
		if (this.renderer == null) return;
		const playhead = this.studio.$playhead.get();
		// Selected pieces stay solid so the piece being edited is never washed out
		const selection = this.studio.$selection.get();
		this.renderer.setPieces(
			(result?.pieces ?? []).map((piece) => ({
				piece,
				ghost: piece.hitTime != null && piece.hitTime > playhead + 1e-4 && !selection.includes(piece.entityId)
			}))
		);
	}

	syncMarbles(): void {
		const project = this.project;
		if (this.renderer == null || project == null) return;
		const result = this.result;
		const playhead = this.studio.$playhead.get();
		const drag = this.$drag.get();
		const marbles = project.entities.flatMap((entity) => {
			const { marble, release } = entity.components;
			if (marble == null || release == null) return [];
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

export type TComposeTool = 'select' | 'hand' | 'piece';

export type TComposeDrag =
	| { kind: 'pan'; last: TVec2; orbit: boolean }
	| { kind: 'rotate'; entityId: string; pivot: TVec2; drag: TRotationDrag; angle: number; pointer: TVec2 }
	| { kind: 'release'; entityId: string; offset: TVec2; position: TVec2; moved: boolean }
	| { kind: 'marquee'; from: TVec2; to: TVec2; base: string[] }
	| { kind: 'click'; target: TPick | null; start: TVec2 };

// Leaves room for the floating tool bar and the corner controls
const canvasPadding: TPadding = { top: 56, right: 56, bottom: 88, left: 56 };

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

function localPoint(event: React.PointerEvent<HTMLElement>): TVec2 {
	const rect = event.currentTarget.getBoundingClientRect();
	return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function isSamePick(a: TPick | null, b: TPick | null): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

function isTyping(event: KeyboardEvent): boolean {
	const target = event.target as HTMLElement | null;
	return target != null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
}
