import { describe, expect, it } from 'vitest';
import { createProject, type TProject } from '@/modules/project';
import { addShotCommands, removeShotsCommands, shotPresetDistance, shotPresetOf, sortShots, updateShotCommands } from './shots';
import { apply } from '@/modules/project/test-helpers';

function addShot(project: TProject, time: number, id: string): TProject {
	return apply(project, addShotCommands(project, time, id).commands);
}

describe('shot markers', () => {
	it('should add a push-in marker at 0.7 of the base distance', () => {
		const project = createProject({ title: 'Shots' });
		const next = addShot(project, 2.5, 'shot-a');
		expect(next.film.camera.shots).toEqual([{ id: 'shot-a', time: 2.5, distance: shotPresetDistance(0.7, project.film.camera.distance), hold: 2 }]);
		expect(shotPresetDistance(0.7, 1)).toBe(0.7);
	});

	it('should keep markers in time order when adding and moving', () => {
		// Prepare
		let project = createProject({ title: 'Shots' });
		project = addShot(project, 4, 'late');
		project = addShot(project, 1, 'early');

		// Act
		const moved = apply(project, updateShotCommands(project, 'early', { time: 6 }));

		// Assert
		expect(project.film.camera.shots.map((shot) => shot.id)).toEqual(['early', 'late']);
		expect(moved.film.camera.shots.map((shot) => shot.id)).toEqual(['late', 'early']);
	});

	it('should name the preset a shot stands at, and none for a distance of its own', () => {
		const project = addShot(createProject({ title: 'Shots' }), 1, 'shot');
		const base = project.film.camera.distance;
		expect(shotPresetOf({ distance: shotPresetDistance(1.6, base) }, base)?.label).toBe('Wide');
		expect(shotPresetOf({ distance: shotPresetDistance(0.45, base) }, base)?.label).toBe('Close-Up');
		expect(shotPresetOf({ distance: 0.123 }, base)).toBeNull();
	});

	it('should remove only the given markers and skip unknown ones', () => {
		let project = createProject({ title: 'Shots' });
		project = addShot(project, 1, 'a');
		project = addShot(project, 2, 'b');
		expect(apply(project, removeShotsCommands(project, ['a'])).film.camera.shots.map((shot) => shot.id)).toEqual(['b']);
		expect(removeShotsCommands(project, ['missing'])).toEqual([]);
		expect(updateShotCommands(project, 'missing', { time: 3 })).toEqual([]);
	});

	it('should sort shots by time and clamp negative times to zero', () => {
		const shots = [
			{ id: 'b', time: 2, distance: 1 },
			{ id: 'a', time: 1, distance: 1 }
		];
		expect(sortShots(shots).map((shot) => shot.id)).toEqual(['a', 'b']);
		const project = addShot(createProject({ title: 'Shots' }), -1, 'zero');
		expect(project.film.camera.shots[0]?.time).toBe(0);
	});
});
