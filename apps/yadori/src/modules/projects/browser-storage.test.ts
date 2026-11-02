import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPart, createProject, executeCommands } from '../project/model';
import { listBrowserProjects, openBrowserProject, saveBrowserProject } from './browser-storage';

const storage = new Map<string, string>();
const storageKey = 'yadori.next.projects';

beforeEach(() => {
	storage.clear();
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value)
	});
});
afterEach(() => vi.unstubAllGlobals());

describe('browser project storage', () => {
	it('should replace one project while retaining other builds under the existing storage key', () => {
		const first = createProject('First build');
		const second = createProject('Second build');
		saveBrowserProject(first);
		saveBrowserProject(second);
		const edited = executeCommands(first, [{ type: 'part.add', part: createPart('Pump') }]);

		saveBrowserProject(edited);

		expect(listBrowserProjects()).toHaveLength(2);
		expect(JSON.parse(openBrowserProject(first.id).content)).toEqual(edited);
		expect(JSON.parse(openBrowserProject(second.id).content)).toEqual(second);
		expect(storage.size).toBe(1);
		expect(storage.has(storageKey)).toBe(true);
	});
	it('should preserve unrecognized capabilities through save and reopen', () => {
		const part = createPart('Future material', {
			capabilities: {
				plumbing: { $schema: 'custom/plumbing@1', diameterMm: 12, labels: ['inlet'] }
			}
		});
		const project = executeCommands(createProject(), [{ type: 'part.add', part }]);

		saveBrowserProject(project);

		expect(JSON.parse(openBrowserProject(project.id).content).parts[0].capabilities).toEqual(
			part.capabilities
		);
	});
	it('should leave corrupt saved data untouched when a write or open cannot validate it', () => {
		for (const content of ['not json', '{}', '[{"id":"broken"}]']) {
			storage.set(storageKey, content);

			expect(() => saveBrowserProject(createProject())).toThrow();
			expect(() => openBrowserProject('broken')).toThrow();
			expect(storage.get(storageKey)).toBe(content);
		}
	});
});
