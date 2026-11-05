import { PIECE_TYPES, pieceDefinitions, type TPieceType } from '@/modules/simulation';
import type { TTrackTool, TPathType } from './keys';

// Items of the Insert library, the tool rail's + popover. A click arms the tool that places the item and a
// drag drops it on the canvas. Each tile shows the key that arms it without opening the panel.

export type TInsertItem = TPieceType | 'marble';

export interface TInsertEntry {
	item: TInsertItem;
	label: string;
	/** One line for the tile tooltip: what the piece does to the marble */
	description: string;
	shortcut?: string;
}

export interface TInsertSection {
	title: string;
	entries: TInsertEntry[];
}

export const insertSections: TInsertSection[] = [
	{
		title: 'Track',
		entries: [
			{ item: 'marble', label: 'Marble', description: 'Click to release a new marble', shortcut: 'O' },
			...PIECE_TYPES.map((item): TInsertEntry => {
				const { label, tile } = pieceDefinitions[item];
				return { item, label, description: tile.description, ...(tile.shortcut != null ? { shortcut: tile.shortcut } : {}) };
			})
		]
	}
];

/** The tool a click on a library item arms, with the path type for rails and tunnels */
export function insertTool(item: TInsertItem): { tool: TTrackTool; pathType?: TPathType } {
	if (item === 'rail' || item === 'tunnel') return { tool: 'path', pathType: item };
	return { tool: item };
}

/** The library item that a tool and path type place, to mark its tile as armed */
export function armedInsertItem(tool: TTrackTool, pathType: TPathType): TInsertItem | null {
	if (tool === 'path') return pathType;
	if (tool === 'select' || tool === 'hand') return null;
	return tool;
}
