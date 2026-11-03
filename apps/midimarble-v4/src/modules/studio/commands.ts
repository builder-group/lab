import type { TMenuItem } from '@/components';
import type { ComposeCx } from '@/modules/compose/ComposeCx';
import { toolKeys, tunnelPathKey, type TComposeTool } from '@/modules/compose/keys';
import { selectedPieceIds } from '@/modules/compose/step-loop';
import type { TRenderPreset } from '@/modules/blender';
import { themeCommands } from '@/modules/design/design-commands';
import { addShotCommands, removeShotsCommands } from '@/modules/design/shots';
import { parseHitKey, parseShotKey, toShotKey } from './selection';
import { setSidebarTab } from './sidebar-state';
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
	/** Kept for menus that still name it, left out of the palette because another command does the same */
	isHidden?: boolean;
	isEnabled?: (cx: StudioCx) => boolean;
	isChecked?: (cx: StudioCx) => boolean;
	run: (cx: StudioCx) => void;
}

export type TCommandSection = 'File' | 'Edit' | 'View' | 'Playback' | 'Tools' | 'Pieces' | 'Marble' | 'Film' | 'Help';

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

/** Whether Blender runs for the Film workspace; false in the browser and without Blender */
function hasBlender(cx: StudioCx): boolean {
	const status = cx.design.$status.get();
	return inDesign(cx) && status !== 'unavailable' && status !== 'missing';
}

/** Whether Blender can run for the open project, in either workspace */
function canRunBlender(cx: StudioCx): boolean {
	const status = cx.design.$status.get();
	return cx.project != null && status !== 'unavailable' && status !== 'missing';
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
		section: 'Film',
		keywords: preset === 'draft' ? 'render preset export workbench quick preview motion timing' : 'render preset export eevee cycles',
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
		section: 'Film',
		keywords: 'look style art direction design',
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
	{ id: 'file.new', title: 'New Project', section: 'File', shortcut: '⌘N', run: (cx) => void cx.newProject() },
	{ id: 'file.open', title: 'Open Project…', section: 'File', shortcut: '⌘O', run: (cx) => void cx.openProject() },
	{ id: 'file.close', title: 'Close Project', section: 'File', isEnabled: hasProject, run: (cx) => void cx.closeProject() },
	{ id: 'file.save', title: 'Save', section: 'File', shortcut: '⌘S', keywords: 'keep unsaved example', isEnabled: hasProject, run: (cx) => void cx.save() },
	{ id: 'file.importMidi', title: 'Import Song…', section: 'File', shortcut: '⌘I', keywords: 'midi recording audio wav mp3 music', isEnabled: hasProject, run: (cx) => void cx.importSong() },
	{ id: 'file.importAudio', title: 'Import Song…', section: 'File', isHidden: true, isEnabled: hasProject, run: (cx) => void cx.importSong() },
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
	{ id: 'view.design', title: 'Film', section: 'View', shortcut: '⌘2', keywords: 'workspace blender design look export', isChecked: (cx) => cx.$workspace.get() === 'design', run: (cx) => cx.$workspace.set('design') },
	{ id: 'view.sidebar', title: 'Sidebar', section: 'View', shortcut: '⌃⌘S', keywords: 'outliner panel', isChecked: (cx) => cx.$panels.get().sidebar, run: (cx) => cx.togglePanel('sidebar') },
	{ id: 'view.inspector', title: 'Inspector', section: 'View', shortcut: '⌃⌘I', keywords: 'properties panel', isChecked: (cx) => cx.$panels.get().inspector, run: (cx) => cx.togglePanel('inspector') },
	{ id: 'view.timeline', title: 'Timeline', section: 'View', shortcut: '⌃⌘T', keywords: 'tracks dope sheet panel', isChecked: (cx) => cx.$panels.get().timeline, run: (cx) => cx.togglePanel('timeline') },
	{ id: 'view.agent', title: 'Agent', section: 'View', shortcut: '⌘J', keywords: 'chat ai assistant claude codex ask', isEnabled: hasProject, isChecked: (cx) => cx.$panels.get().agent, run: (cx) => cx.togglePanel('agent') },
	{ id: 'view.zoomIn', title: 'Zoom In', section: 'View', shortcut: '⌘+', isEnabled: (cx) => compose(cx) != null, run: (cx) => compose(cx)?.zoomBy(2) },
	{ id: 'view.zoomOut', title: 'Zoom Out', section: 'View', shortcut: '⌘−', isEnabled: (cx) => compose(cx) != null, run: (cx) => compose(cx)?.zoomBy(0.5) },
	{ id: 'view.fitAll', title: 'Zoom to Fit', section: 'View', shortcut: '⇧1', keywords: 'frame all home view all', isEnabled: (cx) => compose(cx) != null, run: (cx) => compose(cx)?.fitAll() },
	{ id: 'view.fitFrame', title: 'Zoom to Film Frame', section: 'View', shortcut: '⇧3', keywords: 'frame film width follow marble', isEnabled: (cx) => compose(cx) != null, run: (cx) => compose(cx)?.fitFrame() },
	{ id: 'view.fitSelection', title: 'Zoom to Selection', section: 'View', shortcut: '⇧2', keywords: 'frame selected', isEnabled: hasPieces, run: (cx) => compose(cx)?.fitSelection() },
	{
		id: 'view.snap',
		title: 'Snap',
		section: 'View',
		keywords: 'magnet snapping dots trajectories plays follows attach',
		isChecked: (cx) => cx.$snapping.get(),
		run: (cx) => cx.$snapping.set(!cx.$snapping.get())
	},
	{ id: 'view.wall', title: 'Wall View', section: 'View', keywords: '2d front', isEnabled: (cx) => compose(cx) != null, isChecked: (cx) => compose(cx)?.$camera.get().mode === '2d', run: (cx) => compose(cx)?.setMode('2d') },
	{ id: 'view.orbit', title: 'Orbit View', section: 'View', keywords: '3d perspective', isEnabled: (cx) => compose(cx) != null, isChecked: (cx) => compose(cx)?.$camera.get().mode === 'orbit', run: (cx) => compose(cx)?.setMode('orbit') },
	{ id: 'view.camera', title: 'Preview Film Camera', section: 'View', shortcut: '0', keywords: 'camera view follow viewfinder numpad', isEnabled: (cx) => compose(cx) != null, isChecked: (cx) => compose(cx)?.$camera.get().mode === 'camera', run: (cx) => compose(cx)?.toggleCameraView() },

	// MARK: - Playback
	{ id: 'play.toggle', title: 'Play', section: 'Playback', shortcut: 'Space', keywords: 'pause stop', isEnabled: hasProject, run: (cx) => cx.$playing.set(!cx.$playing.get()) },
	{ id: 'play.start', title: 'Go to Beginning', section: 'Playback', shortcut: '↩', keywords: 'rewind start', isEnabled: hasProject, run: (cx) => cx.$playhead.set(0) },
	{ id: 'play.previousHit', title: 'Previous Hit', section: 'Playback', shortcut: '←', keywords: 'jump keyframe', isEnabled: hasProject, run: (cx) => cx.stepHit(-1) },
	{ id: 'play.nextHit', title: 'Next Hit', section: 'Playback', shortcut: '→', keywords: 'jump keyframe', isEnabled: hasProject, run: (cx) => cx.stepHit(1) },
	{ id: 'play.tap', title: 'Tap Hit at Playhead', section: 'Playback', shortcut: 'T', keywords: 'record tap along', isEnabled: hasProject, run: (cx) => cx.tapHit() },

	// MARK: - Tools
	toolCommand('select', 'Move Tool', 'select pointer arrow'),
	toolCommand('hand', 'Hand Tool', 'pan'),
	toolCommand('marble', 'Marble Tool', 'add marble release track ball'),
	toolCommand('platform', 'Platform Tool', 'piece add place bar'),
	toolCommand('path', 'Path Tool', 'rail pen bezier spline curve draw'),
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
		title: 'Title Tool',
		section: 'Film',
		shortcut: 'T',
		keywords: 'wall text label credit type',
		isEnabled: inDesign,
		isChecked: (cx) => cx.design.$placing.get() === 'text',
		run: (cx) => getCommand('design.addText').run(cx)
	},
	{
		id: 'tool.asset',
		title: 'Show Library',
		section: 'Film',
		keywords: 'skin decoration theme asset',
		isEnabled: inDesign,
		run: (cx) => {
			cx.$panels.set((panels) => ({ ...panels, sidebar: true }));
			setSidebarTab('design', 'library');
			requestAnimationFrame(() => document.getElementById('library-search')?.focus());
		}
	},

	// MARK: - Pieces
	{ id: 'build.next', title: 'Place Next Platform', section: 'Pieces', shortcut: 'N', keywords: 'add step assist', isEnabled: (cx) => compose(cx) != null, run: (cx) => compose(cx)?.next() },
	{ id: 'build.repeat', title: 'Repeat Last Platform', section: 'Pieces', shortcut: 'R', keywords: 'copy same tilt assist', isEnabled: (cx) => compose(cx) != null, run: (cx) => compose(cx)?.step('repeat') },
	{ id: 'build.mirror', title: 'Mirror Last Platform', section: 'Pieces', shortcut: 'M', keywords: 'zigzag flip tilt assist', isEnabled: (cx) => compose(cx) != null, run: (cx) => compose(cx)?.step('mirror') },
	{
		id: 'build.autoPlace',
		title: 'Add Platform',
		section: 'Pieces',
		shortcut: 'A',
		keywords: 'auto place solve angle tilt on time assist',
		isEnabled: (cx) => compose(cx) != null,
		run: (cx) => {
			const canvas = compose(cx);
			canvas?.assist.autoPlace(canvas.placementType());
		}
	},
	{ id: 'build.continue', title: 'Continue Pattern', section: 'Pieces', shortcut: '⇥', keywords: 'accept ghosts suggestions repeat tab assist', isEnabled: (cx) => compose(cx)?.assist.hasGhosts === true, run: (cx) => compose(cx)?.assist.acceptGhosts() },
	{ id: 'build.dismiss', title: 'Dismiss Suggestions', section: 'Pieces', shortcut: '⎋', keywords: 'ghosts escape', isEnabled: (cx) => compose(cx)?.assist.hasGhosts === true, run: (cx) => compose(cx)?.assist.dismiss() },
	{ id: 'build.rotateLeft', title: 'Rotate 5° Counterclockwise', section: 'Pieces', shortcut: '⇧←', keywords: 'turn angle nudge', isEnabled: hasPieces, run: (cx) => compose(cx)?.nudge(5) },
	{ id: 'build.rotateRight', title: 'Rotate 5° Clockwise', section: 'Pieces', shortcut: '⇧→', keywords: 'turn angle nudge', isEnabled: hasPieces, run: (cx) => compose(cx)?.nudge(-5) },

	// MARK: - Film
	{ id: 'design.editInBlender', title: 'Open in Blender', section: 'Film', keywords: 'edit blender window scene', isEnabled: canRunBlender, run: (cx) => void cx.design.openInBlender() },
	{ id: 'design.restartBlender', title: 'Restart Blender', section: 'Film', keywords: 'blender reconnect stuck error', isEnabled: canRunBlender, run: (cx) => void cx.design.restart() },
	{ id: 'design.renderPreview', title: 'Refresh Preview', section: 'Film', keywords: 'render update eevee playhead', isEnabled: hasBlender, run: (cx) => cx.design.requestPreview(0) },
	{
		id: 'design.addText',
		title: 'Add Title',
		section: 'Film',
		keywords: 'wall text label credit type decal',
		isEnabled: inDesign,
		isChecked: (cx) => cx.design.$placing.get() === 'text',
		run: (cx) => {
			// The next click on the Blender preview or the Draft Preview places the title
			cx.design.$placing.set(cx.design.$placing.get() === 'text' ? null : 'text');
		}
	},
	{
		id: 'design.askAgent',
		title: 'Ask Agent…',
		section: 'Film',
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
		section: 'Film',
		keywords: 'relink linked detached discard blender changes',
		isEnabled: (cx) => hasBlender(cx) && unlinkedSelection(cx).length > 0,
		run: (cx) => void cx.design.relink(unlinkedSelection(cx))
	},
	{
		id: 'design.regenerateCamera',
		title: 'Regenerate Camera',
		section: 'Film',
		keywords: 'rig follow camera taken over reset',
		isEnabled: (cx) => hasBlender(cx) && cx.design.$camera.get() === 'takenOver',
		run: (cx) => void cx.design.regenerateCamera()
	},
	{
		id: 'camera.addShot',
		title: 'Add Shot',
		section: 'Film',
		shortcut: '⇧M',
		keywords: 'camera marker keyframe push in wide follow close up roll',
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
	presetCommand('design.presetDraft', 'draft', 'Draft Quality'),
	presetCommand('design.presetFast', 'fast', 'Standard Quality'),
	presetCommand('design.presetBalanced', 'balanced', 'High Quality'),
	presetCommand('design.presetBest', 'best', 'Best Quality'),
	{
		id: 'design.loop',
		title: 'Seamless Loop',
		section: 'Film',
		keywords: 'repeat loop',
		isEnabled: hasProject,
		isChecked: (cx) => cx.project?.design.loop === true,
		run: (cx) => cx.execute([{ type: 'setDesign', design: { loop: cx.project?.design.loop !== true } }])
	},
	{ id: 'design.cancelExport', title: 'Cancel Export', section: 'Film', keywords: 'stop render film', isEnabled: (cx) => cx.film.isRunning, run: (cx) => cx.film.cancel() },

	// MARK: - Marble
	{ id: 'marble.add', title: 'Add Marble', section: 'Marble', keywords: 'track new ball', isEnabled: hasProject, run: (cx) => void cx.addMarble() },
	{
		id: 'marble.mute',
		title: 'Mute Marble',
		section: 'Marble',
		keywords: 'silence track',
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
		keywords: 'track',
		isEnabled: (cx) => focusedLaneId(cx) != null,
		isChecked: (cx) => cx.$mix.get().solo.includes(focusedLaneId(cx) ?? ''),
		run: (cx) => {
			const laneId = focusedLaneId(cx);
			if (laneId != null) cx.toggleSolo(laneId);
		}
	},

	// MARK: - Help
	{
		id: 'help.quickHelp',
		title: 'Quick Help',
		section: 'Help',
		shortcut: '⇧⌘/',
		keywords: 'explain regions tooltip beginner what is this',
		isEnabled: hasProject,
		isChecked: (cx) => cx.$quickHelp.get(),
		run: (cx) => cx.$quickHelp.set(!cx.$quickHelp.get())
	},
	{ id: 'help.resetHints', title: 'Reset Hints', section: 'Help', keywords: 'tips onboarding beginner show again first run', run: (cx) => cx.hints.reset() }
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
	| 'design.restartBlender'
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
	| 'tool.insert'
	| 'help.quickHelp'
	| 'help.resetHints';

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

/** Deletes the selected hits, or in Film the selected shots */
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
