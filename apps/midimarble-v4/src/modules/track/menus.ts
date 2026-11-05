import { tidyMenu, type TMenuEntry } from '@/components';
import { formatTime, noteName } from '@/modules/project';
import type { TrackCx } from './TrackCx';

/**
 * Menu of an open note's dot, opened by a right-click (a click shows the platform first): a platform tilted to land on
 * time and the pieces that bridge a long gap
 */
export function dotMenu(trackCx: TrackCx, marbleId: string, hitId: string): TMenuEntry[] {
	const cx = trackCx.studio;
	const project = trackCx.project;
	const hit = trackCx.result?.hits.find((item) => item.marbleId === marbleId && item.hitId === hitId && item.status === 'open');
	if (project == null || hit == null) return [];
	const marble = project.marbles.find((item) => item.id === marbleId);
	const index = marble?.hits.findIndex((item) => item.id === hitId) ?? -1;
	const pitch = marble?.hits[index]?.pitch;
	const gap = trackCx.longGapKeys(project).get(`${marbleId}:${hitId}`);
	const bridge = (type: 'switchback' | 'chain' | 'rail' | 'tunnel'): void => {
		if (gap != null) trackCx.studio.assist.suggestGapPiece(type, marbleId, gap.fromHitId, hitId, { accept: true });
	};

	return tidyMenu([
		{ section: `Hit ${index + 1}${pitch != null ? ` · ${noteName(pitch)}` : ''} · ${formatTime(hit.targetTime)}` },
		{ label: 'Add Platform', shortcut: 'A', onSelect: () => trackCx.placePlatform(hit) },
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
export function canvasMenu(trackCx: TrackCx): TMenuEntry[] {
	const cx = trackCx.studio;
	return tidyMenu([
		cx.commands.item('build.next'),
		cx.commands.item('build.track'),
		cx.commands.item('build.repeat'),
		cx.commands.item('build.mirror'),
		trackCx.studio.assist.hasGhosts ? cx.commands.item('build.continue') : null,
		'separator',
		cx.commands.item('view.fitAll'),
		'separator',
		cx.$clipboard.get()?.pieces.length ? cx.commands.item('edit.paste') : null,
		cx.commands.item('edit.selectAll'),
		// Releasing a new marble takes a click on the flat wall
		cx.$trackView.get() === '2d' ? cx.commands.item('marble.add') : null
	]);
}
