import { describe, expect, it } from 'vitest';
import { tidyMenu } from '@/components';
import { toolKeys } from '@/modules/compose/keys';
import { createProject } from '@/modules/project';
import { commands } from './commands';
import { audibleProject, isLaneAudible } from './StudioCx';

describe('commands', () => {
	it('should give every command a unique id and title within its section', () => {
		const ids = commands.map((command) => command.id);
		// A hidden command only keeps an old id working for menus, so it may share its title
		const titles = commands.filter((command) => command.isHidden !== true).map((command) => `${command.section}:${command.title}`);
		expect(new Set(ids).size).toBe(ids.length);
		expect(new Set(titles).size).toBe(titles.length);
	});

	it('should show the same keys for tools as the Compose key map', () => {
		for (const tool of toolKeys) {
			expect(commands.find((command) => command.id === `tool.${tool.tool}`)?.shortcut).toBe(tool.key);
		}
	});
});

describe('tidyMenu function', () => {
	it('should drop leading, trailing and doubled separators and skipped entries', () => {
		const item = { label: 'Pin', onSelect: () => undefined };
		expect(tidyMenu(['separator', null, item, 'separator', false, 'separator', item, 'separator'])).toEqual([item, 'separator', item]);
	});
});

describe('lane mix', () => {
	it('should let soloed lanes win over muted ones', () => {
		expect(isLaneAudible({ muted: ['a'], solo: [] }, 'a')).toBe(false);
		expect(isLaneAudible({ muted: ['a'], solo: ['a'] }, 'a')).toBe(true);
		expect(isLaneAudible({ muted: [], solo: ['a'] }, 'b')).toBe(false);
	});

	it('should leave out silent lanes from the project that is played', () => {
		const project = createProject({ title: 'Mix' });
		const laneId = project.music.lanes[0]?.id ?? '';
		expect(audibleProject(project, { muted: [], solo: [] })).toBe(project);
		expect(audibleProject(project, { muted: [laneId], solo: [] }).music.lanes).toHaveLength(0);
	});
});
