import starterManifest from '../../../packs/Starter.marblepack/pack.json';
import { SPackTheme, type TPackOrigin, type TPackTheme } from '@/modules/project';
import type { TAssetManifest } from './asset-manifest';

// What a Pack and a library item are, with nothing that talks to the host: the Starter Pack, its origin line and a theme as a Pack stores it.

export type TLibraryScope = 'project' | 'pack';

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
	/** The imported Pack it lives in, null once in a project */
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
	themes: TPackTheme[];
	items: TLibraryItem[];
	/** Decor the app draws itself, by source such as `decor:bauble-red`, for a bundled Pack without assets yet */
	builtInDecor: string[];
	/** Themes and skins the app draws itself, for the Starter Pack */
	builtIn?: readonly TPackBuiltIn[];
}

export interface TPackBuiltIn {
	kind: 'theme' | 'skin';
	label: string;
	source: string;
}

export const STARTER_PACK_ID = 'starter';
/** The origin line of everything in the Starter Pack */
export const STARTER_ORIGIN = 'Starter';

/** Always present and can't be removed: manifest entries for the items the app draws itself */
export const STARTER_PACK: TPack = {
	id: STARTER_PACK_ID,
	path: '',
	name: starterManifest.name,
	version: starterManifest.version,
	description: starterManifest.description,
	author: starterManifest.author,
	link: null,
	pictureUrl: null,
	themes: [],
	items: [],
	builtInDecor: starterManifest.items.filter((item) => item.kind === 'decor').map((item) => item.source),
	builtIn: starterManifest.items.flatMap((item) => (item.kind === 'decor' ? [] : [{ kind: item.kind as TPackBuiltIn['kind'], label: item.label, source: item.source }]))
};

/** The Packs on this Mac with the Starter Pack first, whatever an older version left on disk */
export function withStarterPack(packs: readonly TPack[]): TPack[] {
	return [STARTER_PACK, ...packs.filter((pack) => pack.id !== STARTER_PACK_ID)];
}

/** What a copy of this Pack's items records */
export function packOriginOf(pack: Pick<TPack, 'id' | 'name' | 'version' | 'author' | 'link'>): TPackOrigin {
	return { packId: pack.id, packName: pack.name, version: pack.version, ...(pack.author != null ? { author: pack.author } : {}), ...(pack.link != null ? { link: pack.link } : {}) };
}

export function parsePackTheme(json: string): TPackTheme | null {
	try {
		const parsed = SPackTheme.safeParse(JSON.parse(json));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}
