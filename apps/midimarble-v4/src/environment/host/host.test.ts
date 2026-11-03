import { beforeEach, describe, expect, it } from 'vitest';
import { host } from './index';

// The browser development surface keeps packages in localStorage, which Node lacks
function stubStorage(): void {
	const items = new Map<string, string>();
	globalThis.localStorage = {
		getItem: (key: string) => items.get(key) ?? null,
		setItem: (key: string, value: string) => void items.set(key, value),
		removeItem: (key: string) => void items.delete(key),
		clear: () => items.clear(),
		key: (index: number) => [...items.keys()][index] ?? null,
		get length() {
			return items.size;
		}
	};
}

describe('unsaved projects on the browser host', () => {
	beforeEach(() => {
		stubStorage();
	});

	it('should keep an opened example out of Recent and replace the previous one', async () => {
		// Act
		const [, , first] = await host.createTemporaryProject('Jingle Bells', '{}');
		const [, , second] = await host.createTemporaryProject('Jingle Bells', '{}');

		// Assert
		expect(first?.path).toBe('/unsaved/Jingle Bells.marble');
		expect(second?.path).toBe('/unsaved/Jingle Bells.marble');
		expect(await host.isTemporaryProject(second?.path ?? '')).toBe(true);
		expect(await host.listRecentProjects()).toEqual([]);
	});

	it('should move a saved example with its files into Recent', async () => {
		// Prepare
		const [, , created] = await host.createTemporaryProject('Jingle Bells', '{"a":1}');
		const from = created?.path ?? '';
		await host.addPackageFile(from, 'audio/jingle-bells.mid', '/fixtures/jingle-bells.mid');

		// Act
		const [isMovedOk, , path] = await host.moveProject(from, '/browser/Jingle Bells.marble');

		// Assert
		expect(isMovedOk).toBe(true);
		expect(path).toBe('/browser/Jingle Bells.marble');
		expect(await host.isTemporaryProject(path ?? '')).toBe(false);
		expect((await host.listRecentProjects()).map((item) => item.name)).toEqual(['Jingle Bells']);
		expect(host.sourceUrl(path ?? '', 'audio/jingle-bells.mid')).toBe('/fixtures/jingle-bells.mid');
		expect(host.sourceUrl(from, 'audio/jingle-bells.mid')).toBeNull();
		const [isOldOpenOk] = await host.openProject(from);
		expect(isOldOpenOk).toBe(false);
	});

	it('should give a moved package a free name next to an existing one', async () => {
		// Prepare
		await host.createProject('/browser/Jingle Bells.marble', '{}');
		const [, , created] = await host.createTemporaryProject('Jingle Bells', '{}');

		// Act
		const [, , path] = await host.moveProject(created?.path ?? '', '/browser/Jingle Bells.marble');

		// Assert
		expect(path).toBe('/browser/Jingle Bells 2.marble');
	});

	it('should forget a discarded example', async () => {
		// Prepare
		const [, , created] = await host.createTemporaryProject('Zigzag', '{}');

		// Act
		host.discardTemporaryProject(created?.path ?? '');

		// Assert
		const [isOpenOk] = await host.openProject(created?.path ?? '');
		expect(isOpenOk).toBe(false);
	});
});
