import { describe, expect, it } from 'vitest';
import { createProject, type TEntity, type TProject } from '@/modules/project';
import { catalogSkins } from './skin-catalog';
import { filterTiles, showsTileSearch, skinTiles, THEME_DEFAULT_TILE, usedSkinIds, wallTiles } from './skin-tiles';

function platform(id: string, assetId?: string): TEntity {
	return { id, components: { piece: { type: 'platform' }, ...(assetId != null ? { skin: { assetId } } : {}) } } as unknown as TEntity;
}

function brassProject(entities: TEntity[] = []): TProject {
	const project = createProject({ id: 'p', title: 'T' });
	project.design.theme = 'brass';
	project.entities.push(...entities);
	return project;
}

describe('skinTiles function', () => {
	it('should list the skin of the theme first, by name, then the other skins with previews', () => {
		const tiles = skinTiles(brassProject().design, 'platform', [platform('a')]);
		expect(tiles[0]).toMatchObject({ id: THEME_DEFAULT_TILE, label: 'Theme: Gold', isCurrent: true });
		expect(tiles[0]?.previewUrl).toBe('/skins/platform-gold.png');
		expect(tiles.some((tile) => tile.id === 'platform:gold')).toBe(false);
		expect(tiles.length).toBe(catalogSkins('platform').length);
		expect(tiles.every((tile) => tile.previewUrl != null)).toBe(true);
	});

	it('should ring the skin the selection wears, and nothing for a mixed selection', () => {
		const design = brassProject().design;
		const current = (entities: TEntity[]): string[] => skinTiles(design, 'platform', entities).filter((tile) => tile.isCurrent).map((tile) => tile.id);
		expect(current([platform('a', 'platform:copper')])).toEqual(['platform:copper']);
		expect(current([platform('a', 'platform:copper'), platform('b', 'platform:copper')])).toEqual(['platform:copper']);
		expect(current([platform('a', 'platform:copper'), platform('b', 'platform:silver')])).toEqual([]);
		expect(current([platform('a', 'platform:copper'), platform('b')])).toEqual([]);
		// A skin pinned to what the theme already wears reads as the theme's
		expect(current([platform('a', 'platform:gold')])).toEqual([THEME_DEFAULT_TILE]);
		// A library skin is none of the built-in tiles
		expect(current([platform('a', 'asset-1')])).toEqual([]);
	});

	it("should picture a theme's contrast marble as the skin it resolves to", () => {
		const marble = { id: 'm', components: { marble: { color: '#e0533d' } } } as unknown as TEntity;
		const [first] = skinTiles(brassProject().design, 'marble', [marble]);
		expect(first?.id).toBe(THEME_DEFAULT_TILE);
		expect(first?.previewUrl).not.toBeNull();
	});
});

describe('wallTiles function', () => {
	it('should follow the theme until the project chooses another wall', () => {
		const project = brassProject();
		const tiles = wallTiles(project.design);
		expect(tiles[0]).toMatchObject({ id: THEME_DEFAULT_TILE, kind: null, isCurrent: true });
		expect(tiles.filter((tile) => tile.kind === tiles[0]?.shownKind)).toEqual([]);
		const chosen = wallTiles({ ...project.design, wall: { kind: 'grid' } });
		expect(chosen.filter((tile) => tile.isCurrent).map((tile) => tile.id)).toEqual(['grid']);
	});
});

describe('hidden skins', () => {
	it('should stay off the tiles until the project uses them, and show their origin then', () => {
		const labels = (skins?: ReadonlySet<string>): string[] => skinTiles(brassProject().design, 'platform', [], skins).map((tile) => tile.label);
		expect(labels()).toEqual(['Theme: Gold', 'Copper', 'Silver', 'Gold Plate', 'Copper Plate', 'Wood Plate', 'Chrome Device', 'Dark Housing', 'Pegboard', 'Neon']);
		const used = usedSkinIds(brassProject([platform('a', 'platform:knob')]));
		expect(labels(used)).toContain('Knob');
		expect(skinTiles(brassProject().design, 'platform', [], used).find((tile) => tile.label === 'Knob')?.detail).toBe('Brass Sections');
	});

	it('should count what a project theme names as used', () => {
		const project = brassProject();
		const used = usedSkinIds({ ...project, design: { ...project.design, themes: [{ id: 't', name: 'T', base: 'brass', overrides: {}, parts: { rail: { skin: 'rail:candy' } } }] } });
		expect(used.has('rail:candy')).toBe(true);
	});

	it('should offer Glass, Metal and Magic for marbles, with the theme\'s Pearl or Deep first', () => {
		expect(skinTiles(brassProject().design, 'marble', []).map((tile) => tile.label)).toEqual([expect.stringMatching(/^Theme: (Pearl|Deep)$/), 'Glass', 'Metal', 'Magic']);
	});
});

describe('filterTiles function', () => {
	const tiles = [{ label: 'Theme: Gold', detail: '' }, { label: 'Copper', detail: 'Starter' }, { label: 'Gift', detail: 'Christmas Pack' }];

	it('should keep every tile without a query and match the name or the origin by each word', () => {
		expect(filterTiles(tiles, ' ')).toHaveLength(3);
		expect(filterTiles(tiles, 'cop').map((tile) => tile.label)).toEqual(['Copper']);
		expect(filterTiles(tiles, 'christmas gi').map((tile) => tile.label)).toEqual(['Gift']);
		expect(filterTiles(tiles, 'nope')).toEqual([]);
	});

	it('should offer search only past about 12 items', () => {
		expect(showsTileSearch(Array.from({ length: 12 }))).toBe(false);
		expect(showsTileSearch(Array.from({ length: 13 }))).toBe(true);
	});
});
