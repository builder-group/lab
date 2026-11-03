import { describe, expect, it } from 'vitest';
import { buildSceneDescription } from '@/modules/blender/scene-builder';
import { applyProjectCommands, createProject, type TProject } from '@/modules/project';
import { addWallTextCommands } from './design-commands';
import { titleClips, titleSpan, withTitleTime } from './titles';

const TEXT = { text: 'Fin', font: 'Bfont Regular', size: 0.03, depth: 0.002, color: '#1d1d1f' };

describe('title timing', () => {
	it('should default to the whole film', () => {
		expect(titleSpan(TEXT, 35)).toEqual({ start: 0, end: 35 });
	});

	it('should read typed In and Out times and drop the defaults', () => {
		const timed = withTitleTime(TEXT, 'in', '0:02.5', 35);
		expect(timed).toEqual({ ...TEXT, in: 2.5 });
		const closed = withTitleTime(timed ?? TEXT, 'out', '12', 35);
		expect(closed).toEqual({ ...TEXT, in: 2.5, out: 12 });
		expect(withTitleTime(closed ?? TEXT, 'in', '0:00', 35)).toEqual({ ...TEXT, out: 12 });
		expect(withTitleTime(closed ?? TEXT, 'out', '1:00', 35)).toEqual({ ...TEXT, in: 2.5 });
	});

	it('should reject text that is not a time or an Out before In', () => {
		const timed = { ...TEXT, in: 4 };
		expect(withTitleTime(timed, 'out', 'soon', 35)).toBeNull();
		expect(withTitleTime(timed, 'out', '0:03', 35)).toBeNull();
		expect(withTitleTime({ ...TEXT, out: 3 }, 'in', '5', 35)).toBeNull();
	});

	it('should list titles as clips by start and pass the times to the scene description', () => {
		// Prepare
		let project: TProject = createProject({ title: 'Titles' });
		const { commands, entityId } = addWallTextCommands({ x: 0, y: 0.2 }, 'Fin');
		const [isAddedOk, addedErr, added] = applyProjectCommands(project, commands);
		if (!isAddedOk) throw addedErr;
		const text = added.entities.find((entity) => entity.id === entityId)?.components.wallText ?? TEXT;
		const [isTimedOk, timedErr, timed] = applyProjectCommands(added, [
			{ type: 'setComponent', entityId, component: { name: 'wallText', value: { ...text, in: 1, out: 3 } } }
		]);
		if (!isTimedOk) throw timedErr;
		project = timed;

		// Act
		const clips = titleClips(project);
		const description = buildSceneDescription(project, { revision: 0, duration: project.end, marbles: [], pieces: [], hits: [], contacts: [] } as never, { fps: 30 }).description;

		// Assert
		expect(clips).toEqual([{ entityId, text: 'Fin', start: 1, end: 3 }]);
		expect(description.wallTexts).toEqual([expect.objectContaining({ id: entityId, in: 1, out: 3 })]);
	});
});
