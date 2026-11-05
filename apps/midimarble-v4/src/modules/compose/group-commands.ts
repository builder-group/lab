import { createId, isPatternGroup, type TEntity, type TGroup, type TLane, type TPlainGroup, type TProject, type TProjectCommand } from '@/modules/project';
import { startRailOf, patternLockWords, patternOfPiece } from '@/modules/simulation';
import { parseGroupKey } from '@/modules/studio/selection';
import type { StudioCx } from '@/modules/studio/StudioCx';
import { groupSelection } from './PatternsCx';

/** The selected pieces a Group can hold */
function selectedPieces(project: TProject, selection: readonly string[]): TEntity[] {
	return project.entities.filter((entity) => entity.components.piece != null && selection.includes(entity.id));
}

/** The marble a piece is tied to: the note it plays or the Rail it starts on */
function laneOfPiece(project: TProject, piece: TEntity): string | null {
	return piece.components.hitLink?.laneId ?? project.music.lanes.find((lane) => startRailOf(project, lane.id)?.id === piece.id)?.id ?? null;
}

/** "Group", then "Group 2" */
export function nextPlainGroupName(groups: readonly TGroup[], label = 'Group'): string {
	const names = new Set(groups.map((group) => group.name));
	if (!names.has(label)) return label;
	for (let index = 2; ; index++) if (!names.has(`${label} ${index}`)) return `${label} ${index}`;
}

/** A new plain Group of these pieces, which leave any plain Group they were in */
export function groupCommands(project: TProject, pieces: readonly TEntity[], id: string): { commands: TProjectCommand[]; group: TPlainGroup } {
	const ids = new Set(pieces.map((piece) => piece.id));
	const lanes = new Set(pieces.map((piece) => laneOfPiece(project, piece)));
	const [laneId] = lanes;
	const emptied: string[] = [];
	const shrunk: TProjectCommand[] = [];
	for (const group of project.groups ?? []) {
		const kept = group.pieceIds.filter((pieceId) => !ids.has(pieceId));
		if (kept.length === group.pieceIds.length) continue;
		if (kept.length > 0) shrunk.push({ type: 'upsertGroup', group: { ...group, pieceIds: kept } });
		else emptied.push(group.id);
	}
	const group: TPlainGroup = { id, name: nextPlainGroupName((project.groups ?? []).filter((item) => !emptied.includes(item.id))), ...(lanes.size === 1 && laneId != null ? { laneId } : {}), pieceIds: pieces.map((piece) => piece.id) };
	return { commands: [...(emptied.length > 0 ? [{ type: 'removeGroups' as const, groupIds: emptied }] : []), ...shrunk, { type: 'upsertGroup', group }], group };
}

/** The Groups a selection touches: selected themselves or through one of their pieces */
function selectedGroups(project: TProject, selection: readonly string[]): TGroup[] {
	const keys = new Set(selection.flatMap((key) => parseGroupKey(key) ?? []));
	return (project.groups ?? []).filter((group) => keys.has(group.id) || group.pieceIds.some((id) => selection.includes(id)));
}

export function canGroup(cx: StudioCx): boolean {
	const project = cx.project;
	return project != null && selectedPieces(project, cx.$selection.get()).length > 0;
}

export function canUngroup(cx: StudioCx): boolean {
	const project = cx.project;
	return project != null && selectedGroups(project, cx.$selection.get()).length > 0;
}

/** ⌘G, like Figma's: one Undo step, and the Group is what's selected. A live Pattern's pieces stay its own */
export function groupSelected(cx: StudioCx): void {
	const project = cx.project;
	if (project == null) return;
	const pieces = selectedPieces(project, cx.$selection.get());
	const live = pieces.flatMap((piece) => patternOfPiece(project, piece.id) ?? [])[0];
	if (live != null) {
		cx.notify(patternLockWords(live));
		return;
	}
	if (!pieces.length) return;
	const { commands, group } = groupCommands(project, pieces, createId('group'));
	if (cx.execute(commands)) cx.$selection.set(groupSelection(group));
}

/** ⇧⌘G, like Figma's: the pieces stay, selected. A Pattern is Flatten's to take apart */
export function ungroupSelected(cx: StudioCx): void {
	const project = cx.project;
	if (project == null) return;
	const groups = selectedGroups(project, cx.$selection.get());
	const live = groups.find(isPatternGroup);
	if (live != null) {
		cx.notify(patternLockWords(live));
		return;
	}
	if (!groups.length) return;
	if (cx.execute([{ type: 'removeGroups', groupIds: groups.map((group) => group.id) }])) cx.$selection.set(groups.flatMap((group) => group.pieceIds));
}

/** The span a plain Group's block fills on its marble's row, from the notes its pieces play. Null without any */
export function plainGroupSpan(project: TProject, lane: TLane, group: TPlainGroup): { from: number; to: number } | null {
	const hitIds = new Set(project.entities.filter((entity) => group.pieceIds.includes(entity.id) && entity.components.hitLink?.laneId === lane.id).map((entity) => entity.components.hitLink?.hitId));
	const times = lane.hits.filter((hit) => hitIds.has(hit.id)).map((hit) => hit.time);
	return times.length > 0 ? { from: Math.min(...times), to: Math.max(...times) } : null;
}
