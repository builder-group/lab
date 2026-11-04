import type { TDecor } from '@/modules/project';
import catalog from '../../../blender/mm_worker/decor_catalog.json';

// The built-in Decor items with their categories, and each theme's Decor set. The Blender worker builds the
// same items from the same file (`decor.py`), and `check_design.py` holds its meshes to these sizes.

export interface TDecorItem {
	/** `decor:bauble-red`: a project's `source` for this item */
	id: string;
	label: string;
	category: TDecorCategory;
	previewUrl: string;
	/** Half width and half height on the wall in metres at scale 1, a text item's for its default text */
	halfWidth: number;
	halfHeight: number;
	color: string;
	second?: string;
	/** A text item's default text and letter height in metres */
	text?: string;
	letterHeight?: number;
	opacity?: number;
	/** Scatter Decor uses the item; a Handle or Subscribe is placed once, by hand */
	scatter: boolean;
	/** Belongs to the frame, not the wall: hangs from the film camera, so it has no place, size or path to overlap */
	effect?: 'snowfall' | 'garland';
}

export const DECOR_ITEMS: readonly TDecorItem[] = catalog.items.map(({ preview, ...item }) => ({ ...item, previewUrl: `/decor/${preview}` }) as TDecorItem);

const DEFAULT_THEME_SET = catalog.themes.brass;

/** What an item is, the sections Insert lists Decor by; never a season or an occasion, which a theme's Decor set carries */
export const DECOR_CATEGORIES = ['Ornaments', 'Lights', 'Particles', 'Text'] as const;

export type TDecorCategory = (typeof DECOR_CATEGORIES)[number];


export function decorItem(source: string): TDecorItem | null {
	return DECOR_ITEMS.find((item) => item.id === source) ?? null;
}

/** Whether a decoration belongs to the frame rather than the wall */
export function isFrameEffect(decor: Pick<TDecor, 'source'>): boolean {
	return decorItem(decor.source)?.effect != null;
}

/** The items a built-in theme's Scatter Decor starts with */
export function themeDecorSet(base: string): readonly string[] {
	return (catalog.themes as Record<string, string[] | undefined>)[base] ?? DEFAULT_THEME_SET;
}

/** Half extents of an asset whose manifest gives none */
const ASSET_FOOTPRINT = { x: 0.02, y: 0.02 };

/** Half width and half height of a decoration at its scale: a text item's follow its text */
export function decorExtent(decor: Pick<TDecor, 'source' | 'scale' | 'text' | 'footprint'>): { x: number; y: number } {
	const item = decorItem(decor.source);
	if (item == null) {
		const footprint = decor.footprint ?? ASSET_FOOTPRINT;
		return { x: footprint.x * decor.scale, y: footprint.y * decor.scale };
	}
	if (item.text == null || decor.text == null) return { x: item.halfWidth * decor.scale, y: item.halfHeight * decor.scale };
	// The default text sets the width per letter; the Subscribe arrow keeps its share
	const ratio = Math.max(1, decor.text.length) / Math.max(1, item.text.length);
	return { x: item.halfWidth * ratio * decor.scale, y: item.halfHeight * decor.scale };
}

/** Text a text item shows */
export function decorText(decor: Pick<TDecor, 'source' | 'text'>): string | null {
	const item = decorItem(decor.source);
	if (item?.text == null) return null;
	return decor.text ?? item.text;
}
