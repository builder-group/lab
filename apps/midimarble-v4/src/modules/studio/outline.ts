import { decorList, type TBlenderObject } from '@/modules/design/decor';
import { addedLights } from '@/modules/design/scene-layers';
import type { TDecor, TEntity, TLane, TLight, TProject, TShot, TSource } from '@/modules/project';
import { CAMERA_KEY, KEY_LIGHT_KEY, SONG_KEY, toDecorKey, toLightKey, toMadeInBlenderKey, toShotKey, WALL_KEY } from './selection';
import { hasSongLayer, SONG_LAYER_LABEL } from './song-layer';
import { songSource } from './SourcesCx';
import type { TWorkspace } from './StudioCx';

/**
 * The project's layers in display order, which the Layers list draws and Shift ranges and arrow keys follow:
 * the Song while the project has one, each marble with the pieces it plays or that follow it in hit order, Pieces
 * (those no marble plays or follows), the Wall, the Lights, the Camera with its shots, Titles and Decor, a fixed order by
 * kind. Compose is the performance and shows only the Song and the marbles with their pieces; Film is the
 * presentation and shows every layer. Rows of a collapsed group leave out
 * their children. The timeline shows the same layers as rows, like After Effects: the rows with a `track`.
 */
export function buildOutline(project: TProject, options: TOutlineOptions = {}): TOutlineRow[] {
	const { collapsed = [], workspace = 'design', blenderObjects = [] } = options;
	const rows: TOutlineRow[] = [];

	if (hasSongLayer(project)) rows.push({ kind: 'song', id: SONG_KEY, depth: 0, parentId: null, track: 'song', source: songSource(project), label: SONG_LAYER_LABEL });

	for (const lane of project.music.lanes) {
		const marble = project.entities.find((entity) => entity.components.marble?.laneId === lane.id);
		const id = marble?.id ?? lane.id;
		const pieces = lanePieces(project, lane);
		const isOpen = !collapsed.includes(lane.id);
		rows.push({ kind: 'marble', id, depth: 0, parentId: null, track: 'lane', lane, groupKey: lane.id, hasChildren: pieces.length > 0, isOpen });
		if (isOpen) for (const piece of pieces) rows.push({ kind: 'piece', id: piece.id, depth: 1, parentId: id, track: null, piece, laneId: lane.id });
	}

	// Newest first, like Figma's layer list
	const free = project.entities.filter((entity) => entity.components.piece != null && entity.components.hitLink == null).reverse();
	if (free.length > 0) {
		const isOpen = !collapsed.includes(FREE_PIECES_KEY);
		rows.push({ kind: 'group', id: FREE_PIECES_KEY, depth: 0, parentId: null, track: null, label: PIECES_GROUP_LABEL, help: PIECES_GROUP_HELP, groupKey: FREE_PIECES_KEY, childIds: free.map((piece) => piece.id), isOpen });
		if (isOpen) for (const piece of free) rows.push({ kind: 'piece', id: piece.id, depth: 1, parentId: FREE_PIECES_KEY, track: null, piece, laneId: null });
	}

	if (workspace === 'compose') return rows;

	rows.push({ kind: 'wall', id: WALL_KEY, depth: 0, parentId: null, track: null });

	const lights = addedLights(project.design);
	const isLightsOpen = !collapsed.includes(LIGHTS_KEY);
	rows.push({ kind: 'group', id: LIGHTS_KEY, depth: 0, parentId: null, track: null, label: 'Lights', groupKey: LIGHTS_KEY, childIds: [KEY_LIGHT_KEY, ...lights.map((light) => toLightKey(light.id))], isOpen: isLightsOpen });
	if (isLightsOpen) {
		rows.push({ kind: 'light', id: KEY_LIGHT_KEY, depth: 1, parentId: LIGHTS_KEY, track: null, label: KEY_LIGHT_LABEL, light: null });
		for (const light of lights) rows.push({ kind: 'light', id: toLightKey(light.id), depth: 1, parentId: LIGHTS_KEY, track: null, label: light.name, light });
	}

	const shots = [...project.design.camera.shots].sort((a, b) => a.time - b.time);
	const isCameraOpen = !collapsed.includes(CAMERA_KEY);
	rows.push({ kind: 'camera', id: CAMERA_KEY, depth: 0, parentId: null, track: 'camera', groupKey: CAMERA_KEY, hasChildren: shots.length > 0, isOpen: isCameraOpen });
	if (isCameraOpen) for (const shot of shots) rows.push({ kind: 'shot', id: toShotKey(shot.id), depth: 1, parentId: CAMERA_KEY, track: null, shot });

	// Titles and Decor always show in Film, empty too, each with its inline +
	const titles = project.entities.filter((entity) => entity.components.wallText != null).reverse();
	{
		const isOpen = !collapsed.includes(TITLES_KEY);
		rows.push({ kind: 'group', id: TITLES_KEY, depth: 0, parentId: null, track: null, label: 'Titles', groupKey: TITLES_KEY, childIds: titles.map((title) => title.id), isOpen, ...(titles.length === 0 ? { isEmpty: true } : {}) });
		if (isOpen) for (const title of titles) rows.push({ kind: 'title', id: title.id, depth: 1, parentId: TITLES_KEY, track: null, entity: title });
	}

	// Newest first, like the titles; what Blender holds comes after, since the app didn't place it
	const decor = [...decorList(project.design)].reverse();
	{
		const isOpen = !collapsed.includes(DECOR_KEY);
		const childIds = [...decor.map((item) => toDecorKey(item.id)), ...blenderObjects.map((object) => toMadeInBlenderKey(object.name))];
		rows.push({ kind: 'group', id: DECOR_KEY, depth: 0, parentId: null, track: null, label: DECOR_GROUP_LABEL, help: DECOR_GROUP_HELP, groupKey: DECOR_KEY, childIds, isOpen, ...(childIds.length === 0 ? { isEmpty: true } : {}) });
		if (isOpen) {
			for (const item of decor) rows.push({ kind: 'decor', id: toDecorKey(item.id), depth: 1, parentId: DECOR_KEY, track: null, decor: item });
			for (const object of blenderObjects) rows.push({ kind: 'madeInBlender', id: toMadeInBlenderKey(object.name), depth: 1, parentId: DECOR_KEY, track: null, name: object.name });
		}
	}

	return rows;
}

export interface TOutlineOptions {
	/** Group keys of folded groups: a lane ID, the Camera key or a group row's ID */
	collapsed?: string[];
	/** Compose leaves out the Wall, the Lights, the Camera, its shots, the titles and Decor; Film, the default, shows every layer */
	workspace?: TWorkspace;
	/** Objects the Blender file holds that the app doesn't own, listed under Decor as Made in Blender */
	blenderObjects?: readonly TBlenderObject[];
}

/** Group row of the pieces tied to nothing; its ID is never a selection key */
export const FREE_PIECES_KEY = 'group:free';

/** Name of the group of pieces no marble plays or follows (words.md: Pieces) */
export const PIECES_GROUP_LABEL = 'Pieces';

/** The ? beside the Pieces group: unlinked pieces still collide */
export const PIECES_GROUP_HELP = 'Pieces no marble plays or follows; marbles can still hit them';

/** Group row of the titles on the wall; its ID is never a selection key */
export const TITLES_KEY = 'group:titles';

/** Group row of the decorations; its ID is never a selection key */
export const DECOR_KEY = 'group:decor';

/** Name of the group of decorations (words.md: Decor) */
export const DECOR_GROUP_LABEL = 'Decor';

/** The ? beside the Decor group: decor never collides */
export const DECOR_GROUP_HELP = 'What dresses the film. Decor has no hitbox, so it never changes a hit';

/** Group row of the Key Light and the added lights; its ID is never a selection key */
export const LIGHTS_KEY = 'group:lights';

/** Name of the theme's light (words.md: Key Light) */
export const KEY_LIGHT_LABEL = 'Key Light';

/** The timeline track a row also has */
export type TOutlineTrack = 'song' | 'lane' | 'camera';

interface TOutlineRowBase {
	/** Selection key of the row, or a group key for a group row */
	id: string;
	depth: number;
	parentId: string | null;
	track: TOutlineTrack | null;
}

export type TOutlineRow =
	// Without a file the Song layer holds only Backing notes
	| (TOutlineRowBase & { kind: 'song'; track: 'song'; source: TSource | undefined; label: string })
	| (TOutlineRowBase & { kind: 'marble'; track: 'lane'; lane: TLane; groupKey: string; hasChildren: boolean; isOpen: boolean })
	| (TOutlineRowBase & { kind: 'piece'; piece: TEntity; laneId: string | null })
	| (TOutlineRowBase & { kind: 'group'; label: string; help?: string; groupKey: string; childIds: string[]; isOpen: boolean; isEmpty?: boolean })
	| (TOutlineRowBase & { kind: 'wall' })
	// `light` is null for the Key Light, which comes from the theme
	| (TOutlineRowBase & { kind: 'light'; label: string; light: TLight | null })
	| (TOutlineRowBase & { kind: 'camera'; track: 'camera'; groupKey: string; hasChildren: boolean; isOpen: boolean })
	| (TOutlineRowBase & { kind: 'shot'; shot: TShot })
	| (TOutlineRowBase & { kind: 'title'; entity: TEntity })
	| (TOutlineRowBase & { kind: 'decor'; decor: TDecor })
	| (TOutlineRowBase & { kind: 'madeInBlender'; name: string });

/** Whether a row belongs to the Film workspace only: the Wall, the Lights, the Camera with its shots, the titles and Decor */
export function isFilmRow(row: TOutlineRow): boolean {
	return row.kind === 'wall' || row.kind === 'light' || row.kind === 'camera' || row.kind === 'shot' || row.kind === 'title' || row.kind === 'decor' || row.kind === 'madeInBlender' || (row.kind === 'group' && (row.id === TITLES_KEY || row.id === LIGHTS_KEY || row.id === DECOR_KEY));
}

/** Whether a click on the row selects the row itself; group rows select their children instead */
export function isSelectableRow(row: TOutlineRow): boolean {
	return row.kind !== 'group';
}

/** Pieces linked or anchored to a lane's hits, in hit order */
function lanePieces(project: TProject, lane: TLane): TEntity[] {
	const order = new Map(lane.hits.map((hit, index) => [hit.id, index]));
	return project.entities
		.filter((entity) => entity.components.piece != null && entity.components.hitLink?.laneId === lane.id)
		.sort((a, b) => (order.get(a.components.hitLink?.hitId ?? '') ?? 0) - (order.get(b.components.hitLink?.hitId ?? '') ?? 0));
}
