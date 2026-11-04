import { describe, expect, it } from 'vitest';
import { tidyMenu } from '@/components';
import { toolKeys } from '@/modules/compose/keys';
import { commands } from './commands';

describe('commands', () => {
	it('should give every command a unique id and title within its section', () => {
		const ids = commands.map((command) => command.id);
		const titles = commands.map((command) => `${command.section}:${command.title}`);
		expect(new Set(ids).size).toBe(ids.length);
		expect(new Set(titles).size).toBe(titles.length);
	});

	it('should show the same keys for tools as the Compose key map', () => {
		for (const tool of toolKeys) {
			expect(commands.find((command) => command.id === (tool.tool === 'marble' ? 'marble.add' : `tool.${tool.tool}`))?.shortcut).toBe(tool.key);
		}
	});
});

describe('tidyMenu function', () => {
	it('should drop leading, trailing and doubled separators and skipped entries', () => {
		const item = { label: 'Pin', onSelect: () => undefined };
		expect(tidyMenu(['separator', null, item, 'separator', false, 'separator', item, 'separator'])).toEqual([item, 'separator', item]);
	});
});
