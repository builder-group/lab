import type { THostRecentProject } from '@/environment';
import type { specta } from '@/environment';
import { getCommand, isCommandEnabled, type TCommandId } from './commands';
import type { StudioCx, TStudioPanel } from './StudioCx';

// The macOS menu bar, laid out from the command registry so its titles, keys and states match the palette and
// the shortcuts. The host builds the menus from this layout (src-tauri/src/app/menu.rs) and sends the chosen item's
// id back; `native-menu.ts` connects the two.

/** An item of a menu: a command, a separator, an AppKit item, or File > Open Recent */
export type TMenuLine =
	| {
			command: TCommandId;
			/** Tells two items of one command apart, such as Quick Help in View and MidiMarble Help in Help */
			variant?: string;
			/** A title for the menu bar where the palette's would read wrong there */
			title?: string;
			/** Show Sidebar and Hide Sidebar instead of a check mark, as macOS names panel toggles */
			panel?: TStudioPanel;
			/** Leaves the key out of the menu, such as for the second item of a command */
			hasNoKey?: boolean;
			/**
			 * Shows a window key in the title, after a tab. It is no menu key: single keys stay with the web view, so
			 * typing in a text field never runs a menu command.
			 */
			showsKey?: boolean;
			/** In a focused text field the item acts on the text, as AppKit's own Undo, Redo and Select All do */
			text?: TTextCommand;
	  }
	| 'separator'
	| { standard: specta.StandardMenuItem }
	| 'recent';

export type TTextCommand = 'undo' | 'redo' | 'selectAll';

export interface TMenuSection {
	title: string;
	role?: specta.MenuRole;
	items: TMenuLine[];
}

export interface TMenuItemState {
	title: string;
	enabled: boolean;
	/** Null for an item without a check mark */
	checked: boolean | null;
}

export const menuLayout: readonly TMenuSection[] = [
	{
		title: 'File',
		items: [
			{ command: 'file.new' },
			{ command: 'file.open' },
			'recent',
			'separator',
			{ command: 'file.close' },
			{ command: 'file.save' },
			{ command: 'file.saveAs' },
			'separator',
			{ command: 'file.importMidi' },
			{ command: 'file.replaceSong' },
			{ command: 'file.removeSong' },
			'separator',
			{ command: 'file.export' }
		]
	},
	{
		title: 'Edit',
		items: [
			{ command: 'edit.undo', text: 'undo' },
			{ command: 'edit.redo', text: 'redo' },
			'separator',
			{ standard: 'cut' },
			{ standard: 'copy' },
			{ standard: 'paste' },
			{ command: 'edit.duplicate' },
			// ⌫ stays with the web view, where it also edits text, so the item shows no key
			{ command: 'edit.delete', hasNoKey: true },
			{ command: 'edit.selectAll', title: 'Select All', text: 'selectAll' },
			{ command: 'edit.deselect' },
			'separator',
			{ command: 'edit.rename' },
			{ command: 'edit.makeBacking', hasNoKey: true },
			{ command: 'edit.firstProblem' }
		]
	},
	{
		title: 'View',
		items: [
			{ command: 'view.compose' },
			{ command: 'view.design' },
			'separator',
			{ command: 'view.sidebar', panel: 'sidebar' },
			{ command: 'view.inspector', panel: 'inspector' },
			{ command: 'view.timeline', panel: 'timeline' },
			{ command: 'view.agent', panel: 'agent' },
			'separator',
			{ command: 'view.zoomIn' },
			{ command: 'view.zoomOut' },
			{ command: 'view.zoom100' },
			{ command: 'view.fitAll' },
			{ command: 'view.fitWhole' },
			{ command: 'view.fitSelection' },
			{ command: 'view.fitFrame' },
			'separator',
			{ command: 'view.snap' },
			{ command: 'view.showHitboxes' },
			{ command: 'view.follow' },
			{ command: 'help.quickHelp', hasNoKey: true },
			'separator',
			{ standard: 'fullScreen' }
		]
	},
	{
		title: 'Playback',
		items: [
			{ command: 'play.toggle', showsKey: true },
			{ command: 'play.start', showsKey: true },
			'separator',
			{ command: 'play.previousHit', showsKey: true },
			{ command: 'play.nextHit', showsKey: true },
			'separator',
			{ command: 'play.cycle', showsKey: true }
		]
	},
	{
		title: 'Piece',
		items: [
			{ command: 'build.next', showsKey: true },
			{ command: 'build.continue', showsKey: true },
			{ command: 'build.mirror', showsKey: true },
			{ command: 'build.repeat', showsKey: true },
			{ command: 'build.addFinish' },
			'separator',
			// Edit's Duplicate holds the ⌘D menu key
			{ command: 'edit.duplicate', variant: 'piece', hasNoKey: true, showsKey: true },
			{ command: 'piece.detach' }
		]
	},
	{
		title: 'Window',
		role: 'window',
		items: [{ standard: 'minimize' }, { standard: 'zoom' }, 'separator', { standard: 'bringAllToFront' }]
	},
	{
		title: 'Help',
		role: 'help',
		items: [{ command: 'help.quickHelp', variant: 'help', title: 'MidiMarble Help' }, { command: 'help.resetHints' }]
	}
];

const RECENT_PREFIX = 'recent:';
const CLEAR_RECENT_ID = 'recent.clear';

export type TMenuItemId = { kind: 'command'; commandId: TCommandId } | { kind: 'recent'; path: string } | { kind: 'clearRecent' };

type TCommandLine = Extract<TMenuLine, { command: TCommandId }>;

export function isCommandLine(line: TMenuLine): line is TCommandLine {
	return typeof line === 'object' && 'command' in line;
}

/** The host's id of a command item: the command id, with `#variant` for a second item of the same command */
export function menuItemId(line: TCommandLine): string {
	return line.variant != null ? `${line.command}#${line.variant}` : line.command;
}

export function parseMenuItemId(id: string): TMenuItemId {
	if (id === CLEAR_RECENT_ID) return { kind: 'clearRecent' };
	if (id.startsWith(RECENT_PREFIX)) return { kind: 'recent', path: id.slice(RECENT_PREFIX.length) };
	return { kind: 'command', commandId: id.split('#')[0] as TCommandId };
}

/** The command item a host id names, to route text commands */
export function findCommandLine(id: string, layout: readonly TMenuSection[] = menuLayout): TCommandLine | null {
	for (const section of layout) {
		for (const line of section.items) {
			if (isCommandLine(line) && menuItemId(line) === id) return line;
		}
	}
	return null;
}

/**
 * The Tauri accelerator of a shortcut as the registry writes it ("⇧⌘S" → "CmdOrCtrl+Shift+S"). Only keys with ⌘
 * or ⌃ become menu keys: single keys such as F, ⇧1 or ⌫ stay with the web view, so typing in a text field never
 * runs a menu command.
 */
export function toAccelerator(shortcut: string | undefined): string | null {
	if (shortcut == null) return null;
	const modifiers: string[] = [];
	let rest = shortcut;
	for (;;) {
		const glyph = rest[0];
		const modifier = glyph != null ? modifierNames[glyph] : undefined;
		if (modifier == null) break;
		modifiers.push(modifier);
		rest = rest.slice(1);
	}
	if (!modifiers.includes('CmdOrCtrl') && !modifiers.includes('Ctrl')) return null;
	const key = keyNames[rest] ?? (/^[A-Z0-9]$/i.test(rest) ? rest.toUpperCase() : null);
	if (key == null) return null;
	// Tauri reads the modifiers in any order; this one matches its documentation
	const order = ['CmdOrCtrl', 'Ctrl', 'Alt', 'Shift'];
	return [...order.filter((name) => modifiers.includes(name)), key].join('+');
}

const modifierNames: Record<string, string> = { '⌘': 'CmdOrCtrl', '⌃': 'Ctrl', '⌥': 'Alt', '⇧': 'Shift' };

// ⌘+ is the = key, as in Safari and Finder; ⌘− is the minus key
const keyNames: Record<string, string> = { '+': '=', '=': '=', '−': '-', '-': '-', '/': '/', ',': ',', '.': '.', '⌫': 'Backspace' };

/** The title, enabled and checked state of a command item for the open project */
export function readMenuItem(cx: StudioCx, line: TCommandLine, isTextFocused: boolean): TMenuItemState {
	const command = getCommand(line.command);
	if (line.panel != null) {
		const isShown = cx.$panels.get()[line.panel];
		return { title: `${isShown ? 'Hide' : 'Show'} ${command.title}`, enabled: isCommandEnabled(cx, command), checked: null };
	}
	const title = line.title ?? (line.command === 'play.toggle' && cx.$playing.get() ? 'Pause' : command.title);
	return {
		title: line.showsKey === true && command.shortcut != null ? `${title}\t${command.shortcut}` : title,
		enabled: (line.text != null && isTextFocused) || isCommandEnabled(cx, command),
		checked: command.isChecked != null ? command.isChecked(cx) === true : null
	};
}

/** The menus after the app menu, for the host to build */
export function buildMenuBar(read: (line: TCommandLine) => TMenuItemState, recent: THostRecentProject[], layout: readonly TMenuSection[] = menuLayout): specta.MenuDto[] {
	return layout.map((section) => ({
		title: section.title,
		role: section.role ?? null,
		items: section.items.map((line): specta.MenuEntryDto => {
			if (line === 'separator') return { kind: 'separator' };
			if (line === 'recent') return recentMenu(recent);
			if (!isCommandLine(line)) return { kind: 'standard', item: line.standard };
			const state = read(line);
			return {
				kind: 'command',
				id: menuItemId(line),
				title: state.title,
				accelerator: line.hasNoKey === true ? null : toAccelerator(getCommand(line.command).shortcut),
				enabled: state.enabled,
				checked: state.checked
			};
		})
	}));
}

/** Open Recent ▸ with the recent projects, newest first, then Clear Menu, as in every macOS document app */
function recentMenu(recent: THostRecentProject[]): specta.MenuEntryDto {
	const items: specta.MenuEntryDto[] = recent.map((project) => ({
		kind: 'command',
		id: `${RECENT_PREFIX}${project.path}`,
		title: project.name,
		accelerator: null,
		enabled: true,
		checked: null
	}));
	return {
		kind: 'submenu',
		title: 'Open Recent',
		enabled: true,
		items: [
			...items,
			...(items.length > 0 ? [{ kind: 'separator' } as const] : []),
			{ kind: 'command', id: CLEAR_RECENT_ID, title: 'Clear Menu', accelerator: null, enabled: items.length > 0, checked: null }
		]
	};
}

/** Every command item's state, keyed by its host id */
export function menuItemStates(read: (line: TCommandLine) => TMenuItemState, layout: readonly TMenuSection[] = menuLayout): Map<string, TMenuItemState> {
	const states = new Map<string, TMenuItemState>();
	for (const section of layout) {
		for (const line of section.items) {
			if (isCommandLine(line)) states.set(menuItemId(line), read(line));
		}
	}
	return states;
}

/** The items whose state differs from what the host shows */
export function changedMenuItems(previous: Map<string, TMenuItemState>, next: Map<string, TMenuItemState>): specta.MenuItemStateDto[] {
	const changes: specta.MenuItemStateDto[] = [];
	for (const [id, state] of next) {
		const before = previous.get(id);
		if (before != null && before.title === state.title && before.enabled === state.enabled && before.checked === state.checked) continue;
		changes.push({ id, title: state.title, enabled: state.enabled, checked: state.checked });
	}
	return changes;
}
