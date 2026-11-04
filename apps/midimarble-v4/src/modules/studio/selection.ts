// Selection holds entity IDs, hit keys, shot marker keys, the Song and Camera track keys and the Wall and light
// layer keys. Hit keys carry their lane so one list can mix them.

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

export function toShotKey(shotId: string): string {
	return `shot:${shotId}`;
}

export function parseShotKey(key: string): string | null {
	return key.startsWith('shot:') ? key.slice('shot:'.length) : null;
}

export function toHitKey(laneId: string, hitId: string): string {
	return `hit:${laneId}:${hitId}`;
}

export function parseHitKey(key: string): { laneId: string; hitId: string } | null {
	const [kind, laneId, hitId] = key.split(':');
	if (kind !== 'hit' || laneId == null || hitId == null) return null;
	return { laneId, hitId };
}
