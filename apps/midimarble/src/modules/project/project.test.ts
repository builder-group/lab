import { describe, expect, it } from 'vitest';
import { getMotionSignature } from '../motion/motion-signature';
import { getAudioSignature } from '../music/audio-signature';
import { createAuthoredTestProject } from './fixtures/authored-project';
import { createDemoProject, createWorldObject } from './fixtures/sample-project';
import { createEmptyProject, parseProject } from './project';
import type { TMarbleDefinition, TProject } from './types';

describe('createEmptyProject function', () => {
	it('should start with eight bars at 120 BPM and an acoustic piano track', () => {
		const project = createEmptyProject();
		expect(project.bpm).toBe(120);
		expect(project.duration).toBe(16);
		expect(project.tracks).toEqual([
			{ id: 'piano', name: 'Piano', color: '#9675dc', instrument: 0, muted: false }
		]);
	});

	it('should omit example music and geometry while keeping a close-wall studio setup', () => {
		const project = createEmptyProject();
		expect(project.notes).toEqual([]);
		expect(project.objects).toEqual([]);
		expect(project.titles).toBeUndefined();
		expect(project.marbles).toBeUndefined();
		expect(project.tempos).toBeUndefined();
		expect(project.camera?.keyframes).toEqual([]);
		expect(project.scene?.wallPosition).toBe(0);
	});

	it('should save and reopen a valid empty studio document', () => {
		const project = createEmptyProject();
		expect(project).toMatchObject({
			name: 'Untitled project',
			launch: { position: [0, 4, 0.8], velocity: [1.1, -0.4, 0], radius: 0.24 },
			gravity: 9.81,
			restitution: 0.35,
			aspectRatio: '9:16',
			marbleColor: '#34896c',
			marbleStyle: 'ribbon'
		});
		expect(parseProject(JSON.stringify(project))).toEqual(project);
	});
});

describe('parseProject function', () => {
	it('should preserve a fixed wall position and reject invalid wall coordinates', () => {
		const project = createEmptyProject();
		expect(parseProject(JSON.stringify(project)).scene?.wallPosition).toBe(0);
		for (const wallPosition of [Infinity, -1001, 'near']) {
			const invalid = { ...project, scene: { ...project.scene, wallPosition } };
			expect(() => parseProject(JSON.stringify(invalid))).toThrow('Wall position');
		}
	});

	it('should preserve optional surface friction when saving and reopening a project', () => {
		const project = createDemoProject();
		const object = project.objects[0];
		if (object == null) throw new Error('Expected a demonstration object.');
		expect(parseProject(JSON.stringify(project)).objects[0]?.friction).toBeUndefined();
		for (const friction of [0, 0.3, 2]) {
			object.friction = friction;
			expect(parseProject(JSON.stringify(project))).toEqual(project);
		}
	});

	it.each([-0.1, 2.1, null, '0.3', Number.NaN, Infinity])(
		'should reject invalid surface friction %s in saved projects',
		(friction) => {
			const project = createDemoProject();
			const saved = JSON.stringify({
				...project,
				objects: project.objects.map((object) => ({ ...object, friction }))
			});
			expect(() => parseProject(saved)).toThrow('Surface friction');
		}
	);

	it('should preserve optional track Solo state without changing physics inputs', () => {
		const project = createDemoProject();
		const track = project.tracks[0];
		if (track == null) throw new Error('Expected a demonstration track.');
		expect(parseProject(JSON.stringify(project)).tracks[0]?.solo).toBeUndefined();
		const motion = getMotionSignature(project);
		for (const solo of [true, false]) {
			track.solo = solo;
			expect(parseProject(JSON.stringify(project)).tracks[0]?.solo).toBe(solo);
			expect(getMotionSignature(project)).toBe(motion);
		}
	});
	it('should reject nonboolean track Solo flags in saved projects', () => {
		const project = createDemoProject();
		for (const solo of ['true', 1, null])
			expect(() =>
				parseProject(
					JSON.stringify({
						...project,
						tracks: project.tracks.map((track) => ({ ...track, solo }))
					})
				)
			).toThrow('Track solo state');
	});
	it.each(['none', 'pins', 'folded', 'folded-front', 'rack'] as const)(
		'should roundtrip %s mounting and invalidate motion only for a physical front lip',
		(mountStyle) => {
			const project = createDemoProject();
			const object = project.objects[0];
			if (object == null) throw new Error('Expected demonstration object.');
			const motion = getMotionSignature(project);
			const audio = getAudioSignature(project);
			object.mountStyle = mountStyle;
			expect(parseProject(JSON.stringify(project)).objects[0]?.mountStyle).toBe(mountStyle);
			if (mountStyle === 'folded-front') expect(getMotionSignature(project)).not.toBe(motion);
			else expect(getMotionSignature(project)).toBe(motion);
			expect(getAudioSignature(project)).toBe(audio);
		}
	);

	it('should roundtrip metal finishes without changing motion or sound inputs', () => {
		const project = createDemoProject();
		const object = project.objects[0];
		if (object == null) throw new Error('Expected demonstration object.');
		const motion = getMotionSignature(project);
		const audio = getAudioSignature(project);
		expect(parseProject(JSON.stringify(project)).objects[0]?.materialFinish).toBeUndefined();
		for (const finish of ['bare', 'painted'] as const) {
			object.materialFinish = finish;
			expect(parseProject(JSON.stringify(project)).objects[0]?.materialFinish).toBe(finish);
			expect(getMotionSignature(project)).toBe(motion);
			expect(getAudioSignature(project)).toBe(audio);
		}
		expect(() =>
			parseProject(
				JSON.stringify({ ...project, objects: [{ ...object, materialFinish: 'unknown' }] })
			)
		).toThrow('Material finish');
	});

	it('should reopen the complete demonstration without changing its links or settings', () => {
		const project = createDemoProject();
		expect(parseProject(JSON.stringify(project))).toEqual(project);
	});

	it('should preserve musical expression and free world objects on save and reopen', () => {
		const project = createDemoProject();
		project.tempos = [
			{ time: 0, bpm: 83.333333 },
			{ time: 8, bpm: 92 }
		];
		const track = project.tracks[0];
		if (track == null) throw new Error('Expected a demonstration track.');
		track.percussion = false;
		track.controls = [
			{ number: 64, time: 1, value: 1 },
			{ number: 64, time: 2, value: 0 }
		];
		track.pitchBends = [
			{ time: 3.2, value: -0.5 },
			{ time: 3.7, value: 0.75 }
		];
		project.objects.push(createWorldObject('rail', [2, -15, -0.4]));
		expect(parseProject(JSON.stringify(project))).toEqual(project);
	});

	it('should preserve authored materials, curved rails, camera animation and titles', () => {
		const project = createAuthoredTestProject();
		if (!project.camera) throw new Error('Expected an authored camera.');
		project.camera.keyframes = [
			{ id: 'camera-0', time: 0, position: [3, 5, 8], target: [0, 3, 0], fov: 38 },
			{ id: 'camera-1', time: 10, position: [4, -5, 7], target: [0, -7, 0], fov: 42 }
		];
		project.titles = [{ id: 'intro', time: 1, duration: 3, text: 'A synthetic scene' }];
		const object = project.objects[0];
		if (!object) throw new Error('Expected an authored key.');
		object.glowColor = '#77e5ec';
		object.glowEndColor = '#7c2ac7';
		object.locked = true;
		object.disabled = false;
		expect(parseProject(JSON.stringify(project))).toEqual(project);
	});

	it('should roundtrip optional afterglow without invalidating physics or audio', () => {
		const project = createDemoProject();
		const object = project.objects[0];
		if (object == null) throw new Error('Expected demonstration key.');
		expect(parseProject(JSON.stringify(project)).objects[0]?.glowFade).toBeUndefined();
		const motion = getMotionSignature(project);
		const audio = getAudioSignature(project);
		for (const duration of [0.05, 0.35, 3]) {
			object.glowFade = duration;
			expect(parseProject(JSON.stringify(project))).toEqual(project);
			expect(getMotionSignature(project)).toBe(motion);
			expect(getAudioSignature(project)).toBe(audio);
		}
	});

	it.each([0, 0.049, 3.001, -1, '0.35', null, Infinity, NaN])(
		'should reject invalid afterglow duration %s',
		(glowFade) => {
			const project = createDemoProject();
			const object = project.objects[0];
			const invalid = { ...project, objects: [{ ...object, glowFade }] };
			expect(() => parseProject(JSON.stringify(invalid))).toThrow('Afterglow duration');
		}
	);

	it('should roundtrip optional glow balance without invalidating physics or audio', () => {
		const project = createDemoProject();
		const object = project.objects[0];
		if (object == null) throw new Error('Expected demonstration key.');
		expect(parseProject(JSON.stringify(project)).objects[0]?.glowBalance).toBeUndefined();
		const motion = getMotionSignature(project);
		const audio = getAudioSignature(project);
		for (const balance of [0.05, 0.5, 0.95]) {
			object.glowBalance = balance;
			expect(parseProject(JSON.stringify(project))).toEqual(project);
			expect(getMotionSignature(project)).toBe(motion);
			expect(getAudioSignature(project)).toBe(audio);
		}
	});

	it.each([0, 0.049, 0.951, 1, '0.5', null, Infinity, NaN])(
		'should reject invalid glow balance %s',
		(glowBalance) => {
			const project = createDemoProject();
			const object = project.objects[0];
			const invalid = { ...project, objects: [{ ...object, glowBalance }] };
			expect(() => parseProject(JSON.stringify(invalid))).toThrow('Glow color balance');
		}
	);

	it('should reject malformed glow gradient colors and retain legacy single-color keys', () => {
		const project = createDemoProject();
		const object = project.objects[0];
		if (object == null) throw new Error('Expected demonstration key.');
		expect(parseProject(JSON.stringify(project)).objects[0]?.glowEndColor).toBeUndefined();
		object.glowEndColor = 'not-a-color';
		expect(() => parseProject(JSON.stringify(project))).toThrow('Glow end color');
	});

	it('should reopen the sound mix, animated marble materials and timed trajectory anchors', () => {
		const project = createDemoProject();
		project.audio = { musicVolume: 0.7, surfaceVolume: 0.28, surfacesEnabled: true };
		project.marbleStyle = 'chrome';
		project.marbleEffect = 'iridescent';
		project.marbleEffectSpeed = 1.25;
		project.marbles = [
			{
				...createExtraMarble(project),
				name: 'Countermelody',
				startTime: 3.75,
				style: 'glass',
				effect: 'flow',
				effectSpeed: 0.6
			}
		];
		project.objects.push({
			...createWorldObject('rail', [1, -4, 0]),
			modelId: 'rail-curve',
			marbleId: 'harmony',
			trajectoryAnchor: { time: 5.125, offset: [0.2, -0.3, 0] }
		});
		expect(parseProject(JSON.stringify(project))).toEqual(project);
	});

	it.each([0, 'end'] as const)('should preserve an additional marble released at %s', (start) => {
		const project = createDemoProject();
		project.marbles = [
			{ ...createExtraMarble(project), startTime: start === 'end' ? project.duration : start }
		];
		expect(parseProject(JSON.stringify(project)).marbles).toEqual(project.marbles);
	});

	it.each(['main', 'duplicate'] as const)(
		'should reject an additional marble with a %s identity collision',
		(collision) => {
			const project = createDemoProject();
			project.marbles =
				collision === 'main'
					? [createExtraMarble(project, 'main')]
					: [createExtraMarble(project), createExtraMarble(project)];
			expect(() => parseProject(JSON.stringify(project))).toThrow('identifiers must be unique');
		}
	);

	it.each([-0.01, 'past-end'] as const)(
		'should reject an additional marble released at %s',
		(start) => {
			const project = createDemoProject();
			project.marbles = [
				{
					...createExtraMarble(project),
					startTime: start === 'past-end' ? project.duration + 0.01 : start
				}
			];
			expect(() => parseProject(JSON.stringify(project))).toThrow('Marble start time');
		}
	);

	it('should reject an object assigned to a missing marble', () => {
		const project = createDemoProject();
		project.objects.push({ ...createWorldObject('rail', [0, -4, 0]), marbleId: 'missing' });
		expect(() => parseProject(JSON.stringify(project))).toThrow('references a missing marble');
	});

	it('should reject additional marbles beyond the supported simulation budget', () => {
		const project = createDemoProject();
		project.marbles = Array.from({ length: 9 }, (_, index) =>
			createExtraMarble(project, `marble-${index}`)
		);
		expect(() => parseProject(JSON.stringify(project))).toThrow('8 item limit');
	});

	it('should keep the main marble addressable without an additional marble list', () => {
		const project = createDemoProject();
		project.objects.push({
			...createWorldObject('rail', [0, -4, 0]),
			marbleId: 'main',
			trajectoryAnchor: { time: 1, offset: [0, 0, 0] }
		});
		expect(parseProject(JSON.stringify(project))).toEqual(project);
	});

	it('should reject an object anchored to both a MIDI note and a trajectory time', () => {
		const project = createDemoProject();
		const object = project.objects.find((entry) => entry.binding != null);
		if (object == null) throw new Error('Expected a linked demonstration instrument.');
		object.trajectoryAnchor = { time: 2, offset: [0, 0, 0] };
		expect(() => parseProject(JSON.stringify(project))).toThrow(
			'follow a note or a trajectory time, not both'
		);
	});

	it.each(['time', 'offset'] as const)('should validate a trajectory anchor %s', (field) => {
		const project = createDemoProject();
		project.objects.push({
			...createWorldObject('rail', [0, -4, 0]),
			trajectoryAnchor: {
				time: field === 'time' ? project.duration + 0.01 : 1,
				offset: field === 'offset' ? [1e9, 0, 0] : [0, 0, 0]
			}
		});
		expect(() => parseProject(JSON.stringify(project))).toThrow(`Trajectory anchor ${field}`);
	});

	it('should roundtrip an optional rounded nose without changing physics or audio', () => {
		const project = createDemoProject();
		const edited = structuredClone(project);
		const object = edited.objects[0];
		if (object == null) throw new Error('Expected an example object.');
		object.roundedNose = true;
		expect(parseProject(JSON.stringify(edited))).toEqual(edited);
		expect(getMotionSignature(edited)).toBe(getMotionSignature(project));
		expect(getAudioSignature(edited)).toBe(getAudioSignature(project));
	});

	it('should reject a malformed rounded nose flag', () => {
		const project = createDemoProject();
		const object = project.objects[0];
		if (object == null) throw new Error('Expected an example object.');
		Object.assign(object, { roundedNose: 'yes' });
		expect(() => parseProject(JSON.stringify(project))).toThrow('Rounded nose');
	});

	it('should roundtrip camera follow-key space without rebuilding motion or audio', () => {
		const project = createAuthoredTestProject();
		const edited = structuredClone(project);
		if (edited.camera == null) throw new Error('Expected an authored camera.');
		edited.camera.keyframeSpace = 'follow';
		expect(parseProject(JSON.stringify(edited))).toEqual(edited);
		expect(getMotionSignature(edited)).toBe(getMotionSignature(project));
		expect(getAudioSignature(edited)).toBe(getAudioSignature(project));
	});

	it('should reject an unsupported camera keyframe space', () => {
		const project = createAuthoredTestProject();
		if (project.camera == null) throw new Error('Expected an authored camera.');
		Object.assign(project.camera, { keyframeSpace: 'screen' });
		expect(() => parseProject(JSON.stringify(project))).toThrow('Camera keyframe space');
	});

	it('should reject a visual model that disagrees with its collision geometry', () => {
		const project = createDemoProject();
		project.objects.push({ ...createWorldObject('rail', [0, -4, 0]), modelId: 'key-panel' });
		expect(() => parseProject(JSON.stringify(project))).toThrow(
			'Object model and collision kind do not match'
		);
	});

	it.each([
		['musicVolume', -0.01, 'Music volume'],
		['surfaceVolume', 1.01, 'Surface volume'],
		['surfacesEnabled', 'yes', 'Surface sound']
	] as const)('should reject an invalid sound mix %s', (field, value, message) => {
		const project = createDemoProject();
		const document = {
			...project,
			audio: { musicVolume: 0.7, surfaceVolume: 0.3, surfacesEnabled: true, [field]: value }
		};
		expect(() => parseProject(JSON.stringify(document))).toThrow(message);
	});

	it('should reject unsupported marble effects and out-of-range animation speeds', () => {
		const project = createDemoProject();
		expect(() => parseProject(JSON.stringify({ ...project, marbleEffect: 'unknown' }))).toThrow(
			'Marble effect'
		);
		project.marbles = [{ ...createExtraMarble(project), effectSpeed: 4.01 }];
		expect(() => parseProject(JSON.stringify(project))).toThrow('Marble effect speed');
	});
	it('should reject camera keys outside the duration and malformed rail geometry', () => {
		const project = createAuthoredTestProject();
		const invalidCamera = {
			...project,
			camera: {
				...project.camera,
				keyframes: [
					{
						id: 'late',
						time: project.duration + 1,
						position: [0, 0, 0],
						target: [0, 0, 0],
						fov: 38
					}
				]
			}
		};
		expect(() => parseProject(JSON.stringify(invalidCamera))).toThrow('Camera keyframe time');
		const invalidPath = {
			...project,
			objects: project.objects.map((object) => ({ ...object, path: [[0, 0, 0]] }))
		};
		expect(() => parseProject(JSON.stringify(invalidPath))).toThrow('at least two');
	});

	it.each([
		[
			'fractional pitches',
			(project: TProject) => {
				project.notes = project.notes.map((note) => ({ ...note, midi: 60.5 }));
			},
			'MIDI pitch must be a whole number'
		],
		[
			'fractional instruments',
			(project: TProject) => {
				project.tracks = project.tracks.map((track) => ({ ...track, instrument: 12.5 }));
			},
			'MIDI instrument must be a whole number'
		],
		[
			'notes beyond the project end',
			(project: TProject) => {
				project.notes = project.notes.map((note) => ({
					...note,
					time: project.duration - 0.1,
					duration: 1
				}));
			},
			'ends after the project'
		],
		[
			'missing note tracks',
			(project: TProject) => {
				project.notes = project.notes.map((note) => ({ ...note, trackId: 'missing' }));
			},
			'missing music track'
		],
		[
			'missing instrument notes',
			(project: TProject) => {
				project.objects = project.objects.map((object) => ({
					...object,
					binding: { noteId: 'missing', offset: [0, 0, 0] }
				}));
			},
			'missing MIDI note'
		],
		[
			'oversized projects',
			(project: TProject) => {
				project.duration = 121;
			},
			'Project duration'
		],
		[
			'unsafe coordinates',
			(project: TProject) => {
				project.launch.position = [1e9, 0, 0];
			},
			'Launch position'
		],
		[
			'invalid physical dimensions',
			(project: TProject) => {
				project.objects = project.objects.map((object) => ({ ...object, size: [0, 0.1, 1] }));
			},
			'Object size'
		]
	] as const)('should reject %s with a useful error', (_, mutate, message) => {
		const project = createDemoProject();
		mutate(project);
		expect(() => parseProject(JSON.stringify(project))).toThrow(message);
	});

	it.each(['tracks', 'notes', 'objects'] as const)(
		'should reject duplicate %s identifiers',
		(key) => {
			const project = createDemoProject();
			const first = project[key][0];
			if (first == null) throw new Error('Expected demonstration data.');
			const document = { ...project, [key]: [...project[key], first] };
			expect(() => parseProject(JSON.stringify(document))).toThrow('identifiers must be unique');
		}
	);

	it('should reject duplicate assignments of the same note to different instruments', () => {
		const project = createDemoProject();
		const first = project.objects[0];
		if (first == null) throw new Error('Expected a demonstration instrument.');
		project.objects.push({ ...first, id: 'duplicate-binding' });
		expect(() => parseProject(JSON.stringify(project))).toThrow('more than one instrument');
	});

	it.each([
		['tempos', { time: 3, bpm: 'fast' }, 'Tempo change BPM'],
		['controls', { number: 64.5, time: 1, value: 1 }, 'MIDI controller number'],
		['pitchBends', { time: 1, value: 2 }, 'Pitch bend value'],
		['pitchBends', { time: 50, value: 0 }, 'Pitch bend time']
	] as const)('should validate optional %s events', (key, event, message) => {
		const project = createDemoProject();
		const document =
			key === 'tempos'
				? { ...project, tempos: [event] }
				: { ...project, tracks: project.tracks.map((track) => ({ ...track, [key]: [event] })) };
		expect(() => parseProject(JSON.stringify(document))).toThrow(message);
	});

	it('should preserve explicit key mounting hardware and reject unknown styles', () => {
		const project = createDemoProject();
		const object = project.objects[0];
		if (!object) throw new Error('Expected instrument');
		object.mountStyle = 'folded';
		object.glowMode = 'contact';
		expect(parseProject(JSON.stringify(project)).objects[0]?.mountStyle).toBe('folded');
		expect(parseProject(JSON.stringify(project)).objects[0]?.glowMode).toBe('contact');
		const invalid = { ...project, objects: [{ ...object, mountStyle: 'glue' }] };
		expect(() => parseProject(JSON.stringify(invalid))).toThrow('Mount style');
	});
	it('should preserve the automatic multi-marble camera option and reject invalid values', () => {
		const project = createAuthoredTestProject();
		if (!project.camera) throw new Error('Expected an authored camera.');
		project.camera.followMarbles = true;
		expect(parseProject(JSON.stringify(project)).camera?.followMarbles).toBe(true);
		const invalid = { ...project, camera: { ...project.camera, followMarbles: 'yes' } };
		expect(() => parseProject(JSON.stringify(invalid))).toThrow('Camera follow marbles');
	});
	it('should normalize an older wall theme and discard retired camera metadata', () => {
		const project = createAuthoredTestProject();
		const older = {
			...project,
			scene: { ...project.scene, theme: 'reference' },
			camera: { ...project.camera, referenceOrbit: true }
		};
		expect(parseProject(JSON.stringify(older))).toEqual(project);
	});
	it('should reject malformed JSON and unsupported project versions', () => {
		expect(() => parseProject('{')).toThrow('not valid JSON');
		expect(() => parseProject(JSON.stringify({ ...createDemoProject(), version: 2 }))).toThrow(
			'version is not supported'
		);
	});

	it('should reject too many notes before reading their fields', () => {
		const project = createDemoProject();
		const document = { ...project, notes: new Array(2001).fill(null) };
		expect(() => parseProject(JSON.stringify(document))).toThrow('2,000 item limit');
	});
});

function createExtraMarble(project: TProject, id = 'harmony'): TMarbleDefinition {
	return {
		id,
		launch: structuredClone(project.launch),
		color: '#89d8b3'
	};
}
