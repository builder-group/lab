import type { TComposeTool, TPathType } from './keys';

// Items of the Insert library, the tool rail's + popover. A click arms the tool that places the item and a
// drag drops it on the canvas. Marble, Platform and Rail are the rail's own tools, so they are not listed here.

export type TInsertItem = 'platform' | 'rail' | 'tunnel' | 'windmill' | 'finish' | 'marble';

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
			{ item: 'tunnel', label: 'Tunnel', description: 'The marble drops in and rolls through, hidden', shortcut: 'U' },
			{ item: 'windmill', label: 'Windmill', description: 'The marble strikes a blade and sets it turning', shortcut: 'W' },
			{ item: 'finish', label: 'Finish', description: 'Catches the marble after its last note, so the film ends on the catch' }
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
