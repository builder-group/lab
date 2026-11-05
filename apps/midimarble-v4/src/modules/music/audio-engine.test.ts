import { describe, expect, it } from 'vitest';
import { createMarble, createProject, type TProject, type TSong } from '@/modules/project';
import { createAudioSignature, encodeWav } from './audio-engine';
import { computePeaks } from './waveform';

describe('encodeWav function', () => {
	it('should write a 16-bit stereo PCM header and clamped samples', () => {
		const bytes = encodeWav(new Float32Array([0, 1, -1]), new Float32Array([0.5, 2, -2]), 48000);
		const view = new DataView(bytes.buffer);
		const text = (offset: number): string =>
			String.fromCharCode(...bytes.subarray(offset, offset + 4));

		expect(bytes).toHaveLength(44 + 12);
		expect([text(0), text(8), text(12), text(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
		expect(view.getUint32(4, true)).toBe(36 + 12);
		expect(view.getUint16(20, true)).toBe(1);
		expect(view.getUint16(22, true)).toBe(2);
		expect(view.getUint32(24, true)).toBe(48000);
		expect(view.getUint32(28, true)).toBe(48000 * 4);
		expect(view.getUint16(32, true)).toBe(4);
		expect(view.getUint16(34, true)).toBe(16);
		expect(view.getUint32(40, true)).toBe(12);
		expect([0, 1, 2, 3, 4, 5].map((index) => view.getInt16(44 + index * 2, true))).toEqual([
			0, 16384, 32767, 32767, -32768, -32768
		]);
	});
});

describe('createAudioSignature function', () => {
	const resolve = (source: TSong): string => `asset://${source.path ?? ''}`;

	it('should ignore changes that do not affect audio', () => {
		const project = withMarble(createProject());
		const renamed: TProject = {
			...project,
			title: 'Other',
			marbles: project.marbles.map((marble) => ({ ...marble, name: 'x', labelColor: '#fff' }))
		};

		expect(createAudioSignature(renamed, resolve)).toBe(createAudioSignature(project, resolve));
	});

	it('should change with hits, instruments and end', () => {
		const project = withMarble(createProject());
		const base = createAudioSignature(project, resolve);
		const moved = mapMarbles(project, (marble) => ({ ...marble, hits: [{ id: 'hit', time: 0.7, pitch: 76 }] }));
		const instrument = mapMarbles(project, (marble) => ({ ...marble, sound: 12 }));
		const tapped = mapMarbles(project, (marble) => ({ ...marble, hits: [...marble.hits, { id: 'tap', time: 0.9 }] }));

		expect(createAudioSignature(tapped, resolve)).toBe(base);
		expect(createAudioSignature(moved, resolve)).not.toBe(base);
		expect(createAudioSignature(instrument, resolve)).not.toBe(base);
		expect(createAudioSignature({ ...project, length: project.length + 1 }, resolve)).not.toBe(base);
	});

	it('should ignore marbles when an audio source exists', () => {
		const project = withMarble(createProject());
		const withAudio: TProject = {
			...project,
			songs: [{ id: 'song', kind: 'audio', path: 'audio/song.wav', name: 'Song', start: 0, backing: [] }]
		};
		const base = createAudioSignature(withAudio, resolve);

		expect(
			createAudioSignature(
				mapMarbles(withAudio, (marble) => ({ ...marble, sound: 12 })),
				resolve
			)
		).toBe(base);
		expect(
			createAudioSignature(
				{
					...withAudio,
					songs: withAudio.songs.map((song) => ({ ...song, start: 1 }))
				},
				resolve
			)
		).not.toBe(base);
	});
});

describe('computePeaks function', () => {
	it('should return normalized max per bucket', () => {
		const samples = new Float32Array([0.1, -0.2, 0, 0.05, -0.4, 0.1, 0.2]);

		const peaks = computePeaks(samples, 2, 1);

		expect(Array.from(peaks).map((value) => Number(value.toFixed(3)))).toEqual([
			0.5, 0.125, 1, 0.5
		]);
	});

	it('should return zeros for silence', () => {
		expect(Array.from(computePeaks(new Float32Array(10), 10, 0.5))).toEqual([0, 0]);
	});
});

function withMarble(project: TProject): TProject {
	return {
		...project,
		marbles: [{ ...createMarble(0, { x: 0, y: 0 }, 'marble'), name: 'Marble', labelColor: '#f00', sound: 9, hits: [{ id: 'hit', time: 0.5, pitch: 76 }] }],
		songs: [{ id: 'midi', kind: 'midi', path: 'song.mid', name: 'Song', start: 0, backing: [] }]
	};
}

function mapMarbles(
	project: TProject,
	map: (marble: TProject['marbles'][number]) => TProject['marbles'][number]
): TProject {
	return { ...project, marbles: project.marbles.map(map) };
}
