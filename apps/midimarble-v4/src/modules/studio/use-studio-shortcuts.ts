import React from 'react';
import type { TStudioPanel } from './Studio';
import { deleteSelectedHits } from './Timeline';
import type { StudioCx } from './StudioCx';

/** Standard macOS and Logic-style shortcuts that apply anywhere in the studio */
export function useStudioShortcuts(cx: StudioCx, togglePanel: (panel: TStudioPanel) => void): void {
	React.useEffect(() => {
		function onKeyDown(event: KeyboardEvent): void {
			// The canvas handles its keys first and marks them, such as arrows while a piece is selected
			if (isTyping(event) || event.defaultPrevented) return;
			const command = event.metaKey;
			const key = event.key.toLowerCase();

			if (command && key === 'z') {
				event.preventDefault();
				if (event.shiftKey) cx.redo();
				else cx.undo();
				return;
			}
			if (command && key === 's') {
				event.preventDefault();
				void cx.flush();
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
					togglePanel(panel);
				}
				return;
			}
			if (command || event.altKey || event.ctrlKey) return;
			if (event.key === ' ') {
				event.preventDefault();
				cx.$playing.set(!cx.$playing.get());
				return;
			}
			if (event.key === 'Enter' && !cx.$playing.get() && !cx.$selection.get().length) {
				cx.$playhead.set(0);
				return;
			}
			if (event.key === 'Backspace' || event.key === 'Delete') {
				if (deleteSelectedHits(cx)) event.preventDefault();
				return;
			}
			if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
				const times = (cx.project?.music.lanes ?? []).flatMap((lane) => lane.hits.map((hit) => hit.time)).sort((a, b) => a - b);
				const now = cx.$playhead.get();
				const next =
					event.key === 'ArrowRight'
						? times.find((time) => time > now + 1e-4)
						: [...times].reverse().find((time) => time < now - 1e-4);
				if (next != null) {
					event.preventDefault();
					cx.$playhead.set(next);
				}
				return;
			}
			if (key === 't') {
				event.preventDefault();
				cx.tapHit();
			}
		}
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [cx, togglePanel]);
}

const panelKeys: Record<string, TStudioPanel> = { s: 'sidebar', i: 'inspector', t: 'timeline' };

function isTyping(event: KeyboardEvent): boolean {
	const target = event.target as HTMLElement | null;
	return (
		target != null &&
		(target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
	);
}
