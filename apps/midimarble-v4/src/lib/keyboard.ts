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
