import type { TMenuItem } from '@/components';
import type { ComposeCx } from '@/modules/compose/ComposeCx';
import { selectedPieceIds } from '@/modules/compose/step-loop';
import { parseHitKey } from './selection';
import { focusedLane, type StudioCx } from './StudioCx';

// Every studio command in one list. The command palette lists them all; context menus and the
// keyboard handlers run the same actions, so each command reads the same everywhere with its shortcut.

export interface TCommand {
	id: TCommandId;
	title: string;
	section: TCommandSection;
	/** Shortcut glyphs as macOS menus show them */
	shortcut?: string;
	/** Extra words the palette matches, such as Blender's names for an action */
	keywords?: string;
	isEnabled?: (cx: StudioCx) => boolean;
	isChecked?: (cx: StudioCx) => boolean;
	run: (cx: StudioCx) => void;
}

export type TCommandSection = 'File' | 'Edit' | 'View' | 'Playback' | 'Tools' | 'Build' | 'Marble';

function compose(cx: StudioCx): ComposeCx | null {
	return cx.$workspace.get() === 'compose' ? cx.$compose.get() : null;
}

function hasProject(cx: StudioCx): boolean {
	return cx.project != null;
}

function hasPieces(cx: StudioCx): boolean {
	const project = cx.project;
	return project != null && compose(cx) != null && selectedPieceIds(project, cx.$selection.get()).length > 0;
}

function hasHits(cx: StudioCx): boolean {
	return cx.$selection.get().some((key) => parseHitKey(key) != null);
}

function isTool(cx: StudioCx, tool: 'select' | 'hand'): boolean {
	return compose(cx)?.$tool.get() === tool;
}

function isPieceTool(cx: StudioCx, type: string): boolean {
	const canvas = compose(cx);
	return canvas?.$tool.get() === 'piece' && canvas.$pieceType.get() === type;
}

function pieceTool(type: 'platform' | 'rail' | 'tunnel' | 'windmill', title: string, shortcut: string): TCommand {
	return {
		id: `tool.${type}`,
		title,
		section: 'Tools',
		shortcut,
		keywords: 'piece add place',
		isEnabled: (cx) => compose(cx) != null,
		isChecked: (cx) => isPieceTool(cx, type),
		run: (cx) => compose(cx)?.runKeyAction({ type: 'pieceType', pieceType: type })
	};
}

export const commands: readonly TCommand[] = [
	// MARK: - File
	{ id: 'file.new', title: 'New Project…', section: 'File', shortcut: '⌘N', run: (cx) => void cx.newProject() },
	{ id: 'file.open', title: 'Open Project…', section: 'File', shortcut: '⌘O', run: (cx) => void cx.openProject() },
	{ id: 'file.close', title: 'Close Project', section: 'File', isEnabled: hasProject, run: (cx) => void cx.closeProject() },
	{ id: 'file.save', title: 'Save', section: 'File', shortcut: '⌘S', isEnabled: hasProject, run: (cx) => void cx.flush() },
	{ id: 'file.importMidi', title: 'Import MIDI…', section: 'File', shortcut: '⌘I', isEnabled: hasProject, run: (cx) => void cx.sources.pickMidi() },
	{ id: 'file.importAudio', title: 'Import Audio…', section: 'File', shortcut: '⇧⌘I', keywords: 'recording wav mp3', isEnabled: hasProject, run: (cx) => void cx.sources.pickAudio() },

	// MARK: - Edit
	{ id: 'edit.undo', title: 'Undo', section: 'Edit', shortcut: '⌘Z', isEnabled: (cx) => (cx.$history.get()?.past.length ?? 0) > 0, run: (cx) => cx.undo() },
	{ id: 'edit.redo', title: 'Redo', section: 'Edit', shortcut: '⇧⌘Z', isEnabled: (cx) => (cx.$history.get()?.future.length ?? 0) > 0, run: (cx) => cx.redo() },
	{ id: 'edit.rename', title: 'Rename…', section: 'Edit', isEnabled: (cx) => cx.project?.entities.some((entity) => entity.id === cx.$selection.get()[0]) === true, run: (cx) => cx.renameSelection() },
	{
		id: 'edit.delete',
		title: 'Delete',
		section: 'Edit',
		shortcut: '⌫',
		keywords: 'remove',
		isEnabled: (cx) => hasPieces(cx) || hasHits(cx),
		run: (cx) => {
			if (compose(cx)?.deleteSelection() === true) return;
			deleteSelectedHits(cx);
		}
	},
	{
		id: 'edit.selectAll',
		title: 'Select All Pieces',
		section: 'Edit',
		shortcut: '⌘A',
		isEnabled: (cx) => compose(cx) != null,
		run: (cx) => cx.$selection.set(cx.project?.entities.filter((entity) => entity.components.piece != null).map((entity) => entity.id) ?? [])
	},
	{ id: 'edit.deselect', title: 'Deselect All', section: 'Edit', isEnabled: (cx) => cx.$selection.get().length > 0, run: (cx) => cx.$selection.set([]) },

	// MARK: - View
	{ id: 'view.compose', title: 'Compose', section: 'View', shortcut: '⌘1', keywords: 'workspace', isChecked: (cx) => cx.$workspace.get() === 'compose', run: (cx) => cx.$workspace.set('compose') },
	{ id: 'view.design', title: 'Design', section: 'View', shortcut: '⌘2', keywords: 'workspace blender', isChecked: (cx) => cx.$workspace.get() === 'design', run: (cx) => cx.$workspace.set('design') },
	{ id: 'view.sidebar', title: 'Sidebar', section: 'View', shortcut: '⌃⌘S', keywords: 'outliner panel', isChecked: (cx) => cx.$panels.get().sidebar, run: (cx) => cx.togglePanel('sidebar') },
	{ id: 'view.inspector', title: 'Inspector', section: 'View', shortcut: '⌃⌘I', keywords: 'properties panel', isChecked: (cx) => cx.$panels.get().inspector, run: (cx) => cx.togglePanel('inspector') },
	{ id: 'view.timeline', title: 'Timeline', section: 'View', shortcut: '⌃⌘T', keywords: 'lanes dope sheet panel', isChecked: (cx) => cx.$panels.get().timeline, run: (cx) => cx.togglePanel('timeline') },
	{ id: 'view.zoomIn', title: 'Zoom In', section: 'View', shortcut: '⌘+', isEnabled: (cx) => compose(cx) != null, run: (cx) => compose(cx)?.zoomBy(2) },
	{ id: 'view.zoomOut', title: 'Zoom Out', section: 'View', shortcut: '⌘−', isEnabled: (cx) => compose(cx) != null, run: (cx) => compose(cx)?.zoomBy(0.5) },
	{ id: 'view.fitAll', title: 'Zoom to Fit', section: 'View', shortcut: '⇧1', keywords: 'frame all home view all', isEnabled: (cx) => compose(cx) != null, run: (cx) => compose(cx)?.fitAll() },
	{ id: 'view.fitFrame', title: 'Zoom to Film Frame', section: 'View', shortcut: '⇧3', keywords: 'frame film width follow marble', isEnabled: (cx) => compose(cx) != null, run: (cx) => compose(cx)?.fitFrame() },
	{ id: 'view.fitSelection', title: 'Zoom to Selection', section: 'View', shortcut: '⇧2', keywords: 'frame selected', isEnabled: hasPieces, run: (cx) => compose(cx)?.fitSelection() },
	{ id: 'view.wall', title: 'Wall View', section: 'View', keywords: '2d front', isEnabled: (cx) => compose(cx) != null, isChecked: (cx) => compose(cx)?.$camera.get().mode === '2d', run: (cx) => compose(cx)?.setMode('2d') },
	{ id: 'view.orbit', title: 'Orbit View', section: 'View', keywords: '3d perspective', isEnabled: (cx) => compose(cx) != null, isChecked: (cx) => compose(cx)?.$camera.get().mode === 'orbit', run: (cx) => compose(cx)?.setMode('orbit') },

	// MARK: - Playback
	{ id: 'play.toggle', title: 'Play', section: 'Playback', shortcut: 'Space', keywords: 'pause stop', isEnabled: hasProject, run: (cx) => cx.$playing.set(!cx.$playing.get()) },
	{ id: 'play.start', title: 'Go to Beginning', section: 'Playback', shortcut: '↩', keywords: 'rewind start', isEnabled: hasProject, run: (cx) => cx.$playhead.set(0) },
	{ id: 'play.previousHit', title: 'Previous Hit', section: 'Playback', shortcut: '←', keywords: 'jump keyframe', isEnabled: hasProject, run: (cx) => cx.stepHit(-1) },
	{ id: 'play.nextHit', title: 'Next Hit', section: 'Playback', shortcut: '→', keywords: 'jump keyframe', isEnabled: hasProject, run: (cx) => cx.stepHit(1) },
	{ id: 'play.tap', title: 'Tap Hit at Playhead', section: 'Playback', shortcut: 'T', keywords: 'record tap along', isEnabled: hasProject, run: (cx) => cx.tapHit() },

	// MARK: - Tools
	{ id: 'tool.select', title: 'Select Tool', section: 'Tools', shortcut: 'V', keywords: 'move pointer', isEnabled: (cx) => compose(cx) != null, isChecked: (cx) => isTool(cx, 'select'), run: (cx) => compose(cx)?.$tool.set('select') },
	{ id: 'tool.hand', title: 'Hand Tool', section: 'Tools', shortcut: 'H', keywords: 'pan', isEnabled: (cx) => compose(cx) != null, isChecked: (cx) => isTool(cx, 'hand'), run: (cx) => compose(cx)?.$tool.set('hand') },
	pieceTool('platform', 'Platform Tool', '1'),
	pieceTool('rail', 'Rail Tool', '2'),
	pieceTool('tunnel', 'Tunnel Tool', '3'),
	pieceTool('windmill', 'Windmill Tool', '4'),

	// MARK: - Build
	{ id: 'build.next', title: 'Next', section: 'Build', shortcut: 'N', keywords: 'place step', isEnabled: (cx) => compose(cx) != null, run: (cx) => compose(cx)?.next() },
	{ id: 'build.repeat', title: 'Repeat', section: 'Build', shortcut: 'R', isEnabled: (cx) => compose(cx) != null, run: (cx) => compose(cx)?.step('repeat') },
	{ id: 'build.mirror', title: 'Mirror', section: 'Build', shortcut: 'M', keywords: 'zigzag flip', isEnabled: (cx) => compose(cx) != null, run: (cx) => compose(cx)?.step('mirror') },
	{
		id: 'build.autoPlace',
		title: 'Auto Place',
		section: 'Build',
		shortcut: 'A',
		keywords: 'solve angle',
		isEnabled: (cx) => compose(cx) != null,
		run: (cx) => {
			const canvas = compose(cx);
			canvas?.assist.autoPlace(canvas.placementType());
		}
	},
	{ id: 'build.continue', title: 'Accept Continue', section: 'Build', shortcut: '⇥', keywords: 'ghosts suggestion tab', isEnabled: (cx) => compose(cx)?.assist.hasGhosts === true, run: (cx) => compose(cx)?.assist.acceptGhosts() },
	{ id: 'build.dismiss', title: 'Dismiss Suggestions', section: 'Build', shortcut: '⎋', keywords: 'ghosts escape', isEnabled: (cx) => compose(cx)?.assist.hasGhosts === true, run: (cx) => compose(cx)?.assist.dismiss() },
	{
		id: 'build.pin',
		title: 'Pin',
		section: 'Build',
		shortcut: 'P',
		keywords: 'unpin lock keep in place',
		isEnabled: hasPieces,
		isChecked: (cx) => {
			const ids = cx.$selection.get();
			const pieces = cx.project?.entities.filter((entity) => ids.includes(entity.id) && entity.components.hitLink != null) ?? [];
			return pieces.length > 0 && pieces.every((entity) => entity.components.hitLink?.pinned === true);
		},
		run: (cx) => compose(cx)?.togglePin()
	},
	{ id: 'build.rotateLeft', title: 'Rotate 5° Counterclockwise', section: 'Build', shortcut: '⇧←', keywords: 'turn angle nudge', isEnabled: hasPieces, run: (cx) => compose(cx)?.nudge(5) },
	{ id: 'build.rotateRight', title: 'Rotate 5° Clockwise', section: 'Build', shortcut: '⇧→', keywords: 'turn angle nudge', isEnabled: hasPieces, run: (cx) => compose(cx)?.nudge(-5) },

	// MARK: - Marble
	{ id: 'marble.add', title: 'Add Marble', section: 'Marble', keywords: 'lane track new', isEnabled: hasProject, run: (cx) => cx.addMarble() },
	{
		id: 'marble.mute',
		title: 'Mute Marble',
		section: 'Marble',
		keywords: 'silence lane',
		isEnabled: (cx) => focusedLaneId(cx) != null,
		isChecked: (cx) => cx.$mix.get().muted.includes(focusedLaneId(cx) ?? ''),
		run: (cx) => {
			const laneId = focusedLaneId(cx);
			if (laneId != null) cx.toggleMute(laneId);
		}
	},
	{
		id: 'marble.solo',
		title: 'Solo Marble',
		section: 'Marble',
		keywords: 'lane',
		isEnabled: (cx) => focusedLaneId(cx) != null,
		isChecked: (cx) => cx.$mix.get().solo.includes(focusedLaneId(cx) ?? ''),
		run: (cx) => {
			const laneId = focusedLaneId(cx);
			if (laneId != null) cx.toggleSolo(laneId);
		}
	}
];

export type TCommandId =
	| 'file.new'
	| 'file.open'
	| 'file.close'
	| 'file.save'
	| 'file.importMidi'
	| 'file.importAudio'
	| 'edit.undo'
	| 'edit.redo'
	| 'edit.rename'
	| 'edit.delete'
	| 'edit.selectAll'
	| 'edit.deselect'
	| 'view.compose'
	| 'view.design'
	| 'view.sidebar'
	| 'view.inspector'
	| 'view.timeline'
	| 'view.zoomIn'
	| 'view.zoomOut'
	| 'view.fitAll'
	| 'view.fitSelection'
	| 'view.fitFrame'
	| 'view.wall'
	| 'view.orbit'
	| 'play.toggle'
	| 'play.start'
	| 'play.previousHit'
	| 'play.nextHit'
	| 'play.tap'
	| 'tool.select'
	| 'tool.hand'
	| 'build.next'
	| 'build.repeat'
	| 'build.mirror'
	| 'build.autoPlace'
	| 'build.continue'
	| 'build.dismiss'
	| 'build.pin'
	| 'build.rotateLeft'
	| 'build.rotateRight'
	| 'marble.add'
	| 'marble.mute'
	| 'marble.solo'
	| 'tool.platform'
	| 'tool.rail'
	| 'tool.tunnel'
	| 'tool.windmill';

export function getCommand(id: TCommandId): TCommand {
	const command = commands.find((item) => item.id === id);
	if (command == null) throw new Error(`Unknown command ${id}`);
	return command;
}

export function isCommandEnabled(cx: StudioCx, command: TCommand): boolean {
	return command.isEnabled?.(cx) ?? true;
}

/** A menu item that runs the command, with its title, shortcut, enabled and checked state */
export function commandItem(cx: StudioCx, id: TCommandId, title?: string): TMenuItem {
	const command = getCommand(id);
	return {
		label: title ?? command.title,
		shortcut: command.shortcut,
		disabled: !isCommandEnabled(cx, command),
		checked: command.isChecked?.(cx),
		onSelect: () => command.run(cx)
	};
}

export function deleteSelectedHits(cx: StudioCx): boolean {
	const project = cx.project;
	if (project == null) return false;
	const byLane = new Map<string, string[]>();
	for (const key of cx.$selection.get()) {
		const parsed = parseHitKey(key);
		if (parsed == null) continue;
		byLane.set(parsed.laneId, [...(byLane.get(parsed.laneId) ?? []), parsed.hitId]);
	}
	if (!byLane.size) return false;
	const applied = cx.execute([...byLane].map(([laneId, hitIds]) => ({ type: 'removeHits' as const, laneId, hitIds })));
	if (applied) cx.$selection.set([]);
	return applied;
}

function focusedLaneId(cx: StudioCx): string | undefined {
	const project = cx.project;
	return project == null ? undefined : focusedLane(project, cx.$selection.get())?.id;
}
