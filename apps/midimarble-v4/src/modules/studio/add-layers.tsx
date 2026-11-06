import { Plus } from 'lucide-react';
import React from 'react';
import { openContextMenu, type TMenuItem } from '@/components';
import { commandItem, type TCommandId } from './commands';
import type { StudioCx, TWorkspace } from './StudioCx';

type TAddPlace = 'layers' | 'timeline';

/** What a + beside a Layers heading adds, by workspace and place: Logic's + above its tracks and Blender's add in the Outliner */
const ADD_ROWS: readonly { command: TCommandId; title: string; workspaces: readonly TWorkspace[]; places: readonly TAddPlace[] }[] = [
	{ command: 'file.importMidi', title: 'Song…', workspaces: ['track', 'film'], places: ['layers', 'timeline'] },
	{ command: 'marble.add', title: 'Marble', workspaces: ['track'], places: ['layers', 'timeline'] },
	{ command: 'camera.addShot', title: 'Shot', workspaces: ['track', 'film'], places: ['layers', 'timeline'] },
	{ command: 'film.addText', title: 'Title', workspaces: ['film'], places: ['layers', 'timeline'] },
	{ command: 'light.add', title: 'Light', workspaces: ['film'], places: ['layers'] },
	{ command: 'decor.add', title: 'Decor…', workspaces: ['film'], places: ['layers'] }
];

export function addLayerRows(workspace: TWorkspace, place: TAddPlace): readonly (typeof ADD_ROWS)[number][] {
	return ADD_ROWS.filter((row) => row.workspaces.includes(workspace) && row.places.includes(place));
}

function addLayerItems(cx: StudioCx, workspace: TWorkspace, place: TAddPlace): TMenuItem[] {
	return addLayerRows(workspace, place).map((row) => ({
		...commandItem(cx, row.command),
		label: row.title,
		// From a list a marble is added at once, as a new track is; the rail's Insert is what waits for a click on the wall
		...(row.command === 'marble.add' ? { checked: undefined, onSelect: () => cx.addMarble() } : {})
	}));
}

/** The small + beside a Layers heading */
export const AddLayerButton: React.FC<{ cx: StudioCx; workspace: TWorkspace; place: TAddPlace }> = (props) => {
	const { cx, workspace, place } = props;
	return (
		<button
			className="mm-icon-button !h-5 !w-5"
			onClick={(event) => openContextMenu(event, addLayerItems(cx, workspace, place))}
			title="Add a Layer"
			aria-label="Add a Layer"
			aria-haspopup="menu"
			type="button"
		>
			<Plus size={13} strokeWidth={1.75} />
		</button>
	);
};
