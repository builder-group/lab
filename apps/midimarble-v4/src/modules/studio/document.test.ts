import { describe, expect, it } from 'vitest';
import { createHistory, createProject, pushHistory, redoHistory, undoHistory } from '@/modules/project';
import { hasUnsavedChanges, saveChangesQuestion, savePanelTitle } from './document';

describe('hasUnsavedChanges function', () => {
	const opened = createProject({ title: 'Jingle Bells' });

	it('should report an example that just opened as unchanged', () => {
		expect(hasUnsavedChanges(createHistory(opened))).toBe(false);
	});

	it('should report an edit and clear it again once every edit is undone', () => {
		// Prepare
		const edited = pushHistory(createHistory(opened), { ...opened, title: 'Bells', revision: 1 });

		// Act
		const undone = undoHistory(edited);

		// Assert
		expect(hasUnsavedChanges(edited)).toBe(true);
		expect(hasUnsavedChanges(undone)).toBe(false);
		expect(hasUnsavedChanges(redoHistory(undone))).toBe(true);
	});

	it('should report a restored example with autosaved edits as changed', () => {
		expect(hasUnsavedChanges(createHistory({ ...opened, revision: 4 }))).toBe(true);
	});
});

describe('saveChangesQuestion function', () => {
	it('should name the document like the macOS close alert', () => {
		expect(saveChangesQuestion('Jingle Bells')).toBe('Save changes to Jingle Bells?');
	});
});

describe('savePanelTitle function', () => {
	it('should name the document like a macOS save panel', () => {
		expect(savePanelTitle('Jingle Bells')).toBe('Save Jingle Bells');
	});
});
