import type { TSceneThemeOverrides } from '@/modules/blender/scene-description';
import { createId, type TDesign, type TEntity, type TKeyLightPose, type TProject, type TPackOrigin, type TProjectCommand, type TProjectTheme, type TSkinComponent, type TThemeOverrides, type TThemePart, type TThemeParts } from '@/modules/project';
import { isPackAdded } from '@/modules/library';
import { canonicalSkin } from '@/modules/project/skin-ids';
import { catalogSkin, entitySkinElement, resolveSkinLook, SKIN_ELEMENTS, type TSkinElement, type TSkinLook } from './skin-catalog';

// Themes a project makes from a built-in one. A project theme keeps its base's skins, reactions and render look and
// changes a few colours on top (`TThemeOverrides`). `design.theme` names a built-in id or a project theme's id; the
// Blender worker and the Draft Preview both read the base plus the overrides (`themes.py` `resolve_theme`).

/** The origin line of what came from a Pack: "Christmas Pack" */
export function packOrigin(name: string): string {
	return /\bpack$/i.test(name) ? name : `${name} Pack`;
}

/** The origin line of a copy from a Pack: "Christmas Pack", with "· Not Added" where this Mac doesn't have the Pack */
export function packOriginLine(origin: TPackOrigin): string {
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
	{ name: 'wallColor', label: 'Wall', help: 'Colour of the wall behind the track' },
	{ name: 'lightColor', label: 'Light', help: 'Colour of the key light: warm, neutral or cool' },
	{ name: 'glowColor', label: 'Glow', help: "Colour of the glowing edges; without one they take their marble's colour" },
	{ name: 'backgroundColor', label: 'Background', help: 'Colour of the surroundings that light and reflect in the track' }
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

export function projectThemes(design: Pick<TDesign, 'themes'>): TProjectTheme[] {
	return design.themes ?? [];
}

/** Resolves a theme id, the applied theme by default. An unknown id draws as the default theme, like in Blender. */
export function resolveTheme(design: Pick<TDesign, 'theme' | 'themes'>, id: string = design.theme): TResolvedTheme {
	const builtIn = builtInThemeLabel(id);
	if (builtIn != null) return { id, name: builtIn, base: id, overrides: {}, parts: resolveParts(id, null), isBuiltIn: true, projectTheme: null };
	const theme = projectThemes(design).find((item) => item.id === id);
	if (theme == null) return { id, name: id, base: DEFAULT_THEME, overrides: {}, parts: resolveParts(DEFAULT_THEME, null), isBuiltIn: false, projectTheme: null };
	const base = isBuiltInTheme(theme.base) ? theme.base : DEFAULT_THEME;
	return { id, name: theme.name, base, overrides: theme.overrides, parts: resolveParts(base, theme.parts), isBuiltIn: false, projectTheme: theme };
}

function resolveParts(base: string, parts: TThemeParts | null | undefined): Record<TSkinElement, TSkinLook> {
	return Object.fromEntries(SKIN_ELEMENTS.map((element) => [element, resolveSkinLook(base, parts, element)])) as Record<TSkinElement, TSkinLook>;
}

/** What an element wears under the applied theme, with its own skin component's overrides */
export function resolveElementLook(design: Pick<TDesign, 'theme' | 'themes'>, element: TSkinElement, component?: TSkinComponent | null): TSkinLook {
	const theme = resolveTheme(design);
	return resolveSkinLook(theme.base, theme.projectTheme?.parts, element, component);
}

/** A project theme's parts for the scene description; absent for a built-in theme or a project theme without any */
export function sceneThemeParts(design: Pick<TDesign, 'theme' | 'themes'>): TThemeParts | undefined {
	const parts = resolveTheme(design).projectTheme?.parts;
	return parts != null && Object.keys(parts).length > 0 ? parts : undefined;
}

/** Whether the theme's platforms take their note's colour: Colour by Note as a theme's default */
export function isThemeColorByNote(design: Pick<TDesign, 'theme' | 'themes'>): boolean {
	return resolveTheme(design).parts.platform.colour === 'note';
}

/** Built-in theme the applied theme starts from: skins, reactions, title colour and render look follow it */
export function baseThemeOf(design: Pick<TDesign, 'theme' | 'themes'>): string {
	return resolveTheme(design).base;
}

/**
 * The colours the film uses: the applied theme's overrides with the Wall and Key Light layers' own colours on top,
 * for the scene description and the Draft Preview
 */
export function appliedOverrides(design: Pick<TDesign, 'theme' | 'themes' | 'wall' | 'lights'>): TThemeOverrides {
	const overrides: TThemeOverrides = { ...resolveTheme(design).overrides };
	if (design.wall?.color != null) overrides.wallColor = design.wall.color;
	if (design.wall?.backgroundColor != null) overrides.backgroundColor = design.wall.backgroundColor;
	if (design.lights?.key?.color != null) overrides.lightColor = design.lights.key.color;
	return overrides;
}

/** Overrides of the film's look for the scene description; absent for a built-in or a project theme without any */
export function sceneThemeOverrides(design: Pick<TDesign, 'theme' | 'themes' | 'wall' | 'lights'>): TSceneThemeOverrides | undefined {
	const overrides = appliedOverrides(design);
	const entries = Object.entries(overrides).filter(([, value]) => typeof value === 'string' && value.length > 0);
	return entries.length > 0 ? (Object.fromEntries(entries.map(([name, value]) => [name, value.toLowerCase()])) as TSceneThemeOverrides) : undefined;
}

/**
 * What each override shows while it is not set: the base theme's own colour, from `THEMES` in themes.py (linear
 * values turned into display hex). Glow has none: edges take their marble's colour.
 */
export function themeDefaultColor(base: string, name: TThemeOverrideName): string | null {
	const theme = BASE_COLORS[base] ?? BASE_COLORS[DEFAULT_THEME];
	if (theme == null || name === 'glowColor') return null;
	const linear = name === 'wallColor' ? theme.wall : name === 'lightColor' ? theme.light : theme.background;
	return linearToHex(linear);
}

/** Whether an override does something on a base: only Neon has glowing edges */
export function themeOverrideApplies(base: string, name: TThemeOverrideName): boolean {
	return name !== 'glowColor' || base === 'neon';
}

// Linear colours of `THEMES` in themes.py: the wall (Pegboard's hardboard tint), the sun and the world
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
const LIGHT_WALL_LUMINANCE = 0.4;

/** The title colour that reads on a wall: navy on a light wall, white on a dark one */
export function titleColorOnWall(wall: string): string {
	const channel = (start: number): number => {
		const value = Number.parseInt(wall.slice(start, start + 2), 16) / 255;
		return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5) > LIGHT_WALL_LUMINANCE ? '#1f3a5f' : '#ffffff';
}

/** The colour titles start with in a base theme */
export function themeTitleColor(base: string): string {
	return titleColorOnWall(themeDefaultColor(base, 'wallColor') ?? '#ffffff');
}

/** What a title reads in when its own colour is unset, and the colour a new one starts with: it stands apart from the wall the project shows */
export function defaultTitleColor(design: Pick<TDesign, 'theme' | 'themes' | 'wall'>): string {
	const theme = resolveTheme(design);
	return titleColorOnWall(design.wall?.color ?? theme.overrides.wallColor ?? themeDefaultColor(theme.base, 'wallColor') ?? '#ffffff');
}

/** Switches the theme; titles still in the old base's title colour take the new one's */
export function themeCommands(project: TProject, themeId: string): TProjectCommand[] {
	if (project.design.theme === themeId) return [];
	const oldColor = defaultTitleColor(project.design);
	const newColor = defaultTitleColor({ ...project.design, theme: themeId });
	const titles =
		oldColor === newColor
			? []
			: project.entities.flatMap((entity: TEntity) => {
					const text = entity.components.wallText;
					if (text?.color == null || text.color.toLowerCase() !== oldColor) return [];
					return [{ type: 'setComponent' as const, entityId: entity.id, component: { name: 'wallText' as const, value: { ...text, color: newColor } } }];
				});
	return [{ type: 'setDesign', design: { theme: themeId } }, ...titles];
}

/**
 * What Save as Theme builds on: a project theme with the source's base and overrides, named like Finder's copies
 * ("Neon Copy", "Neon Copy 2"), and applied, as one edit
 */
export function duplicateThemeCommands(project: TProject, sourceId: string): { commands: TProjectCommand[]; themeId: string } {
	const source = resolveTheme(project.design, sourceId);
	const theme: TProjectTheme = {
		id: createId('theme'),
		name: copyName(source.name, projectThemes(project.design).map((item) => item.name)),
		base: source.base,
		overrides: { ...source.overrides },
		...sceneOf(source.projectTheme),
		...(source.projectTheme?.parts != null ? { parts: source.projectTheme.parts } : {})
	};
	// The applied theme's copy keeps what the project changed on the Wall and Lights layers, which the copy now holds
	if (sourceId !== project.design.theme || !hasLayerChanges(project.design)) return { commands: addThemeCommands(project, theme), themeId: theme.id };
	const { wall, lights } = project.design;
	const saved: TProjectTheme = {
		...theme,
		overrides: appliedOverrides(project.design),
		...sceneOf({
			wallKind: wall?.kind ?? theme.wallKind,
			keyLight: { ...theme.keyLight, ...withoutColor(lights?.key) },
			lights: [...(theme.lights ?? []), ...(lights?.added ?? [])]
		})
	};
	return { commands: [...addThemeCommands(project, saved), { type: 'setDesign', design: { wall: undefined, lights: undefined } }], themeId: saved.id };
}

/** Whether the project changed the Wall or Lights layers on top of its theme, which Save as Theme stores */
export function hasLayerChanges(design: Pick<TDesign, 'wall' | 'lights'>): boolean {
	return Object.keys(design.wall ?? {}).length > 0 || Object.keys(design.lights?.key ?? {}).length > 0 || (design.lights?.added?.length ?? 0) > 0;
}

/** A project theme's Wall skin, Key Light and lights, leaving out what it does not set */
function sceneOf(theme: Pick<TProjectTheme, 'wallKind' | 'keyLight' | 'lights'> | null): Pick<TProjectTheme, 'wallKind' | 'keyLight' | 'lights'> {
	return {
		...(theme?.wallKind != null ? { wallKind: theme.wallKind } : {}),
		...(theme?.keyLight != null && Object.keys(theme.keyLight).length > 0 ? { keyLight: { ...theme.keyLight } } : {}),
		...(theme?.lights != null && theme.lights.length > 0 ? { lights: theme.lights.map((light) => ({ ...light })) } : {})
	};
}

function withoutColor(key: NonNullable<TDesign['lights']>['key']): TKeyLightPose {
	const { color: _color, ...pose } = key ?? {};
	return pose;
}

/**
 * Sets fields of one element's part in a project theme, null clears one; a part with nothing set goes away. A built-in
 * theme is read-only, so it changes nothing there.
 */
export function themePartCommands(project: TProject, themeId: string, element: TSkinElement, patch: { [K in keyof TThemePart]?: TThemePart[K] | null }): TProjectCommand[] {
	const themes = projectThemes(project.design);
	const theme = themes.find((item) => item.id === themeId);
	if (theme == null) return [];
	const merged = { ...theme.parts?.[element], ...patch };
	const part = Object.fromEntries(Object.entries(merged).filter(([, value]) => value != null)) as TThemePart;
	const { [element]: _old, ...others } = theme.parts ?? {};
	const parts: TThemeParts = Object.keys(part).length > 0 ? { ...others, [element]: part } : others;
	const { parts: _parts, ...rest } = theme;
	const next: TProjectTheme = Object.keys(parts).length > 0 ? { ...rest, parts } : rest;
	return [{ type: 'setDesign', design: { themes: themes.map((item) => (item.id === themeId ? next : item)) } }];
}

/**
 * Save as Theme, the one way to make or change a theme: a project theme whose parts are this project's choices per element type: the
 * look most of each type wear, built-in skins only. Pieces in that look then just follow the theme; pieces in another
 * keep it. One edit, and the theme is applied.
 */
export function saveAsThemeCommands(project: TProject): { commands: TProjectCommand[]; themeId: string } {
	const { commands, themeId } = duplicateThemeCommands(project, project.design.theme);
	const parts = currentThemeParts(project);
	const clear = project.entities.flatMap((entity): TProjectCommand[] => {
		const element = entitySkinElement(entity);
		const skin = entity.components.skin;
		const part = element != null ? parts[element] : undefined;
		if (skin == null || part == null) return [];
		const rest = withoutPart(canonicalSkin(skin), part);
		if (rest === skin) return [];
		return [rest != null ? { type: 'setComponent', entityId: entity.id, component: { name: 'skin', value: rest } } : { type: 'removeComponent', entityId: entity.id, name: 'skin' }];
	});
	const withCopy = commands.flatMap((command) => {
		if (command.type !== 'setDesign' || command.design.themes == null) return [command];
		return [{ ...command, design: { ...command.design, themes: command.design.themes.map((theme) => (theme.id === themeId ? { ...theme, parts: { ...theme.parts, ...parts } } : theme)) } }];
	});
	return { commands: [...withCopy, ...clear], themeId };
}

/** Whether pieces or marbles wear choices of their own, which Save as Theme can turn into a theme */
export function hasSkinChoices(project: TProject): boolean {
	return Object.keys(currentThemeParts(project)).length > 0;
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
	const { assetId, colour, onHit, glowColor, variant } = canonicalSkin(skin);
	if (assetId != null && catalogSkin(assetId) == null) return null;
	const part: TThemePart = {
		...(assetId != null ? { skin: assetId } : {}),
		...(colour != null ? { colour } : {}),
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
	const themes = projectThemes(project.design);
	const theme = themes.find((item) => item.id === themeId);
	if (theme == null || !trimmed.length || trimmed === theme.name) return [];
	return [{ type: 'setDesign', design: { themes: themes.map((item) => (item.id === themeId ? { ...item, name: trimmed } : item)) } }];
}

/** Deletes a project theme; when the film uses it, its base theme takes its place */
export function deleteThemeCommands(project: TProject, themeId: string): TProjectCommand[] {
	const themes = projectThemes(project.design);
	const theme = themes.find((item) => item.id === themeId);
	if (theme == null) return [];
	const fallback = project.design.theme === themeId ? themeCommands(project, resolveTheme(project.design, themeId).base) : [];
	const remaining = themes.filter((item) => item.id !== themeId);
	return [...fallback, { type: 'setDesign', design: { themes: remaining } }];
}

/** Sets or, with null, clears overrides of a project theme */
export function themeOverrideCommands(project: TProject, themeId: string, patch: Partial<Record<TThemeOverrideName, string | null>>): TProjectCommand[] {
	const themes = projectThemes(project.design);
	const theme = themes.find((item) => item.id === themeId);
	if (theme == null) return [];
	const merged: Record<string, string | null | undefined> = { ...theme.overrides, ...patch };
	const overrides = Object.fromEntries(Object.entries(merged).flatMap(([name, value]) => (value != null ? [[name, value.toLowerCase()]] : []))) as TThemeOverrides;
	if (JSON.stringify(overrides) === JSON.stringify(theme.overrides)) return [];
	return [{ type: 'setDesign', design: { themes: themes.map((item) => (item.id === themeId ? { ...item, overrides } : item)) } }];
}

/** A theme the agent proposed with an accepted Result: added, or updated when the project has one of that name from the agent, and applied */
export function agentThemeCommands(project: TProject, proposal: { name: string; base: string; overrides: TThemeOverrides }): { commands: TProjectCommand[]; themeId: string } {
	const name = proposal.name.trim() || 'Agent Theme';
	const base = isBuiltInTheme(proposal.base) ? proposal.base : baseThemeOf(project.design);
	const overrides = Object.fromEntries(Object.entries(proposal.overrides).map(([key, value]) => [key, value.toLowerCase()])) as TThemeOverrides;
	const themes = projectThemes(project.design);
	const existing = themes.find((item) => item.origin === 'agent' && item.name === name);
	if (existing != null) {
		const updated = { ...existing, base, overrides: { ...existing.overrides, ...overrides } };
		const withTheme: TProject = { ...project, design: { ...project.design, themes: themes.map((item) => (item.id === existing.id ? updated : item)) } };
		return { commands: [{ type: 'setDesign', design: { themes: withTheme.design.themes } }, ...themeCommands(withTheme, existing.id)], themeId: existing.id };
	}
	const theme: TProjectTheme = { id: createId('theme'), name, base, overrides, origin: 'agent' };
	return { commands: addThemeCommands(project, theme), themeId: theme.id };
}

function addThemeCommands(project: TProject, theme: TProjectTheme): TProjectCommand[] {
	const themes = [...projectThemes(project.design), theme];
	const withTheme: TProject = { ...project, design: { ...project.design, themes } };
	return [{ type: 'setDesign', design: { themes } }, ...themeCommands(withTheme, theme.id)];
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

/** Where a theme comes from, as its card's quiet line: Made with Agent or Based on Neon; a built-in theme has none */
export function themeOrigin(theme: TResolvedTheme): string {
	if (theme.isBuiltIn) return '';
	if (theme.projectTheme?.pack != null) return packOriginLine(theme.projectTheme.pack);
	if (theme.projectTheme?.origin === 'agent') return 'Made with Agent';
	return `Based on ${builtInThemeLabel(theme.base) ?? theme.base}`;
}
