import { describe, expect, it } from 'vitest';
import { detectOnsets, fft, suggestedHitTimes } from './onsets';

const sampleRate = 44100;

describe('detectOnsets function', () => {
	it('should detect clicks within 15 ms', () => {
		const times = [0.25, 0.61, 0.9, 1.37, 1.5];
		const samples = new Float32Array(sampleRate * 2);
		for (const time of times) {
			const start = Math.round(time * sampleRate);
			for (let index = 0; index < 64; index++)
				samples[start + index] = (index % 2 === 0 ? 0.9 : -0.9) * Math.exp(-index / 16);
		}

		const onsets = detectOnsets(samples, sampleRate);

		expectOnsets(onsets, times);
	});

	it('should detect decaying sines within 15 ms', () => {
		const times = [0.2, 0.45, 0.8, 1.1, 1.6];
		const frequencies = [440, 660, 523, 880, 330];
		const samples = new Float32Array(sampleRate * 2);
		for (const [noteIndex, time] of times.entries()) {
			const start = Math.round(time * sampleRate);
			const frequency = frequencies[noteIndex] ?? 440;
			for (let index = 0; start + index < samples.length; index++) {
				const t = index / sampleRate;
				samples[start + index] =
					(samples[start + index] ?? 0) +
					0.5 * Math.exp(-t * 12) * Math.sin(2 * Math.PI * frequency * t);
			}
		}

		const onsets = detectOnsets(samples, sampleRate);

		expectOnsets(onsets, times);
	});

	it('should respect the minimum gap', () => {
		const samples = new Float32Array(sampleRate);
		for (const time of [0.3, 0.35]) samples[Math.round(time * sampleRate)] = 1;

		const onsets = detectOnsets(samples, sampleRate, { minGap: 0.2 });

		expect(onsets).toHaveLength(1);
	});

	it('should find nothing in silence', () => {
		expect(detectOnsets(new Float32Array(sampleRate * 2), sampleRate)).toEqual([]);
	});

	it('should find at most the start of a steady tone', () => {
		const samples = new Float32Array(sampleRate * 2);
		for (let index = 0; index < samples.length; index++)
			samples[index] = 0.5 * Math.sin((2 * Math.PI * 440 * index) / sampleRate);

		const onsets = detectOnsets(samples, sampleRate);

		expect(onsets.length).toBeLessThanOrEqual(1);
		for (const onset of onsets) expect(onset).toBeLessThan(0.05);
	});

	it('should work at 48 kHz', () => {
		const rate = 48000;
		const samples = new Float32Array(rate);
		for (const time of [0.2, 0.7]) samples[Math.round(time * rate)] = 1;

		expectOnsets(detectOnsets(samples, rate), [0.2, 0.7]);
	});
});

describe('fft function', () => {
	it('should put a cosine into its bin', () => {
		const size = 64;
		const real = new Float32Array(size);
		const imag = new Float32Array(size);
		for (let index = 0; index < size; index++)
			real[index] = Math.cos((2 * Math.PI * 5 * index) / size);

		fft(real, imag);

		expect(real[5]).toBeCloseTo(size / 2, 3);
		expect(real[size - 5]).toBeCloseTo(size / 2, 3);
		expect(Math.hypot(real[4] ?? 0, imag[4] ?? 0)).toBeLessThan(1e-3);
	});
});

function expectOnsets(onsets: number[], expected: number[]): void {
	expect(onsets).toHaveLength(expected.length);
	for (const [index, time] of expected.entries())
		expect(Math.abs((onsets[index] ?? 0) - time)).toBeLessThan(0.015);
}

describe('suggestedHitTimes function', () => {
	it('should leave out beats a recording that starts before 0 has cut from the film', () => {
		expect(suggestedHitTimes([1, 2.5, 3.5], -2)).toEqual([0.5, 1.5]);
	});
});
