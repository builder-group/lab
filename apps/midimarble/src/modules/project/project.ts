import { objectCatalog } from './object-catalog';
import type {
	TLightingKeyframe,
	TNote,
	TProject,
	TSceneObject,
	TTrack,
	TVec3
} from './types';

export function createEmptyProject(): TProject {
	return {
		version: 1,
		id: crypto.randomUUID(),
		name: 'Untitled project',
		bpm: 120,
		duration: 16,
		notes: [],
		tracks: [{ id: 'piano', name: 'Piano', color: '#9675dc', instrument: 0, muted: false }],
		objects: [],
		launch: { position: [0, 4, 0.8], velocity: [1.1, -0.4, 0], radius: 0.24 },
		gravity: 9.81,
		restitution: 0.35,
		aspectRatio: '9:16',
		marbleColor: '#34896c',
		marbleStyle: 'ribbon',
		marbleEffect: 'none',
		scene: {
			theme: 'studio',
			wallPosition: 0,
			wallClearance: 0.06,
			background: '#c8c5bc',
			keyColor: '#fff0d8',
			fillColor: '#d4e3ed',
			exposure: 1.05,
			bloom: 0.35,
			keyPosition: [-5, 8, 6],
			keyIntensity: 2.5,
			fillIntensity: 0.05,
			environmentIntensity: 0.75
		},
		camera: {
			fov: 42,
			distance: 6.5,
			azimuth: 0.3,
			elevation: 0.12,
			lead: 0.08,
			followMarbles: true,
			keyframes: []
		}
	};
}

export function noteName(midi: number): string {
	return `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][Math.round(midi) % 12]}${Math.floor(midi / 12) - 1}`;
}

export function formatTime(time: number): string {
	const ticks = Math.round(Math.max(0, Number.isFinite(time) ? time : 0) * 100);
	const seconds = Math.floor(ticks / 100);
	return `${Math.floor(seconds / 60)
		.toString()
		.padStart(
			2,
			'0'
		)}:${(seconds % 60).toString().padStart(2, '0')}.${(ticks % 100).toString().padStart(2, '0')}`;
}

export function parseProject(text: string): TProject {
	if (text.length > 20 * 1024 * 1024) {
		throw new Error('Choose a MidiMarble project smaller than 20 MB.');
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error('This file is not valid JSON. Choose a saved MidiMarble project.');
	}
	const value = readRecord(parsed, 'MidiMarble project');
	if (value['version'] !== 1) throw new Error('This MidiMarble project version is not supported.');
	const duration = readNumber(value['duration'], 0.1, 120, 'Project duration');
	const tracks = readTracks(value['tracks'], duration);
	const notes = readNotes(value['notes'], duration, new Set(tracks.map((track) => track.id)));
	const objects = readObjects(value['objects'], new Set(notes.map((note) => note.id)), duration);
	const launch = readRecord(value['launch'], 'Marble launch');
	const project: TProject = {
		version: 1,
		id: readString(value['id'], 'Project identifier'),
		name: readString(value['name'], 'Project name', true),
		bpm: readNumber(value['bpm'], 10, 1000, 'Project tempo'),
		duration,
		tracks,
		notes,
		objects,
		launch: {
			position: readVector(launch['position'], -1_000_000, 1_000_000, 'Launch position'),
			velocity: readVector(launch['velocity'], -100, 100, 'Launch velocity'),
			radius: readNumber(launch['radius'], 0.05, 2, 'Marble radius')
		},
		gravity: readNumber(value['gravity'], 0.1, 40, 'Gravity'),
		restitution: readNumber(value['restitution'], 0, 1, 'Marble bounce'),
		aspectRatio: readChoice(value['aspectRatio'], ['9:16', '16:9', '1:1'], 'Aspect ratio'),
		marbleColor: readColor(value['marbleColor'], 'Marble color')
	};
	if (value['marbleStyle'] !== undefined)
		project.marbleStyle = readChoice(
			value['marbleStyle'],
			['ribbon', 'glass', 'chrome'] as const,
			'Marble style'
		);
	if (value['marbleEffect'] !== undefined)
		project.marbleEffect = readChoice(
			value['marbleEffect'],
			['none', 'iridescent', 'flow'] as const,
			'Marble effect'
		);
	if (value['marbleEffectSpeed'] !== undefined)
		project.marbleEffectSpeed = readNumber(value['marbleEffectSpeed'], 0, 4, 'Marble effect speed');
	if (value['audio'] !== undefined) {
		const audio = readRecord(value['audio'], 'Sound mix');
		project.audio = {
			musicVolume: readNumber(audio['musicVolume'], 0, 1, 'Music volume'),
			surfaceVolume: readNumber(audio['surfaceVolume'], 0, 1, 'Surface volume'),
			surfacesEnabled: readBoolean(audio['surfacesEnabled'], 'Surface sound')
		};
	}

	if (value['marbles'] !== undefined) {
		const ids = new Set<string>(['main']);
		project.marbles = readArray(value['marbles'], 8, 'Additional marbles').map((entry) => {
			const marble = readRecord(entry, 'Marble');
			const launch = readRecord(marble['launch'], 'Marble launch');
			const result: import('./types').TMarbleDefinition = {
				id: readIdentifier(marble['id'], ids, 'Marble'),
				launch: {
					position: readVector(launch['position'], -1_000_000, 1_000_000, 'Marble position'),
					velocity: readVector(launch['velocity'], -100, 100, 'Marble velocity'),
					radius: readNumber(launch['radius'], 0.05, 2, 'Marble radius')
				},
				color: readColor(marble['color'], 'Marble color')
			};
			if (marble['name'] !== undefined) result.name = readString(marble['name'], 'Marble name');
			if (marble['style'] !== undefined)
				result.style = readChoice(
					marble['style'],
					['ribbon', 'glass', 'chrome'] as const,
					'Marble style'
				);
			if (marble['effect'] !== undefined)
				result.effect = readChoice(
					marble['effect'],
					['none', 'iridescent', 'flow'] as const,
					'Marble effect'
				);
			if (marble['effectSpeed'] !== undefined)
				result.effectSpeed = readNumber(marble['effectSpeed'], 0, 4, 'Marble effect speed');
			if (marble['startTime'] !== undefined)
				result.startTime = readNumber(marble['startTime'], 0, duration, 'Marble start time');
			return result;
		});
	}
	const marbleIds = new Set(['main', ...(project.marbles ?? []).map((marble) => marble.id)]);
	for (const object of objects) {
		if (object.marbleId && !marbleIds.has(object.marbleId))
			throw new Error('An object references a missing marble.');
	}
	if (value['scene'] !== undefined) {
		const scene = readRecord(value['scene'], 'Scene style');
		project.scene = {
			theme: readChoice(scene['theme'] === 'reference' ? 'wall' : scene['theme'], ['studio', 'wall'], 'Scene theme'),
			background: readColor(scene['background'], 'Background color'),
			keyColor: readColor(scene['keyColor'], 'Key light color'),
			fillColor: readColor(scene['fillColor'], 'Fill light color'),
			exposure: readNumber(scene['exposure'], 0.05, 3, 'Exposure'),
			bloom: readNumber(scene['bloom'], 0, 3, 'Bloom')
		};
		if (scene['viewTransform'] !== undefined)
			project.scene.viewTransform = readChoice(
				scene['viewTransform'],
				['filmic', 'agx', 'neutral'] as const,
				'View transform'
			);
		if (scene['wallClearance'] !== undefined)
			project.scene.wallClearance = readNumber(scene['wallClearance'], 0.02, 5, 'Wall clearance');
		if (scene['wallPosition'] !== undefined)
			project.scene.wallPosition = readNumber(scene['wallPosition'], -1000, 1000, 'Wall position');
		if (scene['keyPosition'] !== undefined)
			project.scene.keyPosition = readVector(scene['keyPosition'], -100, 100, 'Key light position');
		if (scene['keyIntensity'] !== undefined)
			project.scene.keyIntensity = readNumber(scene['keyIntensity'], 0, 20, 'Key light strength');
		if (scene['fillIntensity'] !== undefined)
			project.scene.fillIntensity = readNumber(scene['fillIntensity'], 0, 3, 'Fill light strength');
		if (scene['environmentIntensity'] !== undefined)
			project.scene.environmentIntensity = readNumber(
				scene['environmentIntensity'],
				0,
				3,
				'Environment strength'
			);
		if (scene['keyframes'] !== undefined) {
			const ids = new Set<string>();
			project.scene.keyframes = readArray(scene['keyframes'], 1000, 'Lighting keyframes').map(
				(entry) => {
					const key = readRecord(entry, 'Lighting keyframe');
					const lighting: TLightingKeyframe = {
						id: readIdentifier(key['id'], ids, 'Lighting keyframe'),
						time: readNumber(key['time'], 0, duration, 'Lighting keyframe time'),
						background: readColor(key['background'], 'Background color'),
						keyColor: readColor(key['keyColor'], 'Key light color'),
						fillColor: readColor(key['fillColor'], 'Fill light color'),
						exposure: readNumber(key['exposure'], 0.05, 3, 'Exposure')
					};
					if (key['keyPosition'] !== undefined)
						lighting.keyPosition = readVector(key['keyPosition'], -100, 100, 'Key light position');
					if (key['keyIntensity'] !== undefined)
						lighting.keyIntensity = readNumber(key['keyIntensity'], 0, 20, 'Key light strength');
					if (key['fillIntensity'] !== undefined)
						lighting.fillIntensity = readNumber(key['fillIntensity'], 0, 3, 'Fill light strength');
					if (key['environmentIntensity'] !== undefined)
						lighting.environmentIntensity = readNumber(
							key['environmentIntensity'],
							0,
							3,
							'Environment strength'
						);
					return lighting;
				}
			);
		}
	}
	if (value['camera'] !== undefined) {
		const camera = readRecord(value['camera'], 'Camera settings');
		const ids = new Set<string>();
		project.camera = {
			fov: readNumber(camera['fov'], 10, 110, 'Camera field of view'),
			distance: readNumber(camera['distance'], 1, 200, 'Camera distance'),
			azimuth: readNumber(camera['azimuth'], -100, 100, 'Camera azimuth'),
			elevation: readNumber(camera['elevation'], -1.55, 1.55, 'Camera elevation'),
			lead: readNumber(camera['lead'], 0, 2, 'Camera lookahead'),
			keyframes: readArray(camera['keyframes'], 1000, 'Camera keyframes').map((entry) => {
				const key = readRecord(entry, 'Camera keyframe');
				return {
					id: readIdentifier(key['id'], ids, 'Camera keyframe'),
					time: readNumber(key['time'], 0, duration, 'Camera keyframe time'),
					position: readVector(key['position'], -1_000_000, 1_000_000, 'Camera position'),
					target: readVector(key['target'], -1_000_000, 1_000_000, 'Camera target'),
					fov: readNumber(key['fov'], 10, 110, 'Camera field of view')
				};
			})
		};
		if (camera['keyframeSpace'] !== undefined)
			project.camera.keyframeSpace = readChoice(
				camera['keyframeSpace'],
				['world', 'follow'] as const,
				'Camera keyframe space'
			);
		if (camera['followMarbles'] !== undefined)
			project.camera.followMarbles = readBoolean(camera['followMarbles'], 'Camera follow marbles');
	}
	if (value['titles'] !== undefined) {
		const ids = new Set<string>();
		project.titles = readArray(value['titles'], 100, 'Titles').map((entry) => {
			const clip = readRecord(entry, 'Title');
			const time = readNumber(clip['time'], 0, duration, 'Title time');
			return {
				id: readIdentifier(clip['id'], ids, 'Title'),
				time,
				duration: readNumber(
					clip['duration'],
					0.01,
					Math.max(0.01, duration - time),
					'Title duration'
				),
				text: readString(clip['text'], 'Title text')
			};
		});
	}
	if (value['cameraDistance'] !== undefined)
		project.cameraDistance = readNumber(value['cameraDistance'], 4, 35, 'Camera distance');
	if (value['tempos'] !== undefined) {
		project.tempos = readArray(value['tempos'], 10_000, 'Tempo changes').map((entry) => {
			const tempo = readRecord(entry, 'Tempo change');
			return {
				time: readNumber(tempo['time'], 0, duration, 'Tempo change time'),
				bpm: readNumber(tempo['bpm'], 10, 1000, 'Tempo change BPM')
			};
		});
	}
	return project;
}

export function downloadFile(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	try {
		triggerDownload(url, filename);
	} finally {
		// Embedded browsers may consume the blob after the click handler returns
		setTimeout(() => URL.revokeObjectURL(url), 60_000);
	}
}

export function triggerDownload(url: string, filename: string): void {
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	anchor.hidden = true;
	document.body.append(anchor);
	try {
		anchor.click();
	} finally {
		anchor.remove();
	}
}

function readTracks(input: unknown, duration: number): TTrack[] {
	const ids = new Set<string>();
	let eventCount = 0;
	return readArray(input, 64, 'Music tracks').map((entry): TTrack => {
		const value = readRecord(entry, 'Music track');
		const id = readIdentifier(value['id'], ids, 'Music track');
		const track: TTrack = {
			id,
			name: readString(value['name'], 'Track name', true),
			color: readColor(value['color'], 'Track color'),
			instrument: readInteger(value['instrument'], 0, 127, 'MIDI instrument'),
			muted: readBoolean(value['muted'], 'Track mute state')
		};
		if (value['percussion'] !== undefined) {
			track.percussion = readBoolean(value['percussion'], 'Track percussion state');
		}
		if (value['solo'] !== undefined) track.solo = readBoolean(value['solo'], 'Track solo state');
		if (value['controls'] !== undefined) {
			track.controls = readArray(value['controls'], 100_000, 'MIDI controllers').map((entry) => {
				const control = readRecord(entry, 'MIDI controller');
				return {
					number: readInteger(control['number'], 0, 127, 'MIDI controller number'),
					time: readNumber(control['time'], 0, duration, 'MIDI controller time'),
					value: readNumber(control['value'], 0, 1, 'MIDI controller value')
				};
			});
			eventCount += track.controls.length;
		}
		if (value['pitchBends'] !== undefined) {
			track.pitchBends = readArray(value['pitchBends'], 100_000, 'Pitch bends').map((entry) => {
				const bend = readRecord(entry, 'Pitch bend');
				return {
					time: readNumber(bend['time'], 0, duration, 'Pitch bend time'),
					value: readNumber(bend['value'], -1, 1, 'Pitch bend value')
				};
			});
			eventCount += track.pitchBends.length;
		}
		if (eventCount > 100_000) {
			throw new Error(
				'This project exceeds the 100,000 MIDI controller and pitch-bend event limit.'
			);
		}
		return track;
	});
}

function readNotes(input: unknown, duration: number, trackIds: Set<string>): TNote[] {
	const ids = new Set<string>();
	return readArray(input, 2000, 'MIDI notes').map((entry): TNote => {
		const value = readRecord(entry, 'MIDI note');
		const id = readIdentifier(value['id'], ids, 'MIDI note');
		const trackId = readString(value['trackId'], 'Note track identifier');
		if (!trackIds.has(trackId)) throw new Error('A MIDI note references a missing music track.');
		const time = readNumber(value['time'], 0, duration, 'Note start time');
		const noteDuration = readNumber(value['duration'], 0.001, duration, 'Note duration');
		if (time + noteDuration > duration + 1e-7) {
			throw new Error(
				'A MIDI note ends after the project. Extend the project or shorten the note.'
			);
		}
		return {
			id,
			trackId,
			time,
			duration: noteDuration,
			midi: readInteger(value['midi'], 0, 127, 'MIDI pitch'),
			velocity: readNumber(value['velocity'], 0, 1, 'Note velocity')
		};
	});
}

function readObjects(input: unknown, noteIds: Set<string>, duration: number): TSceneObject[] {
	const ids = new Set<string>();
	const boundNotes = new Set<string>();
	return readArray(input, 600, 'Scene objects').map((entry): TSceneObject => {
		const value = readRecord(entry, 'Scene object');
		const object: TSceneObject = {
			id: readIdentifier(value['id'], ids, 'Scene object'),
			name: readString(value['name'], 'Object name', true),
			kind: readChoice(value['kind'], ['bar', 'rail', 'bowl', 'bumper', 'drum'], 'Object kind'),
			binding: null,
			position: readVector(value['position'], -1_000_000, 1_000_000, 'Object position'),
			rotation: readVector(value['rotation'], -1000, 1000, 'Object rotation'),
			size: readVector(value['size'], 0.02, 50, 'Object size'),
			restitution: readNumber(value['restitution'], 0, 1, 'Object bounce'),
			material: readChoice(
				value['material'],
				['wood', 'metal', 'rubber', 'glass'],
				'Object material'
			)
		};
		if (value['friction'] !== undefined)
			object.friction = readNumber(value['friction'], 0, 2, 'Surface friction');
		if (value['glowMode'] !== undefined)
			object.glowMode = readChoice(value['glowMode'], ['impact', 'contact'] as const, 'Glow mode');
		if (value['mountStyle'] !== undefined)
			object.mountStyle = readChoice(
				value['mountStyle'],
				['none', 'pins', 'folded', 'folded-front', 'rack'] as const,
				'Mount style'
			);
		if (value['roundedNose'] !== undefined)
			object.roundedNose = readBoolean(value['roundedNose'], 'Rounded nose');
		if (value['marbleId'] !== undefined)
			object.marbleId = readString(value['marbleId'], 'Object marble');
		if (value['modelId'] !== undefined)
			object.modelId = readChoice(
				value['modelId'],
				[
					'key-bar',
					'key-block',
					'key-panel',
					'key-strip',
					'key-spoon',
					'rail-curve',
					'rail-wave',
					'rail-straight',
					'steel-pan',
					'bowl',
					'bumper'
				] as const,
				'Object model'
			);
		if (value['trajectoryAnchor'] !== undefined) {
			if (value['binding'] !== null)
				throw new Error('An object can follow a note or a trajectory time, not both.');
			const anchor = readRecord(value['trajectoryAnchor'], 'Trajectory anchor');
			object.trajectoryAnchor = {
				time: readNumber(anchor['time'], 0, duration, 'Trajectory anchor time'),
				offset: readVector(anchor['offset'], -1_000_000, 1_000_000, 'Trajectory anchor offset')
			};
		}
		if (
			object.modelId &&
			objectCatalog.find((model) => model.id === object.modelId)?.kind !== object.kind
		)
			throw new Error('Object model and collision kind do not match.');
		if (value['color'] !== undefined) object.color = readColor(value['color'], 'Object color');
		if (value['materialFinish'] !== undefined)
			object.materialFinish = readChoice(
				value['materialFinish'],
				['bare', 'painted'] as const,
				'Material finish'
			);
		if (value['glowColor'] !== undefined)
			object.glowColor = readColor(value['glowColor'], 'Impact glow color');
		if (value['glowFade'] !== undefined)
			object.glowFade = readNumber(value['glowFade'], 0.05, 3, 'Afterglow duration');
		if (value['glowBalance'] !== undefined)
			object.glowBalance = readNumber(value['glowBalance'], 0.05, 0.95, 'Glow color balance');
		if (value['glowEndColor'] !== undefined)
			object.glowEndColor = readColor(value['glowEndColor'], 'Glow end color');
		if (value['emission'] !== undefined)
			object.emission = readNumber(value['emission'], 0, 5, 'Impact emission');
		if (value['flex'] !== undefined) object.flex = readNumber(value['flex'], 0, 2, 'Surface flex');
		if (value['disabled'] !== undefined)
			object.disabled = readBoolean(value['disabled'], 'Object disabled state');
		if (value['locked'] !== undefined)
			object.locked = readBoolean(value['locked'], 'Object edit lock');
		if (value['path'] !== undefined) {
			object.path = readArray(value['path'], 128, 'Rail control points').map((point) =>
				readVector(point, -100, 100, 'Rail control point')
			);
			if (object.path.length < 2)
				throw new Error('A rail curve needs at least two control points.');
		}
		if (value['binding'] === null) return object;
		const binding = readRecord(value['binding'], 'Instrument note assignment');
		const noteId = readString(binding['noteId'], 'Instrument note identifier');
		if (!noteIds.has(noteId)) throw new Error('An instrument references a missing MIDI note.');
		if (boundNotes.has(noteId))
			throw new Error('A MIDI note is assigned to more than one instrument.');
		boundNotes.add(noteId);
		object.binding = {
			noteId,
			offset: readVector(binding['offset'], -1_000_000, 1_000_000, 'Instrument offset')
		};
		return object;
	});
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
	if (value == null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${label} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function readArray(value: unknown, limit: number, label: string): unknown[] {
	if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
	if (value.length > limit)
		throw new Error(`${label} exceed the ${limit.toLocaleString('en-US')} item limit.`);
	return value;
}

function readString(value: unknown, label: string, allowEmpty = false): string {
	if (typeof value !== 'string' || value.length > 160 || (!allowEmpty && !value.trim().length)) {
		throw new Error(
			`${label} must be ${allowEmpty ? 'a' : 'a nonempty'} string of up to 160 characters.`
		);
	}
	return value;
}

function readIdentifier(value: unknown, existing: Set<string>, label: string): string {
	const id = readString(value, `${label} identifier`);
	if (existing.has(id)) throw new Error(`${label} identifiers must be unique.`);
	existing.add(id);
	return id;
}

function readNumber(value: unknown, min: number, max: number, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
		throw new Error(`${label} must be a finite number between ${min} and ${max}.`);
	}
	return value;
}

function readInteger(value: unknown, min: number, max: number, label: string): number {
	const number = readNumber(value, min, max, label);
	if (!Number.isInteger(number)) throw new Error(`${label} must be a whole number.`);
	return number;
}

function readVector(value: unknown, min: number, max: number, label: string): TVec3 {
	if (!Array.isArray(value) || value.length !== 3)
		throw new Error(`${label} must contain three coordinates.`);
	return [
		readNumber(value[0], min, max, label),
		readNumber(value[1], min, max, label),
		readNumber(value[2], min, max, label)
	];
}

function readBoolean(value: unknown, label: string): boolean {
	if (typeof value !== 'boolean') throw new Error(`${label} must be true or false.`);
	return value;
}

function readColor(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value))
		throw new Error(`${label} must be a six-digit hex color.`);
	return value;
}

function readChoice<T extends string>(value: unknown, choices: readonly T[], label: string): T {
	const choice = choices.find((choice) => choice === value);
	if (choice == null) throw new Error(`${label} is not supported.`);
	return choice;
}
