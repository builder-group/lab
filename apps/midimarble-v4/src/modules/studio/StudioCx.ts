import { createState } from 'feature-state';
import { host, type THostRecentProject } from '@/environment';
import { createAudioEngine, type TAudioEngine } from '@/modules/music';
import {
	applyProjectCommands,
	createId,
	createHistory,
	createProject,
	parseProject,
	pushHistory,
	redoHistory,
	serializeProject,
	undoHistory,
	type TLane,
	type TProject,
	type TProjectCommand,
	type TProjectHistory,
	type TSource
} from '@/modules/project';
import { parseHitKey } from './selection';
import { SourcesCx } from './SourcesCx';

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
	readonly sources = new SourcesCx(this);
	private audioEngine: TAudioEngine | null = null;

	private saveTimer: ReturnType<typeof setTimeout> | undefined;
	private savedRevision = 0;
	private noticeTimer: ReturnType<typeof setTimeout> | undefined;

	get project(): TProject | null {
		return this.$history.get()?.present ?? null;
	}

	mount(): () => void {
		void this.refreshRecent();
		return () => {
			clearTimeout(this.noticeTimer);
			this.audioEngine?.dispose();
			void this.flush();
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

	// MARK: - Projects

	async refreshRecent(): Promise<void> {
		this.$recent.set(await host.listRecentProjects());
	}

	async newProject(options: { title?: string; project?: TProject } = {}): Promise<boolean> {
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
		this.load(named, created.path);
		return true;
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
			this.notify(`${target} could not be opened: ${projectErr.message}`, 'error');
			return false;
		}
		this.load(project, opened.path);
		return true;
	}

	async closeProject(): Promise<void> {
		await this.flush();
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
		this.$save.set('saved');
		this.$selection.set([]);
		this.$playhead.set(0);
		this.$workspace.set('compose');
		this.sources.$analysis.set({});
		this.sources.ensureAnalysis(project);
		void this.refreshRecent();
	}

	// MARK: - Editing

	/** Applies commands as one undoable edit and schedules an autosave */
	execute(commands: TProjectCommand[]): boolean {
		const history = this.$history.get();
		if (history == null || !commands.length) return false;
		const [isEditOk, editErr, edited] = applyProjectCommands(history.present, commands);
		if (!isEditOk) {
			this.notify(editErr.message, 'error');
			return false;
		}
		this.$history.set(pushHistory(history, edited));
		this.scheduleSave();
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
		this.$history.set(undoHistory(history));
		this.scheduleSave();
	}

	redo(): void {
		const history = this.$history.get();
		if (history == null || !history.future.length) return;
		this.$history.set(redoHistory(history));
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
			this.notify(`Saving failed: ${savedErr.message}`, 'error');
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
export type TSaveState = 'saved' | 'dirty' | 'saving' | 'failed';
export type TSelection = string[];

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
