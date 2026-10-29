import { describe, expect, it } from 'vitest';
import type { TNote } from '../project';
import { getPlayingPitches } from './piano-playback';

describe('getPlayingPitches function', () => {
	it('should show every held key in a chord and release each at its own note end', () => {
		const notes: TNote[] = [
			{ id: 'c', trackId: 'piano', time: 1, duration: 2, midi: 60, velocity: 0.7 },
			{ id: 'e', trackId: 'piano', time: 1.5, duration: 1, midi: 64, velocity: 0.7 },
			{ id: 'silent', trackId: 'piano', time: 0, duration: 4, midi: 67, velocity: 0 }
		];
		expect([...getPlayingPitches(notes, 0.9)]).toEqual([]);
		expect([...getPlayingPitches(notes, 1)]).toEqual([60]);
		expect([...getPlayingPitches(notes, 1.5)]).toEqual([60, 64]);
		expect([...getPlayingPitches(notes, 2.5)]).toEqual([60]);
		expect([...getPlayingPitches(notes, 3)]).toEqual([]);
	});
	it('should retain a pitch while an overlapping note of the same pitch remains held', () => {
		const note: TNote = {
			id: 'first',
			trackId: 'piano',
			time: 0,
			duration: 1,
			midi: 60,
			velocity: 0.7
		};
		const notes = [note, { ...note, id: 'second', time: 0.5, duration: 1.5 }];
		expect([...getPlayingPitches(notes, 1.5)]).toEqual([60]);
		expect([...getPlayingPitches(notes, 0.25)]).toEqual([60]);
	});
});
