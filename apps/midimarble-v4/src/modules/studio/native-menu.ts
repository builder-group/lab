import { isTauri } from '@tauri-apps/api/core';
import { specta } from '@/environment';
import { getCommand, isCommandEnabled } from './commands';
import { buildMenuBar, changedMenuItems, findCommandLine, menuItemStates, parseMenuItemId, readMenuItem, type TMenuItemState } from './menu-bar';
import type { StudioCx } from './StudioCx';

/**
 * Connects the macOS menu bar to the studio in the desktop app: sends the menus, runs the command of a chosen item
 * and keeps titles, enabled and checked states current. Returns the cleanup.
 *
 * Keys: WebKit hands a ⌘ key to the page before the menu bar. The studio's key handler runs a command and prevents
 * the default, so the menu does not run it again; a key the page leaves alone, such as ⌘S in a text field, reaches
 * the menu, which runs the same command. Undo, Redo and Select All then act on the focused text field's text.
 */
export function mountNativeMenu(cx: StudioCx): () => void {
	if (!isTauri()) return () => undefined;
	let isMounted = true;
	let shown = new Map<string, TMenuItemState>();
	let timer: ReturnType<typeof setTimeout> | undefined;

	const read = (line: Parameters<typeof readMenuItem>[1]): TMenuItemState => readMenuItem(cx, line, isTextFieldFocused());

	let wasTextFocused = isTextFieldFocused();

	const sendBar = (): void => {
		const states = menuItemStates(read);
		shown = states;
		wasTextFocused = isTextFieldFocused();
		void specta.commands.menuSetBar(buildMenuBar(read, cx.$recent.get(), wasTextFocused));
	};

	// Copy and Paste are AppKit's while a text field has focus, and act on the selection otherwise
	const onFocusChange = (): void => {
		if (isTextFieldFocused() !== wasTextFocused) sendBar();
		else schedule();
	};

	const flush = (): void => {
		timer = undefined;
		if (!isMounted) return;
		const states = menuItemStates(read);
		const changes = changedMenuItems(shown, states);
		shown = states;
		if (changes.length > 0) void specta.commands.menuUpdateItems(changes);
	};

	// Many atoms change together after one edit; one update covers them
	const schedule = (): void => {
		if (timer == null) timer = setTimeout(flush, 30);
	};

	const run = (id: string): void => {
		const item = parseMenuItemId(id);
		if (item.kind === 'clearRecent') {
			void cx.clearRecent();
			return;
		}
		if (item.kind === 'recent') {
			void cx.openProject(item.path);
			return;
		}
		const line = findCommandLine(id);
		if (line?.text != null && isTextFieldFocused()) {
			document.execCommand(line.text);
			return;
		}
		const command = getCommand(item.commandId);
		if (isCommandEnabled(cx, command)) command.run(cx);
		// A check item toggles itself when chosen; the next update sets it from the command again
		shown.delete(id);
		schedule();
	};

	let stopEvent: (() => void) | null = null;
	void specta.events.menuCommandEvent
		.listen((event) => run(event.payload.id))
		.then((stop) => {
			if (isMounted) stopEvent = stop;
			else stop();
		});

	sendBar();

	// Track's tool and Follow live on the canvas, which comes and goes with the workspace
	let stopTrack: (() => void)[] = [];
	const watchTrack = (): void => {
		for (const stop of stopTrack) stop();
		const trackCx = cx.$trackCx.get();
		stopTrack = trackCx != null ? [trackCx.$tool.listen(schedule), trackCx.$follow.listen(schedule), trackCx.$pathType.listen(schedule), cx.assist.$ghosts.listen(schedule)] : [];
		schedule();
	};
	watchTrack();

	const stops = [
		cx.$recent.listen(sendBar),
		// Opening or saving a project adds it to Recent in the host
		cx.$path.listen(() => void cx.refreshRecent()),
		cx.$trackCx.listen(watchTrack),
		cx.$history.listen(schedule),
		cx.$selection.listen(schedule),
		cx.$clipboard.listen(schedule),
		cx.$playing.listen(schedule),
		cx.$repeatRange.listen(schedule),
		cx.$workspace.listen(schedule),
		cx.$panels.listen(schedule),
		cx.$quickHelp.listen(schedule),
		cx.$snapping.listen(schedule),
		cx.$showHitboxes.listen(schedule),
		cx.$audioScrubbing.listen(schedule),
		cx.$save.listen(schedule),
		cx.$isTemporary.listen(schedule),
		cx.film.$status.listen(schedule),
		cx.film.$camera.listen(schedule),
		cx.film.$placing.listen(schedule),
		cx.film.$links.listen(schedule)
	];
	// Undo, Redo and Select All are there for a focused text field
	document.addEventListener('focusin', onFocusChange);
	document.addEventListener('focusout', onFocusChange);

	return () => {
		isMounted = false;
		clearTimeout(timer);
		stopEvent?.();
		for (const stop of [...stops, ...stopTrack]) stop();
		document.removeEventListener('focusin', onFocusChange);
		document.removeEventListener('focusout', onFocusChange);
	};
}

function isTextFieldFocused(): boolean {
	const element = document.activeElement as HTMLElement | null;
	if (element == null) return false;
	if (element.isContentEditable || element.tagName === 'TEXTAREA') return true;
	return element.tagName === 'INPUT' && !nonTextInputTypes.has((element as HTMLInputElement).type);
}

const nonTextInputTypes = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file', 'image']);
