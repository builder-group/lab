import type { TEntity, TProject, TWallKind } from '@/modules/project';
import { canonicalSkinId } from '@/modules/project/skin-ids';
import { draftMarble } from './draft-look';
import { resolveTheme, type TResolvedTheme } from './project-themes';
import { wallLayer, WALL_KINDS } from './scene-layers';
import { catalogSkin, catalogSkins, type TSkinElement } from './skin-catalog';
import { STARTER_ORIGIN } from '@/modules/library';

// What a selection's picker offers, as tiles: the theme's choice first, the rest as the catalog lists them, and which
// one the selection wears. A mixed selection rings none.

/** The tile that gives a selection back to its theme */
export const THEME_DEFAULT_TILE = 'theme-default';

export interface TLookTile {
	id: string;
	label: string;
	/** Quiet second line: the skin Theme Default stands for, or where the item comes from */
	detail: string;
	previewUrl: string | null;
	isCurrent: boolean;
}

/**
 * Theme Default, then every other built-in skin of the element, a hidden one only while `usedSkins` names it. Choosing
 * the theme's own skin follows the theme (`builtInSkinCommands`), so Theme Default stands for that skin and it has no
 * second tile.
 */
export function skinTiles(design: Parameters<typeof resolveTheme>[0], element: TSkinElement, entities: readonly TEntity[], usedSkins?: ReadonlySet<string>): TLookTile[] {
	const theme = resolveTheme(design);
	const part = theme.parts[element].skin;
	const owns = entities.map((entity) => {
		const assetId = entity.components.skin?.assetId;
		return assetId != null ? canonicalSkinId(assetId) : null;
	});
	const shown = themeSkinShown(theme, element, entities[0]);
	const hasEntities = entities.length > 0;
	return [
		{ id: THEME_DEFAULT_TILE, label: 'Theme Default', detail: shown?.label ?? '', previewUrl: shown?.previewUrl ?? null, isCurrent: hasEntities && owns.every((own) => own == null || own === part) },
		...catalogSkins(element, usedSkins)
			.filter((skin) => skin.id !== part)
			.map((skin) => ({ id: skin.id, label: skin.label, detail: skin.origin, previewUrl: skin.previewUrl, isCurrent: hasEntities && owns.every((own) => own === skin.id) }))
	];
}

/** Every skin the project wears or one of its themes names, which keeps a hidden skin on the tiles */
export function usedSkinIds(project: Pick<TProject, 'entities' | 'design'>): ReadonlySet<string> {
	const worn = project.entities.flatMap((entity) => entity.components.skin?.assetId ?? []);
	const named = (project.design.themes ?? []).flatMap((theme) => Object.values(theme.parts ?? {}).flatMap((part) => part.skin ?? []));
	return new Set([...worn, ...named].map(canonicalSkinId));
}

/** The skin the theme dresses an entity with; a theme's contrast marble is Pearl or Deep by what stands apart from the wall */
function themeSkinShown(theme: TResolvedTheme, element: TSkinElement, entity: TEntity | undefined): ReturnType<typeof catalogSkin> {
	const part = theme.parts[element].skin;
	if (part !== 'marble:contrast') return catalogSkin(part);
	return catalogSkin(`marble:${draftMarble(theme.base, entity?.components.marble?.color ?? '#d0d4dc', theme.overrides).tone}`);
}

/** A wall tile: `kind` null follows the theme. The walls have no rendered previews, so the tile draws its kind */
export interface TWallTile extends TLookTile {
	kind: TWallKind | null;
	shownKind: TWallKind;
}

export function wallTiles(design: Parameters<typeof wallLayer>[0]): TWallTile[] {
	const wall = wallLayer(design);
	const themeKind = wall.theme.kind;
	return [
		{ id: THEME_DEFAULT_TILE, kind: null, shownKind: themeKind, label: 'Theme Default', detail: wallKindLabel(themeKind), previewUrl: null, isCurrent: wall.own.kind == null || wall.own.kind === themeKind },
		...WALL_KINDS.filter((item) => item.kind !== themeKind).map((item) => ({ id: item.kind, kind: item.kind, shownKind: item.kind, label: item.label, detail: STARTER_ORIGIN, previewUrl: null, isCurrent: wall.own.kind === item.kind }))
	];
}

function wallKindLabel(kind: TWallKind): string {
	return WALL_KINDS.find((item) => item.kind === kind)?.label ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** A picker's choices are searched from this many on */
const TILE_SEARCH_FROM = 13;

export function showsTileSearch(tiles: readonly unknown[]): boolean {
	return tiles.length >= TILE_SEARCH_FROM;
}

/** The tiles whose name or origin holds every typed word */
export function filterTiles<GTile extends { label: string; detail?: string }>(tiles: readonly GTile[], query: string): readonly GTile[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return tiles;
	return tiles.filter((tile) => {
		const text = `${tile.label} ${tile.detail ?? ''}`.toLowerCase();
		return words.every((word) => text.includes(word));
	});
}
