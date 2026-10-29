import { createDemoProject } from '../project/fixtures/sample-project';
import { describe, expect, it } from 'vitest';
import { getMotionSignature } from '../motion/motion-signature';
import { getAudioSignature } from '../music/audio-signature';
import { parseProject, type TSceneStyle } from '../project';
import { evaluateLighting } from './scene-lighting';

describe('evaluateLighting function', () => {
	const style: TSceneStyle = {
		theme: 'studio',
		background: '#202020',
		keyColor: '#ffffff',
		fillColor: '#808080',
		exposure: 0.8,
		bloom: 0.5,
		keyframes: [
			{
				id: 'dark',
				time: 2,
				background: '#000000',
				keyColor: '#ff0000',
				fillColor: '#000000',
				exposure: 0.5
			},
			{
				id: 'bright',
				time: 4,
				background: '#ffffff',
				keyColor: '#0000ff',
				fillColor: '#ffffff',
				exposure: 1.5
			}
		]
	};

	it('should preserve the base scene before animation and hold the last lighting afterward', () => {
		expect(evaluateLighting(style, 1)).toEqual({
			background: '#202020',
			keyColor: '#ffffff',
			fillColor: '#808080',
			exposure: 0.8,
			keyPosition: [-9, 13, 16],
			keyIntensity: 2.1,
			fillIntensity: 0,
			environmentIntensity: 0.55
		});
		expect(evaluateLighting({ ...style, keyframes: [] }, 30)).toEqual(evaluateLighting(style, 1));
		expect(evaluateLighting(style, 4)).toEqual(evaluateLighting(style, 60));
	});

	it('should interpolate colors in linear light and exposure smoothly at an absolute time', () => {
		expect(evaluateLighting(style, 3)).toEqual({
			background: '#bcbcbc',
			keyColor: '#bc00bc',
			fillColor: '#bcbcbc',
			exposure: 1,
			keyPosition: [-9, 13, 16],
			keyIntensity: 2.1,
			fillIntensity: 0,
			environmentIntensity: 0.55
		});
		expect(evaluateLighting(style, 2.5).exposure).toBeCloseTo(0.65625);
		const middle = evaluateLighting(style, 3);
		evaluateLighting(style, 4);
		evaluateLighting(style, 0);
		expect(evaluateLighting(style, 3)).toEqual(middle);
	});

	it('should resolve unsorted and coincident keys without modifying the authored data', () => {
		const keys = [...(style.keyframes ?? [])].reverse();
		const first = keys[1];
		if (first == null) throw new Error('Expected first lighting key.');
		keys.push({ ...first, id: 'replacement', exposure: 1 });
		const before = structuredClone(keys);
		expect(evaluateLighting({ ...style, keyframes: keys }, 2).exposure).toBe(1);
		expect(keys).toEqual(before);
	});

	it('should interpolate toward the last coincident key and reflect an in-place retiming', () => {
		const animated = structuredClone(style);
		const last = animated.keyframes?.[1];
		if (last == null) throw new Error('Expected the last lighting key.');
		const replacement = { ...last, id: 'replacement', exposure: 2.5 };
		animated.keyframes?.unshift(replacement);
		animated.keyframes?.push({ ...replacement, id: 'winner' });
		const winner = animated.keyframes?.at(-1);
		if (winner == null) throw new Error('Expected the coincident winner.');
		expect(evaluateLighting(animated, 3).exposure).toBe(1.5);
		winner.time = 6;
		expect(evaluateLighting(animated, 3).exposure).toBe(1);
		expect(evaluateLighting(animated, 6).exposure).toBe(2.5);
	});

	it('should roundtrip animated lighting without invalidating the physical performance', () => {
		const project = createDemoProject();
		const signature = getMotionSignature(project);
		project.scene = structuredClone(style);
		project.scene.keyPosition = [14, 5, 3];
		project.scene.keyIntensity = 4;
		project.scene.wallClearance = 0.5;
		const key = project.scene.keyframes?.[0];
		if (key == null) throw new Error('Expected lighting key.');
		key.keyPosition = [6, 5, 10];
		key.keyIntensity = 1.5;
		expect(parseProject(JSON.stringify(project)).scene).toEqual(project.scene);
		expect(getMotionSignature(project)).toBe(signature);
	});

	it.each([undefined, 0.02, 5])(
		'should preserve optional wall clearance %s without changing the physical performance',
		(wallClearance) => {
			const project = createDemoProject();
			const signature = getMotionSignature(project);
			project.scene = { ...structuredClone(style), wallClearance };
			const reopened = parseProject(JSON.stringify(project));
			expect(reopened.scene?.wallClearance).toBe(wallClearance);
			expect(getMotionSignature(reopened)).toBe(signature);
		}
	);

	it.each([0.019, 5.01, null, '0.5'])(
		'should reject an invalid wall clearance %s when opening a project',
		(wallClearance) => {
			const project = createDemoProject();
			const document = { ...project, scene: { ...style, wallClearance } };
			expect(() => parseProject(JSON.stringify(document))).toThrow('Wall clearance');
		}
	);

	it('should interpolate relative light positions and inherit missing key positions from the base', () => {
		const animated = structuredClone(style);
		animated.theme = 'wall';
		const key = animated.keyframes?.[0];
		if (key == null) throw new Error('Expected lighting key.');
		key.keyPosition = [6, 5, 10];
		expect(evaluateLighting(animated, 1).keyPosition).toEqual([14, 5, 3]);
		expect(evaluateLighting(animated, 3).keyPosition).toEqual([10, 5, 6.5]);
		expect(evaluateLighting(animated, 4).keyPosition).toEqual([14, 5, 3]);
		animated.keyPosition = [0, 10, 10];
		expect(evaluateLighting(animated, 3).keyPosition).toEqual([3, 7.5, 10]);
	});

	it('should reject malformed and unbounded light positions in base and animated lighting', () => {
		const project = createDemoProject();
		project.scene = structuredClone(style);
		project.scene.keyPosition = [101, 5, 3];
		expect(() => parseProject(JSON.stringify(project))).toThrow('Key light position');
		project.scene.keyPosition = [14, 5, 3];
		const key = project.scene.keyframes?.[0];
		if (key == null) throw new Error('Expected lighting key.');
		key.keyPosition = [6, Number.NaN, 10];
		expect(() => parseProject(JSON.stringify(project))).toThrow('Key light position');
	});

	it('should inherit and interpolate key intensity, including a fully dark direct light', () => {
		const animated = structuredClone(style);
		animated.theme = 'wall';
		const key = animated.keyframes?.[0];
		if (key == null) throw new Error('Expected lighting key.');
		key.keyIntensity = 0;
		expect(evaluateLighting(animated, 1).keyIntensity).toBe(6);
		expect(evaluateLighting(animated, 2).keyIntensity).toBe(0);
		expect(evaluateLighting(animated, 3).keyIntensity).toBe(3);
		animated.keyIntensity = 4;
		expect(evaluateLighting(animated, 3).keyIntensity).toBe(2);
	});

	it('should reject invalid base and animated key intensity', () => {
		const project = createDemoProject();
		project.scene = structuredClone(style);
		project.scene.keyIntensity = -1;
		expect(() => parseProject(JSON.stringify(project))).toThrow('Key light strength');
		project.scene.keyIntensity = 4;
		const key = project.scene.keyframes?.[0];
		if (key == null) throw new Error('Expected lighting key.');
		key.keyIntensity = 21;
		expect(() => parseProject(JSON.stringify(project))).toThrow('Key light strength');
		key.keyIntensity = Number.NaN;
		expect(() => parseProject(JSON.stringify(project))).toThrow('Key light strength');
	});

	it('should preserve legacy fill strengths and interpolate explicit strengths in either studio', () => {
		expect(evaluateLighting(undefined, 0).fillIntensity).toBe(0);
		for (const theme of ['studio', 'wall'] as const) {
			const animated = { ...structuredClone(style), theme };
			const legacy = theme === 'wall' ? 1 : 0;
			for (const time of [0, 2, 3, 4, 30])
				expect(evaluateLighting(animated, time).fillIntensity).toBe(legacy);
			const key = animated.keyframes?.[0];
			if (key == null) throw new Error('Expected lighting key.');
			key.fillIntensity = 0;
			animated.fillIntensity = 3;
			expect(evaluateLighting(animated, 1).fillIntensity).toBe(3);
			expect(evaluateLighting(animated, 2).fillIntensity).toBe(0);
			expect(evaluateLighting(animated, 2.5).fillIntensity).toBeCloseTo(0.46875);
			expect(evaluateLighting(animated, 3).fillIntensity).toBe(1.5);
			expect(evaluateLighting(animated, 30).fillIntensity).toBe(3);
			expect(evaluateLighting(animated, 2).fillIntensity).toBe(0);
		}
	});

	it('should roundtrip base and keyed fill strengths without changing motion or audio', () => {
		const project = createDemoProject();
		project.scene = structuredClone(style);
		const motion = getMotionSignature(project);
		const audio = getAudioSignature(project);
		expect(parseProject(JSON.stringify(project)).scene).toEqual(project.scene);
		project.scene.fillIntensity = 0;
		const key = project.scene.keyframes?.[0];
		if (key == null) throw new Error('Expected lighting key.');
		key.fillIntensity = 3;
		const reopened = parseProject(JSON.stringify(project));
		expect(reopened.scene).toEqual(project.scene);
		expect(getMotionSignature(reopened)).toBe(motion);
		expect(getAudioSignature(reopened)).toBe(audio);
	});

	it.each([-0.01, 3.01, null, '0.3', NaN, Infinity])(
		'should reject malformed base and keyed fill strength %s',
		(fillIntensity) => {
			const project = createDemoProject();
			const scene = { ...structuredClone(style), fillIntensity };
			expect(() => parseProject(JSON.stringify({ ...project, scene }))).toThrow(
				'Fill light strength'
			);
			const keyed = {
				...structuredClone(style),
				keyframes: style.keyframes?.map((key) => ({ ...key, fillIntensity }))
			};
			expect(() => parseProject(JSON.stringify({ ...project, scene: keyed }))).toThrow(
				'Fill light strength'
			);
		}
	);

	it('should retain legacy environment strengths and interpolate explicit keys independently', () => {
		expect(evaluateLighting(undefined, 0).environmentIntensity).toBe(0.55);
		for (const theme of ['studio', 'wall'] as const) {
			const animated = { ...structuredClone(style), theme };
			const legacy = theme === 'wall' ? 0.7 : 0.55;
			for (const time of [0, 2, 3, 4, 30])
				expect(evaluateLighting(animated, time).environmentIntensity).toBe(legacy);
			const key = animated.keyframes?.[0];
			if (key == null) throw new Error('Expected lighting key.');
			key.environmentIntensity = 0;
			animated.environmentIntensity = 3;
			expect(evaluateLighting(animated, 1).environmentIntensity).toBe(3);
			expect(evaluateLighting(animated, 2).environmentIntensity).toBe(0);
			expect(evaluateLighting(animated, 2.5).environmentIntensity).toBeCloseTo(0.46875);
			expect(evaluateLighting(animated, 3).environmentIntensity).toBe(1.5);
			expect(evaluateLighting(animated, 30).environmentIntensity).toBe(3);
			expect(evaluateLighting(animated, 2).environmentIntensity).toBe(0);
			expect(evaluateLighting(animated, 3).keyIntensity).toBe(theme === 'wall' ? 6 : 2.1);
		}
	});

	it('should roundtrip base and keyed environment strengths without changing motion or audio', () => {
		const project = createDemoProject();
		project.scene = structuredClone(style);
		const motion = getMotionSignature(project);
		const audio = getAudioSignature(project);
		expect(parseProject(JSON.stringify(project)).scene).toEqual(project.scene);
		project.scene.environmentIntensity = 0;
		const key = project.scene.keyframes?.[0];
		if (key == null) throw new Error('Expected lighting key.');
		key.environmentIntensity = 3;
		const reopened = parseProject(JSON.stringify(project));
		expect(reopened.scene).toEqual(project.scene);
		expect(getMotionSignature(reopened)).toBe(motion);
		expect(getAudioSignature(reopened)).toBe(audio);
	});

	it.each([-0.01, 3.01, null, '0.42', NaN, Infinity])(
		'should reject malformed base and keyed environment strength %s',
		(environmentIntensity) => {
			const project = createDemoProject();
			const scene = { ...structuredClone(style), environmentIntensity };
			expect(() => parseProject(JSON.stringify({ ...project, scene }))).toThrow(
				'Environment strength'
			);
			const keyed = {
				...structuredClone(style),
				keyframes: style.keyframes?.map((key) => ({ ...key, environmentIntensity }))
			};
			expect(() => parseProject(JSON.stringify({ ...project, scene: keyed }))).toThrow(
				'Environment strength'
			);
		}
	);

	it('should reject invalid lighting keys when opening a project', () => {
		const project = createDemoProject();
		project.scene = structuredClone(style);
		const first = project.scene.keyframes?.[0];
		const second = project.scene.keyframes?.[1];
		if (first == null || second == null) throw new Error('Expected lighting keys.');
		first.time = project.duration + 1;
		expect(() => parseProject(JSON.stringify(project))).toThrow('Lighting keyframe time');
		first.time = 2;
		first.keyColor = 'invalid';
		expect(() => parseProject(JSON.stringify(project))).toThrow('Key light color');
		first.keyColor = '#ffffff';
		second.id = 'dark';
		expect(() => parseProject(JSON.stringify(project))).toThrow('Lighting keyframe');
	});
});
