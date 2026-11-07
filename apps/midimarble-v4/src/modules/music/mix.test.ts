import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMarble, createProject, type THit, type TProject, type TSong, backingOf } from '@/modules/project';
import { createAudioSignature, renderProjectAudio } from './audio-engine';
import { soundingMarbles } from './synthesize';
import { audibleProject, currentMix, EMPTY_MIX, hasSong, isAudible, isHitAudible, marbleSounds, mutedSoundtrackNote, soundtrackProject } from './mix';

const SAMPLE_RATE = 22050;
const MIDI: TSong = { id: 'midi', kind: 'midi', path: 'song.mid', name: 'Song.mid', start: 0, backing: [] };
const AUDIO: TSong = { id: 'audio', kind: 'audio', path: 'audio/song.wav', name: 'Song.wav', start: 0, backing: [] };
const resolve = (source: TSong): string => `asset://${source.path ?? ''}`;

function project(songs: TSong[], melody: THit[], bass: THit[], backing: THit[] = []): TProject {
	const base = createProject({ title: 'Mix' });
	return {
		...base,
		length: 2,
		songs: songs.map((song) => ({ ...song, backing, backingSound: 12 })),
		marbles: [
			{ ...createMarble(0, { x: 0, y: 0 }, 'melody'), name: 'Melody', labelColor: '#3478f6', sound: 9, hits: melody },
			{ ...createMarble(1, { x: 0.26, y: 0 }, 'bass'), name: 'Bass', labelColor: '#ff9f0a', sound: 12, hits: bass }
		]
	};
}

const note = (id: string, time: number, pitch = 60): THit => ({ id, time, pitch });
const tapped = (id: string, time: number): THit => ({ id, time });

function peak(samples: Float32Array, from: number, to: number): number {
	let max = 0;
	for (let index = Math.round(from * SAMPLE_RATE); index < Math.round(to * SAMPLE_RATE); index++) max = Math.max(max, Math.abs(samples[index] ?? 0));
	return max;
}

const hitsOf = (song: TProject, id: string): string[] => song.marbles.find((marble) => marble.id === id)?.hits.map((hit) => hit.id) ?? [];

describe('marbleSounds function', () => {
	it('should say a marble with notes sounds and one with only tapped hits does not', () => {
		const song = project([MIDI], [tapped('a', 1)], [note('b', 1)]);

		expect(song.marbles.map((marble) => marbleSounds(song, marble))).toEqual([false, true]);
	});

	it('should say a marble whose notes are all in a recording does not, since Mute and Sound would do nothing', () => {
		const song = project([AUDIO], [{ ...note('a', 1), songId: 'audio' }], [note('b', 1)]);

		expect(song.marbles.map((marble) => marbleSounds(song, marble))).toEqual([false, true]);
	});
});

describe('audibleProject function', () => {
	const tie = (hit: THit): THit => ({ ...hit, songId: 'midi' });
	const song = project([MIDI], [note('a', 0.5)], [note('b', 1)], [note('c', 1.5)]);

	it('should let a soloed marble win over a mute', () => {
		expect(isAudible({ muted: ['bass'], solo: ['bass'] }, 'bass')).toBe(true);
		expect(isAudible({ muted: [], solo: ['bass'] }, 'melody')).toBe(false);
		expect(isAudible({ muted: ['bass'], solo: [] }, 'bass')).toBe(false);
	});

	it('should return the project itself with everything on', () => {
		expect(audibleProject(song, EMPTY_MIX)).toBe(song);
	});

	it('should leave only the hits of a soloed marble', () => {
		const solo = audibleProject(song, { muted: [], solo: ['bass'] });

		expect(hitsOf(solo, 'melody')).toEqual([]);
		expect(hitsOf(solo, 'bass')).toEqual(['b']);
		expect(backingOf(solo)).toEqual([]);
	});

	it('should take Backing and the tied hits out with a muted song and leave the marble its own hits', () => {
		const tied = project([MIDI], [tie(note('a', 0.5)), note('own', 0.8)], [note('b', 1)], [note('c', 1.5)]);

		const muted = audibleProject(tied, { muted: ['midi'], solo: [] });

		expect(hitsOf(muted, 'melody')).toEqual(['own']);
		expect(hitsOf(muted, 'bass')).toEqual(['b']);
		expect(backingOf(muted)).toEqual([]);
	});

	it('should not give a soloed marble\'s hits in a recording its Sound', () => {
		// Prepare
		const tied = project([AUDIO], [{ ...note('a', 0.2), songId: AUDIO.id }, note('b', 1.2)], []);

		// Act
		const solo = audibleProject(tied, { muted: [], solo: ['melody'] });

		// Assert
		expect(soundingMarbles(tied)[0]?.hits.map((hit) => hit.id)).toEqual(['b']);
		expect(soundingMarbles(solo)[0]?.hits.map((hit) => hit.id)).toEqual(['b']);
		expect(solo.songs).toEqual([]);
	});

	it('should hear only what a soloed song plays', () => {
		const tied = project([MIDI], [tie(note('a', 0.5)), note('own', 0.8)], [], [note('c', 1.5)]);

		const solo = audibleProject(tied, { muted: [], solo: ['midi'] });

		expect(hitsOf(solo, 'melody')).toEqual(['a']);
		expect(backingOf(solo)).toHaveLength(1);
	});

	it('should let a soloed marble play a hit tied to a muted song', () => {
		expect(isHitAudible({ muted: ['midi'], solo: ['melody'] }, 'melody', 'midi')).toBe(true);
		expect(isHitAudible({ muted: ['midi'], solo: [] }, 'melody', 'midi')).toBe(false);
	});

	it('should ignore a solo of a marble that has no notes left, so the rest stays audible', () => {
		const mix = { muted: [], solo: ['gone'] };

		expect(currentMix(song, mix).solo).toEqual([]);
		expect(audibleProject(song, mix)).toBe(song);
	});

	it('should silence a muted recording and leave a soloed one as it is', () => {
		const recording = project([AUDIO], [tapped('a', 1)], []);
		const muted = audibleProject(recording, { muted: ['audio'], solo: [] });

		expect(hasSong(muted)).toBe(false);
		expect(audibleProject(recording, { muted: [], solo: ['audio'] }).songs).toEqual(recording.songs);
		expect(createAudioSignature(muted, resolve)).not.toBe(createAudioSignature(recording, resolve));
	});

	it('should mix every recording at its start, in what a film and playback hear alike', () => {
		const first = { ...AUDIO, id: 'first', path: 'audio/a.wav', start: 1 };
		const second = { ...AUDIO, id: 'second', path: 'audio/b.wav', start: 5 };
		const both = project([first, second], [], []);
		const signature = JSON.parse(createAudioSignature(both, resolve)) as { audioSources: { url: string; offset: number }[] };

		expect(signature.audioSources).toEqual([
			{ url: 'asset://audio/a.wav', offset: 1 },
			{ url: 'asset://audio/b.wav', offset: 5 }
		]);
		expect(soundtrackProject(both, { muted: ['first'], solo: [] }).songs.map((song) => song.id)).toEqual(['second']);
	});

	it('should re-render when the mix changes what sounds', () => {
		const heard = createAudioSignature(song, resolve);

		expect(createAudioSignature(audibleProject(song, { muted: ['melody'], solo: [] }), resolve)).not.toBe(heard);
	});
});

describe('soundtrackProject function', () => {
	const song = project([MIDI], [note('a', 0.5)], [note('b', 1)]);

	it('should keep what is muted out and ignore solo', () => {
		expect(hitsOf(soundtrackProject(song, { muted: ['melody'], solo: [] }), 'melody')).toEqual([]);
		expect(hitsOf(soundtrackProject(song, { muted: ['melody'], solo: [] }), 'bass')).toEqual(['b']);
		expect(soundtrackProject(song, { muted: [], solo: ['melody'] })).toBe(song);
	});

	it('should name what is left out for the export sheet', () => {
		expect(mutedSoundtrackNote(song, EMPTY_MIX)).toBeNull();
		expect(mutedSoundtrackNote(song, { muted: [], solo: ['melody'] })).toBeNull();
		expect(mutedSoundtrackNote(song, { muted: ['melody'], solo: [] })).toBe("Melody is muted and left out of the film's sound.");
		expect(mutedSoundtrackNote(song, { muted: ['melody', 'bass'], solo: [] })).toBe("Melody and Bass are muted and left out of the film's sound.");
		expect(mutedSoundtrackNote(project([AUDIO], [], []), { muted: ['audio'], solo: [] })).toBe("Song.wav is muted and left out of the film's sound.");
	});
});

/** Decodes any bytes to a second of a steady tone, as tests have no WebAudio */
function stubDecoder(): void {
	const samples = new Float32Array(48000).fill(0.5);
	vi.stubGlobal('OfflineAudioContext', class {
		decodeAudioData = async (): Promise<unknown> => ({ numberOfChannels: 1, length: samples.length, sampleRate: 48000, duration: 1, getChannelData: () => samples });
	});
}

describe('a missing recording', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const missing = (id: string): TProject => project([{ ...AUDIO, id, path: `audio/${id}.wav`, name: `${id}.wav` }], [], []);
	const render = (song: TProject): ReturnType<typeof renderProjectAudio> => renderProjectAudio(song, resolve, { sampleRate: SAMPLE_RATE });

	it('should play once the file is back, with no restart', async () => {
		// Prepare
		stubDecoder();
		let isGone = true;
		vi.stubGlobal('fetch', vi.fn(async () => (isGone ? new Response(null, { status: 404 }) : new Response(new Uint8Array(4)))));
		const song = missing('comes-back');
		const silent = await render(song);

		// Act
		isGone = false;
		const restored = await render(song);

		// Assert
		expect(peak(silent.left, 0, 1)).toBe(0);
		expect(peak(restored.left, 0, 1)).toBeGreaterThan(0.1);
	});

	it('should render without a file that fails to load or decode', async () => {
		// Prepare
		vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Load failed'); }));

		// Act
		const audio = await render(missing('never-there'));

		// Assert
		expect(peak(audio.left, 0, 1)).toBe(0);
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

	it('should leave a muted marble out of the soundtrack and keep the others', async () => {
		const song = project([MIDI], [note('a', 0.2)], [note('b', 1.2)]);

		const full = await render(song);
		const film = await render(soundtrackProject(song, { muted: ['bass'], solo: [] }));

		expect(peak(full.left, 1.2, 1.4)).toBeGreaterThan(0.005);
		expect(peak(film.left, 0.2, 0.4)).toBeGreaterThan(0.005);
		expect(peak(film.left, 1.15, 1.2)).toBeLessThan(peak(full.left, 1.2, 1.4));
		expect(peak(film.left, 1.2, 1.4)).toBeLessThan(peak(full.left, 1.2, 1.4));
	});

	it('should hear only the soloed marble', async () => {
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

	it("should play a marble's own notes with its Sound without a Song, and nothing for tapped hits", async () => {
		const audio = await render(project([], [note('a', 0.2)], [tapped('b', 1.5)]));

		expect(audio.left).toHaveLength(2 * SAMPLE_RATE);
		expect(peak(audio.left, 0.2, 0.4)).toBeGreaterThan(0.005);
		expect(peak(audio.left, 1.5, 1.7)).toBeLessThan(0.005);
	});

	it('should play every song: each Backing with its own Sound and the notes tied to each at their times', async () => {
		const second: TSong = { ...MIDI, id: 'second', name: 'Second.mid', path: 'second.mid', start: 1 };
		const song: TProject = {
			...project([MIDI], [{ ...note('a', 0.2), songId: 'midi' }], [{ ...note('b', 1.5), songId: 'second' }]),
			songs: [
				{ ...MIDI, backing: [] },
				{ ...second, backing: [{ id: 'c', time: 1, pitch: 48, duration: 0.2 }], backingSound: 12 }
			]
		};

		const audio = await render(song);

		expect(peak(audio.left, 0.2, 0.4)).toBeGreaterThan(0.005);
		expect(peak(audio.left, 1, 1.15)).toBeGreaterThan(0.005);
		expect(peak(audio.left, 1.5, 1.7)).toBeGreaterThan(0.005);

		const without = await render(soundtrackProject(song, { muted: ['second'], solo: [] }));
		expect(peak(without.left, 0.2, 0.4)).toBeGreaterThan(0.005);
		expect(peak(without.left, 1.1, 1.9)).toBeLessThan(peak(audio.left, 1.5, 1.7));
	});

	it('should be silent without notes or files, and need no instruments for that', async () => {
		const audio = await render(project([], [tapped('a', 0.2)], []));

		expect(peak(audio.left, 0, 2)).toBe(0);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("should add nothing for a hit tied to a recording, and play a marble's own note beside it", async () => {
		const tied = await render(project([AUDIO], [{ ...note('a', 0.2), songId: 'audio' }], []));
		expect(peak(tied.left, 0, 2)).toBe(0);

		const own = await render(project([AUDIO], [note('a', 0.2)], []));
		expect(peak(own.left, 0.2, 0.4)).toBeGreaterThan(0.005);
	});
});
