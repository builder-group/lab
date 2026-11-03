import { readFileSync } from 'node:fs';
import { SoundBankLoader } from 'spessasynth_core';
import { describe, expect, it } from 'vitest';
import type { TLane } from '@/modules/project';
import { createLaneEvents, mixAudioSource, renderLanes, type TStereoAudio } from './synthesize';

const sampleRate = 22050;

describe('renderLanes function', () => {
	const bank = SoundBankLoader.fromArrayBuffer(
		new Uint8Array(
			readFileSync(new URL('../../../public/audio/marble-instruments.sf2', import.meta.url))
		).buffer
	);

	it('should be silent before the first hit and audible after it', () => {
		const audio = renderLanes([lane('a', 9, [0.5, 1])], { sampleRate, duration: 1.5, bank });

		expect(audio.left).toHaveLength(Math.ceil(1.5 * sampleRate));
		expect(peak(audio.left, 0, 0.49)).toBe(0);
		expect(peak(audio.left, 0.5, 0.7)).toBeGreaterThan(0.01);
		expect(peak(audio.right, 1, 1.2)).toBeGreaterThan(0.01);
		expect(audio.left.every(Number.isFinite)).toBe(true);
	});

	it('should render every instrument of the bank on repeated use', () => {
		for (const program of [0, 9, 12, 46, 108]) {
			const audio = renderLanes([lane('a', program, [0.05])], { sampleRate, duration: 0.5, bank });
			expect(peak(audio.left, 0.05, 0.3)).toBeGreaterThan(0.005);
		}
	});

	it('should render more than nine lanes', () => {
		const lanes = Array.from({ length: 11 }, (_, index) =>
			lane(`l${index}`, 12, index === 10 ? [0.1] : [])
		);

		const audio = renderLanes(lanes, { sampleRate, duration: 0.5, bank });

		expect(peak(audio.left, 0.1, 0.3)).toBeGreaterThan(0.005);
	});
});

describe('createLaneEvents function', () => {
	it('should end notes at the next hit or after 0.6 s', () => {
		const events = createLaneEvents([lane('a', 9, [1, 0, 0.2])], 1000);

		expect(events.map((event) => `${event.kind}@${event.sample}`)).toEqual([
			'on@0',
			'off@200',
			'on@200',
			'off@800',
			'on@1000',
			'off@1600'
		]);
	});

	it('should map pitch and velocity defaults', () => {
		const [on] = createLaneEvents([{ ...lane('a', 9, []), hits: [{ id: 'h', time: 0 }] }], 1000);
		const [loud] = createLaneEvents(
			[{ ...lane('a', 9, []), hits: [{ id: 'h', time: 0, pitch: 60, velocity: 1 }] }],
			1000
		);

		expect(on).toMatchObject({ pitch: 76, velocity: 102 });
		expect(loud).toMatchObject({ pitch: 60, velocity: 127 });
	});
});

describe('mixAudioSource function', () => {
	it('should add a mono source at its offset with linear resampling', () => {
		const target: TStereoAudio = {
			sampleRate: 4,
			left: new Float32Array(8),
			right: new Float32Array(8)
		};

		mixAudioSource(target, { sampleRate: 2, channels: [new Float32Array([0, 1])] }, 1);

		expect(Array.from(target.left)).toEqual([0, 0, 0, 0, 0, 0.5, 1, 1]);
		expect(Array.from(target.right)).toEqual(Array.from(target.left));
	});

	it('should skip the part of a source before zero', () => {
		const target: TStereoAudio = {
			sampleRate: 2,
			left: new Float32Array(2),
			right: new Float32Array(2)
		};

		mixAudioSource(
			target,
			{ sampleRate: 2, channels: [new Float32Array([1, 2, 3]), new Float32Array([4, 5, 6])] },
			-0.5
		);

		expect(Array.from(target.left)).toEqual([2, 3]);
		expect(Array.from(target.right)).toEqual([5, 6]);
	});
});

function lane(id: string, instrument: number, times: number[]): TLane {
	return {
		id,
		name: id,
		color: '#000000',
		instrument,
		hits: times.map((time, index) => ({ id: `${id}-${index}`, time }))
	};
}

function peak(samples: Float32Array, from: number, to: number): number {
	let max = 0;
	for (let index = Math.round(from * sampleRate); index < Math.round(to * sampleRate); index++)
		max = Math.max(max, Math.abs(samples[index] ?? 0));
	return max;
}
