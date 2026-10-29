import { composeMidiNotes, createCloseWallStyle } from './compose-midi';
import type { TNote, TProject } from './types';

export const exampleProjects: TExampleProject[] = [
	{
		id: 'first-light',
		title: 'First light',
		description: 'A tiny music-box melody on a warm wall. Eight notes, one glass marble.',
		duration: 8,
		marbles: 1,
		thumbnail: '/examples/first-light.png',
		file: '/examples/first-light.marble'
	},
	{
		id: 'counterpoint',
		title: 'Counterpoint',
		description: 'Two glass voices answer one another in a shared frame.',
		duration: 12,
		marbles: 2,
		thumbnail: '/examples/counterpoint.png',
		file: '/examples/counterpoint.marble'
	},
	{
		id: 'rolling-rhythm',
		title: 'Rolling rhythm',
		description: 'A curved rail carries the marble between soft mallet phrases.',
		duration: 8.5,
		marbles: 1,
		thumbnail: '/examples/rolling-rhythm.png',
		file: '/examples/rolling-rhythm.marble'
	}
];

export interface TExampleProject {
	id: string;
	title: string;
	description: string;
	duration: number;
	marbles: number;
	thumbnail: string;
	file: string;
}

export function createExampleProject(id: string): TProject {
	const factories: Record<string, () => TProject> = {
		'first-light': createFirstLight,
		'counterpoint': createCounterpoint,
		'rolling-rhythm': createRollingRhythm
	};
	const factory = factories[id];
	if (factory == null) throw new Error(`Unknown example project: ${id}`);
	const project = factory();
	applyExamplePalette(project);
	return project;
}

function applyExamplePalette(project: TProject): void {
	const duet = project.id === 'example-counterpoint';
	const rolling = project.id === 'example-rolling-rhythm';
	if (rolling) project.marbleColor = '#ac429b';
	for (const [index, object] of project.objects.entries()) {
		if (object.kind === 'rail') continue;
		object.materialFinish = 'painted';
		object.material = 'metal';
		object.color = duet && object.marbleId !== 'answer' ? '#39766d' : '#a87439';
		if (!duet && index % 4 === 3) {
			object.material = 'wood';
			object.color = '#72482d';
		}
		object.glowColor = rolling ? '#dba1dc' : '#ffd493';
		object.emission = 0.35;
	}
}

function createFirstLight(): TProject {
	const project = createBaseProject('first-light');
	project.notes = createPhrase('melody', [72, 76, 79, 83, 81, 79, 76, 72], 0.8, 0.85);
	if (project.camera != null) project.camera.distance = 12.5;
	return composeMidiNotes(project);
}

function createCounterpoint(): TProject {
	const project = createBaseProject('counterpoint');
	project.launch.position[0] = -1.4;
	project.gravity = 6;
	project.aspectRatio = '1:1';
	project.launch.velocity[0] = 0.3;
	project.marbles = [
		{
			id: 'answer',
			name: 'Amber',
			launch: { position: [1.4, 4, 0.65], velocity: [-0.3, -0.2, 0], radius: 0.22 },
			color: '#ce8a19',
			style: 'ribbon'
		}
	];
	project.tracks.push({
		id: 'answer',
		name: 'Amber answer',
		color: '#cc9454',
		instrument: 11,
		muted: false
	});
	project.notes = [
		...createPhrase('melody', [72, 76, 79, 76, 74, 77, 81, 77, 72, 76, 79, 72], 0.8, 0.85),
		...createPhrase('answer', [60, 64, 67, 64, 62, 65, 69, 65, 60, 64, 67, 60], 0.92, 0.85)
	];
	if (project.camera != null) project.camera.distance = 13;
	return composeMidiNotes(project, {
		voices: {
			melody: { marbleId: 'main', direction: 1, color: '#90cfc5' },
			answer: { marbleId: 'answer', direction: -1, color: '#efb65c' }
		}
	});
}

function createRollingRhythm(): TProject {
	let project = createBaseProject('rolling-rhythm');
	// Original demo melody, distributed under this project's AGPL-3.0-or-later license.
	const pitches = [69, 76, 72, 76, 79, 74, 69];
	const onsets = [0.8, 1.65, 4, 4.85, 5.7, 6.55, 7.4];
	project.notes = pitches.map((midi, index) => ({
		id: `rolling-note-${index}`,
		trackId: 'rolling',
		midi,
		time: onsets[index] ?? 0,
		duration: 0.4,
		velocity: 0.75
	}));
	project.tracks = [
		{ id: 'rolling', name: 'Soft mallets', color: '#ac429b', instrument: 11, muted: false }
	];
	project.restitution = 0;
	project.audio = { musicVolume: 0.72, surfaceVolume: 0.48, surfacesEnabled: true };
	if (project.camera != null) project.camera.distance = 12.5;
	project = composeMidiNotes(project);
	const length = 3.5;
	const slope = -1.029957203994294;
	project.objects.push({
		id: 'rolling-rail',
		name: 'Paired-wire interlude',
		kind: 'rail',
		modelId: 'rail-curve',
		binding: null,
		position: [-2.066109696812631, -2.870418117599338, 0.6499999761581421],
		rotation: [0, 0, 0],
		size: [length, 0.05, 0.28],
		restitution: 0,
		friction: 0.5,
		material: 'metal',
		materialFinish: 'bare',
		color: '#bba073',
		emission: 0,
		path: Array.from({ length: 25 }, (_, index) => {
			const x = (index * length) / 24;
			return [x, slope * x - (slope * x * x) / (2 * length), 0];
		})
	});
	return project;
}

function createBaseProject(id: string): TProject {
	const example = exampleProjects.find((item) => item.id === id);
	if (example == null) throw new Error(`Unknown example project: ${id}`);
	return {
		version: 1,
		id: `example-${id}`,
		name: example.title,
		bpm: 60 / 0.85,
		duration: example.duration,
		tracks: [{ id: 'melody', name: 'Jade melody', color: '#63a99e', instrument: 10, muted: false }],
		notes: [],
		objects: [],
		launch: { position: [0, 4, 0.65], velocity: [0.6, -0.2, 0], radius: 0.22 },
		gravity: 9.81,
		restitution: 0.25,
		aspectRatio: '9:16',
		marbleColor: '#188e70',
		marbleStyle: 'ribbon',
		marbleEffect: 'none',
		audio: { musicVolume: 0.8, surfaceVolume: 0.18, surfacesEnabled: true },
		scene: createCloseWallStyle(),
		camera: {
			fov: 38,
			distance: 10,
			azimuth: 0.1,
			elevation: 0.03,
			lead: 0.15,
			followMarbles: true,
			keyframes: []
		}
	};
}

function createPhrase(trackId: string, pitches: number[], start: number, spacing: number): TNote[] {
	return pitches.map((midi, index) => ({
		id: `${trackId}-${index}`,
		trackId,
		midi,
		time: start + index * spacing,
		duration: index === pitches.length - 1 ? 0.7 : 0.55,
		velocity: index % 4 === 0 ? 0.82 : 0.69
	}));
}
