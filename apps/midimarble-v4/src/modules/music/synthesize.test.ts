import { readFileSync } from 'node:fs';
import { SoundBankLoader } from 'spessasynth_core';
import { describe, expect, it } from 'vitest';
import type { TMarble } from '@/modules/project';
import { createBackingEvents, createMarbleEvents, mixAudioSource, renderMarbles, type TStereoAudio } from './synthesize';

const sampleRate = 22050;

describe('renderMarbles function', () => {
	const bank = SoundBankLoader.fromArrayBuffer(
		new Uint8Array(
			readFileSync(new URL('../../../public/audio/marble-instruments.sf2', import.meta.url))
		).buffer
	);

	it('should be silent before the first hit and audible after it', () => {
		const audio = renderMarbles([marble('a', 9, [0.5, 1])], { sampleRate, duration: 1.5, bank });

		expect(audio.left).toHaveLength(Math.ceil(1.5 * sampleRate));
		expect(peak(audio.left, 0, 0.49)).toBe(0);
		expect(peak(audio.left, 0.5, 0.7)).toBeGreaterThan(0.01);
		expect(peak(audio.right, 1, 1.2)).toBeGreaterThan(0.01);
		expect(audio.left.every(Number.isFinite)).toBe(true);
	});

	it('should render every instrument of the bank on repeated use', () => {
		for (const program of [0, 9, 12, 46, 108]) {
			const audio = renderMarbles([marble('a', program, [0.05])], { sampleRate, duration: 0.5, bank });
			expect(peak(audio.left, 0.05, 0.3)).toBeGreaterThan(0.005);
		}
	});

	it('should play Backing on its own channel with the notes held for their length', () => {
		const backing = { instrument: 0, hits: [{ id: 'b', time: 0.2, pitch: 60, duration: 1 }] };

		const audio = renderMarbles([marble('a', 9, [])], { sampleRate, duration: 1.5, bank, backing: [backing] });

		expect(peak(audio.left, 0, 0.19)).toBe(0);
		expect(peak(audio.left, 0.2, 0.4)).toBeGreaterThan(0.01);
		expect(peak(audio.left, 0.9, 1.1)).toBeGreaterThan(0.001);
	});

	it('should end a Backing note before the next note of the same pitch', () => {
		const events = createBackingEvents(
			[
				{ id: 'a', time: 0, pitch: 60, duration: 2 },
				{ id: 'b', time: 0.5, pitch: 60, duration: 0.1 }
			],
			3,
			100
		);

		expect(events.map((event) => [event.kind, event.sample])).toEqual([
			['on', 0],
			['off', 50],
			['on', 50],
			['off', 60]
		]);
	});

	it('should render more than nine marbles', () => {
		const marbles = Array.from({ length: 11 }, (_, index) =>
			marble(`l${index}`, 12, index === 10 ? [0.1] : [])
		);

		const audio = renderMarbles(marbles, { sampleRate, duration: 0.5, bank });

		expect(peak(audio.left, 0.1, 0.3)).toBeGreaterThan(0.005);
	});
});

describe('createMarbleEvents function', () => {
	it('should end notes at the next hit or after 0.6 s', () => {
		const events = createMarbleEvents([marble('a', 9, [1, 0, 0.2])], 1000);

		expect(events.map((event) => `${event.kind}@${event.sample}`)).toEqual([
			'on@0',
			'off@200',
			'on@200',
			'off@800',
			'on@1000',
			'off@1600'
		]);
	});

	it('should map velocity defaults and play nothing for a hit without a pitch', () => {
		const [on] = createMarbleEvents([{ ...marble('a', 9, []), hits: [{ id: 'h', time: 0, pitch: 76 }] }], 1000);
		const silent = createMarbleEvents([{ ...marble('a', 9, []), hits: [{ id: 'h', time: 0 }] }], 1000);
		const [loud] = createMarbleEvents(
			[{ ...marble('a', 9, []), hits: [{ id: 'h', time: 0, pitch: 60, velocity: 1 }] }],
			1000
		);

		expect(silent).toEqual([]);
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

function marble(id: string, instrument: number, times: number[]): TMarble {
	return {
		id,
		name: id,
		labelColor: '#000000',
		sound: instrument,
		radius: 0.012,
		start: { position: { x: 0, y: 0 }, time: 0 },
		hits: times.map((time, index) => ({ id: `${id}-${index}`, time, pitch: 76 }))
	};
}

function peak(samples: Float32Array, from: number, to: number): number {
	let max = 0;
	for (let index = Math.round(from * sampleRate); index < Math.round(to * sampleRate); index++)
		max = Math.max(max, Math.abs(samples[index] ?? 0));
	return max;
}
