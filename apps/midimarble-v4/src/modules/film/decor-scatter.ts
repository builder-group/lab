import { projectToFrame, type TCameraTrack } from '@/modules/camera';
import type { TDecor, TProject, TProjectCommand, TVec2 } from '@/modules/project';
import type { TSimulationResult } from '@/modules/simulation';
import { blenderObjectBox, decorBox, decorList, newDecor, setDecorList, type TBlenderObject, type TDecorSource, decorExtent, isFrameEffect, cachedObstacleField, isBoxClear, nearestRunPoint, type TWallBox } from '@/modules/scene';

// Scatter Decor: fills the free wall the film camera shows, beside the run and clear of every marble's swept path and of
// the pieces. Deterministic for a seed, so a re-scatter at the same settings lands in the same places.

/** Clearance kept from a marble's swept path and from pieces, beyond the marble's radius */
export const SCATTER_MARGIN = 0.012;
/** How far from a run an item may stand: further than this reads as lost on an empty wall */
const BESIDE_RUN = 0.2;
/** Spacing between items at Density 0 and 1 */
const SPACING_SPARSE = 0.2;
const SPACING_DENSE = 0.07;
/** A candidate's shift from its grid point, as a share of the spacing: even, but not a pattern */
const JITTER = 0.2;
/** The most items one scatter places; a long film spreads them over its length */
const MAX_ITEMS = 160;
/** Share of the frame an item keeps from its edge when it shows */
const FRAME_INSET = 0.02;
/** Seconds around the moment the run passes an item in which the camera has to show it, and the step they are checked at */
const VISIBLE_WINDOW = 3;
const VISIBLE_STEP = 0.1;
const SCALE_RANGE = [0.9, 1.15] as const;
const ROTATION_RANGE = 0.3;

export const DEFAULT_SCATTER_DENSITY = 0.5;

export interface TScatterOptions {
	items: readonly TDecorSource[];
	/** 0 to 1 */
	density: number;
	seed: number;
	blenderObjects?: readonly TBlenderObject[];
}

export interface TScatterPlacement {
	source: TDecorSource;
	position: TVec2;
	scale: number;
	rotation: number;
}

/** Items placed for the run, film camera and options, in top to bottom order. Same inputs, same placements. */
export function scatterPlacements(project: TProject, result: TSimulationResult, track: TCameraTrack, options: TScatterOptions): TScatterPlacement[] {
	// Particles belong to the frame: there is nothing of theirs to place on the wall
	const items = options.items.filter((item) => !isFrameEffect({ source: item.source }));
	if (!items.length || !result.marbles.length) return [];
	const field = cachedObstacleField(result);
	const random = mulberry32(options.seed);
	const spacing = SPACING_SPARSE + (SPACING_DENSE - SPACING_SPARSE) * Math.min(1, Math.max(0, options.density));
	const kept = keptBoxes(project, options.blenderObjects ?? []);

	// A hexagonal grid over the runs' extent, each point shifted a little
	const samples = result.marbles.flatMap((marble) => marble.samples.filter((sample) => sample.time <= result.duration).map((sample) => sample.position));
	if (!samples.length) return [];
	let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
	for (const point of samples) {
		minX = Math.min(minX, point.x);
		maxX = Math.max(maxX, point.x);
		minY = Math.min(minY, point.y);
		maxY = Math.max(maxY, point.y);
	}
	const candidates: { x: number; y: number; time: number }[] = [];
	const rowHeight = spacing * 0.866;
	let row = 0;
	for (let y = maxY + BESIDE_RUN; y >= minY - BESIDE_RUN; y -= rowHeight, row++) {
		for (let x = minX - BESIDE_RUN + (row % 2 === 1 ? spacing / 2 : 0); x <= maxX + BESIDE_RUN; x += spacing) {
			const shifted = { x: x + (random() - 0.5) * 2 * JITTER * spacing, y: y + (random() - 0.5) * 2 * JITTER * spacing };
			const near = nearestRunPoint(field, shifted.x, shifted.y, BESIDE_RUN);
			if (near != null) candidates.push({ ...shifted, time: near.time });
		}
	}

	// Items in turn, in a shuffled order that holds for the whole film, so the set stays even
	const deck = shuffled(items, random);
	const placements: TScatterPlacement[] = [];
	const stride = Math.max(1, candidates.length / (MAX_ITEMS * 3));
	for (let position = 0; position < candidates.length && placements.length < MAX_ITEMS; position += stride) {
		const candidate = candidates[Math.floor(position)];
		const scale = SCALE_RANGE[0] + (SCALE_RANGE[1] - SCALE_RANGE[0]) * random();
		const rotation = (random() - 0.5) * 2 * ROTATION_RANGE;
		if (candidate == null) continue;
		const source = deck[placements.length % deck.length] as TDecorSource;
		const extent = decorExtent({ source: source.source, scale, ...(source.footprint != null ? { footprint: source.footprint } : {}) });
		const box: TWallBox = { x: candidate.x, y: candidate.y, halfX: extent.x, halfY: extent.y, angle: rotation };
		if (!isBoxClear(field, box, SCATTER_MARGIN)) continue;
		if (kept.some((other) => boxesTouch(box, other, SCATTER_MARGIN))) continue;
		if (!isShownByCamera(track, box, candidate.time)) continue;
		placements.push({ source, position: { x: round(candidate.x), y: round(candidate.y) }, scale: round(scale), rotation: round(rotation) });
	}
	return placements;
}

/** Replaces what Scatter Decor placed before with a new scatter, as one edit */
export function scatterDecorCommands(project: TProject, result: TSimulationResult, track: TCameraTrack, options: TScatterOptions): { commands: TProjectCommand[]; count: number; isAtMost: boolean } {
	const kept = decorList(project.design).filter((item) => item.scattered !== true);
	const names = kept.map((item) => item.name);
	const placed = scatterPlacements(project, result, track, options).map((placement): TDecor => {
		const decor = newDecor(placement.source, placement.position, names);
		names.push(decor.name);
		return { ...decor, scale: placement.scale, rotation: placement.rotation, scattered: true };
	});
	return { commands: setDecorList([...kept, ...placed]), count: placed.length, isAtMost: placed.length >= MAX_ITEMS };
}

/** Everything a scatter keeps its distance from besides runs and pieces: the user's decor, titles on the wall and Blender's objects */
function keptBoxes(project: TProject, blenderObjects: readonly TBlenderObject[]): TWallBox[] {
	const titles = project.entities.flatMap((entity): TWallBox[] => {
		const text = entity.components.wallText;
		const transform = entity.components.transform;
		if (text == null || transform == null || (text.style != null && text.style !== 'wall')) return [];
		return [{ x: transform.position.x, y: transform.position.y, halfX: (Math.max(1, text.text.length) * text.size * 0.62) / 2, halfY: text.size * 0.6, angle: transform.angle }];
	});
	return [...decorList(project.design).filter((item) => item.scattered !== true && !isFrameEffect(item)).map(decorBox), ...titles, ...blenderObjects.map(blenderObjectBox)];
}

function boxesTouch(a: TWallBox, b: TWallBox, margin: number): boolean {
	return Math.hypot(a.x - b.x, a.y - b.y) < Math.hypot(a.halfX, a.halfY) + Math.hypot(b.halfX, b.halfY) + margin;
}

/** Whether the film camera shows all of the box at some moment around `time`, when the run passes it */
function isShownByCamera(track: TCameraTrack, box: TWallBox, time: number): boolean {
	const from = Math.max(0, time - VISIBLE_WINDOW);
	const to = Math.min((track.frameCount - 1) / track.fps, time + VISIBLE_WINDOW);
	for (let moment = from; moment <= to; moment += VISIBLE_STEP) {
		const frame = Math.round(moment * track.fps);
		if (boxCorners(box).every(([x, y]) => isInsideFrame(projectToFrame(track, frame, x, y, 0)))) return true;
	}
	return false;
}

function isInsideFrame([u, v]: [number, number]): boolean {
	return u >= FRAME_INSET && u <= 1 - FRAME_INSET && v >= FRAME_INSET && v <= 1 - FRAME_INSET;
}

function boxCorners(box: TWallBox): [number, number][] {
	const [cos, sin] = [Math.cos(box.angle), Math.sin(box.angle)];
	return [
		[-box.halfX, -box.halfY],
		[box.halfX, -box.halfY],
		[box.halfX, box.halfY],
		[-box.halfX, box.halfY]
	].map(([x = 0, y = 0]) => [box.x + x * cos - y * sin, box.y + x * sin + y * cos]);
}

function shuffled<GItem>(items: readonly GItem[], random: () => number): GItem[] {
	const list = [...items];
	for (let index = list.length - 1; index > 0; index--) {
		const other = Math.floor(random() * (index + 1));
		[list[index], list[other]] = [list[other] as GItem, list[index] as GItem];
	}
	return list;
}

/** A small seeded generator, the same on every machine */
function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let mixed = state;
		mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
		mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
		return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
	};
}

function round(value: number): number {
	return Math.round(value * 10000) / 10000;
}
