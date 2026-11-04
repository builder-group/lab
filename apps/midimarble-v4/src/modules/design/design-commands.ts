import type { TLibraryItem } from '@/modules/library';
import { createId, type TDesign, type TEntity, type TProject, type TProjectCommand, type TProjectTheme, type TSkinComponent, type TVec2 } from '@/modules/project';
import { canonicalSkinId } from '@/modules/project/skin-ids';
import { sampleCameraTrack } from '@/modules/camera';
import { frameBand, getPieceDefinition, gravityOf, trajectoryAt, type TSimulationResult } from '@/modules/simulation';
import { filmCamera, imageToWall } from './film-camera';
import { copyName, isThemeColorByNote, projectThemes, resolveElementLook, resolveTheme, themePartCommands, themeTitleColor } from './project-themes';
import { catalogSkins, entitySkinElement, type TCatalogSkin, type TSkinElement } from './skin-catalog';

export { themeCommands, themeTitleColor } from './project-themes';
export { builtInSkinLabel } from './skin-catalog';

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

/** Every placeable element has its own skins, usable in any theme; `public/skins/` holds a rendered preview of each */
export const THEME_SKIN_PIECE_TYPES = ['platform', 'rail', 'tunnel', 'windmill', 'switchback', 'finish'] as const;

/** The skins of an element in the Library's order: the theme's first, then the rest as the catalog lists them */
export function skinsForElement(design: Pick<TDesign, 'theme' | 'themes'>, element: TSkinElement): TCatalogSkin[] {
	const skins = catalogSkins(element);
	const part = resolveTheme(design).parts[element].skin;
	return [...skins.filter((skin) => skin.id === part), ...skins.filter((skin) => skin.id !== part)];
}

/** Whether a piece or marble wears a skin: its own, or the theme's when it has none of its own */
export function showsSkin(design: Pick<TDesign, 'theme' | 'themes'>, entity: TEntity, skinId: string): boolean {
	const element = entitySkinElement(entity);
	if (element == null) return false;
	return resolveElementLook(design, element, entity.components.skin).skin === canonicalSkinId(skinId);
}

/**
 * Sets a built-in skin on the target pieces in one edit, keeping their property overrides: the theme's own skin clears
 * their skin instead, so they follow the theme again
 */
export function builtInSkinCommands(project: TProject, target: TSkinTarget, skinId: string): TProjectCommand[] {
	const element = skinId.split(':')[0] as TSkinElement;
	if (resolveTheme(project.design).parts[element]?.skin !== skinId) return skinCommands(project, target, skinId);
	return followThemeSkinCommands(project, skinTargetIds(project, target));
}

/** The entities show the theme's skin again and keep their property overrides */
export function followThemeSkinCommands(project: TProject, entityIds: readonly string[]): TProjectCommand[] {
	return project.entities.flatMap((entity) => {
		const skin = entity.components.skin;
		if (skin == null || !entityIds.includes(entity.id)) return [];
		const { assetId: _assetId, ...rest } = skin;
		return [skinValueCommand(entity.id, rest)];
	});
}

/** Sets or removes a skin component: one that says nothing but its link goes away */
function skinValueCommand(entityId: string, skin: TSkinComponent): TProjectCommand {
	const isEmpty = Object.entries(skin).every(([name, value]) => name === 'link' || value == null);
	return isEmpty ? { type: 'removeComponent', entityId, name: 'skin' } : { type: 'setComponent', entityId, component: { name: 'skin', value: skin } };
}

/** The skin properties the inspector edits, with null removing an override so the theme's value shows again */
export type TSkinPropertyPatch = { [K in 'colour' | 'onHit' | 'glowColor' | 'variant']?: TSkinComponent[K] | null } & { property?: { name: string; value: number | string | null } };

/**
 * Changes skin properties on the target entities, as one edit. On Hit also replaces the `reaction` component older
 * projects chose it with.
 */
export function skinPropertyCommands(project: TProject, entityIds: readonly string[], patch: TSkinPropertyPatch): TProjectCommand[] {
	return project.entities
		.filter((entity) => entityIds.includes(entity.id) && entitySkinElement(entity) != null)
		.flatMap((entity): TProjectCommand[] => {
			const { property, ...fields } = patch;
			const merged: Record<string, unknown> = { link: 'linked', ...entity.components.skin, ...fields };
			if (property != null) {
				const others = Object.entries(entity.components.skin?.properties ?? {}).filter(([name]) => name !== property.name);
				const entries = property.value != null ? [...others, [property.name, property.value] as const] : others;
				merged['properties'] = entries.length > 0 ? Object.fromEntries(entries) : null;
			}
			const skin = Object.fromEntries(Object.entries(merged).filter(([, value]) => value != null)) as TSkinComponent;
			const reaction: TProjectCommand[] = 'onHit' in patch && entity.components.reaction != null ? [{ type: 'removeComponent', entityId: entity.id, name: 'reaction' }] : [];
			return [skinValueCommand(entity.id, skin), ...reaction];
		});
}

/** Reset to Theme: the entities lose their own skin, properties and old reaction, as one edit */
export function resetToThemeCommands(project: TProject, entityIds: readonly string[]): TProjectCommand[] {
	return project.entities
		.filter((entity) => entityIds.includes(entity.id))
		.flatMap((entity): TProjectCommand[] => [
			...(entity.components.skin != null ? [{ type: 'removeComponent' as const, entityId: entity.id, name: 'skin' as const }] : []),
			...(entity.components.reaction != null ? [{ type: 'removeComponent' as const, entityId: entity.id, name: 'reaction' as const }] : [])
		]);
}

/**
 * Colour by Note as the whole project's default: a project theme stores it for its platforms; a built-in theme is
 * read-only, so turning it on makes the project a theme of its own, "Neon by Note". Colour: By Note on a selection is
 * `skinPropertyCommands`.
 */
export function colorByNoteCommands(project: TProject, colorByNote: boolean): TProjectCommand[] {
	if (isThemeColorByNote(project.design) === colorByNote) return [];
	const theme = resolveTheme(project.design);
	if (theme.projectTheme != null) return themePartCommands(project, theme.id, 'platform', { colour: colorByNote ? 'note' : null });
	const themes = projectThemes(project.design);
	const created: TProjectTheme = {
		id: createId('theme'),
		name: themes.some((item) => item.name === `${theme.name} by Note`) ? copyName(`${theme.name} by Note`, themes.map((item) => item.name)) : `${theme.name} by Note`,
		base: theme.base,
		overrides: {},
		parts: { platform: { colour: 'note' } }
	};
	return [{ type: 'setDesign', design: { themes: [...themes, created], theme: created.id } }];
}

function publicUrl(path: string): string {
	return `/${path}`;
}

export type TSkinTarget = { kind: 'entities'; entityIds: string[] } | { kind: 'pieceType'; pieceType: string };

export function cameraCommands(project: TProject, patch: Partial<TDesign['camera']>): TProjectCommand[] {
	return [{ type: 'setDesign', design: { camera: { ...project.design.camera, ...patch } } }];
}

/** Pieces and marbles a skin target covers: the given entities, or every one of a type (`marble` for the marbles) */
export function skinTargetIds(project: TProject, target: TSkinTarget): string[] {
	return project.entities
		.filter((entity) => {
			const { piece, marble } = entity.components;
			if (piece == null && marble == null) return false;
			return target.kind === 'entities' ? target.entityIds.includes(entity.id) : (piece?.type ?? 'marble') === target.pieceType;
		})
		.map((entity) => entity.id);
}

/** Sets a linked skin on everything targeted, keeping what each has chosen for its properties */
export function skinCommands(project: TProject, target: TSkinTarget, assetId: string): TProjectCommand[] {
	return skinTargetIds(project, target).map((entityId) => {
		const own = project.entities.find((entity) => entity.id === entityId)?.components.skin;
		return { type: 'setComponent' as const, entityId, component: { name: 'skin' as const, value: { ...own, assetId, link: 'linked' as const } } };
	});
}

/** Removes the pieces' own skin so the theme's default skin applies again */
export function clearSkinCommands(project: TProject, entityIds: string[]): TProjectCommand[] {
	return project.entities
		.filter((entity) => entityIds.includes(entity.id) && entity.components.skin != null)
		.map((entity) => ({ type: 'removeComponent' as const, entityId: entity.id, name: 'skin' as const }));
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
