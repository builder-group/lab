import { FILM_LAYERS, type TMarble, type TPiece, type TProject, type TProjectCommand, type TTitle, backingOf, freePosition, tieOf } from '@/modules/project';
import { pieceLabel } from '@/modules/simulation';

/**
 * The name of a person's edit in Edit > Undo, read from what its commands changed: "Move Platform", "Tilt", "Delete 3
 * Pieces". Null for an edit with no plain name, which stays "Undo". Edits that know better pass their own label to
 * `execute`, such as Duplicate or Build Track.
 */
export function editLabel(before: TProject, after: TProject, commands: readonly TProjectCommand[]): string | null {
	return layersLabel(before, after, commands) ?? commands.reduce<string | null>((label, command) => label ?? commandLabel(before, command), null);
}

/** What a selection key can name and an edit can add, remove or change */
type TLayer = TMarble | TPiece | TTitle;

function layersOf(project: TProject): TLayer[] {
	return [...project.marbles, ...project.track.pieces, ...project.film.titles];
}

function layersLabel(before: TProject, after: TProject, commands: readonly TProjectCommand[]): string | null {
	const had = new Map(layersOf(before).map((layer) => [layer.id, layer]));
	const has = new Set(layersOf(after).map((layer) => layer.id));
	const removed = layersOf(before).filter((layer) => !has.has(layer.id));
	if (removed.length > 0) return `Delete ${noun(removed)}`;
	const added = layersOf(after).filter((layer) => !had.has(layer.id));
	if (added.length > 0) return `Add ${noun(added)}`;
	const touched = new Set(commands.flatMap((command) => touchedIds(command, had)));
	const changed = layersOf(after).filter((layer) => touched.has(layer.id));
	const first = changed[0];
	const old = first != null ? had.get(first.id) : null;
	if (first == null || old == null) return null;
	return changeLabel(old, first, changed);
}

/** The layers a command names; titles change as a whole list, so those that differ */
function touchedIds(command: TProjectCommand, had: ReadonlyMap<string, TLayer>): string[] {
	switch (command.type) {
		case 'addMarble':
			return [command.marble.id];
		case 'updateMarble':
			return [command.marbleId];
		case 'addPiece':
			return [command.piece.id];
		case 'updatePiece':
			return [command.pieceId];
		case 'updateFilm':
			return (command.film.titles ?? []).filter((title) => !isSame(title, had.get(title.id))).map((title) => title.id);
		default:
			return [];
	}
}

/** What the first changed layer tells about the edit; a selection edited together changed the same way */
function changeLabel(old: TLayer, next: TLayer, changed: TLayer[]): string | null {
	if (old.name !== next.name) return `Rename ${noun([next])}`;
	if (old.labelColor !== next.labelColor) return 'Label Color';
	const [fromTie, toTie] = [tieOfLayer(old), tieOfLayer(next)];
	if (fromTie != null && toTie == null) return 'Detach';
	if (fromTie == null && toTie != null) return `Tie ${noun([next])}`;
	if (!isSame(positionOf(old), positionOf(next)) || fromTie?.contactAt !== toTie?.contactAt) return `Move ${noun(changed)}`;
	if (angleOf(old) !== angleOf(next)) return 'Tilt';
	if (!isSame(skinOf(old), skinOf(next))) return 'Change Skin';
	if (isSame(old, next)) return null;
	return 'text' in next ? 'Edit Title' : `Change ${noun(changed)}`;
}

function tieOfLayer(layer: TLayer): ReturnType<typeof tieOf> {
	return 'place' in layer ? tieOf(layer) : null;
}

function positionOf(layer: TLayer): unknown {
	if ('place' in layer) return freePosition(layer);
	return 'position' in layer ? layer.position : undefined;
}

function angleOf(layer: TLayer): number | undefined {
	return 'angle' in layer ? layer.angle : undefined;
}

function skinOf(layer: TLayer): unknown {
	return 'skin' in layer ? layer.skin : undefined;
}

function commandLabel(before: TProject, command: TProjectCommand): string | null {
	switch (command.type) {
		case 'updateProject':
			if (command.patch.length != null) return 'Change Length';
			if (command.patch.format != null) return 'Change Format';
			if (command.patch.gravity != null) return 'Change Gravity';
			return null;
		case 'updateSong':
			if (command.patch.tempo !== undefined) return 'Change Tempo';
			return command.patch.backingSound !== undefined ? 'Change Backing' : null;
		case 'moveSong':
			return 'Move Song';
		case 'addSong':
			return 'Import Song';
		case 'removeSong':
			// Backing without a file is notes alone
			{
			const song = before.songs.find((item) => item.id === command.songId);
			return song == null || song.path != null ? 'Delete Song' : `Delete ${counted(song.backing.length, 'Note')}`;
		}
		case 'removeMarble':
			return 'Delete Marble';
		case 'addMarble':
		case 'updateMarble':
			return 'Change Marble';
		case 'upsertHits': {
			const ids = new Set([...before.marbles.flatMap((marble) => marble.hits), ...backingOf(before)].map((hit) => hit.id));
			const isNew = command.hits.some((hit) => !ids.has(hit.id));
			return `${isNew ? 'Add' : 'Move'} ${counted(command.hits.length, 'Note')}`;
		}
		case 'removeHits':
			return `Delete ${counted(command.hitIds.length, 'Note')}`;
		case 'assignHits':
			return `Hand Over ${counted(command.hitIds.length, 'Note')}`;
		case 'addGroup': {
			const group = before.track.groups.find((item) => item.id === command.group.id);
			return group != null && group.name !== command.group.name ? 'Rename Group' : 'Change Group';
		}
		case 'updateGroup': {
			const group = before.track.groups.find((item) => item.id === command.groupId);
			return group != null && command.patch.name != null && group.name !== command.patch.name ? 'Rename Group' : 'Change Group';
		}
		case 'removeGroups':
			return 'Ungroup';
		case 'updateFilm':
			return filmLabel(before, command.film);
		default:
			return null;
	}
}

function filmLabel(before: TProject, film: Extract<TProjectCommand, { type: 'updateFilm' }>['film']): string | null {
	for (const layer of FILM_LAYERS) {
		const after = layer.items(film);
		if (after != null && layer.words != null) return listLabel(layer.items(before.film) ?? [], after, layer.words.one, layer.words.many);
	}
	if (film.camera != null) return film.camera.shots.length !== before.film.camera.shots.length ? listLabel(before.film.camera.shots, film.camera.shots, 'Shot', 'Shots') : 'Change Camera';
	if (film.theme != null) return 'Change Theme';
	if (film.wall != null) return 'Change Wall';
	return null;
}

/** Added, deleted or changed items of a list in the film, with a move named for what moves */
function listLabel<GItem extends { position?: unknown; id: string }>(before: readonly GItem[], after: readonly GItem[], one: string, many: string): string {
	if (after.length > before.length) return `Add ${one}`;
	if (after.length < before.length) return `Delete ${after.length === before.length - 1 ? one : many}`;
	const changed = after.find((item) => !isSame(item, before.find((old) => old.id === item.id)));
	return changed != null && !isSame(changed.position, before.find((old) => old.id === changed.id)?.position) ? `Move ${one}` : `Change ${one}`;
}

/** "Platform", "3 Platforms", or "3 Pieces" when they are different kinds */
function noun(layers: readonly TLayer[]): string {
	const kinds = new Set(layers.map(kindLabel));
	const [kind = 'Piece'] = kinds;
	return layers.length === 1 ? kind : `${layers.length} ${kinds.size === 1 ? kind : 'Piece'}s`;
}

function kindLabel(layer: TLayer): string {
	if ('type' in layer) return pieceLabel(layer.type);
	return 'text' in layer ? 'Title' : 'Marble';
}

function counted(count: number, one: string): string {
	return count === 1 ? one : `${count} ${one}s`;
}

function isSame(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}
