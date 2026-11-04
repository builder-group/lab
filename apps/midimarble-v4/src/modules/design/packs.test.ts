import { describe, expect, it } from 'vitest';
import { addedPacks, type TLibraryItem, type TPack } from '@/modules/library';
import { createProject, type TProjectTheme } from '@/modules/project';
import { libraryEntries, libraryItemOrigin, packContents } from './DesignLibraryCx';
import { packExport, packThemeCommands, themeAssetIds, withThemeAssets } from './packs';
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

const theme: TProjectTheme = { id: 'cosy', name: 'Cosy', base: 'brass', overrides: {}, parts: { platform: { skin: 'brass-bar' }, rail: { skin: 'rail:chrome' } } };

function pack(items: TLibraryItem[], extra: Partial<TPack> = {}): TPack {
	return { id: 'christmas', path: '/p', name: 'Christmas', version: '1.0', description: null, author: null, link: null, pictureUrl: null, themes: [], items, builtInDecor: [], ...extra };
}

describe('Packs', () => {
	it('should read a theme\'s library items and leave built-in skins out', () => {
		expect(themeAssetIds(theme)).toEqual(['brass-bar']);
		expect(withThemeAssets(theme, new Map([['brass-bar', 'brass-bar-2']])).parts?.platform?.skin).toBe('brass-bar-2');
	});

	it('should add a theme and show it as one edit', () => {
		const project = createProject({ title: 'Song' });
		const commands = packThemeCommands(project, theme);
		expect(commands[0]).toEqual({ type: 'setDesign', design: { themes: [theme] } });
		expect(commands.some((command) => command.type === 'setDesign' && command.design.theme === 'cosy')).toBe(true);
	});

	it('should export the shown theme and chosen items, with what the theme needs', () => {
		const project = createProject({ title: 'Song' });
		const withTheme = { ...project, design: { ...project.design, themes: [theme], theme: 'cosy' } };
		const [isOk, , exported] = packExport(withTheme, [item('brass-bar', 'skin'), item('bauble', 'decoration'), item('tree', 'decoration')], { name: ' Christmas ', includesTheme: true, assetIds: ['bauble'] });
		expect(isOk).toBe(true);
		expect(exported?.manifest).toMatchObject({ id: 'christmas', name: 'Christmas', version: '1.0' });
		expect(exported?.assetIds.sort()).toEqual(['bauble', 'brass-bar']);
		expect(exported?.manifest.items.map((entry) => entry.kind).sort()).toEqual(['decor', 'skin', 'theme']);
		const stored = JSON.parse(exported?.themes[0]?.json ?? '{}') as TProjectTheme;
		expect(stored.name).toBe('Cosy');
		expect(stored.id).not.toBe('cosy');
	});

	it('should export a built-in theme as a stored theme on its base', () => {
		const project = createProject({ title: 'Song' });
		const [, , exported] = packExport(project, [], { name: 'Mine', includesTheme: true, assetIds: [] });
		const stored = JSON.parse(exported?.themes[0]?.json ?? '{}') as TProjectTheme;
		expect(stored.base).toBe(project.design.theme);
	});

	it('should refuse an empty or unnamed Pack and an item that is not in the project', () => {
		const project = createProject({ title: 'Song' });
		expect(packExport(project, [], { name: ' ', includesTheme: true, assetIds: [] })[0]).toBe(false);
		expect(packExport(project, [], { name: 'A', includesTheme: false, assetIds: [] })[0]).toBe(false);
		expect(packExport(project, [], { name: 'A', includesTheme: false, assetIds: ['gone'] })[0]).toBe(false);
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
});
