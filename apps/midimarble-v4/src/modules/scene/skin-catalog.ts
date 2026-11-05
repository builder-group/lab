import type { TAssetProperty } from './asset-manifest';
import type { TMarble, TPiece, TProject, TProjectCommand, TSkin, TThemeParts } from '@/modules/project';
import { STARTER_ORIGIN } from './pack-data';
import catalog from '../../../blender/mm_worker/skin_catalog.json';

// Every built-in skin per element, free of themes, and what each theme dresses an element with. The Blender worker reads
// the same file (`skin_catalog.py`); `resolveSkinLook` mirrors its `resolve_look`, and both are tested against
// `blender/tests/skin_look_cases.json`.

export type TSkinElement = keyof typeof catalog.elements;
export type TSkinColorSource = NonNullable<TSkin['colorSource']>;
export type TSkinOnHit = NonNullable<TSkin['onHit']>;

export interface TCatalogSkin {
	id: string;
	label: string;
	element: TSkinElement;
	/** Its own color when nothing overrides it, and the Color choices it has */
	colorSource: TSkinColorSource;
	colorSources: readonly TSkinColorSource[];
	/** What it does on a hit with no On Hit of its own */
	reacts: TSkinOnHit;
	/** Has parts that glow without a hit, so Glow Color always applies */
	glows: boolean;
	variants: readonly { id: string; label: string }[];
	variant: string | null;
	/** Extra properties the skin has beyond the standard ones, such as Gift's Ribbon Color */
	properties: readonly TAssetProperty[];
	/** Under `public/`; null for a skin with no tile */
	previewUrl: string | null;
	/** Off the pickers unless the project already uses it: a project's content for now, a Pack later; the Theme Default marble */
	isHidden: boolean;
	/** Quiet origin line, the Pack or example project it belongs to */
	origin: string;
}

export const SKIN_ELEMENTS = Object.keys(catalog.elements) as TSkinElement[];

const ALL_SKINS: readonly TCatalogSkin[] = SKIN_ELEMENTS.flatMap((element) =>
	catalog.elements[element].skins.map((skin): TCatalogSkin => {
		const raw = skin as typeof skin & { hidden?: boolean; origin?: string; glows?: boolean; preview?: string; variants?: { id: string; label: string }[]; variant?: string; properties?: TAssetProperty[] };
		return {
			id: raw.id,
			label: raw.label,
			element,
			colorSource: raw.colorSource as TSkinColorSource,
			colorSources: raw.colorSources as TSkinColorSource[],
			reacts: raw.reacts as TSkinOnHit,
			glows: raw.glows === true,
			variants: raw.variants ?? [],
			variant: raw.variant ?? null,
			properties: raw.properties ?? [],
			previewUrl: raw.preview != null ? `/skins/${raw.preview}` : null,
			isHidden: raw.hidden === true,
			origin: raw.origin ?? STARTER_ORIGIN
		};
	})
);

const SKINS_BY_ID = new Map(ALL_SKINS.map((skin) => [skin.id, skin]));

/** The element a piece type dresses; unknown types dress as platforms, like the Blender worker */
export function skinElement(type: string): TSkinElement {
	return (SKIN_ELEMENTS as string[]).includes(type) ? (type as TSkinElement) : 'platform';
}

/** What wears a skin: a piece, or a marble, which has no `type` */
export type TSkinned = TPiece | TMarble;

/** Everything in the project that wears a skin */
export function skinnedOf(project: Pick<TProject, 'track' | 'marbles'>): TSkinned[] {
	return [...project.track.pieces, ...project.marbles];
}

/** The element of a piece or a marble */
export function entitySkinElement(entity: TSkinned): TSkinElement {
	return 'type' in entity ? skinElement(entity.type) : 'marble';
}

/** The edit that gives a piece or a marble a skin; null takes its skin away */
export function skinCommand(entity: TSkinned, skin: TSkin | null): TProjectCommand {
	return 'type' in entity ? { type: 'updatePiece', pieceId: entity.id, patch: { skin } } : { type: 'updateMarble', marbleId: entity.id, patch: { skin } };
}

export function elementLabel(element: TSkinElement): string {
	return catalog.elements[element].label;
}

export function elementPlural(element: TSkinElement): string {
	return catalog.elements[element].plural;
}

/** On Hit choices of an element: None and Glow on pieces with no moving part, none at all on a marble */
export function elementOnHit(element: TSkinElement): readonly TSkinOnHit[] {
	return catalog.elements[element].onHit as TSkinOnHit[];
}

/**
 * The skin tiles of an element: the built-in ones, then hidden ones `usedSkins` names, which keep a tile so a project that
 * uses one can go back to it
 */
export function catalogSkins(element: TSkinElement, usedSkins: ReadonlySet<string> = new Set()): TCatalogSkin[] {
	return ALL_SKINS.filter((skin) => skin.element === element && skin.previewUrl != null && (!skin.isHidden || usedSkins.has(skin.id)));
}

/** A built-in skin by its id, old ids included */
export function catalogSkin(id: string): TCatalogSkin | null {
	return SKINS_BY_ID.get(id) ?? null;
}

export function builtInSkinLabel(id: string): string | null {
	return catalogSkin(id)?.label ?? null;
}

/** The skin a built-in theme or a project theme's base dresses an element with */
export function themeDefaultSkin(base: string, element: TSkinElement): string {
	const themes = catalog.themes as Record<string, Record<TSkinElement, string>>;
	return (themes[base] ?? themes['pegboard'])?.[element] ?? `${element}:`;
}

/** What a piece of an element wears: everything `resolve_look` in skin_catalog.py says */
export interface TSkinLook {
	skin: string;
	/** It shows the theme's skin, so the theme's property defaults apply */
	isThemeSkin: boolean;
	colorSource: TSkinColorSource;
	/** Null keeps the theme's reaction */
	onHit: TSkinOnHit | null;
	glowColor: string | null;
	variant: string | null;
	properties: Record<string, number | string>;
}

/**
 * Which skin an element wears and with what properties: its own skin or the theme's, each property from its own override,
 * from the theme's part while it shows the theme's skin, or from the skin. A library skin's id reads as no built-in skin,
 * so its properties resolve on the theme's.
 */
export function resolveSkinLook(base: string, parts: TThemeParts | null | undefined, element: TSkinElement, component?: TSkin | null): TSkinLook {
	const part = parts?.[element] ?? {};
	const partSkin = part.skin != null && fits(part.skin, element) ? part.skin : themeDefaultSkin(base, element);
	const own = component?.assetId != null && fits(component.assetId, element) ? component.assetId : null;
	const skin = own ?? partSkin;
	const isThemeSkin = own == null || own === partSkin;
	const entry = SKINS_BY_ID.get(skin) as TCatalogSkin;
	const colorSource = component?.colorSource ?? (isThemeSkin ? part.colorSource : undefined);
	const onHit = component?.onHit ?? (isThemeSkin ? part.onHit : undefined);
	const variant = component?.variant ?? (isThemeSkin ? part.variant : undefined);
	return {
		skin,
		isThemeSkin,
		colorSource: colorSource != null && entry.colorSources.includes(colorSource) ? colorSource : entry.colorSource,
		onHit: onHit != null && elementOnHit(element).includes(onHit) ? onHit : null,
		glowColor: component?.glowColor ?? (isThemeSkin ? part.glowColor : undefined) ?? null,
		variant: variant != null && entry.variants.some((item) => item.id === variant) ? variant : entry.variant,
		properties: { ...component?.properties }
	};
}

function fits(id: string, element: TSkinElement): boolean {
	const skin = catalogSkin(id);
	return skin?.element === element;
}

/** The property rows a selection shows: what every selected skin has, like Figma's mixed selections */
export interface TSharedSkinProperties {
	colorSources: readonly TSkinColorSource[];
	onHit: readonly TSkinOnHit[];
	glowColor: boolean;
	variants: readonly { id: string; label: string }[];
}

export function sharedSkinProperties(looks: readonly { element: TSkinElement; look: TSkinLook }[]): TSharedSkinProperties {
	const skins = looks.map(({ look }) => SKINS_BY_ID.get(look.skin) as TCatalogSkin);
	const intersect = <T,>(lists: readonly (readonly T[])[]): T[] => (lists[0] ?? []).filter((item) => lists.every((list) => list.includes(item)));
	const onHit = intersect(looks.map(({ element }) => elementOnHit(element)));
	const firstVariants = skins[0]?.variants ?? [];
	const isSameVariants = skins.every((skin) => skin.variants.length === firstVariants.length && skin.variants.every((item, index) => item.id === firstVariants[index]?.id));
	// Glow Color shows with Glow: on a hit, or for a skin that always glows
	const glowColor = looks.length > 0 && looks.every(({ look }, index) => (look.onHit ?? skins[index]?.reacts) === 'glow' || skins[index]?.glows === true);
	return { colorSources: intersect(skins.map((skin) => skin.colorSources)), onHit, glowColor, variants: isSameVariants ? firstVariants : [] };
}

export const COLOR_SOURCE_LABELS: Record<TSkinColorSource, string> = { skin: 'Skin', marble: 'Marble', note: 'By Note' };
export const ON_HIT_LABELS: Record<TSkinOnHit, string> = { none: 'None', press: 'Press', wobble: 'Wobble', glow: 'Glow' };
