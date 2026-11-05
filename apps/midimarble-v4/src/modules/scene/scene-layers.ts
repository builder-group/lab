import type { TSceneKeyLight, TSceneLight, TSceneWallKind } from './scene-description';
import { createId, type TFilm, type TKeyLightPose, type TLight, type TProject, type TProjectCommand, type TWallKind, type TWallSkin } from '@/modules/project';
import { DEFAULT_THEME, noneWallColor, resolveTheme, themeDefaultColor } from './project-themes';

// The Wall and Lights layers of Film. Each sets its values on top of the applied theme, like a piece's skin: unset
// fields show the base theme's and read "From Brass". The values live in `film.wall` and `film.lights`, a Pack theme's
// among them.

type TSceneFilm = Pick<TFilm, 'theme' | 'wall' | 'lights'>;

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
	brass: { wallKind: 'plaster', strength: 5.2, angle: 30, direction: [0.82, 0.4, -0.22] },
	neon: { wallKind: 'grid', strength: 2.6, angle: 10, direction: [0.55, 0.62, -0.56] }
};

/** The widest sun in degrees, `MAX_SUN_ANGLE` in themes.py: a Softness of 1 */
const MAX_SUN_ANGLE = 60;

/** Name a layer reads while the theme dresses it, as in "From Brass" */
export function themeOriginLabel(film: Pick<TFilm, 'theme'>): string {
	return `From ${resolveTheme(film).name}`;
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
	own: TFilm['wall'];
	/** What the theme shows without the project's values */
	theme: { color: string; backgroundColor: string; kind: TWallKind };
}

export function wallLayer(film: TSceneFilm): TWallLayer {
	const { base } = resolveTheme(film);
	const themeLook = {
		color: themeDefaultColor(base, 'wallColor') ?? '#ffffff',
		backgroundColor: themeDefaultColor(base, 'backgroundColor') ?? '#ffffff',
		kind: baseScene(base).wallKind
	};
	const own = film.wall;
	return {
		color: own.kind === 'none' ? noneWallColor(own.labelColor) : (own.color ?? themeLook.color),
		backgroundColor: own.backgroundColor ?? themeLook.backgroundColor,
		kind: own.kind ?? themeLook.kind,
		own,
		theme: themeLook
	};
}

/** The Wall's Skin when it is not its base theme's own: what the scene description and the Draft Preview need */
export function wallKindOverride(film: TSceneFilm): TWallKind | undefined {
	if (film.wall.kind === 'none') return 'pegboard';
	return film.wall.kind;
}

/** Sets or, with null, clears the Wall layer's own values; clearing brings the theme's back */
export function wallCommands(project: TProject, patch: { [GKey in keyof TFilm['wall']]?: TFilm['wall'][GKey] | null }): TProjectCommand[] {
	const merged: Record<string, unknown> = { ...project.film.wall, ...patch };
	const wall = Object.fromEntries(Object.entries(merged).filter(([, value]) => value != null).map(([key, value]) => [key, typeof value === 'string' && value.startsWith('#') ? value.toLowerCase() : value])) as TFilm['wall'];
	if (JSON.stringify(wall) === JSON.stringify(project.film.wall)) return [];
	return [{ type: 'updateFilm', film: { wall } }];
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
	own: NonNullable<TFilm['lights']['key']>;
}

export function keyLightLayer(film: TSceneFilm): TKeyLightLayer {
	const own = film.lights.key ?? {};
	const themed = themedKeyLight(resolveTheme(film).base);
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

function themedKeyLight(themeBase: string): Required<TKeyLightPose> & { color: string } {
	const base = baseScene(themeBase);
	const placement = lightPlacement(base.direction);
	return {
		color: themeDefaultColor(themeBase, 'lightColor') ?? '#ffffff',
		strength: base.strength,
		side: placement.side,
		height: placement.height,
		softness: base.angle / MAX_SUN_ANGLE,
		exposure: 0,
		bloom: 0
	};
}

/** Sets or, with null, clears the Key Light's own values; clearing brings the theme's back */
export function keyLightCommands(project: TProject, patch: { [GKey in keyof TKeyLightLayer['own']]?: TKeyLightLayer['own'][GKey] | null }): TProjectCommand[] {
	const lights = project.film.lights;
	const merged: Record<string, unknown> = { ...lights.key, ...patch };
	const key = Object.fromEntries(Object.entries(merged).filter(([, value]) => value != null).map(([name, value]) => [name, typeof value === 'string' ? value.toLowerCase() : value])) as TKeyLightLayer['own'];
	if (JSON.stringify(key) === JSON.stringify(lights.key ?? {})) return [];
	return setLights(Object.keys(key).length > 0 ? { ...lights, key } : { added: lights.added });
}

/** Reset to theme: the Key Light can't be deleted, only given back to the theme */
export function resetKeyLightCommands(project: TProject): TProjectCommand[] {
	if (project.film.lights.key == null) return [];
	return setLights({ added: project.film.lights.added });
}

// MARK: - Added lights

/** A new light, on the other side of the wall from the Key Light so it fills the shadows, and named Light 1, Light 2… */
export function addLightCommands(project: TProject): { commands: TProjectCommand[]; lightId: string } {
	const key = keyLightLayer(project.film);
	const taken = project.film.lights.added.map((light) => light.name);
	let index = 1;
	while (taken.includes(`Light ${index}`)) index++;
	const light: TLight = { id: createId('light'), name: `Light ${index}`, color: '#ffffff', strength: 2, side: key.side <= 0 ? 0.5 : -0.5, height: 0.3 };
	return { commands: setLights({ ...project.film.lights, added: [...project.film.lights.added, light] }), lightId: light.id };
}

export function updateLightCommands(project: TProject, lightId: string, patch: Partial<Omit<TLight, 'id'>>): TProjectCommand[] {
	const { lights } = project.film;
	if (!lights.added.some((light) => light.id === lightId)) return [];
	return setLights({ ...lights, added: lights.added.map((light) => (light.id === lightId ? { ...light, ...patch, ...(patch.color != null ? { color: patch.color.toLowerCase() } : {}) } : light)) });
}

export function deleteLightsCommands(project: TProject, lightIds: readonly string[]): TProjectCommand[] {
	const { lights } = project.film;
	const added = lights.added.filter((light) => !lightIds.includes(light.id));
	return added.length !== lights.added.length ? setLights({ ...lights, added }) : [];
}

function setLights(lights: TFilm['lights']): TProjectCommand[] {
	return [{ type: 'updateFilm', film: { lights } }];
}

// MARK: - Scene description

/** The Wall's Skin, the Key Light's pose and the added lights for the scene description; absent when they are the theme's */
export function sceneLayers(film: TSceneFilm): { wallKind?: TSceneWallKind; keyLight?: TSceneKeyLight; lights?: TSceneLight[] } {
	const kind = wallKindOverride(film);
	const { color: _color, ...pose } = film.lights.key ?? {};
	const lights = film.lights.added;
	return {
		...(kind != null ? { wallKind: kind } : {}),
		...(Object.keys(pose).length > 0 ? { keyLight: pose } : {}),
		...(lights.length > 0 ? { lights: lights.map((light) => ({ ...light, color: light.color.toLowerCase() })) } : {})
	};
}
