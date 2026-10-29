import { createDemoProject } from '../project/fixtures/sample-project';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { getMotionSignature } from '../motion/motion-signature';
import { parseProject, type TSceneStyle } from '../project';
import { getViewTransformToneMapping } from './view-transform';

describe('getViewTransformToneMapping function', () => {
	it('should preserve ACES Filmic for existing projects without a view transform', () => {
		const project = createDemoProject();
		project.scene = createSceneStyle();
		const reopened = parseProject(JSON.stringify(project));
		expect(reopened.scene?.viewTransform).toBeUndefined();
		expect(getViewTransformToneMapping(reopened.scene?.viewTransform)).toBe(
			THREE.ACESFilmicToneMapping
		);
	});

	it.each([
		['filmic', THREE.ACESFilmicToneMapping],
		['agx', THREE.AgXToneMapping],
		['neutral', THREE.NeutralToneMapping]
	] as const)(
		'should preserve %s across project save and reopen without changing motion',
		(value, mapping) => {
			const project = createDemoProject();
			const signature = getMotionSignature(project);
			project.scene = { ...createSceneStyle(), viewTransform: value };
			const reopened = parseProject(JSON.stringify(project));
			expect(reopened.scene?.viewTransform).toBe(value);
			expect(getViewTransformToneMapping(reopened.scene?.viewTransform)).toBe(mapping);
			expect(getMotionSignature(reopened)).toBe(signature);
		}
	);

	it.each(['linear', '', 6, null])('should reject unsupported view transform %s', (value) => {
		const project = createDemoProject();
		const document = { ...project, scene: { ...createSceneStyle(), viewTransform: value } };
		expect(() => parseProject(JSON.stringify(document))).toThrow('View transform');
	});
});

function createSceneStyle(): TSceneStyle {
	return {
		theme: 'studio',
		background: '#bbc2b7',
		keyColor: '#fff8ed',
		fillColor: '#edf2ff',
		exposure: 0.95,
		bloom: 0.6
	};
}
