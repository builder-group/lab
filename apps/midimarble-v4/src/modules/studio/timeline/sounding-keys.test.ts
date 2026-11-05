import { describe, expect, it } from 'vitest';
import { BACKING_COLOR } from '@/modules/music';
import { createMarble, createProject, type THit, type TProject, type TSong } from '@/modules/project';
import { noteSpans, soundingKeys } from './sounding-keys';

const MIDI: TSong = { id: 'midi', kind: 'midi', path: 'song.mid', name: 'Song.mid', start: 0, backing: [] };

function song(melody: THit[], backing: THit[] = [], songs: TSong[] = [MIDI]): TProject {
	const base = createProject({ title: 'Keys' });
	return { ...base, songs: songs.map((item) => ({ ...item, backing })), marbles: [{ ...createMarble(0, { x: 0, y: 0 }, 'melody'), name: 'Melody', labelColor: '#3478f6', sound: 0, hits: melody }] };
}

describe('soundingKeys function', () => {
	it('should light a key in its marble color for as long as the note sounds', () => {
		const spans = noteSpans(song([{ id: 'a', time: 1, pitch: 60, duration: 0.25 }]));

		expect(soundingKeys(spans, 0.99).size).toBe(0);
		expect(soundingKeys(spans, 1.1).get(60)).toBe('#3478f6');
		expect(soundingKeys(spans, 1.25).size).toBe(0);
	});

	it('should release a marble note at its next note and light Backing in gray', () => {
		const spans = noteSpans(
			song(
				[
					{ id: 'a', time: 1, pitch: 60, duration: 0.5 },
					{ id: 'b', time: 1.2, pitch: 62, duration: 0.5 }
				],
				[{ id: 'c', time: 1, pitch: 48, duration: 2 }]
			)
		);

		expect([...soundingKeys(spans, 1.1).entries()]).toEqual([
			[60, '#3478f6'],
			[48, BACKING_COLOR]
		]);
		expect([...soundingKeys(spans, 1.3).keys()].sort()).toEqual([48, 62]);
	});

	it('should show the later note when two notes share a key', () => {
		const spans = noteSpans(song([{ id: 'a', time: 1, pitch: 60, duration: 0.5 }], [{ id: 'b', time: 0.9, pitch: 60, duration: 1 }]));

		expect(soundingKeys(spans, 1.1).get(60)).toBe('#3478f6');
		expect(soundingKeys(spans, 1.7).get(60)).toBe(BACKING_COLOR);
	});

	it('should light nothing for a recording, whose hits make no sound of their own', () => {
		const audio: TSong = { id: 'audio', kind: 'audio', path: 'a.wav', name: 'a.wav', start: 0, backing: [] };

		expect(noteSpans(song([{ id: 'a', time: 1, pitch: 60 }], [], [audio]))).toEqual([]);
	});
});
