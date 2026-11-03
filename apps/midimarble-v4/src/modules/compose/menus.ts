import { tidyMenu, type TMenuEntry } from '@/components';
import { getPieceDefinition } from '@/modules/simulation';
import { commandItem } from '@/modules/studio/commands';
import { formatTime } from '@/modules/studio/format';
import type { ComposeCx } from './ComposeCx';
import { pieceKeys } from './keys';

/** Right-click on an open hit dot: place any piece type there, or bridge a long gap */
export function dotMenu(compose: ComposeCx, laneId: string, hitId: string): TMenuEntry[] {
	const cx = compose.studio;
	const project = compose.project;
	const hit = compose.result?.hits.find((item) => item.laneId === laneId && item.hitId === hitId && item.status === 'open');
	if (project == null || hit == null) return [];
	const lane = project.music.lanes.find((item) => item.id === laneId);
	const index = lane?.hits.findIndex((item) => item.id === hitId) ?? -1;
	const gap = compose.longGapKeys(project).get(`${laneId}:${hitId}`);
	const bridge = (type: 'rail' | 'tunnel'): void => {
		if (gap != null) compose.assist.suggestGapPiece(type, laneId, gap.fromHitId, hitId, { accept: true });
	};

	return tidyMenu([
		{ section: `${lane?.name ?? 'Hit'} · Hit ${index + 1} · ${formatTime(hit.targetTime)}` },
		...pieceKeys.map((item) => ({
			label: `Place ${getPieceDefinition(item.type)?.label ?? item.type}`,
			onSelect: () => void compose.assist.place(hit, item.type)
		})),
		'separator',
		gap != null ? { label: 'Bridge Gap with Rail', onSelect: () => bridge('rail') } : null,
		gap != null ? { label: 'Bridge Gap with Tunnel', onSelect: () => bridge('tunnel') } : null,
		'separator',
		{ label: 'Go to Hit', onSelect: () => cx.$playhead.set(hit.targetTime) }
	]);
}

/** Right-click on empty canvas: the step loop and view commands */
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
		commandItem(cx, 'view.wall'),
		commandItem(cx, 'view.orbit'),
		'separator',
		commandItem(cx, 'edit.selectAll'),
		commandItem(cx, 'marble.add')
	]);
}
