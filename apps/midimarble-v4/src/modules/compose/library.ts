import type { TComposeTool, TPathType } from './keys';

// Items of the Insert library, the tool rail's + popover. A click arms the tool that places the item and a
// drag drops it on the canvas.

export type TInsertItem = 'platform' | 'rail' | 'tunnel' | 'windmill' | 'switchback' | 'marble';

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
		title: 'Paths',
		entries: [
			{ item: 'rail', label: 'Rail', description: 'The marble lands and rolls along it', shortcut: 'B' },
			{ item: 'tunnel', label: 'Tunnel', description: 'The marble drops in and rolls through, hidden', shortcut: 'U' }
		]
	},
	{
		title: 'Pieces',
		entries: [
			{ item: 'platform', label: 'Platform', description: 'The marble bounces off it and plays a note', shortcut: 'P' },
			{ item: 'windmill', label: 'Windmill', description: 'The marble strikes a blade and sets it turning', shortcut: 'W' },
			{ item: 'switchback', label: 'Switchback', description: 'The marble zigzags down its legs to fill a long gap' },
			{ item: 'marble', label: 'Marble', description: 'A new marble with its own lane of hits', shortcut: 'O' }
		]
	}
];

/** The tool a click on a library item arms, with the path type for rails and tunnels */
export function insertTool(item: TInsertItem): { tool: TComposeTool; pathType?: TPathType } {
	if (item === 'rail' || item === 'tunnel') return { tool: 'path', pathType: item };
	return { tool: item };
}

/** The library item that a tool and path type place, to mark its tile as armed */
export function armedInsertItem(tool: TComposeTool, pathType: TPathType): TInsertItem | null {
	if (tool === 'path') return pathType;
	if (tool === 'select' || tool === 'hand') return null;
	return tool;
}
