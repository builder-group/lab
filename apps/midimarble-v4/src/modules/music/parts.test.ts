import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BACKING_ID, createProject, type THit, type TProject, type TSource } from '@/modules/project';
import { createAudioSignature, renderProjectAudio } from './audio-engine';
import { audibleProject, currentMix, EMPTY_MIX, hasSong, isPartAudible, mixLabel, mutedSoundtrackNote, SONG_MIX_ID, setPartSoundCommands, songParts, soundtrackProject } from './parts';

const SAMPLE_RATE = 22050;
const MIDI: TSource = { id: 'midi', kind: 'midi', path: 'song.mid', name: 'Song.mid', offset: 0 };
const AUDIO: TSource = { id: 'audio', kind: 'audio', path: 'audio/song.wav', name: 'Song.wav', offset: 0 };
const resolve = (source: { path: string }): string => `asset://${source.path}`;

function project(sources: TSource[], melody: THit[], bass: THit[], backing: THit[] = []): TProject {
	const base = createProject({ title: 'Parts' });
	return {
		...base,
		length: 2,
		music: {
			...base.music,
			sources,
			backing,
			backingInstrument: 12,
			lanes: [
				{ id: 'melody', name: 'Melody', color: '#3478f6', instrument: 9, hits: melody },
				{ id: 'bass', name: 'Bass', color: '#ff9f0a', instrument: 12, hits: bass }
			]
		}
	};
}

const note = (id: string, time: number, pitch = 60): THit => ({ id, time, pitch });
const tapped = (id: string, time: number): THit => ({ id, time });

function peak(samples: Float32Array, from: number, to: number): number {
	let max = 0;
	for (let index = Math.round(from * SAMPLE_RATE); index < Math.round(to * SAMPLE_RATE); index++) max = Math.max(max, Math.abs(samples[index] ?? 0));
	return max;
}

describe('songParts function', () => {
	it('should list each marble that plays notes, colored by marble, then Backing', () => {
		const parts = songParts(project([MIDI], [note('a', 1, 72), note('b', 0.5, 67)], [note('c', 1, 48)], [note('d', 1, 60)]));

		expect(parts.map((part) => [part.id, part.color, part.instrument, part.noteCount, part.firstPitch])).toEqual([
			['melody', '#3478f6', 9, 2, 67],
			['bass', '#ff9f0a', 12, 1, 48],
			[BACKING_ID, '#8e8e93', 12, 1, 60]
		]);
	});

	it('should have no Backing Part without Backing notes', () => {
		const parts = songParts(project([MIDI], [note('a', 1)], []));

		expect(parts.map((part) => part.id)).toEqual(['melody']);
		expect(mixLabel(project([MIDI], [note('a', 1)], []), { muted: [BACKING_ID], solo: [] })).toBeNull();
	});

	it('should leave out a marble with only tapped hits, which plays no notes', () => {
		const parts = songParts(project([MIDI], [tapped('a', 1)], [note('b', 1)]));

		expect(parts.map((part) => part.id)).toEqual(['bass']);
	});

	it('should have none for a recording or without a Song', () => {
		expect(songParts(project([AUDIO], [note('a', 1)], []))).toEqual([]);
		expect(songParts(project([], [note('a', 1)], []))).toEqual([]);
	});
});

describe('setPartSoundCommands function', () => {
	it('should set the lane instrument of a marble and the Backing instrument of Backing', () => {
		const song = project([MIDI], [note('a', 1)], []);

		expect(setPartSoundCommands(song, BACKING_ID, 8)).toEqual([{ type: 'setBackingInstrument', instrument: 8 }]);
		expect(setPartSoundCommands(song, 'melody', 8)).toEqual([{ type: 'upsertLane', lane: { ...song.music.lanes[0], instrument: 8 } }]);
	});
});

describe('audibleProject function', () => {
	const song = project([MIDI], [note('a', 0.5)], [note('b', 1)], [note('c', 1.5)]);

	it('should let a soloed Part win over a mute', () => {
		expect(isPartAudible({ muted: ['bass'], solo: ['bass'] }, 'bass')).toBe(true);
		expect(isPartAudible({ muted: [], solo: ['bass'] }, 'melody')).toBe(false);
		expect(isPartAudible({ muted: ['bass'], solo: [] }, 'bass')).toBe(false);
	});

	it('should return the project itself with everything on', () => {
		expect(audibleProject(song, EMPTY_MIX)).toBe(song);
	});

	it('should leave only the slice of a soloed marble', () => {
		const solo = audibleProject(song, { muted: [], solo: ['bass'] });

		expect(solo.music.lanes.map((lane) => lane.id)).toEqual(['bass']);
		expect(solo.music.backing).toEqual([]);
	});

	it('should mute and solo Backing like a marble', () => {
		expect(audibleProject(song, { muted: [BACKING_ID], solo: [] }).music.backing).toEqual([]);
		const solo = audibleProject(song, { muted: [], solo: [BACKING_ID] });
		expect(solo.music.lanes).toEqual([]);
		expect(solo.music.backing).toHaveLength(1);
	});

	it('should ignore a solo of a Part that has no notes left, so the Song stays audible', () => {
		const mix = { muted: [], solo: ['gone'] };

		expect(currentMix(song, mix).solo).toEqual([]);
		expect(audibleProject(song, mix)).toBe(song);
	});

	it('should silence a muted recording and leave a soloed one as it is', () => {
		const recording = project([AUDIO], [tapped('a', 1)], []);
		const muted = audibleProject(recording, { muted: [SONG_MIX_ID], solo: [] });

		expect(hasSong(muted)).toBe(false);
		expect(audibleProject(recording, { muted: [], solo: [SONG_MIX_ID] })).toBe(recording);
		expect(createAudioSignature(muted, resolve)).not.toBe(createAudioSignature(recording, resolve));
	});

	it('should re-render when the mix changes what sounds', () => {
		const heard = createAudioSignature(song, resolve);

		expect(createAudioSignature(audibleProject(song, { muted: ['melody'], solo: [] }), resolve)).not.toBe(heard);
	});
});

describe('soundtrackProject function', () => {
	const song = project([MIDI], [note('a', 0.5)], [note('b', 1)]);

	it('should keep muted Parts out and ignore solo', () => {
		expect(soundtrackProject(song, { muted: ['melody'], solo: [] }).music.lanes.map((lane) => lane.id)).toEqual(['bass']);
		expect(soundtrackProject(song, { muted: [], solo: ['melody'] })).toBe(song);
	});

	it('should name what is left out for the export sheet', () => {
		expect(mutedSoundtrackNote(song, EMPTY_MIX)).toBeNull();
		expect(mutedSoundtrackNote(song, { muted: [], solo: ['melody'] })).toBeNull();
		expect(mutedSoundtrackNote(song, { muted: ['melody'], solo: [] })).toBe("Melody is muted and left out of the film's sound.");
		expect(mutedSoundtrackNote(song, { muted: ['melody', 'bass'], solo: [] })).toBe("Melody and Bass are muted and left out of the film's sound.");
		expect(mutedSoundtrackNote(project([AUDIO], [], []), { muted: [SONG_MIX_ID], solo: [] })).toBe('The Song is muted, so the film has no sound.');
	});

	it('should say what the mix does on the Song row', () => {
		expect(mixLabel(song, EMPTY_MIX)).toBeNull();
		expect(mixLabel(song, { muted: ['bass'], solo: [] })).toBe('Bass muted');
		expect(mixLabel(song, { muted: [], solo: ['bass'] })).toBe('Solo Bass');
	});
});

describe('renderProjectAudio function', () => {
	beforeEach(() => {
		const bank = readFileSync(new URL('../../../public/audio/marble-instruments.sf2', import.meta.url));
		vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(bank))));
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const render = (song: TProject): ReturnType<typeof renderProjectAudio> => renderProjectAudio(song, () => null, { sampleRate: SAMPLE_RATE });

	it('should leave a muted Part out of the soundtrack and keep the others', async () => {
		const song = project([MIDI], [note('a', 0.2)], [note('b', 1.2)]);

		const full = await render(song);
		const film = await render(soundtrackProject(song, { muted: ['bass'], solo: [] }));

		expect(peak(full.left, 1.2, 1.4)).toBeGreaterThan(0.005);
		expect(peak(film.left, 0.2, 0.4)).toBeGreaterThan(0.005);
		expect(peak(film.left, 1.15, 1.2)).toBeLessThan(peak(full.left, 1.2, 1.4));
		expect(peak(film.left, 1.2, 1.4)).toBeLessThan(peak(full.left, 1.2, 1.4));
	});

	it('should hear only the soloed slice', async () => {
		const song = project([MIDI], [note('a', 0.2)], [note('b', 1.5)]);

		const solo = await render(audibleProject(song, { muted: [], solo: ['bass'] }));

		expect(peak(solo.left, 0, 1.4)).toBe(0);
		expect(peak(solo.left, 1.5, 1.7)).toBeGreaterThan(0.005);
	});

	it('should play nothing for a tapped hit, in a MIDI song and beside a note', async () => {
		const audio = await render(project([MIDI], [tapped('a', 0.2), note('b', 1.5)], [tapped('c', 0.5)]));

		expect(peak(audio.left, 0, 1.4)).toBe(0);
		expect(peak(audio.left, 1.5, 1.7)).toBeGreaterThan(0.005);
	});

	it('should play nothing at all without a Song, even for notes that keep a pitch', async () => {
		const audio = await render(project([], [note('a', 0.2)], [tapped('b', 0.5)]));

		expect(audio.left).toHaveLength(2 * SAMPLE_RATE);
		expect(peak(audio.left, 0, 2)).toBe(0);
		expect(fetch).not.toHaveBeenCalled();
	});
});
