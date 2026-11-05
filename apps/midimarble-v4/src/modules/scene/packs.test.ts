import { describe, expect, it } from 'vitest';
import { addedPacks, isPackAdded } from '@/modules/library';
import { STARTER_PACK, withStarterPack, type TLibraryItem, type TPack } from './pack-data';
import { decorItem } from './decor-catalog';
import { WALL_KINDS } from './scene-layers';
import { catalogSkins, SKIN_ELEMENTS } from './skin-catalog';
import { createProject, type TPackTheme } from '@/modules/project';
import { apply } from '@/modules/project/test-helpers';
import { packThemeCommands } from './project-themes';
import { libraryEntries, libraryItemOrigin, packContents } from '@/modules/film';
import { packExport, themeAssetIds, withThemeAssets } from './packs';
import { packOrigin } from './project-themes';

function item(id: string, role: 'skin' | 'decoration', extra: Partial<TLibraryItem> = {}, pack?: string): TLibraryItem {
	return {
		id,
		scope: 'project',
		path: id,
		manifest: { $schema: 'marble-asset@1', id, label: id, role, ...(pack != null ? { pack: { packId: pack.toLowerCase(), packName: pack, version: '1.0' } } : {}) },
		manifestError: null,
		hasAsset: true,
		previewUrl: null,
		packId: null,
		...extra
	};
}

const theme: TPackTheme = { id: 'cozy', name: 'Cozy', base: 'brass', parts: { platform: { skin: 'brass-bar' }, rail: { skin: 'rail:chrome' } } };

function pack(items: TLibraryItem[], extra: Partial<TPack> = {}): TPack {
	return { id: 'christmas', path: '/p', name: 'Christmas', version: '1.0', description: null, author: null, link: null, pictureUrl: null, themes: [], items, builtInDecor: [], ...extra };
}

describe('Packs', () => {
	it('should read a theme\'s library items and leave built-in skins out', () => {
		expect(themeAssetIds(theme)).toEqual(['brass-bar']);
		expect(withThemeAssets(theme, new Map([['brass-bar', 'brass-bar-2']])).parts?.platform?.skin).toBe('brass-bar-2');
	});

	it('should wear a theme as one edit', () => {
		const project = createProject({ title: 'Song' });
		const commands = packThemeCommands(project, theme, { packId: 'christmas', packName: 'Christmas', version: '1.0' });
		expect(commands).toHaveLength(1);
		expect(apply(project, commands).film.theme).toEqual({ base: 'brass', parts: theme.parts, pack: { packId: 'christmas', packName: 'Christmas', version: '1.0', themeId: 'cozy', themeName: 'Cozy' } });
	});

	it('should export the shown theme and chosen items, with what the theme needs', () => {
		const project = createProject({ title: 'Song' });
		const withTheme = { ...project, film: { ...project.film, theme: { base: 'brass', parts: theme.parts } } };
		const [isOk, , exported] = packExport(withTheme, [item('brass-bar', 'skin'), item('bauble', 'decoration'), item('tree', 'decoration')], { name: ' Christmas ', includesTheme: true, assetIds: ['bauble'] });
		expect(isOk).toBe(true);
		expect(exported?.manifest).toMatchObject({ id: 'christmas', name: 'Christmas', version: '1.0' });
		expect(exported?.assetIds.sort()).toEqual(['bauble', 'brass-bar']);
		expect(exported?.manifest.items.map((entry) => entry.kind).sort()).toEqual(['decor', 'skin', 'theme']);
		const stored = JSON.parse(exported?.themes[0]?.json ?? '{}') as TPackTheme;
		expect(stored.name).toBe('Christmas');
		expect(stored.id).not.toBe('cozy');
	});

	it('should export a built-in theme as a stored theme on its base', () => {
		const project = createProject({ title: 'Song' });
		const [, , exported] = packExport(project, [], { name: 'Mine', includesTheme: true, assetIds: [] });
		const stored = JSON.parse(exported?.themes[0]?.json ?? '{}') as TPackTheme;
		expect(stored.base).toBe(project.film.theme.base);
	});

	it('should refuse an empty or unnamed Pack and an item that is not in the project', () => {
		const project = createProject({ title: 'Song' });
		expect(packExport(project, [], { name: ' ', includesTheme: true, assetIds: [] })[0]).toBe(false);
		expect(packExport(project, [], { name: 'A', includesTheme: false, assetIds: [] })[0]).toBe(false);
		expect(packExport(project, [], { name: 'A', includesTheme: false, assetIds: ['gone'] })[0]).toBe(false);
	});

	it('should read Made by Agent for what add_asset adds, Imported for the rest', () => {
		const made = item('a', 'skin');
		const withOrigin = (origin: 'agent' | 'imported' | undefined): TLibraryItem => ({ ...made, manifest: { ...made.manifest, origin } as TLibraryItem['manifest'] });
		expect(libraryItemOrigin(withOrigin('agent'))).toBe('Made by Agent');
		expect(libraryItemOrigin(withOrigin(undefined))).toBe('Imported');
	});

	it('should say where an item comes from and what a Pack holds', () => {
		expect(packOrigin('Christmas')).toBe('Christmas Pack');
		expect(packOrigin('Starter Pack')).toBe('Starter Pack');
		expect(libraryItemOrigin(item('a', 'skin', {}, 'Christmas'))).toBe('Christmas Pack · Not Added');
		addedPacks.set([pack([])]);
		expect(libraryItemOrigin(item('a', 'skin', {}, 'Christmas'))).toBe('Christmas Pack');
		addedPacks.set([]);
		expect(packContents(pack([item('a', 'skin'), item('b', 'decoration')], { themes: [theme], builtInDecor: ['decor:star'] }))).toBe('1 theme, 1 skin, 2 decor items');
		expect(packContents(pack([]))).toBe('Nothing yet');
	});

	it('should list a Pack\'s item until the project holds the Pack\'s copy, without a star', () => {
		const inPack = item('a', 'decoration', { scope: 'global', packId: 'christmas' }, 'Christmas');
		const before = libraryEntries([], [], [pack([inPack])]);
		expect(before).toEqual([{ item: inPack, isKept: false }]);
		const copy = item('a-2', 'decoration', {}, 'Christmas');
		copy.manifest = { ...(copy.manifest as NonNullable<TLibraryItem['manifest']>), label: 'a' };
		expect(libraryEntries([copy], [], [pack([inPack])]).map((entry) => entry.item.id)).toEqual(['a-2']);
	});

	it('should hold every offered skin, wall and theme and Particles in the Starter Pack, and never lose it', () => {
		const offered = SKIN_ELEMENTS.flatMap((element) => catalogSkins(element).map((skin) => skin.id));
		const skins = (STARTER_PACK.builtIn ?? []).filter((entry) => entry.kind === 'skin').map((entry) => entry.source);
		expect(skins.filter((source) => !source.startsWith('wall:'))).toEqual(offered);
		expect(skins.filter((source) => source.startsWith('wall:')).map((source) => source.slice(5)).sort()).toEqual(WALL_KINDS.map((item) => item.kind).sort());
		expect((STARTER_PACK.builtIn ?? []).filter((entry) => entry.kind === 'theme').map((entry) => entry.label)).toEqual(['Pegboard', 'Brass', 'Neon']);
		expect(STARTER_PACK.builtInDecor).toContain('decor:snowfall');
		expect(STARTER_PACK.builtInDecor.every((source) => decorItem(source) != null)).toBe(true);
		expect(packContents(STARTER_PACK)).toBe(`3 themes, ${skins.length} skins, 4 decor items`);
		expect(withStarterPack([{ ...pack([]), id: 'starter' }, pack([])]).map((item) => item.id)).toEqual(['starter', pack([]).id]);
		expect(isPackAdded('starter')).toBe(true);
	});
});
