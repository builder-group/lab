import { describe, expect, it } from 'vitest';
import { createProject, type TProject } from '@/modules/project';
import { addShotCommands, removeShotsCommands, shotPresetDistance, sortShots, updateShotCommands } from './shots';
import { apply } from '@/modules/project/test-helpers';

function addShot(project: TProject, time: number, id: string): TProject {
	return apply(project, addShotCommands(project, time, id).commands);
}

describe('shot markers', () => {
	it('should add a push-in marker at 0.7 of the base distance', () => {
		const project = createProject({ title: 'Shots' });
		const next = addShot(project, 2.5, 'shot-a');
		expect(next.design.camera.shots).toEqual([{ id: 'shot-a', time: 2.5, kind: 'pushIn', distance: shotPresetDistance('pushIn', project.design.camera.distance) }]);
		expect(shotPresetDistance('pushIn', 1)).toBe(0.7);
	});

	it('should keep markers in time order when adding and moving', () => {
		// Prepare
		let project = createProject({ title: 'Shots' });
		project = addShot(project, 4, 'late');
		project = addShot(project, 1, 'early');

		// Act
		const moved = apply(project, updateShotCommands(project, 'early', { time: 6 }));

		// Assert
		expect(project.design.camera.shots.map((shot) => shot.id)).toEqual(['early', 'late']);
		expect(moved.design.camera.shots.map((shot) => shot.id)).toEqual(['late', 'early']);
	});

	it('should apply the kind preset distance when the kind changes', () => {
		let project = addShot(createProject({ title: 'Shots' }), 1, 'shot');
		project = apply(project, updateShotCommands(project, 'shot', { distance: 0.2 }));
		const wide = apply(project, updateShotCommands(project, 'shot', { kind: 'wide' }));
		expect(wide.design.camera.shots[0]).toMatchObject({ kind: 'wide', distance: shotPresetDistance('wide', project.design.camera.distance) });
		expect(shotPresetDistance('closeUp', 1)).toBe(0.45);
	});

	it('should remove only the given markers and skip unknown ones', () => {
		let project = createProject({ title: 'Shots' });
		project = addShot(project, 1, 'a');
		project = addShot(project, 2, 'b');
		expect(apply(project, removeShotsCommands(project, ['a'])).design.camera.shots.map((shot) => shot.id)).toEqual(['b']);
		expect(removeShotsCommands(project, ['missing'])).toEqual([]);
		expect(updateShotCommands(project, 'missing', { time: 3 })).toEqual([]);
	});

	it('should sort shots by time and clamp negative times to zero', () => {
		const shots = [
			{ id: 'b', time: 2, kind: 'wide' as const, distance: 1 },
			{ id: 'a', time: 1, kind: 'wide' as const, distance: 1 }
		];
		expect(sortShots(shots).map((shot) => shot.id)).toEqual(['a', 'b']);
		const project = addShot(createProject({ title: 'Shots' }), -1, 'zero');
		expect(project.design.camera.shots[0]?.time).toBe(0);
	});
});
