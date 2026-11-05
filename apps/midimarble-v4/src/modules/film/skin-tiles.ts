import { marbleColors, type TProject, type TWallKind, type TWallSkin } from '@/modules/project';
import { draftMarble, resolveTheme, skinnedOf, type TResolvedTheme, type TSkinned, wallLayer, WALL_KINDS, catalogSkin, catalogSkins, type TSkinElement, STARTER_ORIGIN } from '@/modules/scene';

// What a selection's picker offers, as tiles: the theme's choice first, the rest as the catalog lists them, and which
// one the selection wears. A mixed selection rings none.

/** The tile that gives a selection back to its theme */
export const THEME_DEFAULT_TILE = 'theme-default';

export interface TLookTile {
	id: string;
	label: string;
	/** Quiet second line: where the item comes from */
	detail: string;
	previewUrl: string | null;
	isCurrent: boolean;
}

/**
 * The theme's skin, such as "Theme: Gold Plate", then every other built-in skin of the element, a hidden one only while
 * `usedSkins` names it. Choosing the theme's own skin follows the theme (`builtInSkinCommands`), so it has no second tile.
 * The first tile gives the selection back to its theme, properties too.
 */
export function skinTiles(film: Parameters<typeof resolveTheme>[0], element: TSkinElement, pieces: readonly TSkinned[], usedSkins?: ReadonlySet<string>): TLookTile[] {
	const theme = resolveTheme(film);
	const part = theme.parts[element].skin;
	const owns = pieces.map((piece) => {
		const assetId = piece.skin?.assetId;
		return assetId != null ? assetId : null;
	});
	const shown = themeSkinShown(theme, element, pieces[0]);
	const hasPieces = pieces.length > 0;
	return [
		{ id: THEME_DEFAULT_TILE, label: themeTileLabel(shown?.label), detail: '', previewUrl: shown?.previewUrl ?? null, isCurrent: hasPieces && owns.every((own) => own == null || own === part) },
		...catalogSkins(element, usedSkins)
			.filter((skin) => skin.id !== part)
			.map((skin) => ({ id: skin.id, label: skin.label, detail: skin.origin, previewUrl: skin.previewUrl, isCurrent: hasPieces && owns.every((own) => own === skin.id) }))
	];
}

function themeTileLabel(skin: string | undefined): string {
	return skin != null ? `Theme: ${skin}` : 'Theme';
}

/** Every skin the project wears or one of its themes names, which keeps a hidden skin on the tiles */
export function usedSkinIds(project: Pick<TProject, 'track' | 'marbles' | 'film'>): ReadonlySet<string> {
	const worn = skinnedOf(project).flatMap((piece) => piece.skin?.assetId ?? []);
	const named = project.film.themes.flatMap((theme) => Object.values(theme.parts ?? {}).flatMap((part) => part.skin ?? []));
	return new Set([...worn, ...named]);
}

/** The skin the theme dresses an piece with; a theme's contrast marble is Pearl or Deep by what stands apart from the wall */
function themeSkinShown(theme: TResolvedTheme, element: TSkinElement, piece: TSkinned | undefined): ReturnType<typeof catalogSkin> {
	const part = theme.parts[element].skin;
	if (part !== 'marble:contrast') return catalogSkin(part);
	return catalogSkin(`marble:${draftMarble(theme.base, piece == null ? '#d0d4dc' : (piece.skin?.color ?? marbleColors[0] ?? '#d0d4dc'), theme.overrides).tone}`);
}

/** A wall tile: `kind` null follows the theme. The walls have no rendered previews, so the tile draws its kind */
export interface TWallTile extends TLookTile {
	kind: TWallSkin | null;
	shownKind: TWallSkin;
}

export function wallTiles(film: Parameters<typeof wallLayer>[0]): TWallTile[] {
	const wall = wallLayer(film);
	const themeKind = wall.theme.kind;
	return [
		{ id: THEME_DEFAULT_TILE, kind: null, shownKind: themeKind, label: themeTileLabel(wallKindLabel(themeKind)), detail: '', previewUrl: null, isCurrent: wall.own.kind == null || wall.own.kind === themeKind },
		{ id: 'none', kind: 'none', shownKind: 'none', label: 'None', detail: STARTER_ORIGIN, previewUrl: null, isCurrent: wall.own.kind === 'none' },
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
