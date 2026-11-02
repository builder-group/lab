import { prepareLibraryItem, type TAsset, type TLibraryItem } from '../../project/model';
import assets from './assets.json';
import catalog from './catalog.v1.json';

export const libraryItems: TLibraryItem[] = catalog.items.map((item) => prepareLibraryItem(item));
export const libraryAssets: TAsset[] = assets;
export const libraryRevision = catalog.revision;

const assetsById = new Map(libraryAssets.map((asset) => [asset.id, asset]));
const itemsById = new Map(libraryItems.map((item) => [item.id, item]));

export function getLibraryAssetUrl(assetId: string | null | undefined): string | null {
	const asset = assetId == null ? undefined : assetsById.get(assetId);
	return asset == null ? null : '/' + asset.relativePath;
}
export function getLibraryItem(id: string): TLibraryItem | null {
	return itemsById.get(id) ?? null;
}
