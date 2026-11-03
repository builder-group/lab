// Selection holds entity IDs, hit keys, shot marker keys and the Song and Camera track keys. Hit keys carry
// their lane so one list can mix them.

/** The Song track and its row in Layers */
export const SONG_KEY = 'song';

/** The Camera track and its row in Layers */
export const CAMERA_KEY = 'camera';

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
