import type { TSceneDecorItem } from './decor';
import type { TMadeInBlender, TSkin, TThemeParts } from '@/modules/project';

// Contract between the app and the bundled Blender worker. The app sends a scene description with
// `apply_scene`; the worker creates or updates app-owned objects and keyframes from it.
// Units: meters, seconds, radians. Wall-plane x right, y up; Blender uses x right, z up, y into the wall,
// so a wall point (x, y) at distance d from the wall becomes Blender (x, -d, y). A wall angle a (counter-clockwise
// seen from the front) becomes a rotation of -a around Blender +Y. Frame f shows time f / fps; scenes start at frame 0.

export const SCENE_DESCRIPTION_VERSION = 1;
/** Contact starts closer than this many seconds to the previous one are one contact in `contactTimes` */
export const CONTACT_MERGE = 0.1;

export type { TSceneDecorItem };

export interface TSceneDescription {
	version: typeof SCENE_DESCRIPTION_VERSION;
	projectId: string;
	revision: number;
	/** Render frame rate keyframes are written at */
	fps: number;
	duration: number;
	/** Seconds of the film's first frame, on a whole frame; absent is 0. The film ends at `duration` as ever */
	filmStart?: number;
	frame: { width: number; height: number };
	/**
	 * Built-in theme the look starts from: `pegboard`, `brass` or `neon`; unknown themes fall back to `pegboard`. A
	 * project theme sends its base here and its colors in `themeOverrides`.
	 */
	theme: string;
	/** What a project theme dresses each element type with, on top of its base's (`resolve_look` in skin_catalog.py). Optional and additive. */
	themeParts?: TThemeParts;
	/** Colors a project theme changes on top of `theme`; absent keeps the built-in look. Additive like `wallTexts`. */
	themeOverrides?: TSceneThemeOverrides;
	/** The Wall layer's skin when it is not the theme's own. Optional and additive. */
	wallKind?: TSceneWallKind;
	/** What the Key Light layer changes on the theme's sun besides its color (`themeOverrides.lightColor`). Optional and additive. */
	keyLight?: TSceneKeyLight;
	/** Lights added in Film, created as app-owned suns. Optional and additive; absent has none. */
	lights?: TSceneLight[];
	marbles: TSceneMarble[];
	pieces: TScenePiece[];
	/**
	 * Follow-camera rig settings from the project's `film.camera`. Without them the worker frames the run with
	 * a static front camera.
	 */
	camera?: TSceneCamera;
	/** Overrides of the theme's hit reactions */
	reactions?: TSceneReactions;
	/** Theme options from Film; absent keeps the theme as it is. Additive like `wallTexts`. */
	/** Wall text placed in Film. Optional and additive; workers that do not know it ignore it. */
	wallTexts?: TSceneWallText[];
	/** The film's Decor layers, without physics. Additive like `wallTexts`. */
	decor?: TSceneDecorItem[];
	/** In, Out and Hidden the project sets on objects added directly in Blender, by name. Additive like `wallTexts`. */
	madeInBlender?: TMadeInBlender[];
}

export interface TSceneCamera {
	/** `manual` leaves the camera to Blender */
	mode: 'rig' | 'manual';
	/** Camera distance from the followed point in meters */
	distance: number;
	/** Downward angle from the wall normal in radians; larger looks more steeply along the wall */
	pitch: number;
	/** Seconds the target leads the marble */
	lead: number;
	/** 0 to 1; larger follows more calmly */
	smoothing: number;
	/** Turn: the camera's side angle around the target in radians, 0 to 2π. Absent is 95°. */
	side?: number;
	/** 0 to 1; how much the view turns and rolls with the run and over time. Absent is 1; 0 holds the Turn and keeps the wall's up straight up. */
	sway?: number;
	shots: TSceneShot[];
	/**
	 * Marble the camera keeps when several marbles no longer fit a readable frame; the others may leave it. Absent
	 * picks the first marble, which carries the melody marble. Optional and additive.
	 */
	focusMarbleId?: string | null;
	/**
	 * Shared descent pace y*(t) of the marbles from the simulation, in wall meters. The camera frames a group of
	 * marbles at this height instead of their bouncing center. Optional and additive.
	 */
	descent?: TSceneDescentPoint[] | null;
	/**
	 * Time of the run's last hit in seconds. From then on the camera holds on that hit instead of following the
	 * marble down the empty wall. Absent or null follows to the end. Optional and additive.
	 */
	holdAfter?: number | null;
	/**
	 * Mouths of the Bowls that catch the marbles playing last, in wall meters. With `holdAfter` the held ending
	 * frames them and the last hit together. Absent or empty holds on the last pieces. Optional and additive.
	 */
	holdBowl?: TVec2Like[] | null;
}

export interface TVec2Like {
	x: number;
	y: number;
}

export interface TSceneDescentPoint {
	time: number;
	y: number;
}

export interface TSceneShot {
	time: number;
	distance: number;
	/**
	 * Seconds the shot holds before the camera eases back to the rig's distance without extra roll; absent or null
	 * holds until the next shot. Optional and additive.
	 */
	length?: number | null;
}

export interface TSceneReactions {
	/** Bar tilt at a hit in degrees */
	dip?: number;
	/** Bar press along its normal at a hit in meters */
	press?: number;
	/** Emission strength of the hit flash; 0 turns it off */
	flash?: number;
}

export interface TSceneMarble {
	/** Stable piece ID; becomes the holder object's `mm_id` */
	id: string;
	name: string;
	radius: number;
	/** How far out from the wall the marble's path runs, a look only (`pathDepth`). Absent: right at the wall. Optional and additive. */
	pathDepth?: number;
	color: string;
	/** Package-relative path of a little-endian Float32 file with records [time, x, y, angle] */
	motionPath: string;
	sampleCount: number;
	/** The marble's own skin and property overrides; absent wears the theme's. Physics never reads it. Optional and additive. */
	skin?: TSkin | null;
	/** Package-relative `.blend` of a library skin the marble wears; absent for a built-in skin. Optional and additive. */
	assetPath?: string | null;
	/**
	 * Seconds after which the follow camera stops framing this marble: a moment after its last note. Absent for
	 * the marble that plays last and for marbles without notes, which the camera frames to the end.
	 */
	activeUntil?: number;
	/**
	 * Times of the marble's notes in seconds, sorted. Where several marbles do not fit one readable frame, the follow
	 * camera keeps the marble with more notes ahead. Optional and additive.
	 */
	hitTimes?: number[];
}

export interface TScenePiece {
	id: string;
	name: string;
	type: string;
	params: Record<string, number>;
	position: { x: number; y: number };
	angle: number;
	/** Distance of the piece from the wall surface */
	wallOffset: number;
	/** Hit times on this piece. The worker animates the custom property `mm_hit` of music pieces from them. */
	hitTimes: number[];
	/**
	 * Times a marble starts touching this piece, sorted, starts closer than `CONTACT_MERGE` seconds to the previous
	 * one merged. Scenery never has hits, so the worker animates `mm_hit` of scenery pieces from these. Optional and
	 * additive.
	 */
	contactTimes?: number[];
	/**
	 * True for pieces that sound their hits (platforms); their reactions follow `hitTimes`. False for scenery
	 * (rails, tunnels, windmills), whose reactions follow `contactTimes`. Absent treats platforms as
	 * music pieces and every other type as scenery. Optional and additive.
	 */
	musical?: boolean;
	/** Optional package-relative Float32 file with records [time, angle] for moving pieces such as windmills */
	motionPath: string | null;
	sampleCount: number;
	/**
	 * Support line of rails and tunnels in wall coordinates: the resolved, smoothed polyline the simulation
	 * collides with (derived from the piece's `path` component). The marble center rides `radius + wire radius`
	 * above it.
	 */
	path?: { x: number; y: number }[] | null;
	/**
	 * A Rail's several paths in wall coordinates, from the resolved piece: for a Switchback one bent wire per leg from the top (its
	 * wall, a rounded bend of the `bend` param's radius, then the leg), then the short exit stop. Each wire is a
	 * capsule of the piece's `radius` param around its polyline. Optional and additive.
	 */
	paths?: { x: number; y: number }[][] | null;
	/** The piece's own skin and property overrides; null wears the theme's */
	skin: TSkin | null;
	/**
	 * Package-relative `.blend` of a library skin, such as `assets/piano-key/asset.blend`. Set when `skin.assetId`
	 * names a project library item; built-in skins such as `platform:copper` have none. Optional and additive.
	 */
	assetPath?: string | null;
	color: string;
	/** MIDI pitch of the note a platform plays, for themes that color pieces by note; absent for other pieces */
	notePitch?: number;
}

/** Native Blender text object on the wall, from a title */
export interface TSceneWallText {
	id: string;
	text: string;
	font: string;
	/** Letter height in meters; for a screen title (`caption`, `songName`, `endCard`) a fraction of the frame height */
	size: number;
	color: string;
	position: { x: number; y: number };
	angle: number;
	/**
	 * Seconds when the title fades in and out; absent means the start and the end of the film. The worker hides it
	 * outside the range with a quick fade. Optional and additive.
	 */
	in?: number;
	out?: number;
	/**
	 * `wall` (absent) sits on the wall at `position`; `caption` (top of the frame), `songName` (upper third) and
	 * `endCard` (center) hang from the film camera, and the film encoder draws them onto the film. Optional and additive.
	 */
	style?: 'wall' | 'caption' | 'songName' | 'endCard';
	/** A screen title's soft dark plate and shadow behind its text; absent is plain text */
	plate?: boolean;
}

/**
 * A project theme's colors as display sRGB `#rrggbb`, resolved by `resolve_theme` in themes.py: the wall, the key
 * light, the glowing edges of a theme that has them (Neon) and the world surroundings
 */
export interface TSceneThemeOverrides {
	wallColor?: string;
	lightColor?: string;
	glowColor?: string;
	backgroundColor?: string;
}

export type TSceneWallKind = 'plain' | 'plaster' | 'pegboard' | 'grid';

/**
 * Direction of a light: `side` from the far left (-1) to the far right (1) and `height` from below (-1) to above (1),
 * as shares of a quarter turn from straight in front of the wall. `sun_direction` in themes.py and `lightDirection`
 * in scene-layers.ts turn them into a travel direction. `strength` is the sun's strength in Blender.
 */
export interface TSceneKeyLight {
	strength?: number;
	side?: number;
	height?: number;
	/** Sun angle as a share of `MAX_SUN_ANGLE` in themes.py */
	softness?: number;
	/** Stops on top of the base theme's exposure */
	exposure?: number;
	/** Glare over the render, 0 none; Flat Light skips it */
	bloom?: number;
}

export interface TSceneLight {
	/** Stable ID; becomes the light object's `mm_light_id` */
	id: string;
	name: string;
	color: string;
	strength: number;
	side: number;
	height: number;
}

