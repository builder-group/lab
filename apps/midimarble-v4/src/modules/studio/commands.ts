import { problemPieces, lanesWithoutBowl, canMakeBacking } from '@/modules/building';
import { onNextFrame } from './next-frame';
import { fitsSong, lastHitTime } from '@/modules/music';
import { followKey, toolKeys, tunnelPathKey, type TTrackTool } from '@/modules/track/keys';
import { removeSelectedHits, canGroup, canUngroup, groupSelected, selectedPattern, ungroupSelected, selectedPieceIds, armPlayNote, canFollow, canPlayNote, detachSelection, hasTiedSelection, openFollowMenu, handNotes } from '@/modules/track';
import { $rollHasFocus } from './timeline/timeline-state';
import type { TMenuItem } from '@/components';
import { newProjectTitle } from '@/environment';
import type { TrackCx } from '@/modules/track';
import { BACKING_ID, type TLane, type TProject, CAMERA_KEY, KEY_LIGHT_ID, KEY_LIGHT_KEY, parseHitKey, parseLightKey, parseShotKey, SONG_KEY, WALL_KEY, toDecorKey, toHitKey, toLightKey, toShotKey } from '@/modules/project';
import { isSuperseded, soundsHit, type TSimulationResult } from '@/modules/simulation';
import { deleteThemeCommands, resolveTheme, deleteDecorCommands, duplicateDecorCommands, selectedDecorIds, addLightCommands, deleteLightsCommands, addShotCommands, removeShotsCommands } from '@/modules/scene';
import { openScatterPanel } from '@/modules/film';
import { connectTitle } from '@/modules/mcp/agent-connect';
import { shownRepeatRange } from './repeat-range';
import { addSuggestedHits, suggestedHits, suggestedHitsLabel } from './suggested-hits';
import { pasteFilmCommands } from './clipboard';
import { duplicateClear, freePieces, pasteClear, type TClearDuplicate } from './duplicate';
import { hasSongLayer } from './song-layer';
import type { StudioCx, TWorkspace } from './StudioCx';

// Every studio command in one list. The command palette lists them all; context menus and the
// keyboard handlers run the same actions, so each command reads the same everywhere with its shortcut.

export interface TCommand {
	id: TCommandId;
	title: string;
	/** The title right now, where a row reads by state: Connect or Disconnect. The palette and every menu show it. */
	currentTitle?: (cx: StudioCx) => string;
	section: TCommandSection;
	/** Only agents call it: the palette leaves it out */
	isForAgents?: boolean;
	/** Shortcut glyphs as macOS menus show them */
	shortcut?: string;
	/** Extra words the palette matches, such as Blender's names for an action */
	keywords?: string;
	/**
	 * The workspace the command acts in when its section does not say it, such as the Track canvas's zoom.
	 * Tools and Pieces belong to Track and Film to Film; the rest work in both.
	 */
	workspace?: TWorkspace | null;
	isEnabled?: (cx: StudioCx) => boolean;
	/** Why it can't run right now, in a sentence, for what isn't plain from the project and selection */
	whyDisabled?: string;
	isChecked?: (cx: StudioCx) => boolean;
	run: (cx: StudioCx) => void;
}

export type TCommandSection = 'File' | 'Edit' | 'View' | 'Playback' | 'Tools' | 'Track' | 'Marble' | 'Film' | 'Agent' | 'Help';

function trackCx(cx: StudioCx): TrackCx | null {
	return cx.$workspace.get() === 'track' ? cx.$trackCx.get() : null;
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

function inFilm(cx: StudioCx): boolean {
	return cx.project != null && cx.$workspace.get() === 'film';
}

/** Whether Blender runs for the Film workspace; false in the browser and without Blender */
function hasBlender(cx: StudioCx): boolean {
	const status = cx.film.$status.get();
	return inFilm(cx) && status !== 'unavailable' && status !== 'missing';
}

/** Whether Blender can run for the open project, in either workspace */
function canRunBlender(cx: StudioCx): boolean {
	const status = cx.film.$status.get();
	return cx.project != null && status !== 'unavailable' && status !== 'missing';
}

/** Selected pieces that Blender reports as unlinked */
function unlinkedSelection(cx: StudioCx): string[] {
	const links = cx.film.$links.get();
	return cx.$selection.get().filter((id) => links[id]?.link === 'unlinked');
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
	return project != null && trackCx(cx) != null && selectedPieceIds(project, cx.$selection.get()).length > 0;
}

let isDuplicating = false;

/** A what-if run of Duplicate's and Paste's spots; a newer what-if of another assist may replace it while it waits */
function clearSimulate(cx: StudioCx): ((trial: TProject) => Promise<TSimulationResult>) | null {
	const client = cx.simulation.assists;
	if (client == null) return null;
	const simulate = async (trial: TProject, retries = 3): Promise<TSimulationResult> => {
		try {
			return await client.simulateAssist(trial);
		} catch (error) {
			if (retries > 0 && isSuperseded(error)) return simulate(trial, retries - 1);
			throw error;
		}
	};
	return simulate;
}

/** The text that says a copy would break the run, so nothing changed */
function refusedWords(what: string, breaks: number): string {
	return `Every spot for a copy of ${what} would break ${breaks === 1 ? 'a hit' : `${breaks} hits`}, so nothing changed`;
}

/**
 * Duplicate for the selected pieces: free copies clear of every marble's path, selected afterward, as one undo step.
 * The spot is checked with what-if runs first, so a copy never breaks a hit; a newer edit in the meantime wins.
 */
async function duplicateSelection(cx: StudioCx): Promise<void> {
	const project = cx.project;
	if (project == null || isDuplicating) return;
	const decorIds = inFilm(cx) ? selectedDecorIds(cx.$selection.get()) : [];
	if (decorIds.length > 0) {
		const copies = duplicateDecorCommands(project, decorIds);
		if (cx.execute(copies.commands, { label: 'Duplicate' })) cx.$selection.set(copies.decorIds.map(toDecorKey));
		return;
	}
	const ids = selectedPieceIds(project, cx.$selection.get());
	isDuplicating = true;
	let placed: TClearDuplicate;
	try {
		placed = await duplicateClear(project, cx.simulation.$result.get(), ids, clearSimulate(cx), cx.film.$blenderObjects.get());
	} catch (error) {
		cx.notify(`Duplicate failed, so nothing changed: ${(error as Error).message}`, 'error');
		return;
	} finally {
		isDuplicating = false;
	}
	if (cx.project !== project) return;
	const original = project.entities.find((entity) => entity.id === ids[0]);
	if (placed.spot === 'refused') {
		cx.notify(refusedWords(original?.name ?? 'this piece', placed.breaks));
		return;
	}
	if (!placed.copies.length) {
		cx.notify('These track pieces have no place on the track yet, so there is nothing to copy');
		return;
	}
	if (!cx.execute(placed.commands, { label: 'Duplicate' })) return;
	const named = cx.project?.entities.filter((entity) => placed.copies.some((copy) => copy.id === entity.id)) ?? placed.copies;
	cx.$selection.set(named.map((entity) => entity.id));
	const tied = ids.some((id) => project.entities.find((entity) => entity.id === id)?.components.hitLink != null);
	const what = named.length === 1 ? `${original?.name ?? 'The piece'} duplicated as ${named[0]?.name ?? 'a copy'}` : `${named.length} pieces duplicated`;
	const where = placed.spot === 'beside the run' ? ', beside the run: no free spot near it' : '';
	cx.notifyEdit(`${what}${tied ? ', tied to nothing' : ''}${where}`);
}

function canCopy(cx: StudioCx): boolean {
	return hasPieces(cx) || (inFilm(cx) && (selectedDecorIds(cx.$selection.get()).length > 0 || selectedTitleIds(cx).length > 0));
}

/** ⌘C: Track's pieces as free pieces where they are now, Film's titles and Decor. The selection stays */
function copySelection(cx: StudioCx): void {
	const project = cx.project;
	if (project == null) return;
	if (trackCx(cx) == null) {
		const decorIds = selectedDecorIds(cx.$selection.get());
		const titleIds = selectedTitleIds(cx);
		cx.$clipboard.set({ pieces: cx.$clipboard.get()?.pieces ?? [], decor: project.design.decor.filter((item) => decorIds.includes(item.id)), titles: project.entities.filter((entity) => titleIds.includes(entity.id)) });
		return;
	}
	const pieces = freePieces(project, cx.simulation.$result.get(), selectedPieceIds(project, cx.$selection.get()));
	if (!pieces.length) {
		cx.notify('These track pieces have no place on the track yet, so there is nothing to copy');
		return;
	}
	cx.$clipboard.set({ pieces, decor: cx.$clipboard.get()?.decor ?? [], titles: cx.$clipboard.get()?.titles ?? [] });
}

/** Whether what ⌘C kept belongs in this workspace: pieces in Track, titles and Decor in Film */
function canPaste(cx: StudioCx): boolean {
	const kept = cx.$clipboard.get();
	if (kept == null || cx.project == null) return false;
	return trackCx(cx) != null ? kept.pieces.length > 0 : inFilm(cx) && (kept.titles.length > 0 || kept.decor.length > 0);
}

/**
 * ⌘V in Track: the kept pieces as free pieces, in the nearest spot clear of the run, as Duplicate finds it. A piece
 * that played a note pastes free, since a note has one platform. In Film: the kept titles and Decor beside where they
 * were, and the next ⌘V steps on from these. One Undo step, the copies selected.
 */
async function pasteClipboard(cx: StudioCx): Promise<void> {
	const project = cx.project;
	const kept = cx.$clipboard.get();
	if (project == null || kept == null || isDuplicating) return;
	if (trackCx(cx) == null) {
		const pasted = pasteFilmCommands(project, kept);
		if (cx.execute(pasted.commands, { label: 'Paste' })) {
			cx.$clipboard.set({ ...kept, decor: pasted.decor, titles: pasted.titles });
			cx.$selection.set([...pasted.decor.map((item) => toDecorKey(item.id)), ...pasted.titles.map((entity) => entity.id)]);
		}
		return;
	}
	isDuplicating = true;
	let placed: TClearDuplicate;
	try {
		placed = await pasteClear(project, cx.simulation.$result.get(), kept.pieces, clearSimulate(cx), cx.film.$blenderObjects.get());
	} catch (error) {
		cx.notify(`Paste failed, so nothing changed: ${(error as Error).message}`, 'error');
		return;
	} finally {
		isDuplicating = false;
	}
	if (cx.project !== project) return;
	if (placed.spot === 'refused') {
		cx.notify(refusedWords(kept.pieces[0]?.name ?? 'this piece', placed.breaks));
		return;
	}
	if (!cx.execute(placed.commands, { label: 'Paste' })) return;
	cx.$selection.set(placed.copies.map((entity) => entity.id));
	if (placed.spot === 'beside the run') cx.notifyEdit('Pasted beside the run: no free spot near it');
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

function selectedShotIds(cx: StudioCx): string[] {
	return cx.$selection.get().flatMap((key) => parseShotKey(key) ?? []);
}

/**
 * The marble Add Bowl works on: the selected marble's (or the selected piece's), else the first marble that plays
 * last and has no Bowl yet; null when there is none
 */
function bowlLane(cx: StudioCx): string | null {
	const project = cx.project;
	if (project == null) return null;
	const selected = cx.$selection.get().flatMap((id) => {
		const entity = project.entities.find((item) => item.id === id);
		const laneId = entity?.components.marble?.laneId ?? entity?.components.hitLink?.laneId;
		return laneId != null ? [laneId] : [];
	});
	const lane = selected[0];
	if (lane != null && project.music.lanes.some((item) => item.id === lane && item.hits.length > 0)) return lane;
	return lanesWithoutBowl(project)[0] ?? null;
}

/** The marble Add Suggested Hits works on: the selected one, else the first without hits, else the first */
function suggestionLane(cx: StudioCx): TLane | null {
	const project = cx.project;
	if (project == null) return null;
	const selected = project.entities.find((entity) => entity.id === cx.$selection.get()[0])?.components.marble?.laneId;
	const lanes = project.music.lanes;
	return lanes.find((lane) => lane.id === selected) ?? lanes.find((lane) => !lane.hits.length) ?? lanes[0] ?? null;
}

function isTool(cx: StudioCx, tool: TTrackTool): boolean {
	return trackCx(cx)?.$tool.get() === tool;
}

function toolCommand(tool: Exclude<TTrackTool, 'marble'>, title: string, keywords: string): TCommand {
	return {
		id: `tool.${tool}`,
		title,
		section: 'Tools',
		shortcut: toolKeys.find((item) => item.tool === tool)?.key,
		keywords,
		isEnabled: (cx) => trackCx(cx) != null,
		isChecked: (cx) => isTool(cx, tool) && (tool !== 'path' || trackCx(cx)?.$pathType.get() === 'rail'),
		run: (cx) => trackCx(cx)?.armTool(tool)
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
	{ id: 'file.revert', title: 'Revert to Opened…', section: 'File', keywords: 'back restore undo all discard last saved', isEnabled: (cx) => cx.canRevert(), run: (cx) => void cx.revertToOpened() },
	{ id: 'file.importMidi', title: 'Import Song…', section: 'File', shortcut: '⌘I', keywords: 'midi recording audio wav mp3 music', isEnabled: hasProject, run: (cx) => void cx.importSong() },
	{ id: 'file.replaceSong', title: 'Replace Song…', section: 'File', keywords: 'music midi audio soundtrack', isEnabled: hasSong, run: (cx) => void cx.sources.replaceSong() },
	{ id: 'file.removeSong', title: 'Delete Song', section: 'File', keywords: 'music midi audio soundtrack remove backing', isEnabled: hasSong, run: (cx) => void cx.sources.deleteSong() },
	{ id: 'file.export', title: 'Export Film…', section: 'File', shortcut: '⌘E', keywords: 'render video movie mp4 share', isEnabled: hasProject, run: (cx) => cx.filmExport.openSheet() },

	// MARK: - Edit
	{ id: 'edit.undo', title: 'Undo', section: 'Edit', shortcut: '⌘Z', isEnabled: (cx) => (cx.$history.get()?.past.length ?? 0) > 0 || cx.$trackCx.get()?.patterns.$isRunning.get() === true, run: (cx) => cx.undo() },
	{ id: 'edit.redo', title: 'Redo', section: 'Edit', shortcut: '⇧⌘Z', isEnabled: (cx) => (cx.$history.get()?.future.length ?? 0) > 0, run: (cx) => cx.redo() },
	{ id: 'edit.rename', title: 'Rename…', section: 'Edit', shortcut: 'F2', isEnabled: (cx) => cx.renameTarget() != null, run: (cx) => cx.renameSelection() },
	{
		id: 'edit.delete',
		title: 'Delete',
		section: 'Edit',
		shortcut: '⌫',
		keywords: 'remove',
		isEnabled: (cx) => hasPieces(cx) || hasHits(cx) || selectedShotIds(cx).length > 0 || (inFilm(cx) && (selectedLightIds(cx).length > 0 || selectedDecorIds(cx.$selection.get()).length > 0 || selectedTitleIds(cx).length > 0)) || isSongSelected(cx),
		run: (cx) => {
			// The Song layer alone deletes the song file and Backing; the marbles keep their hits
			if (isSongSelected(cx) && cx.$selection.get().length === 1) {
				void cx.sources.deleteSong();
				return;
			}
			if (trackCx(cx)?.deleteSelection() === true) return;
			deleteSelectedHits(cx);
		}
	},
	{ id: 'edit.copy', title: 'Copy', section: 'Edit', shortcut: '⌘C', keywords: 'clipboard', isEnabled: canCopy, run: (cx) => copySelection(cx) },
	{ id: 'edit.paste', title: 'Paste', section: 'Edit', shortcut: '⌘V', keywords: 'clipboard', isEnabled: canPaste, run: (cx) => void pasteClipboard(cx) },
	{ id: 'edit.duplicate', title: 'Duplicate', section: 'Edit', shortcut: '⌘D', keywords: 'copy clone', isEnabled: (cx) => hasPieces(cx) || (inFilm(cx) && selectedDecorIds(cx.$selection.get()).length > 0), run: (cx) => void duplicateSelection(cx) },
	{ id: 'edit.group', title: 'Group Selection', section: 'Edit', shortcut: '⌘G', keywords: 'folder collect', isEnabled: canGroup, run: (cx) => groupSelected(cx) },
	{ id: 'edit.ungroup', title: 'Ungroup', section: 'Edit', shortcut: '⇧⌘G', keywords: 'folder separate', isEnabled: canUngroup, run: (cx) => ungroupSelected(cx) },
	{
		id: 'edit.flatten',
		workspace: 'track',
		title: 'Flatten',
		section: 'Edit',
		keywords: 'pattern apply plain pieces keep edit one by one modifier',
		isEnabled: (cx) => trackCx(cx) != null && selectedPattern(cx) != null,
		run: (cx) => {
			const group = selectedPattern(cx);
			if (group != null) trackCx(cx)?.patterns.flatten(group);
		}
	},
	{
		id: 'edit.selectAll', workspace: 'track',
		title: 'Select All Track Pieces',
		section: 'Edit',
		shortcut: '⌘A',
		isEnabled: (cx) => trackCx(cx) != null,
		run: (cx) => cx.$selection.set(cx.project?.entities.filter((entity) => entity.components.piece != null).map((entity) => entity.id) ?? [])
	},
	{ id: 'edit.deselect', title: 'Deselect', section: 'Edit', keywords: 'select scene none project length speed theme', isEnabled: (cx) => cx.$selection.get().length > 0, run: (cx) => cx.$selection.set([]) },
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
	{ id: 'view.track', title: 'Track', section: 'View', shortcut: '⌘1', keywords: 'workspace compose', isChecked: (cx) => cx.$workspace.get() === 'track', run: (cx) => cx.$workspace.set('track') },
	{ id: 'view.film', title: 'Film', section: 'View', shortcut: '⌘2', keywords: 'workspace blender design look export', isChecked: (cx) => cx.$workspace.get() === 'film', run: (cx) => cx.$workspace.set('film') },
	{ id: 'view.sidebar', title: 'Sidebar', section: 'View', shortcut: '⌃⌘S', keywords: 'outliner panel', isChecked: (cx) => cx.$panels.get().sidebar, run: (cx) => cx.togglePanel('sidebar') },
	{ id: 'view.inspector', title: 'Inspector', section: 'View', shortcut: '⌃⌘I', keywords: 'properties panel', isChecked: (cx) => cx.$panels.get().inspector, run: (cx) => cx.togglePanel('inspector') },
	{ id: 'view.timeline', title: 'Timeline', section: 'View', shortcut: '⌃⌘T', keywords: 'tracks dope sheet panel', isChecked: (cx) => cx.$panels.get().timeline, run: (cx) => cx.togglePanel('timeline') },
	{ id: 'view.zoomIn', workspace: 'track', title: 'Zoom In', section: 'View', shortcut: '⌘+', isEnabled: (cx) => trackCx(cx) != null, run: (cx) => trackCx(cx)?.zoomBy(2) },
	{ id: 'view.zoomOut', workspace: 'track', title: 'Zoom Out', section: 'View', shortcut: '⌘−', isEnabled: (cx) => trackCx(cx) != null, run: (cx) => trackCx(cx)?.zoomBy(0.5) },
	{ id: 'view.zoom100', workspace: 'track', title: 'Zoom to 100%', section: 'View', shortcut: '⌘0', keywords: 'actual size reset real', isEnabled: (cx) => trackCx(cx) != null, run: (cx) => trackCx(cx)?.zoomTo100() },
	{ id: 'view.fitAll', workspace: 'track', title: 'Zoom to Fit', section: 'View', shortcut: '⇧1', keywords: 'frame all home view all whole run overview everything', isEnabled: (cx) => trackCx(cx) != null, run: (cx) => trackCx(cx)?.fitAll() },
	{ id: 'view.fitSelection', workspace: 'track', title: 'Zoom to Selection', section: 'View', shortcut: '⇧2', keywords: 'frame selected', isEnabled: hasPieces, run: (cx) => trackCx(cx)?.fitSelection() },
	{
		id: 'view.snap',
		workspace: 'track',
		title: 'Snap',
		section: 'View',
		keywords: 'magnet snapping dots trajectories plays follows attach',
		isEnabled: (cx) => trackCx(cx) != null,
		isChecked: (cx) => cx.$snapping.get(),
		run: (cx) => cx.$snapping.set(!cx.$snapping.get())
	},
	{
		id: 'view.track3d',
		workspace: 'track',
		title: '3D View',
		section: 'View',
		shortcut: 'D',
		keywords: '2d 3d flat orbit look around perspective depth track view',
		isEnabled: hasProject,
		isChecked: (cx) => cx.$trackView.get() === '3d',
		run: (cx) => cx.$trackView.set(cx.$trackView.get() === '3d' ? '2d' : '3d')
	},
	{
		id: 'view.trackCamera',
		workspace: 'track',
		title: 'Camera View',
		section: 'View',
		keywords: 'through the film camera frame framing orbit track view',
		isEnabled: hasProject,
		isChecked: (cx) => cx.$trackView.get() === 'camera',
		run: (cx) => cx.$trackView.set(cx.$trackView.get() === 'camera' ? '2d' : 'camera')
	},
	{
		id: 'view.showHitboxes',
		workspace: 'film',
		title: 'Show Hitboxes',
		section: 'View',
		keywords: 'collider gizmo outline physics shape what the marble touches',
		isEnabled: inFilm,
		isChecked: (cx) => cx.$showHitboxes.get(),
		run: (cx) => cx.$showHitboxes.set(!cx.$showHitboxes.get())
	},
	{
		id: 'view.follow',
		workspace: 'track',
		title: 'Follow Marble in View',
		section: 'View',
		shortcut: followKey.key,
		keywords: 'catch playhead autoscroll track scroll keep in view playback',
		isEnabled: (cx) => trackCx(cx) != null && cx.$trackView.get() !== 'camera',
		isChecked: (cx) => trackCx(cx)?.$follow.get() === true,
		run: (cx) => trackCx(cx)?.toggleFollow()
	},
	{
		id: 'view.audioScrubbing',
		title: 'Audio Scrubbing',
		section: 'View',
		keywords: 'scrub skim skimming hear sound song playhead drag ruler',
		isChecked: (cx) => cx.$audioScrubbing.get(),
		run: (cx) => cx.toggleAudioScrubbing()
	},

	// MARK: - Playback
	{ id: 'play.toggle', title: 'Play', section: 'Playback', shortcut: 'Space', keywords: 'pause stop', isEnabled: hasProject, run: (cx) => cx.$playing.set(!cx.$playing.get()) },
	{ id: 'play.start', title: 'Go to Beginning', section: 'Playback', shortcut: '↩', keywords: 'rewind start', isEnabled: hasProject, run: (cx) => cx.$playhead.set(0) },
	{ id: 'play.previousHit', title: 'Previous Hit', section: 'Playback', shortcut: '←', keywords: 'jump keyframe', isEnabled: hasProject, run: (cx) => cx.stepHit(-1) },
	{ id: 'play.nextHit', title: 'Next Hit', section: 'Playback', shortcut: '→', keywords: 'jump keyframe', isEnabled: hasProject, run: (cx) => cx.stepHit(1) },
	{ id: 'play.repeat', title: 'Repeat Range', section: 'Playback', shortcut: 'C', keywords: 'cycle loop repeat rehearse section range', isEnabled: hasProject, isChecked: (cx) => shownRepeatRange(cx.$repeatRange.get(), cx.project?.id, cx.project?.end ?? 0)?.isOn === true, run: (cx) => cx.toggleRepeatRange() },
	{ id: 'play.tap', title: 'Tap Hit at Playhead', section: 'Playback', shortcut: 'T', keywords: 'record tap along', isEnabled: hasProject, run: (cx) => cx.tapHit() },

	// MARK: - Tools
	toolCommand('select', 'Move Tool', 'select pointer arrow'),
	toolCommand('hand', 'Hand Tool', 'pan'),
	toolCommand('platform', 'Platform Tool', 'piece add place bar'),
	toolCommand('path', 'Rail Tool', 'path pen bezier spline curve draw'),
	{
		id: 'tool.tunnel',
		title: 'Tunnel Tool',
		section: 'Tools',
		shortcut: tunnelPathKey.key,
		keywords: 'tube path pen bezier curve draw',
		isEnabled: (cx) => trackCx(cx) != null,
		isChecked: (cx) => isTool(cx, 'path') && trackCx(cx)?.$pathType.get() === 'tunnel',
		run: (cx) => trackCx(cx)?.armTool('path', 'tunnel')
	},
	toolCommand('windmill', 'Windmill Tool', 'piece add rotor blades'),
	toolCommand('bowl', 'Bowl Tool', 'piece add end catch collect cup last note'),
	{
		id: 'tool.insert',
		title: 'Insert…',
		section: 'Tools',
		shortcut: '⇧I',
		keywords: 'library assets add piece windmill rail tunnel title caption song name end card decor decoration ornament light shot',
		isEnabled: (cx) => trackCx(cx) != null || inFilm(cx),
		run: (cx) => {
			if (inFilm(cx)) cx.library.$insertOpen.set(true);
			else trackCx(cx)?.$libraryOpen.set(true);
		}
	},

	// MARK: - Pieces
	{ id: 'build.next', title: 'Place Next Platform', section: 'Track', shortcut: 'N', keywords: 'add step assist', isEnabled: (cx) => trackCx(cx) != null, run: (cx) => trackCx(cx)?.next() },
	{
		id: 'build.track',
		title: 'Build Track',
		section: 'Track',
		shortcut: '⇧N',
		keywords: 'whole song all hits auto build everything bowl solve assist',
		isEnabled: (cx) => trackCx(cx) != null && trackCx(cx)?.assist.isBuilding !== true && trackCx(cx)?.assist.hasOpenHits === true,
		run: (cx) => void trackCx(cx)?.assist.buildTrack()
	},
	{
		id: 'build.rebuildFrom',
		title: 'Rebuild From Here',
		section: 'Track',
		keywords: 'build track again rest later after this hit platform steer keep before',
		isEnabled: (cx) => trackCx(cx) != null && trackCx(cx)?.assist.isBuilding !== true && trackCx(cx)?.assist.rebuildTarget != null,
		run: (cx) => {
			const assist = trackCx(cx)?.assist;
			const from = assist?.rebuildTarget;
			if (from != null) void assist?.buildTrack(from);
		}
	},
	{ id: 'build.stop', title: 'Stop Building Track', section: 'Track', keywords: 'cancel build track', isEnabled: (cx) => trackCx(cx)?.assist.isBuilding === true, run: (cx) => trackCx(cx)?.assist.stopBuild() },
	{ id: 'build.repeat', title: 'Repeat Last Platform', section: 'Track', shortcut: 'R', keywords: 'copy same tilt assist', isEnabled: (cx) => trackCx(cx) != null, run: (cx) => trackCx(cx)?.step('repeat') },
	{ id: 'build.mirror', title: 'Mirror Last Platform', section: 'Track', shortcut: 'M', keywords: 'zigzag flip tilt assist', isEnabled: (cx) => trackCx(cx) != null, run: (cx) => trackCx(cx)?.step('mirror') },
	{ id: 'build.continue', title: 'Continue Pattern', section: 'Track', shortcut: '⇥', keywords: 'accept ghosts suggestions repeat tab assist', isEnabled: (cx) => trackCx(cx)?.assist.hasGhosts === true, run: (cx) => trackCx(cx)?.assist.acceptGhosts() },
	{
		id: 'build.fix',
		title: 'Fix',
		section: 'Track',
		shortcut: 'A',
		keywords: 'place again re-place replace repair auto place solve tilt platforms blocked missed stopped broken on time move clear release',
		isEnabled: (cx) => trackCx(cx) != null && trackCx(cx)?.assist.isFixing !== true && !isOnlyOnTimePiece(cx),
		run: (cx) => trackCx(cx)?.assist.fixSelection()
	},
	{
		id: 'build.addBowl',
		title: 'Add Bowl',
		section: 'Track',
		keywords: 'bowl end catch collect cup last note ending tail',
		isEnabled: (cx) => trackCx(cx) != null && bowlLane(cx) != null,
		run: (cx) => {
			const laneId = bowlLane(cx);
			if (laneId != null) void trackCx(cx)?.assist.addBowl(laneId);
		}
	},
	{
		id: 'piece.playNote',
		title: 'Play a Note…',
		section: 'Track',
		keywords: 'link attach tie plays dot hit',
		isEnabled: (cx) => hasPieces(cx) && canPlayNote(cx),
		run: (cx) => {
			const current = trackCx(cx);
			if (current != null) armPlayNote(cx, current);
		}
	},
	{ id: 'piece.follow', title: 'Follow a Marble…', section: 'Track', keywords: 'anchor attach tie follows nearest marble', isEnabled: (cx) => hasPieces(cx) && canFollow(cx), run: (cx) => openFollowMenu(cx) },
	{ id: 'piece.detach', title: 'Detach', section: 'Track', keywords: 'unlink unanchor untie free none', isEnabled: (cx) => hasPieces(cx) && hasTiedSelection(cx), run: (cx) => detachSelection(cx) },
	{ id: 'build.dismiss', title: 'Dismiss Suggestions', section: 'Track', shortcut: '⎋', keywords: 'ghosts escape', isEnabled: (cx) => trackCx(cx)?.assist.hasGhosts === true, run: (cx) => trackCx(cx)?.assist.dismiss() },

	// MARK: - Film
	{ id: 'film.editInBlender', title: 'Open in Blender', section: 'Film', keywords: 'edit blender window scene', isEnabled: canRunBlender, run: (cx) => void cx.film.openInBlender() },
	{ id: 'film.restartBlender', title: 'Restart Blender', section: 'Film', keywords: 'blender reconnect stuck error', isEnabled: canRunBlender, run: (cx) => void cx.film.restart() },
	{ id: 'film.renderPreview', title: 'Refresh Preview', section: 'Film', keywords: 'render update eevee playhead', isEnabled: hasBlender, run: (cx) => cx.film.requestPreview(0) },
	{
		id: 'film.addText',
		title: 'Add Title',
		section: 'Film',
		shortcut: 'T',
		keywords: 'wall text label credit type decal',
		isEnabled: inFilm,
		isChecked: (cx) => cx.film.$placing.get() === 'text',
		run: (cx) => {
			// The next click on the Blender preview or the Draft Preview places the title
			cx.film.$placing.set(cx.film.$placing.get() === 'text' ? null : 'text');
		}
	},
	{
		id: 'film.resetToTrack',
		title: 'Discard Blender Changes',
		section: 'Film',
		keywords: 'reset to compose relink linked detached undo blender edits',
		isEnabled: (cx) => hasBlender(cx) && unlinkedSelection(cx).length > 0,
		run: (cx) => void cx.film.relink(unlinkedSelection(cx))
	},
	{
		id: 'film.regenerateCamera',
		title: 'Reset Camera',
		section: 'Film',
		keywords: 'regenerate rig follow automatic camera taken over discard blender changes',
		isEnabled: (cx) => hasBlender(cx) && cx.film.$camera.get() === 'takenOver',
		run: (cx) => void cx.film.regenerateCamera()
	},
	{
		id: 'camera.addShot',
		workspace: null,
		title: 'Add Shot',
		section: 'Film',
		shortcut: '⇧M',
		keywords: 'camera marker keyframe push in wide follow close up',
		isEnabled: hasProject,
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
		keywords: 'decoration bauble fill wall ornaments',
		isEnabled: hasProject,
		run: (cx) => openScatterPanel(cx)
	},
	{
		id: 'decor.add',
		title: 'Add Decor…',
		section: 'Film',
		keywords: 'decoration bauble ornament insert library',
		isEnabled: inFilm,
		run: (cx) => cx.library.$insertOpen.set(true)
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
			cx.$workspace.set('film');
			const { commands, lightId } = addLightCommands(project);
			if (cx.execute(commands)) cx.$selection.set([toLightKey(lightId)]);
		}
	},
	{
		id: 'film.deleteTheme',
		title: 'Delete Theme',
		section: 'Film',
		keywords: 'remove theme',
		isEnabled: (cx) => cx.project != null && resolveTheme(cx.project.design).projectTheme != null,
		run: (cx) => {
			const project = cx.project;
			if (project != null) deleteTheme(cx, project.design.theme);
		}
	},
	{ id: 'film.cancelExport', title: 'Cancel Export', section: 'Film', keywords: 'stop render film', isEnabled: (cx) => cx.filmExport.isRunning, run: (cx) => cx.filmExport.cancel() },

	// MARK: - Marble
	// MARK: - Layers and settings, found by name in ⌘K
	selectLayerCommand('layer.wall', 'Wall', WALL_KEY, 'warm cold color background plaster pegboard grid skin'),
	selectLayerCommand('layer.keyLight', 'Key Light', KEY_LIGHT_KEY, 'warm cold bright dark sun main lighting'),
	{ ...selectLayerCommand('layer.camera', 'Camera', CAMERA_KEY, 'closer zoom distance turn orbit rotate sway shake tilt angle'), workspace: null },
	{
		id: 'layer.song',
		title: 'Song',
		section: 'Marble',
		keywords: 'solo mute listen hear isolate parts sound instrument tempo backing',
		isEnabled: hasSong,
		run: (cx) => cx.$selection.set([SONG_KEY])
	},
	{
		id: 'film.format',
		title: 'Format',
		section: 'Film',
		keywords: 'aspect portrait square vertical landscape shorts frame shape ratio',
		isEnabled: hasProject,
		run: (cx) => focusSceneField(cx, 'project-format')
	},
	{
		id: 'film.theme',
		title: 'Theme',
		section: 'Film',
		keywords: 'look style dress brass neon pegboard',
		isEnabled: hasProject,
		run: (cx) => focusSceneField(cx, 'scene-theme')
	},
	{
		id: 'view.draftPreview',
		title: 'Draft Preview',
		section: 'View',
		keywords: 'fast shading solid render real look blender background battery',
		isEnabled: canRunBlender,
		isChecked: (cx) => !cx.film.live.$enabled.get(),
		run: (cx) => cx.film.live.setEnabled(!cx.film.live.$enabled.get())
	},
	{
		id: 'marble.add',
		title: 'Add Marble',
		section: 'Marble',
		workspace: 'track',
		shortcut: toolKeys.find((item) => item.tool === 'marble')?.key,
		keywords: 'track new ball release tool',
		isEnabled: hasProject,
		isChecked: (cx) => isTool(cx, 'marble'),
		run: (cx) => {
			// In Track the next click on the wall releases it; Film and an agent add it at once
			const canvas = trackCx(cx);
			if (canvas != null && !cx.isInAgentStep) canvas.armTool('marble');
			else cx.addMarble();
		}
	},
	{
		id: 'marble.addSuggestedHits',
		title: 'Add Suggested Hits',
		currentTitle: (cx) => {
			const lane = suggestionLane(cx);
			const count = lane != null ? suggestedHits(cx, lane).length : 0;
			return count > 0 ? suggestedHitsLabel(count) : 'Add Suggested Hits';
		},
		section: 'Marble',
		keywords: 'beats onsets recording audio tap detect found',
		isEnabled: (cx) => {
			const lane = suggestionLane(cx);
			return lane != null && suggestedHits(cx, lane).length > 0;
		},
		whyDisabled: 'It needs a recording with beats the marble does not play yet',
		run: (cx) => {
			const lane = suggestionLane(cx);
			if (lane != null) addSuggestedHits(cx, lane);
		}
	},
	{
		id: 'film.fitToSong',
		title: 'Fit to Song',
		section: 'Film',
		keywords: 'length end duration film trim',
		isEnabled: (cx) => cx.project != null && lastHitTime(cx.project) != null && !fitsSong(cx.project),
		whyDisabled: 'The length already fits the song',
		run: (cx) => void cx.fitToSong()
	},
	{ id: 'marble.speed', workspace: 'track', title: 'Gravity', section: 'Marble', keywords: 'marble speed fall fast slow physics', isEnabled: hasProject, run: (cx) => focusMarbleSpeed(cx) },

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
	{ id: 'help.enableMcp', title: 'Enable MCP', section: 'Agent', keywords: 'ai agent claude code codex chatgpt connect server tools', isChecked: (cx) => cx.mcp.$isEnabled.get(), run: (cx) => void cx.mcp.setEnabled(!cx.mcp.$isEnabled.get()) },
	{
		id: 'help.connectClaude',
		title: connectTitle('claude', false),
		currentTitle: (cx) => connectTitle('claude', cx.mcp.$connections.get().claude),
		section: 'Agent',
		keywords: 'ai agent claude code mcp disconnect remove terminal',
		isEnabled: (cx) => cx.mcp.$connecting.get() == null,
		run: (cx) => void cx.mcp.toggleConnection('claude')
	},
	{
		id: 'help.connectCodex',
		title: connectTitle('codex', false),
		currentTitle: (cx) => connectTitle('codex', cx.mcp.$connections.get().codex),
		section: 'Agent',
		keywords: 'ai agent openai mcp disconnect remove terminal',
		isEnabled: (cx) => cx.mcp.$connecting.get() == null,
		run: (cx) => void cx.mcp.toggleConnection('codex')
	},
	{ id: 'help.copyMcpCommand', title: 'Copy Command for Other Apps', section: 'Agent', keywords: 'ai agent connect mcp stdio server clipboard', run: (cx) => void cx.mcp.copyServerCommand() },
	{ id: 'agent.showFolder', title: 'Show Agent Folder', section: 'Agent', keywords: 'ai references notes runs scratch finder', isEnabled: hasProject, run: (cx) => void cx.showAgentFolder() },
	{ id: 'film.packs', title: 'Packs…', section: 'File', keywords: 'themes skins decor library browse import export add remove starter community share file look', run: (cx) => cx.library.$isPacksOpen.set(true) },
	// An agent's ways to the same, with their arguments; a person has Packs…
	{ id: 'film.addPack', title: 'Add Pack', section: 'File', isForAgents: true, run: (cx) => cx.library.$isPacksOpen.set(true) },
	{ id: 'film.exportPack', title: 'Export Pack', section: 'File', isForAgents: true, isEnabled: hasProject, run: (cx) => cx.library.openExportPack() }
];

export type TCommandId =
	| 'file.new'
	| 'file.open'
	| 'file.close'
	| 'file.save'
	| 'file.saveAs'
	| 'file.revert'
	| 'file.importMidi'
	| 'file.replaceSong'
	| 'file.removeSong'
	| 'file.export'
	| 'film.editInBlender'
	| 'film.restartBlender'
	| 'film.renderPreview'
	| 'film.addText'
	| 'film.resetToTrack'
	| 'film.regenerateCamera'
	| 'camera.addShot'
	| 'light.add'
	| 'decor.scatter'
	| 'decor.add'
	| 'film.deleteTheme'
	| 'film.cancelExport'
	| 'edit.undo'
	| 'edit.redo'
	| 'edit.rename'
	| 'edit.delete'
	| 'edit.selectAll'
	| 'edit.deselect'
	| 'edit.firstProblem'
	| 'view.track'
	| 'view.film'
	| 'view.sidebar'
	| 'view.inspector'
	| 'view.timeline'
	| 'view.zoomIn'
	| 'view.zoomOut'
	| 'view.zoom100'
	| 'view.fitAll'
	| 'view.fitSelection'
	| 'view.showHitboxes'
	| 'view.follow'
	| 'view.audioScrubbing'
	| 'play.toggle'
	| 'play.start'
	| 'play.previousHit'
	| 'play.nextHit'
	| 'play.repeat'
	| 'play.tap'
	| 'tool.select'
	| 'tool.hand'
	| 'tool.path'
	| 'view.snap'
	| 'view.track3d'
	| 'view.trackCamera'
	| 'build.next'
	| 'build.track'
	| 'build.rebuildFrom'
	| 'build.stop'
	| 'build.repeat'
	| 'build.mirror'
	| 'build.continue'
	| 'build.dismiss'
	| 'build.fix'
	| 'piece.playNote'
	| 'piece.follow'
	| 'edit.copy'
	| 'edit.paste'
	| 'edit.duplicate'
	| 'edit.group'
	| 'edit.ungroup'
	| 'edit.flatten'
	| 'edit.makeBacking'
	| 'piece.detach'
	| 'marble.add'
	| 'marble.addSuggestedHits'
	| 'film.fitToSong'
	| 'film.format'
	| 'film.theme'
	| 'view.draftPreview'
	| 'layer.wall'
	| 'layer.keyLight'
	| 'layer.camera'
	| 'layer.song'
	| 'marble.speed'
	| 'tool.platform'
	| 'tool.tunnel'
	| 'tool.windmill'
	| 'tool.bowl'
	| 'build.addBowl'
	| 'tool.insert'
	| 'help.quickHelp'
	| 'help.resetHints'
	| 'help.enableMcp'
	| 'help.connectClaude'
	| 'help.connectCodex'
	| 'help.copyMcpCommand'
	| 'agent.showFolder'
	| 'film.packs'
	| 'film.addPack'
	| 'film.exportPack';

export function getCommand(id: TCommandId): TCommand {
	const command = commands.find((item) => item.id === id);
	if (command == null) throw new Error(`Unknown command ${id}`);
	return command;
}

/** The workspace a command acts in, or null when it works in both */
export function commandWorkspace(command: TCommand): TWorkspace | null {
	if (command.workspace !== undefined) return command.workspace;
	if (command.section === 'Tools' || command.section === 'Track') return 'track';
	if (command.section === 'Film') return 'film';
	return null;
}

/**
 * Runs a command from the other workspace by opening that workspace first, as the palette's dimmed results
 * promise. Track commands wait for the canvas to mount; one that is not enabled once there does nothing.
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
	if (target === 'film' || cx.$trackCx.get() != null) {
		onNextFrame(runWhenReady);
		return;
	}
	// The canvas registers itself once mounted; give up after a second rather than run late
	let isDone = false;
	const stop = cx.$trackCx.listen(({ value }) => {
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
/** What a command reads as right now */
export function commandTitle(cx: StudioCx, command: TCommand): string {
	return command.currentTitle?.(cx) ?? command.title;
}

export function commandItem(cx: StudioCx, id: TCommandId): TMenuItem {
	const command = getCommand(id);
	return {
		label: commandTitle(cx, command),
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

/** One piece selected that plays on time and has no problem: Fix has nothing to do for it */
function isOnlyOnTimePiece(cx: StudioCx): boolean {
	const project = cx.project;
	const result = cx.simulation.$result.get();
	const [only, ...others] = cx.$selection.get();
	if (project == null || result == null || only == null || others.length > 0 || result.revision !== project.revision) return false;
	const hit = result.hits.find((item) => item.pieceEntityId === only);
	return hit?.status === 'onTime' && !problemPieces(project, result).includes(only);
}

export function deleteSelectedHits(cx: StudioCx): boolean {
	const project = cx.project;
	if (project == null) return false;
	const decorIds = selectedDecorIds(cx.$selection.get());
	if (inFilm(cx) && decorIds.length > 0) {
		const applied = cx.execute(deleteDecorCommands(project, decorIds));
		if (applied) cx.$selection.set([]);
		return applied;
	}
	const lightIds = selectedLightIds(cx);
	if (inFilm(cx) && lightIds.length > 0) {
		const applied = cx.execute(deleteLightsCommands(project, lightIds));
		if (applied) cx.$selection.set([]);
		return applied;
	}
	const shotIds = selectedShotIds(cx);
	if (shotIds.length > 0) {
		const applied = cx.execute(removeShotsCommands(project, shotIds));
		if (applied) cx.$selection.set([]);
		return applied;
	}
	const titleIds = selectedTitleIds(cx);
	if (inFilm(cx) && titleIds.length > 0) {
		const applied = cx.execute([{ type: 'removeEntities', entityIds: titleIds }]);
		if (applied) cx.$selection.set([]);
		return applied;
	}
	return removeSelectedHits(cx, cx.$selection.get(), $rollHasFocus.get());
}

/** Selects a layer of Film by name */
function selectLayerCommand(id: TCommandId, title: string, key: string, keywords: string): TCommand {
	return { id, title, section: 'Film', keywords, isEnabled: hasProject, run: (cx) => cx.$selection.set([key]) };
}

/** A setting of Film's Scene inspector: selects the Scene, shows the inspector and focuses the field */
function focusSceneField(cx: StudioCx, id: string): void {
	cx.$selection.set([]);
	cx.$panels.set({ ...cx.$panels.get(), inspector: true });
	onNextFrame(() => onNextFrame(() => document.getElementById(id)?.focus()));
}

/** Gravity sits in Track's Scene inspector: clear the selection, show the inspector and focus the value */
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

