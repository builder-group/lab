import { describe, expect, it } from 'vitest';
import { createEmptyProject, parseProject } from '../project/project';
import { evaluateLighting } from '../scene/scene-lighting';
import { getSceneEntityMovePatch } from './scene-entity-editing';

describe('getSceneEntityMovePatch function', () => {
	it('should derive camera framing while retaining lens, follow settings and independent arrays', () => {
		const project = createEmptyProject();
		const camera = project.camera;
		if (camera == null) throw new Error('Expected an empty-project camera.');
		camera.fov = 55;
		camera.lead = 0.7;
		camera.followMarbles = true;
		camera.keyframeSpace = 'follow';
		const original = structuredClone(project);

		const patch = getSceneEntityMovePatch(project, 'camera', [4, 6, 3], [1, 2, 3]);

		expect(patch?.camera).toMatchObject({
			fov: 55,
			lead: 0.7,
			followMarbles: true,
			keyframeSpace: 'follow',
			distance: 5
		});
		expect(patch?.camera?.azimuth).toBeCloseTo(Math.PI / 2);
		expect(patch?.camera?.elevation).toBeCloseTo(Math.atan2(4, 3));
		expect(patch?.camera).not.toBe(camera);
		expect(patch?.camera?.keyframes).not.toBe(camera.keyframes);
		expect(project).toEqual(original);
	});

	it('should store relative light position and preserve the authored studio settings', () => {
		const project = createEmptyProject();
		const scene = project.scene;
		if (scene == null) throw new Error('Expected empty-project lighting.');
		scene.theme = 'wall';
		scene.keyframes = [];
		const original = structuredClone(project);

		const patch = getSceneEntityMovePatch(project, 'lighting', [12, 4, -2], [2, 1, -1]);

		expect(patch?.scene).toEqual({ ...scene, keyPosition: [10, 3, -1] });
		expect(patch?.scene?.keyframes).not.toBe(scene.keyframes);
		expect(patch?.scene?.keyPosition).not.toBe(scene.keyPosition);
		expect(project).toEqual(original);
	});

	it('should leave authored animation untouched and only block the selected animated entity', () => {
		const project = createEmptyProject();
		if (project.camera == null || project.scene == null)
			throw new Error('Expected studio settings.');
		project.camera.keyframes = [
			{
				id: 'camera',
				time: 0,
				position: [0, 0, 8],
				target: [0, 0, 0],
				fov: 40
			}
		];
		const original = structuredClone(project);
		expect(getSceneEntityMovePatch(project, 'camera', [1, 2, 8], [0, 0, 0])).toBeNull();
		expect(getSceneEntityMovePatch(project, 'lighting', [1, 2, 8], [0, 0, 0])).not.toBeNull();
		expect(project).toEqual(original);
		project.scene.keyframes = [{ id: 'light', time: 0, ...evaluateLighting(project.scene, 0) }];
		expect(getSceneEntityMovePatch(project, 'lighting', [1, 2, 8], [0, 0, 0])).toBeNull();
		expect(project.camera.keyframes).toEqual(original.camera?.keyframes);
	});

	it('should supply renderer defaults when camera or lighting settings are absent', () => {
		const project = createEmptyProject();
		delete project.camera;
		delete project.scene;
		const camera = getSceneEntityMovePatch(project, 'camera', [0, 0, 9.2], [0, 0, 0]);
		const light = getSceneEntityMovePatch(project, 'lighting', [2, 3, 4], [0, 0, 0]);
		expect(camera?.camera).toEqual({
			fov: 36,
			distance: 9.2,
			azimuth: 0,
			elevation: 0,
			lead: 0.42,
			keyframes: []
		});
		expect(light?.scene).toEqual({
			theme: 'studio',
			bloom: 1,
			...evaluateLighting(undefined, 0),
			keyPosition: [2, 3, 4]
		});
	});

	it('should clamp extreme translations to native camera and light bounds', () => {
		const project = createEmptyProject();
		const camera = getSceneEntityMovePatch(project, 'camera', [0, 1e6, 0], [0, 0, 0]);
		const light = getSceneEntityMovePatch(project, 'lighting', [-1000, 2000, -3000], [0, 0, 0]);
		expect(camera?.camera).toMatchObject({ distance: 200, elevation: 1.55 });
		expect(light?.scene?.keyPosition).toEqual([-100, 100, -100]);
		expect(parseProject(JSON.stringify({ ...project, ...camera, ...light }))).toEqual({
			...project,
			...camera,
			...light
		});
	});

	it('should preserve the authored orientation when dragged onto the camera target', () => {
		const project = createEmptyProject();
		const patch = getSceneEntityMovePatch(project, 'camera', [1, 2, 3], [1, 2, 3]);
		expect(patch?.camera).toMatchObject({
			distance: 3,
			azimuth: project.camera?.azimuth,
			elevation: project.camera?.elevation
		});
	});

	it.each(['camera', 'lighting'] as const)('should ignore a non-finite %s drag', (entity) => {
		expect(
			getSceneEntityMovePatch(createEmptyProject(), entity, [NaN, 2, 3], [0, 0, 0])
		).toBeNull();
	});
});
