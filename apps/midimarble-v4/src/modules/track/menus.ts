import { tidyMenu, type TMenuEntry } from '@/components';
import { commandItem } from '@/modules/studio/commands';
import { formatTime, noteName } from '@/modules/project';
import type { ComposeCx } from './TrackCx';

/**
 * Menu of an open note's dot, opened by a right-click (a click shows the platform first): a platform tilted to land on
 * time and the pieces that bridge a long gap
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
	const bridge = (type: 'switchback' | 'chain' | 'rail' | 'tunnel'): void => {
		if (gap != null) compose.assist.suggestGapPiece(type, laneId, gap.fromHitId, hitId, { accept: true });
	};

	return tidyMenu([
		{ section: `Hit ${index + 1}${pitch != null ? ` · ${noteName(pitch)}` : ''} · ${formatTime(hit.targetTime)}` },
		{ label: 'Add Platform', shortcut: 'A', onSelect: () => compose.placePlatform(hit) },
		gap != null ? 'separator' : null,
		gap != null ? { section: `Long Gap · ${gap.duration.toFixed(1)} s` } : null,
		gap != null ? { label: 'Add Rail', onSelect: () => bridge('rail') } : null,
		gap != null ? { label: 'Add Rail: Switchback', onSelect: () => bridge('switchback') } : null,
		gap != null ? { label: 'Add Rail: Chain', onSelect: () => bridge('chain') } : null,
		gap != null ? { label: 'Add Tunnel', onSelect: () => bridge('tunnel') } : null,
		'separator',
		{ label: 'Go to Note', onSelect: () => cx.$playhead.set(hit.targetTime) }
	]);
}

/** Right-click on the empty wall, in 2D, 3D and Camera: the assists and view commands */
export function canvasMenu(compose: ComposeCx): TMenuEntry[] {
	const cx = compose.studio;
	return tidyMenu([
		commandItem(cx, 'build.next'),
		commandItem(cx, 'build.track'),
		commandItem(cx, 'build.repeat'),
		commandItem(cx, 'build.mirror'),
		compose.assist.hasGhosts ? commandItem(cx, 'build.continue') : null,
		'separator',
		commandItem(cx, 'view.fitAll'),
		'separator',
		cx.$clipboard.get()?.pieces.length ? commandItem(cx, 'edit.paste') : null,
		commandItem(cx, 'edit.selectAll'),
		// Releasing a new marble takes a click on the flat wall
		cx.$trackView.get() === '2d' ? commandItem(cx, 'marble.add') : null
	]);
}
