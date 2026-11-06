import type { TSceneThemeOverrides } from './scene-description';
import { createId, type TFilm, type TFilmTheme, type TPackOrigin, type TPackTheme, type TProject, type TProjectCommand, type TSkin, type TThemePart, type TThemeParts } from '@/modules/project';
import { STARTER_ORIGIN } from './pack-data';
import { catalogSkin, skinElementOf, resolveSkinLook, SKIN_ELEMENTS, skinnedOf, type TSkinElement, type TSkinLook } from './skin-catalog';

// The one theme a film wears: `film.theme` is a built-in base and what changes its skins, and the film's colors and
// light are on `film.wall` and `film.lights`. Applying a Pack's theme writes its look there. The Blender worker and the
// Draft Preview both read the base plus those colors (`themes.py` `resolve_theme`).

/** The origin line of what came from a Pack: "Christmas Pack" */
export function packOrigin(name: string): string {
	return /\bpack$/i.test(name) ? name : `${name} Pack`;
}

/** The origin line of a copy from a Pack: "Christmas Pack", with "· Not Added" where this Mac doesn't have the Pack */
export function packOriginLine(origin: TPackOrigin, isPackAdded: (packId: string) => boolean): string {
	return isPackAdded(origin.packId) ? packOrigin(origin.packName) : `${packOrigin(origin.packName)} · Not Added`;
}

/** Built-in themes the Blender worker ships, in Library order */
export const BUILT_IN_THEMES: readonly { id: string; label: string }[] = [
	{ id: 'pegboard', label: 'Pegboard' },
	{ id: 'brass', label: 'Brass' },
	{ id: 'neon', label: 'Neon' }
];

/** Built-in theme Blender falls back to for an unknown id, `DEFAULT_THEME` in themes.py */
export const DEFAULT_THEME = 'pegboard';

/** The colors a film can change on its base theme, as the scene description names them */
export interface TThemeColors {
	wallColor?: string;
	lightColor?: string;
	glowColor?: string;
	backgroundColor?: string;
}

export type TThemeColorName = keyof TThemeColors;

/** The colors a theme tile shows, in order */
export const THEME_COLOR_FIELDS: readonly { name: TThemeColorName; label: string }[] = [
	{ name: 'wallColor', label: 'Wall' },
	{ name: 'lightColor', label: 'Light' },
	{ name: 'glowColor', label: 'Glow' },
	{ name: 'backgroundColor', label: 'Background' }
];

/** A theme as applied */
export interface TResolvedTheme {
	/** The Pack theme's ID, else the built-in base */
	id: string;
	name: string;
	/** Built-in theme the look starts from */
	base: string;
	glowColor?: string;
	/** What it dresses each element type with: its base's, with its own parts on top */
	parts: Record<TSkinElement, TSkinLook>;
	/** The parts it sets itself */
	ownParts?: TThemeParts;
	/** The Pack it came from */
	pack?: NonNullable<TFilmTheme['pack']>;
}

export function isBuiltInTheme(id: string): boolean {
	return BUILT_IN_THEMES.some((theme) => theme.id === id);
}

export function builtInThemeLabel(id: string): string | null {
	return BUILT_IN_THEMES.find((theme) => theme.id === id)?.label ?? null;
}

/** The film's theme. An unknown base draws as the default theme, like in Blender. */
export function resolveTheme(film: Pick<TFilm, 'theme'>): TResolvedTheme {
	const { parts, glowColor, pack } = film.theme;
	const base = isBuiltInTheme(film.theme.base) ? film.theme.base : DEFAULT_THEME;
	return {
		id: pack?.themeId ?? base,
		name: pack?.themeName ?? builtInThemeLabel(base) ?? base,
		base,
		...(glowColor != null ? { glowColor } : {}),
		parts: resolveParts(base, parts),
		...(parts != null ? { ownParts: parts } : {}),
		...(pack != null ? { pack } : {})
	};
}

function resolveParts(base: string, parts: TThemeParts | null | undefined): Record<TSkinElement, TSkinLook> {
	return Object.fromEntries(SKIN_ELEMENTS.map((element) => [element, resolveSkinLook(base, parts, element)])) as Record<TSkinElement, TSkinLook>;
}

/** What an element wears under the theme, with its own skin's values */
export function resolveElementLook(film: Pick<TFilm, 'theme'>, element: TSkinElement, component?: TSkin | null): TSkinLook {
	const theme = resolveTheme(film);
	return resolveSkinLook(theme.base, theme.ownParts, element, component);
}

/** The theme's own parts for the scene description; absent without any */
export function sceneThemeParts(film: Pick<TFilm, 'theme'>): TThemeParts | undefined {
	const parts = film.theme.parts;
	return parts != null && Object.keys(parts).length > 0 ? parts : undefined;
}

/** Whether the theme's platforms take their note's color: Color by Note as a theme's default */
export function isThemeColorByNote(film: Pick<TFilm, 'theme'>): boolean {
	return resolveTheme(film).parts.platform.colorSource === 'note';
}

/** Built-in theme the film's look starts from: skins, reactions, title color and render look follow it */
export function baseThemeOf(film: Pick<TFilm, 'theme'>): string {
	return resolveTheme(film).base;
}

/** The Wall under the skin None: plain Pegboard in its color, whatever the theme */
export function noneWallColor(labelColor: string | undefined): string {
	return labelColor ?? themeDefaultColor('pegboard', 'wallColor') ?? '#ffffff';
}

/** The colors the film sets on its base theme, for the scene description and the Draft Preview */
export function appliedColors(film: Pick<TFilm, 'theme' | 'wall' | 'lights'>): TThemeColors {
	const wallColor = film.wall.kind === 'none' ? noneWallColor(film.wall.labelColor) : film.wall.color;
	const lightColor = film.lights.key?.color;
	const { glowColor } = film.theme;
	const backgroundColor = film.wall.backgroundColor;
	return {
		...(wallColor != null ? { wallColor } : {}),
		...(lightColor != null ? { lightColor } : {}),
		...(glowColor != null ? { glowColor } : {}),
		...(backgroundColor != null ? { backgroundColor } : {})
	};
}

/** The film's colors for the scene description; absent when it wears its base's as they are */
export function sceneThemeOverrides(film: Pick<TFilm, 'theme' | 'wall' | 'lights'>): TSceneThemeOverrides | undefined {
	const entries = Object.entries(appliedColors(film)).filter(([, value]) => typeof value === 'string' && value.length > 0);
	return entries.length > 0 ? (Object.fromEntries(entries.map(([name, value]) => [name, value.toLowerCase()])) as TSceneThemeOverrides) : undefined;
}

/**
 * What each color shows while it is not set: the base theme's own, from `THEMES` in themes.py (linear values turned
 * into display hex). Glow has none: edges take their marble's color.
 */
export function themeDefaultColor(base: string, name: TThemeColorName): string | null {
	const theme = BASE_COLORS[base] ?? BASE_COLORS[DEFAULT_THEME];
	if (theme == null || name === 'glowColor') return null;
	const linear = name === 'wallColor' ? theme.wall : name === 'lightColor' ? theme.light : theme.background;
	return linearToHex(linear);
}

// Linear colors of `THEMES` in themes.py: the wall (Pegboard's hardboard tint), the sun and the world
const BASE_COLORS: Record<string, { wall: readonly number[]; light: readonly number[]; background: readonly number[] }> = {
	pegboard: { wall: [0.58, 0.42, 0.26], light: [1.0, 0.96, 0.9], background: [0.72, 0.74, 0.78] },
	brass: { wall: [0.385, 0.34, 0.5], light: [1.0, 0.95, 0.88], background: [0.53, 0.5, 0.62] },
	neon: { wall: [0.006, 0.008, 0.02], light: [0.86, 0.92, 1.0], background: [0.05, 0.06, 0.12] }
};

function linearToHex(linear: readonly number[]): string {
	const toSrgb = (value: number): number => (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055);
	return `#${linear.map((value) => Math.round(Math.max(0, Math.min(1, toSrgb(value))) * 255).toString(16).padStart(2, '0')).join('')}`;
}

// MARK: - Commands

/** The relative luminance above which a wall takes dark titles: Pegboard's birch does, Brass's lavender plaster doesn't */
const LIGHT_WALL_LUMINANCE = 0.7;

/** The title color that reads on a wall: white with its soft shadow, navy only on a wall too light for white */
export function titleColorOnWall(wall: string): string {
	const channel = (start: number): number => {
		const value = Number.parseInt(wall.slice(start, start + 2), 16) / 255;
		return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5) > LIGHT_WALL_LUMINANCE ? '#1f3a5f' : '#ffffff';
}

/** What a title reads in when its own color is unset, and the color a new one starts with: it stands apart from the wall the project shows */
export function defaultTitleColor(film: Pick<TFilm, 'theme' | 'wall'>): string {
	const wall = film.wall.kind === 'none' ? noneWallColor(film.wall.labelColor) : film.wall.color;
	return titleColorOnWall(wall ?? themeDefaultColor(resolveTheme(film).base, 'wallColor') ?? '#ffffff');
}

/**
 * The film's look as one edit; titles still in the old look's title color take the new one's. A marble's color stays:
 * it tells marbles apart, and a theme applies to all of them
 */
function lookCommands(project: TProject, look: Pick<TFilm, 'theme' | 'wall' | 'lights'>): TProjectCommand[] {
	const oldColor = defaultTitleColor(project.film);
	const newColor = defaultTitleColor(look);
	const isRecolored = oldColor !== newColor && project.film.titles.some((title) => title.color?.toLowerCase() === oldColor);
	const titles = isRecolored ? { titles: project.film.titles.map((title) => (title.color?.toLowerCase() === oldColor ? { ...title, color: newColor } : title)) } : {};
	return [{ type: 'updateFilm', film: { theme: look.theme, ...(look.wall !== project.film.wall ? { wall: look.wall } : {}), ...(look.lights !== project.film.lights ? { lights: look.lights } : {}), ...titles } }];
}

/** The Wall with only its label color, which is Track's and stays through a change of theme */
function bareWall(film: Pick<TFilm, 'wall'>): TFilm['wall'] {
	return film.wall.labelColor != null ? { labelColor: film.wall.labelColor } : {};
}

/**
 * Switches to a built-in theme. Wall and Lights values stay on top of it; only a Pack's theme takes its own along when
 * the film leaves it, added lights too, since they stand in the same place.
 */
export function themeCommands(project: TProject, base: string): TProjectCommand[] {
	const { film } = project;
	if (JSON.stringify(film.theme) === JSON.stringify({ base })) return [];
	return lookCommands(project, film.theme.pack != null ? { theme: { base }, wall: bareWall(film), lights: { added: [] } } : { theme: { base }, wall: film.wall, lights: film.lights });
}

/** Wears a Pack's theme, as one edit: its look replaces the film's theme, Wall and Lights */
export function packThemeCommands(project: TProject, theme: TPackTheme, origin: TPackOrigin): TProjectCommand[] {
	const { base, parts, glowColor, wall, lights } = theme;
	return lookCommands(project, {
		theme: { base, ...(parts != null ? { parts } : {}), ...(glowColor != null ? { glowColor } : {}), pack: { ...origin, themeId: theme.id, themeName: theme.name } },
		wall: { ...bareWall(project.film), ...wall },
		lights: lights ?? { added: [] }
	});
}

/**
 * The current look as a theme for a Pack, under a new ID: the theme's base and parts, this project's Wall and Lights, and
 * as parts the look most pieces of each element type wear, built-in skins only.
 */
export function currentLookTheme(project: TProject, name: string): TPackTheme {
	const { theme, wall, lights } = project.film;
	const { wallColor, backgroundColor } = appliedColors(project.film);
	const kind = wall.kind === 'none' ? 'pegboard' : wall.kind;
	const parts = { ...theme.parts, ...currentThemeParts(project) };
	const wallLook = { ...(wallColor != null ? { color: wallColor } : {}), ...(backgroundColor != null ? { backgroundColor } : {}), ...(kind != null ? { kind } : {}) };
	return {
		id: createId('theme'),
		name,
		base: resolveTheme(project.film).base,
		...(Object.keys(parts).length > 0 ? { parts } : {}),
		...(theme.glowColor != null ? { glowColor: theme.glowColor } : {}),
		...(Object.keys(wallLook).length > 0 ? { wall: wallLook } : {}),
		...(lights.key != null || lights.added.length > 0 ? { lights } : {})
	};
}

function currentThemeParts(project: TProject): TThemeParts {
	const counts = new Map<TSkinElement, Map<string, { part: TThemePart; count: number }>>();
	for (const piece of skinnedOf(project)) {
		const element = skinElementOf(piece);
		const part = partOf(piece.skin);
		if (part == null) continue;
		const looks = counts.get(element) ?? new Map<string, { part: TThemePart; count: number }>();
		const key = JSON.stringify(part);
		looks.set(key, { part, count: (looks.get(key)?.count ?? 0) + 1 });
		counts.set(element, looks);
	}
	const parts: TThemeParts = {};
	for (const element of SKIN_ELEMENTS) {
		const looks = [...(counts.get(element)?.values() ?? [])];
		const total = skinnedOf(project).filter((piece) => skinElementOf(piece) === element).length;
		const best = looks.sort((a, b) => b.count - a.count)[0];
		// Only what most of the type wear becomes its default; a few skinned pieces stay exceptions
		if (best != null && best.count * 2 >= total) parts[element] = best.part;
	}
	return parts;
}

/** The part a skin component's choices make; null for a library skin or no choices */
function partOf(skin: TSkin | undefined): TThemePart | null {
	if (skin == null) return null;
	const { assetId, colorSource, onHit, glowColor, variant } = skin;
	if (assetId != null && catalogSkin(assetId) == null) return null;
	const part: TThemePart = {
		...(assetId != null ? { skin: assetId } : {}),
		...(colorSource != null ? { colorSource } : {}),
		...(onHit != null ? { onHit } : {}),
		...(glowColor != null ? { glowColor } : {}),
		...(variant != null ? { variant } : {})
	};
	return Object.keys(part).length > 0 ? part : null;
}

/** Where a theme comes from, as its tile's quiet line: Starter or its Pack */
export function themeOrigin(theme: TResolvedTheme, isPackAdded: (packId: string) => boolean): string {
	return theme.pack != null ? packOriginLine(theme.pack, isPackAdded) : STARTER_ORIGIN;
}
