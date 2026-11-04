import type { TEntity, TSkinComponent, TThemeParts } from '@/modules/project';
import { canonicalSkinId } from '@/modules/project/skin-ids';
import catalog from '../../../blender/mm_worker/skin_catalog.json';

// Every built-in skin per element, free of themes, and what each theme dresses an element with. The Blender worker reads
// the same file (`skin_catalog.py`); `resolveSkinLook` mirrors its `resolve_look`, and both are tested against
// `blender/tests/skin_look_cases.json`.

export type TSkinElement = keyof typeof catalog.elements;
export type TSkinColour = NonNullable<TSkinComponent['colour']>;
export type TSkinOnHit = NonNullable<TSkinComponent['onHit']>;

export interface TCatalogSkin {
	id: string;
	label: string;
	element: TSkinElement;
	/** Its own colour when nothing overrides it, and the Colour choices it has */
	colour: TSkinColour;
	colours: readonly TSkinColour[];
	/** What it does on a hit with no On Hit of its own */
	reacts: TSkinOnHit;
	/** Has parts that glow without a hit, so Glow Colour always applies */
	glows: boolean;
	variants: readonly { id: string; label: string }[];
	variant: string | null;
	/** Under `public/`; null for a skin the Library doesn't list */
	previewUrl: string | null;
}

export const SKIN_ELEMENTS = Object.keys(catalog.elements) as TSkinElement[];

const ALL_SKINS: readonly TCatalogSkin[] = SKIN_ELEMENTS.flatMap((element) =>
	catalog.elements[element].skins.map((skin): TCatalogSkin => {
		const raw = skin as typeof skin & { glows?: boolean; preview?: string; variants?: { id: string; label: string }[]; variant?: string };
		return {
			id: raw.id,
			label: raw.label,
			element,
			colour: raw.colour as TSkinColour,
			colours: raw.colours as TSkinColour[],
			reacts: raw.reacts as TSkinOnHit,
			glows: raw.glows === true,
			variants: raw.variants ?? [],
			variant: raw.variant ?? null,
			previewUrl: raw.preview != null ? `/skins/${raw.preview}` : null
		};
	})
);

const SKINS_BY_ID = new Map(ALL_SKINS.map((skin) => [skin.id, skin]));

/** The element a piece type dresses; unknown types dress as platforms, like the Blender worker */
export function skinElement(type: string): TSkinElement {
	return (SKIN_ELEMENTS as string[]).includes(type) ? (type as TSkinElement) : 'platform';
}

/** The element of a piece or a marble; null for anything else */
export function entitySkinElement(entity: TEntity): TSkinElement | null {
	if (entity.components.piece != null) return skinElement(entity.components.piece.type);
	return entity.components.marble != null ? 'marble' : null;
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

/** The skins the Library lists for an element */
export function catalogSkins(element: TSkinElement): TCatalogSkin[] {
	return ALL_SKINS.filter((skin) => skin.element === element && skin.previewUrl != null);
}

/** A built-in skin by its id, old ids included */
export function catalogSkin(id: string): TCatalogSkin | null {
	return SKINS_BY_ID.get(canonicalSkinId(id)) ?? null;
}

export function builtInSkinLabel(id: string): string | null {
	return catalogSkin(id)?.label ?? null;
}

export function isBuiltInSkin(id: string): boolean {
	return catalogSkin(id) != null;
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
	colour: TSkinColour;
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
export function resolveSkinLook(base: string, parts: TThemeParts | null | undefined, element: TSkinElement, component?: TSkinComponent | null): TSkinLook {
	const part = parts?.[element] ?? {};
	const partSkin = part.skin != null && fits(part.skin, element) ? part.skin : themeDefaultSkin(base, element);
	const own = component?.assetId != null && fits(component.assetId, element) ? canonicalSkinId(component.assetId) : null;
	const skin = own ?? partSkin;
	const isThemeSkin = own == null || own === partSkin;
	const entry = SKINS_BY_ID.get(skin) as TCatalogSkin;
	const colour = component?.colour ?? (isThemeSkin ? part.colour : undefined);
	const onHit = component?.onHit ?? (isThemeSkin ? part.onHit : undefined);
	const variant = component?.variant ?? (isThemeSkin ? part.variant : undefined);
	return {
		skin,
		isThemeSkin,
		colour: colour != null && entry.colours.includes(colour) ? colour : entry.colour,
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
	colours: readonly TSkinColour[];
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
	// Glow Colour shows with Glow: on a hit, or for a skin that always glows
	const glowColor = looks.length > 0 && looks.every(({ look }, index) => (look.onHit ?? skins[index]?.reacts) === 'glow' || skins[index]?.glows === true);
	return { colours: intersect(skins.map((skin) => skin.colours)), onHit, glowColor, variants: isSameVariants ? firstVariants : [] };
}

export const COLOUR_LABELS: Record<TSkinColour, string> = { skin: 'Skin', marble: 'Marble', note: 'By Note' };
export const ON_HIT_LABELS: Record<TSkinOnHit, string> = { none: 'None', press: 'Press', wobble: 'Wobble', glow: 'Glow' };
