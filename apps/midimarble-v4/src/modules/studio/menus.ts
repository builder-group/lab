import { tidyMenu, type TMenuEntry } from '@/components';
import { canUngroup, selectedPattern, canFollow, canPlayNote, detachSelection, followItems, hasTiedSelection, deleteHits, playedByMenu } from '@/modules/track';
import { createId, marbleColors, type TPiece, type TMarble, type TProject, type TProjectCommand, type TTitle, formatTime, parseDecorKey, toHitKey, tieOf } from '@/modules/project';
import { selectedDecorIds, updateDecorCommands } from '@/modules/scene';
import { moveDecorClearAction } from '@/modules/film';
import { commandItem, getCommand, isCommandEnabled, type TCommandId } from './commands';
import { addSuggestedHits, suggestedHits, suggestedHitsLabel } from './suggested-hits';
import type { StudioCx } from './StudioCx';

// Context menus list the same commands as the palette and the shortcuts, so each shows its key

const LABEL_NAMES = ['Blue', 'Orange', 'Green', 'Purple', 'Pink', 'Cyan', 'Red'];
/** What the list offers: every marble's color, and the red the examples' Melody wears, which new marbles don't start with */
const LABEL_COLORS = [...marbleColors, '#c8102e'];

/**
 * The choices of a layer's Label Color, opened from its icon or dot and from Label Color beside Rename: it organizes
 * Layers, the timeline and Track, like Blender's collection color tags and Logic's track colors; a film shows it only on the skin None.
 * `commandsFor(null)` takes the label away, where a layer can do without.
 */
export function labelColorEntries(cx: StudioCx, current: string | undefined, commandsFor: (color: string | null) => TProjectCommand[], canClear = true): TMenuEntry[] {
	return [
		...(canClear ? [{ label: 'None', checked: current == null, onSelect: () => cx.execute(commandsFor(null)) }] : []),
		...LABEL_COLORS.map((color, index) => ({ label: LABEL_NAMES[index] ?? color, swatch: color, checked: current === color, onSelect: () => cx.execute(commandsFor(color)) })),
		// A color from a file or an agent, so the list always marks what the layer wears
		...(current != null && !LABEL_COLORS.includes(current) ? [{ label: 'Current', swatch: current, checked: true, onSelect: () => undefined }] : [])
	];
}

/** Label Color for a menu, beside Rename */
export function labelColorItem(entries: TMenuEntry[]): TMenuEntry {
	return { label: 'Label Color', onSelect: () => undefined, submenu: entries };
}

/** A marble always has a label color */
export function marbleLabelEntries(cx: StudioCx, marble: TMarble): TMenuEntry[] {
	return labelColorEntries(cx, marble.labelColor, (color) => (color != null ? [{ type: 'updateMarble', marbleId: marble.id, patch: { labelColor: color } }] : []), false);
}

/** The piece's or title's Label Color, and with it the rest of the selected pieces and titles when it is part of the selection, as one edit */
export function entityLabelEntries(cx: StudioCx, entity: TPiece | TTitle): TMenuEntry[] {
	const selection = cx.$selection.get();
	const ids = selection.includes(entity.id) ? selection : [entity.id];
	return labelColorEntries(cx, entity.labelColor, (color) => (cx.project != null ? labelColorCommands(cx.project, ids, color) : []));
}

function labelColorCommands(project: TProject, ids: readonly string[], color: string | null): TProjectCommand[] {
	const pieces = project.track.pieces.filter((piece) => ids.includes(piece.id));
	const commands = pieces.map((piece): TProjectCommand => ({ type: 'updatePiece', pieceId: piece.id, patch: { labelColor: color } }));
	if (!project.film.titles.some((title) => ids.includes(title.id))) return commands;
	const titles = project.film.titles.map((title) => {
		if (!ids.includes(title.id)) return title;
		const { labelColor: _labelColor, ...rest } = title;
		return color != null ? { ...rest, labelColor: color } : rest;
	});
	return [...commands, { type: 'updateFilm', film: { titles } }];
}

/** Label Color for the selected pieces' and titles' menu */
function selectionLabelItem(cx: StudioCx): TMenuEntry | null {
	const selection = cx.$selection.get();
	const first = cx.project?.track.pieces.find((entity) => selection.includes(entity.id)) ?? cx.project?.film.titles.find((title) => selection.includes(title.id));
	return first != null ? labelColorItem(entityLabelEntries(cx, first)) : null;
}

/** Right-click on a piece, on the canvas or in the sidebar */
export function pieceMenu(cx: StudioCx): TMenuEntry[] {
	// Film shows what works there: Track's edits ask for the wall
	if (cx.$workspace.get() !== 'track') return tidyMenu([canUngroup(cx) ? commandItem(cx, 'edit.ungroup') : null, 'separator', commandItem(cx, 'edit.rename'), selectionLabelItem(cx)]);
	const selection = cx.$selection.get();
	const selected = cx.project?.track.pieces.filter((entity) => selection.includes(entity.id)) ?? [];
	const isOnlyPiece = selected.length === 1 && ![...(cx.project?.marbles ?? []), ...(cx.project?.film.titles ?? [])].some((layer) => selection.includes(layer.id));
	return tidyMenu([
		isOnlyPiece && tieOf(selected[0]) != null ? commandItem(cx, 'build.fix') : null,
		selected.some((entity) => tieOf(entity) != null) ? commandItem(cx, 'build.rebuildFrom') : null,
		'separator',
		commandItem(cx, 'view.fitSelection'),
		'separator',
		commandItem(cx, 'edit.copy'),
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

/** The piece's link: Play a Note… and Follow a Marble…, or Detach. Linking is Track's work */
function pieceLinkItems(cx: StudioCx): TMenuEntry[] {
	const follow = followItems(cx);
	return [
		{ label: 'Play a Note…', disabled: !canPlayNote(cx), onSelect: () => getCommand('piece.playNote').run(cx) },
		{ label: 'Follow a Marble…', disabled: !canFollow(cx), submenu: follow, onSelect: () => undefined },
		{ label: 'Detach', disabled: !hasTiedSelection(cx), onSelect: () => detachSelection(cx) }
	];
}

/** Right-click on a title, in Layers or Film's preview */
export function titleMenu(cx: StudioCx, title: TTitle): TMenuEntry[] {
	return [commandItem(cx, 'edit.copy'), commandItem(cx, 'edit.rename'), labelColorItem(entityLabelEntries(cx, title)), 'separator', commandItem(cx, 'edit.delete')];
}

/** The Label Color of the selected decorations */
export function decorLabelEntries(cx: StudioCx, ids: readonly string[]): TMenuEntry[] {
	const project = cx.project;
	const current = project == null ? undefined : project.film.decor.find((item) => ids.includes(item.id))?.labelColor;
	return labelColorEntries(cx, current, (color) => (project != null ? updateDecorCommands(project, ids, { labelColor: color ?? undefined }) : []));
}

/** Right-click on the selected decorations, in Layers or Film's preview */
export function decorMenu(cx: StudioCx, overlaps: boolean): TMenuEntry[] {
	const ids = selectedDecorIds(cx.$selection.get());
	return [
		...(overlaps && ids.length === 1 ? [{ label: 'Move Clear', onSelect: () => moveDecorClearAction(cx, ids[0] as string) }, 'separator' as const] : []),
		commandItem(cx, 'edit.copy'),
		commandItem(cx, 'edit.duplicate'),
		labelColorItem(decorLabelEntries(cx, ids)),
		'separator',
		commandItem(cx, 'decor.scatter'),
		'separator',
		commandItem(cx, 'edit.delete')
	];
}

/** The menu of what a right-click found in Film's preview, which it has selected; null for empty space */
export function filmObjectMenu(cx: StudioCx, id: string): TMenuEntry[] | null {
	if (parseDecorKey(id) != null) return decorMenu(cx, false);
	const title = cx.project?.film.titles.find((item) => item.id === id);
	if (title != null) return titleMenu(cx, title);
	return cx.project?.track.pieces.some((item) => item.id === id) === true ? pieceMenu(cx) : null;
}

/** Right-click on empty space in Film's preview: what works here, as Track's canvas lists its assists */
export function filmMenu(cx: StudioCx): TMenuEntry[] {
	const working = (id: TCommandId): TMenuEntry | null => (isCommandEnabled(cx, getCommand(id)) ? commandItem(cx, id) : null);
	return tidyMenu([working('edit.paste'), 'separator', working('decor.add'), working('film.addText'), working('light.add'), working('camera.addShot'), 'separator', working('decor.scatter'), working('film.editInBlender'), 'separator', working('file.export')]);
}

/** Right-click on a hit in the timeline */
export function hitMenu(cx: StudioCx, marble: TMarble, hitId: string): TMenuEntry[] {
	const project = cx.project;
	const hit = marble.hits.find((item) => item.id === hitId);
	if (project == null || hit == null) return [];
	const piece = project.track.pieces.find((entity) => tieOf(entity)?.marbleId === marble.id && tieOf(entity)?.hitId === hitId);
	const selected = cx.$selection.get();
	const key = toHitKey(marble.id, hitId);
	const moving = selected.includes(key) ? selected : [key];

	return tidyMenu([
		{ section: `${marble.name} · Hit ${marble.hits.indexOf(hit) + 1} · ${formatTime(hit.time)}` },
		{ label: 'Go to Hit', onSelect: () => cx.$playhead.set(hit.time) },
		{
			label: 'Play from Hit',
			onSelect: () => {
				cx.$playhead.set(hit.time);
				cx.$playing.set(true);
			}
		},
		piece != null ? { label: `Select ${piece.name ?? 'Piece'}`, onSelect: () => cx.reveal([piece.id]) } : null,
		{ label: 'Rebuild From Here', disabled: cx.$trackCx.get() == null || cx.assist.isBuilding === true, onSelect: () => void cx.assist.buildTrack({ marbleId: marble.id, hitId }) },
		'separator',
		...playedByMenu(cx, moving),
		'separator',
		{ label: 'Delete Hit', onSelect: () => void deleteHits(cx, moving) }
	]);
}

/** Right-click on a marble row or its header; `time` is where an added hit goes */
export function marbleMenu(cx: StudioCx, marble: TMarble, time?: number): TMenuEntry[] {
	const project = cx.project;
	if (project == null) return [];
	const suggested = suggestedHits(cx, marble).length;

	return tidyMenu([
		{ section: marble.name },
		time != null ? { label: `Add Hit at ${formatTime(time)}`, onSelect: () => addHit(cx, marble, time) } : null,
		{ label: 'Select All Hits', disabled: !marble.hits.length, onSelect: () => cx.$selection.set(marble.hits.map((hit) => toHitKey(marble.id, hit.id))) },
		suggested > 0 ? { label: suggestedHitsLabel(suggested), onSelect: () => addSuggestedHits(cx, marble) } : null,
		'separator',
		{
			label: 'Rename…',
			onSelect: () => {
				cx.$selection.set([marble.id]);
				cx.renameSelection();
			}
		},
		labelColorItem(marbleLabelEntries(cx, marble)),
		cx.$workspace.get() === 'track' ? commandItem(cx, 'marble.add') : null,
		{ label: 'Delete Marble', disabled: project.marbles.length <= 1, onSelect: () => cx.execute([{ type: 'removeMarble', marbleId: marble.id }]) }
	]);
}

export function addHit(cx: StudioCx, marble: TMarble, time: number): void {
	// A hit has a pitch only when it comes from a MIDI note; one placed by hand is timing alone
	const hit = { id: createId('hit'), time: Math.round(time * 10000) / 10000 };
	if (cx.execute([{ type: 'upsertHits', marbleId: marble.id, hits: [hit] }])) cx.$selection.set([toHitKey(marble.id, hit.id)]);
}

/** The Song layer's menu, in Layers and on its timeline row */
export function songMenu(cx: StudioCx): TMenuEntry[] {
	return [{ section: 'Song' }, commandItem(cx, 'file.replaceSong'), commandItem(cx, 'file.removeSong')];
}
