import type { TMenuEntry } from '@/components';
import { canMakeBacking, assignNotesCommands, newMarbleCommands } from '@/modules/building';
import { BACKING_COLOR, DEFAULT_BACKING_INSTRUMENT } from '@/modules/music';
import { BACKING_ID, createMarble, type THit, type TProject, type TProjectCommand, parseHitKey, toHitKey, tieOf, backingOf, backingSong } from '@/modules/project';
import type { TSimulationResult } from '@/modules/simulation';
import type { StudioCx } from '@/modules/studio';

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
	const marbleId = created?.marbleId ?? target;
	const assigned = assignNotesCommands(project, result, hitIds, marbleId);
	if (!assigned.length) return false;
	if (!cx.execute([...(created?.commands ?? []), ...assigned])) return false;
	cx.$selection.set(hitIds.map((id) => toHitKey(marbleId, id)));
	const removed = assigned.flatMap((command) => (command.type === 'removePieces' ? command.pieceIds : []));
	const moved = assigned.filter((command) => command.type === 'addPiece' && tieOf(command.piece)?.marbleId === marbleId).length;
	const name = (id: string): string => project.track.pieces.find((piece) => piece.id === id)?.name ?? 'Platform';
	const owner = project.marbles.find((marble) => marble.id === marbleId)?.name ?? 'the new marble';
	// Each notice offers Undo; when the edit breaks later hits, Track adds Fix to it once the run is simulated
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
	return [...(onMarbles.length ? assignNotesCommands(project, result, onMarbles, BACKING_ID) : []), { type: 'removeHits', marbleId: BACKING_ID, hitIds }];
}

/** Context menu entries that hand the selected notes over: each marble with its number key, New Marble, Backing */
export function playedByMenu(cx: StudioCx, keys: string[]): TMenuEntry[] {
	const project = cx.project;
	if (project == null) return [];
	const owners = new Set(selectedNotes(project, keys).map((item) => item.ownerId));
	const only = owners.size === 1 ? [...owners][0] : undefined;
	return [
		{ section: 'Played By' },
		...project.marbles.map((marble, index) => ({
			label: marble.name,
			shortcut: index < 9 ? String(index + 1) : undefined,
			checked: only === marble.id,
			onSelect: () => void handNotes(cx, keys, marble.id)
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
	return project.marbles[index]?.id ?? null;
}

/** The notes of selection keys with the marble or Backing that holds them */
export function selectedNotes(project: TProject, keys: string[]): TOwnedNote[] {
	const wanted = new Set(keys);
	const owners = [...project.marbles, { id: BACKING_ID, hits: backingOf(project) }];
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

/** Plays a note as feedback, with its marble's Sound; a hit without a pitch plays nothing */
export function auditionNote(cx: StudioCx, ownerId: string, pitch?: number): void {
	const project = cx.project;
	if (project == null) return;
	if (ownerId !== BACKING_ID) {
		cx.audition(ownerId, pitch);
		return;
	}
	if (pitch == null) return;
	const instrument = backingSong(project)?.backingSound ?? DEFAULT_BACKING_INSTRUMENT;
	void cx.audio.audition({ ...createMarble(0, { x: 0, y: 0 }, BACKING_ID), name: 'Backing', labelColor: BACKING_COLOR, sound: instrument }, pitch);
}

export { BACKING_COLOR };
