import { createState } from 'feature-state';
import type { AgentCx } from '@/modules/agents';
import { library, type TLibraryItem } from '@/modules/library';
import type { TProject, TProjectCommand } from '@/modules/project';
import { skinCommands, type TSkinTarget } from './design-commands';

/**
 * Library of the Design sidebar: the project's own items and the user's global library. Applying a global
 * item copies it into the project first so the package stays portable.
 */
export class DesignLibraryCx {
	readonly $projectItems = createState<TLibraryItem[]>([]);
	readonly $globalItems = createState<TLibraryItem[]>([]);
	readonly $status = createState<'idle' | 'loading' | 'ready' | 'unavailable' | 'error'>('idle');
	readonly $error = createState<string | null>(null);

	private loadedFor: string | null = null;

	constructor(private readonly source: TDesignLibrarySource) {}

	/** Loads both libraries; `force` reloads even when the package did not change */
	async refresh(force = true): Promise<void> {
		if (!library.isAvailable()) {
			this.$status.set('unavailable');
			return;
		}
		const packagePath = this.source.getPackagePath();
		if (!force && this.loadedFor === packagePath && this.$status.get() === 'ready') return;
		this.$status.set('loading');
		const [isGlobalOk, globalErr, globalItems] = await library.list('global', null);
		const [isProjectOk, projectErr, projectItems] = packagePath == null ? [true, null, []] as const : await library.list('project', packagePath);
		if (!isGlobalOk || !isProjectOk) {
			const message = (isGlobalOk ? projectErr : globalErr)?.message ?? "The library couldn't be read";
			if (import.meta.env.DEV) console.warn('[library]', message);
			this.$error.set(message);
			this.$status.set('error');
			return;
		}
		this.loadedFor = packagePath;
		this.$projectItems.set([...projectItems]);
		this.$globalItems.set(globalItems);
		this.$error.set(null);
		this.$status.set('ready');
	}

	/** Sets the item as the linked skin of the target pieces in one undoable edit */
	async applySkin(item: TLibraryItem, target: TSkinTarget): Promise<boolean> {
		const project = this.source.getProject();
		const packagePath = this.source.getPackagePath();
		if (project == null || packagePath == null) return false;
		let assetId = item.id;
		if (item.scope === 'global') {
			const [isImportedOk, importedErr, imported] = await library.import(packagePath, item.id);
			if (!isImportedOk) {
				this.source.notify(`“${label(item)}” couldn't be copied into the project: ${importedErr.message}`, 'error');
				return false;
			}
			assetId = imported.id;
			void this.refresh();
		}
		const commands = skinCommands(project, target, assetId);
		if (!commands.length) {
			this.source.notify('No piece is selected. Select a piece, then apply the skin.');
			return false;
		}
		return this.source.execute(commands);
	}

	/** Save to My Library: copies a project item into the global library */
	async promote(item: TLibraryItem): Promise<void> {
		const packagePath = this.source.getPackagePath();
		if (packagePath == null) return;
		const [isPromotedOk, promotedErr] = await library.promote(packagePath, item.id);
		if (!isPromotedOk) {
			this.source.notify(promotedErr.message, 'error');
			return;
		}
		this.source.notify(`“${label(item)}” is in My Library`);
		await this.refresh();
	}

	async remove(item: TLibraryItem): Promise<void> {
		const [isRemovedOk, removedErr] = await library.remove(item.scope, this.source.getPackagePath(), item.id);
		if (!isRemovedOk) {
			this.source.notify(removedErr.message, 'error');
			return;
		}
		await this.refresh();
	}

	/**
	 * Accepts an agent candidate: the item moves into the project library and, for a piece run, becomes the
	 * piece's skin in the same step
	 */
	async acceptCandidate(agents: AgentCx, runId: string): Promise<boolean> {
		const run = agents.getRun(runId);
		const [isAcceptedOk, acceptedErr, item] = await agents.accept(runId);
		if (!isAcceptedOk) {
			this.source.notify(acceptedErr.message, 'error');
			return false;
		}
		await this.refresh();
		const project = this.source.getProject();
		if (run?.target?.kind === 'piece' && project != null && item.manifest?.role === 'skin') {
			return this.source.execute(skinCommands(project, { kind: 'entities', entityIds: [run.target.entityId] }, item.id));
		}
		this.source.notify(`“${label(item)}” was added to the project library`);
		return true;
	}
}

export interface TDesignLibrarySource {
	getPackagePath: () => string | null;
	getProject: () => TProject | null;
	execute: (commands: TProjectCommand[]) => boolean;
	notify: (message: string, tone?: 'info' | 'error') => void;
}

export function libraryItemLabel(item: TLibraryItem): string {
	return label(item);
}

function label(item: TLibraryItem): string {
	return item.manifest?.label ?? item.id;
}
