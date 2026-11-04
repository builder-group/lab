import { createState } from 'feature-state';
import { requestFromPrompt, type AgentCx } from '@/modules/agents';
import { isNewThemeRequest } from '@/modules/agents/agent-brief';
import { library, type TLibraryItem } from '@/modules/library';
import { applyProjectCommands, type TProject, type TProjectCommand } from '@/modules/project';
import type { TSimulationResult } from '@/modules/simulation';
import { $blenderObjects, addDecorCommands, assetDecorSource, type TDecorSource } from './decor';
import { DEFAULT_SCATTER_DENSITY, scatterDecorCommands, seedOf } from './decor-scatter';
import { skinCommands, type TSkinTarget } from './design-commands';
import { filmCamera } from './film-camera';
import { agentThemeCommands } from './project-themes';

/**
 * The library behind Film's Library tab and the inspector's Look tiles. Items live in the project's library and, when kept (the star), in the user's global
 * library; the UI shows one list without those scopes. Applying a kept item copies it into the project first so the
 * package stays portable.
 */
export class DesignLibraryCx {
	readonly $projectItems = createState<TLibraryItem[]>([]);
	readonly $globalItems = createState<TLibraryItem[]>([]);
	readonly $status = createState<'idle' | 'loading' | 'ready' | 'unavailable' | 'error'>('idle');
	readonly $error = createState<string | null>(null);
	/** Film's Insert popover is open */
	readonly $insertOpen = createState(false);

	private loadedFor: string | null = null;
	/** Items accepted so far per decor set from the agent */
	private readonly acceptedSets = new Map<string, TDecorSource[]>();

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
	 * the theme's skin for one type. A decoration lands on the wall where it was asked for.
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
		if (project == null) return true;
		const isNewTheme = run != null && isNewThemeRequest(requestFromPrompt(run.prompt));
		// A New Theme Result may bring the theme's colours: the project gets that theme and shows it, with the skin, as one edit
		const proposal = isNewTheme ? item.manifest?.theme : undefined;
		const themed = proposal != null ? agentThemeCommands(project, proposal) : null;
		const themeCommands = themed?.commands ?? [];
		const themedProject = themeCommands.length > 0 ? applyEdit(project, themeCommands) : project;
		if (run?.target?.kind === 'piece' && item.manifest?.role === 'skin') {
			const entityId = run.target.entityId;
			const pieceType = project.entities.find((entity) => entity.id === entityId)?.components.piece?.type;
			const target: TSkinTarget = pieceType != null && isNewTheme ? { kind: 'pieceType', pieceType } : { kind: 'entities', entityIds: [entityId] };
			return this.source.execute([...themeCommands, ...skinCommands(themedProject, target, item.id)]);
		}
		if (themeCommands.length > 0 && this.source.execute(themeCommands)) {
			this.source.notify(`${proposal?.name ?? 'The theme'} applied, with “${label(item)}” in the project library`);
			return true;
		}
		// A decoration lands where the agent was asked for it: at the picked point, or scattered with the rest of its set
		if (item.manifest?.role === 'decoration' && run?.target != null) {
			const source = assetDecorSource(item.id, label(item), item.manifest.fittedParams);
			if (run.target.kind === 'wall') {
				this.source.execute(addDecorCommands(project, source, run.target.point).commands);
				return true;
			}
			if (run.target.kind === 'scene' && run.target.decorSet != null) return this.scatterAccepted(project, run.target.decorSet.id, source);
		}
		this.source.notify(`“${label(item)}” was added to the project library`);
		return true;
	}

	/** Scatters the set with the item just accepted, replacing what the set placed before, as one edit */
	private scatterAccepted(project: TProject, setId: string, source: TDecorSource): boolean {
		const items = [...(this.acceptedSets.get(setId) ?? []), source];
		this.acceptedSets.set(setId, items);
		const result = this.source.getResult();
		const track = result != null ? filmCamera(project, result).track : null;
		if (result == null || track == null) {
			this.source.notify(`“${source.label}” was added to the project library. Use Scatter Decor once the run has updated`);
			return true;
		}
		const { commands, count } = scatterDecorCommands(project, result, track, { items, density: DEFAULT_SCATTER_DENSITY, seed: seedOf(setId), blenderObjects: $blenderObjects.get() });
		if (!this.source.execute(commands)) return false;
		this.source.notify(`“${source.label}” is in the project library, and the set is on the wall: ${count} ${count === 1 ? 'item' : 'items'}`);
		return true;
	}
}

export interface TDesignLibrarySource {
	getPackagePath: () => string | null;
	getProject: () => TProject | null;
	getResult: () => TSimulationResult | null;
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

export { isNewThemeRequest, NEW_THEME_PROMPT } from '@/modules/agents/agent-brief';

/** The project after `commands`, for building the commands that follow them in the same edit */
function applyEdit(project: TProject, commands: TProjectCommand[]): TProject {
	const [isAppliedOk, , applied] = applyProjectCommands(project, commands);
	return isAppliedOk ? applied : project;
}

export function libraryItemLabel(item: TLibraryItem): string {
	return label(item);
}

function label(item: TLibraryItem): string {
	return item.manifest?.label ?? item.id;
}
