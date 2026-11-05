import React from 'react';
import { isEditingTarget, isTextEntryTarget } from '@/lib';
import { deleteSelectedHits, getCommand, isCommandEnabled } from './commands';
import { CAMERA_KEY, parseDecorKey, parseLightKey, parseMadeInBlenderKey, SONG_KEY, WALL_KEY } from './selection';
import type { StudioCx, TStudioPanel } from './StudioCx';

/**
 * Standard macOS and Logic-style shortcuts that apply anywhere in the studio. In the desktop app WebKit gives the
 * page a ⌘ key before the menu bar: a key this handler runs a command for is prevented, so the menu bar does not
 * run it again, and a key it leaves alone (in a text field, or a disabled command) reaches the menu bar instead.
 */
export function useStudioShortcuts(cx: StudioCx): void {
	React.useEffect(() => {
		function onKeyDown(event: KeyboardEvent): void {
			const command = event.metaKey;
			const key = event.key.toLowerCase();

			// The palette also opens from a text field, like Spotlight
			if (command && !event.ctrlKey && !event.shiftKey && key === 'k') {
				event.preventDefault();
				cx.$paletteOpen.set(!cx.$paletteOpen.get());
				return;
			}
			// Undo and redo reach the project from a focused checkbox, select or segmented control; only text fields
			// keep ⌘Z for their own text
			if (command && !event.ctrlKey && !event.altKey && key === 'z' && !isTextEntryTarget(event) && !event.defaultPrevented) {
				event.preventDefault();
				if (event.shiftKey) cx.redo();
				else cx.undo();
				return;
			}
			// The canvas handles its keys first and marks them, such as arrows while a piece is selected
			if (isEditingTarget(event) || event.defaultPrevented) return;

			// ⇧⌘/ is ⌘? on US layouts, the macOS Help shortcut
			if (command && event.shiftKey && !event.ctrlKey && (event.code === 'Slash' || event.key === '?')) {
				event.preventDefault();
				getCommand('help.quickHelp').run(cx);
				return;
			}

			if (command && event.shiftKey && !event.ctrlKey && !event.altKey && key === 's') {
				event.preventDefault();
				const target = getCommand('file.saveAs');
				if (isCommandEnabled(cx, target)) target.run(cx);
				return;
			}
			if (command && event.shiftKey && !event.ctrlKey && !event.altKey && key === 'g') {
				event.preventDefault();
				const target = getCommand('edit.ungroup');
				if (isCommandEnabled(cx, target)) target.run(cx);
				return;
			}
			const shortcut = command && !event.ctrlKey && !event.shiftKey ? commandKeys[key] : undefined;
			if (shortcut != null) {
				const target = getCommand(shortcut);
				// ⌘S of a project that is already saved does nothing, rather than the browser's Save Page
				if (isCommandEnabled(cx, target) || shortcut === 'file.save') {
					event.preventDefault();
					if (isCommandEnabled(cx, target)) target.run(cx);
				}
				return;
			}
			if (command && !event.ctrlKey && (key === '1' || key === '2')) {
				event.preventDefault();
				cx.$workspace.set(key === '1' ? 'compose' : 'design');
				return;
			}
			if (command && event.ctrlKey) {
				const panel = panelKeys[key];
				if (panel != null) {
					event.preventDefault();
					cx.togglePanel(panel);
				}
				return;
			}
			if (command || event.altKey || event.ctrlKey) return;
			if (event.shiftKey && key === 'm') {
				const target = getCommand('camera.addShot');
				if (isCommandEnabled(cx, target)) {
					event.preventDefault();
					target.run(cx);
				}
				return;
			}
			if (event.key === 'F2') {
				event.preventDefault();
				const target = getCommand('edit.rename');
				if (isCommandEnabled(cx, target)) target.run(cx);
				return;
			}
			if (event.key === ' ') {
				event.preventDefault();
				cx.$playing.set(!cx.$playing.get());
				return;
			}
			// A selected Song, Camera, Wall or light layer keeps Return's meaning, like an empty selection
			const selection = cx.$selection.get();
			const isLayersOnly = selection.every((key) => key === SONG_KEY || key === CAMERA_KEY || key === WALL_KEY || parseLightKey(key) != null || parseDecorKey(key) != null || parseMadeInBlenderKey(key) != null);
			if ((event.key === 'Enter' || event.key === 'Home') && !cx.$playing.get() && isLayersOnly) {
				cx.$playhead.set(0);
				return;
			}
			if (event.key === 'Backspace' || event.key === 'Delete') {
				// The Song layer alone deletes the song file and Backing, asking first when Backing notes would go
				if (selection.length === 1 && selection[0] === SONG_KEY) {
					event.preventDefault();
					void cx.sources.deleteSong();
					return;
				}
				if (deleteSelectedHits(cx)) event.preventDefault();
				return;
			}
			if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
				if (cx.stepHit(event.key === 'ArrowRight' ? 1 : -1)) event.preventDefault();
				return;
			}
			if (key === 'c' && !event.shiftKey) {
				const target = getCommand('play.repeat');
				if (isCommandEnabled(cx, target)) {
					event.preventDefault();
					target.run(cx);
				}
				return;
			}
			if (key === 't') {
				event.preventDefault();
				// A held key repeats; each tap is one press
				if (!event.repeat) cx.tapHit();
			}
		}
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [cx]);
}

const panelKeys: Record<string, TStudioPanel> = { s: 'sidebar', i: 'inspector', t: 'timeline' };

// ⌘ shortcuts that run a command directly; the ⌃⌘ panel toggles and ⌘1 and ⌘2 are handled above
const commandKeys: Record<string, 'file.new' | 'file.open' | 'file.save' | 'file.importMidi' | 'file.export' | 'edit.selectAll' | 'edit.duplicate' | 'edit.group' | undefined> = {
	// ⌘D is Don't Save only while that alert is open; it takes the key first
	d: 'edit.duplicate',
	e: 'file.export',
	g: 'edit.group',
	i: 'file.importMidi',
	n: 'file.new',
	o: 'file.open',
	s: 'file.save',
	a: 'edit.selectAll'
};
