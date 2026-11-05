import type { TEntity, TProject, TProjectCommand } from '@/modules/project';
import { pieceLabel } from '@/modules/simulation';

/**
 * The name of a person's edit in Edit > Undo, read from what its commands changed: "Move Platform", "Tilt", "Delete 3
 * Pieces". Null for an edit with no plain name, which stays "Undo". Edits that know better pass their own label to
 * `execute`, such as Duplicate or Build Track.
 */
export function editLabel(before: TProject, after: TProject, commands: readonly TProjectCommand[]): string | null {
	return entitiesLabel(before, after, commands) ?? commands.reduce<string | null>((label, command) => label ?? commandLabel(before, command), null);
}

function entitiesLabel(before: TProject, after: TProject, commands: readonly TProjectCommand[]): string | null {
	const had = new Map(before.entities.map((entity) => [entity.id, entity]));
	const has = new Set(after.entities.map((entity) => entity.id));
	const removed = before.entities.filter((entity) => !has.has(entity.id));
	if (removed.length > 0) return `Delete ${noun(removed)}`;
	const added = after.entities.filter((entity) => !had.has(entity.id));
	if (added.length > 0) return `Add ${noun(added)}`;
	const touched = new Set(commands.flatMap((command) => (command.type === 'upsertEntity' ? [command.entity.id] : command.type === 'setComponent' || command.type === 'removeComponent' ? [command.entityId] : [])));
	const changed = after.entities.filter((entity) => touched.has(entity.id));
	const first = changed[0];
	const old = first != null ? had.get(first.id) : null;
	if (first == null || old == null) return null;
	return changeLabel(old, first, changed);
}

/** What the first changed entity tells about the edit; a selection edited together changed the same way */
function changeLabel(old: TEntity, next: TEntity, changed: TEntity[]): string | null {
	const [from, to] = [old.components, next.components];
	if (old.name !== next.name) return `Rename ${noun([next])}`;
	if (old.labelColor !== next.labelColor) return 'Label Color';
	if (from.hitLink != null && to.hitLink == null) return 'Detach';
	if (from.hitLink == null && to.hitLink != null) return `Tie ${noun([next])}`;
	const isMoved = !isSame(from.transform?.position, to.transform?.position) || from.hitLink?.contactAt !== to.hitLink?.contactAt;
	if (isMoved) return `Move ${noun(changed)}`;
	if (from.transform?.angle !== to.transform?.angle || from.hitLink?.angle !== to.hitLink?.angle) return 'Tilt';
	if (!isSame(from.skin, to.skin)) return 'Change Skin';
	if (!isSame(from.wallText, to.wallText)) return 'Edit Title';
	return !isSame(old, next) ? `Change ${noun(changed)}` : null;
}

function commandLabel(before: TProject, command: TProjectCommand): string | null {
	switch (command.type) {
		case 'updateProject':
			if (command.patch.length != null) return 'Change Length';
			if (command.patch.format != null) return 'Change Format';
			if (command.patch.gravity != null) return 'Change Gravity';
			return null;
		case 'setTempo':
			return 'Change Tempo';
		case 'setBackingInstrument':
			return 'Change Backing';
		case 'upsertSource':
			return 'Import Song';
		case 'removeSource':
			return 'Delete Song';
		case 'removeLane':
			return 'Delete Marble';
		case 'upsertLane': {
			const lane = before.music.lanes.find((item) => item.id === command.lane.id);
			if (lane == null) return 'Add Marble';
			if (lane.name !== command.lane.name) return 'Rename Marble';
			return lane.color !== command.lane.color ? 'Label Color' : 'Change Marble';
		}
		case 'upsertHits': {
			const ids = new Set([...before.music.lanes.flatMap((lane) => lane.hits), ...before.music.backing].map((hit) => hit.id));
			const isNew = command.hits.some((hit) => !ids.has(hit.id));
			return `${isNew ? 'Add' : 'Move'} ${counted(command.hits.length, 'Hit')}`;
		}
		case 'removeHits':
			return `Delete ${counted(command.hitIds.length, 'Hit')}`;
		case 'assignHits':
			return `Hand Over ${counted(command.hitIds.length, 'Hit')}`;
		case 'upsertGroup': {
			const group = before.groups?.find((item) => item.id === command.group.id);
			return group != null && group.name !== command.group.name ? 'Rename Group' : 'Change Group';
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
	if (film.decor != null) return listLabel(before.film.decor, film.decor, 'Decor', 'Decor');
	if (film.lights != null) return listLabel(before.film.lights.added, film.lights.added, 'Light', 'Lights');
	if (film.camera != null) return film.camera.shots.length !== before.film.camera.shots.length ? listLabel(before.film.camera.shots, film.camera.shots, 'Shot', 'Shots') : 'Change Camera';
	if (film.theme != null || film.themes != null) return 'Change Theme';
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
function noun(entities: readonly TEntity[]): string {
	const kinds = new Set(entities.map(kindLabel));
	const [kind = 'Piece'] = kinds;
	return entities.length === 1 ? kind : `${entities.length} ${kinds.size === 1 ? kind : 'Piece'}s`;
}

function kindLabel(entity: TEntity): string {
	const type = entity.components.piece?.type;
	if (type != null) return pieceLabel(type);
	if (entity.components.wallText != null) return 'Title';
	return entity.components.marble != null ? 'Marble' : 'Piece';
}

function counted(count: number, one: string): string {
	return count === 1 ? one : `${count} ${one}s`;
}

function isSame(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}
