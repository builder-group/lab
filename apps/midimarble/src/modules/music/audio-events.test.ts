import { describe, expect, it } from 'vitest';
import { createEmptyProject, type TProject } from '../project';
import { createAudioEvents } from './audio-events';

describe('createAudioEvents function', () => {
	it('should retain all unmuted tracks when no track is soloed', () => {
		const events = createAudioEvents(createScore(), 44100);
		expect([...new Set(events.map((event) => event.channel))]).toEqual([0, 1, 2]);
	});
	it('should filter notes, controllers and pitch bends to the soloed track together', () => {
		const project = createScore();
		project.tracks = project.tracks.map((track, index) => ({ ...track, solo: index === 1 }));
		const events = createAudioEvents(project, 44100);
		expect([...new Set(events.map((event) => event.channel))]).toEqual([1]);
		expect(events.map((event) => event.kind)).toEqual(['cc', 'bend', 'on', 'off']);
	});
	it('should allow multiple soloed tracks while mute still takes precedence', () => {
		const project = createScore();
		project.tracks = project.tracks.map((track, index) => ({
			...track,
			solo: true,
			muted: index === 0
		}));
		const events = createAudioEvents(project, 44100);
		expect([...new Set(events.map((event) => event.channel))]).toEqual([1, 2]);
	});
	it('should keep other tracks isolated when the only soloed track is muted', () => {
		const project = createScore();
		project.tracks = project.tracks.map((track, index) => ({
			...track,
			solo: index === 0,
			muted: index === 0
		}));
		expect(createAudioEvents(project, 44100)).toEqual([]);
	});
});

function createScore(): TProject {
	const project = createEmptyProject();
	project.tracks = [0, 1, 2].map((index) => ({
		id: `track-${index}`,
		name: `Track ${index}`,
		color: '#9675dc',
		instrument: 0,
		muted: false,
		controls: [{ number: 64, time: 0, value: 1 }],
		pitchBends: [{ time: 0.5, value: 0.25 }]
	}));
	project.notes = project.tracks.map((track, index) => ({
		id: `note-${index}`,
		trackId: track.id,
		time: 1,
		duration: 0.25,
		midi: 60 + index,
		velocity: 0.8
	}));
	return project;
}
