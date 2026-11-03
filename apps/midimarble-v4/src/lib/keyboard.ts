/**
 * True when a key press belongs to a text field, an open menu or a dialog, so canvas and studio
 * shortcuts leave it alone
 */
export function isEditingTarget(event: KeyboardEvent): boolean {
	const target = event.target as HTMLElement | null;
	if (target == null || typeof target.closest !== 'function') return false;
	return (
		target.tagName === 'INPUT' ||
		target.tagName === 'TEXTAREA' ||
		target.tagName === 'SELECT' ||
		target.isContentEditable ||
		target.closest('[role="menu"], [role="dialog"]') != null
	);
}

/**
 * True when a key press goes to a field that takes typed text, or to an open menu or dialog. Undo and redo
 * pass through checkboxes, selects and segmented controls, like AppKit's responder chain, and stop only here,
 * where the field keeps its own text undo.
 */
export function isTextEntryTarget(event: KeyboardEvent): boolean {
	const target = event.target as HTMLElement | null;
	if (target == null || typeof target.closest !== 'function') return false;
	if (target.closest('[role="menu"], [role="dialog"]') != null || target.isContentEditable || target.tagName === 'TEXTAREA') return true;
	if (target.tagName !== 'INPUT') return false;
	return !nonTextInputTypes.has((target as HTMLInputElement).type);
}

const nonTextInputTypes = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file', 'image']);
