import { convertFileSrc, isTauri } from '@tauri-apps/api/core';
import { Err, Ok, type TResult } from 'tuple-result';
import { specta } from '@/environment/specta';
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
	 * The stored manifest carries that ID.
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
		const stored: TAssetManifest = { ...manifest, id: itemId };
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

	/** Copies a global item into the project so the package stays portable */
	async import(packagePath: string, itemId: string): Promise<TResult<TLibraryItem, Error>> {
		if (!isTauri()) return Err(unavailable());
		const result = await specta.commands.libraryImport(packagePath, itemId);
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
		previewUrl: dto.previewPath != null ? convertFileSrc(dto.previewPath) : null
	};
}

function unavailable(): Error {
	return new Error('The asset library needs the desktop app');
}
