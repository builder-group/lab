import { tidyMenu, type TMenuEntry } from '@/components';
import { commandItem } from '@/modules/studio/commands';
import { formatTime, noteName } from '@/modules/studio/format';
import type { ComposeCx } from './ComposeCx';
import { placeAtHit } from './step-loop';

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
		{ label: 'Add Platform', shortcut: 'A', onSelect: () => void compose.assist.place(hit, 'platform') },
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
		commandItem(cx, 'view.wall'),
		commandItem(cx, 'view.orbit'),
		commandItem(cx, 'view.camera'),
		'separator',
		commandItem(cx, 'edit.selectAll'),
		commandItem(cx, 'marble.add'),
		commandItem(cx, 'view.snap')
	]);
}
