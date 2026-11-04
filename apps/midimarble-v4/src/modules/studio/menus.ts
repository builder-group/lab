import { tidyMenu, type TMenuEntry } from '@/components';
import { canFollow, canPlayNote, detachSelection, followItems, hasTiedSelection } from '@/modules/compose/tie-commands';
import { createId, type TLane } from '@/modules/project';
import { isMusicalPiece } from '@/modules/simulation';
import { commandItem, getCommand, runInWorkspace } from './commands';
import { formatTime } from './format';
import { toHitKey } from './selection';
import type { StudioCx } from './StudioCx';
import { playWithMenu } from './timeline/hand-notes';

// Context menus list the same commands as the palette and the shortcuts, so each shows its key

/** Right-click on a piece, on the canvas or in the sidebar */
export function pieceMenu(cx: StudioCx): TMenuEntry[] {
	// Add Platform re-tilts the selected platform; for scenery such as a switchback it would have no clear target
	const selected = cx.project?.entities.filter((entity) => cx.$selection.get().includes(entity.id)) ?? [];
	const isPlatforms = selected.length > 0 && selected.every((entity) => isMusicalPiece(entity.components.piece?.type ?? ''));
	return tidyMenu([
		isPlatforms ? commandItem(cx, 'build.autoPlace') : null,
		'separator',
		commandItem(cx, 'build.rotateLeft'),
		commandItem(cx, 'build.rotateRight'),
		'separator',
		commandItem(cx, 'view.fitSelection'),
		'separator',
		commandItem(cx, 'edit.duplicate'),
		commandItem(cx, 'edit.rename'),
		commandItem(cx, 'edit.delete'),
		'separator',
		...pieceLinkItems(cx)
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
		'separator',
		...playWithMenu(cx, moving),
		'separator',
		{ ...commandItem(cx, 'edit.delete'), disabled: false, onSelect: () => removeHits(cx, moving) }
	]);
}

/** Right-click on a lane row or its header; `time` is where an added hit goes */
export function laneMenu(cx: StudioCx, lane: TLane, time?: number): TMenuEntry[] {
	const project = cx.project;
	if (project == null) return [];
	const marble = project.entities.find((entity) => entity.components.marble?.laneId === lane.id);
	const hasRecording = project.music.sources.some((source) => source.kind === 'audio');
	const mix = cx.$mix.get();

	return tidyMenu([
		{ section: lane.name },
		time != null ? { label: `Add Hit at ${formatTime(time)}`, onSelect: () => addHit(cx, lane, time) } : null,
		{ label: 'Select All Hits', disabled: !lane.hits.length, onSelect: () => cx.$selection.set(lane.hits.map((hit) => toHitKey(lane.id, hit.id))) },
		'separator',
		hasRecording ? null : { label: 'Mute', checked: mix.muted.includes(lane.id), onSelect: () => cx.toggleMute(lane.id) },
		hasRecording ? null : { label: 'Solo', checked: mix.solo.includes(lane.id), onSelect: () => cx.toggleSolo(lane.id) },
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
		commandItem(cx, 'marble.add'),
		{ label: 'Delete Marble', disabled: project.music.lanes.length <= 1, onSelect: () => cx.execute([{ type: 'removeLane', laneId: lane.id }]) }
	]);
}

export function addHit(cx: StudioCx, lane: TLane, time: number): void {
	const hit = { id: createId('hit'), time: Math.round(time * 10000) / 10000, pitch: nearestPitch(lane, time) };
	if (cx.execute([{ type: 'upsertHits', laneId: lane.id, hits: [hit] }])) {
		cx.$selection.set([toHitKey(lane.id, hit.id)]);
		cx.audition(lane.id, hit.pitch);
	}
}

function nearestPitch(lane: TLane, time: number): number | undefined {
	let best: number | undefined;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const hit of lane.hits) {
		const distance = Math.abs(hit.time - time);
		if (hit.pitch != null && distance < bestDistance) {
			best = hit.pitch;
			bestDistance = distance;
		}
	}
	return best;
}

function removeHits(cx: StudioCx, keys: string[]): void {
	const project = cx.project;
	if (project == null) return;
	const commands = project.music.lanes.flatMap((lane) => {
		const hitIds = lane.hits.filter((hit) => keys.includes(toHitKey(lane.id, hit.id))).map((hit) => hit.id);
		return hitIds.length ? [{ type: 'removeHits' as const, laneId: lane.id, hitIds }] : [];
	});
	if (cx.execute(commands)) cx.$selection.set([]);
}

/** The Song layer's menu, in Layers and on its timeline row */
export function songMenu(cx: StudioCx): TMenuEntry[] {
	return [{ section: 'Song' }, commandItem(cx, 'file.replaceSong'), commandItem(cx, 'file.removeSong')];
}
