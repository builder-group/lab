import { tidyMenu, type TMenuEntry } from '@/components';
import { insertSections, type TInsertItem } from '@/modules/compose/library';
import { commandItem, getCommand, type TCommandId } from './commands';
import { songSource } from './SourcesCx';
import type { StudioCx, TWorkspace } from './StudioCx';

/**
 * The one Add menu (+) of the Layers tab and the timeline's track column, like Figma's insert menu: a marble,
 * a piece, a title, a shot and the song. An item of the other workspace opens that workspace first.
 */
export function addMenu(cx: StudioCx): TMenuEntry[] {
	const project = cx.project;
	const hasSong = project != null && songSource(project) != null;
	return tidyMenu([
		commandItem(cx, 'marble.add'),
		{
			label: 'Add Piece',
			disabled: project == null,
			submenu: pieceEntries.map((entry) => ({ label: entry.label, shortcut: entry.shortcut, onSelect: () => armPiece(cx, entry.item) })),
			onSelect: () => undefined
		},
		'separator',
		{ label: 'Add Title', shortcut: getCommand('tool.text').shortcut, disabled: project == null, onSelect: () => runIn(cx, 'design', 'design.addText') },
		{ label: 'Add Shot', shortcut: getCommand('camera.addShot').shortcut, disabled: project == null, onSelect: () => runIn(cx, 'design', 'camera.addShot') },
		'separator',
		hasSong ? commandItem(cx, 'file.replaceSong') : commandItem(cx, 'file.importMidi'),
		hasSong ? commandItem(cx, 'file.removeSong') : null
	]);
}

// Pieces of the Insert library; marbles have their own item
const pieceEntries = insertSections.flatMap((section) => section.entries).filter((entry) => entry.item !== 'marble');

/** Arms the tool that places a piece, opening Compose first when Film is showing */
export function armPiece(cx: StudioCx, item: TInsertItem): void {
	const current = cx.$workspace.get() === 'compose' ? cx.$compose.get() : null;
	if (current != null) {
		current.armInsert(item);
		return;
	}
	cx.$workspace.set('compose');
	const mounted = cx.$compose.get();
	if (mounted != null) {
		mounted.armInsert(item);
		return;
	}
	// The canvas mounts its ComposeCx after the workspace switch renders
	const stop = cx.$compose.listen(({ value }) => {
		if (value == null) return;
		stop();
		value.armInsert(item);
	});
}

function runIn(cx: StudioCx, workspace: TWorkspace, id: TCommandId): void {
	cx.$workspace.set(workspace);
	getCommand(id).run(cx);
}
