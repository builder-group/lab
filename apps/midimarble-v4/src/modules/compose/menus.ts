import { tidyMenu, type TMenuEntry } from '@/components';
import { commandItem } from '@/modules/studio/commands';
import { formatTime, noteName } from '@/modules/studio/format';
import type { ComposeCx } from './ComposeCx';
import { placeAtHit } from './step-loop';

/**
 * Insert menu of an open hit dot, opened by a click or a right-click at the dot: a platform at the default
 * lean, an auto placed platform, and the bridges for a long gap
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
		{ section: `Hit ${index + 1} · ${formatTime(hit.targetTime)}${pitch != null ? ` · ${noteName(pitch)}` : ''}` },
		{ label: 'Auto-Placed Platform', shortcut: 'A', onSelect: () => void compose.assist.place(hit, 'platform') },
		{ label: 'Platform', onSelect: () => void placeAtHit(cx, hit, 'platform') },
		gap != null ? 'separator' : null,
		gap != null ? { section: `${gap.duration.toFixed(1)} s gap` } : null,
		gap != null ? { label: 'Switchback', onSelect: () => bridge('switchback') } : null,
		gap != null ? { label: 'Rail', onSelect: () => bridge('rail') } : null,
		gap != null ? { label: 'Tunnel', onSelect: () => bridge('tunnel') } : null,
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
		commandItem(cx, 'marble.add'),
		commandItem(cx, 'view.snap')
	]);
}
