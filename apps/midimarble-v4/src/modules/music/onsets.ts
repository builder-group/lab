import { MIN_HIT_GAP } from './lane-proposal';

// Spectral-flux onset detection: log-compressed magnitude increases, an adaptive median and mean threshold and peak picking
export function detectOnsets(
	samples: Float32Array,
	sampleRate: number,
	options: TDetectOnsetsOptions = {}
): number[] {
	const { minGap = 0.09, sensitivity = 0.5 } = options;
	// Hop of 512 at 44.1 kHz, scaled to the nearest power of two for other rates
	const hop = 2 ** Math.round(Math.log2((512 * sampleRate) / 44100));
	const size = hop * 2;
	const flux = spectralFlux(samples, size, hop);
	if (!flux.length) return [];

	let fluxMax = 0;
	for (const value of flux) fluxMax = Math.max(fluxMax, value);
	if (fluxMax <= 1e-6) return [];

	const clampedSensitivity = Math.min(1, Math.max(0, sensitivity));
	const meanWeight = 2.5 - 2.2 * clampedSensitivity;
	const floor = fluxMax * (0.12 - 0.1 * clampedSensitivity);
	const radius = Math.max(2, Math.round((0.1 * sampleRate) / hop));
	const minGapFrames = minGap * (sampleRate / hop);

	const onsets: number[] = [];
	let lastFrame = -Infinity;
	for (let frame = 0; frame < flux.length; frame++) {
		const value = flux[frame] ?? 0;
		if (value <= floor) continue;
		const from = Math.max(0, frame - radius);
		const to = Math.min(flux.length, frame + radius + 1);
		const window = Array.from(flux.subarray(from, to));
		const isPeak = flux
			.subarray(Math.max(0, frame - 3), frame + 4)
			.every(
				(other, index) =>
					other <= value && (other < value || Math.max(0, frame - 3) + index >= frame)
			);
		if (!isPeak) continue;
		const mean = window.reduce((sum, other) => sum + other, 0) / window.length;
		const threshold = median(window) + meanWeight * mean;
		if (value <= threshold) continue;
		if (frame - lastFrame < minGapFrames) continue;
		lastFrame = frame;
		// A sharp attack peaks the flux in the frame where it lies closest to the window center
		onsets.push((frame * hop + size / 2) / sampleRate);
	}
	return onsets;
}

/**
 * Timeline times for a recording's onsets, as Add Suggested Hits places them: shifted by the source offset,
 * rounded to 0.1 ms, at least `minGap` apart and away from the hits the lane already has
 */
export function suggestedHitTimes(onsets: number[], offset: number, existing: number[] = [], minGap = MIN_HIT_GAP): number[] {
	const times: number[] = [];
	let last = Number.NEGATIVE_INFINITY;
	for (const onset of onsets) {
		const time = Math.round((onset + offset) * 10000) / 10000;
		if (time - last < minGap) continue;
		if (existing.some((item) => Math.abs(item - time) < minGap)) continue;
		times.push(time);
		last = time;
	}
	return times;
}

export interface TDetectOnsetsOptions {
	// Minimum time between onsets in seconds
	minGap?: number;
	// 0 keeps only strong onsets, 1 also keeps soft ones
	sensitivity?: number;
}

function spectralFlux(samples: Float32Array, size: number, hop: number): Float32Array {
	const frames = Math.max(0, Math.floor((samples.length - size) / hop) + 1);
	const flux = new Float32Array(frames);
	const window = new Float32Array(size);
	for (let index = 0; index < size; index++)
		window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / size);
	const bins = size / 2;
	const real = new Float32Array(size);
	const imag = new Float32Array(size);
	let previous = new Float32Array(bins);
	let current = new Float32Array(bins);
	for (let frame = 0; frame < frames; frame++) {
		const start = frame * hop;
		for (let index = 0; index < size; index++) {
			real[index] = (samples[start + index] ?? 0) * (window[index] ?? 0);
			imag[index] = 0;
		}
		fft(real, imag);
		let sum = 0;
		for (let bin = 0; bin < bins; bin++) {
			const magnitude = Math.hypot(real[bin] ?? 0, imag[bin] ?? 0) / bins;
			const compressed = Math.log1p(1000 * magnitude);
			current[bin] = compressed;
			const increase = compressed - (previous[bin] ?? 0);
			if (increase > 0) sum += increase;
		}
		flux[frame] = sum;
		[previous, current] = [current, previous];
	}
	return flux;
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = sorted.length >> 1;
	return sorted.length % 2 === 1
		? (sorted[middle] ?? 0)
		: ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

// In-place iterative radix-2 FFT; `real.length` must be a power of two
export function fft(real: Float32Array, imag: Float32Array): void {
	const size = real.length;
	for (let index = 1, reversed = 0; index < size; index++) {
		let bit = size >> 1;
		for (; reversed & bit; bit >>= 1) reversed ^= bit;
		reversed ^= bit;
		if (index < reversed) {
			[real[index], real[reversed]] = [real[reversed] ?? 0, real[index] ?? 0];
			[imag[index], imag[reversed]] = [imag[reversed] ?? 0, imag[index] ?? 0];
		}
	}
	for (let length = 2; length <= size; length <<= 1) {
		const angle = (-2 * Math.PI) / length;
		const stepReal = Math.cos(angle);
		const stepImag = Math.sin(angle);
		for (let start = 0; start < size; start += length) {
			let twiddleReal = 1;
			let twiddleImag = 0;
			for (let offset = 0; offset < length / 2; offset++) {
				const even = start + offset;
				const odd = even + length / 2;
				const oddReal = (real[odd] ?? 0) * twiddleReal - (imag[odd] ?? 0) * twiddleImag;
				const oddImag = (real[odd] ?? 0) * twiddleImag + (imag[odd] ?? 0) * twiddleReal;
				real[odd] = (real[even] ?? 0) - oddReal;
				imag[odd] = (imag[even] ?? 0) - oddImag;
				real[even] = (real[even] ?? 0) + oddReal;
				imag[even] = (imag[even] ?? 0) + oddImag;
				const nextReal = twiddleReal * stepReal - twiddleImag * stepImag;
				twiddleImag = twiddleReal * stepImag + twiddleImag * stepReal;
				twiddleReal = nextReal;
			}
		}
	}
}
