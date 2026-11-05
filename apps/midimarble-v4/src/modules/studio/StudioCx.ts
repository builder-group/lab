import { createState } from 'feature-state';
import type { TResult } from 'tuple-result';
import { isTauri } from '@tauri-apps/api/core';
import { host, notSongFileMessage, songFileKind, specta, type THostPickedFile, type THostRecentProject } from '@/environment';
import { audibleProject, autoEnd, changesHitsOnly, changesTail, createAudioEngine, DEFAULT_PROJECT_END, EMPTY_MIX, endsOnBowl, isAutoEnd, projectSongEnd, soundsNotes, startingLength, type TAudioEngine, type TSongMix } from '@/modules/music';
import {
	amendHistory,
	applyProjectCommands,
	createHistory,
	createId,
	createLane,
	createMarble,
	createProject,
	LANE_SPACING,
	isPatternGroup,
	parseProject,
	pushHistory,
	redoHistory,
	serializeProject,
	undoHistory,
	type TLane,
	type TProject,
	type TProjectCommand,
	type TProjectHistory,
	type TSource,
	type TVec2
} from '@/modules/project';
import type { TClipboard } from './clipboard';
import { editLabel } from './edit-label';
import { hasUnsavedChanges, saveChangesQuestion, savePanelTitle } from './document';
import { shownRepeatRange, toggledRepeatRange, type TRepeatRange, type TRepeatSpan } from './repeat-range';
import { fittedSongEnd } from '@/modules/camera/bowl-exit';
import { BOWL_TYPE } from '@/modules/simulation/bowl';
import { HintsCx } from './HintsCx';
import { renumberDefaultNames } from './piece-order-names';
import { selectionEnteringFilm } from './inspector-target';
import { KEY_LIGHT_ID, parseDecorKey, parseGroupKey, parseHitKey, parseLightKey, stepHitTarget, toHitKey } from './selection';
import { tapTime } from './tap';
import type { THitFlash } from './timeline/hit-flash';
import { SimulationCx } from './SimulationCx';
import { SourcesCx } from './SourcesCx';
import type { ComposeCx } from '@/modules/compose/ComposeCx';
import { withWholePatterns } from '@/modules/compose/PatternsCx';
import { earliestHitTime, releaseFollowsFirstHit } from '@/modules/compose/reachability';
import type { TView } from '@/modules/compose/view';
import { McpCx } from '@/modules/mcp/McpCx';
import { addWallTextCommands, defaultTitleColor, DesignCx, DesignLibraryCx, FilmExportCx, frameHeightOnWall, previewPointToWall, withTitleStyle, type TTitleStyle } from '@/modules/design';
import { songDisplayName } from '@/modules/design/titles';
import { preflightExport, problemSummary, type TPreflightTarget } from '@/modules/design/export-preflight';

export interface TAgentStepNotice {
	message: string;
	tone: TNotice['tone'];
}

type THostReferences = specta.AgentReferencesDto;

const NO_REFERENCES: THostReferences = { images: [], text: '' };

/** Owns the open project, its history, persistence and the shared editing state of the studio */
export class StudioCx {
	readonly $history = createState<TProjectHistory | null>(null);
	readonly $path = createState<string | null>(null);
	readonly $save = createState<TSaveState>('saved');
	readonly $recent = createState<THostRecentProject[]>([]);
	/**
	 * Whether the open project is an unsaved document in the host's temporary location, such as an opened example.
	 * It autosaves there, stays out of Recent, and Save asks where to keep it.
	 */
	readonly $isTemporary = createState(false);
	/** The Save Changes alert of an unsaved document with changes that is being closed */
	readonly $closePrompt = createState<TClosePrompt | null>(null);
	/** A confirmation alert such as "Delete Jingle Bells and its 40 Backing notes?" · Delete · Cancel */
	readonly $confirmPrompt = createState<TConfirmPrompt | null>(null);
	/** Quick Help labels the window's regions and explains the control under the pointer. Always off at launch. */
	readonly $quickHelp = createState(false);
	readonly $workspace = createState<TWorkspace>('compose');
	/** Track's canvas: flat and precise, a free look around in 3D, or through the film's camera */
	readonly $trackView = createState<TTrackView>('2d');
	/** The angle Track's 3D view last had, in radians */
	readonly $trackAngles = createState<TTrackAngles>({ yaw: -0.6, pitch: 0.3 });
	readonly $selection = createState<TSelection>([]);
	readonly $playhead = createState(0);
	readonly $playing = createState(false);
	/** Repeat Range: the range on the ruler that playback loops. A preview for this session, never saved. */
	readonly $repeatRange = createState<TRepeatRange | null>(null);
	/** Fit the Wall view to the first open hits, once playback stopped and the run for the latest edit arrived */
	readonly $fitFirstHits = createState(false);
	/** The Wall view Compose showed before Film replaced it, so coming back keeps it, like a page's view in Figma */
	composeView: { projectId: string; view: TView } | null = null;
	/** The playback T started: whether the length followed the song then, and whether a tap added a hit */
	private tapSession: { isAutoEnd: boolean; hasTapped: boolean } | null = null;
	private tailTimer: ReturnType<typeof setTimeout> | null = null;
	readonly $notice = createState<TNotice | null>(null);
	/**
	 * Selection keys and an optional wall point the Compose canvas should bring into view, set by lists
	 * outside the canvas. The canvas clears it once handled, so a reveal sent from Design waits for Compose.
	 */
	readonly $reveal = createState<TReveal | null>(null);
	/** Counts `seek` calls; the canvas brings the marble at the playhead into view on each */
	readonly $playheadReveal = createState(0);
	/** The revision the last undo or redo landed on, whose run no notice speaks about */
	readonly $historyReveal = createState<{ revision: number } | null>(null);
	readonly $panels = createState<Record<TStudioPanel, boolean>>({ sidebar: true, inspector: true, timeline: true });
	// Zero fits the timeline to its lanes until the user drags it to a height of their own
	readonly $timelineHeight = createState(readNumber(TIMELINE_HEIGHT_KEY, 0));
	readonly $paletteOpen = createState(false);
	/** Muted and soloed Parts of the Song. View state, not saved; each opened project starts with everything on. */
	readonly $mix = createState<TSongMix>(EMPTY_MIX);
	/** The hits a marble just landed while playing, for their dots to flash (`useHitFlash`) */
	readonly $hitFlash = createState<THitFlash[]>([]);
	/** The mounted Compose canvas, so commands and menus outside it can drive its tools */
	readonly $compose = createState<ComposeCx | null>(null);
	/** Marble entity, lane or piece whose name is being edited in place in the sidebar */
	readonly $renaming = createState<string | null>(null);
	/** Pieces hidden from the canvas and locked against canvas edits, like Figma's layer toggles. View state, not saved. */
	readonly $hidden = createState<string[]>([]);
	/** What ⌘C kept, for ⌘V; it lasts while the app runs, also into another project */
	readonly $clipboard = createState<TClipboard | null>(null);
	readonly $locked = createState<string[]>([]);
	/** Dropping an element links it to a hit dot or anchors it to a trajectory, like Figma's snapping */
	readonly $snapping = createState(true);
	/** Film outlines every piece's hitbox, like Unity's collider gizmos; a selected piece always shows its own */
	readonly $showHitboxes = createState(false);
	/** Dragging the playhead on the ruler plays the song where it is, like Logic's Scrub. Remembered on this Mac. */
	readonly $audioScrubbing = createState(readText(AUDIO_SCRUBBING_KEY) !== 'off');
	readonly sources = new SourcesCx(this);
	readonly hints = new HintsCx(this);
	readonly simulation = new SimulationCx(this);
	readonly design = new DesignCx({
		getProject: () => this.project,
		getResult: () => this.simulation.$result.get(),
		getPackagePath: () => this.$path.get(),
		getPlayhead: () => this.$playhead.get(),
		isPlaying: () => this.$playing.get()
	});
	readonly library = new DesignLibraryCx({
		getPackagePath: () => this.$path.get(),
		getProject: () => this.project,
		getResult: () => this.simulation.$result.get(),
		execute: (commands) => this.execute(commands),
		notify: (message, tone) => this.notify(message, tone)
	});
	readonly film = new FilmExportCx({
		getProject: () => this.project,
		getMix: () => this.$mix.get(),
		getPackagePath: () => this.$path.get(),
		resolveSourceUrl: (source) => this.resolveSourceUrl(source),
		design: this.design
	});
	readonly mcp = new McpCx(this);
	/** The project's References: images and words in `agent/references/` */
	readonly $references = createState<THostReferences>(NO_REFERENCES);
	private audioEngine: TAudioEngine | null = null;
	private agentStep: { group: number; notices: TAgentStepNotice[]; didEdit: boolean } | null = null;
	private agentSteps = 0;
	/** Names of the Undo steps by their history group: an agent's, and a person's from what the edit changed */
	private readonly stepLabels = new Map<number, string>();

	private isRestoring = false;
	private saveTimer: ReturnType<typeof setTimeout> | undefined;
	private savedRevision = 0;
	/** The project as it opened, for Revert to Opened */
	private openedProject: TProject | null = null;
	/** The first save after opening keeps the file it overwrites */
	private needsPreviousSave = false;
	private noticeTimer: ReturnType<typeof setTimeout> | undefined;
	private answerClosePrompt: ((choice: TClosePromptChoice) => void) | null = null;
	private answerConfirmPrompt: ((isConfirmed: boolean) => void) | null = null;

	get project(): TProject | null {
		return this.$history.get()?.present ?? null;
	}

	mount(): () => void {
		void this.refreshRecent();
		void this.restoreOpenProject();
		const unmountSimulation = this.simulation.mount();
		const unmountDesign = this.mountDesign();
		const unmountHints = this.hints.mount();
		const unmountMcp = this.mcp.mount();
		const stopHeight = this.$timelineHeight.listen(({ value }) => writeNumber(TIMELINE_HEIGHT_KEY, value));
		const stopNotices = this.$history.listen(() => this.retireFixNotice());
		// Tapping along belongs to the playback T started, so stopping playback finishes the tap session
		const stopTapSessionListener = this.$playing.listen(({ value }) => {
			if (value) return;
			this.finishTapSession();
		});
		return () => {
			unmountSimulation();
			unmountDesign();
			unmountHints();
			unmountMcp();
			stopHeight();
			stopNotices();
			stopTapSessionListener();
			void this.design.close();
			clearTimeout(this.noticeTimer);
			this.audioEngine?.dispose();
			void this.flush();
		};
	}

	/** Keeps the Design preview at the playhead while the Design workspace is open */
	private mountDesign(): () => void {
		const inDesign = (): boolean => this.$workspace.get() === 'design' && this.project != null;
		// The title bar's Blender chip shows whether Blender is installed in Compose too
		void this.design.detect();
		this.design.live.setActive(this.$workspace.get() === 'design');
		const stops = [
			this.$workspace.listen(({ value }) => {
				// Background preview frames render only while Film is open
				this.design.live.setActive(value === 'design');
				if (value !== 'design') return;
				this.selectEnteringFilm();
				void this.design.activate();
				void this.library.refresh(false);
			}),
			// Runs and library items belong to the package
			this.$path.listen(() => {
				void this.design.detect();
				void this.library.refresh();
				void this.refreshReferences();
			}),
			this.$playhead.listen(() => {
				if (inDesign() && !this.$playing.get()) {
					this.design.live.pauseForWork();
					this.design.requestPreview();
				}
			}),
			this.$playing.listen(({ value }) => {
				if (inDesign()) this.design.live.pauseForWork();
				if (inDesign() && !value) this.design.requestPreview();
			}),
			this.simulation.$result.listen(() => {
				if (inDesign()) this.design.live.pauseForWork();
				if (inDesign() && !this.$playing.get()) this.design.requestPreview(400);
			}),
			watchForWork(() => {
				if (inDesign()) this.design.live.pauseForWork();
			})
		];
		return () => {
			for (const stop of stops) stop();
		};
	}

	/** Created on first use because WebKit only allows audio after a user gesture */
	get audio(): TAudioEngine {
		this.audioEngine ??= createAudioEngine();
		return this.audioEngine;
	}

	resolveSourceUrl = (source: TSource): string | null => {
		const path = this.$path.get();
		return path == null ? null : host.sourceUrl(path, source.path);
	};

	/**
	 * Plays a note of the Song as feedback when it is placed or selected. The Song is the only sound, so a tapped hit
	 * has nothing to play, and neither has a project without a Song or with a recording, which has no notes to pick.
	 */
	audition(laneId: string, pitch?: number): void {
		const project = this.project;
		const lane = project?.music.lanes.find((item) => item.id === laneId);
		if (project == null || lane == null || pitch == null || !soundsNotes(project)) return;
		void this.audio.audition(lane, pitch);
	}

	toggleAudioScrubbing(): void {
		const isOn = !this.$audioScrubbing.get();
		this.$audioScrubbing.set(isOn);
		writeText(AUDIO_SCRUBBING_KEY, isOn ? 'on' : 'off');
	}

	/**
	 * Starts hearing a playhead drag, from the press, which is the gesture WebKit asks for. What plays is the soundtrack
	 * with the Parts' mute and solo. While playing, a drag already restarts playback at each position, so it adds nothing.
	 */
	beginAudioScrub(): void {
		const project = this.project;
		if (project == null || this.$playing.get() || !this.$audioScrubbing.get()) return;
		this.audio.beginScrub(audibleProject(project, this.$mix.get()), this.resolveSourceUrl).catch((error: unknown) => {
			this.notify(`Playback failed: ${(error as Error).message}`, 'error');
		});
	}

	audioScrubTo(time: number): void {
		this.audioEngine?.scrubTo(time);
	}

	endAudioScrub(): void {
		this.audioEngine?.endScrub();
	}

	/**
	 * Places wall text where the preview was clicked, in 0..1 image coordinates, and selects it so the
	 * inspector can edit it
	 */
	placeWallText(u = 0.5, v = 0.5): void {
		const project = this.project;
		if (project == null) return;
		this.design.$placing.set(null);
		const result = this.simulation.$result.get();
		const time = this.$playhead.get();
		const point = previewPointToWall(project, result, time, u, v);
		const { commands, entityId } = addWallTextCommands(point, { color: defaultTitleColor(project.design), frameHeight: frameHeightOnWall(project, result, time) });
		if (!this.execute(commands)) return;
		this.$selection.set([entityId]);
		// Typing starts at once, like Figma's text tool: the inspector focuses the Text field with its contents selected
		this.design.$editingTitle.set(entityId);
	}

	/** A new Caption, Song Name or End Card at its default timing, selected, with its text ready to type */
	addScreenTitle(style: TTitleStyle): void {
		const project = this.project;
		if (project == null) return;
		this.design.$placing.set(null);
		const result = this.simulation.$result.get();
		const playhead = this.$playhead.get();
		const frameHeight = frameHeightOnWall(project, result, playhead);
		const { commands, entityId } = addWallTextCommands(previewPointToWall(project, result, playhead, 0.5, 0.5), { color: defaultTitleColor(project.design), frameHeight });
		const styled = commands.flatMap((command) => {
			if (command.type !== 'upsertEntity' || command.entity.components.wallText == null) return [command];
			const wallText = withTitleStyle(command.entity.components.wallText, style, { frameHeight, playhead, end: project.end, songName: songDisplayName(project), aspect: project.frame.width / project.frame.height });
			return [{ ...command, entity: { ...command.entity, name: wallText.text, components: { ...command.entity.components, wallText } } }];
		});
		if (!this.execute(styled)) return;
		// Keep the new title in view: a Song Name opens the film and an End Card closes it, wherever the playhead is
		const text = styled.flatMap((command) => (command.type === 'upsertEntity' && command.entity.id === entityId ? [command.entity.components.wallText] : []))[0];
		if (text != null && (playhead < (text.in ?? 0) || playhead >= (text.out ?? project.end))) this.$playhead.set(text.in ?? 0);
		this.$workspace.set('design');
		this.$selection.set([entityId]);
		this.design.$editingTitle.set(entityId);
	}

	/** Film opens on the Scene with its theme in view, unless a layer Film is about stays selected */
	private selectEnteringFilm(): void {
		const project = this.project;
		if (project == null) return;
		const selection = this.$selection.get();
		const kept = selectionEnteringFilm(project, selection);
		if (kept.length !== selection.length) this.$selection.set(kept);
	}

	/** Selects entities and asks the canvas to frame them when they are out of view */
	reveal(ids: string[], point?: TVec2): void {
		this.$selection.set(ids);
		this.$reveal.set({ ids, point });
	}

	/**
	 * Shows a problem like a click in Xcode's issue navigator: closes the export sheet, moves the playhead to the
	 * problem and selects and frames what it is about, in Compose, or in Film with the Camera for framing problems
	 */
	revealIssue(target: TPreflightTarget): void {
		this.film.closeSheet();
		this.$playing.set(false);
		this.$workspace.set(target.workspace ?? 'compose');
		if (target.workspace === 'design') this.$selection.set(target.ids);
		else {
			this.$selection.set(target.ids);
			this.$reveal.set({ ids: target.ids, point: target.point, isFramed: true });
		}
		// After the selection, which moves the playhead to a selected piece's own hit
		if (target.time != null) this.$playhead.set(target.time);
	}

	/** Show First Problem: the earliest problem of the hit summary, or a notice when there is none */
	showFirstProblem(): void {
		const project = this.project;
		if (project == null) return;
		const summary = problemSummary(preflightExport(project, this.simulation.$result.get()));
		if (summary.state === 'pending') {
			this.notify('Checking the track…');
			return;
		}
		const first = summary.problems[0];
		if (first?.target == null) {
			this.notify(summary.problems.length > 0 ? (first?.title ?? summary.label) : `No problems: ${summary.label}`);
			return;
		}
		this.revealIssue(first.target);
	}

	// MARK: - Projects

	async refreshRecent(): Promise<void> {
		this.$recent.set(await host.listRecentProjects());
	}

	/** `prepare` fills the new package before the project opens, such as an example's song files */
	async newProject(
		options: { title?: string; project?: TProject; prepare?: (packagePath: string) => Promise<TResult<void, Error>>; path?: string } = {}
	): Promise<boolean> {
		const project = options.project ?? createProject({ title: options.title ?? 'Untitled' });
		// A new project opens straight away, unsaved like an example; the first Save asks where to keep it
		if (options.path == null) return this.openTemporary(project, options.prepare);
		if (!(await this.confirmClose())) return false;
		const path = options.path;
		const title = path.split('/').pop()?.replace(/\.marble$/, '') ?? project.title;
		const named = { ...project, title };
		const [isCreatedOk, createdErr, created] = await host.createProject(path, serializeProject(named));
		if (!isCreatedOk) {
			this.notify(createdErr.message, 'error');
			return false;
		}
		if (options.prepare != null) {
			// The project still opens without the files; the song then shows as missing
			const [isPreparedOk, preparedErr] = await options.prepare(created.path);
			if (!isPreparedOk) this.notify(preparedErr.message, 'error');
		}
		this.load(named, created.path);
		return true;
	}

	/**
	 * Opens a project as an unsaved document in the host's temporary location, like an example: it is not added to
	 * Recent, and Save asks where to keep it. `prepare` fills the package first, such as with the example's song.
	 */
	async openTemporary(project: TProject, prepare?: (packagePath: string) => Promise<TResult<void, Error>>): Promise<boolean> {
		if (!(await this.confirmClose())) return false;
		const [isCreatedOk, createdErr, created] = await host.createTemporaryProject(project.title, serializeProject(project));
		if (!isCreatedOk) {
			this.notify(`${project.title} couldn't be opened: ${createdErr.message}`, 'error');
			return false;
		}
		if (prepare != null) {
			const [isPreparedOk, preparedErr] = await prepare(created.path);
			if (!isPreparedOk) this.notify(preparedErr.message, 'error');
		}
		this.load(project, created.path, true);
		return true;
	}

	/** Import Song… on the start screen: a new project named after the song file, then the import */
	async newProjectFromSong(): Promise<void> {
		const file = await host.chooseSourceFile('song');
		if (file == null) return;
		if (songFileKind(file.name) == null) {
			this.notify(notSongFileMessage(file.name), 'error');
			return;
		}
		if (await this.newProject({ title: file.name.replace(/\.[^.]+$/, '') })) await this.importSongFile(file);
	}

	/** Import Song…: one panel for a MIDI file or a recording; the import replaces the current song */
	async importSong(): Promise<void> {
		const file = await host.chooseSourceFile('song');
		if (file != null) await this.importSongFile(file);
	}

	async importSongFile(file: THostPickedFile): Promise<void> {
		const kind = songFileKind(file.name);
		if (kind === 'midi') await this.sources.openMidi(file);
		else if (kind === 'audio') await this.sources.importAudio(file);
		else this.notify(notSongFileMessage(file.name), 'error');
	}

	async openProject(path?: string): Promise<boolean> {
		if (!(await this.confirmClose())) return false;
		const target = path ?? (await host.chooseProjectToOpen());
		if (target == null) return false;
		const [isOpenedOk, openedErr, opened] = await host.openProject(target);
		if (!isOpenedOk) {
			this.notify(openedErr.message, 'error');
			return false;
		}
		const [isProjectOk, projectErr, project] = parseProject(opened.projectJson);
		if (!isProjectOk) {
			this.notify(projectErr.message, 'error');
			return false;
		}
		this.load(project, opened.path);
		return true;
	}

	/**
	 * Like macOS window restoration: the document that was open when the app quit or reloaded opens again. A moved
	 * or deleted package leaves the start screen
	 */
	private async restoreOpenProject(): Promise<void> {
		const path = readText(OPEN_PROJECT_KEY);
		if (path == null || this.isRestoring || this.$history.get() != null) return;
		this.isRestoring = true;
		const [isOpenedOk, , opened] = await host.openProject(path);
		const [isProjectOk, , project] = isOpenedOk ? parseProject(opened.projectJson) : [false, null, null];
		const isTemporary = isOpenedOk && (await host.isTemporaryProject(opened.path));
		this.isRestoring = false;
		if (!isOpenedOk || !isProjectOk || project == null) {
			writeText(OPEN_PROJECT_KEY, null);
			return;
		}
		if (this.$history.get() == null) this.load(project, opened.path, isTemporary);
	}

	/** Returns false when the user cancels closing an unsaved document with changes */
	async closeProject(): Promise<boolean> {
		if (!(await this.confirmClose())) return false;
		const path = this.$path.get();
		const isTemporary = this.$isTemporary.get();
		writeText(OPEN_PROJECT_KEY, null);
		await this.flush();
		await this.design.close();
		if (isTemporary && path != null) host.discardTemporaryProject(path);
		this.$isTemporary.set(false);
		this.$history.set(null);
		this.$path.set(null);
		this.$selection.set([]);
		this.$playhead.set(0);
		this.$playing.set(false);
		await this.refreshRecent();
		return true;
	}

	/** Whether the open project is an unsaved document with changes, which closing would lose */
	hasUnsavedChanges(): boolean {
		const history = this.$history.get();
		return this.$isTemporary.get() && history != null && hasUnsavedChanges(history);
	}

	/**
	 * Save (⌘S). A saved project writes at once. An unsaved document asks where to save it with the save panel and
	 * moves its package there with every file, so it continues as a project in Recent. Returns false when canceled
	 * or failed.
	 */
	async save(chosenPath?: string): Promise<boolean> {
		if (!this.$isTemporary.get()) {
			await this.flush();
			return this.$save.get() !== 'failed';
		}
		const project = this.project;
		const from = this.$path.get();
		if (project == null || from == null) return false;
		const destination = chosenPath ?? (await host.chooseNewProjectPath(project.title, savePanelTitle(project.title)));
		if (destination == null) return false;
		await this.flush();
		if (this.$save.get() === 'failed') return false;
		// Blender's worker holds the package path; it starts again at the new place
		const wasInFilm = this.$workspace.get() === 'design';
		await this.design.close();
		const [isMovedOk, movedErr, path] = await host.moveProject(from, destination);
		if (!isMovedOk) {
			this.notify(`${project.title} couldn't be saved: ${movedErr.message}. It stays open as an unsaved project.`, 'error');
			if (wasInFilm) void this.design.activate();
			return false;
		}
		this.$isTemporary.set(false);
		this.$path.set(path);
		writeText(OPEN_PROJECT_KEY, path);
		this.retitle(projectName(path));
		if (wasInFilm) void this.design.activate();
		void this.refreshRecent();
		return true;
	}

	/**
	 * Save As… (⇧⌘S). An unsaved document saves as with Save. A saved project is copied with its files to the chosen
	 * place and the copy stays open, as in macOS; the original keeps its last autosave. Returns false when canceled
	 * or failed.
	 */
	async saveAs(chosenPath?: string): Promise<boolean> {
		if (this.$isTemporary.get()) return this.save(chosenPath);
		const project = this.project;
		const from = this.$path.get();
		if (project == null || from == null) return false;
		const destination = chosenPath ?? (await host.chooseNewProjectPath(project.title, 'Save As'));
		if (destination == null) return false;
		await this.flush();
		if (this.$save.get() === 'failed') return false;
		const [isCopiedOk, copiedErr, path] = await host.copyProject(from, destination);
		if (!isCopiedOk) {
			this.notify(`${project.title} couldn't be saved as a copy: ${copiedErr.message}`, 'error');
			return false;
		}
		// Blender's worker holds the package path; it starts again with the copy
		const wasInFilm = this.$workspace.get() === 'design';
		await this.design.close();
		this.$path.set(path);
		writeText(OPEN_PROJECT_KEY, path);
		this.retitle(projectName(path));
		if (wasInFilm) void this.design.activate();
		void this.refreshRecent();
		return true;
	}

	/** Clear Menu in Open Recent */
	async clearRecent(): Promise<void> {
		await host.clearRecentProjects();
		await this.refreshRecent();
	}

	/** The title follows the saved file's name, like a macOS document, in every undo step so undo keeps it */
	private retitle(title: string): void {
		const history = this.$history.get();
		if (history == null || history.present.title === title) return;
		const named = (item: TProject): TProject => ({ ...item, title });
		this.$history.set({
			...history,
			past: history.past.map(named),
			present: { ...named(history.present), revision: history.present.revision + 1 },
			future: history.future.map(named)
		});
		this.scheduleSave();
	}

	/**
	 * Before an unsaved document with changes closes, asks "Save changes to Jingle Bells?" with Save…, Don't Save
	 * and Cancel. Resolves true when closing may go on. Unchanged documents close without asking.
	 */
	private async confirmClose(): Promise<boolean> {
		const project = this.project;
		if (project == null || !this.hasUnsavedChanges()) return true;
		this.answerClosePrompt?.('cancel');
		const choice = await new Promise<TClosePromptChoice>((resolve) => {
			this.answerClosePrompt = resolve;
			this.$closePrompt.set({ question: saveChangesQuestion(project.title) });
		});
		this.answerClosePrompt = null;
		this.$closePrompt.set(null);
		if (choice === 'cancel') return false;
		if (choice === 'save') return this.save();
		return true;
	}

	/** The Save Changes alert's buttons */
	answerClose(choice: TClosePromptChoice): void {
		this.answerClosePrompt?.(choice);
	}

	/**
	 * Asks a question naming the thing with the action as its button, like a macOS alert. Resolves true when the
	 * action is chosen; a newer question cancels an open one.
	 */
	async confirm(prompt: TConfirmPrompt): Promise<boolean> {
		this.answerConfirmPrompt?.(false);
		const isConfirmed = await new Promise<boolean>((resolve) => {
			this.answerConfirmPrompt = resolve;
			this.$confirmPrompt.set(prompt);
		});
		this.answerConfirmPrompt = null;
		this.$confirmPrompt.set(null);
		return isConfirmed;
	}

	/** The confirmation alert's buttons */
	answerConfirm(isConfirmed: boolean): void {
		this.answerConfirmPrompt?.(isConfirmed);
	}

	private load(project: TProject, path: string, isTemporary = false): void {
		const previous = this.$path.get();
		// An unsaved document that another project replaces was closed with Don't Save or had no changes
		if (this.$isTemporary.get() && previous != null && previous !== path) host.discardTemporaryProject(previous);
		this.$isTemporary.set(isTemporary);
		this.savedRevision = project.revision;
		this.stepLabels.clear();
		this.openedProject = project;
		this.needsPreviousSave = !isTemporary;
		this.$history.set(createHistory(project));
		this.$mix.set(EMPTY_MIX);
		this.$path.set(path);
		writeText(OPEN_PROJECT_KEY, path);
		this.$save.set('saved');
		this.$selection.set([]);
		this.$hidden.set([]);
		this.$locked.set([]);
		this.$playhead.set(0);
		this.$workspace.set('compose');
		this.$trackView.set('2d');
		this.sources.$analysis.set({});
		this.sources.ensureAnalysis(project);
		void this.refreshRecent();
	}

	// MARK: - Editing

	/**
	 * Applies commands as one undoable edit and schedules an autosave. `amend` folds them into the
	 * latest edit instead, for refinements that arrive a moment after the edit they belong to. `group`
	 * folds them into the latest edit only while it is the edit of that group (see `editGroup`), so a
	 * multi-step edit stays one undo step and never swallows an edit the user made in between. `label` names the step in
	 * Edit > Undo; without it the name comes from what changed (`editLabel`), and a step keeps its first name.
	 */
	execute(commands: TProjectCommand[], options: { amend?: boolean; group?: number; label?: string } = {}): boolean {
		const history = this.$history.get();
		if (history == null || !commands.length) return false;
		const [isEditOk, editErr, edited] = applyProjectCommands(history.present, commands);
		if (!isEditOk) {
			this.notify(editErr.message, 'error');
			return false;
		}
		// Default piece names follow time order, so a new piece for an earlier hit takes the lower number
		let named = releaseFollowsFirstHit(history.present, renumberDefaultNames(history.present, edited), commands);
		// While the length follows the song, it ends with the last hit, or with the catch once the last marble has a
		// Bowl; taps fit it once tapping stops
		if (this.tapSession == null && (changesHitsOnly(commands) || changesTail(commands, history.present, named))) {
			const end = autoEnd(history.present, named);
			if (end != null) named = { ...named, end };
		}
		if (this.agentStep != null) this.agentStep.didEdit = true;
		const next = options.amend === true ? amendHistory(history, named) : pushHistory(history, named, options.group ?? this.agentStep?.group);
		if (this.agentStep == null && options.amend !== true && !this.stepLabels.has(next.groups.present)) {
			const label = options.label ?? editLabel(history.present, named, commands);
			if (label != null) this.stepLabels.set(next.groups.present, label);
		}
		this.$history.set(next);
		this.scheduleSave();
		if (this.tapSession == null && changesBowlEnding(commands)) this.measureBowlTail();
		return true;
	}

	/**
	 * Runs an MCP tool's work as one named Undo step: every edit in it folds into one step that Edit > Undo and a notice
	 * name, like "Agent: Place Platform". Notices shown meanwhile are the tool's reply, in plain words.
	 */
	async runAgentStep(label: string, work: () => Promise<void>): Promise<{ stepName: string | null; notices: TAgentStepNotice[] }> {
		const step = { group: -++this.agentSteps, notices: [] as TAgentStepNotice[], didEdit: false };
		this.agentStep = step;
		try {
			await work();
		} catch (error) {
			step.notices.push({ message: (error as Error).message, tone: 'error' });
		} finally {
			this.agentStep = null;
		}
		const present = this.$history.get()?.groups.present;
		if (!step.didEdit || present == null) return { stepName: null, notices: step.notices };
		// A refinement of the last placement folds into that step, which keeps its name
		const stepName = this.stepLabels.get(present) ?? label;
		this.stepLabels.set(present, stepName);
		const said = step.notices.filter((notice) => notice.tone !== 'error').pop()?.message;
		this.notifyEdit(said != null ? `${stepName}: ${said}` : stepName);
		return { stepName, notices: step.notices };
	}

	/** An agent's tool call is running, whose edits fold into one named Undo step */
	get isInAgentStep(): boolean {
		return this.agentStep != null;
	}

	/** The name of the step Undo would take back, null without one */
	get undoLabel(): string | null {
		const present = this.$history.get()?.groups.present;
		return present != null ? (this.stepLabels.get(present) ?? null) : null;
	}

	/** The name of the step Redo would bring back, null without one */
	get redoLabel(): string | null {
		const next = this.$history.get()?.groups.future[0];
		return next != null ? (this.stepLabels.get(next) ?? null) : null;
	}

	async refreshReferences(): Promise<void> {
		const path = this.$path.get();
		this.$references.set(path != null && isTauri() ? await specta.commands.agentReferencesRead(path) : NO_REFERENCES);
	}

	/** Replaces the project's References with these images and words */
	async setReferences(paths: string[], text: string): Promise<void> {
		const path = this.$path.get();
		const project = this.project;
		if (path == null || project == null) return;
		const result = await specta.commands.agentReferencesSet(path, project.title, paths, text);
		if (result.status === 'error') {
			this.notify(result.error, 'error');
			return;
		}
		this.$references.set(result.data);
	}

	/** Names of the agent's Undo steps, latest first */
	get agentUndoSteps(): { group: number; name: string }[] {
		const groups = this.$history.get()?.groups;
		if (groups == null) return [];
		return [groups.present, ...[...groups.past].reverse()].flatMap((group) => {
			const name = this.stepLabels.get(group);
			return name != null ? [{ group, name }] : [];
		});
	}

	/** Show Agent Folder: the package's `agent/` in Finder, created on first use */
	async showAgentFolder(): Promise<void> {
		const path = this.$path.get();
		const project = this.project;
		if (path == null || project == null) return;
		const result = await specta.commands.agentFolderEnsure(path, project.title);
		if (result.status === 'error') {
			this.notify(`The agent folder couldn't be made: ${result.error}`, 'error');
			return;
		}
		const [isShownOk, shownErr] = await host.revealInFinder(result.data);
		if (!isShownOk) this.notify(shownErr.message, 'error');
	}

	/**
	 * Fit to Song: ends the film `filmTail` after the last note, measured on a what-if run when it ends on a Bowl.
	 * A newer edit in the meantime wins.
	 */
	async fitToSong(): Promise<void> {
		const history = this.$history.get();
		const project = history?.present;
		if (project == null) return;
		const client = this.simulation.assists;
		const end = client != null ? await fittedSongEnd(project, (trial) => client.simulateAssist(trial)) : projectSongEnd(project);
		if (end == null || this.$history.get()?.present !== project || Math.abs(end - project.end) < 0.005) return;
		this.execute([{ type: 'setEnd', end }]);
	}

	/**
	 * While the length follows the song and ends on a Bowl, an edit of the notes or the Bowl measures the tail in a
	 * what-if run shortly after and folds the length into that edit's undo step, so the length needs no run to be
	 * known at the edit itself. A newer edit restarts it.
	 */
	private measureBowlTail(): void {
		if (this.tailTimer != null) clearTimeout(this.tailTimer);
		this.tailTimer = setTimeout(() => {
			this.tailTimer = null;
			const project = this.project;
			const client = this.simulation.assists;
			if (project == null || client == null || !endsOnBowl(project) || !isAutoEnd(project)) return;
			void fittedSongEnd(project, (trial) => client.simulateAssist(trial)).then((end) => {
				if (end == null || this.project !== project || Math.abs(end - project.end) < 0.005) return;
				// The length following the song is no new edit, so the notice of the edit stays
				this.isRefittingEnd = true;
				this.execute([{ type: 'setEnd', end }], { amend: true });
				this.isRefittingEnd = false;
			});
		}, TAIL_MEASURE_DELAY);
	}

	/** The undo group of the latest edit, for folding later commands into it or binding a notice's Undo to it */
	get editGroup(): number | null {
		return this.$history.get()?.groups.present ?? null;
	}

	/** Adds a marble with its lane, released at `position` or to the right of the last marble */
	addMarble(position?: TVec2): string | null {
		const project = this.project;
		if (project == null) return null;
		const lane = createLane(project.music.lanes.length);
		const releases = project.entities.flatMap((entity) => (entity.components.release != null ? [entity.components.release.position] : []));
		const fallback = { x: releases.length ? Math.max(...releases.map((point) => point.x)) + LANE_SPACING : 0, y: releases[0]?.y ?? 0.6 };
		const marble = createMarble(lane, position ?? fallback);
		if (!this.execute([{ type: 'upsertLane', lane }, { type: 'upsertEntity', entity: marble }])) return null;
		this.$selection.set([marble.id]);
		return marble.id;
	}

	toggleHidden(id: string): void {
		this.$hidden.set((ids) => toggleItem(ids, id));
		if (this.$hidden.get().includes(id)) this.$selection.set(this.$selection.get().filter((item) => item !== id));
	}

	toggleLocked(id: string): void {
		this.$locked.set((ids) => toggleItem(ids, id));
	}

	/** Starts renaming the selected marble or piece in the sidebar, like Return in Finder */
	renameSelection(): void {
		const id = this.renameTarget();
		if (id == null) return;
		this.$panels.set((panels) => ({ ...panels, sidebar: true }));
		this.$renaming.set(id);
	}

	/** What Rename… names: the first selected entity, Decor layer, added light, or a plain Group selected as a whole. A Pattern's Group is named after it */
	renameTarget(): string | null {
		const project = this.project;
		const id = this.$selection.get()[0];
		if (project == null || id == null) return null;
		if (project.entities.some((entity) => entity.id === id) || parseDecorKey(id) != null) return id;
		const lightId = parseLightKey(id);
		if (lightId != null) return lightId !== KEY_LIGHT_ID ? id : null;
		const groupId = parseGroupKey(id);
		const group = project.groups?.find((item) => item.id === groupId);
		return group != null && !isPatternGroup(group) ? id : null;
	}

	togglePanel(panel: TStudioPanel): void {
		this.$panels.set((panels) => ({ ...panels, [panel]: !panels[panel] }));
	}

	toggleMute(partId: string): void {
		this.$mix.set((mix) => ({ ...mix, muted: toggleItem(mix.muted, partId) }));
	}

	toggleSolo(partId: string): void {
		this.$mix.set((mix) => ({ ...mix, solo: toggleItem(mix.solo, partId) }));
	}

	/**
	 * Moves the playhead to the previous or next hit (see `stepHitTarget`) and, in Compose, selects that hit so the
	 * inspector is ready to edit it and ↑ ↓ tilt its platform. Returns false at the ends.
	 */
	stepHit(direction: 1 | -1): boolean {
		const project = this.project;
		if (project == null) return false;
		const isCompose = this.$workspace.get() === 'compose';
		const next = stepHitTarget(project, this.$selection.get(), this.$playhead.get(), direction, isCompose);
		if (next == null) return false;
		this.seek(next.time);
		if (isCompose) this.$selection.set([toHitKey(next.laneId, next.hitId)]);
		return true;
	}

	/**
	 * Moves the playhead to a typed or stepped time and asks the canvas to bring the marble there into view, like
	 * Logic's catch playhead. Dragging the playhead does not ask, so the user can scrub without the wall moving.
	 */
	seek(time: number): void {
		this.$playhead.set(time);
		this.$playheadReveal.set(this.$playheadReveal.get() + 1);
	}

	/**
	 * T: a hit on the lane in focus, never before the marble can play one. Stopped, it lands at the playhead and is
	 * selected, so a spot found by scrubbing gets its hit, and the playhead goes where it landed: before the earliest
	 * time it lands there, and on a hit it lands a step later, so further presses keep adding. Playing, it lands at the
	 * music's time, for tapping along, and a press within 50 ms of a hit merges into it.
	 */
	tapHit(): void {
		const project = this.project;
		if (project == null) return;
		const lane = focusedLane(project, this.$selection.get());
		if (lane == null) return;
		if (!this.$playing.get()) {
			let target = Math.max(this.$playhead.get(), earliestHitTime(project, lane.id) ?? 0);
			while (tapTime(lane.hits, target) == null) target += TAP_STEP;
			const placed = { id: createId('hit'), time: tapTime(lane.hits, target) ?? target };
			if (!this.execute([{ type: 'upsertHits', laneId: lane.id, hits: [placed] }])) return;
			this.$selection.set([toHitKey(lane.id, placed.id)]);
			if (placed.time !== this.$playhead.get()) this.$playhead.set(placed.time);
			return;
		}
		if (!this.audio.isPlaying()) return;
		// The first tap of a playback starts the session, so tapping can run past the last hit
		this.tapSession ??= { isAutoEnd: isAutoEnd(project), hasTapped: false };
		const time = tapTime(lane.hits, this.audio.getTime());
		if (time == null) return;
		const hit = { id: createId('hit'), time };
		if (this.execute([{ type: 'upsertHits', laneId: lane.id, hits: [hit] }])) this.tapSession.hasTapped = true;
	}

	/**
	 * Where playback stops: the project end, or while T taps along to a length that follows the song, at least
	 * the default length, so taps can run past the last hit, like Logic's recording past the project end
	 */
	get playbackEnd(): number {
		const end = this.project?.end ?? 0;
		return this.tapSession?.isAutoEnd === true ? Math.max(end, DEFAULT_PROJECT_END) : end;
	}

	/** The range playback loops: the Repeat Range while it is on, never while tapping along, which runs on to the end */
	get repeatSpan(): TRepeatSpan | null {
		const project = this.project;
		const shown = project != null && this.tapSession == null ? shownRepeatRange(this.$repeatRange.get(), project.id, project.end) : null;
		return shown?.isOn === true ? { start: shown.start, end: shown.end } : null;
	}

	/** C: Repeat Range on or off, with a first range from the playhead when there is none yet */
	toggleRepeatRange(): void {
		const project = this.project;
		if (project != null) this.$repeatRange.set(toggledRepeatRange(this.$repeatRange.get(), project.id, project.end, this.$playhead.get()));
	}

	/** A drag on the ruler's repeat strip sets the range and turns it on */
	setRepeatSpan(range: TRepeatSpan): void {
		const project = this.project;
		if (project != null) this.$repeatRange.set({ projectId: project.id, isOn: true, ...range });
	}

	/** After tapping stops, a length that follows the song ends with the last hit, folded into the last tap's undo step */
	private finishTapSession(): void {
		const session = this.tapSession;
		this.tapSession = null;
		const project = this.project;
		if (session?.hasTapped === true) this.$fitFirstHits.set(true);
		if (session == null || !session.hasTapped || !session.isAutoEnd || project == null) return;
		const fitted = projectSongEnd(project);
		if (fitted == null) return;
		const end = Math.max(fitted, startingLength(project, project.end));
		if (Math.abs(end - project.end) > 1e-6) this.execute([{ type: 'setEnd', end }], { amend: true });
		this.measureBowlTail();
	}

	undo(): void {
		// While a Pattern fits nothing has changed yet, so ⌘Z stops it
		const patterns = this.$compose.get()?.patterns;
		if (patterns?.$isRunning.get() === true) {
			patterns.stop();
			return;
		}
		const history = this.$history.get();
		if (history == null || !history.past.length) return;
		this.stepHistory(history, undoHistory(history));
	}

	redo(): void {
		const history = this.$history.get();
		if (history == null || !history.future.length) return;
		this.stepHistory(history, redoHistory(history));
	}

	private stepHistory(history: TProjectHistory, next: TProjectHistory): void {
		this.$history.set(next);
		// A piece the step removed leaves the selection, so the inspector does not keep showing it
		const kept = new Set(next.present.entities.map((entity) => entity.id));
		const removed = new Set(history.present.entities.filter((entity) => !kept.has(entity.id)).map((entity) => entity.id));
		const selection = this.$selection.get();
		const left = selection.filter((id) => !removed.has(id));
		// A live Pattern a step brought back stands for its pieces again, as a click on one does
		const whole = withWholePatterns(next.present, left);
		if (whole.length !== selection.length) this.$selection.set(whole);
		// The notice of the edit this step took back would still say it happened
		const notice = this.$notice.get();
		if (notice != null && notice.actions?.some((action) => action.isUndo === true && action.undoGroup === history.groups.present) === true) this.dismissNotice(notice.id);
		this.$historyReveal.set({ revision: next.present.revision });
		this.scheduleSave();
	}

	/** Whether Revert to Opened would change anything: undoing every edit returns to how the project opened */
	canRevert(): boolean {
		const history = this.$history.get();
		return history != null && this.openedProject != null && hasUnsavedChanges(history, this.openedProject.revision);
	}

	/** Revert to Opened…: asks first, and is one more step, so Undo takes it back. The title follows the file, as in `retitle` */
	async revertToOpened(): Promise<void> {
		const title = this.project?.title;
		if (title == null || !(await this.confirm({ question: `Revert ${title} to how it opened?`, detail: 'Every edit since then goes. Undo brings them back.', action: 'Revert' }))) return;
		const history = this.$history.get();
		const opened = this.openedProject;
		if (history == null || opened == null) return;
		const next = pushHistory(history, { ...opened, title: history.present.title, revision: history.present.revision + 1 });
		this.stepLabels.set(next.groups.present, 'Revert to Opened');
		this.stepHistory(history, next);
	}

	// MARK: - Persistence

	private scheduleSave(): void {
		this.$save.set('dirty');
		clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => void this.flush(), 600);
	}

	async flush(): Promise<void> {
		clearTimeout(this.saveTimer);
		const project = this.project;
		const path = this.$path.get();
		if (project == null || path == null || project.revision === this.savedRevision) return;
		this.$save.set('saving');
		if (this.needsPreviousSave) {
			this.needsPreviousSave = false;
			await host.keepPreviousSave(path);
		}
		const [isSavedOk, savedErr] = await host.saveProject(path, serializeProject(project));
		if (!isSavedOk) {
			this.$save.set('failed');
			this.notify(`${project.title} couldn't be saved: ${savedErr.message}. Your edits are kept; press ⌘S to try again.`, 'error');
			return;
		}
		this.savedRevision = project.revision;
		// A newer edit may have arrived while the write was in flight
		this.$save.set(this.project?.revision === project.revision ? 'saved' : 'dirty');
	}

	// MARK: - Feedback

	/**
	 * Shows a notice above the canvas. Actions sit in it like the Undo of Mail's and Finder's toasts; a notice
	 * with actions stays longer, one with `progress` until it is replaced. Returns the notice's id.
	 */
	notify(message: string, tone: TNotice['tone'] = 'info', options: TNoticeOptions = {}): number {
		this.agentStep?.notices.push({ message, tone });
		const id = ++this.noticeId;
		this.noticeShownAt = this.project?.revision ?? null;
		this.noticeGroup = this.editGroup;
		this.$notice.set({ id, message, tone, ...options });
		this.scheduleNoticeEnd();
		return id;
	}

	/** Reports an edit that just happened with an Undo action for it, such as "6 platforms removed" */
	notifyEdit(message: string, actions: TNoticeAction[] = [], options: Pick<TNoticeOptions, 'details'> & { isUndoFirst?: boolean } = {}): number {
		const revision = this.project?.revision;
		// Bound to the undo group of the edit, so refinements folded into it since still undo with it
		const group = this.editGroup;
		const undo: TNoticeAction = {
			label: 'Undo',
			title: 'Undo this edit (⌘Z)',
			isUndo: true,
			undoGroup: group,
			run: () => this.undo()
		};
		const { isUndoFirst = false, ...notice } = options;
		return this.notify(message, 'info', { ...notice, actions: isUndoFirst ? [undo, ...actions] : [...actions, undo], revision });
	}

	/** Changes the notice `id` while it is still shown, for progress and actions that arrive later */
	updateNotice(id: number, patch: Partial<Omit<TNotice, 'id'>>): boolean {
		const notice = this.$notice.get();
		if (notice?.id !== id) return false;
		this.$notice.set({ ...notice, ...patch });
		this.scheduleNoticeEnd();
		return true;
	}

	/** Keeps the notice while the pointer is over it, like macOS banners */
	holdNotice(isHeld: boolean): void {
		clearTimeout(this.noticeTimer);
		if (!isHeld) this.scheduleNoticeEnd();
	}

	dismissNotice(id?: number): void {
		if (id != null && this.$notice.get()?.id !== id) return;
		clearTimeout(this.noticeTimer);
		this.$notice.set(null);
	}

	private noticeId = 0;
	/** Project revision when the notice was shown, so a later edit can retire a notice that offers a fix */
	private noticeShownAt: number | null = null;
	/** The undo group when the notice was shown: a later edit makes what it says, and its Undo, out of date */
	private noticeGroup: number | null = null;

	/**
	 * A notice that carries a fix (an action besides Undo, such as Fix 45 Hits) stays until it is acted
	 * on or another edit is made, like Mail's undo-send; this retires it on that edit. Any other notice goes with the
	 * next edit too, while refinements folded into its own edit leave it.
	 */
	private isRefittingEnd = false;

	private retireFixNotice(): void {
		const notice = this.$notice.get();
		const revision = this.project?.revision ?? null;
		if (notice == null || notice.progress != null) return;
		if (!hasFix(notice)) {
			if (this.editGroup !== this.noticeGroup) this.dismissNotice(notice.id);
			return;
		}
		if (this.isRefittingEnd) {
			this.noticeShownAt = revision;
			return;
		}
		if (revision === this.noticeShownAt || revision === notice.revision) return;
		this.dismissNotice(notice.id);
	}

	private scheduleNoticeEnd(): void {
		clearTimeout(this.noticeTimer);
		const notice = this.$notice.get();
		if (notice == null || notice.progress != null || hasFix(notice)) return;
		// Long enough to read the message and reach a Fix-it or Undo in it
		const duration = notice.tone === 'error' ? 8000 : notice.actions?.length ? 10000 : 3500;
		this.noticeTimer = setTimeout(() => this.$notice.set(null), duration);
	}
}

/** Seconds after an edit before its Bowl tail is measured, so a burst of edits measures once */
const TAIL_MEASURE_DELAY = 0.4 * 1000;
// Seconds a T on an existing hit lands after it, while stopped
const TAP_STEP = 0.5;

/** Whether an edit can move when the last marble leaves the frame: it changes the notes or a Bowl, and not the length */
function changesBowlEnding(commands: readonly TProjectCommand[]): boolean {
	if (commands.some((command) => command.type === 'setEnd')) return false;
	return changesHitsOnly(commands) || commands.some((command) => (command.type === 'upsertEntity' && command.entity.components.piece?.type === BOWL_TYPE) || command.type === 'removeEntities');
}

/** A notice that offers a fix, or details to read, stays until it is used or closed, or the next edit */
function hasFix(notice: TNotice): boolean {
	return notice.details != null || notice.actions?.some((action) => action.isUndo !== true) === true;
}

export type TWorkspace = 'compose' | 'design';
export type TTrackView = '2d' | '3d' | 'camera';
export interface TTrackAngles {
	yaw: number;
	pitch: number;
}
export type TStudioPanel = 'sidebar' | 'inspector' | 'timeline';

const TIMELINE_HEIGHT_KEY = 'midimarble-v4:timeline-height';
const OPEN_PROJECT_KEY = 'midimarble-v4:open-project';
const AUDIO_SCRUBBING_KEY = 'midimarble-v4:audio-scrubbing';

function projectName(path: string): string {
	return path.split('/').pop()?.replace(/\.marble$/, '') ?? path;
}

function toggleItem(items: string[], item: string): string[] {
	return items.includes(item) ? items.filter((value) => value !== item) : [...items, item];
}

function readNumber(key: string, fallback: number): number {
	try {
		const value = Number(localStorage.getItem(key));
		return Number.isFinite(value) && value > 0 ? value : fallback;
	} catch {
		return fallback;
	}
}

function readText(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function writeText(key: string, value: string | null): void {
	try {
		if (value == null) localStorage.removeItem(key);
		else localStorage.setItem(key, value);
	} catch {
		// Storage can be unavailable; the app then starts on the start screen
	}
}

function writeNumber(key: string, value: number): void {
	try {
		localStorage.setItem(key, String(Math.round(value)));
	} catch {
		// Storage can be unavailable; the size then resets on the next launch
	}
}
export type TSaveState = 'saved' | 'dirty' | 'saving' | 'failed';

export interface TClosePrompt {
	question: string;
}

export type TClosePromptChoice = 'save' | 'discard' | 'cancel';

export interface TConfirmPrompt {
	question: string;
	/** One secondary line under the question */
	detail?: string;
	/** The button that confirms, repeating the action: "Delete" */
	action: string;
}
export type TSelection = string[];

export interface TReveal {
	ids: string[];
	point?: TVec2;
	/** Comes close enough to read, as a problem does, rather than only into view */
	isFramed?: boolean;
	/** Pans to it only, as a range chosen for a Pattern does: what doesn't fit in view stays cut off rather than the wall zooming out */
	isZoomKept?: boolean;
}

export interface TNotice extends TNoticeOptions {
	id: number;
	message: string;
	tone: 'info' | 'error';
}

export interface TNoticeOptions {
	/** Buttons in the notice, the first drawn as the default */
	actions?: TNoticeAction[];
	/** Share done from 0 to 1 while a long task runs; the notice stays until it is replaced */
	progress?: number;
	/** Revision right after the edit the notice reports */
	revision?: number;
	/**
	 * The full text behind a Details disclosure, like Figma's notifications: the message stays two lines. A notice
	 * with details stays until it is closed or the next edit.
	 */
	details?: string;
}

export interface TNoticeAction {
	label: string;
	title?: string;
	/** The Undo every edit notice carries; any other action is a fix that keeps the notice until acted on */
	isUndo?: boolean;
	/** The undo group this Undo takes back, shown only while that edit is the latest */
	undoGroup?: number | null;
	run: () => void;
}

/** The lane of the selected marble or hit, otherwise the first lane */
export function focusedLane(project: TProject, selection: TSelection): TLane | undefined {
	for (const key of selection) {
		const hitLane = parseHitKey(key)?.laneId;
		const entityLane = project.entities.find((entity) => entity.id === key)?.components.marble?.laneId;
		const laneId = hitLane ?? entityLane;
		const lane = project.music.lanes.find((item) => item.id === laneId);
		if (lane != null) return lane;
	}
	return project.music.lanes[0];
}

/** Calls back while the person presses, drags, scrolls or types anywhere in the window */
function watchForWork(onWork: () => void): () => void {
	function onPointerMove(event: PointerEvent): void {
		if (event.buttons !== 0) onWork();
	}
	const options = { capture: true, passive: true };
	const events = ['pointerdown', 'keydown', 'wheel'] as const;
	for (const name of events) window.addEventListener(name, onWork, options);
	window.addEventListener('pointermove', onPointerMove, options);
	return () => {
		for (const name of events) window.removeEventListener(name, onWork, options);
		window.removeEventListener('pointermove', onPointerMove, options);
	};
}
