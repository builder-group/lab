import React from 'react';
import type { TStudioPanel } from './Studio';
import type { StudioCx } from './StudioCx';

/** Standard macOS and Logic-style shortcuts that apply anywhere in the studio */
export function useStudioShortcuts(cx: StudioCx, togglePanel: (panel: TStudioPanel) => void): void {
	React.useEffect(() => {
		function onKeyDown(event: KeyboardEvent): void {
			if (isTyping(event)) return;
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
