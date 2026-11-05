import { createId, isPatternGroup, type TEntity, type TGroup, type TLane, type TPatternGroup, type TPlainGroup, type TProject, type TProjectCommand, parseGroupKey } from '@/modules/project';
import { startRailOf, type THitResult } from '@/modules/simulation';
import { patternLockWords, patternOfPiece } from '@/modules/building';
import type { StudioCx } from '@/modules/studio';
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

/** The live Pattern the selection stands for, which Flatten turns into plain pieces */
export function selectedPattern(cx: StudioCx): TPatternGroup | null {
	const selection = cx.$selection.get();
	return cx.project?.groups?.filter(isPatternGroup).find((group) => selection.some((key) => parseGroupKey(key) === group.id || group.pieceIds.includes(key))) ?? null;
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
	if (cx.execute(commands, { label: 'Group' })) cx.$selection.set(groupSelection(group));
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

/** Share of the turns in a run of bars that go back the way they came, from which it reads as a Zigzag */
const ZIGZAG_TURNS = 0.7;

/** "Zigzag" when the run's dots go back and forth across the wall, else a neutral "Run" */
function runName(dots: readonly number[]): string {
	const steps = dots.slice(1).map((x, index) => x - (dots[index] ?? x));
	const turns = steps.slice(1).filter((step, index) => step * (steps[index] ?? 0) < 0).length;
	return steps.length > 1 && turns / (steps.length - 1) >= ZIGZAG_TURNS ? 'Zigzag' : 'Run';
}

/**
 * Plain Groups for what a build just placed, so its runs show on the strip: pieces in a row of one kind on a marble's
 * notes, a Rail's or a run of bars. Pieces already in a Group stay there; a lone bar or a Bowl stays a piece.
 */
export function builtRunCommands(before: TProject, after: TProject, hits: readonly THitResult[]): TProjectCommand[] {
	const existing = new Set(before.entities.map((entity) => entity.id));
	const grouped = new Set((after.groups ?? []).flatMap((group) => group.pieceIds));
	const groups: TGroup[] = [...(after.groups ?? [])];
	const commands: TProjectCommand[] = [];
	const dotOf = new Map(hits.flatMap((hit) => (hit.pieceEntityId != null && hit.dot != null ? [[hit.pieceEntityId, hit.dot.x] as const] : [])));
	for (const lane of after.music.lanes) {
		const order = new Map(lane.hits.map((hit, index) => [hit.id, index]));
		const pieces = after.entities
			.filter((entity) => entity.components.piece != null && entity.components.hitLink?.laneId === lane.id)
			.sort((a, b) => (order.get(a.components.hitLink?.hitId ?? '') ?? 0) - (order.get(b.components.hitLink?.hitId ?? '') ?? 0));
		const close = (run: readonly TEntity[], type: string | undefined): void => {
			if (type === 'rail' ? !run.length : type !== 'platform' || run.length < 2) return;
			const name = nextPlainGroupName(groups, type === 'rail' ? 'Rail' : runName(run.flatMap((piece) => dotOf.get(piece.id) ?? [])));
			const group: TPlainGroup = { id: createId('group'), name, laneId: lane.id, pieceIds: run.map((piece) => piece.id) };
			groups.push(group);
			commands.push({ type: 'upsertGroup', group });
		};
		let run: TEntity[] = [];
		let runType: string | undefined;
		for (const piece of pieces) {
			const type = piece.components.piece?.type;
			if (type !== runType || existing.has(piece.id) || grouped.has(piece.id)) {
				close(run, runType);
				run = [];
				runType = type;
			}
			if (!existing.has(piece.id) && !grouped.has(piece.id)) run.push(piece);
		}
		close(run, runType);
	}
	return commands;
}
