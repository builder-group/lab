import { noteName, objectCatalog, type TProject, type TSceneObject } from '../project';

/** Projects the existing links into collections without changing the saved document. */
export function getObjectCollections(
	project: TProject,
	query = '',
	filter: TObjectFilter = 'all'
): TObjectCollection[] {
	const notes = new Map(project.notes.map((note) => [note.id, note]));
	const tracks = new Map(project.tracks.map((track) => [track.id, track]));
	const collections: TObjectCollection[] = [
		{ id: 'world', label: 'World objects', kind: 'world', objects: [] },
		...project.tracks.map((track): TObjectCollection => ({
			id: `track:${track.id}`,
			label: track.name,
			color: track.color,
			kind: 'track',
			objects: []
		})),
		{ id: 'unassigned', label: 'Unassigned links', kind: 'track', objects: [] },
		{ id: 'guides', label: 'Trajectory guides', kind: 'guides', objects: [] }
	];
	const byId = new Map(collections.map((collection) => [collection.id, collection]));
	const terms = query.trim().toLowerCase().replaceAll('#', '♯').split(/\s+/).filter(Boolean);
	for (const object of project.objects) {
		const linked = object.binding != null || object.trajectoryAnchor != null;
		if ((filter === 'world' && linked) || (filter === 'linked' && !linked)) continue;
		const note = object.binding == null ? null : notes.get(object.binding.noteId);
		const track = note == null ? null : tracks.get(note.trackId);
		const model = objectCatalog.find((asset) => asset.id === object.modelId);
		const text = [
			object.name,
			object.kind,
			object.modelId,
			model?.label,
			track?.name,
			note == null ? '' : `${noteName(note.midi)} ${note.midi}`,
			linked ? 'linked' : 'world',
			object.trajectoryAnchor == null ? '' : 'trajectory guide'
		]
			.join(' ')
			.toLowerCase();
		if (!terms.every((term) => text.includes(term))) continue;
		let collectionId = 'world';
		if (object.binding != null) collectionId = track == null ? 'unassigned' : `track:${track.id}`;
		else if (object.trajectoryAnchor != null) collectionId = 'guides';
		byId.get(collectionId)?.objects.push(object);
	}
	return collections.filter((collection) => collection.objects.length > 0);
}

export interface TObjectCollection {
	id: string;
	label: string;
	kind: 'world' | 'track' | 'guides';
	color?: string;
	objects: TSceneObject[];
}

export type TObjectFilter = 'all' | 'linked' | 'world';

/** Moves through the visible rows only, in the order of the expanded collections. */
export function getAdjacentObjectId(
	ids: string[],
	currentId: string,
	key: TObjectNavigationKey
): string | null {
	if (!ids.length) return null;
	if (key === 'Home') return ids[0] ?? null;
	if (key === 'End') return ids[ids.length - 1] ?? null;
	const index = ids.indexOf(currentId);
	if (index < 0) return ids[0] ?? null;
	return ids[Math.max(0, Math.min(ids.length - 1, index + (key === 'ArrowDown' ? 1 : -1)))] ?? null;
}

export type TObjectNavigationKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End';
