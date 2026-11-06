import { createState } from 'feature-state';
import type { StudioCx } from '@/modules/studio';
import { host } from '@/environment';
import { Err, Ok, type TResult } from 'tuple-result';
import { addedPacks, isPackAdded, library } from '@/modules/library';
import { packOriginOf, STARTER_PACK_ID, withStarterPack, type TLibraryItem, type TPack, packAddedNotice, packExport, packThemeCommands, themeAssetIds, withThemeAssets, type TPackExportOptions, packOrigin, packOriginLine, resolveTheme, skinnedOf } from '@/modules/scene';
import { type TPackOrigin, type TPackTheme } from '@/modules/project';
import { skinCommands, type TSkinTarget } from './film-commands';

/**
 * The library behind Film's Library tab and the inspector's skin pickers. An item lives in the project's library or in an
 * added Pack; the UI shows one list. Applying a Pack's item copies it into the project first so the package stays
 * portable.
 */
export class FilmLibraryCx {
	readonly $projectItems = createState<TLibraryItem[]>([]);
	/** The Packs that ship inside the app */
	readonly $bundledPacks = createState<TPack[]>([]);
	/** The Packs… sheet is open */
	readonly $isPacksOpen = createState(false);
	/** The Pack whose card the sheet shows; a Pack that is on no list here has only its origin to show */
	readonly $packCard = createState<TPackOrigin | null>(null);
	/** Export This Look…'s sheet while it is open */
	readonly $exportPack = createState<TPackExportOptions | null>(null);
	readonly $status = createState<'idle' | 'loading' | 'ready' | 'unavailable' | 'error'>('idle');
	readonly $error = createState<string | null>(null);
	/** Film's Insert popover is open */
	readonly $insertOpen = createState(false);

	private loadedFor: string | null = null;
	/** Items accepted so far per decor set from the agent */

	constructor(private readonly studio: StudioCx) {}

	/** Loads the project's library and the Packs; `force` reloads even when the package did not change */
	async refresh(force = true): Promise<void> {
		if (!library.isAvailable()) {
			this.$status.set('unavailable');
			return;
		}
		const packagePath = this.studio.$path.get();
		if (!force && this.loadedFor === packagePath && this.$status.get() === 'ready') return;
		this.$status.set('loading');
		const [isProjectOk, projectErr, projectItems] = packagePath == null ? [true, null, []] as const : await library.list(packagePath);
		const [isPacksOk, , packs] = await library.listPacks();
		if (isPacksOk) addedPacks.set(withStarterPack(packs));
		const [isBundledOk, , bundled] = await library.listBundledPacks();
		if (isBundledOk) this.$bundledPacks.set(bundled);
		if (!isProjectOk) {
			const message = projectErr.message;
			if (import.meta.env.DEV) console.warn('[library]', message);
			this.$error.set(message);
			this.$status.set('error');
			return;
		}
		this.loadedFor = packagePath;
		this.$projectItems.set([...projectItems]);
		this.$error.set(null);
		this.$status.set('ready');
	}

	/** Sets the item as the linked skin of the target pieces in one undoable edit */
	async applySkin(item: TLibraryItem, target: TSkinTarget): Promise<boolean> {
		const project = this.studio.project;
		const packagePath = this.studio.$path.get();
		if (project == null || packagePath == null) return false;
		const assetId = await this.inProject(item);
		if (assetId == null) return false;
		const commands = skinCommands(project, target, assetId);
		if (!commands.length) {
			this.studio.notify('No piece is selected. Select a piece, then apply the skin.');
			return false;
		}
		return this.studio.execute(commands);
	}

	/**
	 * The item's ID in the project, copying a Pack's item in first so the package stays portable. Null with a
	 * notice when it can't be copied.
	 */
	async inProject(item: TLibraryItem): Promise<string | null> {
		const packagePath = this.studio.$path.get();
		if (packagePath == null) return null;
		if (item.packId == null) return item.id;
		const [isImportedOk, importedErr, imported] = await library.import(packagePath, item.id, item.packId);
		if (!isImportedOk) {
			this.studio.notify(`“${label(item)}” couldn't be copied into the project: ${importedErr.message}`, 'error');
			return null;
		}
		void this.refresh();
		return imported.id;
	}

	// MARK: - Packs

	/** Clicking an origin line that reads "Not Added": that Pack's card in the sheet */
	openPackCard(origin: TPackOrigin): void {
		this.$packCard.set(origin);
		this.$isPacksOpen.set(true);
	}

	/**
	 * Add for a Pack in the sheet, or Import from File… without a path. It stays on this Mac for every project: its items
	 * show in Insert and the tiles and its themes in the picker, and the look stays as it is. Ok(null) when canceled.
	 */
	async addPack(path?: string): Promise<TResult<TPack | null, Error>> {
		const chosen = path ?? (await host.choosePackToImport());
		if (chosen == null) return Ok(null);
		const [isAddedOk, addedErr, pack] = await library.importPack(chosen);
		if (!isAddedOk) {
			this.studio.notify(`That Pack couldn't be added: ${addedErr.message}`, 'error');
			return Err(addedErr);
		}
		await this.refresh();
		const skins = pack.items.filter((item) => item.manifest?.role === 'skin').length;
		this.studio.notify(packAddedNotice(pack.name, { themes: pack.themes.length, skins, decor: pack.items.length - skins + pack.builtInDecor.length }));
		return Ok(pack);
	}

	/** Export This Look…'s sheet for the current look, with the library skins the project wears already ticked */
	openExportPack(): void {
		const project = this.studio.project;
		if (project == null) return;
		const worn = new Set(skinnedOf(project).flatMap((piece) => piece.skin?.assetId ?? []));
		const assetIds = this.$projectItems.get().flatMap((item) => (worn.has(item.id) ? [item.id] : []));
		this.$exportPack.set({ name: resolveTheme(project.film).name, includesTheme: true, assetIds });
	}

	/** Export Pack…: writes the Pack; `destination` skips the save panel. Ok(null) when canceled. */
	async exportPack(options: TPackExportOptions, destination?: string): Promise<TResult<string | null, Error>> {
		const project = this.studio.project;
		const packagePath = this.studio.$path.get();
		if (project == null || packagePath == null) return Err(new Error('Open a project, then export a Pack.'));
		let plan: ReturnType<typeof packExport>;
		try {
			plan = packExport(project, this.$projectItems.get(), options);
		} catch (error) {
			return Err(error as Error);
		}
		const [isPlanOk, planErr, exported] = plan;
		if (!isPlanOk) {
			this.studio.notify(planErr.message, 'error');
			return Err(planErr);
		}
		const path = destination ?? (await host.choosePackPath(exported.manifest.name));
		if (path == null) return Ok(null);
		const [isWrittenOk, writtenErr, written] = await library.exportPack(packagePath, path, JSON.stringify(exported.manifest, null, '\t'), exported.themes, exported.assetIds);
		if (!isWrittenOk) {
			this.studio.notify(`The Pack couldn't be exported: ${writtenErr.message}`, 'error');
			return Err(writtenErr);
		}
		this.studio.notify(`${packOrigin(exported.manifest.name)} exported`);
		return Ok(written);
	}

	async removePack(pack: TPack): Promise<void> {
		if (pack.id === STARTER_PACK_ID) return;
		const [isRemovedOk, removedErr] = await library.removePack(pack.id);
		if (!isRemovedOk) {
			this.studio.notify(removedErr.message, 'error');
			return;
		}
		await this.refresh();
		this.studio.notify(`${packOrigin(pack.name)} removed. Projects keep what they use from it.`);
	}

	/** Wears a Pack's theme: the items it needs are copied in, then its look goes on the film, as one edit */
	async applyPackTheme(pack: TPack, theme: TPackTheme): Promise<boolean> {
		const ready = await this.packThemeInProject(pack, theme);
		const project = this.studio.project;
		if (ready == null || project == null) return false;
		return this.studio.execute(packThemeCommands(project, ready, packOriginOf(pack)));
	}

	/** A Pack's theme with the items it needs copied in; null with a notice when one can't be */
	async packThemeInProject(pack: TPack, theme: TPackTheme): Promise<TPackTheme | null> {
		const ids = new Map<string, string>();
		for (const id of themeAssetIds(theme)) {
			const item = pack.items.find((candidate) => candidate.id === id);
			const copied = item != null ? await this.inProject(item) : null;
			if (copied == null) return null;
			ids.set(id, copied);
		}
		return withThemeAssets(theme, ids);
	}

	async remove(item: TLibraryItem): Promise<void> {
		const packagePath = this.studio.$path.get();
		if (packagePath == null) return;
		const [isRemovedOk, removedErr] = await library.remove(packagePath, item.id);
		if (!isRemovedOk) {
			this.studio.notify(removedErr.message, 'error');
			return;
		}
		await this.refresh();
	}

}


/**
 * The project's and the Packs' items as one list, the project's first. A Pack's item the project copied under another
 * ID, or holds under the same ID from elsewhere, still shows until it is the same Pack's.
 */
export function libraryEntries(projectItems: TLibraryItem[], packs: readonly TPack[] = []): TLibraryItem[] {
	const copiedFromPacks = new Set(projectItems.flatMap((item) => (item.manifest?.pack != null ? [`${item.manifest.pack.packId}:${item.manifest.label}`] : [])));
	return [...projectItems, ...packs.flatMap((pack) => pack.items.filter((item) => !copiedFromPacks.has(`${pack.id}:${item.manifest?.label ?? item.id}`)))];
}

/** The key of a library tile: the same ID may be in the project and in several Packs */
export function libraryItemKey(item: TLibraryItem): string {
	return `${item.scope}:${item.packId ?? ''}:${item.id}`;
}

/** What clicking an item's origin line does: opens its Pack's card when this Mac doesn't have the Pack */
export function notAddedPackAction(cx: { library: FilmLibraryCx }, item: TLibraryItem): (() => void) | undefined {
	const origin = item.manifest?.pack;
	return origin != null && !isPackAdded(origin.packId) ? () => cx.library.openPackCard(origin) : undefined;
}

/** Where an item comes from, as its quiet second line */
export function libraryItemOrigin(item: TLibraryItem): string {
	if (item.manifest?.pack != null) return packOriginLine(item.manifest.pack, isPackAdded);
	return item.manifest?.origin === 'agent' ? 'Made by Agent' : 'Imported';
}


/** What a Pack holds, in words: "1 theme, 4 skins, 8 decor items" */
export function packContents(pack: Pick<TPack, 'themes' | 'items' | 'builtInDecor' | 'builtIn'>): string {
	const builtIn = pack.builtIn ?? [];
	const skins = pack.items.filter((item) => item.manifest?.role === 'skin').length + builtIn.filter((item) => item.kind === 'skin').length;
	const decor = pack.items.filter((item) => item.manifest?.role !== 'skin').length + pack.builtInDecor.length;
	const themes = pack.themes.length + builtIn.filter((item) => item.kind === 'theme').length;
	const counted = (count: number, one: string, many: string): string => (count > 0 ? `${count} ${count === 1 ? one : many}` : '');
	const parts = [counted(themes, 'theme', 'themes'), counted(skins, 'skin', 'skins'), counted(decor, 'decor item', 'decor items')];
	return parts.filter(Boolean).join(', ') || 'Nothing yet';
}

export function libraryItemLabel(item: TLibraryItem): string {
	return label(item);
}

function label(item: TLibraryItem): string {
	return item.manifest?.label ?? item.id;
}
