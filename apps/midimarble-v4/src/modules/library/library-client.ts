import { convertFileSrc, isTauri } from '@tauri-apps/api/core';
import { createState } from 'feature-state';
import { Err, Ok, type TResult } from 'tuple-result';
import { specta } from '@/environment/specta';
import type { TPackOrigin } from '@/modules/project';
import { parseAssetManifest, parseCandidateManifest, serializeAssetManifest, uniqueItemId, type TAssetManifest, parsePackTheme, STARTER_PACK, STARTER_PACK_ID, type TLibraryItem, type TPack } from '@/modules/scene';

/**
 * Asset libraries: the project library in `<package>/assets/` and added Packs in the app's support folder. Both
 * use `<id>/{manifest.json, asset.blend, preview.png}`. The browser development surface has no libraries.
 */
export const library = {
	isAvailable(): boolean {
		return isTauri();
	},

	async list(packagePath: string): Promise<TResult<TLibraryItem[], Error>> {
		if (!isTauri()) return Ok([]);
		const result = await specta.commands.libraryList(packagePath);
		if (result.status === 'error') return Err(new Error(result.error));
		return Ok(result.data.map(toLibraryItem));
	},

	/** Copies an added Pack's item into the project so the package stays portable */
	async import(packagePath: string, itemId: string, packId: string): Promise<TResult<TLibraryItem, Error>> {
		if (!isTauri()) return Err(unavailable());
		const result = await specta.commands.libraryImport(packagePath, itemId, packId);
		if (result.status === 'error') return Err(new Error(result.error));
		return Ok(toLibraryItem(result.data));
	},

	async remove(packagePath: string, itemId: string): Promise<TResult<void, Error>> {
		if (!isTauri()) return Err(unavailable());
		const result = await specta.commands.libraryRemove(packagePath, itemId);
		if (result.status === 'error') return Err(new Error(result.error));
		return Ok(undefined);
	},

	/**
	 * Adds an asset from outside the project, checking its manifest. `path` is a folder with
	 * `asset.blend` or a `.blend` file; `manifestJson` is the manifest as an agent wrote it.
	 */
	async addAsset(packagePath: string, path: string, manifestJson: string, pack?: TPackOrigin): Promise<TResult<TLibraryItem, Error>> {
		if (!isTauri()) return Err(unavailable());
		const [isManifestOk, manifestErr, manifest] = parseCandidateManifest(manifestJson);
		if (!isManifestOk) return Err(new Error(`This item's manifest can't be read: ${manifestErr.message}`));
		const [isListOk, listErr, items] = await library.list(packagePath);
		if (!isListOk) return Err(listErr);
		const itemId = uniqueItemId(
			manifest.id,
			items.map((item) => item.id)
		);
		const stored: TAssetManifest = { ...manifest, id: itemId, origin: 'agent', ...(pack != null ? { pack } : {}) };
		const result = await specta.commands.libraryAddAsset(packagePath, path, itemId, serializeAssetManifest(stored));
		if (result.status === 'error') return Err(new Error(result.error));
		return Ok(toLibraryItem(result.data));
	},

	/** The imported Packs in the app's library folder */
	async listPacks(): Promise<TResult<TPack[], Error>> {
		if (!isTauri()) return Ok([]);
		const result = await specta.commands.libraryListPacks();
		if (result.status === 'error') return Err(new Error(result.error));
		return Ok(result.data.map(toPack));
	},

	/** The Packs that ship inside the app */
	async listBundledPacks(): Promise<TResult<TPack[], Error>> {
		if (!isTauri()) return Ok([]);
		const result = await specta.commands.libraryListBundledPacks();
		if (result.status === 'error') return Err(new Error(result.error));
		return Ok(result.data.map(toPack));
	},

	async importPack(path: string): Promise<TResult<TPack, Error>> {
		if (!isTauri()) return Err(unavailable());
		const result = await specta.commands.libraryImportPack(path);
		if (result.status === 'error') return Err(new Error(result.error));
		return Ok(toPack(result.data));
	},

	async exportPack(packagePath: string, destination: string, manifestJson: string, themes: specta.PackThemeDto[], assetIds: string[]): Promise<TResult<string, Error>> {
		if (!isTauri()) return Err(unavailable());
		const result = await specta.commands.libraryExportPack(packagePath, destination, manifestJson, themes, assetIds);
		if (result.status === 'error') return Err(new Error(result.error));
		return Ok(result.data);
	},

	async removePack(packId: string): Promise<TResult<void, Error>> {
		if (!isTauri()) return Err(unavailable());
		const result = await specta.commands.libraryRemovePack(packId);
		if (result.status === 'error') return Err(new Error(result.error));
		return Ok(undefined);
	}
};

/**
 * The Packs added on this Mac, for every project; the Starter Pack is always one. Insert and the pickers read this list.
 */
export const addedPacks = createState<TPack[]>([STARTER_PACK]);

/** Whether a Pack is added on this Mac */
export function isPackAdded(packId: string): boolean {
	return packId === STARTER_PACK_ID || addedPacks.get().some((pack) => pack.id === packId);
}

/** The built-in Decor the added Packs offer, by source */
export function addedBuiltInDecor(): string[] {
	return addedPacks.get().flatMap((pack) => pack.builtInDecor);
}

function toPack(dto: specta.PackDto): TPack {
	return {
		id: dto.id,
		path: dto.path,
		name: dto.name,
		version: dto.version,
		description: dto.description,
		author: dto.author,
		link: dto.link,
		pictureUrl: dto.picturePath != null ? convertFileSrc(dto.picturePath) : null,
		builtInDecor: dto.builtInDecor,
		// A theme that can't be read is left out; the Pack's other items still work
		themes: dto.themesJson.flatMap((json) => parsePackTheme(json) ?? []),
		items: dto.items.map(toLibraryItem)
	};
}

export function toLibraryItem(dto: specta.LibraryItemDto): TLibraryItem {
	let manifest: TAssetManifest | null = null;
	let manifestError: string | null = 'manifest.json is missing';
	if (dto.manifestJson != null) {
		const [isManifestOk, manifestErr, parsed] = parseAssetManifest(dto.manifestJson);
		manifest = isManifestOk ? parsed : null;
		manifestError = isManifestOk ? null : manifestErr.message;
	}
	return {
		id: dto.id,
		scope: dto.scope,
		path: dto.path,
		manifest,
		manifestError,
		hasAsset: dto.hasAsset,
		previewUrl: dto.previewPath != null ? convertFileSrc(dto.previewPath) : null,
		packId: dto.packId
	};
}

function unavailable(): Error {
	return new Error('Packs work in the desktop app. Open MidiMarble on your Mac.');
}
