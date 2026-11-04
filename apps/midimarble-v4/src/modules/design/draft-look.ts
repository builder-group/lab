import type { TWallLook } from '@/modules/compose/ComposeRenderer';
import type { TRenderPreset } from '@/modules/blender';
import type { TScenePiece } from '@/modules/blender/scene-description';
import type { TThemeOverrides, TThemeParts, TWallKind } from '@/modules/project';
import { filmSize } from './export-estimate';
import { resolveSkinLook, skinElement, type TSkinLook } from './skin-catalog';

// Flat colours that approximate the Blender themes for the Film Draft Preview. The values follow
// `blender/mm_worker/themes.py` and `skins.py`, converted from Blender's linear colours to display sRGB and
// shaded toward how the rendered stills look, so a theme reads the same at a glance.

export interface TDraftColors {
	bar: string;
	nub: string;
}

/**
 * Colour by Note colours, one per pitch class from C, after the boomwhacker wheel. The same display values as
 * `NOTE_COLORS` in `blender/mm_worker/themes.py`.
 */
export const NOTE_COLORS: readonly string[] = [
	[0.86, 0.12, 0.12],
	[0.93, 0.33, 0.1],
	[0.98, 0.55, 0.1],
	[0.98, 0.75, 0.12],
	[0.95, 0.87, 0.16],
	[0.6, 0.84, 0.18],
	[0.2, 0.7, 0.32],
	[0.12, 0.62, 0.62],
	[0.18, 0.42, 0.86],
	[0.44, 0.26, 0.82],
	[0.64, 0.22, 0.74],
	[0.88, 0.26, 0.58]
].map(([r = 0, g = 0, b = 0]) => toHex(r, g, b));

export function noteColor(pitch: number): string {
	const index = ((Math.round(pitch) % 12) + 12) % 12;
	return NOTE_COLORS[index] ?? '#888888';
}

const DRAFT_WALL_COLORS: Record<string, string> = { brass: '#a098ac', neon: '#141a2a' };

/**
 * Birch hardboard with dark peg holes for Pegboard, matte lavender plaster for Brass, deep navy for Neon. A project
 * theme's Wall colour replaces the base's, and Pegboard keeps its holes.
 */
export function draftWall(theme: string, overrides: Pick<TThemeOverrides, 'wallColor'> = {}, kind?: TWallKind): TWallLook {
	const color = overrides.wallColor ?? DRAFT_WALL_COLORS[theme] ?? '#b3a38f';
	// The Wall layer's Skin puts peg holes on any theme or takes them away; Grid draws flat here, its lines are Blender's
	const hasHoles = kind != null ? kind === 'pegboard' : theme !== 'brass' && theme !== 'neon';
	return hasHoles ? { color, holes: 'rgba(72, 56, 40, 0.75)', holeRadius: 0.1 } : { color, holes: null };
}

/** Wood of pegs, hubs and rail posts in Pegboard */
const WOOD = '#b98a5a';
/** Chrome brackets, rails and hubs in Brass */
const CHROME = '#cfd2d8';
/** Brass bar finishes, after `FINISHES` in themes.py */
const FINISHES: Record<string, string> = {
	gold: '#b8863f',
	copper: '#b8704a',
	silver: '#9c9ea6',
	dark: '#2e3034'
};
/** Dark coated device housing of the Brass Key and Knob skins */
const HOUSING = '#26282d';
/** Gift's red paper and gold ribbon, `GIFT_PAPERS` in skins.py */
const GIFT_PAPER = '#a01522';
const RIBBON = '#d9a520';
/** Colour: Skin of a Candy Rail, `CANDY_COLOR` in skins.py */
const CANDY = '#c8202c';

/** What a skin colours itself with, by its Colour: null for its own colour */
function accentOf(look: TSkinLook, piece: Pick<TScenePiece, 'color' | 'notePitch'>): string | null {
	if (look.colour === 'skin') return null;
	return look.colour === 'note' && piece.notePitch != null ? noteColor(piece.notePitch) : piece.color;
}

/**
 * Body and accent colour of a piece from its scene description entry: its skin, wherever the theme stands, and that skin's
 * Colour. `colorByNote` is the theme's default for platforms; `parts` a project theme's parts.
 */
export function draftPieceColors(
	theme: string,
	piece: Pick<TScenePiece, 'type' | 'color' | 'skin' | 'notePitch'>,
	colorByNote: boolean,
	overrides: Pick<TThemeOverrides, 'glowColor'> = {},
	parts?: TThemeParts
): TDraftColors {
	const withNote = colorByNote ? { ...parts, platform: { ...parts?.platform, colour: 'note' as const } } : parts;
	const look = resolveSkinLook(theme, withNote, skinElement(piece.type), piece.skin);
	const style = look.skin.split(':')[1] ?? '';
	const accent = accentOf(look, piece);
	// Glowing skins: what reads is the glow, in their marble's or note's hue
	if (style === 'neon' || style === 'glow') return neonColors(piece.type, accent ?? GLOW_SKIN, look.glowColor ?? overrides.glowColor ?? null);
	if (style === 'pegboard' || style === 'wood') {
		// A Wood Finish is chrome wires on wooden pegs and plays no note
		if (piece.type === 'finish') return { bar: accent ?? CHROME, nub: WOOD };
		// Pieces take their marble's colour; a lighter tint keeps the marble readable as it rolls over them
		const body = accent == null ? WOOD : accent === piece.color ? tint(piece.color, PEGBOARD_TINT) : accent;
		return piece.type === 'tunnel' ? { bar: body, nub: shade(body, 0.75) } : { bar: body, nub: WOOD };
	}
	switch (piece.type) {
		case 'platform': {
			if (style === 'gift') return { bar: accent ?? GIFT_PAPER, nub: RIBBON };
			// Devices draw their key, lens or grille as marks on top (`draftSkinMarks`); the bar is their housing
			const [device] = style.split('-');
			if (device === 'key' || device === 'knob') return { bar: HOUSING, nub: CHROME };
			if (device === 'device') return { bar: FINISHES['silver'] ?? CHROME, nub: CHROME };
			return { bar: accent ?? FINISHES[style] ?? FINISHES['gold'] ?? CHROME, nub: CHROME };
		}
		case 'windmill':
			return { bar: accent ?? FINISHES['gold'] ?? CHROME, nub: CHROME };
		case 'tunnel':
			return { bar: accent ?? '#e9ecf2', nub: CHROME };
		default:
			return { bar: accent ?? (style === 'candy' ? CANDY : CHROME), nub: '#9da1a8' };
	}
}

/**
 * A skin's shape cue on a platform's front face in the Draft Preview: a rectangle from `x0` to `x1` along the bar
 * (-0.5 at its left end, 0.5 at its right) and `y0` to `y1` across it (-0.5 at the bottom, 0.5 at the top)
 */
export interface TDraftMark {
	x0: number;
	x1: number;
	y0: number;
	y1: number;
	color: string;
}

/**
 * Marks that tell a platform skin apart in the Draft Preview, after `platform_spec` and `device_spec` in skins.py: chrome
 * end caps on a plain bar, end blocks in the trim finish and a dark grille on a Device, the white key of a Key and the
 * red lens at the outer end of a Knob. Empty for Pegboard and Neon platforms and other pieces.
 */
export function draftSkinMarks(theme: string, piece: Pick<TScenePiece, 'type' | 'skin'> & { angle?: number }, parts?: TThemeParts): TDraftMark[] {
	if (piece.type !== 'platform') return [];
	const look = resolveSkinLook(theme, parts, 'platform', piece.skin);
	const style = look.skin.split(':')[1] ?? '';
	if (style === 'pegboard' || style === 'neon') return [];
	if (style === 'gift') return [{ x0: -0.06, x1: 0.06, y0: -0.5, y1: 0.5, color: RIBBON }, { x0: -0.5, x1: 0.5, y0: -0.07, y1: 0.07, color: RIBBON }];
	const [device, trim = 'gold'] = style.split('-');
	if (device === 'key') return [{ x0: -0.27, x1: 0.39, y0: 0.08, y1: 0.5, color: KEY_WHITE }];
	if (device === 'knob') {
		// The lens sits at the end the bar slopes down to, like `device_spec`
		const side = (piece.angle ?? 0) >= 0 ? -1 : 1;
		const [inner, outer] = [side * 0.12, side * 0.46];
		return [{ x0: Math.min(inner, outer), x1: Math.max(inner, outer), y0: -0.28, y1: 0.28, color: KNOB_RED }];
	}
	if (device === 'device') {
		const ends = FINISHES[look.variant ?? trim] ?? FINISHES['gold'] ?? CHROME;
		const slots = Array.from({ length: 7 }, (_, index) => {
			const x = -0.25 + (0.5 * index) / 6;
			return { x0: x - 0.022, x1: x + 0.022, y0: -0.25, y1: 0.18, color: SLOT };
		});
		return [{ x0: -0.5, x1: -0.34, y0: -0.5, y1: 0.5, color: ends }, { x0: 0.34, x1: 0.5, y0: -0.5, y1: 0.5, color: ends }, ...slots];
	}
	return [
		{ x0: -0.5, x1: -0.44, y0: -0.5, y1: 0.5, color: CHROME },
		{ x0: 0.44, x1: 0.5, y0: -0.5, y1: 0.5, color: CHROME }
	];
}

/** The white key of the Key skin, `key_material` in themes.py */
const KEY_WHITE = '#dcdee0';
/** The Knob skin's glowing red lens, `KNOB_GLOW` in skins.py */
const KNOB_RED = '#e0261c';
/** The Device skin's dark grille slots, `slot_material` in themes.py */
const SLOT = '#141418';

/** Dark gloss mounts and posts of Neon, `neon_mount_material` in themes.py */
const NEON_MOUNT = '#1c2030';

/** A marble in the Draft Preview: its body colour and, for a pearl marble, the coloured rim around it */
export interface TDraftMarble {
	body: string;
	rim: string | null;
	/** Pearl: near white with its lane's hue on the rim. Deep: its lane's hue made dark. */
	tone: 'pearl' | 'deep';
	/** A marble skin drawn over the body: the vanes of Glass, the mirror of Metal, the smoke of Magic */
	finish?: { kind: 'glass' | 'metal' | 'magic'; color: string; second: string };
}

/** `Skin` colours of the marble skins that have one, `GLASS_SKIN` and `MAGIC_SKIN` in skin_materials.py */
const GLASS_SKIN = '#1f6fe0';
const GLASS_GREEN_SKIN = '#0c8a3a';
const MAGIC_SKIN = '#7a3cff';
/** `GLOW_SKIN_COLOR` in skins.py: Colour: Skin on a glowing skin */
const GLOW_SKIN = '#39c8ff';

/** The contrast a marble keeps against its wall and its own pieces, as WCAG's 3:1 for graphics */
export const MARBLE_CONTRAST = 3;

/**
 * A marble's look in a theme. The marble is the subject of the film, so it stands apart from its wall and its own
 * pieces in every theme: pearl white with its lane's hue on the rim on a dark wall (Neon), or its lane's hue made
 * deep on a light one (Pegboard's birch, Brass's lavender), whichever contrasts more with both. A project theme's
 * Wall colour can change the choice. The same rule as `marble_look` in themes.py.
 */
export function draftMarble(theme: string, color: string, overrides: Pick<TThemeOverrides, 'wallColor'> = {}, skin?: TSkinLook): TDraftMarble {
	return marbleLook(theme, color, overrides, skin).marble;
}

/**
 * The lower of a marble's contrasts against its wall and its own pieces, for the theme colour wells' warning
 * below `MARBLE_CONTRAST`
 */
export function marbleContrast(theme: string, color: string, overrides: Pick<TThemeOverrides, 'wallColor'> = {}, skin?: TSkinLook): number {
	return marbleLook(theme, color, overrides, skin).contrast;
}

/**
 * The Wall well's warning when its colour leaves marbles below `MARBLE_CONTRAST` against the wall or their own
 * pieces: "Melody's marble is hard to see on this wall". Null when every marble reads.
 */
export function marbleContrastWarning(theme: string, overrides: Pick<TThemeOverrides, 'wallColor'>, marbles: readonly { name: string; color: string; skin?: TSkinLook }[]): string | null {
	const faint = marbles.filter((marble) => marbleContrast(theme, marble.color, overrides, marble.skin) < MARBLE_CONTRAST);
	const [first, second] = faint;
	if (first == null) return null;
	if (second == null) return `${first.name}'s marble is hard to see on this wall`;
	if (faint.length === 2) return `${first.name}'s and ${second.name}'s marbles are hard to see on this wall`;
	return `${faint.length} marbles are hard to see on this wall`;
}

function marbleLook(theme: string, color: string, overrides: Pick<TThemeOverrides, 'wallColor'>, skin?: TSkinLook): { marble: TDraftMarble; contrast: number } {
	const around = [draftWall(theme, overrides).color, ...marbleSurfaces(theme, color)];
	const lowest = (body: string): number => Math.min(...around.map((other) => contrastRatio(body, other)));
	const hue = saturate(color, 1);
	const pearl: TDraftMarble = { body: tint(hue, PEARL_WHITE), rim: hue, tone: 'pearl' };
	const deep: TDraftMarble = { body: deepColor(color, deepLuminance(around)), rim: null, tone: 'deep' };
	const chosen = (marble: TDraftMarble): { marble: TDraftMarble; contrast: number } => ({ marble, contrast: lowest(marble.body) });
	switch (skin?.skin) {
		case 'marble:pearl':
			return chosen(skin.colour === 'skin' ? { ...pearl, body: tint('#d0d4dc', PEARL_WHITE), rim: null } : pearl);
		case 'marble:deep':
			return chosen(deep);
		case 'marble:glass':
		case 'marble:glass-green': {
			const glass = saturate(skin.colour === 'skin' ? (skin.skin === 'marble:glass-green' ? GLASS_GREEN_SKIN : GLASS_SKIN) : color, 1);
			const look = chosen({ body: tint(glass, 0.55), rim: null, tone: 'pearl', finish: { kind: 'glass', color: glass, second: '#ffffff' } });
			// Glass reads by its swirl's colour, which a lightness ratio can't see: a green swirl on a cream wall is close in
			// lightness and plain to see, so a swirl far enough in colour from all around it counts as reading
			return around.every((other) => colorDistance(glass, other) >= GLASS_COLOR_DISTANCE) ? { ...look, contrast: Math.max(look.contrast, MARBLE_CONTRAST) } : look;
		}
		case 'marble:metal': {
			const tone = skin.colour === 'marble' ? tint(saturate(color, 1), 0.35) : '#b8bcc4';
			return chosen({ body: tone, rim: null, tone: 'pearl', finish: { kind: 'metal', color: tone, second: '#1c1e22' } });
		}
		case 'marble:magic': {
			const smoke = saturate(skin.colour === 'skin' ? MAGIC_SKIN : color, 1);
			return chosen({ body: deepColor(smoke), rim: smoke, tone: 'deep', finish: { kind: 'magic', color: smoke, second: skin.glowColor ?? tint(smoke, 0.4) } });
		}
		default:
			break;
	}
	const [pearlContrast, deepContrast] = [lowest(pearl.body), lowest(deep.body)];
	return pearlContrast >= deepContrast ? { marble: pearl, contrast: pearlContrast } : { marble: deep, contrast: deepContrast };
}

/**
 * Surfaces a marble rolls over in a theme without Colour by Note: Pegboard's tint of its colour here and the colour
 * itself on the film's platform, Brass's gold bars, Neon's deep body in its hue. `marble_surfaces` in themes.py.
 */
function marbleSurfaces(theme: string, color: string): string[] {
	if (theme === 'brass') return [FINISHES['gold'] ?? CHROME];
	if (theme === 'neon') return [saturate(color, NEON_BODY_VALUE)];
	return [tint(color, PEGBOARD_TINT), color];
}

/** `color` at full saturation, dark enough to reach `DEEP_LUMINANCE`, found by halving like `deep_color` in themes.py */
/** How light a deep body may be and still keep `MARBLE_CONTRAST` against the darkest of `around`, `deep_luminance` in themes.py */
function deepLuminance(around: readonly string[]): number {
	const darkest = Math.min(...around.map(luminance));
	return Math.min(DEEP_LUMINANCE_LIGHTEST, Math.max(DEEP_LUMINANCE_DARKEST, (darkest + 0.05) / MARBLE_CONTRAST - 0.05));
}

function deepColor(color: string, target = DEEP_LUMINANCE): string {
	let [low, high] = [0, 1];
	for (let step = 0; step < 24; step++) {
		const middle = (low + high) / 2;
		if (luminance(saturate(color, middle)) > target) high = middle;
		else low = middle;
	}
	return saturate(color, low);
}

/** Share of white in a pearl marble's body in display colours, `PEARL_WHITE` in themes.py */
const PEARL_WHITE = 0.8;
/** Relative luminance of a deep marble, `DEEP_LUMINANCE` in themes.py */
const DEEP_LUMINANCE = 0.05;
/** A deep body on a lighter wall can be lighter too, so a warm wall shows its hue rather than a near-black ball */
const DEEP_LUMINANCE_LIGHTEST = 0.09;
/** Darker still where its own Pegboard platform is a dark lane colour, `DEEP_LUMINANCE_DARKEST` in themes.py */
const DEEP_LUMINANCE_DARKEST = 0.03;
/** Brightness of a Neon body in its hue */
const NEON_BODY_VALUE = 0.62;

/** WCAG contrast ratio of two display colours, 1 to 21 */
export function contrastRatio(a: string, b: string): number {
	const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
	return (high + 0.05) / (low + 0.05);
}

/** Distance between two display colours in RGB, 0 to about 441 */
function colorDistance(a: string, b: string): number {
	const channels = (color: string): number[] => {
		const value = Number.parseInt(color.replace('#', '').slice(0, 6), 16);
		return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
	};
	const [first, second] = [channels(a), channels(b)];
	return Math.hypot(...first.map((channel, index) => channel - (second[index] ?? 0)));
}

// RGB distance at which a glass swirl stands apart from what is around it
const GLASS_COLOR_DISTANCE = 120;

/** WCAG relative luminance of a display colour */
export function luminance(color: string): number {
	const value = Number.parseInt(color.replace('#', '').slice(0, 6), 16);
	if (!Number.isFinite(value)) return 0;
	const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
		const c = channel / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	}) as [number, number, number];
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Whether the theme's pieces glow, so the Draft Preview draws a soft halo around them like Blender's bloom */
export function draftGlows(theme: string): boolean {
	return theme === 'neon';
}

/**
 * Neon pieces in the hue of their marble or note at full saturation, after `neon_colors` in skins.py: what reads
 * is the glow, so platforms, tunnels and windmills show their lit colour with a deeper body, and rails and
 * switchbacks and Finishes are tube lights on dark posts
 */
function neonColors(type: string, color: string, glowColor: string | null): TDraftColors {
	// A project theme's Glow lights every edge in one colour, like `neon_colors` with `glow`
	const glow = glowColor ?? saturate(color, 1);
	const body = saturate(color, NEON_BODY_VALUE);
	switch (type) {
		case 'platform':
			return { bar: glow, nub: NEON_MOUNT };
		case 'tunnel':
		case 'windmill':
			return { bar: body, nub: glow };
		default:
			return { bar: glow, nub: NEON_MOUNT };
	}
}

/** `color` at full saturation and brightness `value`, like `neon_color` in themes.py; a grey turns a cool blue-white */
function saturate(color: string, value: number): string {
	const rgb = Number.parseInt(color.replace('#', '').slice(0, 6), 16);
	if (!Number.isFinite(rgb)) return color;
	const r = ((rgb >> 16) & 255) / 255;
	const g = ((rgb >> 8) & 255) / 255;
	const b = (rgb & 255) / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	if (max === 0 || (max - min) / max < 0.08) return toHex(value * 0.82, value * 0.9, value);
	const saturation = Math.max((max - min) / max, 0.88);
	// Scale each channel's distance below the maximum to the new saturation, then to the new brightness
	const channel = (c: number): number => value * (1 - ((max - c) / (max - min)) * saturation);
	return toHex(channel(r), channel(g), channel(b));
}

/** Seconds a timed title takes to fade, the same as `FADE` in walltext.py */
export const TITLE_FADE = 0.25;

/**
 * Height of a screen title's centre above the frame centre, as a fraction of the half frame height: the same as
 * `SCREEN_HEIGHTS` in walltext.py and `SCREEN_TITLE_HEIGHTS` in render.py
 */
export const SCREEN_TITLE_HEIGHT: Record<'caption' | 'songName' | 'endCard', number> = { caption: 0.7, songName: 0.3, endCard: 0 };
/** Font size over letter height of a screen title, `SCREEN_TITLE_FONT_SCALE` in render.py */
export const SCREEN_TITLE_FONT_SCALE = 1.4;
/** The encoder's font for screen titles, `SCREEN_TITLE_FONTS` in render.py */
export const SCREEN_TITLE_FONT = '"Arial Rounded MT Bold", "Arial", sans-serif';

/** A screen title as the encoder draws it, in pixels of a frame of `height`: font size, backing padding and shadow */
export interface TScreenTitleLayout {
	center: { x: number; y: number };
	fontSize: number;
	/** The backing box extends this far around the text */
	padding: number;
	/** Downward offset of the text's shadow */
	shadow: number;
}

/**
 * Where and how big a Caption, Song Name or End Card sits in a frame of `width` by `height` CSS pixels, scaled from
 * `screen_title_filters` in render.py at the film's `filmHeight`: a soft dark box `padding` around the text and a
 * shadow `shadow` below it
 */
export function screenTitleLayout(style: keyof typeof SCREEN_TITLE_HEIGHT, size: number, frame: { width: number; height: number }, filmHeight: number): TScreenTitleLayout {
	const scale = frame.height / Math.max(1, filmHeight);
	// The encoder rounds to whole film pixels; the preview keeps the fractions
	const filmFont = Math.max(8, size * filmHeight * SCREEN_TITLE_FONT_SCALE);
	return {
		center: { x: frame.width / 2, y: (frame.height / 2) * (1 - SCREEN_TITLE_HEIGHT[style]) },
		fontSize: filmFont * scale,
		padding: Math.max(4, filmFont / 3) * scale,
		shadow: Math.max(1, filmFont / 24) * scale
	};
}

/**
 * A screen title in the Draft Preview frame of `frame` CSS pixels. The project frame is only an aspect (9 by 16), so
 * the encoder's whole-pixel rounding and minimum sizes use the pixel height of the film the preset exports
 */
export function previewScreenTitleLayout(
	style: keyof typeof SCREEN_TITLE_HEIGHT,
	size: number,
	frame: { width: number; height: number },
	projectFrame: { width: number; height: number },
	preset: TRenderPreset
): TScreenTitleLayout {
	return screenTitleLayout(style, size, frame, filmSize(projectFrame, preset).height);
}

/** Backing of the encoder: black at 28 %, shadow black at 35 % */
export const SCREEN_TITLE_BACKING = 'rgb(0 0 0 / 0.28)';
export const SCREEN_TITLE_SHADOW = 'rgb(0 0 0 / 0.35)';

/**
 * Opacity of a title at `time` for its optional In and Out times, fading like the Blender worker: up over
 * `TITLE_FADE` after In, down over the `TITLE_FADE` before Out
 */
export function titleOpacity(time: number, range: { in?: number; out?: number }): number {
	const start = Math.max(0, range.in ?? 0);
	const end = range.out ?? Infinity;
	if (time < start || time >= end) return 0;
	const fade = Number.isFinite(end) ? Math.min(TITLE_FADE, (end - start) / 2) : TITLE_FADE;
	let opacity = 1;
	if (start > 0) opacity = Math.min(opacity, (time - start) / fade);
	if (Number.isFinite(end)) opacity = Math.min(opacity, (end - time) / fade);
	return Math.max(0, Math.min(1, opacity));
}

/** Share of white mixed into Pegboard pieces in the marble's colour */
const PEGBOARD_TINT = 0.4;

function tint(color: string, amount: number): string {
	const value = Number.parseInt(color.replace('#', '').slice(0, 6), 16);
	if (!Number.isFinite(value)) return color;
	const mix = (channel: number): number => (channel / 255) * (1 - amount) + amount;
	return toHex(mix((value >> 16) & 255), mix((value >> 8) & 255), mix(value & 255));
}

function shade(color: string, factor: number): string {
	const value = Number.parseInt(color.replace('#', '').slice(0, 6), 16);
	if (!Number.isFinite(value)) return color;
	return toHex((((value >> 16) & 255) / 255) * factor, (((value >> 8) & 255) / 255) * factor, ((value & 255) / 255) * factor);
}

function toHex(r: number, g: number, b: number): string {
	return `#${[r, g, b].map((channel) => Math.round(Math.max(0, Math.min(1, channel)) * 255).toString(16).padStart(2, '0')).join('')}`;
}
