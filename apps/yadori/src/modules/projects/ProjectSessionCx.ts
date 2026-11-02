import { createState } from 'feature-state';
import * as desktop from '../../environment/desktop';
import {
	createProject,
	executeCommands,
	prepareProject,
	type TCommand,
	type TProject
} from '../project/model';
import {
	exportBrowserProject,
	listBrowserProjects,
	openBrowserProject,
	saveBrowserProject
} from './browser-storage';

export class ProjectSessionCx {
	readonly $project = createState<TProject | null>(null);
	readonly $projects = createState<desktop.TProjectRecord[]>([]);
	readonly $save = createState<TSaveState>({ state: 'idle', path: '' });
	readonly $history = createState({ undo: 0, redo: 0 });
	readonly $notice = createState<string | null>(null);
	private past: TProject[] = [];
	private future: TProject[] = [];
	private savedRevision: number | null = null;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private noticeTimer: ReturnType<typeof setTimeout> | undefined;
	private queue: Promise<void> = Promise.resolve();
	private generation = 0;
	private switching = false;
	private pendingEdits = new Map<string, TPendingEdit>();
	private flushingPending = false;
	private pendingFailure: TSaveState | null = null;
	private lastCoalesce: { key: string; at: number } | null = null;

	mount(): () => void {
		void this.refreshList();
		return () => {
			clearTimeout(this.timer);
			clearTimeout(this.noticeTimer);
			void this.flush();
		};
	}
	async refreshList(): Promise<void> {
		try {
			this.$projects.set(
				desktop.isDesktop() ? await desktop.listProjects() : listBrowserProjects()
			);
		} catch (error) {
			this.notify(`Projects could not be read: ${message(error)}`);
		}
	}
	/** Pending editors commit synchronously through execute before persistence or project transitions. */
	registerPendingEdit(key: string, edit: TPendingEdit): () => void {
		this.pendingEdits.set(key, edit);
		edit.setSuspended?.(this.switching);
		return () => {
			if (this.pendingEdits.get(key) === edit) this.pendingEdits.delete(key);
		};
	}
	flushPendingEdits(): boolean {
		if (this.flushingPending) return true;
		this.flushingPending = true;
		let ready = true;
		try {
			for (const edit of [...this.pendingEdits.values()]) {
				try {
					if (!edit.flush()) ready = false;
				} catch (error) {
					ready = false;
					this.notify(`Pending edit: ${message(error)}`);
				}
			}
		} finally {
			this.flushingPending = false;
		}
		if (!ready) {
			const current = this.$save.get();
			if (
				!this.pendingFailure ||
				(current.state === 'error' && current.error !== PENDING_EDIT_ERROR)
			)
				this.pendingFailure = current;
			this.$save.set({
				state: 'error',
				path: this.$save.get().path,
				error: PENDING_EDIT_ERROR
			});
		} else if (this.pendingFailure) {
			const previous = this.pendingFailure;
			this.pendingFailure = null;
			if (this.$save.get().error === PENDING_EDIT_ERROR)
				this.$save.set(
					previous.state === 'error'
						? previous
						: {
								path: previous.path,
								state: this.savedRevision === this.$project.get()?.revision ? 'saved' : 'saving'
							}
				);
		}
		return ready;
	}
	private setSwitching(value: boolean): void {
		this.switching = value;
		for (const edit of this.pendingEdits.values()) edit.setSuspended?.(value);
	}
	async create(name = 'Untitled build'): Promise<void> {
		if (this.switching || !this.flushPendingEdits()) return;
		this.setSwitching(true);
		try {
			await this.flush();
			if (this.$save.get().state === 'error') return;
			const project = createProject(name.trim() || 'Untitled build');
			const file = desktop.isDesktop()
				? await desktop.createProject(JSON.stringify(project))
				: saveBrowserProject(project);
			this.activate(prepareProject(JSON.parse(file.content)), file.path);
			await this.refreshList();
		} catch (error) {
			this.notify(message(error));
		} finally {
			this.setSwitching(false);
		}
	}
	async open(id: string): Promise<void> {
		if (this.switching || this.$project.get()?.id === id || !this.flushPendingEdits()) return;
		this.setSwitching(true);
		try {
			await this.flush();
			if (this.$save.get().state === 'error') return;
			const file = desktop.isDesktop() ? await desktop.openProject(id) : openBrowserProject(id);
			this.activate(prepareProject(JSON.parse(file.content)), file.path);
		} catch (error) {
			this.notify(`Project could not be opened: ${message(error)}`);
		} finally {
			this.setSwitching(false);
		}
	}
	private activate(project: TProject, path: string): void {
		this.generation++;
		this.savedRevision = project.revision;
		this.past = [];
		this.future = [];
		this.lastCoalesce = null;
		this.pendingFailure = null;
		this.$project.set(project);
		this.$save.set({ state: 'saved', path });
		this.$history.set({ undo: 0, redo: 0 });
	}
	execute(commands: TCommand[], label = 'Change', coalesceKey?: string): boolean {
		if (this.switching) return false;
		if (commands.some((command) => command.type === 'part.remove') && !this.flushPendingEdits())
			return false;
		const project = this.$project.get();
		if (!project) return false;
		try {
			const next = executeCommands(project, commands, { expectedRevision: project.revision });
			const coalesced =
				coalesceKey != null &&
				this.lastCoalesce?.key === coalesceKey &&
				Date.now() - this.lastCoalesce.at < 1200;
			if (!coalesced) {
				this.past.push(project);
				if (this.past.length > 80) this.past.shift();
			}
			this.future = [];
			this.lastCoalesce = coalesceKey ? { key: coalesceKey, at: Date.now() } : null;
			this.$project.set(next);
			this.$history.set({ undo: this.past.length, redo: 0 });
			this.scheduleSave();
			return true;
		} catch (error) {
			this.notify(`${label}: ${message(error)}`);
			return false;
		}
	}
	undo(): void {
		if (this.switching || !this.flushPendingEdits()) return;
		const project = this.$project.get();
		if (!project || this.switching) return;
		const previous = this.past.pop();
		if (!previous) return;
		this.future.push(project);
		this.restore(previous, project);
	}
	redo(): void {
		if (this.switching || !this.flushPendingEdits()) return;
		const project = this.$project.get();
		if (!project || this.switching) return;
		const next = this.future.pop();
		if (!next) return;
		this.past.push(project);
		this.restore(next, project);
	}
	private restore(snapshot: TProject, current: TProject): void {
		this.lastCoalesce = null;
		this.$project.set({
			...snapshot,
			revision: current.revision + 1,
			updatedAt: new Date().toISOString()
		});
		this.$history.set({ undo: this.past.length, redo: this.future.length });
		this.scheduleSave();
	}
	private scheduleSave(): void {
		clearTimeout(this.timer);
		if (this.$save.get().state !== 'error')
			this.$save.set({ ...this.$save.get(), state: 'saving' });
		this.timer = setTimeout(() => {
			void this.flush();
		}, 350);
	}
	async flush(): Promise<void> {
		if (!this.flushPendingEdits()) return;
		clearTimeout(this.timer);
		this.queue = this.queue.then(async () => {
			const project = this.$project.get();
			const generation = this.generation;
			if (!project || this.savedRevision === project.revision || this.$save.get().state === 'error')
				return;
			try {
				const file = desktop.isDesktop()
					? await desktop.saveProject(
							project.id,
							JSON.stringify(project),
							this.savedRevision ?? project.revision
						)
					: saveBrowserProject(project);
				if (generation !== this.generation) return;
				this.savedRevision = file.revision;
				this.$save.set({
					state: this.$project.get()?.revision === file.revision ? 'saved' : 'saving',
					path: file.path
				});
				await this.refreshList();
			} catch (error) {
				if (generation === this.generation)
					this.$save.set({ ...this.$save.get(), state: 'error', error: message(error) });
			}
		});
		await this.queue;
	}
	async retrySave(): Promise<void> {
		this.$save.set({ ...this.$save.get(), state: 'saving', error: undefined });
		await this.flush();
	}
	async close(): Promise<boolean> {
		if (this.switching || !this.flushPendingEdits()) return false;
		this.setSwitching(true);
		try {
			await this.flush();
			if (this.$save.get().state === 'error') return false;
			this.generation++;
			this.$project.set(null);
			this.savedRevision = null;
			this.$save.set({ state: 'idle', path: '' });
			await this.refreshList();
			return true;
		} finally {
			this.setSwitching(false);
		}
	}
	async import(): Promise<void> {
		if (!desktop.isDesktop() || this.switching || !this.flushPendingEdits()) return;
		this.setSwitching(true);
		try {
			await this.flush();
			if (this.$save.get().state === 'error') return;
			const file = await desktop.importProject();
			if (!file) return;
			this.activate(prepareProject(JSON.parse(file.content)), file.path);
			await this.refreshList();
		} catch (error) {
			this.notify(`Import failed: ${message(error)}`);
		} finally {
			this.setSwitching(false);
		}
	}
	async export(): Promise<void> {
		if (this.switching || !this.flushPendingEdits()) return;
		const before = this.$project.get();
		if (!before) return;
		this.setSwitching(true);
		try {
			await this.flush();
			const project = this.$project.get();
			if (!project || project.id !== before.id) return;
			if (desktop.isDesktop()) {
				const path = await desktop.exportProject(project.id, JSON.stringify(project));
				if (path) this.notify('Project exported.');
			} else {
				exportBrowserProject(project);
			}
		} catch (error) {
			this.notify(message(error));
		} finally {
			this.setSwitching(false);
		}
	}
	notify(value: string): void {
		clearTimeout(this.noticeTimer);
		this.$notice.set(value);
		this.noticeTimer = setTimeout(() => this.$notice.set(null), 7000);
	}
}
export interface TPendingEdit {
	flush(): boolean;
	setSuspended?(value: boolean): void;
}
export interface TSaveState {
	state: 'idle' | 'saved' | 'saving' | 'error';
	path: string;
	error?: string;
}
const PENDING_EDIT_ERROR =
	'Notes have an unresolved draft. Reopen the part and resolve it before saving.';
function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
