import type { TSceneKeyLight, TSceneLight, TSceneWallKind } from '@/modules/blender/scene-description';
import { createId, type TDesign, type TKeyLightPose, type TLight, type TProject, type TProjectCommand, type TWallKind, type TWallSkin } from '@/modules/project';
import { DEFAULT_THEME, noneWallColor, resolveTheme, themeDefaultColor, type TResolvedTheme } from './project-themes';

// The Wall and Lights layers of Film. Each sets its values on top of the applied theme, like a piece's skin: unset
// fields show the theme's and read "From Brass". A project's own values live in `design.wall` and `design.lights`;
// Export This Look… moves them into the theme it keeps (`duplicateThemeCommands`).

type TSceneDesign = Pick<TDesign, 'theme' | 'themes' | 'wall' | 'lights'>;

/** The Wall layer's Skin choices: the wall kinds of the themes */
export const WALL_KINDS: readonly { kind: TWallKind; label: string }[] = [
	{ kind: 'plain', label: 'Plain' },
	{ kind: 'plaster', label: 'Plaster' },
	{ kind: 'pegboard', label: 'Pegboard' },
	{ kind: 'grid', label: 'Grid' }
];

export const MAX_LIGHT_STRENGTH = 20;

/**
 * The sun of each built-in theme, from `THEMES` in themes.py: its strength and the direction its light travels in
 * wall terms (right, into the wall, up), and the wall kind of the theme
 */
const BASE_SCENES: Record<string, { wallKind: TWallKind; strength: number; angle: number; direction: readonly [number, number, number] }> = {
	pegboard: { wallKind: 'pegboard', strength: 3.2, angle: 12, direction: [0.62, 0.62, -0.48] },
	brass: { wallKind: 'plaster', strength: 5.2, angle: 16, direction: [0.82, 0.4, -0.36] },
	neon: { wallKind: 'grid', strength: 2.6, angle: 10, direction: [0.55, 0.62, -0.56] }
};

/** The widest sun in degrees, `MAX_SUN_ANGLE` in themes.py: a Softness of 1 */
const MAX_SUN_ANGLE = 60;

/** Name a layer reads while the theme dresses it, as in "From Brass" */
export function themeOriginLabel(design: Pick<TDesign, 'theme' | 'themes'>): string {
	return `From ${resolveTheme(design).name}`;
}

/** Side and Height of a sun whose light travels along `direction`; `sun_direction` in themes.py is the inverse */
export function lightPlacement(direction: readonly [number, number, number]): { side: number; height: number } {
	const [right, into, up] = direction;
	const length = Math.hypot(right, into, up) || 1;
	const toShare = (radians: number): number => Math.round((radians / (Math.PI / 2)) * 1000) / 1000 + 0;
	return { side: toShare(Math.atan2(-right, into)), height: toShare(Math.asin(-up / length)) };
}

function baseScene(base: string): (typeof BASE_SCENES)[string] {
	return (BASE_SCENES[base] ?? BASE_SCENES[DEFAULT_THEME]) as (typeof BASE_SCENES)[string];
}

// MARK: - Wall

export interface TWallLayer {
	/** The colors the film uses */
	color: string;
	backgroundColor: string;
	kind: TWallSkin;
	/** What the project set itself; absent fields read "From Brass" */
	own: TDesign['wall'];
	/** What the theme shows without the project's values */
	theme: { color: string; backgroundColor: string; kind: TWallKind };
}

export function wallLayer(design: TSceneDesign): TWallLayer {
	const theme = resolveTheme(design);
	const themeLook = {
		color: theme.overrides.wallColor ?? themeDefaultColor(theme.base, 'wallColor') ?? '#ffffff',
		backgroundColor: theme.overrides.backgroundColor ?? themeDefaultColor(theme.base, 'backgroundColor') ?? '#ffffff',
		kind: theme.projectTheme?.wallKind ?? baseScene(theme.base).wallKind
	};
	const own = design.wall;
	return {
		color: own.kind === 'none' ? noneWallColor(own.labelColor) : (own.color ?? themeLook.color),
		backgroundColor: own.backgroundColor ?? themeLook.backgroundColor,
		kind: own.kind ?? themeLook.kind,
		own,
		theme: themeLook
	};
}

/** The Wall's Skin when it is not its base theme's own: what the scene description and the Draft Preview need */
export function wallKindOverride(design: TSceneDesign): TWallKind | undefined {
	if (design.wall.kind === 'none') return 'pegboard';
	return design.wall.kind ?? resolveTheme(design).projectTheme?.wallKind;
}

/** Sets or, with null, clears the Wall layer's own values; clearing brings the theme's back */
export function wallCommands(project: TProject, patch: { [GKey in keyof TDesign['wall']]?: TDesign['wall'][GKey] | null }): TProjectCommand[] {
	const merged: Record<string, unknown> = { ...project.design.wall, ...patch };
	const wall = Object.fromEntries(Object.entries(merged).filter(([, value]) => value != null).map(([key, value]) => [key, typeof value === 'string' && value.startsWith('#') ? value.toLowerCase() : value])) as TDesign['wall'];
	if (JSON.stringify(wall) === JSON.stringify(project.design.wall)) return [];
	return [{ type: 'setDesign', design: { wall } }];
}

// MARK: - Key Light

export interface TKeyLightLayer {
	color: string;
	strength: number;
	side: number;
	height: number;
	softness: number;
	exposure: number;
	bloom: number;
	/** What the project set itself */
	own: NonNullable<TDesign['lights']['key']>;
}

export function keyLightLayer(design: TSceneDesign): TKeyLightLayer {
	const theme = resolveTheme(design);
	const own = design.lights.key ?? {};
	const themed = themedKeyLight(theme);
	return {
		color: own.color ?? themed.color,
		strength: own.strength ?? themed.strength,
		side: own.side ?? themed.side,
		height: own.height ?? themed.height,
		softness: own.softness ?? themed.softness,
		exposure: own.exposure ?? themed.exposure,
		bloom: own.bloom ?? themed.bloom,
		own
	};
}

function themedKeyLight(theme: TResolvedTheme): Required<TKeyLightPose> & { color: string } {
	const base = baseScene(theme.base);
	const pose = theme.projectTheme?.keyLight ?? {};
	const placement = lightPlacement(base.direction);
	return {
		color: theme.overrides.lightColor ?? themeDefaultColor(theme.base, 'lightColor') ?? '#ffffff',
		strength: pose.strength ?? base.strength,
		side: pose.side ?? placement.side,
		height: pose.height ?? placement.height,
		softness: pose.softness ?? base.angle / MAX_SUN_ANGLE,
		exposure: pose.exposure ?? 0,
		bloom: pose.bloom ?? 0
	};
}

/** Sets or, with null, clears the Key Light's own values; clearing brings the theme's back */
export function keyLightCommands(project: TProject, patch: { [GKey in keyof TKeyLightLayer['own']]?: TKeyLightLayer['own'][GKey] | null }): TProjectCommand[] {
	const lights = project.design.lights;
	const merged: Record<string, unknown> = { ...lights.key, ...patch };
	const key = Object.fromEntries(Object.entries(merged).filter(([, value]) => value != null).map(([name, value]) => [name, typeof value === 'string' ? value.toLowerCase() : value])) as TKeyLightLayer['own'];
	if (JSON.stringify(key) === JSON.stringify(lights.key ?? {})) return [];
	return setLights(Object.keys(key).length > 0 ? { ...lights, key } : { added: lights.added });
}

/** Reset to theme: the Key Light can't be deleted, only given back to the theme */
export function resetKeyLightCommands(project: TProject): TProjectCommand[] {
	if (project.design.lights.key == null) return [];
	return setLights({ added: project.design.lights.added });
}

// MARK: - Added lights

/** Every added light of the film, the applied project theme's first; order as in Layers */
export function addedLights(design: TSceneDesign): TLight[] {
	const themed = design.themes.find((theme) => theme.id === design.theme)?.lights ?? [];
	return [...themed, ...design.lights.added];
}

/** A new light, on the other side of the wall from the Key Light so it fills the shadows, and named Light 1, Light 2… */
export function addLightCommands(project: TProject): { commands: TProjectCommand[]; lightId: string } {
	const key = keyLightLayer(project.design);
	const taken = addedLights(project.design).map((light) => light.name);
	let index = 1;
	while (taken.includes(`Light ${index}`)) index++;
	const light: TLight = { id: createId('light'), name: `Light ${index}`, color: '#ffffff', strength: 2, side: key.side <= 0 ? 0.5 : -0.5, height: 0.3 };
	return { commands: setLights({ ...project.design.lights, added: [...project.design.lights.added, light] }), lightId: light.id };
}

export function updateLightCommands(project: TProject, lightId: string, patch: Partial<Omit<TLight, 'id'>>): TProjectCommand[] {
	const change = (light: TLight): TLight => (light.id === lightId ? { ...light, ...patch, ...(patch.color != null ? { color: patch.color.toLowerCase() } : {}) } : light);
	return editLightLists(project, lightId, (lights) => lights.map(change));
}

export function deleteLightsCommands(project: TProject, lightIds: readonly string[]): TProjectCommand[] {
	const keep = (light: TLight): boolean => !lightIds.includes(light.id);
	const { design } = project;
	const patch: Partial<TDesign> = {};
	if (design.lights.added.some((light) => !keep(light))) patch.lights = { ...design.lights, added: design.lights.added.filter(keep) };
	if (design.themes.find((theme) => theme.id === design.theme)?.lights?.some((light) => !keep(light)) === true) {
		patch.themes = design.themes.map((theme) => (theme.id === design.theme ? { ...theme, lights: theme.lights?.filter(keep) } : theme));
	}
	return Object.keys(patch).length > 0 ? [{ type: 'setDesign', design: patch }] : [];
}

/** Applies a light edit to the list holding the light: the project's, or the applied project theme's */
function editLightLists(project: TProject, lightId: string, edit: (lights: TLight[]) => TLight[]): TProjectCommand[] {
	const { design } = project;
	const added = design.lights.added;
	if (added.some((light) => light.id === lightId)) return setLights({ ...design.lights, added: edit(added) });
	const applied = design.themes.find((theme) => theme.id === design.theme);
	if (applied?.lights?.some((light) => light.id === lightId) !== true) return [];
	return [{ type: 'setDesign', design: { themes: design.themes.map((theme) => (theme.id === applied.id ? { ...theme, lights: edit(theme.lights ?? []) } : theme)) } }];
}

function setLights(lights: TDesign['lights']): TProjectCommand[] {
	return [{ type: 'setDesign', design: { lights } }];
}

// MARK: - Scene description

/** The Wall's Skin, the Key Light's pose and the added lights for the scene description; absent when they are the theme's */
export function sceneLayers(design: TSceneDesign): { wallKind?: TSceneWallKind; keyLight?: TSceneKeyLight; lights?: TSceneLight[] } {
	const theme = resolveTheme(design);
	const kind = wallKindOverride(design);
	const { color: _color, ...ownPose } = design.lights.key ?? {};
	const pose: TKeyLightPose = { ...theme.projectTheme?.keyLight, ...ownPose };
	const lights = addedLights(design);
	return {
		...(kind != null ? { wallKind: kind } : {}),
		...(Object.keys(pose).length > 0 ? { keyLight: pose } : {}),
		...(lights.length > 0 ? { lights: lights.map((light) => ({ ...light, color: light.color.toLowerCase() })) } : {})
	};
}
