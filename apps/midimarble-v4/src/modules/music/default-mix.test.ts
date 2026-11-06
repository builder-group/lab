import { readFileSync } from 'node:fs';
import { SoundBankLoader, type BasicSoundBank } from 'spessasynth_core';
import { beforeAll, describe, expect, it } from 'vitest';
import type { TMarble, TProject } from '@/modules/project';
import { renderProjectAudio } from './audio-engine';
import { autoLevelLabel, formatLevel, melodyMarbleId, partLevel, UNDER_MELODY } from './default-mix';
import { measureLoudness } from './loudness';
import { audibleProject } from './mix';

const SAMPLE_RATE = 48000;

function marble(id: string, pitches: number[], extra: Partial<TMarble> = {}): TMarble {
	return { id, name: id, labelColor: '#3478f6', sound: 0, radius: 0.012, start: { position: { x: 0, y: 0 }, time: 0 }, hits: pitches.map((pitch, index) => ({ id: `${id}-${index}`, time: 0.2 + index * 0.25, pitch })), ...extra };
}

function song(...marbles: TMarble[]): TProject {
	return { songs: [], marbles, length: 1.5 } as unknown as TProject;
}

describe('melodyMarbleId function', () => {
	it('should choose the marble whose notes sit highest', () => {
		expect(melodyMarbleId(song(marble('bass', [40, 43]), marble('melody', [72, 76])))).toBe('melody');
	});

	it('should go by the median, so one stray high note does not make a bass the melody', () => {
		expect(melodyMarbleId(song(marble('bass', [40, 41, 42, 96]), marble('melody', [60, 62, 64, 66])))).toBe('melody');
	});

	it('should take the first on a tie and have none when no marble sounds', () => {
		expect(melodyMarbleId(song(marble('a', [60]), marble('b', [60])))).toBe('a');
		expect(melodyMarbleId(song(marble('tapped', [])))).toBeNull();
	});
});

describe('partLevel function', () => {
	it('should leave the melody as it is and put the rest under it', () => {
		expect(partLevel(undefined, 'melody', 'melody')).toEqual({ gain: 0, isLowCut: false });
		expect(partLevel(undefined, 'bass', 'melody')).toEqual({ gain: UNDER_MELODY, isLowCut: true });
		expect(partLevel(undefined, null, 'melody')).toEqual({ gain: UNDER_MELODY, isLowCut: true });
	});

	it('should leave Backing alone when no marble sounds', () => {
		expect(partLevel(undefined, null, null)).toEqual({ gain: 0, isLowCut: false });
	});

	it('should let a level a person set win, on the melody and on the rest', () => {
		expect(partLevel(-3, 'bass', 'melody')).toEqual({ gain: -3, isLowCut: false });
		expect(partLevel(-6, 'melody', 'melody')).toEqual({ gain: -6, isLowCut: false });
	});
});

describe('autoLevelLabel function', () => {
	it('should say what automatic means for this part', () => {
		expect(autoLevelLabel('melody', 'melody')).toBe('Auto · Melody');
		expect(autoLevelLabel('bass', 'melody')).toBe('Auto · −10 dB');
		expect(autoLevelLabel(null, null)).toBe('Auto');
		expect(formatLevel(-3)).toBe('−3 dB');
	});
});

describe('the mix in the soundtrack', () => {
	let bank: BasicSoundBank;
	beforeAll(() => {
		bank = SoundBankLoader.fromArrayBuffer(new Uint8Array(readFileSync(new URL('../../../public/audio/marble-instruments.sf2', import.meta.url))).buffer);
	});

	const lufs = async (project: TProject, mixedAs?: TProject): Promise<number> => {
		const audio = await renderProjectAudio(project, () => null, { sampleRate: SAMPLE_RATE, bank, mixedAs });
		return measureLoudness(audio).lufs ?? -Infinity;
	};

	const LOW = [52, 52, 52, 52, 52];
	const HIGH = [76, 76, 76, 76, 76];

	it('should play the lower marble quieter beside a higher one than as the only marble', async () => {
		const alone = await lufs(song(marble('bass', LOW)));
		const under = await lufs(audibleProject(song(marble('bass', LOW), marble('melody', HIGH)), { muted: ['melody'], solo: [] }), song(marble('bass', LOW), marble('melody', HIGH)));
		expect(under).toBeLessThan(alone - 8);
	});

	it('should keep a part heard alone at its place in the mix', async () => {
		const whole = song(marble('bass', LOW), marble('melody', HIGH));
		const soloed = await lufs(audibleProject(whole, { muted: [], solo: ['bass'] }), whole);
		const heardAsMelody = await lufs(audibleProject(whole, { muted: [], solo: ['bass'] }));
		expect(soloed).toBeLessThan(heardAsMelody - 8);
	});

	it('should play a marble at the level a person set', async () => {
		const set = await lufs(song(marble('bass', LOW, { level: -3 }), marble('melody', [])));
		const alone = await lufs(song(marble('bass', LOW)));
		expect(set).toBeCloseTo(alone - 3, 0);
	});
});
