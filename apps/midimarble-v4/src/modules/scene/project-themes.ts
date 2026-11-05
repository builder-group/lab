import type { TSceneThemeOverrides } from './scene-description';
import { createId, type TFilm, type TEntity, type TKeyLightPose, type TProject, type TPackOrigin, type TProjectCommand, type TProjectTheme, type TSkinComponent, type TThemeOverrides, type TThemePart, type TThemeParts } from '@/modules/project';
import { STARTER_ORIGIN } from './pack-data';
import { catalogSkin, entitySkinElement, resolveSkinLook, SKIN_ELEMENTS, type TSkinElement, type TSkinLook } from './skin-catalog';

// Themes a project makes from a built-in one. A project theme keeps its base's skins, reactions and render look and
// changes a few colors on top (`TThemeOverrides`). `film.theme` names a built-in id or a project theme's id; the
// Blender worker and the Draft Preview both read the base plus the overrides (`themes.py` `resolve_theme`).

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

export type TThemeOverrideName = keyof TThemeOverrides;

/** The overrides the inspector shows, in order, with the help behind each label */
export const THEME_OVERRIDE_FIELDS: readonly { name: TThemeOverrideName; label: string; help: string }[] = [
	{ name: 'wallColor', label: 'Wall', help: 'Color of the wall behind the track' },
	{ name: 'lightColor', label: 'Light', help: 'Color of the key light: warm, neutral or cool' },
	{ name: 'glowColor', label: 'Glow', help: "Color of the glowing edges; without one they take their marble's color" },
	{ name: 'backgroundColor', label: 'Background', help: 'Color of the surroundings that light and reflect in the track' }
];

/** A theme as applied: a built-in one, a project theme with its base and overrides, or an unknown id */
export interface TResolvedTheme {
	id: string;
	name: string;
	/** Built-in theme the look starts from */
	base: string;
	overrides: TThemeOverrides;
	/** What it dresses each element type with: its base's, with a project theme's parts on top */
	parts: Record<TSkinElement, TSkinLook>;
	isBuiltIn: boolean;
	/** The project theme behind it, null for a built-in or unknown id */
	projectTheme: TProjectTheme | null;
}

export function isBuiltInTheme(id: string): boolean {
	return BUILT_IN_THEMES.some((theme) => theme.id === id);
}

export function builtInThemeLabel(id: string): string | null {
	return BUILT_IN_THEMES.find((theme) => theme.id === id)?.label ?? null;
}

export function projectThemes(film: Pick<TFilm, 'themes'>): TProjectTheme[] {
	return film.themes;
}

/** Resolves a theme id, the applied theme by default. An unknown id draws as the default theme, like in Blender. */
export function resolveTheme(film: Pick<TFilm, 'theme' | 'themes'>, id: string = film.theme): TResolvedTheme {
	const builtIn = builtInThemeLabel(id);
	if (builtIn != null) return { id, name: builtIn, base: id, overrides: {}, parts: resolveParts(id, null), isBuiltIn: true, projectTheme: null };
	const theme = projectThemes(film).find((item) => item.id === id);
	if (theme == null) return { id, name: id, base: DEFAULT_THEME, overrides: {}, parts: resolveParts(DEFAULT_THEME, null), isBuiltIn: false, projectTheme: null };
	const base = isBuiltInTheme(theme.base) ? theme.base : DEFAULT_THEME;
	return { id, name: theme.name, base, overrides: theme.overrides, parts: resolveParts(base, theme.parts), isBuiltIn: false, projectTheme: theme };
}

function resolveParts(base: string, parts: TThemeParts | null | undefined): Record<TSkinElement, TSkinLook> {
	return Object.fromEntries(SKIN_ELEMENTS.map((element) => [element, resolveSkinLook(base, parts, element)])) as Record<TSkinElement, TSkinLook>;
}

/** What an element wears under the applied theme, with its own skin component's overrides */
export function resolveElementLook(film: Pick<TFilm, 'theme' | 'themes'>, element: TSkinElement, component?: TSkinComponent | null): TSkinLook {
	const theme = resolveTheme(film);
	return resolveSkinLook(theme.base, theme.projectTheme?.parts, element, component);
}

/** A project theme's parts for the scene description; absent for a built-in theme or a project theme without any */
export function sceneThemeParts(film: Pick<TFilm, 'theme' | 'themes'>): TThemeParts | undefined {
	const parts = resolveTheme(film).projectTheme?.parts;
	return parts != null && Object.keys(parts).length > 0 ? parts : undefined;
}

/** Whether the theme's platforms take their note's color: Color by Note as a theme's default */
export function isThemeColorByNote(film: Pick<TFilm, 'theme' | 'themes'>): boolean {
	return resolveTheme(film).parts.platform.colorSource === 'note';
}

/** Built-in theme the applied theme starts from: skins, reactions, title color and render look follow it */
export function baseThemeOf(film: Pick<TFilm, 'theme' | 'themes'>): string {
	return resolveTheme(film).base;
}

/** The Wall under the skin None: plain Pegboard in its color, whatever the theme */
export function noneWallColor(labelColor: string | undefined): string {
	return labelColor ?? themeDefaultColor('pegboard', 'wallColor') ?? '#ffffff';
}

/**
 * The colors the film uses: the applied theme's overrides with the Wall and Key Light layers' own colors on top,
 * for the scene description and the Draft Preview
 */
export function appliedOverrides(film: Pick<TFilm, 'theme' | 'themes' | 'wall' | 'lights'>): TThemeOverrides {
	const overrides: TThemeOverrides = { ...resolveTheme(film).overrides };
	if (film.wall.kind === 'none') overrides.wallColor = noneWallColor(film.wall.labelColor);
	else if (film.wall.color != null) overrides.wallColor = film.wall.color;
	if (film.wall.backgroundColor != null) overrides.backgroundColor = film.wall.backgroundColor;
	if (film.lights.key?.color != null) overrides.lightColor = film.lights.key.color;
	return overrides;
}

/** Overrides of the film's look for the scene description; absent for a built-in or a project theme without any */
export function sceneThemeOverrides(film: Pick<TFilm, 'theme' | 'themes' | 'wall' | 'lights'>): TSceneThemeOverrides | undefined {
	const overrides = appliedOverrides(film);
	const entries = Object.entries(overrides).filter(([, value]) => typeof value === 'string' && value.length > 0);
	return entries.length > 0 ? (Object.fromEntries(entries.map(([name, value]) => [name, value.toLowerCase()])) as TSceneThemeOverrides) : undefined;
}

/**
 * What each override shows while it is not set: the base theme's own color, from `THEMES` in themes.py (linear
 * values turned into display hex). Glow has none: edges take their marble's color.
 */
export function themeDefaultColor(base: string, name: TThemeOverrideName): string | null {
	const theme = BASE_COLORS[base] ?? BASE_COLORS[DEFAULT_THEME];
	if (theme == null || name === 'glowColor') return null;
	const linear = name === 'wallColor' ? theme.wall : name === 'lightColor' ? theme.light : theme.background;
	return linearToHex(linear);
}

// Linear colors of `THEMES` in themes.py: the wall (Pegboard's hardboard tint), the sun and the world
const BASE_COLORS: Record<string, { wall: readonly number[]; light: readonly number[]; background: readonly number[] }> = {
	pegboard: { wall: [0.58, 0.42, 0.26], light: [1.0, 0.96, 0.9], background: [0.72, 0.74, 0.78] },
	brass: { wall: [0.42, 0.355, 0.53], light: [1.0, 0.95, 0.88], background: [0.53, 0.5, 0.62] },
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

/** The color titles start with in a base theme */
export function themeTitleColor(base: string): string {
	return titleColorOnWall(themeDefaultColor(base, 'wallColor') ?? '#ffffff');
}

/** What a title reads in when its own color is unset, and the color a new one starts with: it stands apart from the wall the project shows */
export function defaultTitleColor(film: Pick<TFilm, 'theme' | 'themes' | 'wall'>): string {
	const theme = resolveTheme(film);
	return titleColorOnWall((film.wall.kind === 'none' ? noneWallColor(film.wall.labelColor) : film.wall.color) ?? theme.overrides.wallColor ?? themeDefaultColor(theme.base, 'wallColor') ?? '#ffffff');
}

/**
 * Switches the theme; titles still in the old base's title color take the new one's. A marble's color stays: it tells
 * marbles apart, and a theme applies to all of them
 */
export function themeCommands(project: TProject, themeId: string): TProjectCommand[] {
	if (project.film.theme === themeId) return [];
	const oldColor = defaultTitleColor(project.film);
	const newColor = defaultTitleColor({ ...project.film, theme: themeId });
	const titles =
		oldColor === newColor
			? []
			: project.entities.flatMap((entity: TEntity) => {
					const text = entity.components.wallText;
					if (text?.color == null || text.color.toLowerCase() !== oldColor) return [];
					return [{ type: 'setComponent' as const, entityId: entity.id, component: { name: 'wallText' as const, value: { ...text, color: newColor } } }];
				});
	return [{ type: 'updateFilm', film: { theme: themeId } }, ...titles];
}

/**
 * What keeping a look builds on: a project theme with the source's base and overrides, named like Finder's copies
 * ("Neon Copy", "Neon Copy 2"), and applied, as one edit
 */
export function duplicateThemeCommands(project: TProject, sourceId: string): { commands: TProjectCommand[]; themeId: string } {
	const source = resolveTheme(project.film, sourceId);
	const theme: TProjectTheme = {
		id: createId('theme'),
		name: copyName(source.name, projectThemes(project.film).map((item) => item.name)),
		base: source.base,
		overrides: { ...source.overrides },
		...sceneOf(source.projectTheme),
		...(source.projectTheme?.parts != null ? { parts: source.projectTheme.parts } : {})
	};
	// The applied theme's copy keeps what the project changed on the Wall and Lights layers, which the copy now holds
	if (sourceId !== project.film.theme || !hasLayerChanges(project.film)) return { commands: addThemeCommands(project, theme), themeId: theme.id };
	const { wall, lights } = project.film;
	const saved: TProjectTheme = {
		...theme,
		overrides: appliedOverrides(project.film),
		...sceneOf({
			wallKind: wall.kind === 'none' ? 'pegboard' : (wall.kind ?? theme.wallKind),
			keyLight: { ...theme.keyLight, ...withoutColor(lights.key) },
			lights: [...(theme.lights ?? []), ...lights.added]
		})
	};
	return { commands: [...addThemeCommands(project, saved), { type: 'updateFilm', film: { wall: wall.labelColor != null ? { labelColor: wall.labelColor } : {}, lights: { added: [] } } }], themeId: saved.id };
}

/** Whether the project changed the Wall or Lights layers on top of its theme, which a kept look stores */
export function hasLayerChanges(film: Pick<TFilm, 'wall' | 'lights'>): boolean {
	return Object.keys(film.wall).some((name) => name !== 'labelColor') || Object.keys(film.lights.key ?? {}).length > 0 || film.lights.added.length > 0;
}

/** A project theme's Wall skin, Key Light and lights, leaving out what it does not set */
function sceneOf(theme: Pick<TProjectTheme, 'wallKind' | 'keyLight' | 'lights'> | null): Pick<TProjectTheme, 'wallKind' | 'keyLight' | 'lights'> {
	return {
		...(theme?.wallKind != null ? { wallKind: theme.wallKind } : {}),
		...(theme?.keyLight != null && Object.keys(theme.keyLight).length > 0 ? { keyLight: { ...theme.keyLight } } : {}),
		...(theme?.lights != null && theme.lights.length > 0 ? { lights: theme.lights.map((light) => ({ ...light })) } : {})
	};
}

function withoutColor(key: TFilm['lights']['key']): TKeyLightPose {
	const { color: _color, ...pose } = key ?? {};
	return pose;
}

/**
 * The current look as a theme, what Export This Look… keeps: a project theme whose parts are this project's choices per element type: the
 * look most of each type wear, built-in skins only. Pieces in that look then just follow the theme; pieces in another
 * keep it. One edit, and the theme is applied.
 */
export function currentLookThemeCommands(project: TProject, name?: string): { commands: TProjectCommand[]; themeId: string } {
	const { commands, themeId } = duplicateThemeCommands(project, project.film.theme);
	const parts = currentThemeParts(project);
	const clear = project.entities.flatMap((entity): TProjectCommand[] => {
		const element = entitySkinElement(entity);
		const skin = entity.components.skin;
		const part = element != null ? parts[element] : undefined;
		if (skin == null || part == null) return [];
		const rest = withoutPart(skin, part);
		if (rest === skin) return [];
		return [rest != null ? { type: 'setComponent', entityId: entity.id, component: { name: 'skin', value: rest } } : { type: 'removeComponent', entityId: entity.id, name: 'skin' }];
	});
	const withCopy = commands.flatMap((command) => {
		if (command.type !== 'updateFilm' || command.film.themes == null) return [command];
		return [{ ...command, film: { ...command.film, themes: command.film.themes.map((theme) => (theme.id === themeId ? { ...theme, ...(name != null ? { name } : {}), parts: { ...theme.parts, ...parts } } : theme)) } }];
	});
	return { commands: [...withCopy, ...clear], themeId };
}

function currentThemeParts(project: TProject): TThemeParts {
	const counts = new Map<TSkinElement, Map<string, { part: TThemePart; count: number }>>();
	for (const entity of project.entities) {
		const element = entitySkinElement(entity);
		if (element == null) continue;
		const part = partOf(entity.components.skin);
		if (part == null) continue;
		const looks = counts.get(element) ?? new Map<string, { part: TThemePart; count: number }>();
		const key = JSON.stringify(part);
		looks.set(key, { part, count: (looks.get(key)?.count ?? 0) + 1 });
		counts.set(element, looks);
	}
	const parts: TThemeParts = {};
	for (const element of SKIN_ELEMENTS) {
		const looks = [...(counts.get(element)?.values() ?? [])];
		const total = project.entities.filter((entity) => entitySkinElement(entity) === element).length;
		const best = looks.sort((a, b) => b.count - a.count)[0];
		// Only what most of the type wear becomes its default; a few skinned pieces stay exceptions
		if (best != null && best.count * 2 >= total) parts[element] = best.part;
	}
	return parts;
}

/** The part a skin component's choices make; null for a library skin or no choices */
function partOf(skin: TSkinComponent | undefined): TThemePart | null {
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

/** The skin component without what the part now says; null when nothing is left, the same object when nothing changed */
function withoutPart(skin: TSkinComponent, part: TThemePart): TSkinComponent | null {
	const own = partOf(skin);
	if (own == null || JSON.stringify(own) !== JSON.stringify(part) || skin.properties != null) return skin;
	return null;
}

/** Renames a project theme; an empty name changes nothing */
export function renameThemeCommands(project: TProject, themeId: string, name: string): TProjectCommand[] {
	const trimmed = name.trim();
	const themes = projectThemes(project.film);
	const theme = themes.find((item) => item.id === themeId);
	if (theme == null || !trimmed.length || trimmed === theme.name) return [];
	return [{ type: 'updateFilm', film: { themes: themes.map((item) => (item.id === themeId ? { ...item, name: trimmed } : item)) } }];
}

/** Deletes a project theme; when the film uses it, its base theme takes its place */
export function deleteThemeCommands(project: TProject, themeId: string): TProjectCommand[] {
	const themes = projectThemes(project.film);
	const theme = themes.find((item) => item.id === themeId);
	if (theme == null) return [];
	const fallback = project.film.theme === themeId ? themeCommands(project, resolveTheme(project.film, themeId).base) : [];
	const remaining = themes.filter((item) => item.id !== themeId);
	return [...fallback, { type: 'updateFilm', film: { themes: remaining } }];
}

/** Sets or, with null, clears overrides of a project theme */
export function themeOverrideCommands(project: TProject, themeId: string, patch: Partial<Record<TThemeOverrideName, string | null>>): TProjectCommand[] {
	const themes = projectThemes(project.film);
	const theme = themes.find((item) => item.id === themeId);
	if (theme == null) return [];
	const merged: Record<string, string | null | undefined> = { ...theme.overrides, ...patch };
	const overrides = Object.fromEntries(Object.entries(merged).flatMap(([name, value]) => (value != null ? [[name, value.toLowerCase()]] : []))) as TThemeOverrides;
	if (JSON.stringify(overrides) === JSON.stringify(theme.overrides)) return [];
	return [{ type: 'updateFilm', film: { themes: themes.map((item) => (item.id === themeId ? { ...item, overrides } : item)) } }];
}

function addThemeCommands(project: TProject, theme: TProjectTheme): TProjectCommand[] {
	const themes = [...projectThemes(project.film), theme];
	const withTheme: TProject = { ...project, film: { ...project.film, themes } };
	return [{ type: 'updateFilm', film: { themes } }, ...themeCommands(withTheme, theme.id)];
}

/** "Neon" → "Neon Copy"; "Neon Copy" → "Neon Copy 2" when taken, like Finder */
export function copyName(name: string, taken: readonly string[]): string {
	const stem = `${name.replace(/ Copy( \d+)?$/, '')} Copy`;
	if (!taken.includes(stem)) return stem;
	for (let index = 2; ; index++) {
		const candidate = `${stem} ${index}`;
		if (!taken.includes(candidate)) return candidate;
	}
}

/** Where a theme comes from, as its tile's quiet line: Starter, its Pack, Made by Agent or Based on Neon */
export function themeOrigin(theme: TResolvedTheme, isPackAdded: (packId: string) => boolean): string {
	if (theme.isBuiltIn) return STARTER_ORIGIN;
	if (theme.projectTheme?.pack != null) return packOriginLine(theme.projectTheme.pack, isPackAdded);
	if (theme.projectTheme?.origin === 'agent') return 'Made by Agent';
	return `Based on ${builtInThemeLabel(theme.base) ?? theme.base}`;
}
