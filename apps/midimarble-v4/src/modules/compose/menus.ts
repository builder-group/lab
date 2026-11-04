import { tidyMenu, type TMenuEntry } from '@/components';
import { anchorPiece, unanchorPiece, unlinkPiece } from '@/modules/simulation';
import { commandItem } from '@/modules/studio/commands';
import { formatTime, noteName } from '@/modules/studio/format';
import { pieceMenu } from '@/modules/studio/menus';
import { attachState } from './attach-edit';
import type { ComposeCx } from './ComposeCx';
import { nearestMoment } from './scene';
import { placeAtHit } from './step-loop';

/**
 * Right-click on a piece on the wall: the piece commands, then its tie. Follow Marble ▸ ties it to the moment
 * of that marble's fall closest to it, keeping it where it is; Detach frees a piece that plays a note or
 * follows a marble.
 */
export function canvasPieceMenu(compose: ComposeCx, entityId: string): TMenuEntry[] {
	const cx = compose.studio;
	const project = compose.project;
	const result = compose.result;
	const entity = project?.entities.find((item) => item.id === entityId);
	if (project == null || result == null || entity?.components.piece == null) return pieceMenu(cx);
	const attach = attachState(project, entity);
	const resolved = result.pieces.find((piece) => piece.entityId === entityId);
	const follow = (laneId: string): void => {
		const track = result.marbles.find((item) => item.laneId === laneId);
		const time = track != null && resolved != null ? nearestMoment(track.samples, resolved.contactPoint ?? resolved.position) : null;
		if (time == null) return;
		const [isOk, error, value] = anchorPiece(project, result, entityId, laneId, time);
		if (!isOk) cx.notify(error.message);
		else cx.execute(value.commands);
	};
	const detach = (): void => {
		const [isOk, error, value] = attach.kind === 'linked' ? unlinkPiece(project, result, entityId) : unanchorPiece(project, result, entityId);
		if (!isOk) cx.notify(error.message);
		else cx.execute(value.commands);
	};
	const marbles = project.music.lanes.filter((lane) => result.marbles.some((track) => track.laneId === lane.id));
	return tidyMenu([
		...pieceMenu(cx),
		'separator',
		{
			label: 'Follow Marble',
			disabled: !marbles.length || resolved == null,
			submenu: marbles.map((lane) => ({ label: lane.name, checked: attach.kind === 'anchored' && attach.laneId === lane.id, onSelect: () => follow(lane.id) })),
			onSelect: () => undefined
		},
		{ label: 'Detach', disabled: attach.kind === 'free', onSelect: detach }
	]);
}

/**
 * Insert menu of an open note's dot, opened by a click or a right-click at the dot: a platform tilted to land on
 * time, one at the default tilt, and the pieces that bridge a long gap
 */
export function dotMenu(compose: ComposeCx, laneId: string, hitId: string): TMenuEntry[] {
	const cx = compose.studio;
	const project = compose.project;
	const hit = compose.result?.hits.find((item) => item.laneId === laneId && item.hitId === hitId && item.status === 'open');
	if (project == null || hit == null) return [];
	const lane = project.music.lanes.find((item) => item.id === laneId);
	const index = lane?.hits.findIndex((item) => item.id === hitId) ?? -1;
	const pitch = lane?.hits[index]?.pitch;
	const gap = compose.longGapKeys(project).get(`${laneId}:${hitId}`);
	const bridge = (type: 'switchback' | 'rail' | 'tunnel'): void => {
		if (gap != null) compose.assist.suggestGapPiece(type, laneId, gap.fromHitId, hitId, { accept: true });
	};

	return tidyMenu([
		{ section: `Note ${index + 1}${pitch != null ? ` · ${noteName(pitch)}` : ''} · ${formatTime(hit.targetTime)}` },
		{ label: 'Add Platform', shortcut: 'A', onSelect: () => compose.placePlatform(hit) },
		{ label: 'Add Platform at Default Tilt', onSelect: () => void placeAtHit(cx, hit, 'platform') },
		gap != null ? 'separator' : null,
		gap != null ? { section: `Long Gap · ${gap.duration.toFixed(1)} s` } : null,
		gap != null ? { label: 'Add Switchback', onSelect: () => bridge('switchback') } : null,
		gap != null ? { label: 'Add Rail', onSelect: () => bridge('rail') } : null,
		gap != null ? { label: 'Add Tunnel', onSelect: () => bridge('tunnel') } : null,
		'separator',
		{ label: 'Go to Note', onSelect: () => cx.$playhead.set(hit.targetTime) }
	]);
}

/** Right-click on the empty wall: the assists and view commands */
export function canvasMenu(compose: ComposeCx): TMenuEntry[] {
	const cx = compose.studio;
	return tidyMenu([
		commandItem(cx, 'build.next'),
		commandItem(cx, 'build.repeat'),
		commandItem(cx, 'build.mirror'),
		commandItem(cx, 'build.autoPlace'),
		compose.assist.hasGhosts ? commandItem(cx, 'build.continue') : null,
		'separator',
		commandItem(cx, 'view.fitAll'),
		commandItem(cx, 'view.follow'),
		'separator',
		commandItem(cx, 'edit.selectAll'),
		commandItem(cx, 'marble.add'),
		commandItem(cx, 'view.snap')
	]);
}
