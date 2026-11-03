import type { TProjectHistory } from '@/modules/project';

/**
 * Whether an unsaved document, such as an opened example, differs from how it opened, like the Edited state of an
 * untitled macOS document. Undoing every edit returns it to unchanged. Examples open at revision 0, so a document
 * restored after a reload with a later revision has changes even without history.
 */
export function hasUnsavedChanges(history: TProjectHistory, openedRevision = 0): boolean {
	if (history.past.length > 0) return true;
	// With an empty past the present is the opened state, unless an amended edit or a restored autosave changed it
	return !history.future.length && history.present.revision !== openedRevision;
}

/** The close question of an unsaved document with changes, in macOS wording */
export function saveChangesQuestion(title: string): string {
	return `Save changes to ${title}?`;
}
