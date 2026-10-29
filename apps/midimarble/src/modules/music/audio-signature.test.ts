import { createDemoProject } from '../project/fixtures/sample-project';
import { describe, expect, it } from 'vitest';
import { type TProject } from '../project';
import { getAudioSignature } from './audio-signature';

describe('getAudioSignature function', () => {
	it('should reuse the soundtrack after track naming, color and scene changes', () => {
		const project = createDemoProject();
		const edited = structuredClone(project);
		edited.name = 'New film';
		edited.objects = [];
		edited.tracks = edited.tracks.map((track) => ({
			...track,
			name: 'New track',
			color: '#abcdef'
		}));
		edited.notes = edited.notes.map((note) => ({ ...note, id: `renamed-${note.id}` }));
		expect(getAudioSignature(edited)).toBe(getAudioSignature(project));
	});
	it.each<[string, (project: TProject) => void]>([
		[
			'timing',
			(project) => {
				const note = project.notes[0];
				if (note) note.time += 0.1;
			}
		],
		[
			'expression',
			(project) => {
				const note = project.notes[0];
				if (note) note.velocity = 0.2;
			}
		],
		[
			'instrument',
			(project) => {
				const track = project.tracks[0];
				if (track) track.instrument = 0;
			}
		],
		[
			'Solo',
			(project) => {
				const track = project.tracks[0];
				if (track) track.solo = true;
			}
		],
		[
			'sustain',
			(project) => {
				const track = project.tracks[0];
				if (track) track.controls = [{ number: 64, time: 0, value: 1 }];
			}
		],
		[
			'pitch bend',
			(project) => {
				const track = project.tracks[0];
				if (track) track.pitchBends = [{ time: 0, value: 0.5 }];
			}
		]
	])('should invalidate the soundtrack when %s changes', (_, change) => {
		const project = createDemoProject();
		const edited = structuredClone(project);
		change(edited);
		expect(getAudioSignature(edited)).not.toBe(getAudioSignature(project));
	});
	it('should keep playing while muted notes change and invalidate when their track is unmuted', () => {
		const project = createDemoProject();
		project.tracks = project.tracks.map((track) => ({ ...track, muted: true }));
		const edited = structuredClone(project);
		edited.notes = edited.notes.map((note) => ({ ...note, midi: note.midi + 1 }));
		expect(getAudioSignature(edited)).toBe(getAudioSignature(project));
		edited.tracks = edited.tracks.map((track) => ({ ...track, muted: false }));
		expect(getAudioSignature(edited)).not.toBe(getAudioSignature(project));
	});
	it('should treat omitted and disabled Solo identically for older projects', () => {
		const project = createDemoProject();
		const edited = structuredClone(project);
		edited.tracks = edited.tracks.map((track) => ({ ...track, solo: false }));
		expect(getAudioSignature(edited)).toBe(getAudioSignature(project));
	});
});
