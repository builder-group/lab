import type { TWallLook } from '@/modules/compose/ComposeRenderer';
import type { TScenePiece } from '@/modules/blender/scene-description';

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

/** Birch hardboard with dark peg holes for Pegboard, matte lavender plaster for Brass */
export function draftWall(theme: string): TWallLook {
	if (theme === 'brass') return { color: '#a098ac', holes: null };
	return { color: '#b3a38f', holes: 'rgba(72, 56, 40, 0.75)', holeRadius: 0.1 };
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

/**
 * Body and accent colour of a piece in a theme, from its scene description entry: its skin, its marble's colour
 * and, with Colour by Note, its note.
 */
export function draftPieceColors(theme: string, piece: Pick<TScenePiece, 'type' | 'color' | 'skin' | 'notePitch'>, colorByNote: boolean): TDraftColors {
	const note = colorByNote && piece.type === 'platform' && piece.notePitch != null ? noteColor(piece.notePitch) : null;
	if (theme !== 'brass') {
		// Pieces take their marble's colour; a lighter tint keeps the marble readable as it rolls over them
		const body = note ?? tint(piece.color, PEGBOARD_TINT);
		return piece.type === 'tunnel' ? { bar: body, nub: shade(body, 0.75) } : { bar: body, nub: WOOD };
	}
	switch (piece.type) {
		case 'platform': {
			const skin = brassSkin(piece.skin?.assetId);
			const [device, trim = 'gold'] = skin.split('-');
			if (device === 'key') return { bar: note ?? '#dcdee0', nub: HOUSING };
			if (device === 'knob') return { bar: HOUSING, nub: note ?? '#e0261c' };
			if (device === 'device') return { bar: CHROME, nub: note ?? FINISHES[trim] ?? FINISHES['gold'] ?? CHROME };
			return { bar: note ?? FINISHES[skin] ?? FINISHES['gold'] ?? CHROME, nub: CHROME };
		}
		case 'windmill':
			return { bar: FINISHES['gold'] ?? CHROME, nub: CHROME };
		case 'tunnel':
			return { bar: '#e9ecf2', nub: CHROME };
		default:
			return { bar: CHROME, nub: '#9da1a8' };
	}
}

/** Name of a built-in Brass platform skin, `gold` for none or an unknown one, like `brass_skin` in skins.py */
function brassSkin(assetId: string | undefined): string {
	if (assetId?.startsWith('brass:') !== true) return 'gold';
	const name = assetId.slice('brass:'.length);
	return BRASS_SKINS.includes(name) ? name : 'gold';
}

const BRASS_SKINS = ['gold', 'silver', 'copper', 'dark', 'device', 'key', 'knob', 'device-silver', 'device-copper', 'device-dark'];

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
