import type { TSceneThemeOverrides } from '@/modules/blender/scene-description';
import { createId, type TDesign, type TEntity, type TProject, type TProjectCommand, type TProjectTheme, type TThemeOverrides } from '@/modules/project';

// Themes a project makes from a built-in one. A project theme keeps its base's skins, reactions and render look and
// changes a few colours on top (`TThemeOverrides`). `design.theme` names a built-in id or a project theme's id; the
// Blender worker and the Draft Preview both read the base plus the overrides (`themes.py` `resolve_theme`).

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
	{ name: 'wallColor', label: 'Wall', help: 'Colour of the wall behind the run' },
	{ name: 'lightColor', label: 'Light', help: 'Colour of the key light: warm, neutral or cool' },
	{ name: 'glowColor', label: 'Glow', help: "Colour of the glowing edges; without one they take their marble's colour" },
	{ name: 'backgroundColor', label: 'Background', help: 'Colour of the surroundings that light and reflect in the pieces' }
];

/** A theme as applied: a built-in one, a project theme with its base and overrides, or an unknown id */
export interface TResolvedTheme {
	id: string;
	name: string;
	/** Built-in theme the look starts from */
	base: string;
	overrides: TThemeOverrides;
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
	if (builtIn != null) return { id, name: builtIn, base: id, overrides: {}, isBuiltIn: true, projectTheme: null };
	const theme = projectThemes(design).find((item) => item.id === id);
	if (theme == null) return { id, name: id, base: DEFAULT_THEME, overrides: {}, isBuiltIn: false, projectTheme: null };
	const base = isBuiltInTheme(theme.base) ? theme.base : DEFAULT_THEME;
	return { id, name: theme.name, base, overrides: theme.overrides, isBuiltIn: false, projectTheme: theme };
}

/** Built-in theme the applied theme starts from: skins, reactions, title colour and render look follow it */
export function baseThemeOf(design: Pick<TDesign, 'theme' | 'themes'>): string {
	return resolveTheme(design).base;
}

/** Overrides of the applied theme for the scene description; absent for a built-in or a project theme without any */
export function sceneThemeOverrides(design: Pick<TDesign, 'theme' | 'themes'>): TSceneThemeOverrides | undefined {
	const overrides = resolveTheme(design).overrides;
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

/** The colour titles start with in a base theme: white on Brass's lavender plaster and Neon's navy, navy on Pegboard's birch */
export function themeTitleColor(base: string): string {
	return base === 'brass' || base === 'neon' ? '#ffffff' : '#1f3a5f';
}

/** Switches the theme; titles still in the old base's title colour take the new one's */
export function themeCommands(project: TProject, themeId: string): TProjectCommand[] {
	if (project.design.theme === themeId) return [];
	const oldColor = themeTitleColor(baseThemeOf(project.design));
	const newColor = themeTitleColor(resolveTheme(project.design, themeId).base);
	const titles =
		oldColor === newColor
			? []
			: project.entities.flatMap((entity: TEntity) => {
					const text = entity.components.wallText;
					if (text == null || text.color.toLowerCase() !== oldColor) return [];
					return [{ type: 'setComponent' as const, entityId: entity.id, component: { name: 'wallText' as const, value: { ...text, color: newColor } } }];
				});
	return [{ type: 'setDesign', design: { theme: themeId } }, ...titles];
}

/**
 * Duplicate Theme: a project theme with the source's base and overrides, named like Finder's copies ("Neon Copy",
 * "Neon Copy 2"), and applied, as one edit
 */
export function duplicateThemeCommands(project: TProject, sourceId: string): { commands: TProjectCommand[]; themeId: string } {
	const source = resolveTheme(project.design, sourceId);
	const theme: TProjectTheme = {
		id: createId('theme'),
		name: copyName(source.name, projectThemes(project.design).map((item) => item.name)),
		base: source.base,
		overrides: { ...source.overrides }
	};
	return { commands: addThemeCommands(project, theme), themeId: theme.id };
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

/** Where a theme comes from, as its card's quiet line: Theme, Made with Agent or Based on Neon */
export function themeOrigin(theme: TResolvedTheme): string {
	if (theme.isBuiltIn) return 'Theme';
	if (theme.projectTheme?.origin === 'agent') return 'Made with Agent';
	return `Based on ${builtInThemeLabel(theme.base) ?? theme.base}`;
}
