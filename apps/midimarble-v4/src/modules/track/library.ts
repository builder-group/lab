import type { TTrackTool, TPathType } from './keys';

// Items of the Insert library, the tool rail's + popover. A click arms the tool that places the item and a
// drag drops it on the canvas. Each tile shows the key that arms it without opening the panel.

export type TInsertItem = 'platform' | 'rail' | 'tunnel' | 'windmill' | 'bowl' | 'marble';

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
			{ item: 'platform', label: 'Platform', description: 'Click or drag to place, click a dot to play its note', shortcut: 'P' },
			{ item: 'rail', label: 'Rail', description: 'Draw a rail: click points, drag for curves', shortcut: 'B' },
			{ item: 'tunnel', label: 'Tunnel', description: 'The marble drops in and rolls through, hidden', shortcut: 'U' },
			{ item: 'windmill', label: 'Windmill', description: 'The marble strikes a blade and sets it turning', shortcut: 'W' },
			{ item: 'bowl', label: 'Bowl', description: 'Collects the marble, so the film can end on the catch' }
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
