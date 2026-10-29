import { describe, expect, it } from 'vitest';
import { parseProjectFile, serializeProjectFile } from './project-file';
import { createStudioProject } from './studio-project';

describe('createStudioProject function', () => {
	it('should start independent projects with an empty score and a fixed wall', () => {
		const first = createStudioProject('wall');
		const second = createStudioProject('wall');
		expect(first.id).not.toBe(second.id);
		expect(first.notes).toEqual([]);
		expect(first.objects).toEqual([]);
		expect(first.scene?.wallPosition).toBe(0);
		expect(parseProjectFile(serializeProjectFile(first))).toEqual(first);
	});
	it('should give a duet two marble voices and an empty scene no predefined tracks', () => {
		const duet = createStudioProject('duet');
		expect(duet.marbles).toHaveLength(1);
		expect(duet.tracks).toHaveLength(2);
		expect(duet.marbles?.[0]?.launch.position[2]).toBe(duet.launch.position[2]);
		expect(duet.camera?.followMarbles).toBe(true);
		expect(parseProjectFile(serializeProjectFile(duet))).toEqual(duet);
		expect(createStudioProject('empty').tracks).toEqual([]);
	});
});
