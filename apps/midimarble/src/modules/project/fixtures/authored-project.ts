import { createWorldObject } from './sample-project';
import { createEmptyProject } from '../project';
import type { TProject } from '../types';

export function createAuthoredTestProject(): TProject {
	const project = createEmptyProject();
	project.id = 'authored-test-project';
	project.name = 'A synthetic scene';
	project.tempos = [{ time: 0, bpm: 120 }, { time: 8, bpm: 96 }];
	project.notes = [
		{ id: 'first', trackId: 'piano', time: 1, duration: 0.5, midi: 60, velocity: 0.8 },
		{ id: 'second', trackId: 'piano', time: 3, duration: 0.75, midi: 67, velocity: 0.6 },
		{ id: 'beat', trackId: 'percussion', time: 5, duration: 0.25, midi: 42, velocity: 0.7 }
	];
	project.tracks = [
		{
			id: 'piano',
			name: 'Piano',
			color: '#9675dc',
			instrument: 0,
			muted: false,
			solo: true,
			controls: [{ number: 64, time: 1, value: 1 }, { number: 64, time: 2, value: 0 }],
			pitchBends: [{ time: 3, value: -0.25 }]
		},
		{
			id: 'percussion',
			name: 'Percussion',
			color: '#e0a357',
			instrument: 0,
			muted: false,
			percussion: true
		}
	];
	project.objects = [
		{
			...createWorldObject('bar', [0, 2, 0.6]),
			id: 'linked-key',
			modelId: 'key-panel',
			binding: { noteId: 'first', offset: [0.1, 0, 0] },
			materialFinish: 'painted',
			color: '#75aa9a',
			glowColor: '#77e5ec',
			glowEndColor: '#7c2ac7',
			glowBalance: 0.4,
			glowFade: 0.35,
			flex: 0.25
		},
		{
			...createWorldObject('rail', [1, -3, 0.5]),
			id: 'curved-rail',
			modelId: 'rail-curve',
			path: [[-1, 0, 0], [0, -0.4, 0], [1, -0.2, 0]],
			friction: 0.4
		},
		{
			...createWorldObject('rail', [2, -6, 0.5]),
			id: 'timed-rail',
			marbleId: 'answer',
			trajectoryAnchor: { time: 7, offset: [0.2, -0.1, 0] }
		}
	];
	project.marbles = [{
		id: 'answer',
		name: 'Answer',
		startTime: 2,
		launch: { position: [2, 4, 0.8], velocity: [-0.5, 0, 0], radius: 0.2 },
		color: '#e0a357',
		style: 'glass',
		effect: 'flow',
		effectSpeed: 0.6
	}];
	project.audio = { musicVolume: 0.8, surfaceVolume: 0.2, surfacesEnabled: true };
	project.camera = {
		fov: 40,
		distance: 8,
		azimuth: 0.15,
		elevation: 0.1,
		lead: 0.2,
		followMarbles: true,
		keyframeSpace: 'world',
		keyframes: [
			{ id: 'camera-start', time: 0, position: [3, 5, 8], target: [0, 3, 0], fov: 38 },
			{ id: 'camera-end', time: 10, position: [4, -5, 7], target: [0, -7, 0], fov: 42 }
		]
	};
	if (project.scene == null) throw new Error('Expected the empty project to define its lighting.');
	project.scene.theme = 'wall';
	project.scene.keyframes = [{
		id: 'lighting-end',
		time: 8,
		background: '#192c38',
		keyColor: '#ffe8ce',
		fillColor: '#9abddd',
		exposure: 0.9
	}];
	project.titles = [{ id: 'title', time: 1, duration: 2, text: 'A synthetic scene' }];
	return project;
}
