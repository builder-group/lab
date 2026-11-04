import { convertFileSrc, isTauri } from '@tauri-apps/api/core';
import { createState } from 'feature-state';
import { Err, Ok, type TResult } from 'tuple-result';
import { specta } from '@/environment/specta';
import { SProjectTheme, type TPackOrigin, type TProjectTheme } from '@/modules/project/schema';
import {
	parseAssetManifest,
	parseCandidateManifest,
	serializeAssetManifest,
	uniqueItemId,
	type TAssetManifest
} from './asset-manifest';

/**
 * Asset libraries: the project library in `<package>/assets/` and the global library in the app's support
 * folder. Both use `<id>/{manifest.json, asset.blend, preview.png}`. The browser development surface has no
 * libraries.
 */
export const library = {
	isAvailable(): boolean {
		return isTauri();
	},

	async list(
		scope: TLibraryScope,
		packagePath: string | null
	): Promise<TResult<TLibraryItem[], Error>> {
		if (!isTauri()) return Ok([]);
		const result = await specta.commands.libraryList(scope, packagePath);
		if (result.status === 'error') return Err(new Error(result.error));
		return Ok(result.data.map(toLibraryItem));
	},

	/**
	 * Validates a candidate's manifest and copies the candidate into the project library under a free ID.
	 * The stored manifest carries that ID and `origin: 'agent'`.
	 */
	async acceptCandidate(
		packagePath: string,
		runId: string,
		manifestJson: string | null
	): Promise<TResult<TLibraryItem, Error>> {
		if (!isTauri()) return Err(unavailable());
		if (manifestJson == null) return Err(new Error('The candidate has no manifest.json'));
		const [isManifestOk, manifestErr, manifest] = parseCandidateManifest(manifestJson);
		if (!isManifestOk)
			return Err(new Error(`The candidate's manifest is invalid: ${manifestErr.message}`));
		const [isListOk, listErr, items] = await library.list('project', packagePath);
		if (!isListOk) return Err(listErr);
		const itemId = uniqueItemId(
			manifest.id,
			items.map((item) => item.id)
		);
		const stored: TAssetManifest = { ...manifest, id: itemId, origin: 'agent' };
		const result = await specta.commands.libraryAcceptCandidate(
			packagePath,
			runId,
			itemId,
			serializeAssetManifest(stored)
		);
		if (result.status === 'error') return Err(new Error(result.error));
		return Ok(toLibraryItem(result.data));
	},

	/** Save to my library: copies a project item into the global library */
	async promote(packagePath: string, itemId: string): Promise<TResult<TLibraryItem, Error>> {
		if (!isTauri()) return Err(unavailable());
		const result = await specta.commands.libraryPromote(packagePath, itemId);
		if (result.status === 'error') return Err(new Error(result.error));
		return Ok(toLibraryItem(result.data));
	},

	/** Copies a global item or an imported Pack's item into the project so the package stays portable */
	async import(packagePath: string, itemId: string, packId: string | null = null): Promise<TResult<TLibraryItem, Error>> {
		if (!isTauri()) return Err(unavailable());
		const result = await specta.commands.libraryImport(packagePath, itemId, packId);
		if (result.status === 'error') return Err(new Error(result.error));
		return Ok(toLibraryItem(result.data));
	},

	async remove(
		scope: TLibraryScope,
		packagePath: string | null,
		itemId: string
	): Promise<TResult<void, Error>> {
		if (!isTauri()) return Err(unavailable());
		const result = await specta.commands.libraryRemove(scope, packagePath, itemId);
		if (result.status === 'error') return Err(new Error(result.error));
		return Ok(undefined);
	},

	/**
	 * Adds an asset from outside the project with the same checks as accepting a candidate. `path` is a folder with
	 * `asset.blend` or a `.blend` file; `manifestJson` is the manifest as an agent wrote it.
	 */
	async addAsset(packagePath: string, path: string, manifestJson: string, pack?: TPackOrigin): Promise<TResult<TLibraryItem, Error>> {
		if (!isTauri()) return Err(unavailable());
		const [isManifestOk, manifestErr, manifest] = parseCandidateManifest(manifestJson);
		if (!isManifestOk) return Err(new Error(`The asset's manifest is invalid: ${manifestErr.message}`));
		const [isListOk, listErr, items] = await library.list('project', packagePath);
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

export type TLibraryScope = specta.LibraryScope;

export interface TLibraryItem {
	id: string;
	scope: TLibraryScope;
	/** Absolute folder of the item */
	path: string;
	/** Null when `manifest.json` is missing or invalid; `manifestError` says why */
	manifest: TAssetManifest | null;
	manifestError: string | null;
	hasAsset: boolean;
	previewUrl: string | null;
	/** The imported Pack it lives in, null once in a project or for a kept item */
	packId: string | null;
}

/** An imported Pack: its themes and items as they stand in the library, copied into a project when used */
export interface TPack {
	id: string;
	/** Absolute folder */
	path: string;
	name: string;
	version: string;
	description: string | null;
	author: string | null;
	link: string | null;
	pictureUrl: string | null;
	themes: TProjectTheme[];
	items: TLibraryItem[];
	/** Decor the app draws itself, by source such as `decor:bauble-red`, for a bundled Pack without assets yet */
	builtInDecor: string[];
}

/**
 * The Packs added on this Mac, for every project. By default none is. Insert, the skin tiles and the Theme picker read
 * this list.
 */
export const addedPacks = createState<TPack[]>([]);

/** Whether a Pack is added on this Mac */
export function isPackAdded(packId: string): boolean {
	return addedPacks.get().some((pack) => pack.id === packId);
}

/** What a copy of this Pack's items records */
export function packOriginOf(pack: Pick<TPack, 'id' | 'name' | 'version' | 'author' | 'link'>): TPackOrigin {
	return { packId: pack.id, packName: pack.name, version: pack.version, ...(pack.author != null ? { author: pack.author } : {}), ...(pack.link != null ? { link: pack.link } : {}) };
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

export function parsePackTheme(json: string): TProjectTheme | null {
	try {
		const parsed = SProjectTheme.safeParse(JSON.parse(json));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
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
	return new Error('The asset library needs the desktop app');
}
