import type { TMenuEntry } from '@/components';
import { canMakeBacking } from '@/modules/compose/reachability';
import { assignNotesCommands, BACKING_COLOR, DEFAULT_BACKING_INSTRUMENT, newMarbleCommands, soundsNotes } from '@/modules/music';
import { BACKING_ID, type TEntity, type THit, type TProject, type TProjectCommand } from '@/modules/project';
import { soundsHit, type TSimulationResult } from '@/modules/simulation';
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
	// Backing notes live in the Song track; without a song they could not be seen or selected again
	if (target === BACKING_ID && !canMakeBacking(project)) {
		cx.notify('Backing needs a song. Delete the hits instead, or import a song first.');
		return false;
	}
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
	// Each notice offers Undo; when the edit breaks later hits, Compose adds Fix Hits to it once the run is simulated
	if (removed.length === 1) cx.notifyEdit(`${name(removed[0] ?? '')} removed: Backing needs no platform`);
	else if (removed.length > 1) cx.notifyEdit(`${removed.length} platforms removed: Backing needs no platform`);
	else if (moved === 1) cx.notifyEdit(`Its platform now plays in ${owner}'s run`);
	else if (moved > 1) cx.notifyEdit(`${moved} platforms now play in ${owner}'s run`);
	return true;
}

/**
 * ⌫ on selected hits removes them with their platforms, but never takes music first: a hit with a pitch becomes Backing
 * while the project has a song, so the note keeps sounding. Tapped hits and Backing notes go. In the piano roll, the
 * song's own editor, the note itself goes.
 */
export function removeSelectedHits(cx: StudioCx, keys: string[], isInRoll: boolean): boolean {
	const project = cx.project;
	if (project == null) return false;
	const notes = selectedNotes(project, keys);
	if (!notes.length) return false;
	if (isInRoll) return deleteHits(cx, keys);
	const sounding = canMakeBacking(project) ? notes.filter((item) => item.ownerId !== BACKING_ID && item.hit.pitch != null) : [];
	if (sounding.length === notes.length) return handNotes(cx, keys, BACKING_ID);
	return deleteHits(cx, keys, new Set(sounding.map((item) => item.hit.id)));
}

/** Delete Hit: the hit and its note go together with the platform that plays it, as one undo step; `keep` stays as Backing */
export function deleteHits(cx: StudioCx, keys: string[], keep?: ReadonlySet<string>): boolean {
	const project = cx.project;
	if (project == null) return false;
	const applied = cx.execute(deleteHitCommands(project, cx.simulation.$result.get(), keys, keep));
	if (applied) cx.$selection.set([]);
	return applied;
}

/**
 * Removes hits by way of Backing: the hand-over already takes the platform away and ties pieces following the marble
 * to the nearest hit left, so nothing stays behind tied to a hit that is gone. Notes in `keep` stop at Backing.
 */
export function deleteHitCommands(project: TProject, result: TSimulationResult | null, keys: string[], keep?: ReadonlySet<string>): TProjectCommand[] {
	const notes = selectedNotes(project, keys);
	const hitIds = notes.map((item) => item.hit.id).filter((id) => keep?.has(id) !== true);
	if (!notes.length) return [];
	const onMarbles = notes.filter((item) => item.ownerId !== BACKING_ID).map((item) => item.hit.id);
	return [...(onMarbles.length ? assignNotesCommands(project, result, onMarbles, BACKING_ID) : []), { type: 'removeHits', laneId: BACKING_ID, hitIds }];
}

/** The platforms that play the hits of selection keys */
export function platformsOfHits(project: TProject, keys: string[]): TEntity[] {
	const wanted = new Set(keys);
	return project.entities.filter((entity) => {
		const link = entity.components.hitLink;
		return link != null && entity.components.piece != null && soundsHit(entity.components.piece.type, link) && wanted.has(toHitKey(link.laneId, link.hitId));
	});
}

/** Context menu entries that hand the selected notes over: each marble with its number key, New Marble, Backing */
export function playedByMenu(cx: StudioCx, keys: string[]): TMenuEntry[] {
	const project = cx.project;
	if (project == null) return [];
	const owners = new Set(selectedNotes(project, keys).map((item) => item.ownerId));
	const only = owners.size === 1 ? [...owners][0] : undefined;
	return [
		{ section: 'Played By' },
		...project.music.lanes.map((lane, index) => ({
			label: lane.name,
			shortcut: index < 9 ? String(index + 1) : undefined,
			checked: only === lane.id,
			onSelect: () => void handNotes(cx, keys, lane.id)
		})),
		{ label: 'New Marble', onSelect: () => void handNotes(cx, keys, 'new') },
		{ label: 'Backing', shortcut: '0', checked: only === BACKING_ID, disabled: !canMakeBacking(project), onSelect: () => void handNotes(cx, keys, BACKING_ID) }
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

/** Plays a note as feedback, with its Part's Sound; a hit without a pitch plays nothing */
export function auditionNote(cx: StudioCx, ownerId: string, pitch?: number): void {
	const project = cx.project;
	if (project == null) return;
	if (ownerId !== BACKING_ID) {
		cx.audition(ownerId, pitch);
		return;
	}
	if (pitch == null || !soundsNotes(project)) return;
	const instrument = project.music.backingInstrument ?? DEFAULT_BACKING_INSTRUMENT;
	void cx.audio.audition({ id: BACKING_ID, name: 'Backing', color: BACKING_COLOR, instrument, hits: [] }, pitch);
}

export { BACKING_COLOR };
