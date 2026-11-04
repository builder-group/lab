import { createState } from 'feature-state';
import { createId, type TDecor, type TDesign, type TMadeInBlender, type TProject, type TProjectCommand, type TGarland, type TSnowfall, type TVec2 } from '@/modules/project';
import type { TSimulationResult } from '@/modules/simulation';
import { parseDecorKey, parseMadeInBlenderKey, toDecorKey, toMadeInBlenderKey } from '@/modules/studio/selection';
import { decorExtent, decorItem, decorText, isFrameEffect } from './decor-catalog';
import { effectDefaults } from './decor-effects';
import { cachedObstacleField, distanceToBox, isBoxClear, pathOverlaps, type TWallBox } from './decor-clearance';
import { titleSpan } from './titles';

// Decor: the decorations of the film in `design.decor`, one layer each. They have no hitbox, so nothing here can change
// a hit. The Blender file may hold more: objects the user added there, listed as Made in Blender, which the app never
// moves or deletes and only hides and times.

// MARK: - Made in Blender

/** An object in the Blender file the app doesn't own, as the worker reports it */
export interface TBlenderObject {
	name: string;
	/** Its bounds on the wall in metres at the time of the report */
	bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/** What the worker reported last; empty until the app talks to Blender */
export const $blenderObjects = createState<TBlenderObject[]>([]);

export function madeInBlenderLayer(design: Pick<TDesign, 'madeInBlender'>, name: string): TMadeInBlender {
	return design.madeInBlender?.find((item) => item.name === name) ?? { name };
}

/** Sets In, Out or Hidden on a Blender object; a value of null clears it. An entry that sets nothing goes away. */
export function madeInBlenderCommands(project: TProject, name: string, patch: { in?: number | null; out?: number | null; hidden?: boolean | null }): TProjectCommand[] {
	const merged: Record<string, unknown> = { ...madeInBlenderLayer(project.design, name), ...patch };
	const entry = Object.fromEntries(Object.entries(merged).filter(([key, value]) => value != null && (key !== 'hidden' || value === true))) as TMadeInBlender;
	const others = (project.design.madeInBlender ?? []).filter((item) => item.name !== name);
	const list = Object.keys(entry).length > 1 ? [...others, entry] : others;
	if (JSON.stringify(list) === JSON.stringify(project.design.madeInBlender ?? [])) return [];
	return [{ type: 'setDesign', design: { madeInBlender: list.length > 0 ? list : undefined } }];
}

// MARK: - Layers

export function decorList(design: Pick<TDesign, 'decor'>): TDecor[] {
	return design.decor ?? [];
}

export function findDecor(design: Pick<TDesign, 'decor'>, id: string): TDecor | undefined {
	return design.decor?.find((item) => item.id === id);
}

export function selectedDecorIds(selection: readonly string[]): string[] {
	return selection.flatMap((key) => parseDecorKey(key) ?? []);
}

export function selectedBlenderNames(selection: readonly string[]): string[] {
	return selection.flatMap((key) => parseMadeInBlenderKey(key) ?? []);
}

export function setDecorList(decor: TDecor[]): TProjectCommand[] {
	return [{ type: 'setDesign', design: { decor: decor.length > 0 ? decor : undefined } }];
}

/** The next free name: "Star", "Star 2", "Star 3" */
export function nextDecorName(label: string, taken: readonly string[]): string {
	if (!taken.includes(label)) return label;
	let index = 2;
	while (taken.includes(`${label} ${index}`)) index++;
	return `${label} ${index}`;
}

/** A library item as Add Decor and Scatter Decor take it: a built-in item or an asset the project holds */
export interface TDecorSource {
	source: string;
	label: string;
	footprint?: { x: number; y: number };
}

/** A built-in item's `TDecorSource` */
export function builtInSource(source: string): TDecorSource {
	return { source, label: decorItem(source)?.label ?? source };
}

/** An accepted or imported decoration: `width` and `height` in its manifest's fitted parameters give its size */
export function assetDecorSource(id: string, label: string, fitted: Record<string, number> | undefined): TDecorSource {
	const [width, height] = [fitted?.['width'], fitted?.['height']];
	return { source: `assets/${id}/asset.blend`, label, ...(width != null && height != null && width > 0 && height > 0 ? { footprint: { x: width / 2, y: height / 2 } } : {}) };
}

/** Makes a decoration at a wall point, at scale 1, flat on the wall and shown for the whole film */
export function newDecor(source: TDecorSource, point: TVec2, taken: readonly string[]): TDecor {
	const text = decorItem(source.source)?.text;
	return {
		id: createId('decor'),
		name: nextDecorName(source.label, taken),
		source: source.source,
		position: { x: round(point.x), y: round(point.y) },
		scale: 1,
		rotation: 0,
		depth: 0,
		...(text != null ? { text } : {}),
		...(source.footprint != null ? { footprint: source.footprint } : {}),
		...effectDefaults(source.source)
	};
}

export function addDecorCommands(project: TProject, source: TDecorSource, point: TVec2): { commands: TProjectCommand[]; decorId: string } {
	const list = decorList(project.design);
	const decor = newDecor(source, point, list.map((item) => item.name));
	return { commands: setDecorList([...list, decor]), decorId: decor.id };
}

export function updateDecorCommands(project: TProject, ids: readonly string[], patch: Partial<Omit<TDecor, 'id' | 'hidden' | 'scattered'>> & { hidden?: boolean }): TProjectCommand[] {
	const list = decorList(project.design);
	if (!list.some((item) => ids.includes(item.id))) return [];
	return setDecorList(
		list.map((item) => {
			if (!ids.includes(item.id)) return item;
			// A hand edit makes it the user's: Scatter Decor leaves it where it is from now on
			const { scattered: _scattered, ...own } = item;
			const moved = 'position' in patch || 'scale' in patch || 'rotation' in patch;
			const next: TDecor = { ...(moved ? own : item), ...patch };
			if (next.hidden !== true) delete next.hidden;
			return next;
		})
	);
}

export function deleteDecorCommands(project: TProject, ids: readonly string[]): TProjectCommand[] {
	const list = decorList(project.design);
	const kept = list.filter((item) => !ids.includes(item.id));
	return kept.length === list.length ? [] : setDecorList(kept);
}

/** How far a copy lands from its original, right and down on the wall in metres */
const DUPLICATE_OFFSET = { x: 0.03, y: -0.03 };

/** Duplicate: copies a little right of and below the originals, as one edit. A copy is the user's, not Scatter Decor's. */
export function duplicateDecorCommands(project: TProject, ids: readonly string[]): { commands: TProjectCommand[]; decorIds: string[] } {
	const list = decorList(project.design);
	const names = list.map((item) => item.name);
	const copies = list
		.filter((item) => ids.includes(item.id))
		.map((item) => {
			const { scattered: _scattered, ...own } = item;
			const name = nextDecorName(item.name.replace(/ \d+$/, ''), names);
			names.push(name);
			return { ...own, id: createId('decor'), name, position: { x: round(item.position.x + DUPLICATE_OFFSET.x), y: round(item.position.y + DUPLICATE_OFFSET.y) } };
		});
	return { commands: copies.length > 0 ? setDecorList([...list, ...copies]) : [], decorIds: copies.map((copy) => copy.id) };
}

// MARK: - Overlaps

export function decorBox(decor: Pick<TDecor, 'source' | 'scale' | 'text' | 'footprint' | 'position' | 'rotation'>): TWallBox {
	const extent = decorExtent(decor);
	return { x: decor.position.x, y: decor.position.y, halfX: extent.x, halfY: extent.y, angle: decor.rotation };
}

export function blenderObjectBox(object: TBlenderObject): TWallBox {
	const { minX, minY, maxX, maxY } = object.bounds;
	return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, halfX: (maxX - minX) / 2, halfY: (maxY - minY) / 2, angle: 0 };
}

/** The decoration under a wall point at `time`, the last placed first */
export function decorAtWall(project: TProject, time: number, point: TVec2): string | null {
	const list = decorList(project.design);
	for (let index = list.length - 1; index >= 0; index--) {
		const item = list[index];
		if (item == null || item.hidden === true || isFrameEffect(item)) continue;
		const span = titleSpan(item, project.end);
		if (time >= span.start && time <= span.end && distanceToBox(decorBox(item), point.x, point.y) === 0) return toDecorKey(item.id);
	}
	return null;
}

export interface TDecorOverlap {
	/** Selection key of the layer */
	key: string;
	name: string;
	/** Marbles whose path crosses it while it shows, the earliest first */
	lanes: { laneId: string; time: number; point: TVec2 }[];
}

/** Layers a marble's path crosses while they show. Hidden layers and layers outside the film overlap nothing. */
export function decorOverlaps(project: TProject, result: TSimulationResult, blenderObjects: readonly TBlenderObject[]): TDecorOverlap[] {
	if (!result.marbles.length) return [];
	// Snowfall and Garland hang from the camera: nothing they pass over is on their path
	const decor = decorList(project.design).filter((item) => item.hidden !== true && !isFrameEffect(item));
	if (!decor.length && !blenderObjects.length) return [];
	const field = cachedObstacleField(result);
	const overlaps: TDecorOverlap[] = [];
	for (const item of decor) {
		const lanes = pathOverlaps(field, decorBox(item), titleSpan(item, project.end));
		if (lanes.length > 0) overlaps.push({ key: toDecorKey(item.id), name: item.name, lanes });
	}
	for (const object of blenderObjects) {
		const layer = madeInBlenderLayer(project.design, object.name);
		if (layer.hidden === true) continue;
		const lanes = pathOverlaps(field, blenderObjectBox(object), titleSpan(layer, project.end));
		if (lanes.length > 0) overlaps.push({ key: toMadeInBlenderKey(object.name), name: object.name, lanes });
	}
	return overlaps;
}

/** The amber words on the layer: "Overlaps Melody's path", or with several marbles "Overlaps Melody's and Bass's paths" */
export function overlapLabel(laneNames: readonly string[]): string {
	const names = laneNames.map((name) => `${name}'s`);
	return names.length < 2 ? `Overlaps ${names[0] ?? 'a marble\'s'} path` : `Overlaps ${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''} paths`;
}

// MARK: - Move Clear

/** Clearance Move Clear keeps from a marble's path and from pieces, beyond the marble's radius */
export const MOVE_CLEAR_MARGIN = 0.006;
const CLEAR_STEP = 0.005;
const CLEAR_MAX = 0.4;
const CLEAR_DIRECTIONS = 24;

/**
 * Move Clear: the smallest nudge that clears every marble's whole run and the pieces in it, whatever In and Out say, so
 * retiming the item later doesn't bring the tip back. Null when no spot within 40 cm clears.
 */
export function moveDecorClear(project: TProject, result: TSimulationResult, decorId: string): { commands: TProjectCommand[]; distance: number } | null {
	const decor = findDecor(project.design, decorId);
	if (decor == null) return null;
	const field = cachedObstacleField(result);
	const box = decorBox(decor);
	for (let distance = CLEAR_STEP; distance <= CLEAR_MAX + 1e-9; distance += CLEAR_STEP) {
		for (let direction = 0; direction < CLEAR_DIRECTIONS; direction++) {
			const angle = (direction / CLEAR_DIRECTIONS) * Math.PI * 2;
			const x = round(decor.position.x + Math.cos(angle) * distance);
			const y = round(decor.position.y + Math.sin(angle) * distance);
			if (isBoxClear(field, { ...box, x, y }, MOVE_CLEAR_MARGIN)) return { commands: updateDecorCommands(project, [decorId], { position: { x, y } }), distance };
		}
	}
	return null;
}

// MARK: - Scene description

/** What the Blender worker builds: every decoration, hidden ones marked so they keep any edit made in Blender */
export function sceneDecor(design: Pick<TDesign, 'decor' | 'madeInBlender'>): { decor?: TSceneDecorItem[]; madeInBlender?: TMadeInBlender[] } {
	const decor = decorList(design).map((item): TSceneDecorItem => {
		const { source, scattered: _scattered, footprint: _footprint, id, text, ...rest } = item;
		const shown = decorText(item);
		return {
			...rest,
			id: toDecorKey(id),
			...(source.startsWith('decor:') ? { item: source.slice('decor:'.length) } : { assetPath: source }),
			...(text != null || shown != null ? { text: shown ?? text } : {})
		};
	});
	return {
		...(decor.length > 0 ? { decor } : {}),
		...((design.madeInBlender?.length ?? 0) > 0 ? { madeInBlender: design.madeInBlender } : {})
	};
}

export interface TSceneDecorItem {
	/** The object's `mm_id`, the layer's selection key */
	id: string;
	name: string;
	item?: string;
	assetPath?: string;
	position: TVec2;
	scale: number;
	rotation: number;
	depth: number;
	text?: string;
	snowfall?: TSnowfall;
	garland?: TGarland;
	in?: number;
	out?: number;
	hidden?: boolean;
}

function round(value: number): number {
	return Math.round(value * 10000) / 10000;
}
