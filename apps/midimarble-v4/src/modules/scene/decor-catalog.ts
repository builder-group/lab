import { STARTER_PACK } from './pack-data';
import type { TDecor, TDesign } from '@/modules/project';
import catalog from '../../../blender/mm_worker/decor_catalog.json';

// The Decor items. The Starter Pack lists the ones every project is offered, another Pack brings the rest; `origin` names a Pack. The Blender worker builds the same items from the same file (`decor.py`), and `check_design.py` holds its meshes to these sizes.

export interface TDecorItem {
	/** `decor:bauble-red`: a project's `source` for this item */
	id: string;
	label: string;
	/** Quiet origin line: the Pack it comes from */
	origin?: string;
	/** Renders where a project has it, and is no longer offered */
	previewUrl: string;
	/** Half width and half height on the wall in meters at scale 1 */
	halfWidth: number;
	halfHeight: number;
	color: string;
	second?: string;
	opacity?: number;
	/** Scatter Decor uses the item */
	scatter: boolean;
	/** Belongs to the frame, not the wall: hangs from the film camera, so it has no place, size or path to overlap */
	effect?: 'snowfall';
}

export const DECOR_ITEMS: readonly TDecorItem[] = catalog.items.map(({ preview, ...item }) => ({ ...item, previewUrl: `/decor/${preview}` }) as TDecorItem);

/** The items Insert and the pickers offer: the Starter Pack's, an added Pack's, and the whole Pack of any item the project has */
export function listedDecorItems(added: readonly string[], inUse: ReadonlySet<string> = new Set()): TDecorItem[] {
	const packsInUse = new Set(DECOR_ITEMS.filter((item) => inUse.has(item.id)).map((item) => item.origin));
	return DECOR_ITEMS.filter((item) => STARTER_PACK.builtInDecor.includes(item.id) || added.includes(item.id) || packsInUse.has(item.origin));
}

/** The items a project has placed, which it keeps offering without their Pack */
export function usedDecorSources(design: Pick<TDesign, 'decor'> | undefined): ReadonlySet<string> {
	return new Set(design?.decor.map((decor) => decor.source));
}

export function decorItem(source: string): TDecorItem | null {
	return DECOR_ITEMS.find((item) => item.id === source) ?? null;
}

/** Whether a decoration belongs to the frame rather than the wall */
export function isFrameEffect(decor: Pick<TDecor, 'source'>): boolean {
	return decorItem(decor.source)?.effect != null;
}

/** Half extents of an asset whose manifest gives none */
const ASSET_FOOTPRINT = { x: 0.02, y: 0.02 };

/** Half width and half height of a decoration at its scale */
export function decorExtent(decor: Pick<TDecor, 'source' | 'scale' | 'footprint'>): { x: number; y: number } {
	const item = decorItem(decor.source);
	if (item == null) {
		const footprint = decor.footprint ?? ASSET_FOOTPRINT;
		return { x: footprint.x * decor.scale, y: footprint.y * decor.scale };
	}
	return { x: item.halfWidth * decor.scale, y: item.halfHeight * decor.scale };
}
