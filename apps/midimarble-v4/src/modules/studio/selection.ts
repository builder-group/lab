// Selection holds entity IDs and hit keys. Hit keys carry their lane so one list can mix both.

export function toHitKey(laneId: string, hitId: string): string {
	return `hit:${laneId}:${hitId}`;
}

export function parseHitKey(key: string): { laneId: string; hitId: string } | null {
	const [kind, laneId, hitId] = key.split(':');
	if (kind !== 'hit' || laneId == null || hitId == null) return null;
	return { laneId, hitId };
}
