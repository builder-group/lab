import { describe, expect, it } from 'vitest';
import { getCommand } from './commands';
import { buildMenuBar, changedMenuItems, findCommandLine, isCommandLine, menuItemId, menuItemStates, menuLayout, parseMenuItemId, readMenuItem, toAccelerator } from './menu-bar';
import type { StudioCx } from './StudioCx';

describe('toAccelerator function', () => {
	it('should turn ⌘ and ⌃ shortcuts into Tauri accelerators', () => {
		expect(toAccelerator('⌘N')).toBe('CmdOrCtrl+N');
		expect(toAccelerator('⇧⌘S')).toBe('CmdOrCtrl+Shift+S');
		expect(toAccelerator('⌃⌘T')).toBe('CmdOrCtrl+Ctrl+T');
		expect(toAccelerator('⇧⌘/')).toBe('CmdOrCtrl+Shift+/');
		expect(toAccelerator('⌘1')).toBe('CmdOrCtrl+1');
	});

	it('should use the = and minus keys for zoom', () => {
		expect(toAccelerator('⌘+')).toBe('CmdOrCtrl+=');
		expect(toAccelerator('⌘−')).toBe('CmdOrCtrl+-');
	});

	it('should leave single keys to the web view', () => {
		expect(toAccelerator('F')).toBeNull();
		expect(toAccelerator('⇧1')).toBeNull();
		expect(toAccelerator('⌫')).toBeNull();
		expect(toAccelerator('Space')).toBeNull();
		expect(toAccelerator(undefined)).toBeNull();
	});
});

describe('menuLayout', () => {
	const lines = menuLayout.flatMap((section) => section.items).filter(isCommandLine);

	it('should name only registered commands, each item once', () => {
		const ids = lines.map(menuItemId);
		expect(new Set(ids).size).toBe(ids.length);
		for (const line of lines) expect(() => getCommand(line.command)).not.toThrow();
	});

	it('should give every ⌘ shortcut of a listed command a menu key', () => {
		for (const line of lines) {
			const shortcut = getCommand(line.command).shortcut;
			if (line.hasNoKey === true || shortcut == null || !/[⌘⌃]/.test(shortcut)) continue;
			expect(toAccelerator(shortcut), line.command).not.toBeNull();
		}
	});

	it('should list the Mac document commands in File', () => {
		const file = menuLayout.find((section) => section.title === 'File')?.items.filter(isCommandLine).map((line) => line.command);
		expect(file).toEqual(expect.arrayContaining(['file.new', 'file.open', 'file.close', 'file.save', 'file.saveAs', 'file.importMidi', 'file.export']));
	});
});

describe('menu item ids', () => {
	it('should read commands, variants and recent projects back', () => {
		expect(parseMenuItemId('file.save')).toEqual({ kind: 'command', commandId: 'file.save' });
		expect(parseMenuItemId('help.quickHelp#help')).toEqual({ kind: 'command', commandId: 'help.quickHelp' });
		expect(parseMenuItemId('recent:/Users/a/Song.marble')).toEqual({ kind: 'recent', path: '/Users/a/Song.marble' });
		expect(parseMenuItemId('recent.clear')).toEqual({ kind: 'clearRecent' });
	});

	it('should find the text command of Undo', () => {
		expect(findCommandLine('edit.undo')?.text).toBe('undo');
		expect(findCommandLine('help.quickHelp')?.title).toBe('MidiMarble Help');
	});
});

describe('buildMenuBar function', () => {
	const read = () => ({ title: 'Item', enabled: true, checked: null });

	it('should list recent projects with Clear Menu in Open Recent', () => {
		const menus = buildMenuBar(read, [{ path: '/a/Song.marble', name: 'Song', openedAt: 1 }]);
		const recent = menus[0]?.items.find((item) => item.kind === 'submenu');
		expect(recent?.kind === 'submenu' ? recent.items.map((item) => (item.kind === 'command' ? item.title : item.kind)) : null).toEqual(['Song', 'separator', 'Clear Menu']);
	});

	it('should dim Clear Menu without recent projects', () => {
		const recent = buildMenuBar(read, [])[0]?.items.find((item) => item.kind === 'submenu');
		const clear = recent?.kind === 'submenu' ? recent.items[0] : null;
		expect(clear?.kind === 'command' ? clear.enabled : null).toBe(false);
	});

	it('should give Save its key and mark the Window and Help menus', () => {
		const menus = buildMenuBar(read, []);
		const save = menus[0]?.items.find((item) => item.kind === 'command' && item.id === 'file.save');
		expect(save?.kind === 'command' ? save.accelerator : null).toBe('CmdOrCtrl+S');
		expect(menus.map((menu) => menu.role)).toEqual([null, null, null, null, null, null, 'window', 'help']);
	});
});

describe('changedMenuItems function', () => {
	it('should send only items whose state changed', () => {
		const before = menuItemStates(() => ({ title: 'A', enabled: true, checked: null }));
		const after = new Map(before);
		after.set('file.save', { title: 'Save', enabled: false, checked: null });
		expect(changedMenuItems(before, after)).toEqual([{ id: 'file.save', title: 'Save', enabled: false, checked: null }]);
	});
});

describe('Playback and Piece menus', () => {
	const section = (title: string): string[] => menuLayout.find((item) => item.title === title)?.items.filter(isCommandLine).map((line) => line.command) ?? [];

	it('should sit between View and Window', () => {
		expect(menuLayout.map((item) => item.title)).toEqual(['File', 'Edit', 'Insert', 'View', 'Playback', 'Track', 'Window', 'Help']);
	});

	it('should list the transport and the piece assists', () => {
		expect(section('Playback')).toEqual(['play.toggle', 'play.start', 'play.previousHit', 'play.nextHit', 'play.repeat']);
		expect(section('Track')).toEqual(['build.next', 'build.track', 'build.rebuildFrom', 'build.continue', 'build.mirror', 'build.repeat', 'build.placeAgain', 'build.addFinish', 'piece.detach']);
	});

	it('should show single keys in the title and never as menu keys, and name Pause while playing', () => {
		const line = { command: 'play.toggle' } as const;
		const shown = { ...line, showsKey: true };
		const cx = (isPlaying: boolean): StudioCx => ({ $playing: { get: () => isPlaying }, project: {} }) as unknown as StudioCx;
		expect(readMenuItem(cx(false), shown, false).title).toBe('Play\tSpace');
		expect(readMenuItem(cx(true), shown, false).title).toBe('Pause\tSpace');
		const menus = buildMenuBar(() => ({ title: 'x', enabled: true, checked: null }), []);
		const items = menus.find((menu) => menu.title === 'Playback')?.items ?? [];
		expect(items.some((item) => item.kind === 'command')).toBe(true);
		for (const item of items) if (item.kind === 'command') expect(item.accelerator).toBeNull();
	});

	it('should keep ⌘D on Edit and ⌘0 on View', () => {
		const menus = buildMenuBar(() => ({ title: 'x', enabled: true, checked: null }), []);
		const commandItems = menus.flatMap((menu) => menu.items).flatMap((item) => (item.kind === 'command' ? [item] : []));
		expect(commandItems.filter((item) => item.accelerator === 'CmdOrCtrl+D').map((item) => item.id)).toEqual(['edit.duplicate']);
		expect(commandItems.find((item) => item.id === 'view.zoom100')?.accelerator).toBe('CmdOrCtrl+0');
		expect(commandItems.some((item) => item.id === 'view.fitWhole')).toBe(true);
	});
});
