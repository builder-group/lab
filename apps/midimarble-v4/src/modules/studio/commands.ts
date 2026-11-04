import { onNextFrame } from './next-frame';
import { removeSelectedHits } from './timeline/hand-notes';
import { $rollHasFocus } from './timeline/timeline-state';
import type { TMenuItem } from '@/components';
import { lanesWithoutFinish } from '@/modules/compose/finish-assist';
import { newProjectTitle } from '@/environment';
import type { ComposeCx } from '@/modules/compose/ComposeCx';
import { followKey, toolKeys, tunnelPathKey, type TComposeTool } from '@/modules/compose/keys';
import { canMakeBacking } from '@/modules/compose/reachability';
import { selectedPieceIds } from '@/modules/compose/step-loop';
import { armPlayNote, canFollow, canPlayNote, detachSelection, hasTiedSelection, openFollowMenu } from '@/modules/compose/tie-commands';
import type { TRenderPreset } from '@/modules/blender';
import { BACKING_ID, type TProject } from '@/modules/project';
import { isSuperseded, soundsHit, type TSimulationResult } from '@/modules/simulation';
import { cameraCommands, themeCommands } from '@/modules/design/design-commands';
import { NEW_THEME_PROMPT } from '@/modules/design/DesignLibraryCx';
import { deleteThemeCommands, resolveTheme } from '@/modules/design/project-themes';
import { saveAsTheme } from '@/modules/design/SkinProperties';
import { framingFix, framingProblemAt, preflightExport, type TPreflightFix } from '@/modules/design/export-preflight';
import { deleteDecorCommands, duplicateDecorCommands, selectedDecorIds } from '@/modules/design/decor';
import { openScatterPanel } from '@/modules/design/decor-actions';
import { addLightCommands, deleteLightsCommands } from '@/modules/design/scene-layers';
import { addShotCommands, removeShotsCommands } from '@/modules/design/shots';
import { shownCycle } from './cycle';
import { duplicateClear, type TClearDuplicate } from './duplicate';
import { KEY_LIGHT_ID, parseHitKey, parseLightKey, parseShotKey, SONG_KEY, toDecorKey, toHitKey, toLightKey, toShotKey } from './selection';
import { hasSongLayer } from './song-layer';
import { handNotes } from './timeline/hand-notes';
import type { StudioCx, TWorkspace } from './StudioCx';

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
	/**
	 * The workspace the command acts in when its section does not say it, such as the Compose canvas's zoom.
	 * Tools and Pieces belong to Compose and Film to Film; the rest work in both.
	 */
	workspace?: TWorkspace;
	isEnabled?: (cx: StudioCx) => boolean;
	isChecked?: (cx: StudioCx) => boolean;
	run: (cx: StudioCx) => void;
}

export type TCommandSection = 'File' | 'Edit' | 'View' | 'Playback' | 'Tools' | 'Track' | 'Marble' | 'Film' | 'Help';

function compose(cx: StudioCx): ComposeCx | null {
	return cx.$workspace.get() === 'compose' ? cx.$compose.get() : null;
}

function hasProject(cx: StudioCx): boolean {
	return cx.project != null;
}

function canSave(cx: StudioCx): boolean {
	const state = cx.$save.get();
	return cx.project != null && (cx.$isTemporary.get() || state === 'dirty' || state === 'failed');
}

function hasSong(cx: StudioCx): boolean {
	return cx.project != null && hasSongLayer(cx.project);
}

/** Whether the Song layer is selected, in Layers or in the timeline */
function isSongSelected(cx: StudioCx): boolean {
	return hasSong(cx) && cx.$selection.get().includes(SONG_KEY);
}

/** Added lights in the selection; the Key Light can't be deleted */
function selectedLightIds(cx: StudioCx): string[] {
	return cx.$selection.get().flatMap((key) => {
		const id = parseLightKey(key);
		return id != null && id !== KEY_LIGHT_ID ? [id] : [];
	});
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

function themeCommand(id: 'design.themePegboard' | 'design.themeBrass' | 'design.themeNeon', theme: string, title: string): TCommand {
	return {
		id,
		title,
		section: 'Film',
		keywords: 'look style preset art direction design',
		isEnabled: hasProject,
		isChecked: (cx) => cx.project?.design.theme === theme,
		run: (cx) => {
			const project = cx.project;
			if (project != null) cx.execute(themeCommands(project, theme));
		}
	};
}

/** Delete Theme for a project theme; the film falls back to its base when it uses it */
export function deleteTheme(cx: StudioCx, themeId: string): void {
	const project = cx.project;
	if (project == null) return;
	const theme = resolveTheme(project.design, themeId);
	if (theme.projectTheme == null || !cx.execute(deleteThemeCommands(project, themeId))) return;
	const base = resolveTheme(project.design, theme.base).name;
	cx.notifyEdit(project.design.theme === themeId ? `${theme.name} deleted; the film uses ${base} again` : `${theme.name} deleted`);
}

function hasPieces(cx: StudioCx): boolean {
	const project = cx.project;
	return project != null && compose(cx) != null && selectedPieceIds(project, cx.$selection.get()).length > 0;
}

let isDuplicating = false;

/**
 * Duplicate for the selected pieces: free copies clear of every marble's path, selected afterwards, as one undo step.
 * The spot is checked with what-if runs first, so a copy never breaks a hit; a newer edit in the meantime wins.
 */
async function duplicateSelection(cx: StudioCx): Promise<void> {
	const project = cx.project;
	if (project == null || isDuplicating) return;
	const decorIds = inDesign(cx) ? selectedDecorIds(cx.$selection.get()) : [];
	if (decorIds.length > 0) {
		const copies = duplicateDecorCommands(project, decorIds);
		if (cx.execute(copies.commands)) cx.$selection.set(copies.decorIds.map(toDecorKey));
		return;
	}
	const ids = selectedPieceIds(project, cx.$selection.get());
	const client = cx.simulation.assists;
	isDuplicating = true;
	const simulate = async (trial: TProject, retries = 3): Promise<TSimulationResult> => {
		// A newer what-if of another assist may replace this one while it waits
		try {
			return await (client as NonNullable<typeof client>).simulateAssist(trial);
		} catch (error) {
			if (retries > 0 && isSuperseded(error)) return simulate(trial, retries - 1);
			throw error;
		}
	};
	let placed: TClearDuplicate;
	try {
		placed = await duplicateClear(project, cx.simulation.$result.get(), ids, client != null ? simulate : null);
	} catch (error) {
		cx.notify(`Duplicate failed, so nothing changed: ${(error as Error).message}`, 'error');
		return;
	} finally {
		isDuplicating = false;
	}
	if (cx.project !== project) return;
	const original = project.entities.find((entity) => entity.id === ids[0]);
	if (placed.spot === 'refused') {
		const breaks = placed.breaks === 1 ? 'a hit' : `${placed.breaks} hits`;
		cx.notify(`Every spot for a copy of ${original?.name ?? 'this piece'} would break ${breaks}, so nothing changed`);
		return;
	}
	if (!placed.copies.length) {
		cx.notify('These track pieces have no place on the track yet, so there is nothing to copy');
		return;
	}
	if (!cx.execute(placed.commands)) return;
	const named = cx.project?.entities.filter((entity) => placed.copies.some((copy) => copy.id === entity.id)) ?? placed.copies;
	cx.$selection.set(named.map((entity) => entity.id));
	const tied = ids.some((id) => project.entities.find((entity) => entity.id === id)?.components.hitLink != null);
	const what = named.length === 1 ? `${original?.name ?? 'The piece'} duplicated as ${named[0]?.name ?? 'a copy'}` : `${named.length} pieces duplicated`;
	const where = placed.spot === 'beside the run' ? ', beside the run: no free spot near it' : '';
	cx.notifyEdit(`${what}${tied ? ', tied to nothing' : ''}${where}`);
}

/** The notes Make Backing hands over: selected notes and hits, and the notes the selected platforms play */
function backingKeys(cx: StudioCx): string[] {
	const project = cx.project;
	if (project == null) return [];
	const selection = cx.$selection.get();
	const hits = selection.filter((key) => {
		const parsed = parseHitKey(key);
		return parsed != null && parsed.laneId !== BACKING_ID;
	});
	const played = project.entities.flatMap((entity) => {
		const link = entity.components.hitLink;
		return selection.includes(entity.id) && link != null && soundsHit(entity.components.piece?.type ?? '', link) ? [toHitKey(link.laneId, link.hitId)] : [];
	});
	return [...new Set([...hits, ...played])];
}

function hasHits(cx: StudioCx): boolean {
	return cx.$selection.get().some((key) => parseHitKey(key) != null);
}

/** Add Wide Shot Here of the framing problem at the playhead, once the problem model's what-if found it works */
function wideShotFix(cx: StudioCx): TPreflightFix | null {
	const project = cx.project;
	if (project == null) return null;
	const result = cx.simulation.$result.get();
	const issue = framingProblemAt(preflightExport(project, result), cx.$playhead.get());
	return issue != null ? framingFix(project, result, issue) : null;
}

function selectedShotIds(cx: StudioCx): string[] {
	return cx.$selection.get().flatMap((key) => parseShotKey(key) ?? []);
}

/**
 * The marble Add Finish works on: the selected marble's (or the selected piece's), else the first marble that plays
 * last and has no Finish yet; null when there is none
 */
function finishLane(cx: StudioCx): string | null {
	const project = cx.project;
	if (project == null) return null;
	const selected = cx.$selection.get().flatMap((id) => {
		const entity = project.entities.find((item) => item.id === id);
		const laneId = entity?.components.marble?.laneId ?? entity?.components.hitLink?.laneId;
		return laneId != null ? [laneId] : [];
	});
	const lane = selected[0];
	if (lane != null && project.music.lanes.some((item) => item.id === lane && item.hits.length > 0)) return lane;
	return lanesWithoutFinish(project)[0] ?? null;
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
	{ id: 'file.new', title: newProjectTitle(), section: 'File', shortcut: '⌘N', run: (cx) => void cx.newProject() },
	{ id: 'file.open', title: 'Open Project…', section: 'File', shortcut: '⌘O', run: (cx) => void cx.openProject() },
	{ id: 'file.close', title: 'Close Project', section: 'File', shortcut: '⌘W', isEnabled: hasProject, run: (cx) => void cx.closeProject() },
	// A saved project autosaves, so Save is there only while an edit waits, a save failed or the project is unsaved
	{ id: 'file.save', title: 'Save', section: 'File', shortcut: '⌘S', keywords: 'keep unsaved example', isEnabled: canSave, run: (cx) => void cx.save() },
	{ id: 'file.saveAs', title: 'Save As…', section: 'File', shortcut: '⇧⌘S', keywords: 'copy duplicate keep elsewhere', isEnabled: hasProject, run: (cx) => void cx.saveAs() },
	{ id: 'file.importMidi', title: 'Import Song…', section: 'File', shortcut: '⌘I', keywords: 'midi recording audio wav mp3 music', isEnabled: hasProject, run: (cx) => void cx.importSong() },
	{ id: 'file.importAudio', title: 'Import Song…', section: 'File', isHidden: true, isEnabled: hasProject, run: (cx) => void cx.importSong() },
	{ id: 'file.replaceSong', title: 'Replace Song…', section: 'File', keywords: 'music midi audio soundtrack', isEnabled: hasSong, run: (cx) => void cx.sources.replaceSong() },
	{ id: 'file.removeSong', title: 'Delete Song', section: 'File', keywords: 'music midi audio soundtrack remove backing', isEnabled: hasSong, run: (cx) => void cx.sources.deleteSong() },
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
		isEnabled: (cx) => hasPieces(cx) || hasHits(cx) || (inDesign(cx) && (selectedShotIds(cx).length > 0 || selectedLightIds(cx).length > 0 || selectedDecorIds(cx.$selection.get()).length > 0 || selectedTitleIds(cx).length > 0)) || isSongSelected(cx),
		run: (cx) => {
			// The Song layer alone deletes the song file and Backing; the marbles keep their hits
			if (isSongSelected(cx) && cx.$selection.get().length === 1) {
				void cx.sources.deleteSong();
				return;
			}
			if (compose(cx)?.deleteSelection() === true) return;
			deleteSelectedHits(cx);
		}
	},
	{ id: 'edit.duplicate', title: 'Duplicate', section: 'Edit', shortcut: '⌘D', keywords: 'copy clone', isEnabled: (cx) => hasPieces(cx) || (inDesign(cx) && selectedDecorIds(cx.$selection.get()).length > 0), run: (cx) => void duplicateSelection(cx) },
	{
		id: 'edit.selectAll', workspace: 'compose',
		title: 'Select All Track Pieces',
		section: 'Edit',
		shortcut: '⌘A',
		isEnabled: (cx) => compose(cx) != null,
		run: (cx) => cx.$selection.set(cx.project?.entities.filter((entity) => entity.components.piece != null).map((entity) => entity.id) ?? [])
	},
	{ id: 'edit.deselect', title: 'Select Scene', section: 'Edit', keywords: 'deselect none project length speed theme', isEnabled: (cx) => cx.$selection.get().length > 0, run: (cx) => cx.$selection.set([]) },
	{
		id: 'edit.makeBacking',
		title: 'Make Backing',
		section: 'Edit',
		shortcut: '0',
		keywords: 'backing track no platform hand notes unassign',
		isEnabled: (cx) => cx.project != null && canMakeBacking(cx.project) && backingKeys(cx).length > 0,
		run: (cx) => void handNotes(cx, backingKeys(cx), BACKING_ID)
	},
	{ id: 'edit.firstProblem', title: 'Show First Problem', section: 'Edit', keywords: 'issue error attention broken next jump hit summary', isEnabled: hasProject, run: (cx) => cx.showFirstProblem() },

	// MARK: - View
	{ id: 'view.compose', title: 'Compose', section: 'View', shortcut: '⌘1', keywords: 'workspace', isChecked: (cx) => cx.$workspace.get() === 'compose', run: (cx) => cx.$workspace.set('compose') },
	{ id: 'view.design', title: 'Film', section: 'View', shortcut: '⌘2', keywords: 'workspace blender design look export', isChecked: (cx) => cx.$workspace.get() === 'design', run: (cx) => cx.$workspace.set('design') },
	{ id: 'view.sidebar', title: 'Sidebar', section: 'View', shortcut: '⌃⌘S', keywords: 'outliner panel', isChecked: (cx) => cx.$panels.get().sidebar, run: (cx) => cx.togglePanel('sidebar') },
	{ id: 'view.inspector', title: 'Inspector', section: 'View', shortcut: '⌃⌘I', keywords: 'properties panel', isChecked: (cx) => cx.$panels.get().inspector, run: (cx) => cx.togglePanel('inspector') },
	{ id: 'view.timeline', title: 'Timeline', section: 'View', shortcut: '⌃⌘T', keywords: 'tracks dope sheet panel', isChecked: (cx) => cx.$panels.get().timeline, run: (cx) => cx.togglePanel('timeline') },
	{ id: 'view.agent', title: 'Agent', section: 'View', shortcut: '⌘J', keywords: 'chat ai assistant claude codex ask', isEnabled: hasProject, isChecked: (cx) => cx.$panels.get().agent, run: (cx) => cx.togglePanel('agent') },
	{ id: 'view.zoomIn', workspace: 'compose', title: 'Zoom In', section: 'View', shortcut: '⌘+', isEnabled: (cx) => compose(cx) != null, run: (cx) => compose(cx)?.zoomBy(2) },
	{ id: 'view.zoomOut', workspace: 'compose', title: 'Zoom Out', section: 'View', shortcut: '⌘−', isEnabled: (cx) => compose(cx) != null, run: (cx) => compose(cx)?.zoomBy(0.5) },
	{ id: 'view.zoom100', workspace: 'compose', title: 'Zoom to 100%', section: 'View', shortcut: '⌘0', keywords: 'actual size reset real', isEnabled: (cx) => compose(cx) != null, run: (cx) => compose(cx)?.zoomTo100() },
	{ id: 'view.fitAll', workspace: 'compose', title: 'Zoom to Fit', section: 'View', shortcut: '⇧1', keywords: 'frame all home view all playhead section', isEnabled: (cx) => compose(cx) != null, run: (cx) => compose(cx)?.fitAll() },
	{ id: 'view.fitWhole', workspace: 'compose', title: 'Zoom to Whole Run', section: 'View', keywords: 'frame all overview everything long', isEnabled: (cx) => compose(cx) != null, run: (cx) => compose(cx)?.fitWholeRun() },
	{ id: 'view.fitFrame', workspace: 'compose', title: 'Zoom to Film Frame', section: 'View', shortcut: '⇧3', keywords: 'frame film width follow marble', isEnabled: (cx) => compose(cx) != null, run: (cx) => compose(cx)?.fitFrame() },
	{ id: 'view.fitSelection', workspace: 'compose', title: 'Zoom to Selection', section: 'View', shortcut: '⇧2', keywords: 'frame selected', isEnabled: hasPieces, run: (cx) => compose(cx)?.fitSelection() },
	{
		id: 'view.snap',
		title: 'Snap',
		section: 'View',
		keywords: 'magnet snapping dots trajectories plays follows attach',
		isChecked: (cx) => cx.$snapping.get(),
		run: (cx) => cx.$snapping.set(!cx.$snapping.get())
	},
	{
		id: 'view.showHitboxes',
		workspace: 'design',
		title: 'Show Hitboxes',
		section: 'View',
		keywords: 'collider gizmo outline physics shape what the marble touches',
		isEnabled: inDesign,
		isChecked: (cx) => cx.$showHitboxes.get(),
		run: (cx) => cx.$showHitboxes.set(!cx.$showHitboxes.get())
	},
	{
		id: 'view.follow',
		workspace: 'compose',
		title: 'Follow Marble in View',
		section: 'View',
		shortcut: followKey.key,
		keywords: 'catch playhead autoscroll track scroll keep in view playback',
		isEnabled: (cx) => compose(cx) != null,
		isChecked: (cx) => compose(cx)?.$follow.get() === true,
		run: (cx) => compose(cx)?.toggleFollow()
	},

	// MARK: - Playback
	{ id: 'play.toggle', title: 'Play', section: 'Playback', shortcut: 'Space', keywords: 'pause stop', isEnabled: hasProject, run: (cx) => cx.$playing.set(!cx.$playing.get()) },
	{ id: 'play.start', title: 'Go to Beginning', section: 'Playback', shortcut: '↩', keywords: 'rewind start', isEnabled: hasProject, run: (cx) => cx.$playhead.set(0) },
	{ id: 'play.previousHit', title: 'Previous Hit', section: 'Playback', shortcut: '←', keywords: 'jump keyframe', isEnabled: hasProject, run: (cx) => cx.stepHit(-1) },
	{ id: 'play.nextHit', title: 'Next Hit', section: 'Playback', shortcut: '→', keywords: 'jump keyframe', isEnabled: hasProject, run: (cx) => cx.stepHit(1) },
	{ id: 'play.cycle', title: 'Repeat Range', section: 'Playback', shortcut: 'C', keywords: 'cycle loop repeat rehearse section range', isEnabled: hasProject, isChecked: (cx) => shownCycle(cx.$cycle.get(), cx.project?.id, cx.project?.end ?? 0)?.isOn === true, run: (cx) => cx.toggleCycle() },
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
	toolCommand('finish', 'Finish Tool', 'piece add end catch chute cup last note'),
	{
		id: 'tool.insert',
		title: 'Insert…',
		section: 'Tools',
		shortcut: '⇧I',
		keywords: 'library assets add piece windmill switchback rail tunnel title caption song name end card decor decoration ornament light shot',
		isEnabled: (cx) => compose(cx) != null || inDesign(cx),
		run: (cx) => {
			if (inDesign(cx)) cx.library.$insertOpen.set(true);
			else compose(cx)?.$libraryOpen.set(true);
		}
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

	// MARK: - Pieces
	{ id: 'build.next', title: 'Place Next Platform', section: 'Track', shortcut: 'N', keywords: 'add step assist', isEnabled: (cx) => compose(cx) != null, run: (cx) => compose(cx)?.next() },
	{
		id: 'build.track',
		title: 'Build Track',
		section: 'Track',
		shortcut: '⇧N',
		keywords: 'whole song all hits auto build everything finish solve assist',
		isEnabled: (cx) => compose(cx) != null && compose(cx)?.assist.isBuilding !== true && compose(cx)?.assist.hasOpenHits === true,
		run: (cx) => void compose(cx)?.assist.buildTrack()
	},
	{ id: 'build.stop', title: 'Stop Building Track', section: 'Track', keywords: 'cancel build track', isEnabled: (cx) => compose(cx)?.assist.isBuilding === true, run: (cx) => compose(cx)?.assist.stopBuild() },
	{ id: 'build.repeat', title: 'Repeat Last Platform', section: 'Track', shortcut: 'R', keywords: 'copy same tilt assist', isEnabled: (cx) => compose(cx) != null, run: (cx) => compose(cx)?.step('repeat') },
	{ id: 'build.mirror', title: 'Mirror Last Platform', section: 'Track', shortcut: 'M', keywords: 'zigzag flip tilt assist', isEnabled: (cx) => compose(cx) != null, run: (cx) => compose(cx)?.step('mirror') },
	{
		id: 'build.autoPlace',
		title: 'Add Platform',
		section: 'Track',
		shortcut: 'A',
		keywords: 'auto place solve angle tilt on time assist',
		isEnabled: (cx) => compose(cx) != null,
		run: (cx) => {
			const canvas = compose(cx);
			canvas?.assist.autoPlace(canvas.placementType());
		}
	},
	{ id: 'build.continue', title: 'Continue Pattern', section: 'Track', shortcut: '⇥', keywords: 'accept ghosts suggestions repeat tab assist', isEnabled: (cx) => compose(cx)?.assist.hasGhosts === true, run: (cx) => compose(cx)?.assist.acceptGhosts() },
	{
		id: 'build.replace',
		title: 'Re-place Broken Platforms',
		section: 'Track',
		keywords: 're-place replace fix repair blocked missed stopped broken move clear release',
		isEnabled: (cx) => compose(cx) != null && compose(cx)?.assist.isReplacing !== true,
		run: (cx) => void compose(cx)?.assist.replace()
	},
	{
		id: 'build.addFinish',
		title: 'Add Finish',
		section: 'Track',
		keywords: 'finish end catch chute cup last note ending tail',
		isEnabled: (cx) => compose(cx) != null && finishLane(cx) != null,
		run: (cx) => {
			const laneId = finishLane(cx);
			if (laneId != null) void compose(cx)?.assist.addFinish(laneId);
		}
	},
	{
		id: 'piece.playNote',
		title: 'Play a Note…',
		section: 'Track',
		keywords: 'link attach tie plays dot hit',
		isEnabled: (cx) => hasPieces(cx) && canPlayNote(cx),
		run: (cx) => {
			const current = compose(cx);
			if (current != null) armPlayNote(cx, current);
		}
	},
	{ id: 'piece.follow', title: 'Follow a Marble…', section: 'Track', keywords: 'anchor attach tie follows nearest marble', isEnabled: (cx) => hasPieces(cx) && canFollow(cx), run: (cx) => openFollowMenu(cx) },
	{ id: 'piece.detach', title: 'Detach', section: 'Track', keywords: 'unlink unanchor untie free none', isEnabled: (cx) => hasPieces(cx) && hasTiedSelection(cx), run: (cx) => detachSelection(cx) },
	{ id: 'build.dismiss', title: 'Dismiss Suggestions', section: 'Track', shortcut: '⎋', keywords: 'ghosts escape', isEnabled: (cx) => compose(cx)?.assist.hasGhosts === true, run: (cx) => compose(cx)?.assist.dismiss() },
	{ id: 'build.rotateLeft', title: 'Rotate 5° Counterclockwise', section: 'Track', shortcut: '⇧←', keywords: 'turn angle nudge', isEnabled: hasPieces, run: (cx) => compose(cx)?.nudge(5) },
	{ id: 'build.rotateRight', title: 'Rotate 5° Clockwise', section: 'Track', shortcut: '⇧→', keywords: 'turn angle nudge', isEnabled: hasPieces, run: (cx) => compose(cx)?.nudge(-5) },

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
		title: 'Discard Blender Changes',
		section: 'Film',
		keywords: 'reset to compose relink linked detached undo blender edits',
		isEnabled: (cx) => hasBlender(cx) && unlinkedSelection(cx).length > 0,
		run: (cx) => void cx.design.relink(unlinkedSelection(cx))
	},
	{
		id: 'design.regenerateCamera',
		title: 'Reset Camera',
		section: 'Film',
		keywords: 'regenerate rig follow automatic camera taken over discard blender changes',
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
	{
		id: 'decor.scatter',
		title: 'Scatter Decor…',
		section: 'Film',
		keywords: 'decoration bauble snowflake fill wall ornaments',
		isEnabled: hasProject,
		run: (cx) => openScatterPanel(cx)
	},
	{
		id: 'light.add',
		title: 'Add Light',
		section: 'Film',
		keywords: 'lamp sun fill lighting key',
		isEnabled: hasProject,
		run: (cx) => {
			const project = cx.project;
			if (project == null) return;
			cx.$workspace.set('design');
			const { commands, lightId } = addLightCommands(project);
			if (cx.execute(commands)) cx.$selection.set([toLightKey(lightId)]);
		}
	},
	{
		// The Fix-it of a framing problem at the playhead, found by a what-if of the camera with the shot
		id: 'camera.addWideShot',
		title: 'Add Wide Shot Here',
		section: 'Film',
		keywords: 'camera framing frame marble out leaves fix wide shot',
		isEnabled: (cx) => wideShotFix(cx) != null,
		run: (cx) => {
			const fix = wideShotFix(cx);
			if (fix == null) return;
			if (cx.execute(fix.commands) && fix.shotId != null) cx.$selection.set([toShotKey(fix.shotId)]);
		}
	},
	themeCommand('design.themePegboard', 'pegboard', 'Pegboard Theme'),
	themeCommand('design.themeBrass', 'brass', 'Brass Theme'),
	themeCommand('design.themeNeon', 'neon', 'Neon Theme'),
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
	{
		id: 'design.saveAsTheme',
		title: 'Save as Theme',
		section: 'Film',
		keywords: 'theme skins parts preset mix wall lights duplicate copy edit colours colors',
		isEnabled: hasProject,
		run: saveAsTheme
	},
	{
		id: 'design.takeOverCamera',
		title: 'Take Over Camera',
		section: 'Film',
		keywords: 'manual camera animate blender',
		isEnabled: (cx) => inDesign(cx) && cx.project?.design.camera.mode !== 'manual',
		run: (cx) => {
			const project = cx.project;
			if (project != null) cx.execute(cameraCommands(project, { mode: 'manual' }));
		}
	},
	{
		id: 'design.newTheme',
		title: 'New Theme with Agent…',
		section: 'Film',
		keywords: 'ai claude codex generate look skins style',
		isEnabled: inDesign,
		run: (cx) => {
			const project = cx.project;
			if (project == null) return;
			// One mention per piece type, as the Theme section's button starts it: each run makes that type's skin
			const seen = new Set<string>();
			const mentionIds = project.entities.flatMap((entity) => {
				const type = entity.components.piece?.type;
				if (type == null || seen.has(type)) return [];
				seen.add(type);
				return [entity.id];
			});
			cx.openAgent({ text: NEW_THEME_PROMPT, mentionIds: mentionIds.length > 0 ? mentionIds : ['scene'] });
		}
	},
	{
		id: 'design.deleteTheme',
		title: 'Delete Theme',
		section: 'Film',
		keywords: 'remove theme',
		isEnabled: (cx) => cx.project != null && resolveTheme(cx.project.design).projectTheme != null,
		run: (cx) => {
			const project = cx.project;
			if (project != null) deleteTheme(cx, project.design.theme);
		}
	},
	{ id: 'design.cancelExport', title: 'Cancel Export', section: 'Film', keywords: 'stop render film', isEnabled: (cx) => cx.film.isRunning, run: (cx) => cx.film.cancel() },

	// MARK: - Marble
	{ id: 'marble.add', title: 'Add Marble', section: 'Marble', keywords: 'track new ball', isEnabled: hasProject, run: (cx) => void cx.addMarble() },
	{ id: 'marble.speed', workspace: 'compose', title: 'Marble Speed', section: 'Marble', keywords: 'speed gravity fall fast slow physics', isEnabled: hasProject, run: (cx) => focusMarbleSpeed(cx) },

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
	{ id: 'help.resetHints', title: 'Reset Hints', section: 'Help', keywords: 'tips onboarding beginner show again first run', run: (cx) => cx.hints.reset() },
	{ id: 'help.enableMcp', title: 'Enable MCP', section: 'Help', keywords: 'ai agent claude code codex chatgpt connect server tools', isChecked: (cx) => cx.mcp.$isEnabled.get(), run: (cx) => void cx.mcp.setEnabled(!cx.mcp.$isEnabled.get()) },
	{ id: 'help.showAiWorkspace', title: 'Show AI Workspace', section: 'Help', keywords: 'ai agent claude code codex chatgpt connect mcp folder', run: (cx) => void cx.mcp.showWorkspace() },
	{ id: 'agent.showFolder', title: 'Show Agent Folder', section: 'File', keywords: 'ai references notes runs scratch finder', isEnabled: hasProject, run: (cx) => void cx.showAgentFolder() },
	{ id: 'design.addPack', title: 'Add Pack…', section: 'File', keywords: 'themes skins decor library browse import starter community', run: (cx) => cx.library.$isAddPackOpen.set(true) },
	{ id: 'design.exportPack', title: 'Export Pack…', section: 'File', keywords: 'themes skins decor share file', isEnabled: hasProject, run: (cx) => cx.library.$exportPack.set({ name: cx.project != null ? resolveTheme(cx.project.design).name : '', includesTheme: true, assetIds: [] }) }
];

export type TCommandId =
	| 'file.new'
	| 'file.open'
	| 'file.close'
	| 'file.save'
	| 'file.saveAs'
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
	| 'light.add'
	| 'decor.scatter'
	| 'camera.addWideShot'
	| 'design.themePegboard'
	| 'design.themeBrass'
	| 'design.themeNeon'
	| TPresetCommandId
	| 'design.loop'
	| 'design.saveAsTheme'
	| 'design.takeOverCamera'
	| 'design.newTheme'
	| 'design.deleteTheme'
	| 'design.cancelExport'
	| 'edit.undo'
	| 'edit.redo'
	| 'edit.rename'
	| 'edit.delete'
	| 'edit.selectAll'
	| 'edit.deselect'
	| 'edit.firstProblem'
	| 'view.compose'
	| 'view.design'
	| 'view.sidebar'
	| 'view.inspector'
	| 'view.timeline'
	| 'view.agent'
	| 'view.zoomIn'
	| 'view.zoomOut'
	| 'view.zoom100'
	| 'view.fitAll'
	| 'view.fitWhole'
	| 'view.fitSelection'
	| 'view.fitFrame'
	| 'view.showHitboxes'
	| 'view.follow'
	| 'play.toggle'
	| 'play.start'
	| 'play.previousHit'
	| 'play.nextHit'
	| 'play.cycle'
	| 'play.tap'
	| 'tool.select'
	| 'tool.hand'
	| 'tool.marble'
	| 'tool.path'
	| 'tool.text'
	| 'view.snap'
	| 'build.next'
	| 'build.track'
	| 'build.stop'
	| 'build.repeat'
	| 'build.mirror'
	| 'build.autoPlace'
	| 'build.continue'
	| 'build.dismiss'
	| 'build.replace'
	| 'piece.playNote'
	| 'piece.follow'
	| 'edit.duplicate'
	| 'edit.makeBacking'
	| 'piece.detach'
	| 'build.rotateLeft'
	| 'build.rotateRight'
	| 'marble.add'
	| 'marble.speed'
	| 'tool.platform'
	| 'tool.tunnel'
	| 'tool.windmill'
	| 'tool.switchback'
	| 'tool.finish'
	| 'build.addFinish'
	| 'tool.insert'
	| 'help.quickHelp'
	| 'help.resetHints'
	| 'help.enableMcp'
	| 'help.showAiWorkspace'
	| 'agent.showFolder'
	| 'design.addPack'
	| 'design.exportPack';

export function getCommand(id: TCommandId): TCommand {
	const command = commands.find((item) => item.id === id);
	if (command == null) throw new Error(`Unknown command ${id}`);
	return command;
}

/** The workspace a command acts in, or null when it works in both */
export function commandWorkspace(command: TCommand): TWorkspace | null {
	if (command.workspace != null) return command.workspace;
	if (command.section === 'Tools' || command.section === 'Track') return 'compose';
	if (command.section === 'Film') return 'design';
	return null;
}

/**
 * Runs a command from the other workspace by opening that workspace first, as the palette's dimmed results
 * promise. Compose commands wait for the canvas to mount; one that is not enabled once there does nothing.
 */
export function runInWorkspace(cx: StudioCx, command: TCommand): void {
	const target = commandWorkspace(command);
	if (target == null || cx.$workspace.get() === target) {
		if (isCommandEnabled(cx, command)) command.run(cx);
		return;
	}
	cx.$workspace.set(target);
	const runWhenReady = (): void => {
		if (isCommandEnabled(cx, command)) command.run(cx);
	};
	if (target === 'design' || cx.$compose.get() != null) {
		onNextFrame(runWhenReady);
		return;
	}
	// The canvas registers itself once mounted; give up after a second rather than run late
	let isDone = false;
	const stop = cx.$compose.listen(({ value }) => {
		if (value == null || isDone) return;
		isDone = true;
		stop();
		onNextFrame(runWhenReady);
	});
	window.setTimeout(() => {
		if (isDone) return;
		isDone = true;
		stop();
	}, 1000);
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
function selectedTitleIds(cx: StudioCx): string[] {
	const selection = cx.$selection.get();
	return cx.project?.entities.filter((entity) => entity.components.wallText != null && selection.includes(entity.id)).map((entity) => entity.id) ?? [];
}

export function deleteSelectedHits(cx: StudioCx): boolean {
	const project = cx.project;
	if (project == null) return false;
	const decorIds = selectedDecorIds(cx.$selection.get());
	if (inDesign(cx) && decorIds.length > 0) {
		const applied = cx.execute(deleteDecorCommands(project, decorIds));
		if (applied) cx.$selection.set([]);
		return applied;
	}
	const lightIds = selectedLightIds(cx);
	if (inDesign(cx) && lightIds.length > 0) {
		const applied = cx.execute(deleteLightsCommands(project, lightIds));
		if (applied) cx.$selection.set([]);
		return applied;
	}
	const shotIds = selectedShotIds(cx);
	if (inDesign(cx) && shotIds.length > 0) {
		const applied = cx.execute(removeShotsCommands(project, shotIds));
		if (applied) cx.$selection.set([]);
		return applied;
	}
	const titleIds = selectedTitleIds(cx);
	if (inDesign(cx) && titleIds.length > 0) {
		const applied = cx.execute([{ type: 'removeEntities', entityIds: titleIds }]);
		if (applied) cx.$selection.set([]);
		return applied;
	}
	return removeSelectedHits(cx, cx.$selection.get(), $rollHasFocus.get());
}

/** Marble Speed sits in the Project inspector: clear the selection, show the inspector and focus the value */
function focusMarbleSpeed(cx: StudioCx): void {
	cx.$selection.set([]);
	if (!cx.$panels.get().inspector) cx.togglePanel('inspector');
	// After the inspector renders the Project
	requestAnimationFrame(() =>
		requestAnimationFrame(() => {
			const field = document.getElementById('world-speed-value');
			if (field instanceof HTMLInputElement) {
				field.focus();
				field.select();
			}
		})
	);
}

