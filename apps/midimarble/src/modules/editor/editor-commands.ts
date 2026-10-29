import { Hand, Link2, MousePointer2, Move3D, Rotate3D, Scaling } from 'lucide-react';
import { objectCatalog } from '../project';
import type { TEditorCommand } from './CommandPalette';

export const menuNames = ['File', 'Edit', 'Add', 'View', 'Help'] as const;

export const sceneTools = [
	{ id: 'select', label: 'Select', shortcut: 'V', Icon: MousePointer2 },
	{ id: 'move', label: 'Move', shortcut: 'G', Icon: Move3D },
	{ id: 'rotate', label: 'Rotate', shortcut: 'R', Icon: Rotate3D },
	{ id: 'scale', label: 'Scale', shortcut: 'S', Icon: Scaling },
	{ id: 'hand', label: 'Hand', shortcut: 'H', Icon: Hand },
	{ id: 'link', label: 'Link', shortcut: 'L', Icon: Link2 }
] as const;

export const editorCommands: TEditorCommand[] = [
	...sceneTools.map((tool) => ({
		id: `tool:${tool.id}`,
		label: `${tool.label} tool`,
		group: 'Tools',
		shortcut: tool.shortcut
	})),
	{ id: 'play', label: 'Play / pause', group: 'Playback', shortcut: 'Space' },
	{ id: 'frame-selected', label: 'Frame selected', group: 'View', shortcut: 'F' },
	{ id: 'frame-all', label: 'Frame all objects', group: 'View', shortcut: 'Home' },
	{ id: 'camera', label: 'Camera view', group: 'View', shortcut: 'Num 0' },
	{ id: 'orbit-selected', label: 'Toggle orbit around selection', group: 'View' },
	{ id: 'material', label: 'Material preview', group: 'Shading' },
	{ id: 'solid', label: 'Solid shading', group: 'Shading' },
	{ id: 'rendered', label: 'Rendered shading', group: 'Shading' },
	{ id: 'grid', label: 'Toggle grid', group: 'View' },
	{ id: 'path', label: 'Toggle trajectory', group: 'View' },
	{ id: 'link', label: 'Link object to MIDI note', group: 'Object', shortcut: 'L' },
	{ id: 'unlink', label: 'Unlink and keep world position', group: 'Object' },
	{ id: 'duplicate', label: 'Duplicate selected object', group: 'Object', shortcut: 'Shift D' },
	{ id: 'delete', label: 'Delete selection', group: 'Edit', shortcut: 'Delete' },
	{ id: 'undo', label: 'Undo', group: 'Edit', shortcut: '⌘Z' },
	{ id: 'redo', label: 'Redo', group: 'Edit', shortcut: '⇧⌘Z' },
	{ id: 'track', label: 'Add MIDI track', group: 'Music' },
	{ id: 'note', label: 'Add MIDI note at playhead', group: 'Music' },
	{ id: 'key-camera', label: 'Key current camera view', group: 'Camera' },
	{ id: 'key-lighting', label: 'Key current lighting', group: 'Lighting' },
	{ id: 'new', label: 'New project', group: 'File' },
	{ id: 'settings', label: 'Project settings', group: 'File' },
	{ id: 'projects', label: 'Projects and examples', group: 'File' },
	{ id: 'import', label: 'Open project', group: 'File' },
	{ id: 'import-midi', label: 'Import MIDI', group: 'File' },
	{ id: 'save', label: 'Download project', group: 'File', shortcut: '⌘S' },
	{ id: 'export', label: 'Export video', group: 'File' },
	{ id: 'help', label: 'Keyboard shortcuts and workflow', group: 'Help' },
	...objectCatalog.map((asset) => ({
		id: `add:${asset.id}`,
		label: `Add ${asset.label}`,
		group: 'Object Library'
	}))
];
