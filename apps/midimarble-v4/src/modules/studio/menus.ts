import { tidyMenu, type TMenuEntry } from '@/components';
import { canUngroup, selectedPattern, canFollow, canPlayNote, detachSelection, followItems, hasTiedSelection, deleteHits, playedByMenu } from '@/modules/track';
import { createId, type TPiece, type TMarble, type TSong, type TProject, type TProjectCommand, type TTitle, formatTime, parseDecorKey, tiedToSong, tieLabel, toHitKey, tieOf } from '@/modules/project';
import { problemSummary } from '@/modules/building';
import { selectedDecorIds, updateDecorCommands } from '@/modules/scene';
import { moveDecorClearAction } from '@/modules/film';
import { choosePattern, commandItem, deleteMarble, getCommand, isCommandEnabled, type TCommandId } from './commands';
import { suggestedHitChoices } from './suggested-hits';
import type { StudioCx } from './StudioCx';

// Context menus list the same commands as the palette and the shortcuts, so each shows its key

/**
 * The hit summary's menu, like Xcode's issues and Blender's Info: every problem by name in time order, a click goes to
 * it and its detail is the tooltip; then Fix, and Fit to Song where the length no longer matches the song
 */
export function problemMenu(cx: StudioCx): TMenuEntry[] {
	const workspace = cx.$workspace.get();
	const { problems } = problemSummary(cx.simulation.$problems.get(), workspace);
	const fitToSong = getCommand('film.fitToSong');
	return tidyMenu([
		...problems.map((issue): TMenuEntry => {
			const time = issue.time ?? issue.span?.from ?? issue.target?.time;
			return {
				label: issue.title,
				title: issue.detail,
				disabled: issue.target == null,
				...(time != null ? { shortcut: formatTime(time) } : {}),
				onSelect: () => {
					if (issue.target != null) cx.revealIssue(issue.target);
				}
			};
		}),
		'separator',
		problems.length > 0 && workspace === 'track' ? { label: 'Fix', disabled: cx.assist.isFixing, onSelect: () => void cx.assist.fix() } : null,
		isCommandEnabled(cx, fitToSong) ? commandItem(cx, 'film.fitToSong') : null
	]);
}

/** A piece's or title's color, and with it the rest of the selected pieces and titles when it is part of the selection, as one edit */
export function layerLabelCommands(cx: StudioCx, layer: TPiece | TTitle, color: string | null): TProjectCommand[] {
	const selection = cx.$selection.get();
	const ids = selection.includes(layer.id) ? selection : [layer.id];
	return cx.project != null ? labelColorCommands(cx.project, ids, color) : [];
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

/** The color is chosen on a layer's icon; its menu takes it away again */
function clearLabelItem(cx: StudioCx, isSet: boolean, commands: () => TProjectCommand[]): TMenuEntry | null {
	return isSet ? { label: 'Clear Label Color', onSelect: () => cx.execute(commands()) } : null;
}

/** Clear Label Color for the selected pieces' and titles' menu */
function selectionLabelItem(cx: StudioCx): TMenuEntry | null {
	const selection = cx.$selection.get();
	const first = cx.project?.track.pieces.find((piece) => selection.includes(piece.id)) ?? cx.project?.film.titles.find((title) => selection.includes(title.id));
	return first != null ? clearLabelItem(cx, first.labelColor != null, () => layerLabelCommands(cx, first, null)) : null;
}

/** Right-click on a piece, on the canvas or in the sidebar */
export function pieceMenu(cx: StudioCx): TMenuEntry[] {
	// Film shows what works there: Track's edits ask for the wall
	if (cx.$workspace.get() !== 'track') return tidyMenu([canUngroup(cx) ? commandItem(cx, 'edit.ungroup') : null, 'separator', commandItem(cx, 'edit.rename'), selectionLabelItem(cx)]);
	const selection = cx.$selection.get();
	const selected = cx.project?.track.pieces.filter((piece) => selection.includes(piece.id)) ?? [];
	const isOnlyPiece = selected.length === 1 && ![...(cx.project?.marbles ?? []), ...(cx.project?.film.titles ?? [])].some((layer) => selection.includes(layer.id));
	return tidyMenu([
		isOnlyPiece && tieOf(selected[0]) != null ? commandItem(cx, 'build.fix') : null,
		selected.some((piece) => tieOf(piece) != null) ? commandItem(cx, 'build.rebuildFrom') : null,
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
	return tidyMenu([commandItem(cx, 'edit.copy'), commandItem(cx, 'edit.rename'), clearLabelItem(cx, title.labelColor != null, () => layerLabelCommands(cx, title, null)), 'separator', commandItem(cx, 'edit.delete')]);
}

/** The Label Color of the selected decorations */
export function decorLabelCommands(cx: StudioCx, ids: readonly string[], color: string | null): TProjectCommand[] {
	return cx.project != null ? updateDecorCommands(cx.project, ids, { labelColor: color ?? undefined }) : [];
}

/** Right-click on the selected decorations, in Layers or Film's preview */
export function decorMenu(cx: StudioCx, overlaps: boolean): TMenuEntry[] {
	const ids = selectedDecorIds(cx.$selection.get());
	return tidyMenu([
		...(overlaps && ids.length === 1 ? [{ label: 'Move Clear', onSelect: () => moveDecorClearAction(cx, ids[0] as string) }, 'separator' as const] : []),
		commandItem(cx, 'edit.copy'),
		commandItem(cx, 'edit.duplicate'),
		clearLabelItem(cx, cx.project?.film.decor.some((item) => ids.includes(item.id) && item.labelColor != null) === true, () => decorLabelCommands(cx, ids, null)),
		'separator',
		commandItem(cx, 'decor.scatter'),
		'separator',
		commandItem(cx, 'edit.delete')
	]);
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
	const piece = project.track.pieces.find((piece) => tieOf(piece)?.marbleId === marble.id && tieOf(piece)?.hitId === hitId);
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
		{ label: 'Pattern…', disabled: cx.$trackCx.get() == null, onSelect: () => choosePattern(cx, marble.id, hitId) },
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

	return tidyMenu([
		{ section: marble.name },
		time != null ? { label: `Add Hit at ${formatTime(time)}`, onSelect: () => addHit(cx, marble, time) } : null,
		{ label: 'Select All Hits', disabled: !marble.hits.length, onSelect: () => cx.$selection.set(marble.hits.map((hit) => toHitKey(marble.id, hit.id))) },
		...suggestedHitChoices(cx, marble),
		marble.hits.some((hit) => hit.songId != null) ? { label: tieLabel(null), onSelect: () => cx.execute([{ type: 'upsertHits', marbleId: marble.id, hits: tiedToSong(marble.hits, null) }], { label: tieLabel(null) }) } : null,
		'separator',
		{
			label: 'Rename…',
			onSelect: () => {
				cx.$selection.set([marble.id]);
				cx.renameSelection();
			}
		},
		cx.$workspace.get() === 'track' ? commandItem(cx, 'marble.add') : null,
		{ label: 'Delete Marble', disabled: project.marbles.length <= 1, onSelect: () => deleteMarble(cx, marble) }
	]);
}

export function addHit(cx: StudioCx, marble: TMarble, time: number, songId?: string): void {
	// A hit has a pitch only when it comes from a MIDI note; one placed by hand is timing alone. Added in a song, it is tied to it.
	const hit = { id: createId('hit'), time: Math.round(time * 10000) / 10000, ...(songId != null ? { songId } : {}) };
	if (cx.execute([{ type: 'upsertHits', marbleId: marble.id, hits: [hit] }])) cx.$selection.set([toHitKey(marble.id, hit.id)]);
}

/** A Song layer's menu, in Layers and on its timeline row */
export function songMenu(cx: StudioCx, song: TSong): TMenuEntry[] {
	return [
		{ section: song.path != null ? song.name : 'Song' },
		{ label: 'Replace Song…', disabled: song.path == null, onSelect: () => void cx.sources.replaceSong(song) },
		{ label: 'Delete Song', onSelect: () => void cx.sources.deleteSong(song.id) }
	];
}
