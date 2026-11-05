import { Err, Ok, type TResult } from 'tuple-result';
import { toItemId } from './asset-manifest';
import { type TLibraryItem } from './pack-data';
import { applyProjectCommands, type TProject, type TProjectCommand, type TProjectTheme } from '@/modules/project';
import { themeCommands, currentLookThemeCommands } from './project-themes';

// Packs: a `.marblepack` folder with themes, skins and decor. These are the parts that need no host: what a theme needs
// from the library, and what an export writes.

/** The library items a theme uses, its skins by item ID. A built-in skin's ID has a colon, an item's never. */
export function themeAssetIds(theme: TProjectTheme): string[] {
	const skins = Object.values(theme.parts ?? {}).flatMap((part) => (part.skin != null && !part.skin.includes(':') ? [part.skin] : []));
	return [...new Set(skins)];
}

/** The theme with its library items under the IDs they got in the project */
export function withThemeAssets(theme: TProjectTheme, ids: ReadonlyMap<string, string>): TProjectTheme {
	const rename = (id: string): string => ids.get(id) ?? id;
	const parts = theme.parts != null ? Object.fromEntries(Object.entries(theme.parts).map(([element, part]) => [element, part.skin != null ? { ...part, skin: rename(part.skin) } : part])) : undefined;
	return { ...theme, ...(parts != null ? { parts } : {}) };
}

/** Adds a Pack's theme to the project and shows it, as one edit. A project keeps one theme in use. */
export function packThemeCommands(project: TProject, theme: TProjectTheme): TProjectCommand[] {
	const add: TProjectCommand = { type: 'setDesign', design: { themes: [...project.design.themes, theme] } };
	const [isAddedOk, , added] = applyProjectCommands(project, [add]);
	return isAddedOk ? [add, ...themeCommands(added, theme.id)] : [];
}

export interface TPackExportOptions {
	name: string;
	description?: string;
	author?: string;
	link?: string;
	/** Includes the theme the project shows now, with its layer changes and the items it uses */
	includesTheme: boolean;
	/** Project library items to include, skins and Decor */
	assetIds: string[];
}

export interface TPackExport {
	manifest: { $schema: 'marble-pack@1'; id: string; name: string; version: string; description: string | null; author: string | null; link: string | null; items: { kind: 'theme' | 'skin' | 'decor'; id: string; label: string; origin: string | null }[] };
	themes: { id: string; json: string }[];
	assetIds: string[];
}

/** What Export This Look… writes for the project. An item the theme needs comes along even when it wasn't chosen. */
export function packExport(project: TProject, items: readonly TLibraryItem[], options: TPackExportOptions): TResult<TPackExport, Error> {
	const name = options.name.trim();
	if (name === '') return Err(new Error('A Pack needs a name'));
	const themes = options.includesTheme ? [currentLookSnapshot(project, name)] : [];
	const ids = [...new Set([...options.assetIds, ...themes.flatMap(themeAssetIds)])];
	const assets: TPackExport['manifest']['items'] = [];
	for (const id of ids) {
		const item = items.find((candidate) => candidate.id === id);
		if (item?.manifest == null) return Err(new Error(`${id} isn't in this project's library, so it can't go into a Pack`));
		if (item.manifest.role === 'text') return Err(new Error(`${item.manifest.label} is a text item; a Pack holds themes, skins and decor`));
		assets.push({ kind: item.manifest.role === 'skin' ? 'skin' : 'decor', id, label: item.manifest.label, origin: item.manifest.origin ?? null });
	}
	if (themes.length === 0 && assets.length === 0) return Err(new Error('Choose the theme or at least one skin or decor item'));
	return Ok({
		manifest: {
			$schema: 'marble-pack@1',
			id: toItemId(name),
			name,
			version: '1.0',
			description: options.description?.trim() || null,
			link: options.link?.trim() || null,
			author: options.author?.trim() || null,
			items: [...themes.map((theme) => ({ kind: 'theme' as const, id: theme.id, label: theme.name, origin: theme.origin ?? null })), ...assets]
		},
		themes: themes.map((theme) => ({ id: theme.id, json: `${JSON.stringify(theme, null, '\t')}\n` })),
		assetIds: ids
	});
}

/** The current look as a stored theme named for its Pack, with its skins, Wall and Lights, under a new ID */
function currentLookSnapshot(project: TProject, name: string): TProjectTheme {
	const { commands, themeId } = currentLookThemeCommands(project, name);
	const [isCopiedOk, copiedErr, copied] = applyProjectCommands(project, commands);
	if (!isCopiedOk) throw copiedErr;
	const theme = copied.design.themes.find((item) => item.id === themeId);
	if (theme == null) throw new Error(`${name} couldn't be copied`);
	const { pack: _pack, ...rest } = theme;
	return rest;
}
