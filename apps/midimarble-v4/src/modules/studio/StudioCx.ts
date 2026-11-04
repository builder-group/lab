import { createState } from 'feature-state';
import type { TResult } from 'tuple-result';
import { host, notSongFileMessage, songFileKind, type THostPickedFile, type THostRecentProject } from '@/environment';
import { autoEnd, changesHitsOnly, changesTail, createAudioEngine, DEFAULT_PROJECT_END, endsOnFinish, isAutoEnd, projectSongEnd, type TAudioEngine } from '@/modules/music';
import {
	amendHistory,
	applyProjectCommands,
	changedEntityIds,
	createHistory,
	createId,
	createLane,
	createMarble,
	createProject,
	LANE_SPACING,
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
import { hasUnsavedChanges, saveChangesQuestion, savePanelTitle } from './document';
import { fittedSongEnd } from '@/modules/camera/finish-exit';
import { FINISH_TYPE } from '@/modules/simulation/finish';
import { HintsCx } from './HintsCx';
import { renumberDefaultNames } from './piece-order-names';
import { parseHitKey } from './selection';
import { TAP_COUNT_IN_SECONDS, tapTime } from './tap';
import { SimulationCx } from './SimulationCx';
import { SourcesCx } from './SourcesCx';
import type { ComposeCx } from '@/modules/compose/ComposeCx';
import { AgentCx } from '@/modules/agents';
import { addWallTextCommands, baseThemeOf, DesignCx, DesignLibraryCx, FilmExportCx, frameHeightOnWall, previewPointToWall } from '@/modules/design';
import { preflightExport, problemSummary, type TPreflightTarget } from '@/modules/design/export-preflight';

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
	readonly $selection = createState<TSelection>([]);
	readonly $playhead = createState(0);
	readonly $playing = createState(false);
	/** Song time before which taps record nothing, set when T starts playback (see `tapHit`) */
	private tapCountInEnd = -Infinity;
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
	/** Entities the last undo or redo changed; the canvas pans to them once the run for that revision arrives */
	readonly $historyReveal = createState<{ ids: string[]; revision: number } | null>(null);
	readonly $panels = createState<Record<TStudioPanel, boolean>>({ sidebar: true, inspector: true, timeline: true, agent: false });
	// Zero fits the timeline to its lanes until the user drags it to a height of their own
	readonly $timelineHeight = createState(readNumber(TIMELINE_HEIGHT_KEY, 0));
	readonly $paletteOpen = createState(false);
	/** Muted and soloed lanes, like the M and S buttons of a Logic track header. View state, not saved. */
	readonly $mix = createState<TLaneMix>({ muted: [], solo: [] });
	/** The mounted Compose canvas, so commands and menus outside it can drive its tools */
	readonly $compose = createState<ComposeCx | null>(null);
	/** Marble entity, lane or piece whose name is being edited in place in the sidebar */
	readonly $renaming = createState<string | null>(null);
	/** Pieces hidden from the canvas and locked against canvas edits, like Figma's layer toggles. View state, not saved. */
	readonly $hidden = createState<string[]>([]);
	readonly $locked = createState<string[]>([]);
	/** Dropping an element links it to a hit dot or anchors it to a trajectory, like Figma's snapping */
	readonly $snapping = createState(true);
	/** Film outlines every piece's hitbox, like Unity's collider gizmos; a selected piece always shows its own */
	readonly $showHitboxes = createState(false);
	/** Text and mentions the agent composer takes over once, such as the library's New Theme with Agent… */
	readonly $agentDraft = createState<TAgentDraft | null>(null);
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
	readonly agents = new AgentCx({
		getPackagePath: () => this.$path.get(),
		getProject: () => this.project,
		getResult: () => this.simulation.$result.get()
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
		getPackagePath: () => this.$path.get(),
		resolveSourceUrl: (source) => this.resolveSourceUrl(source),
		design: this.design
	});
	private audioEngine: TAudioEngine | null = null;

	private isRestoring = false;
	private saveTimer: ReturnType<typeof setTimeout> | undefined;
	private savedRevision = 0;
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
		const unmountAgents = this.agents.mount();
		const unmountHints = this.hints.mount();
		const stopHeight = this.$timelineHeight.listen(({ value }) => writeNumber(TIMELINE_HEIGHT_KEY, value));
		const stopNotices = this.$history.listen(() => this.retireFixNotice());
		// The tap count-in belongs to the playback T started; stopping ends it
		const stopCountIn = this.$playing.listen(({ value }) => {
			if (value) return;
			this.tapCountInEnd = -Infinity;
			this.finishTapSession();
		});
		return () => {
			unmountSimulation();
			unmountDesign();
			unmountAgents();
			unmountHints();
			stopHeight();
			stopNotices();
			stopCountIn();
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
				void this.design.activate();
				void this.library.refresh(false);
			}),
			// Runs and library items belong to the package
			this.$path.listen(() => {
				void this.design.detect();
				void this.agents.reload();
				void this.library.refresh();
			}),
			this.$playhead.listen(({ value }) => {
				if (inDesign()) this.design.live.follow(value);
				if (inDesign() && !this.$playing.get()) this.design.requestPreview();
			}),
			this.$playing.listen(({ value }) => {
				if (inDesign()) this.design.live.follow(this.$playhead.get(), true);
				if (inDesign() && !value) this.design.requestPreview();
			}),
			this.simulation.$result.listen(() => {
				if (inDesign() && !this.$playing.get()) this.design.requestPreview(400);
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

	/** Plays one hit's sound as feedback when it is placed or selected */
	audition(laneId: string, pitch?: number): void {
		const project = this.project;
		const lane = project?.music.lanes.find((item) => item.id === laneId);
		if (project == null || lane == null || project.music.sources.some((source) => source.kind === 'audio')) return;
		void this.audio.audition(lane, pitch);
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
		const { commands, entityId } = addWallTextCommands(point, { theme: baseThemeOf(project.design), frameHeight: frameHeightOnWall(project, result, time) });
		if (!this.execute(commands)) return;
		this.$selection.set([entityId]);
		// Typing starts at once, like Figma's text tool: the inspector focuses the Text field with its contents selected
		this.design.$editingTitle.set(entityId);
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
		else this.reveal(target.ids, target.point);
		// After the selection, which moves the playhead to a selected piece's own hit
		if (target.time != null) this.$playhead.set(target.time);
	}

	/** Show First Problem: the earliest problem of the hit summary, or a notice when there is none */
	showFirstProblem(): void {
		const project = this.project;
		if (project == null) return;
		const summary = problemSummary(preflightExport(project, this.simulation.$result.get()));
		if (summary.state === 'pending') {
			this.notify('Checking the run…');
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
		options: { title?: string; project?: TProject; prepare?: (packagePath: string) => Promise<TResult<void, Error>> } = {}
	): Promise<boolean> {
		if (!(await this.confirmClose())) return false;
		const project = options.project ?? createProject({ title: options.title ?? 'Untitled' });
		const path = await host.chooseNewProjectPath(project.title);
		if (path == null) return false;
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
			this.notify(`${projectName(target)} couldn't be opened: ${projectErr.message}`, 'error');
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
	 * moves its package there with every file, so it continues as a project in Recent. Returns false when cancelled
	 * or failed.
	 */
	async save(): Promise<boolean> {
		if (!this.$isTemporary.get()) {
			await this.flush();
			return this.$save.get() !== 'failed';
		}
		const project = this.project;
		const from = this.$path.get();
		if (project == null || from == null) return false;
		const destination = await host.chooseNewProjectPath(project.title, savePanelTitle(project.title));
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
	 * place and the copy stays open, as in macOS; the original keeps its last autosave. Returns false when cancelled
	 * or failed.
	 */
	async saveAs(): Promise<boolean> {
		if (this.$isTemporary.get()) return this.save();
		const project = this.project;
		const from = this.$path.get();
		if (project == null || from == null) return false;
		const destination = await host.chooseNewProjectPath(project.title, 'Save As');
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
		this.$history.set(createHistory(project));
		this.$path.set(path);
		writeText(OPEN_PROJECT_KEY, path);
		this.$save.set('saved');
		this.$selection.set([]);
		this.$hidden.set([]);
		this.$locked.set([]);
		this.$playhead.set(0);
		this.$workspace.set('compose');
		this.sources.$analysis.set({});
		this.sources.ensureAnalysis(project);
		void this.refreshRecent();
	}

	// MARK: - Editing

	/**
	 * Applies commands as one undoable edit and schedules an autosave. `amend` folds them into the
	 * latest edit instead, for refinements that arrive a moment after the edit they belong to. `group`
	 * folds them into the latest edit only while it is the edit of that group (see `editGroup`), so a
	 * multi-step edit stays one undo step and never swallows an edit the user made in between.
	 */
	execute(commands: TProjectCommand[], options: { amend?: boolean; group?: number } = {}): boolean {
		const history = this.$history.get();
		if (history == null || !commands.length) return false;
		const [isEditOk, editErr, edited] = applyProjectCommands(history.present, commands);
		if (!isEditOk) {
			this.notify(editErr.message, 'error');
			return false;
		}
		// Default piece names follow time order, so a new piece for an earlier hit takes the lower number
		let named = renumberDefaultNames(history.present, edited);
		// While the length follows the song, it ends with the last hit, or with the catch once the last marble has a
		// Finish; taps fit it once tapping stops
		if (this.tapSession == null && (changesHitsOnly(commands) || changesTail(commands, history.present, named))) {
			const end = autoEnd(history.present, named);
			if (end != null) named = { ...named, end };
		}
		this.$history.set(options.amend === true ? amendHistory(history, named) : pushHistory(history, named, options.group));
		this.scheduleSave();
		if (this.tapSession == null && changesFinishEnding(commands)) this.measureFinishTail();
		return true;
	}

	/**
	 * Fit to Song: ends the film `filmTail` after the last note, measured on a what-if run when it ends on a Finish.
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
	 * While the length follows the song and ends on a Finish, an edit of the notes or the Finish measures the tail in a
	 * what-if run shortly after and folds the length into that edit's undo step, so the length needs no run to be
	 * known at the edit itself. A newer edit restarts it.
	 */
	private measureFinishTail(): void {
		if (this.tailTimer != null) clearTimeout(this.tailTimer);
		this.tailTimer = setTimeout(() => {
			this.tailTimer = null;
			const project = this.project;
			const client = this.simulation.assists;
			if (project == null || client == null || !endsOnFinish(project) || !isAutoEnd(project)) return;
			void fittedSongEnd(project, (trial) => client.simulateAssist(trial)).then((end) => {
				if (end == null || this.project !== project || Math.abs(end - project.end) < 0.005) return;
				this.execute([{ type: 'setEnd', end }], { amend: true });
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
		const id = this.$selection.get()[0];
		const isEntity = id != null && this.project?.entities.some((entity) => entity.id === id) === true;
		if (!isEntity) return;
		this.$panels.set((panels) => ({ ...panels, sidebar: true }));
		this.$renaming.set(id);
	}

	togglePanel(panel: TStudioPanel): void {
		this.$panels.set((panels) => ({ ...panels, [panel]: !panels[panel] }));
	}

	/** Opens the agent chat with a prefilled message, like a chat panel's suggested prompt */
	openAgent(draft: TAgentDraft): void {
		this.$panels.set((panels) => ({ ...panels, agent: true }));
		this.$agentDraft.set(draft);
	}

	toggleMute(laneId: string): void {
		this.$mix.set((mix) => ({ ...mix, muted: toggleItem(mix.muted, laneId) }));
	}

	toggleSolo(laneId: string): void {
		this.$mix.set((mix) => ({ ...mix, solo: toggleItem(mix.solo, laneId) }));
	}

	/** Moves the playhead to the previous or next hit of any lane; returns false at the ends */
	stepHit(direction: 1 | -1): boolean {
		const times = (this.project?.music.lanes ?? []).flatMap((lane) => lane.hits.map((hit) => hit.time)).sort((a, b) => a - b);
		const now = this.$playhead.get();
		const next = direction === 1 ? times.find((time) => time > now + 1e-4) : [...times].reverse().find((time) => time < now - 1e-4);
		if (next == null) return false;
		this.seek(next);
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
	 * Records a hit at the playhead on the lane in focus, for tapping along to the music. Taps record only while
	 * the song plays, as Logic records only with the transport running: with playback stopped, T starts it and
	 * the next taps add hits. Taps while the audio is still starting, and in the 0.3 s count-in after that press,
	 * record nothing, so a quick second press never lands a Too Soon hit at 0:00. A tap within 50 ms of a hit
	 * merges into it.
	 */
	tapHit(): void {
		const project = this.project;
		if (project == null) return;
		const lane = focusedLane(project, this.$selection.get());
		if (lane == null) return;
		if (!this.$playing.get()) {
			const from = this.$playhead.get() >= project.end ? 0 : this.$playhead.get();
			this.tapCountInEnd = from + TAP_COUNT_IN_SECONDS;
			this.tapSession = { isAutoEnd: isAutoEnd(project), hasTapped: false };
			// From the start at the end, as Play does; `playbackEnd` may lie past the end now
			if (from !== this.$playhead.get()) this.$playhead.set(from);
			this.$playing.set(true);
			this.notify(`Playing: press T on each beat to add hits to ${lane.name}`);
			return;
		}
		if (!this.audio.isPlaying()) return;
		const time = tapTime(lane.hits, this.audio.getTime(), this.tapCountInEnd);
		if (time == null) return;
		const hit = { id: createId('hit'), time };
		if (this.execute([{ type: 'upsertHits', laneId: lane.id, hits: [hit] }]) && this.tapSession != null) this.tapSession.hasTapped = true;
	}

	/**
	 * Where playback stops: the project end, or while T taps along to a length that follows the song, at least
	 * the default length, so taps can run past the last hit, like Logic's recording past the project end
	 */
	get playbackEnd(): number {
		const end = this.project?.end ?? 0;
		return this.tapSession?.isAutoEnd === true ? Math.max(end, DEFAULT_PROJECT_END) : end;
	}

	/** After tapping stops, a length that follows the song ends with the last hit, folded into the last tap's undo step */
	private finishTapSession(): void {
		const session = this.tapSession;
		this.tapSession = null;
		const project = this.project;
		if (session == null || !session.hasTapped || !session.isAutoEnd || project == null) return;
		const end = projectSongEnd(project);
		if (end == null) return;
		if (Math.abs(end - project.end) > 1e-6) this.execute([{ type: 'setEnd', end }], { amend: true });
		this.measureFinishTail();
	}

	undo(): void {
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
		if (selection.some((id) => removed.has(id))) this.$selection.set(selection.filter((id) => !removed.has(id)));
		this.$historyReveal.set({ ids: changedEntityIds(history.present, next.present), revision: next.present.revision });
		this.scheduleSave();
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
		const id = ++this.noticeId;
		this.noticeShownAt = this.project?.revision ?? null;
		this.$notice.set({ id, message, tone, ...options });
		this.scheduleNoticeEnd();
		return id;
	}

	/** Reports an edit that just happened with an Undo action for it, such as "6 platforms removed" */
	notifyEdit(message: string, actions: TNoticeAction[] = [], options: Pick<TNoticeOptions, 'details'> = {}): number {
		const revision = this.project?.revision;
		// Bound to the undo group of the edit, so refinements folded into it since still undo with it
		const group = this.editGroup;
		const undo: TNoticeAction = {
			label: 'Undo',
			title: 'Undo this edit (⌘Z)',
			isUndo: true,
			run: () => {
				if (group != null && this.editGroup === group) this.undo();
				// Otherwise Undo would take back a later edit instead
				else this.notify('A later edit came after this one. Press ⌘Z to undo edits in order.');
			}
		};
		return this.notify(message, 'info', { ...options, actions: [...actions, undo], revision });
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

	/**
	 * A notice that carries a fix (an action besides Undo, such as Fix 45 Hits) stays until it is acted
	 * on or another edit is made, like Mail's undo-send; this retires it on that edit
	 */
	private retireFixNotice(): void {
		const notice = this.$notice.get();
		const revision = this.project?.revision ?? null;
		if (notice == null || notice.progress != null || !hasFix(notice)) return;
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

/** Seconds after an edit before its Finish tail is measured, so a burst of edits measures once */
const TAIL_MEASURE_DELAY = 0.4 * 1000;

/** Whether an edit can move when the last marble leaves the frame: it changes the notes or a Finish, and not the length */
function changesFinishEnding(commands: readonly TProjectCommand[]): boolean {
	if (commands.some((command) => command.type === 'setEnd')) return false;
	return changesHitsOnly(commands) || commands.some((command) => (command.type === 'upsertEntity' && command.entity.components.piece?.type === FINISH_TYPE) || command.type === 'removeEntities');
}

/** A notice that offers a fix, or details to read, stays until it is used or closed, or the next edit */
function hasFix(notice: TNotice): boolean {
	return notice.details != null || notice.actions?.some((action) => action.isUndo !== true) === true;
}

export type TWorkspace = 'compose' | 'design';
export type TStudioPanel = 'sidebar' | 'inspector' | 'timeline' | 'agent';

/** A message the agent composer starts with; `mentionIds` are layer ids or `scene` */
export interface TAgentDraft {
	text: string;
	mentionIds: string[];
}

export interface TLaneMix {
	muted: string[];
	solo: string[];
}

/** Whether a lane sounds: soloed lanes win over everything, otherwise every lane that is not muted */
export function isLaneAudible(mix: TLaneMix, laneId: string): boolean {
	return mix.solo.length > 0 ? mix.solo.includes(laneId) : !mix.muted.includes(laneId);
}

/** The project as it should sound with the current mute and solo state; soloing a marble also silences Backing */
export function audibleProject(project: TProject, mix: TLaneMix): TProject {
	if (!mix.muted.length && !mix.solo.length) return project;
	const lanes = project.music.lanes.filter((lane) => isLaneAudible(mix, lane.id));
	return { ...project, music: { ...project.music, lanes, backing: mix.solo.length > 0 ? [] : project.music.backing } };
}

const TIMELINE_HEIGHT_KEY = 'midimarble-v4:timeline-height';
const OPEN_PROJECT_KEY = 'midimarble-v4:open-project';

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
