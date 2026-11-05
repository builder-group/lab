import { createState } from 'feature-state';
import type { TScenePiece } from '@/modules/scene';
import { createCameraPose, sampleCameraTrack, verticalFov, type TCameraPose, FilmCameraCache, type TFilmCamera } from '@/modules/camera';
import { TrackRenderer, MARBLE_Z, type TRenderPiece, pickPiece, pieceScreenOutline, hitboxOutlines } from '@/modules/canvas';
import { isPointInPolygon, marblePositionAt, pieceAngleAt, blenderObjectBox, decorBox, decorList, madeInBlenderLayer, decorExtent, decorItem, isFrameEffect, type TDecorItem, snowfallOf, snowFlakes, type TFlake, distanceToBox, type TWallBox, appliedOverrides, DEFAULT_THEME, defaultTitleColor, resolveElementLook, resolveTheme, wallKindOverride, draftGlows, draftMarble, draftPieceColors, draftSkinMarks, draftWall, previewScreenTitleLayout, titleOpacity, type TDraftColors, type TDraftMarble, type TScreenTitleLayout } from '@/modules/scene';
import { marbleFilmColor, type TVec2, toDecorKey, toMadeInBlenderKey, WALL_KEY } from '@/modules/project';
import { shownDepth, type TResolvedPiece } from '@/modules/simulation';
import type { StudioCx } from '@/modules/studio';
import { imageToWall } from './image-to-wall';

/**
 * Film Draft Preview: the run through the film's follow camera at the playhead, drawn in the app with the theme's
 * look approximated, for whenever Blender's preview is not there (browser, not installed, starting, failed).
 * Reuses the Track renderer's Camera view; the canvas is exactly the film frame.
 */
export class DraftPreviewCx {
	/** Bumps after every draw, so the overlay of rails, titles and selection reprojects */
	readonly $frame = createState(0);
	private flakes: { key: string; flakes: TFlake[] } | null = null;
	/** The project's camera is manual, so the draft follows the automatic camera */
	readonly $isManualCamera = createState(false);

	private renderer: TrackRenderer | null = null;
	private size = { width: 1, height: 1 };
	private readonly cameras = new FilmCameraCache();
	private pose: TCameraPose | null = null;
	private wallTheme: string | null = null;
	private readonly scratchPose = createCameraPose();

	constructor(readonly studio: StudioCx) {}

	mount(container: HTMLElement, canvas: HTMLCanvasElement): () => void {
		const renderer = new TrackRenderer(canvas);
		this.renderer = renderer;
		this.wallTheme = null;
		renderer.setCamera({ mode: 'camera', view: { center: { x: 0, y: 0 }, scale: 1000 } });
		const observer = new ResizeObserver(() => {
			const rect = container.getBoundingClientRect();
			this.size = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
			renderer.setViewport(this.size, Math.min(window.devicePixelRatio || 1, 3));
			this.draw();
		});
		observer.observe(container);
		const studio = this.studio;
		const cleanups = [
			studio.$history.listen(() => this.draw()),
			studio.simulation.$result.listen(() => this.draw()),
			studio.$playhead.listen(() => this.draw()),
			studio.$hidden.listen(() => this.draw()),
			studio.film.$blenderObjects.listen(() => this.draw()),
			studio.film.$orbit.listen(() => this.draw())
		];
		this.draw();
		return () => {
			observer.disconnect();
			for (const cleanup of cleanups) cleanup();
			renderer.dispose();
			this.renderer = null;
			this.pose = null;
		};
	}

	/** How far out from the wall the film runs the marble's path */
	private pathZ(): number {
		return this.cameras.base?.build.description.marbles[0]?.pathDepth ?? MARBLE_Z;
	}

	/** CSS pixel position in the frame of a wall point at depth `z`, through the film camera */
	toScreen(point: TVec2, z = this.pathZ()): TVec2 {
		return this.renderer?.project(point, z) ?? { x: Number.NaN, y: Number.NaN };
	}

	/** Wall point under a point of the frame in 0..1 image coordinates */
	toWall(u: number, v: number): TVec2 | null {
		return this.pose != null ? imageToWall(this.pose, this.aspect(), u, v) : null;
	}

	/** CSS pixels per wall meter at the followed point, for line widths */
	screenScale(): number {
		if (this.pose == null) return 1000;
		const halfFrame = Math.tan((verticalFov(this.pose.lens, this.aspect()) * Math.PI) / 360);
		return this.size.height / 2 / (halfFrame * Math.max(this.pose.focus, 1e-3));
	}

	/** Scene description entry of a piece, for its theme colors */
	scenePiece(entityId: string): TScenePiece | undefined {
		return this.cameras.base?.build.description.pieces.find((piece) => piece.id === entityId);
	}

	/** Theme colors of a piece in the draft */
	colorsOf(piece: TResolvedPiece): TDraftColors {
		const project = this.studio.project;
		const scene = this.scenePiece(piece.entityId);
		const theme = project != null ? resolveTheme(project.film) : null;
		return draftPieceColors(
			theme?.base ?? DEFAULT_THEME,
			scene ?? { type: piece.type, color: '#c8b89a', skin: null },
			theme?.overrides,
			theme?.projectTheme?.parts
		);
	}

	/**
	 * A platform's skin marks on its front face in CSS pixels, each a quad with its color: the chrome caps, key, lens
	 * or grille that tell a Brass skin apart
	 */
	skinMarks(piece: TResolvedPiece): { id: string; points: TVec2[]; color: string }[] {
		const project = this.studio.project;
		if (piece.type !== 'platform' || project == null) return [];
		const theme = resolveTheme(project.film);
		const marks = draftSkinMarks(theme.base, { type: piece.type, skin: this.scenePiece(piece.entityId)?.skin ?? null, angle: piece.angle }, theme.projectTheme?.parts);
		if (!marks.length) return [];
		const angle = pieceAngleAt(piece, this.studio.$playhead.get());
		const [length, thickness, depth] = [piece.params['length'] ?? 0.06, piece.params['thickness'] ?? 0.008, shownDepth(piece)];
		const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
		// A point on the front face, in shares of the bar's length and thickness from its center
		const at = (x: number, y: number): TVec2 =>
			this.toScreen({ x: piece.position.x + cos * x * length - sin * y * thickness, y: piece.position.y + sin * x * length + cos * y * thickness }, depth);
		return marks.map((mark) => ({ id: `${mark.x0}:${mark.y0}`, color: mark.color, points: [at(mark.x0, mark.y0), at(mark.x1, mark.y0), at(mark.x1, mark.y1), at(mark.x0, mark.y1)] }));
	}

	/** Pieces in the draft: the run's pieces without the hidden ones */
	pieces(): TResolvedPiece[] {
		const hidden = this.studio.$hidden.get();
		return (this.studio.simulation.$result.get()?.pieces ?? []).filter((piece) => !hidden.includes(piece.entityId));
	}

	/** Titles with their frame position, on-screen size and angle and their opacity at the playhead */
	titles(): TDraftTitle[] {
		const project = this.studio.project;
		if (project == null || this.pose == null) return [];
		const time = this.studio.$playhead.get();
		const hidden = this.studio.$hidden.get();
		return project.film.titles.flatMap((text) => {
			if (hidden.includes(text.id)) return [];
			const color = text.color ?? defaultTitleColor(project.film);
			if (text.style === 'caption' || text.style === 'songName' || text.style === 'endCard') {
				// Screen titles are drawn onto the encoded film: a fixed place and size in the frame, plain unless they ask for a plate
				const screen = previewScreenTitleLayout(text.style, text.size, this.size, project.format, project.film.quality);
				return [{ entityId: text.id, text: text.text, color, center: screen.center, fontSize: screen.fontSize, angle: 0, opacity: titleOpacity(time, text), screen, hasPlate: text.plate === true }];
			}
			const center = this.toScreen(text.position, 0);
			const step = 0.01;
			const along = this.toScreen({ x: text.position.x + Math.cos(text.angle) * step, y: text.position.y + Math.sin(text.angle) * step }, 0);
			const pixelsPerMeter = Math.hypot(along.x - center.x, along.y - center.y) / step;
			if (!Number.isFinite(pixelsPerMeter) || !Number.isFinite(center.x)) return [];
			return [
				{
					entityId: text.id,
					text: text.text,
					color,
					center,
					fontSize: text.size * pixelsPerMeter,
					angle: (Math.atan2(along.y - center.y, along.x - center.x) * 180) / Math.PI,
					opacity: titleOpacity(time, text)
				}
			];
		});
	}

	/**
	 * Decor at the playhead, each with the wall-to-screen matrix it is drawn through, so it stays flat on the wall as the
	 * camera moves. A preview: Blender draws the real look.
	 */
	decor(): TDraftDecor[] {
		const project = this.studio.project;
		if (project == null || this.pose == null) return [];
		const time = this.studio.$playhead.get();
		return decorList(project.film).flatMap((decor) => {
			const opacity = decor.hidden === true ? 0 : titleOpacity(time, decor);
			if (opacity <= 0 || isFrameEffect(decor)) return [];
			const extent = decorExtent(decor);
			const matrix = this.wallMatrix(decor.position, decor.rotation, decor.scale);
			if (matrix == null) return [];
			const asset = decorItem(decor.source) == null ? this.studio.library.$projectItems.get().find((item) => decor.source === `assets/${item.id}/asset.blend`) : undefined;
			return [{ key: toDecorKey(decor.id), item: decorItem(decor.source), matrix, opacity, extent: { x: extent.x / decor.scale, y: extent.y / decor.scale }, previewUrl: asset?.previewUrl ?? null }];
		});
	}

	/** Particles at the playhead: what `DraftEffects` draws over the frame */
	frameEffects(): TDraftEffect[] {
		const project = this.studio.project;
		if (project == null || this.pose == null) return [];
		const time = this.studio.$playhead.get();
		return decorList(project.film).flatMap((decor): TDraftEffect[] => {
			const effect = decorItem(decor.source)?.effect;
			const opacity = decor.hidden === true ? 0 : titleOpacity(time, decor);
			if (effect == null || opacity <= 0) return [];
			const snow = snowfallOf(decor);
			const key = `${decor.id} ${snow.density}`;
			if (this.flakes?.key !== key) this.flakes = { key, flakes: snowFlakes(decor.id, snow.density) };
			return [{ kind: 'snowfall', key: toDecorKey(decor.id), opacity, flakes: this.flakes.flakes, color: snow.color, size: snow.size, speed: snow.speed }];
		});
	}

	/**
	 * Selected outside the frame, such as in Layers, a piece comes into view the only way the film's camera can show it:
	 * the playhead goes to when it plays. A piece no marble times stays where it is.
	 */
	revealPiece(id: string): void {
		const piece = this.pieces().find((item) => item.entityId === id);
		const time = piece?.hitTime ?? piece?.entryTime;
		if (piece == null || time == null) return;
		const isInFrame = this.selectionOutline(piece).some((point) => point.x >= 0 && point.x <= this.size.width && point.y >= 0 && point.y <= this.size.height);
		if (!isInFrame) this.studio.seek(time);
	}

	/** Made in Blender objects as faint outlines at the playhead: their look shows only in the Blender preview */
	blenderOutlines(): { key: string; points: TVec2[]; opacity: number }[] {
		const project = this.studio.project;
		if (project == null || this.pose == null) return [];
		const time = this.studio.$playhead.get();
		return this.studio.film.$blenderObjects.get().flatMap((object) => {
			const layer = madeInBlenderLayer(project.film, object.name);
			const opacity = layer.hidden === true ? 0 : titleOpacity(time, layer);
			if (opacity <= 0) return [];
			return [{ key: toMadeInBlenderKey(object.name), points: this.boxOutline(blenderObjectBox(object)), opacity }];
		});
	}

	/** A selected decoration's outline in CSS pixels */
	decorOutline(key: string): TVec2[] | null {
		const box = this.decorBoxes().find((item) => item.key === key)?.box;
		return box != null ? this.boxOutline(box) : null;
	}

	/** The Decor layer under a wall point, the last placed first */
	decorAt(point: TVec2): string | null {
		const boxes = this.decorBoxes();
		for (let index = boxes.length - 1; index >= 0; index--) {
			const entry = boxes[index];
			if (entry != null && distanceToBox(entry.box, point.x, point.y) === 0) return entry.key;
		}
		return null;
	}

	private decorBoxes(): { key: string; box: TWallBox }[] {
		const project = this.studio.project;
		if (project == null) return [];
		const time = this.studio.$playhead.get();
		const shown = decorList(project.film).filter((decor) => decor.hidden !== true && titleOpacity(time, decor) > 0 && !isFrameEffect(decor));
		return [
			...this.studio.film.$blenderObjects
				.get()
				.filter((object) => {
					const layer = madeInBlenderLayer(project.film, object.name);
					return layer.hidden !== true && titleOpacity(time, layer) > 0;
				})
				.map((object) => ({ key: toMadeInBlenderKey(object.name), box: blenderObjectBox(object) })),
			...shown.map((decor) => ({ key: toDecorKey(decor.id), box: decorBox(decor) }))
		];
	}

	private boxOutline(box: TWallBox): TVec2[] {
		const [cos, sin] = [Math.cos(box.angle), Math.sin(box.angle)];
		return [
			[-box.halfX, -box.halfY],
			[box.halfX, -box.halfY],
			[box.halfX, box.halfY],
			[-box.halfX, box.halfY]
		].map(([x = 0, y = 0]) => this.toScreen({ x: box.x + x * cos - y * sin, y: box.y + x * sin + y * cos }, 0));
	}

	/** SVG matrix from a decoration's own meters (x right, y down) to CSS pixels, through the film camera at its spot */
	private wallMatrix(center: TVec2, angle: number, scale: number): string | null {
		const step = 0.01;
		const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
		const origin = this.toScreen(center, 0);
		const along = this.toScreen({ x: center.x + cos * step, y: center.y + sin * step }, 0);
		const up = this.toScreen({ x: center.x - sin * step, y: center.y + cos * step }, 0);
		if (![origin.x, origin.y, along.x, along.y, up.x, up.y].every(Number.isFinite)) return null;
		const a = ((along.x - origin.x) / step) * scale;
		const b = ((along.y - origin.y) / step) * scale;
		const c = (-(up.x - origin.x) / step) * scale;
		const d = (-(up.y - origin.y) / step) * scale;
		return `matrix(${a} ${b} ${c} ${d} ${origin.x} ${origin.y})`;
	}

	/** Marbles at the playhead in the theme's look: their wall position, radius, body and rim colors, apart from the wall */
	marbles(): TPlacedMarble[] {
		const project = this.studio.project;
		if (project == null) return [];
		const theme = resolveTheme(project.film);
		const result = this.studio.simulation.$result.get();
		const hidden = this.studio.$hidden.get();
		const playhead = this.studio.$playhead.get();
		return project.marbles.flatMap((marble): TPlacedMarble[] => {
			if (hidden.includes(marble.id)) return [];
			const motion = result?.marbles.find((item) => item.entityId === marble.id);
			const position = marblePositionAt(motion, playhead, marble.start.position);
			const look = resolveElementLook(project.film, 'marble', marble.skin);
			const draft = draftMarble(theme.base, look.skin === 'marble:none' ? marble.labelColor : marbleFilmColor(project, marble.id), appliedOverrides(project.film), look);
			// Draft isn't the film: a marble no skin dresses shows its label color, so it reads as the same marble as in Track
			const label = look.skin === 'marble:contrast' && marble.skin?.color == null ? marble.labelColor : undefined;
			return [
				{
					entityId: marble.id,
					radius: marble.radius,
					position,
					...draft,
					...(label != null ? { body: label, rim: null } : {})
				}
			];
		});
	}

	/** Whether the theme's pieces glow, for the overlay's soft halo */
	glows(): boolean {
		const project = this.studio.project;
		if (project == null) return false;
		const theme = resolveTheme(project.film);
		return draftGlows(theme.parts.platform.skin === 'platform:neon' ? 'neon' : theme.base);
	}

	/**
	 * Selection outline of a piece in CSS pixels: rails and tunnels by their outline, solid pieces by everything the
	 * camera sees of them from the wall to their front, a few pixels out like the Track canvas
	 */
	selectionOutline(piece: TResolvedPiece): TVec2[] {
		return pieceScreenOutline(piece, (point, z) => this.toScreen(point, z), this.pathZ());
	}

	/** A piece's hitbox in CSS pixels at the playhead: its colliders' outlines in the plane the marble moves in */
	hitboxOutline(piece: TResolvedPiece): TVec2[][] {
		const time = this.studio.$playhead.get();
		return hitboxOutlines(piece, time).map((outline) => outline.map((corner) => this.toScreen(corner, this.pathZ())));
	}

	/** Title or piece under a CSS pixel point of the frame, titles first like the Blender ID pass shows them on top */
	pick(point: TVec2, titleBoxes: Map<string, TVec2[]>): string | null {
		for (const title of this.titles()) {
			const box = titleBoxes.get(title.entityId);
			if (title.opacity > 0 && box != null && isPointInPolygon(point, box)) return title.entityId;
		}
		const piece = pickPiece(this.pieces(), point, (at, z) => this.toScreen(at, z), this.pathZ());
		if (piece != null) return piece;
		const wall = this.toWall(point.x / this.size.width, point.y / this.size.height);
		return wall != null ? this.decorAt(wall) : null;
	}

	private aspect(): number {
		const frame = this.studio.project?.format;
		return frame != null ? frame.width / frame.height : 9 / 16;
	}

	private filmCamera(): TFilmCamera | null {
		const project = this.studio.project;
		const result = this.studio.simulation.$result.get();
		if (project == null || result == null) return null;
		const camera = this.cameras.at(project, result, this.studio.film.$orbit.get());
		this.$isManualCamera.set(camera.isManual);
		return camera;
	}

	private draw(): void {
		const renderer = this.renderer;
		const project = this.studio.project;
		if (renderer == null || project == null) return;
		const theme = resolveTheme(project.film);
		const overrides = appliedOverrides(project.film);
		const wallKind = wallKindOverride(project.film);
		const wallKey = `${theme.base} ${overrides.wallColor ?? ''} ${wallKind ?? ''}`;
		if (this.wallTheme !== wallKey) {
			renderer.setWallLook(draftWall(theme.base, overrides, wallKind));
			this.wallTheme = wallKey;
		}
		const playhead = this.studio.$playhead.get();
		const track = this.filmCamera()?.track ?? null;
		this.pose = track != null ? sampleCameraTrack(track, playhead, this.scratchPose) : null;
		renderer.setWallHidden(this.studio.$hidden.get().includes(WALL_KEY));
		renderer.setFilm(this.pose != null ? { pose: this.pose, aspect: this.aspect(), frame: { x: 0, y: 0, ...this.size } } : null);

		const items: TRenderPiece[] = this.pieces().map((piece) => ({ piece, angle: pieceAngleAt(piece, playhead), colors: this.colorsOf(piece), pathZ: this.pathZ() }));
		renderer.setPieces(items);
		renderer.setMarbles(
			this.marbles().map(({ entityId, body, radius, position }) => ({ entityId, color: body, radius, position, z: this.pathZ() }))
		);
		renderer.render();
		this.$frame.set((value) => value + 1);
	}
}

type TPlacedMarble = TDraftMarble & { entityId: string; radius: number; position: TVec2 };

export type TDraftEffect = { kind: 'snowfall'; key: string; opacity: number; flakes: readonly TFlake[]; color: string; size: number; speed: number };

export interface TDraftDecor {
	key: string;
	/** Null for an asset */
	item: TDecorItem | null;
	/** SVG transform from the item's own meters to CSS pixels */
	matrix: string;
	opacity: number;
	/** Half width and height in the item's own meters */
	extent: { x: number; y: number };
	/** An asset's still */
	previewUrl: string | null;
}

export interface TDraftTitle {
	entityId: string;
	text: string;
	color: string;
	center: TVec2;
	/** Letter height in CSS pixels */
	fontSize: number;
	/** Screen angle in degrees, clockwise */
	angle: number;
	opacity: number;
	/** Caption, Song Name and End Card: their place and size as the encoder draws them */
	screen?: TScreenTitleLayout;
	/** A screen title with the encoder's soft dark plate and shadow */
	hasPlate?: boolean;
}
