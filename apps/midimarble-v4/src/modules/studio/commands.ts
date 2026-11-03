import type { TMenuItem } from '@/components';
import type { ComposeCx } from '@/modules/compose/ComposeCx';
import { toolKeys, tunnelPathKey, type TComposeTool } from '@/modules/compose/keys';
import { selectedPieceIds } from '@/modules/compose/step-loop';
import type { TRenderPreset } from '@/modules/blender';
import { themeCommands } from '@/modules/design/design-commands';
import { addShotCommands, removeShotsCommands } from '@/modules/design/shots';
import { parseHitKey, parseShotKey, toShotKey } from './selection';
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

export type TCommandSection = 'File' | 'Edit' | 'View' | 'Playback' | 'Tools' | 'Build' | 'Marble' | 'Design';

function compose(cx: StudioCx): ComposeCx | null {
	return cx.$workspace.get() === 'compose' ? cx.$compose.get() : null;
}

function hasProject(cx: StudioCx): boolean {
	return cx.project != null;
}

function hasSong(cx: StudioCx): boolean {
	return (cx.project?.music.sources.length ?? 0) > 0;
}

function inDesign(cx: StudioCx): boolean {
	return cx.project != null && cx.$workspace.get() === 'design';
}

/** Whether Blender runs for the Design workspace; false in the browser and without Blender */
function hasBlender(cx: StudioCx): boolean {
	const status = cx.design.$status.get();
	return inDesign(cx) && status !== 'unavailable' && status !== 'missing';
}

/** Selected pieces that Blender reports as unlinked */
function unlinkedSelection(cx: StudioCx): string[] {
	const links = cx.design.$links.get();
	return cx.$selection.get().filter((id) => links[id]?.link === 'unlinked');
}

function presetCommand(id: TPresetCommandId, preset: TRenderPreset, title: string): TCommand {
	return {
		id,
		title,
		section: 'Design',
		keywords: preset === 'draft' ? 'render preset film workbench quick preview motion timing' : 'render preset film quality export',
		isEnabled: hasProject,
		isChecked: (cx) => cx.project?.design.renderPreset === preset,
		run: (cx) => cx.execute([{ type: 'setDesign', design: { renderPreset: preset } }])
	};
}

type TPresetCommandId = 'design.presetDraft' | 'design.presetFast' | 'design.presetBalanced' | 'design.presetBest';

function themeCommand(id: 'design.themePegboard' | 'design.themeBrass', theme: string, title: string): TCommand {
	return {
		id,
		title,
		section: 'Design',
		keywords: 'look style art direction',
		isEnabled: hasProject,
		isChecked: (cx) => cx.project?.design.theme === theme,
		run: (cx) => {
			const project = cx.project;
			if (project != null) cx.execute(themeCommands(project, theme));
		}
	};
}

function hasPieces(cx: StudioCx): boolean {
	const project = cx.project;
	return project != null && compose(cx) != null && selectedPieceIds(project, cx.$selection.get()).length > 0;
}

function hasHits(cx: StudioCx): boolean {
	return cx.$selection.get().some((key) => parseHitKey(key) != null);
}

function selectedShotIds(cx: StudioCx): string[] {
	return cx.$selection.get().flatMap((key) => parseShotKey(key) ?? []);
}

function isTool(cx: StudioCx, tool: TComposeTool): boolean {
	return compose(cx)?.$tool.get() === tool;
}

function toolCommand(tool: TComposeTool, title: string, keywords: string): TCommand {
	return {
		id: `tool.${tool}`,
		title,
		section: 'Tools',
		shortcut: toolKeys.find((item) => item.tool === tool)?.key,
		keywords,
		isEnabled: (cx) => compose(cx) != null,
		isChecked: (cx) => isTool(cx, tool) && (tool !== 'path' || compose(cx)?.$pathType.get() === 'rail'),
		run: (cx) => compose(cx)?.armTool(tool)
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
	{ id: 'file.replaceSong', title: 'Replace Song…', section: 'File', keywords: 'music midi audio soundtrack', isEnabled: hasSong, run: (cx) => void cx.sources.replaceSong() },
	{ id: 'file.removeSong', title: 'Remove Song', section: 'File', keywords: 'music midi audio soundtrack delete', isEnabled: hasSong, run: (cx) => cx.sources.removeSong() },
	{ id: 'file.export', title: 'Export Film…', section: 'File', shortcut: '⌘E', keywords: 'render video movie mp4 share', isEnabled: hasProject, run: (cx) => cx.film.openSheet() },

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
		isEnabled: (cx) => hasPieces(cx) || hasHits(cx) || (inDesign(cx) && selectedShotIds(cx).length > 0),
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
	{ id: 'view.agent', title: 'Agent', section: 'View', shortcut: '⌘J', keywords: 'chat ai assistant claude codex ask', isEnabled: hasProject, isChecked: (cx) => cx.$panels.get().agent, run: (cx) => cx.togglePanel('agent') },
	{ id: 'view.zoomIn', title: 'Zoom In', section: 'View', shortcut: '⌘+', isEnabled: (cx) => compose(cx) != null, run: (cx) => compose(cx)?.zoomBy(2) },
	{ id: 'view.zoomOut', title: 'Zoom Out', section: 'View', shortcut: '⌘−', isEnabled: (cx) => compose(cx) != null, run: (cx) => compose(cx)?.zoomBy(0.5) },
	{ id: 'view.fitAll', title: 'Zoom to Fit', section: 'View', shortcut: '⇧1', keywords: 'frame all home view all', isEnabled: (cx) => compose(cx) != null, run: (cx) => compose(cx)?.fitAll() },
	{ id: 'view.fitFrame', title: 'Zoom to Film Frame', section: 'View', shortcut: '⇧3', keywords: 'frame film width follow marble', isEnabled: (cx) => compose(cx) != null, run: (cx) => compose(cx)?.fitFrame() },
	{ id: 'view.fitSelection', title: 'Zoom to Selection', section: 'View', shortcut: '⇧2', keywords: 'frame selected', isEnabled: hasPieces, run: (cx) => compose(cx)?.fitSelection() },
	{
		id: 'view.snap',
		title: 'Snap to Dots and Trajectories',
		section: 'View',
		keywords: 'magnet snapping link anchor attach',
		isChecked: (cx) => cx.$snapping.get(),
		run: (cx) => cx.$snapping.set(!cx.$snapping.get())
	},
	{ id: 'view.wall', title: 'Wall View', section: 'View', keywords: '2d front', isEnabled: (cx) => compose(cx) != null, isChecked: (cx) => compose(cx)?.$camera.get().mode === '2d', run: (cx) => compose(cx)?.setMode('2d') },
	{ id: 'view.orbit', title: 'Orbit View', section: 'View', keywords: '3d perspective', isEnabled: (cx) => compose(cx) != null, isChecked: (cx) => compose(cx)?.$camera.get().mode === 'orbit', run: (cx) => compose(cx)?.setMode('orbit') },
	{ id: 'view.camera', title: 'Camera View', section: 'View', shortcut: '0', keywords: 'film follow camera preview viewfinder numpad', isEnabled: (cx) => compose(cx) != null, isChecked: (cx) => compose(cx)?.$camera.get().mode === 'camera', run: (cx) => compose(cx)?.toggleCameraView() },

	// MARK: - Playback
	{ id: 'play.toggle', title: 'Play', section: 'Playback', shortcut: 'Space', keywords: 'pause stop', isEnabled: hasProject, run: (cx) => cx.$playing.set(!cx.$playing.get()) },
	{ id: 'play.start', title: 'Go to Beginning', section: 'Playback', shortcut: '↩', keywords: 'rewind start', isEnabled: hasProject, run: (cx) => cx.$playhead.set(0) },
	{ id: 'play.previousHit', title: 'Previous Hit', section: 'Playback', shortcut: '←', keywords: 'jump keyframe', isEnabled: hasProject, run: (cx) => cx.stepHit(-1) },
	{ id: 'play.nextHit', title: 'Next Hit', section: 'Playback', shortcut: '→', keywords: 'jump keyframe', isEnabled: hasProject, run: (cx) => cx.stepHit(1) },
	{ id: 'play.tap', title: 'Tap Hit at Playhead', section: 'Playback', shortcut: 'T', keywords: 'record tap along', isEnabled: hasProject, run: (cx) => cx.tapHit() },

	// MARK: - Tools
	toolCommand('select', 'Move Tool', 'select pointer arrow'),
	toolCommand('hand', 'Hand Tool', 'pan'),
	toolCommand('marble', 'Marble Tool', 'add marble release lane ball'),
	toolCommand('platform', 'Platform Tool', 'piece add place bar'),
	toolCommand('path', 'Path Tool', 'rail pen bezier curve draw'),
	{
		id: 'tool.tunnel',
		title: 'Path Tool: Tunnel',
		section: 'Tools',
		shortcut: tunnelPathKey.key,
		keywords: 'tunnel tube pen bezier curve draw',
		isEnabled: (cx) => compose(cx) != null,
		isChecked: (cx) => isTool(cx, 'path') && compose(cx)?.$pathType.get() === 'tunnel',
		run: (cx) => compose(cx)?.armTool('path', 'tunnel')
	},
	toolCommand('windmill', 'Windmill Tool', 'piece add rotor blades'),
	toolCommand('switchback', 'Switchback Tool', 'piece add holder zigzag long gap'),
	{
		id: 'tool.insert',
		title: 'Insert…',
		section: 'Tools',
		shortcut: '⇧I',
		keywords: 'library assets add piece windmill switchback rail tunnel',
		isEnabled: (cx) => compose(cx) != null,
		run: (cx) => compose(cx)?.$libraryOpen.set(true)
	},
	{
		id: 'tool.text',
		title: 'Text Tool',
		section: 'Design',
		shortcut: 'T',
		keywords: 'wall text title label',
		isEnabled: inDesign,
		isChecked: (cx) => cx.design.$placing.get() === 'text',
		run: (cx) => getCommand('design.addText').run(cx)
	},
	{
		id: 'tool.asset',
		title: 'Asset Tool',
		section: 'Design',
		keywords: 'library skin decoration theme',
		isEnabled: inDesign,
		run: (cx) => {
			cx.$panels.set((panels) => ({ ...panels, sidebar: true }));
			requestAnimationFrame(() => document.getElementById('library-search')?.focus());
		}
	},

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
	{ id: 'build.rotateLeft', title: 'Rotate 5° Counterclockwise', section: 'Build', shortcut: '⇧←', keywords: 'turn angle nudge', isEnabled: hasPieces, run: (cx) => compose(cx)?.nudge(5) },
	{ id: 'build.rotateRight', title: 'Rotate 5° Clockwise', section: 'Build', shortcut: '⇧→', keywords: 'turn angle nudge', isEnabled: hasPieces, run: (cx) => compose(cx)?.nudge(-5) },

	// MARK: - Design
	{ id: 'design.editInBlender', title: 'Edit in Blender', section: 'Design', keywords: 'open blender window', isEnabled: hasBlender, run: (cx) => void cx.design.openInBlender() },
	{ id: 'design.renderPreview', title: 'Render Preview', section: 'Design', keywords: 'refresh update eevee playhead', isEnabled: hasBlender, run: (cx) => cx.design.requestPreview(0) },
	{
		id: 'design.addText',
		title: 'Add Wall Text',
		section: 'Design',
		keywords: 'title label type decal',
		isEnabled: inDesign,
		isChecked: (cx) => cx.design.$placing.get() === 'text',
		run: (cx) => {
			// With a preview the next click places the text; without one it goes to the middle of the frame
			if (cx.design.$preview.get() != null) cx.design.$placing.set(cx.design.$placing.get() === 'text' ? null : 'text');
			else cx.placeWallText();
		}
	},
	{
		id: 'design.askAgent',
		title: 'Ask Agent…',
		section: 'Design',
		keywords: 'ai claude codex generate skin describe',
		isEnabled: inDesign,
		run: (cx) => {
			cx.$panels.set((panels) => ({ ...panels, inspector: true }));
			requestAnimationFrame(() => document.getElementById('agent-prompt')?.focus());
		}
	},
	{
		id: 'design.resetToCompose',
		title: 'Reset to Compose',
		section: 'Design',
		keywords: 'relink linked detached discard blender changes',
		isEnabled: (cx) => hasBlender(cx) && unlinkedSelection(cx).length > 0,
		run: (cx) => void cx.design.relink(unlinkedSelection(cx))
	},
	{
		id: 'design.regenerateCamera',
		title: 'Regenerate Camera',
		section: 'Design',
		keywords: 'rig follow camera taken over reset',
		isEnabled: (cx) => hasBlender(cx) && cx.design.$camera.get() === 'takenOver',
		run: (cx) => void cx.design.regenerateCamera()
	},
	{
		id: 'camera.addShot',
		title: 'Add Shot Marker',
		section: 'Design',
		shortcut: '⇧M',
		keywords: 'camera shot marker push in wide close up roll',
		isEnabled: inDesign,
		run: (cx) => {
			const project = cx.project;
			if (project == null) return;
			const { commands: shotCommands, shotId } = addShotCommands(project, cx.$playhead.get());
			if (cx.execute(shotCommands)) cx.$selection.set([toShotKey(shotId)]);
		}
	},
	themeCommand('design.themePegboard', 'pegboard', 'Pegboard Theme'),
	themeCommand('design.themeBrass', 'brass', 'Brass Theme'),
	presetCommand('design.presetDraft', 'draft', 'Draft Render Preset'),
	presetCommand('design.presetFast', 'fast', 'Fast Render Preset'),
	presetCommand('design.presetBalanced', 'balanced', 'Balanced Render Preset'),
	presetCommand('design.presetBest', 'best', 'Best Render Preset'),
	{
		id: 'design.loop',
		title: 'Loop',
		section: 'Design',
		keywords: 'seamless repeat',
		isEnabled: hasProject,
		isChecked: (cx) => cx.project?.design.loop === true,
		run: (cx) => cx.execute([{ type: 'setDesign', design: { loop: cx.project?.design.loop !== true } }])
	},
	{ id: 'design.cancelExport', title: 'Cancel Export', section: 'Design', keywords: 'stop render film', isEnabled: (cx) => cx.film.isRunning, run: (cx) => cx.film.cancel() },

	// MARK: - Marble
	{ id: 'marble.add', title: 'Add Marble', section: 'Marble', keywords: 'lane track new', isEnabled: hasProject, run: (cx) => void cx.addMarble() },
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
	| 'file.replaceSong'
	| 'file.removeSong'
	| 'file.export'
	| 'design.editInBlender'
	| 'design.renderPreview'
	| 'design.addText'
	| 'design.askAgent'
	| 'design.resetToCompose'
	| 'design.regenerateCamera'
	| 'camera.addShot'
	| 'design.themePegboard'
	| 'design.themeBrass'
	| TPresetCommandId
	| 'design.loop'
	| 'design.cancelExport'
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
	| 'view.agent'
	| 'view.zoomIn'
	| 'view.zoomOut'
	| 'view.fitAll'
	| 'view.fitSelection'
	| 'view.fitFrame'
	| 'view.wall'
	| 'view.orbit'
	| 'view.camera'
	| 'play.toggle'
	| 'play.start'
	| 'play.previousHit'
	| 'play.nextHit'
	| 'play.tap'
	| 'tool.select'
	| 'tool.hand'
	| 'tool.marble'
	| 'tool.path'
	| 'tool.text'
	| 'tool.asset'
	| 'view.snap'
	| 'build.next'
	| 'build.repeat'
	| 'build.mirror'
	| 'build.autoPlace'
	| 'build.continue'
	| 'build.dismiss'
	| 'build.rotateLeft'
	| 'build.rotateRight'
	| 'marble.add'
	| 'marble.mute'
	| 'marble.solo'
	| 'tool.platform'
	| 'tool.tunnel'
	| 'tool.windmill'
	| 'tool.switchback'
	| 'tool.insert';

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

/** Deletes the selected hits, or in Design the selected shot markers */
export function deleteSelectedHits(cx: StudioCx): boolean {
	const project = cx.project;
	if (project == null) return false;
	const shotIds = selectedShotIds(cx);
	if (inDesign(cx) && shotIds.length > 0) {
		const applied = cx.execute(removeShotsCommands(project, shotIds));
		if (applied) cx.$selection.set([]);
		return applied;
	}
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
