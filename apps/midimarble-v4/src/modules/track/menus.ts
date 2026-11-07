import { tidyMenu, type TMenuEntry } from '@/components';
import type { TrackCx } from './TrackCx';

/** Right-click on the empty wall, in 2D, 3D and Camera: the assists and view commands */
export function canvasMenu(trackCx: TrackCx): TMenuEntry[] {
	const cx = trackCx.studio;
	return tidyMenu([
		cx.commands.item('build.track'),
		cx.commands.item('build.repeat'),
		'separator',
		cx.commands.item('view.fitAll'),
		'separator',
		cx.$clipboard.get()?.pieces.length ? cx.commands.item('edit.paste') : null,
		cx.commands.item('edit.selectAll'),
		// Releasing a new marble takes a click on the flat wall
		cx.$trackView.get() === '2d' ? cx.commands.item('marble.add') : null
	]);
}
