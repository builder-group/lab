import { describe, expect, it } from 'vitest';
import { applyProjectCommands, createProject } from '@/modules/project';
import { createImportCommands, IMPORT_RELEASE_LEAD } from './lane-commands';
import type { TMidiNote } from './midi';

function note(time: number, pitch: number): TMidiNote {
	return { time, pitch, duration: 0.2, velocity: 0.8 };
}

describe('createImportCommands', () => {
	it('releases each marble a short lead before its first note', () => {
		const project = createProject({ id: 'import', title: 'Import' });
		const commands = createImportCommands(project, { lanes: [[note(2, 60), note(2.5, 62)], [note(0.1, 48)]] });
		const [isApplied, applyErr, next] = applyProjectCommands(project, commands);
		if (!isApplied) throw applyErr;
		const releases = next.entities.map((entity) => entity.components.release?.time).filter((time) => time != null);

		expect(releases).toHaveLength(2);
		expect(releases[0]).toBeCloseTo(2 - IMPORT_RELEASE_LEAD, 6);
		// A note earlier than the lead keeps the release at the start
		expect(releases[1]).toBe(0);
	});
});
