import { decorList, type TBlenderObject, addedLights } from '@/modules/scene';
import type { TDecor, TEntity, TGroup, TLane, TLight, TProject, TShot, TSource } from '@/modules/project';
import { startRailOf } from '@/modules/simulation';
import { CAMERA_KEY, KEY_LIGHT_KEY, SCENE_KEY, SONG_KEY, toDecorKey, toLightKey, toGroupKey, toMadeInBlenderKey, toShotKey, WALL_KEY } from '@/modules/project';
import { hasSongLayer, SONG_LAYER_LABEL } from './song-layer';
import { songSource } from './SourcesCx';
import type { TWorkspace } from './StudioCx';

/**
 * The project's layers in display order, which the Layers list draws and Shift ranges and arrow keys follow, the same in
 * both workspaces where they have the row: the Scene, the Song while the project has one, the Camera with its shots, the
 * Wall, each marble with the Rail it starts on and the pieces it plays or that follow it in hit order, Track Pieces (those no
 * marble plays, follows or starts on), then in Film the Lights, Titles and Decor. Track is the skeleton and stops after the
 * pieces; Film is what the viewer sees. A group with nothing in it has no row: what it holds is added through Insert. Rows of
 * a collapsed group leave out their children. The timeline shows only what changes over time: the Song, the Camera, the
 * marbles, and in Film Titles.
 */
export function buildOutline(project: TProject, options: TOutlineOptions = {}): TOutlineRow[] {
	const { collapsed = [], workspace = 'film', blenderObjects = [] } = options;
	const rows: TOutlineRow[] = [{ kind: 'scene', id: SCENE_KEY, depth: 0, parentId: null }];

	if (hasSongLayer(project)) rows.push({ kind: 'song', id: SONG_KEY, depth: 0, parentId: null, source: songSource(project), label: SONG_LAYER_LABEL });

	const shots = [...project.design.camera.shots].sort((a, b) => a.time - b.time);
	const isCameraOpen = !collapsed.includes(CAMERA_KEY);
	rows.push({ kind: 'camera', id: CAMERA_KEY, depth: 0, parentId: null, groupKey: CAMERA_KEY, hasChildren: shots.length > 0, isOpen: isCameraOpen });
	if (isCameraOpen) for (const shot of shots) rows.push({ kind: 'shot', id: toShotKey(shot.id), depth: 1, parentId: CAMERA_KEY, shot });

	rows.push({ kind: 'wall', id: WALL_KEY, depth: 0, parentId: null, labelColor: project.design.wall.labelColor });

	// A plain Group across marbles or of free pieces lists its pieces under Track Pieces, like one layer of them
	const looseGroups = (project.groups ?? []).filter((group) => group.laneId == null);
	const beyondMarbles = new Set(looseGroups.flatMap((group) => group.pieceIds));

	for (const lane of project.music.lanes) {
		const marble = project.entities.find((entity) => entity.components.marble?.laneId === lane.id);
		const id = marble?.id ?? lane.id;
		const pieces = lanePieces(project, lane).filter((piece) => !beyondMarbles.has(piece.id));
		const isOpen = !collapsed.includes(lane.id);
		rows.push({ kind: 'marble', id, depth: 0, parentId: null, lane, groupKey: lane.id, hasChildren: pieces.length > 0 || (project.groups ?? []).some((group) => group.laneId === lane.id), isOpen });
		if (isOpen) rows.push(...lanePieceRows(project, lane.id, id, pieces, collapsed));
	}

	// Newest first, like Figma's layer list
	const startRails = new Set(project.music.lanes.map((lane) => startRailOf(project, lane.id)));
	const free = project.entities.filter((entity) => entity.components.piece != null && entity.components.hitLink == null && !startRails.has(entity) && !beyondMarbles.has(entity.id)).reverse();
	if (free.length > 0 || looseGroups.length > 0) {
		const isOpen = !collapsed.includes(FREE_PIECES_KEY);
		rows.push({ kind: 'group', id: FREE_PIECES_KEY, depth: 0, parentId: null, label: PIECES_GROUP_LABEL, help: PIECES_GROUP_HELP, groupKey: FREE_PIECES_KEY, childIds: [...free.map((piece) => piece.id), ...beyondMarbles], isOpen });
		if (isOpen) {
			for (const group of looseGroups) {
				const isGroupOpen = !collapsed.includes(group.id);
				const key = toGroupKey(group.id);
				rows.push({ kind: 'patternGroup', id: key, depth: 1, parentId: FREE_PIECES_KEY, group, groupKey: group.id, hasChildren: group.pieceIds.length > 0, isOpen: isGroupOpen });
				if (isGroupOpen) for (const piece of project.entities.filter((entity) => group.pieceIds.includes(entity.id))) rows.push({ kind: 'piece', id: piece.id, depth: 2, parentId: key, piece, laneId: null });
			}
			for (const piece of free) rows.push({ kind: 'piece', id: piece.id, depth: 1, parentId: FREE_PIECES_KEY, piece, laneId: null });
		}
	}

	if (workspace === 'track') return rows;

	const lights = addedLights(project.design);
	const isLightsOpen = !collapsed.includes(LIGHTS_KEY);
	rows.push({ kind: 'group', id: LIGHTS_KEY, depth: 0, parentId: null, label: 'Lights', groupKey: LIGHTS_KEY, childIds: [KEY_LIGHT_KEY, ...lights.map((light) => toLightKey(light.id))], isOpen: isLightsOpen });
	if (isLightsOpen) {
		rows.push({ kind: 'light', id: KEY_LIGHT_KEY, depth: 1, parentId: LIGHTS_KEY, label: KEY_LIGHT_LABEL, light: null });
		for (const light of lights) rows.push({ kind: 'light', id: toLightKey(light.id), depth: 1, parentId: LIGHTS_KEY, label: light.name, light });
	}

	const titles = project.entities.filter((entity) => entity.components.wallText != null).reverse();
	if (titles.length > 0) {
		const isOpen = !collapsed.includes(TITLES_KEY);
		rows.push({ kind: 'group', id: TITLES_KEY, depth: 0, parentId: null, label: 'Titles', groupKey: TITLES_KEY, childIds: titles.map((title) => title.id), isOpen });
		if (isOpen) for (const title of titles) rows.push({ kind: 'title', id: title.id, depth: 1, parentId: TITLES_KEY, entity: title });
	}

	// Newest first, like the titles; what Blender holds comes after, since the app didn't place it
	const decor = [...decorList(project.design)].reverse();
	const childIds = [...decor.map((item) => toDecorKey(item.id)), ...blenderObjects.map((object) => toMadeInBlenderKey(object.name))];
	if (childIds.length > 0) {
		const isOpen = !collapsed.includes(DECOR_KEY);
		rows.push({ kind: 'group', id: DECOR_KEY, depth: 0, parentId: null, label: DECOR_GROUP_LABEL, groupKey: DECOR_KEY, childIds, isOpen });
		if (isOpen) {
			for (const item of decor) rows.push({ kind: 'decor', id: toDecorKey(item.id), depth: 1, parentId: DECOR_KEY, decor: item });
			for (const object of blenderObjects) rows.push({ kind: 'madeInBlender', id: toMadeInBlenderKey(object.name), depth: 1, parentId: DECOR_KEY, name: object.name });
		}
	}

	return rows;
}

/**
 * The groups that start closed: in Film the marbles' pieces and Decor, so the Lights and Titles are in view
 * without scrolling; none in Track, where the pieces are the work
 */
export function defaultCollapsed(project: TProject, workspace: 'track' | 'film'): string[] {
	const groups = (project.groups ?? []).map((group) => group.id);
	return workspace === 'film' ? [...project.music.lanes.map((lane) => lane.id), DECOR_KEY, ...groups] : groups;
}

/** The closed groups: the defaults, with the ones the user toggled the other way */
export function collapsedGroups(project: TProject, workspace: 'track' | 'film', toggled: readonly string[]): string[] {
	const defaults = defaultCollapsed(project, workspace);
	return [...defaults.filter((key) => !toggled.includes(key)), ...toggled.filter((key) => !defaults.includes(key))];
}

/** The groups that hold the selected layers, which a selection made outside Layers opens */
export function groupsOfSelection(project: TProject, selection: readonly string[]): string[] {
	return selection.flatMap((key) => {
		if (key.startsWith('decor:') || key.startsWith('blender:')) return [DECOR_KEY];
		const laneId = project.entities.find((entity) => entity.id === key)?.components.hitLink?.laneId ?? project.music.lanes.find((lane) => startRailOf(project, lane.id)?.id === key)?.id;
		const group = project.groups?.find((item) => item.pieceIds.includes(key));
		if (laneId != null && group?.laneId != null) return [laneId, group.id];
		if (group != null) return [FREE_PIECES_KEY, group.id];
		return laneId != null ? [laneId] : [];
	});
}

export interface TOutlineOptions {
	/** Group keys of folded groups: a lane ID, the Camera key or a group row's ID */
	collapsed?: string[];
	/** Track leaves out the Lights, the titles and Decor; Film, the default, shows every layer */
	workspace?: TWorkspace;
	/** Objects the Blender file holds that the app doesn't own, listed under Decor as Made in Blender */
	blenderObjects?: readonly TBlenderObject[];
}

/** Group row of the pieces tied to nothing; its ID is never a selection key */
export const FREE_PIECES_KEY = 'group:free';

/** Name of the group of pieces no marble plays or follows (words.md: Track Pieces) */
export const PIECES_GROUP_LABEL = 'Track Pieces';

/** The ? beside the Track Pieces group: unlinked pieces still collide */
export const PIECES_GROUP_HELP = 'Parts of the track no marble plays or follows; marbles can still hit them';

/** Group row of the titles on the wall; its ID is never a selection key */
export const TITLES_KEY = 'group:titles';

/** Group row of the decorations; its ID is never a selection key */
export const DECOR_KEY = 'group:decor';

/** Name of the group of decorations (words.md: Decor) */
export const DECOR_GROUP_LABEL = 'Decor';

/** Group row of the Key Light and the added lights; its ID is never a selection key */
export const LIGHTS_KEY = 'group:lights';

/** Name of the theme's light (words.md: Key Light) */
export const KEY_LIGHT_LABEL = 'Key Light';

interface TOutlineRowBase {
	/** Selection key of the row, or a group key for a group row */
	id: string;
	depth: number;
	parentId: string | null;
}

export type TOutlineRow =
	// Selecting it empties the selection: see SCENE_KEY
	| (TOutlineRowBase & { kind: 'scene' })
	// Without a file the Song layer holds only Backing notes
	| (TOutlineRowBase & { kind: 'song'; source: TSource | undefined; label: string })
	| (TOutlineRowBase & { kind: 'marble'; lane: TLane; groupKey: string; hasChildren: boolean; isOpen: boolean })
	| (TOutlineRowBase & { kind: 'piece'; piece: TEntity; laneId: string | null })
	// What a Pattern made (prototype) or a plain Group: selects as itself, with its pieces under it
	| (TOutlineRowBase & { kind: 'patternGroup'; group: TGroup; groupKey: string; hasChildren: boolean; isOpen: boolean })
	| (TOutlineRowBase & { kind: 'group'; label: string; help?: string; groupKey: string; childIds: string[]; isOpen: boolean })
	| (TOutlineRowBase & { kind: 'wall'; labelColor: string | undefined })
	// `light` is null for the Key Light, which comes from the theme
	| (TOutlineRowBase & { kind: 'light'; label: string; light: TLight | null })
	| (TOutlineRowBase & { kind: 'camera'; groupKey: string; hasChildren: boolean; isOpen: boolean })
	| (TOutlineRowBase & { kind: 'shot'; shot: TShot })
	| (TOutlineRowBase & { kind: 'title'; entity: TEntity })
	| (TOutlineRowBase & { kind: 'decor'; decor: TDecor })
	| (TOutlineRowBase & { kind: 'madeInBlender'; name: string });

/** Whether a row belongs to the Film workspace only: the Lights, the titles and Decor */
export function isFilmRow(row: TOutlineRow): boolean {
	return row.kind === 'light' || row.kind === 'title' || row.kind === 'decor' || row.kind === 'madeInBlender' || (row.kind === 'group' && (row.id === TITLES_KEY || row.id === LIGHTS_KEY || row.id === DECOR_KEY));
}

/** Whether a click on the row selects the row itself; group rows select their children instead */
export function isSelectableRow(row: TOutlineRow): boolean {
	return row.kind !== 'group';
}

/** A marble's pieces in hit order, those of a Group under its row, which comes where its first piece would */
function lanePieceRows(project: TProject, laneId: string, parentId: string, pieces: readonly TEntity[], collapsed: readonly string[]): TOutlineRow[] {
	const groups = (project.groups ?? []).filter((group) => group.laneId === laneId);
	const ofPiece = new Map(groups.flatMap((group) => group.pieceIds.map((id) => [id, group] as const)));
	const rows: TOutlineRow[] = [];
	const shown = new Set<string>();
	const groupRow = (group: TGroup): void => {
		shown.add(group.id);
		const inGroup = pieces.filter((piece) => ofPiece.get(piece.id)?.id === group.id);
		const isOpen = !collapsed.includes(group.id);
		const key = toGroupKey(group.id);
		rows.push({ kind: 'patternGroup', id: key, depth: 1, parentId, group, groupKey: group.id, hasChildren: inGroup.length > 0, isOpen });
		if (isOpen) for (const piece of inGroup) rows.push({ kind: 'piece', id: piece.id, depth: 2, parentId: key, piece, laneId });
	};
	for (const piece of pieces) {
		const group = ofPiece.get(piece.id);
		if (group == null) rows.push({ kind: 'piece', id: piece.id, depth: 1, parentId, piece, laneId });
		else if (!shown.has(group.id)) groupRow(group);
	}
	for (const group of groups) if (!shown.has(group.id)) groupRow(group);
	return rows;
}

/** The Rail the lane's marble starts on, then the pieces linked or anchored to its hits, in hit order */
function lanePieces(project: TProject, lane: TLane): TEntity[] {
	const order = new Map(lane.hits.map((hit, index) => [hit.id, index]));
	const startRail = startRailOf(project, lane.id);
	const tied = project.entities
		.filter((entity) => entity.components.piece != null && entity.components.hitLink?.laneId === lane.id)
		.sort((a, b) => (order.get(a.components.hitLink?.hitId ?? '') ?? 0) - (order.get(b.components.hitLink?.hitId ?? '') ?? 0));
	return startRail != null ? [startRail, ...tied] : tied;
}
