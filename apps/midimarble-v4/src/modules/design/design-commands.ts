import type { TLibraryItem } from '@/modules/library';
import { createId, type TDesign, type TEntity, type TProject, type TProjectCommand, type TVec2 } from '@/modules/project';
import { sampleCameraTrack } from '@/modules/camera';
import { frameBand, getPieceDefinition, gravityOf, trajectoryAt, type TSimulationResult } from '@/modules/simulation';
import { filmCamera, imageToWall } from './film-camera';
import { themeTitleColor } from './project-themes';

export { themeCommands, themeTitleColor } from './project-themes';

// Project edits made from the Design workspace. Each function returns the commands of one undoable edit.

export interface TThemePreset {
	id: string;
	label: string;
	description: string;
	/** Rendered still of Jingle Bells in the theme, plain and with Colour by Note */
	previewUrl: string;
	notePreviewUrl: string;
}

/** Themes the Blender worker ships; unknown themes fall back to Pegboard there */
export const themePresets: readonly TThemePreset[] = [
	themePreset('pegboard', 'Pegboard', 'Birch pegboard and toy colours, like Compose'),
	themePreset('brass', 'Brass', 'Plaster wall, brass bars and warm studio light'),
	themePreset('neon', 'Neon', 'Dark navy wall, glossy pieces with glowing edges that flash on a hit')
];

function themePreset(id: string, label: string, description: string): TThemePreset {
	return { id, label, description, previewUrl: publicUrl(`themes/${id}-plain.jpg`), notePreviewUrl: publicUrl(`themes/${id}-note.jpg`) };
}

/**
 * A skin a theme ships for a piece type. `assetId` null is the theme's default skin, which a piece shows when it
 * has no skin of its own; variants use the Blender worker's built-in IDs such as `brass:copper`.
 */
export interface TThemeSkin {
	assetId: string | null;
	label: string;
	themeId: string;
	pieceType: string;
	previewUrl: string;
}

/** Piece types every theme dresses; `public/skins/` holds a rendered preview of each */
export const THEME_SKIN_PIECE_TYPES = ['platform', 'rail', 'tunnel', 'windmill', 'switchback'] as const;

// Brass platform variants after the default Gold bar, rendered by `blender/tests/render_skin_previews.py`
const BRASS_PLATFORM_VARIANTS: readonly { id: string; label: string }[] = [
	{ id: 'copper', label: 'Copper' },
	{ id: 'silver', label: 'Silver' },
	{ id: 'device', label: 'Device' },
	{ id: 'device-copper', label: 'Copper Device' },
	{ id: 'key', label: 'Key' },
	{ id: 'knob', label: 'Knob' }
];

/** The name a built-in skin shows everywhere, as on its Library tile: `brass:copper` reads "Copper" */
export function builtInSkinLabel(assetId: string): string | null {
	if (!assetId.startsWith('brass:')) return null;
	const id = assetId.slice('brass:'.length);
	if (id === 'gold') return 'Gold';
	return BRASS_PLATFORM_VARIANTS.find((variant) => variant.id === id)?.label ?? null;
}

/** The theme's skins for a piece type, its default first; empty for a type or theme without previews */
export function themeSkins(themeId: string, pieceType: string): TThemeSkin[] {
	const theme = themePresets.find((item) => item.id === themeId);
	if (theme == null || !(THEME_SKIN_PIECE_TYPES as readonly string[]).includes(pieceType)) return [];
	const isBrassPlatform = themeId === 'brass' && pieceType === 'platform';
	const skins: TThemeSkin[] = [
		{ assetId: null, label: isBrassPlatform ? 'Gold' : theme.label, themeId, pieceType, previewUrl: publicUrl(`skins/${themeId}-${pieceType}.png`) }
	];
	if (isBrassPlatform) {
		for (const variant of BRASS_PLATFORM_VARIANTS) {
			skins.push({ assetId: `brass:${variant.id}`, label: variant.label, themeId, pieceType, previewUrl: publicUrl(`skins/brass-platform-${variant.id}.png`) });
		}
	}
	return skins;
}

/**
 * Skins of other themes a theme's pieces can wear, for the Library's More Skins: Brass's platform bars and devices
 * dress a platform as Brass in any theme, so Pegboard, Neon and their copies get the same choice of seven
 */
export function moreThemeSkins(themeId: string, pieceType: string): TThemeSkin[] {
	if (themeId === 'brass' || pieceType !== 'platform') return [];
	const brass = themeSkins('brass', 'platform');
	return brass.map((skin) => (skin.assetId == null ? { ...skin, assetId: 'brass:gold' } : skin));
}

/** Whether a piece shows this theme skin: its own skin, or no skin of its own for the default */
export function showsThemeSkin(entity: TEntity, skin: TThemeSkin): boolean {
	const assetId = entity.components.skin?.assetId ?? null;
	if (skin.assetId != null) return assetId === skin.assetId;
	// `brass:gold` is the Brass default spelled out
	return assetId == null || (skin.themeId === 'brass' && assetId === 'brass:gold');
}

/** Sets a theme skin on the target pieces: a variant links its built-in ID, the default removes their own skin */
export function themeSkinCommands(project: TProject, target: TSkinTarget, skin: TThemeSkin): TProjectCommand[] {
	if (skin.assetId != null) return skinCommands(project, target, skin.assetId);
	return clearSkinCommands(project, skinTargetIds(project, target));
}

/** Turns Colour by Note on or off; other theme options stay as they are */
export function colorByNoteCommands(project: TProject, colorByNote: boolean): TProjectCommand[] {
	if ((project.design.themeOptions?.colorByNote ?? false) === colorByNote) return [];
	return [{ type: 'setDesign', design: { themeOptions: { ...project.design.themeOptions, colorByNote } } }];
}

function publicUrl(path: string): string {
	return `/${path}`;
}

export type TReactionPreset = 'none' | 'press' | 'wobble' | 'glow';
/** `theme` removes the piece's own reaction so the theme's default applies */
export type TReactionChoice = TReactionPreset | 'theme';

export const reactionChoices: readonly { value: TReactionChoice; label: string }[] = [
	{ value: 'theme', label: 'Theme Default' },
	{ value: 'none', label: 'None' },
	{ value: 'press', label: 'Press' },
	{ value: 'wobble', label: 'Wobble' },
	{ value: 'glow', label: 'Glow' }
];

export type TSkinTarget = { kind: 'entities'; entityIds: string[] } | { kind: 'pieceType'; pieceType: string };

export function cameraCommands(project: TProject, patch: Partial<TDesign['camera']>): TProjectCommand[] {
	return [{ type: 'setDesign', design: { camera: { ...project.design.camera, ...patch } } }];
}

/** Pieces a skin target covers: the given piece entities, or every piece of a type */
export function skinTargetIds(project: TProject, target: TSkinTarget): string[] {
	return project.entities
		.filter((entity) => {
			const piece = entity.components.piece;
			if (piece == null) return false;
			return target.kind === 'entities' ? target.entityIds.includes(entity.id) : piece.type === target.pieceType;
		})
		.map((entity) => entity.id);
}

/** Sets a linked skin on every targeted piece */
export function skinCommands(project: TProject, target: TSkinTarget, assetId: string): TProjectCommand[] {
	return skinTargetIds(project, target).map((entityId) => ({
		type: 'setComponent' as const,
		entityId,
		component: { name: 'skin' as const, value: { assetId, link: 'linked' as const } }
	}));
}

/** Removes the pieces' own skin so the theme's default skin applies again */
export function clearSkinCommands(project: TProject, entityIds: string[]): TProjectCommand[] {
	return project.entities
		.filter((entity) => entityIds.includes(entity.id) && entity.components.skin != null)
		.map((entity) => ({ type: 'removeComponent' as const, entityId: entity.id, name: 'skin' as const }));
}

export function reactionCommands(project: TProject, entityIds: string[], choice: TReactionChoice): TProjectCommand[] {
	const pieces = project.entities.filter((entity) => entityIds.includes(entity.id) && entity.components.piece != null);
	if (choice === 'theme') {
		return pieces
			.filter((entity) => entity.components.reaction != null)
			.map((entity) => ({ type: 'removeComponent' as const, entityId: entity.id, name: 'reaction' as const }));
	}
	return pieces.map((entity) => ({
		type: 'setComponent' as const,
		entityId: entity.id,
		component: { name: 'reaction' as const, value: { preset: choice, params: entity.components.reaction?.params ?? {} } }
	}));
}

export function reactionChoiceOf(entity: TEntity): TReactionChoice {
	const preset = entity.components.reaction?.preset;
	return preset === 'none' || preset === 'press' || preset === 'wobble' || preset === 'glow' ? preset : 'theme';
}

/** The piece type most of the pieces have, so a section selected as a range in Layers shows its platforms' skins */
export function commonPieceType(pieces: TEntity[]): string | null {
	const counts = new Map<string, number>();
	for (const entity of pieces) {
		const type = entity.components.piece?.type;
		if (type != null) counts.set(type, (counts.get(type) ?? 0) + 1);
	}
	let best: string | null = null;
	for (const [type, count] of counts) if (best == null || count > (counts.get(best) ?? 0)) best = type;
	return best;
}

/** Counts per piece type, most first: `5 Platforms, 1 Rail` */
export function pieceCountLabel(pieces: TEntity[]): string {
	const counts = new Map<string, number>();
	for (const entity of pieces) {
		const type = entity.components.piece?.type;
		if (type != null) counts.set(type, (counts.get(type) ?? 0) + 1);
	}
	return [...counts]
		.sort((a, b) => b[1] - a[1])
		.map(([type, count]) => countOf(count, getPieceDefinition(type)?.label ?? type))
		.join(', ');
}

/**
 * Notice for a skin applied to a selection with other piece types, or to platforms that keep the skin's colour with
 * Colour by Note on, where the film alone would not show what happened: `Copper applied to 5 platforms; Rail 1 kept
 * its skin`. Null when the change speaks for itself.
 */
export function skinAppliedMessage(options: { skinLabel: string; pieceType: string; selected: TEntity[]; keepsSkinColor: boolean }): string | null {
	const { skinLabel, pieceType, selected, keepsSkinColor } = options;
	const applied = selected.filter((entity) => entity.components.piece?.type === pieceType);
	const kept = selected.filter((entity) => entity.components.piece != null && entity.components.piece.type !== pieceType);
	const isColorKept = keepsSkinColor && pieceType === 'platform';
	if (!applied.length || (!kept.length && !isColorKept)) return null;
	const typeLabel = getPieceDefinition(pieceType)?.label ?? pieceType;
	let message = `${skinLabel} applied to ${countOf(applied.length, typeLabel).toLowerCase()}`;
	if (kept.length > 0) {
		const names = kept.map((entity) => entity.name ?? getPieceDefinition(entity.components.piece?.type ?? '')?.label ?? 'Piece');
		message += kept.length === 1 ? `; ${names[0]} kept its skin` : kept.length === 2 ? `; ${names[0]} and ${names[1]} kept their skins` : `; ${kept.length} other pieces kept their skins`;
	}
	if (isColorKept) message += `. ${applied.length === 1 ? 'It keeps' : 'They keep'} ${skinLabel}'s colour with Colour by Note`;
	return message;
}

function countOf(count: number, label: string): string {
	return `${count} ${label}${count === 1 ? '' : 's'}`;
}

/** Whether a library item can skin a piece type: a skin made for that type, or for any type */
export function itemFitsPieceType(item: TLibraryItem, pieceType: string | null): boolean {
	const manifest = item.manifest;
	if (manifest == null || manifest.role !== 'skin') return false;
	return manifest.pieceType == null || pieceType == null || manifest.pieceType === pieceType;
}

// MARK: - Titles

export const DEFAULT_WALL_TEXT = { text: 'Title', font: 'Bfont Regular', size: 0.03, depth: 0.002, color: '#1d1d1f' };

type TWallText = NonNullable<TEntity['components']['wallText']>;
export type TTitleStyle = NonNullable<TWallText['style']>;

/**
 * Title styles of the Title inspector. A Wall Title sits on the wall where it was placed; Caption, Song Name and End
 * Card sit in the frame, and Blender hangs them from the film camera, so they stay put while the camera moves.
 */
export const titleStyles: readonly { style: TTitleStyle; label: string }[] = [
	{ style: 'wall', label: 'Wall Title' },
	{ style: 'caption', label: 'Caption' },
	{ style: 'songName', label: 'Song Name' },
	{ style: 'endCard', label: 'End Card' }
];

// Letter heights as a fraction of the frame height, so titles read at phone size: about 115 px of a 1920 px film
// for a wall title and a caption, more for the song name and the end card
const TITLE_HEIGHT: Record<TTitleStyle, number> = { wall: 0.06, caption: 0.06, songName: 0.07, endCard: 0.08 };
// Seconds each style shows by default, like a title preset in Final Cut or CapCut: a song name opens the film, a
// caption shows from the playhead and an end card closes the film
const STYLE_SECONDS = 3;
// Share of the frame width a screen title may fill, and the width of a letter over its letter height in the bold
// rounded font the encoder draws with (`SCREEN_TITLE_FONT_SCALE` 1.4 times about 0.6 of the font size)
const SCREEN_TITLE_WIDTH = 0.86;
const LETTER_WIDTH = 0.84;

/** Caption, Song Name and End Card sit in the frame, and their size is a fraction of the frame height */
export function isScreenTitle(style: TWallText['style']): boolean {
	return style === 'caption' || style === 'songName' || style === 'endCard';
}

/** Height of the film frame on the wall at `time`, through the film camera; the letter size of wall titles follows it */
export function frameHeightOnWall(project: TProject, result: TSimulationResult | null, time: number): number {
	const top = previewPointToWall(project, result, time, 0.5, 0);
	const bottom = previewPointToWall(project, result, time, 0.5, 1);
	const height = Math.hypot(top.x - bottom.x, top.y - bottom.y);
	return Number.isFinite(height) && height > 0 ? height : 0.5;
}

/** A new Wall Title at a wall point, in the theme's title colour and a size that reads in the frame */
export function addWallTextCommands(point: TVec2, options: { theme: string; frameHeight: number; text?: string }): { commands: TProjectCommand[]; entityId: string } {
	const text = options.text ?? DEFAULT_WALL_TEXT.text;
	const entity: TEntity = {
		id: createId('text'),
		name: text,
		components: {
			wallText: { ...DEFAULT_WALL_TEXT, text, color: themeTitleColor(options.theme), size: wallTitleSize('wall', options.frameHeight) },
			transform: { position: { x: round(point.x), y: round(point.y) }, angle: 0 }
		}
	};
	return { commands: [{ type: 'upsertEntity', entity }], entityId: entity.id };
}

/**
 * Default In and Out of a style, absent for the start and the end of the film: Song Name the first 3 s, Caption 3 s
 * from the playhead and End Card the last 3 s. A Wall Title shows for the whole film.
 */
export function titleStyleTiming(style: TTitleStyle, context: { playhead: number; end: number }): { in?: number; out?: number } {
	const { end } = context;
	if (style === 'wall' || end <= STYLE_SECONDS) return {};
	if (style === 'songName') return { out: STYLE_SECONDS };
	if (style === 'endCard') return { in: roundTime(end - STYLE_SECONDS) };
	const start = roundTime(Math.min(Math.max(0, context.playhead), end - STYLE_SECONDS));
	const out = roundTime(start + STYLE_SECONDS);
	return { ...(start > 0 ? { in: start } : {}), ...(out < end ? { out } : {}) };
}

/**
 * The title in another style with that style's size and default timing. The timing follows the new style while it
 * is still the old style's default or the whole film; times set by hand stay. A Song Name reads the song's name
 * while the text is still the default, and a screen title shrinks to fit the frame width.
 */
export function withTitleStyle(
	text: TWallText,
	style: TTitleStyle,
	context: { frameHeight: number; playhead: number; end: number; songName: string | null; aspect?: number }
): TWallText {
	const { style: previous = 'wall', in: start, out, ...rest } = text;
	const next: TWallText = { ...rest };
	if (style === 'songName' && text.text === DEFAULT_WALL_TEXT.text && context.songName != null) next.text = context.songName;
	next.size = isScreenTitle(style) ? screenTitleSize(style, next.text, context.aspect ?? 9 / 16) : wallTitleSize(style, context.frameHeight);
	if (style !== 'wall') next.style = style;
	const timing = hasStyleTiming(text, previous, context) ? titleStyleTiming(style, context) : { in: start, out };
	if (timing.in != null) next.in = timing.in;
	if (timing.out != null) next.out = timing.out;
	return next;
}

/** Whether a title's In and Out are still what its style gave it, or the whole film */
function hasStyleTiming(text: TWallText, style: TTitleStyle, context: { playhead: number; end: number }): boolean {
	if (text.in == null && text.out == null) return true;
	if (style === 'caption') {
		// A caption's default starts at the playhead it was made at, so any 3 s span counts
		const length = Math.min(context.end, text.out ?? context.end) - Math.max(0, text.in ?? 0);
		return Math.abs(length - STYLE_SECONDS) < 0.005;
	}
	const timing = titleStyleTiming(style, context);
	return sameTime(text.in, timing.in) && sameTime(text.out, timing.out);
}

function sameTime(a: number | undefined, b: number | undefined): boolean {
	return a == null || b == null ? a === b : Math.abs(a - b) < 0.005;
}

/** Letter height of a screen title as a share of the frame height: the style's, smaller when the text would not fit */
function screenTitleSize(style: TTitleStyle, text: string, aspect: number): number {
	const fit = (SCREEN_TITLE_WIDTH * aspect) / (Math.max(1, text.length) * LETTER_WIDTH);
	// Rounded down to a tenth of a percent, at least 2 % of the frame height
	return Math.max(0.02, Math.floor(Math.min(TITLE_HEIGHT[style], fit) * 1000) / 1000);
}

function roundTime(time: number): number {
	return Math.round(time * 100) / 100;
}

function wallTitleSize(style: TTitleStyle, frameHeight: number): number {
	// Rounded to half a centimetre, between 1 cm and 50 cm like the Size field
	return Math.min(0.5, Math.max(0.01, Math.round((TITLE_HEIGHT[style] * frameHeight) / 0.005) * 0.005));
}

/**
 * Wall point under a click on the preview, in 0..1 image coordinates, through the film's follow camera at `time`.
 * Without a camera track it approximates the film camera as a front view of the frame band centred on the marble
 * at the playhead; the inspector refines the position.
 */
export function previewPointToWall(
	project: TProject,
	result: TSimulationResult | null,
	time: number,
	u: number,
	v: number
): TVec2 {
	const camera = result != null ? filmCamera(project, result).track : null;
	const point = camera != null ? imageToWall(sampleCameraTrack(camera, time), project.frame.width / project.frame.height, u, v) : null;
	if (point != null) return point;
	const band = frameBand(project);
	const marble = project.entities.find((entity) => entity.components.marble != null);
	const track = result?.marbles.find((item) => item.entityId === marble?.id);
	const focus = (track == null ? null : trajectoryAt(track.samples, time, gravityOf(project))?.position) ?? marble?.components.release?.position ?? { x: band.centerX, y: 0 };
	const width = band.halfWidth * 2;
	const height = width * (project.frame.height / project.frame.width);
	return { x: band.centerX + (u - 0.5) * width, y: focus.y - (v - 0.5) * height };
}

function round(value: number): number {
	return Math.round(value * 10000) / 10000;
}
