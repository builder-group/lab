import React from 'react';
import { isEditingTarget } from '@/lib';
import { deleteSelectedHits, getCommand, isCommandEnabled } from './commands';
import type { StudioCx, TStudioPanel } from './StudioCx';

/** Standard macOS and Logic-style shortcuts that apply anywhere in the studio */
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
			// The canvas handles its keys first and marks them, such as arrows while a piece is selected
			if (isEditingTarget(event) || event.defaultPrevented) return;

			if (command && key === 'z') {
				event.preventDefault();
				if (event.shiftKey) cx.redo();
				else cx.undo();
				return;
			}
			const shortcut = command && !event.ctrlKey && !event.shiftKey ? commandKeys[key] : undefined;
			if (shortcut != null) {
				const target = getCommand(shortcut);
				if (isCommandEnabled(cx, target)) {
					event.preventDefault();
					target.run(cx);
				}
				return;
			}
			if (command && !event.ctrlKey && key === 'i') {
				event.preventDefault();
				void (event.shiftKey ? cx.sources.pickAudio() : cx.sources.pickMidi());
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
			if (event.key === ' ') {
				event.preventDefault();
				cx.$playing.set(!cx.$playing.get());
				return;
			}
			if ((event.key === 'Enter' || event.key === 'Home') && !cx.$playing.get() && !cx.$selection.get().length) {
				cx.$playhead.set(0);
				return;
			}
			if (event.key === 'Backspace' || event.key === 'Delete') {
				if (deleteSelectedHits(cx)) event.preventDefault();
				return;
			}
			if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
				if (cx.stepHit(event.key === 'ArrowRight' ? 1 : -1)) event.preventDefault();
				return;
			}
			if (key === 't') {
				event.preventDefault();
				cx.tapHit();
			}
		}
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [cx]);
}

const panelKeys: Record<string, TStudioPanel> = { s: 'sidebar', i: 'inspector', t: 'timeline' };

// ⌘ shortcuts that run a command directly; the ⌃⌘ panel toggles and ⌘1 and ⌘2 are handled above
const commandKeys: Record<string, 'file.new' | 'file.open' | 'file.save' | 'file.export' | 'edit.selectAll' | 'view.agent' | undefined> = {
	e: 'file.export',
	j: 'view.agent',
	n: 'file.new',
	o: 'file.open',
	s: 'file.save',
	a: 'edit.selectAll'
};
