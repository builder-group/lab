import { createState } from 'feature-state';
import type { TResult } from 'tuple-result';
import { host, notSongFileMessage, songFileKind, type THostPickedFile, type THostRecentProject } from '@/environment';
import { createAudioEngine, type TAudioEngine } from '@/modules/music';
import {
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
import { parseHitKey } from './selection';
import { SimulationCx } from './SimulationCx';
import { SourcesCx } from './SourcesCx';
import type { ComposeCx } from '@/modules/compose/ComposeCx';
import { AgentCx } from '@/modules/agents';
import { addWallTextCommands, DesignCx, DesignLibraryCx, FilmExportCx, previewPointToWall } from '@/modules/design';

/** Owns the open project, its history, persistence and the shared editing state of the studio */
export class StudioCx {
	readonly $history = createState<TProjectHistory | null>(null);
	readonly $path = createState<string | null>(null);
	readonly $save = createState<TSaveState>('saved');
	readonly $recent = createState<THostRecentProject[]>([]);
	readonly $workspace = createState<TWorkspace>('compose');
	readonly $selection = createState<TSelection>([]);
	readonly $playhead = createState(0);
	readonly $playing = createState(false);
	readonly $notice = createState<TNotice | null>(null);
	/**
	 * Selection keys and an optional wall point the Compose canvas should bring into view, set by lists
	 * outside the canvas. The canvas clears it once handled, so a reveal sent from Design waits for Compose.
	 */
	readonly $reveal = createState<TReveal | null>(null);
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
	/** Text and mentions the agent composer takes over once, such as the library's New Theme with Agent… */
	readonly $agentDraft = createState<TAgentDraft | null>(null);
	readonly sources = new SourcesCx(this);
	readonly simulation = new SimulationCx(this);
	readonly design = new DesignCx({
		getProject: () => this.project,
		getResult: () => this.simulation.$result.get(),
		getPackagePath: () => this.$path.get(),
		getPlayhead: () => this.$playhead.get()
	});
	readonly agents = new AgentCx({
		getPackagePath: () => this.$path.get(),
		getProject: () => this.project,
		getResult: () => this.simulation.$result.get()
	});
	readonly library = new DesignLibraryCx({
		getPackagePath: () => this.$path.get(),
		getProject: () => this.project,
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

	get project(): TProject | null {
		return this.$history.get()?.present ?? null;
	}

	mount(): () => void {
		void this.refreshRecent();
		void this.restoreOpenProject();
		const unmountSimulation = this.simulation.mount();
		const unmountDesign = this.mountDesign();
		const unmountAgents = this.agents.mount();
		const stopHeight = this.$timelineHeight.listen(({ value }) => writeNumber(TIMELINE_HEIGHT_KEY, value));
		return () => {
			unmountSimulation();
			unmountDesign();
			unmountAgents();
			stopHeight();
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
		const stops = [
			this.$workspace.listen(({ value }) => {
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
			this.$playhead.listen(() => {
				if (inDesign() && !this.$playing.get()) this.design.requestPreview();
			}),
			this.$playing.listen(({ value }) => {
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
		const point = previewPointToWall(project, this.simulation.$result.get(), this.$playhead.get(), u, v);
		const { commands, entityId } = addWallTextCommands(point);
		if (this.execute(commands)) this.$selection.set([entityId]);
	}

	/** Selects entities and asks the canvas to frame them when they are out of view */
	reveal(ids: string[], point?: TVec2): void {
		this.$selection.set(ids);
		this.$reveal.set({ ids, point });
	}

	/**
	 * Shows an export preflight issue in Compose, like a click in Xcode's issue navigator: closes the
	 * export sheet, moves the playhead to the issue and selects and frames what it is about
	 */
	revealIssue(target: { ids: string[]; point?: TVec2; time?: number }): void {
		this.film.closeSheet();
		this.$playing.set(false);
		this.$workspace.set('compose');
		this.reveal(target.ids, target.point);
		// After the selection, which moves the playhead to a selected piece's own hit
		if (target.time != null) this.$playhead.set(target.time);
	}

	// MARK: - Projects

	async refreshRecent(): Promise<void> {
		this.$recent.set(await host.listRecentProjects());
	}

	/** `prepare` fills the new package before the project opens, such as an example's song files */
	async newProject(
		options: { title?: string; project?: TProject; prepare?: (packagePath: string) => Promise<TResult<void, Error>> } = {}
	): Promise<boolean> {
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
		this.isRestoring = false;
		if (!isOpenedOk || !isProjectOk || project == null) {
			writeText(OPEN_PROJECT_KEY, null);
			return;
		}
		if (this.$history.get() == null) this.load(project, opened.path);
	}

	async closeProject(): Promise<void> {
		writeText(OPEN_PROJECT_KEY, null);
		await this.flush();
		await this.design.close();
		this.$history.set(null);
		this.$path.set(null);
		this.$selection.set([]);
		this.$playhead.set(0);
		this.$playing.set(false);
		await this.refreshRecent();
	}

	private load(project: TProject, path: string): void {
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
	 * latest edit instead, for refinements that arrive a moment after the edit they belong to.
	 */
	execute(commands: TProjectCommand[], options: { amend?: boolean } = {}): boolean {
		const history = this.$history.get();
		if (history == null || !commands.length) return false;
		const [isEditOk, editErr, edited] = applyProjectCommands(history.present, commands);
		if (!isEditOk) {
			this.notify(editErr.message, 'error');
			return false;
		}
		this.$history.set(options.amend === true ? { ...history, present: edited } : pushHistory(history, edited));
		this.scheduleSave();
		return true;
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
		this.$playhead.set(next);
		return true;
	}

	/** Records a hit at the playhead on the lane in focus, for tapping along to the music */
	tapHit(): void {
		const project = this.project;
		if (project == null) return;
		const lane = focusedLane(project, this.$selection.get());
		if (lane == null) return;
		const now = this.$playing.get() ? this.audio.getTime() : this.$playhead.get();
		const time = Math.round(now * 10000) / 10000;
		const hit = { id: createId('hit'), time };
		this.execute([{ type: 'upsertHits', laneId: lane.id, hits: [hit] }]);
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

	notify(message: string, tone: TNotice['tone'] = 'info'): void {
		clearTimeout(this.noticeTimer);
		this.$notice.set({ message, tone });
		this.noticeTimer = setTimeout(() => this.$notice.set(null), tone === 'error' ? 8000 : 3500);
	}
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
export type TSelection = string[];

export interface TReveal {
	ids: string[];
	point?: TVec2;
}

export interface TNotice {
	message: string;
	tone: 'info' | 'error';
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
