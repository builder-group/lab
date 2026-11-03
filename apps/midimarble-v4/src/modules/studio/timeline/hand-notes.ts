import type { TMenuEntry } from '@/components';
import { assignNotesCommands, DEFAULT_BACKING_INSTRUMENT, newMarbleCommands } from '@/modules/music';
import { BACKING_ID, type THit, type TProject } from '@/modules/project';
import { parseHitKey, toHitKey } from '../selection';
import type { StudioCx } from '../StudioCx';

/**
 * Hands the notes of `keys` to a marble, to a new marble or to Backing as one undo step and keeps them selected.
 * Their platforms go with them to the other marble, or are removed for Backing.
 */
export function handNotes(cx: StudioCx, keys: string[], target: string | 'new'): boolean {
	const project = cx.project;
	if (project == null) return false;
	const notes = selectedNotes(project, keys);
	if (!notes.length) return false;
	const hitIds = notes.map((item) => item.hit.id);
	const result = cx.simulation.$result.get();
	const created = target === 'new' ? newMarbleCommands(project, Math.min(...notes.map((item) => item.hit.time))) : null;
	const laneId = created?.laneId ?? target;
	const assigned = assignNotesCommands(project, result, hitIds, laneId);
	if (!assigned.length) return false;
	if (!cx.execute([...(created?.commands ?? []), ...assigned])) return false;
	cx.$selection.set(hitIds.map((id) => toHitKey(laneId, id)));
	const removed = assigned.flatMap((command) => (command.type === 'removeEntities' ? command.entityIds : []));
	const moved = assigned.filter((command) => command.type === 'upsertEntity' && command.entity.components.hitLink?.laneId === laneId).length;
	const name = (id: string): string => project.entities.find((entity) => entity.id === id)?.name ?? 'Platform';
	const owner = project.music.lanes.find((lane) => lane.id === laneId)?.name ?? 'the new marble';
	if (removed.length === 1) cx.notify(`${name(removed[0] ?? '')} removed: Backing needs no platform`);
	else if (removed.length > 1) cx.notify(`${removed.length} platforms removed: Backing needs no platform`);
	else if (moved === 1) cx.notify(`Its platform now plays in ${owner}'s run`);
	else if (moved > 1) cx.notify(`${moved} platforms now play in ${owner}'s run`);
	return true;
}

/** Context menu entries that hand the selected notes over: each marble with its number key, New Marble, Backing */
export function playWithMenu(cx: StudioCx, keys: string[]): TMenuEntry[] {
	const project = cx.project;
	if (project == null) return [];
	const owners = new Set(selectedNotes(project, keys).map((item) => item.ownerId));
	const only = owners.size === 1 ? [...owners][0] : undefined;
	return [
		{ section: 'Play With' },
		...project.music.lanes.map((lane, index) => ({
			label: lane.name,
			shortcut: index < 9 ? String(index + 1) : undefined,
			checked: only === lane.id,
			onSelect: () => void handNotes(cx, keys, lane.id)
		})),
		{ label: 'New Marble', onSelect: () => void handNotes(cx, keys, 'new') },
		{ label: 'Backing', shortcut: '0', checked: only === BACKING_ID, onSelect: () => void handNotes(cx, keys, BACKING_ID) }
	];
}

/** The owner a number key picks: 1 to 9 the marbles in track order, 0 Backing */
export function ownerForKey(project: TProject, key: string): string | null {
	if (key === '0') return BACKING_ID;
	const index = Number(key) - 1;
	if (!Number.isInteger(index) || index < 0 || index > 8) return null;
	return project.music.lanes[index]?.id ?? null;
}

/** The notes of selection keys with the lane or Backing that holds them */
export function selectedNotes(project: TProject, keys: string[]): TOwnedNote[] {
	const wanted = new Set(keys);
	const owners = [...project.music.lanes, { id: BACKING_ID, hits: project.music.backing }];
	return owners.flatMap((owner) => owner.hits.filter((hit) => wanted.has(toHitKey(owner.id, hit.id))).map((hit) => ({ ownerId: owner.id, hit })));
}

export interface TOwnedNote {
	ownerId: string;
	hit: THit;
}

/** Whether every key of a non-empty selection is a hit key */
export function isNoteSelection(keys: string[]): boolean {
	return keys.length > 0 && keys.every((key) => parseHitKey(key) != null);
}

/** Plays a note as feedback, with its marble's instrument or Backing's */
export function auditionNote(cx: StudioCx, ownerId: string, pitch?: number): void {
	const project = cx.project;
	if (project == null) return;
	if (ownerId !== BACKING_ID) {
		cx.audition(ownerId, pitch);
		return;
	}
	if (project.music.sources.some((source) => source.kind === 'audio')) return;
	const instrument = project.music.backingInstrument ?? DEFAULT_BACKING_INSTRUMENT;
	void cx.audio.audition({ id: BACKING_ID, name: 'Backing', color: BACKING_COLOR, instrument, hits: [] }, pitch);
}

/** Backing notes are grey: heard, but no marble plays them */
export const BACKING_COLOR = '#8e8e93';
