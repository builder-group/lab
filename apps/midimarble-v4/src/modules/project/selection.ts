import type { TProject } from './schema';

// Selection holds entity IDs, hit keys, shot marker keys, the Song and Camera track keys and the Wall and light
// layer keys. Hit keys carry their marble so one list can mix them.

/**
 * The Scene row in Layers, like Blender's Scene Collection. An empty selection is the Scene, so this key never enters
 * the selection: whatever clears the selection (an empty click, Esc, deleting the selected layer) selects the Scene,
 * and nothing can stay stuck on a layer.
 */
export const SCENE_KEY = 'scene';

/** The Song track and its row in Layers */
export const SONG_KEY = 'song';

/** The Camera track and its row in Layers */
export const CAMERA_KEY = 'camera';

/** The Wall layer in Layers; it has no timeline row */
export const WALL_KEY = 'wall';

/** The light ID of the Key Light, which comes from the theme; added lights have created IDs with a prefix */
export const KEY_LIGHT_ID = 'key';

/** The Key Light layer in Layers; it has no timeline row */
export const KEY_LIGHT_KEY = 'light:key';

export function toLightKey(lightId: string): string {
	return `light:${lightId}`;
}

/** The light a key selects: `key` for the Key Light, an added light's ID otherwise */
export function parseLightKey(key: string): string | null {
	return key.startsWith('light:') ? key.slice('light:'.length) : null;
}

export function toDecorKey(decorId: string): string {
	return `decor:${decorId}`;
}

export function parseDecorKey(key: string): string | null {
	return key.startsWith('decor:') ? key.slice('decor:'.length) : null;
}

/** An object added directly in Blender, by its Blender name */
export function toMadeInBlenderKey(name: string): string {
	return `blender:${name}`;
}

export function parseMadeInBlenderKey(key: string): string | null {
	return key.startsWith('blender:') ? key.slice('blender:'.length) : null;
}

export function toShotKey(shotId: string): string {
	return `shot:${shotId}`;
}

export function parseShotKey(key: string): string | null {
	return key.startsWith('shot:') ? key.slice('shot:'.length) : null;
}

/**
 * Where Previous and Next Hit go. In Track they stay on the marble in focus (of the selected hit, platform or marble)
 * and go on from the selected hit; with nothing in focus, and in Film, they step every marble's hits from the playhead.
 */
export function stepHitTarget(project: TProject, selection: readonly string[], playhead: number, direction: 1 | -1, isTrack: boolean): { marbleId: string; hitId: string; time: number } | null {
	const focus = isTrack ? stepFocus(project, selection) : null;
	const marbles = focus == null ? project.music.marbles : project.music.marbles.filter((marble) => marble.id === focus.marbleId);
	const hits = marbles.flatMap((marble) => marble.hits.map((hit) => ({ marbleId: marble.id, hitId: hit.id, time: hit.time }))).sort((a, b) => a.time - b.time);
	const from = focus?.time ?? playhead;
	return (direction === 1 ? hits.find((hit) => hit.time > from + 1e-4) : [...hits].reverse().find((hit) => hit.time < from - 1e-4)) ?? null;
}

function stepFocus(project: TProject, selection: readonly string[]): { marbleId: string; time: number | null } | null {
	for (const key of selection) {
		const parsed = parseHitKey(key);
		const entity = project.entities.find((item) => item.id === key);
		const hitId = parsed?.hitId ?? entity?.components.hitLink?.hitId;
		const marbleId = parsed?.marbleId ?? entity?.components.hitLink?.marbleId ?? entity?.components.marble?.marbleId;
		const marble = project.music.marbles.find((item) => item.id === marbleId);
		if (marble != null) return { marbleId: marble.id, time: marble.hits.find((hit) => hit.id === hitId)?.time ?? null };
	}
	return null;
}

/** A Group from a Pattern (prototype), selected together with its pieces */
export function toGroupKey(groupId: string): string {
	return `pattern:${groupId}`;
}

export function parseGroupKey(key: string): string | null {
	return key.startsWith('pattern:') ? key.slice('pattern:'.length) : null;
}

/** A silence dragged out in a marble's Pattern strip; a range over notes selects the notes instead */
export function toRangeKey(marbleId: string, from: number, to: number): string {
	return `range:${marbleId}:${from.toFixed(4)}:${to.toFixed(4)}`;
}

export function parseRangeKey(key: string): { marbleId: string; from: number; to: number } | null {
	const [kind, marbleId, from, to] = key.split(':');
	if (kind !== 'range' || marbleId == null || from == null || to == null) return null;
	return { marbleId, from: Number(from), to: Number(to) };
}

export function toHitKey(marbleId: string, hitId: string): string {
	return `hit:${marbleId}:${hitId}`;
}

export function parseHitKey(key: string): { marbleId: string; hitId: string } | null {
	const [kind, marbleId, hitId] = key.split(':');
	if (kind !== 'hit' || marbleId == null || hitId == null) return null;
	return { marbleId, hitId };
}
