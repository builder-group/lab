import { tidyMenu, type TMenuEntry } from '@/components';
import { canUngroup, selectedPattern } from '@/modules/compose/group-commands';
import { canFollow, canPlayNote, detachSelection, followItems, hasTiedSelection } from '@/modules/compose/tie-commands';
import { createId, laneColors, type TEntity, type TLane, type TProjectCommand } from '@/modules/project';
import { commandItem, getCommand, runInWorkspace } from './commands';
import { formatTime } from './format';
import { toHitKey } from './selection';
import { addSuggestedHits, suggestedHits, suggestedHitsLabel } from './suggested-hits';
import type { StudioCx } from './StudioCx';
import { deleteHits, playedByMenu } from './timeline/hand-notes';

// Context menus list the same commands as the palette and the shortcuts, so each shows its key

const LABEL_NAMES = ['Blue', 'Orange', 'Green', 'Purple', 'Pink', 'Cyan'];

/**
 * The choices of a layer's Label Color, opened from its icon or dot and from Label Color beside Rename: it organizes
 * Layers, the timeline and Track, like Blender's collection color tags and Logic's track colors; a film shows it only on the skin None.
 * `commandsFor(null)` takes the label away, where a layer can do without.
 */
export function labelColorEntries(cx: StudioCx, current: string | undefined, commandsFor: (color: string | null) => TProjectCommand[], canClear = true): TMenuEntry[] {
	return [
		...(canClear ? [{ label: 'None', checked: current == null, onSelect: () => cx.execute(commandsFor(null)) }] : []),
		...laneColors.map((color, index) => ({ label: LABEL_NAMES[index] ?? color, swatch: color, checked: current === color, onSelect: () => cx.execute(commandsFor(color)) }))
	];
}

/** Label Color for a menu, beside Rename */
export function labelColorItem(entries: TMenuEntry[]): TMenuEntry {
	return { label: 'Label Color', onSelect: () => undefined, submenu: entries };
}

/** A marble's label is its lane's color, which it always has */
export function laneLabelEntries(cx: StudioCx, lane: TLane): TMenuEntry[] {
	return labelColorEntries(cx, lane.color, (color) => (color != null ? [{ type: 'upsertLane', lane: { ...lane, color } }] : []), false);
}

/** The entity's Label Color, and with it the rest of the selection when it is part of one, as one edit */
export function entityLabelEntries(cx: StudioCx, entity: TEntity): TMenuEntry[] {
	const selection = cx.$selection.get();
	const targets = selection.includes(entity.id) ? (cx.project?.entities.filter((item) => selection.includes(item.id)) ?? [entity]) : [entity];
	return labelColorEntries(cx, entity.labelColor, (color) =>
		targets.map((target): TProjectCommand => {
			const { labelColor: _labelColor, ...rest } = target;
			return { type: 'upsertEntity', entity: color != null ? { ...rest, labelColor: color } : rest };
		})
	);
}

/** Label Color for the selected entities' menu */
function selectionLabelItem(cx: StudioCx): TMenuEntry | null {
	const first = cx.project?.entities.find((entity) => cx.$selection.get().includes(entity.id));
	return first != null ? labelColorItem(entityLabelEntries(cx, first)) : null;
}

/** Right-click on a piece, on the canvas or in the sidebar */
export function pieceMenu(cx: StudioCx): TMenuEntry[] {
	// Film shows what works there: Compose's edits ask for the wall
	if (cx.$workspace.get() !== 'compose') return tidyMenu([commandItem(cx, 'edit.group'), canUngroup(cx) ? commandItem(cx, 'edit.ungroup') : null, 'separator', commandItem(cx, 'edit.rename'), selectionLabelItem(cx), 'separator', ...pieceLinkItems(cx)]);
	const selected = cx.project?.entities.filter((entity) => cx.$selection.get().includes(entity.id)) ?? [];
	return tidyMenu([
		selected.length === 1 && selected[0]?.components.hitLink != null ? commandItem(cx, 'build.fix') : null,
		selected.some((entity) => entity.components.hitLink != null) ? commandItem(cx, 'build.rebuildFrom') : null,
		'separator',
		commandItem(cx, 'view.fitSelection'),
		'separator',
		commandItem(cx, 'edit.duplicate'),
		commandItem(cx, 'edit.group'),
		canUngroup(cx) ? commandItem(cx, 'edit.ungroup') : null,
		selectedPattern(cx) != null ? commandItem(cx, 'edit.flatten') : null,
		commandItem(cx, 'edit.rename'),
		selectionLabelItem(cx),
		'separator',
		...pieceLinkItems(cx),
		'separator',
		commandItem(cx, 'edit.delete')
	]);
}

/**
 * The piece's link: Play a Note… and Follow a Marble…, or Detach. Linking is Compose's work, so from Film's Layers
 * Play a Note… opens Compose first.
 */
function pieceLinkItems(cx: StudioCx): TMenuEntry[] {
	const follow = followItems(cx);
	return [
		{ label: 'Play a Note…', disabled: !canPlayNote(cx), onSelect: () => runInWorkspace(cx, getCommand('piece.playNote')) },
		{ label: 'Follow a Marble…', disabled: !canFollow(cx), submenu: follow, onSelect: () => undefined },
		{ label: 'Detach', disabled: !hasTiedSelection(cx), onSelect: () => detachSelection(cx) }
	];
}

/** Right-click on a hit in the timeline */
export function hitMenu(cx: StudioCx, lane: TLane, hitId: string): TMenuEntry[] {
	const project = cx.project;
	const hit = lane.hits.find((item) => item.id === hitId);
	if (project == null || hit == null) return [];
	const piece = project.entities.find((entity) => entity.components.piece != null && entity.components.hitLink?.laneId === lane.id && entity.components.hitLink.hitId === hitId);
	const selected = cx.$selection.get();
	const key = toHitKey(lane.id, hitId);
	const moving = selected.includes(key) ? selected : [key];

	return tidyMenu([
		{ section: `${lane.name} · Hit ${lane.hits.indexOf(hit) + 1} · ${formatTime(hit.time)}` },
		{ label: 'Go to Hit', onSelect: () => cx.$playhead.set(hit.time) },
		{
			label: 'Play from Hit',
			onSelect: () => {
				cx.$playhead.set(hit.time);
				cx.$playing.set(true);
			}
		},
		piece != null ? { label: `Select ${piece.name ?? 'Piece'}`, onSelect: () => cx.reveal([piece.id]) } : null,
		{ label: 'Rebuild From Here', disabled: cx.$compose.get() == null || cx.$compose.get()?.assist.isBuilding === true, onSelect: () => void cx.$compose.get()?.assist.buildTrack({ laneId: lane.id, hitId }) },
		'separator',
		...playedByMenu(cx, moving),
		'separator',
		{ label: 'Delete Hit', onSelect: () => void deleteHits(cx, moving) }
	]);
}

/** Right-click on a lane row or its header; `time` is where an added hit goes */
export function laneMenu(cx: StudioCx, lane: TLane, time?: number): TMenuEntry[] {
	const project = cx.project;
	if (project == null) return [];
	const marble = project.entities.find((entity) => entity.components.marble?.laneId === lane.id);
	const suggested = suggestedHits(cx, lane).length;

	return tidyMenu([
		{ section: lane.name },
		time != null ? { label: `Add Hit at ${formatTime(time)}`, onSelect: () => addHit(cx, lane, time) } : null,
		{ label: 'Select All Hits', disabled: !lane.hits.length, onSelect: () => cx.$selection.set(lane.hits.map((hit) => toHitKey(lane.id, hit.id))) },
		suggested > 0 ? { label: suggestedHitsLabel(suggested), onSelect: () => addSuggestedHits(cx, lane) } : null,
		'separator',
		marble != null
			? {
					label: 'Rename…',
					onSelect: () => {
						cx.$selection.set([marble.id]);
						cx.renameSelection();
					}
				}
			: null,
		labelColorItem(laneLabelEntries(cx, lane)),
		cx.$workspace.get() === 'compose' ? commandItem(cx, 'marble.add') : null,
		{ label: 'Delete Marble', disabled: project.music.lanes.length <= 1, onSelect: () => cx.execute([{ type: 'removeLane', laneId: lane.id }]) }
	]);
}

export function addHit(cx: StudioCx, lane: TLane, time: number): void {
	// A hit has a pitch only when it comes from a MIDI note; one placed by hand is timing alone
	const hit = { id: createId('hit'), time: Math.round(time * 10000) / 10000 };
	if (cx.execute([{ type: 'upsertHits', laneId: lane.id, hits: [hit] }])) cx.$selection.set([toHitKey(lane.id, hit.id)]);
}

/** The Song layer's menu, in Layers and on its timeline row */
export function songMenu(cx: StudioCx): TMenuEntry[] {
	return [{ section: 'Song' }, commandItem(cx, 'file.replaceSong'), commandItem(cx, 'file.removeSong')];
}
