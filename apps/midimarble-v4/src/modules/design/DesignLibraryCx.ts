import { createState } from 'feature-state';
import { requestFromPrompt, type AgentCx } from '@/modules/agents';
import { library, type TLibraryItem } from '@/modules/library';
import type { TProject, TProjectCommand } from '@/modules/project';
import { skinCommands, type TSkinTarget } from './design-commands';

/**
 * Library of the Film sidebar. Items live in the project's library and, when kept (the star), in the user's global
 * library; the UI shows one list without those scopes. Applying a kept item copies it into the project first so the
 * package stays portable.
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

	/** Keep in Library (the star): a project item is copied into the global library; unstarring removes that copy */
	async setKept(entry: TLibraryEntry, isKept: boolean): Promise<void> {
		if (isKept === entry.isKept) return;
		const packagePath = this.source.getPackagePath();
		if (isKept) {
			if (packagePath == null) return;
			const [isPromotedOk, promotedErr] = await library.promote(packagePath, entry.item.id);
			if (!isPromotedOk) {
				this.source.notify(promotedErr.message, 'error');
				return;
			}
		} else {
			const [isRemovedOk, removedErr] = await library.remove('global', packagePath, entry.item.id);
			if (!isRemovedOk) {
				this.source.notify(removedErr.message, 'error');
				return;
			}
		}
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
	 * Accepts an agent Result: the item moves into the project library and, for a piece run, becomes the piece's
	 * skin in the same step. A "New theme:" request skins every piece of that type, since each of its runs makes
	 * the theme's skin for one type.
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
			const entityId = run.target.entityId;
			const pieceType = project.entities.find((entity) => entity.id === entityId)?.components.piece?.type;
			const target: TSkinTarget =
				pieceType != null && isNewThemeRequest(requestFromPrompt(run.prompt)) ? { kind: 'pieceType', pieceType } : { kind: 'entities', entityIds: [entityId] };
			return this.source.execute(skinCommands(project, target, item.id));
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

/** One library item as the UI shows it: the project's copy when there is one, and whether it is kept */
export interface TLibraryEntry {
	item: TLibraryItem;
	isKept: boolean;
}

/** Project and kept items as one list, the project's copy first when an item is in both */
export function libraryEntries(projectItems: TLibraryItem[], globalItems: TLibraryItem[]): TLibraryEntry[] {
	const keptIds = new Set(globalItems.map((item) => item.id));
	const projectIds = new Set(projectItems.map((item) => item.id));
	return [
		...projectItems.map((item) => ({ item, isKept: keptIds.has(item.id) })),
		...globalItems.filter((item) => !projectIds.has(item.id)).map((item) => ({ item, isKept: true }))
	];
}

/** Where an item comes from, as its quiet second line */
export function libraryItemOrigin(item: TLibraryItem): string {
	return item.manifest?.origin === 'agent' ? 'Made with Agent' : 'Imported';
}

/** Prompt the library's New Theme with Agent… action starts the composer with */
export const NEW_THEME_PROMPT = 'New theme: ';

export function isNewThemeRequest(request: string): boolean {
	// The request starts with the mentions, such as `@[Platform 1] @[Rail 1] New theme: …`
	return /^(@\[[^\]]*\]\s*)*new theme:/i.test(request.trim());
}

export function libraryItemLabel(item: TLibraryItem): string {
	return label(item);
}

function label(item: TLibraryItem): string {
	return item.manifest?.label ?? item.id;
}
