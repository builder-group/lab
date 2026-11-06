import type { TStereoAudio } from './synthesize';

/** What phones and YouTube's own player aim at; top marble shorts sit between −12 and −16 LUFS */
export const FILM_LOUDNESS = -14;
/** The film's highest true peak, in dB: AAC encoding overshoots a little, so the sound keeps this much room */
export const FILM_PEAK = -1;
/** Limits a little under `FILM_PEAK`, so the encoded film still measures it */
const LIMIT_MARGIN = 0.2;
/** The most the limiter takes off a peak, in dB; a sound needing more stays quieter than the target rather than audibly squashed */
const MOST_LIMITING = 6;
const LOOK_AHEAD = 0.005;
const RELEASE = 0.08;

// ITU-R BS.1770: blocks of 400 ms every 100 ms, gated at −70 LUFS and at 10 LU under the blocks' loudness
const BLOCK_STEPS = 4;
const STEP_SECONDS = 0.1;
const ABSOLUTE_GATE = -70;
const RELATIVE_GATE = -10;
const LOUDNESS_OFFSET = -0.691;

/** Oversampling for the true peak, as BS.1770 asks: three points between samples from a windowed sinc */
const PEAK_PHASES = [0.25, 0.5, 0.75];
const PEAK_TAPS = 12;

export interface TLoudness {
	/** Integrated loudness in LUFS; null for silence, or a sound too short to measure */
	lufs: number | null;
	/** True peak in dB */
	truePeak: number;
}

/** A sound's integrated loudness and true peak, the way ffmpeg's `ebur128` and `loudnorm` read them */
export function measureLoudness(audio: TStereoAudio): TLoudness {
	return { lufs: integratedLoudness(audio), truePeak: gainToDb(highest(linkedPeaks(audio))) };
}

/**
 * Brings the sound to `FILM_LOUDNESS` with its true peak at `FILM_PEAK`: one gain over everything, so the song's balance
 * stays, and a look-ahead limiter on the few attacks the gain lifts past the peak. A sound the limiter can't bring there
 * within `MOST_LIMITING` ends up quieter, and the returned figure says so. Silence stays silence. Changes `audio`.
 */
export function normalizeLoudness(audio: TStereoAudio): TLoudness {
	const before = integratedLoudness(audio);
	if (before == null) return measureLoudness(audio);
	const peaks = linkedPeaks(audio);
	const ceiling = dbToGain(FILM_PEAK - LIMIT_MARGIN);
	const mostGain = (ceiling * dbToGain(MOST_LIMITING)) / Math.max(highest(peaks), 1e-9);
	const dry = { left: audio.left.slice(), right: audio.right.slice() };
	let gain = Math.min(mostGain, dbToGain(FILM_LOUDNESS - before));
	for (let attempt = 0; attempt < 4; attempt++) {
		applyGain(audio, dry, gain, limiterCurve(peaks, gain, ceiling, audio.sampleRate));
		const reached = integratedLoudness(audio);
		// The limiter takes a little of the loudness with it, which a little more gain gives back
		if (reached == null || Math.abs(FILM_LOUDNESS - reached) < 0.05) break;
		const next = Math.min(mostGain, gain * dbToGain(FILM_LOUDNESS - reached));
		if (next === gain) break;
		gain = next;
	}
	return measureLoudness(audio);
}

/** Loudness and peak for people: "−14.0 LUFS · peak −1.0 dB" */
export function formatLoudness(loudness: TLoudness): string {
	if (loudness.lufs == null) return 'no sound';
	return `${signed(loudness.lufs)} LUFS · peak ${signed(loudness.truePeak)} dB`;
}

function signed(value: number): string {
	return value.toFixed(1).replace('-', '−');
}

function integratedLoudness(audio: TStereoAudio): number | null {
	const stepLength = Math.round(audio.sampleRate * STEP_SECONDS);
	const steps = Math.floor(audio.left.length / stepLength);
	if (steps < BLOCK_STEPS) return null;
	const energy = new Float64Array(steps);
	for (const channel of [audio.left, audio.right]) {
		const weighted = kWeighted(channel, audio.sampleRate);
		for (let step = 0; step < steps; step++) {
			let sum = 0;
			for (let index = step * stepLength; index < (step + 1) * stepLength; index++) sum += (weighted[index] ?? 0) ** 2;
			energy[step] = (energy[step] ?? 0) + sum;
		}
	}
	const blocks: number[] = [];
	for (let step = 0; step + BLOCK_STEPS <= steps; step++) {
		let sum = 0;
		for (let index = step; index < step + BLOCK_STEPS; index++) sum += energy[index] ?? 0;
		blocks.push(sum / (BLOCK_STEPS * stepLength));
	}
	const audible = blocks.filter((block) => energyToLufs(block) > ABSOLUTE_GATE);
	if (!audible.length) return null;
	const gate = energyToLufs(mean(audible)) + RELATIVE_GATE;
	const counted = audible.filter((block) => energyToLufs(block) > gate);
	return energyToLufs(mean(counted));
}

function energyToLufs(energy: number): number {
	return LOUDNESS_OFFSET + 10 * Math.log10(Math.max(energy, 1e-12));
}

function mean(values: number[]): number {
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** BS.1770's K-weighting at any sample rate, the two stages by their analog poles as libebur128 derives them */
function kWeighted(channel: Float32Array, sampleRate: number): Float64Array {
	const shelf = (() => {
		const k = Math.tan((Math.PI * 1681.974450955533) / sampleRate);
		const q = 0.7071752369554196;
		const high = 10 ** (3.999843853973347 / 20);
		const band = high ** 0.4996667741545416;
		const a0 = 1 + k / q + k * k;
		return { b: [(high + (band * k) / q + k * k) / a0, (2 * (k * k - high)) / a0, (high - (band * k) / q + k * k) / a0], a: [(2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0] };
	})();
	const highPass = (() => {
		const k = Math.tan((Math.PI * 38.13547087602444) / sampleRate);
		const q = 0.5003270373238773;
		const a0 = 1 + k / q + k * k;
		return { b: [1, -2, 1], a: [(2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0] };
	})();
	return biquad(biquad(channel, shelf), highPass);
}

function biquad(input: ArrayLike<number>, filter: { b: number[]; a: number[] }): Float64Array {
	const [b0 = 0, b1 = 0, b2 = 0] = filter.b;
	const [a1 = 0, a2 = 0] = filter.a;
	const output = new Float64Array(input.length);
	let z1 = 0;
	let z2 = 0;
	for (let index = 0; index < input.length; index++) {
		const value = input[index] ?? 0;
		const out = b0 * value + z1;
		z1 = b1 * value - a1 * out + z2;
		z2 = b2 * value - a2 * out;
		output[index] = out;
	}
	return output;
}

const peakFilters = PEAK_PHASES.map((phase) => {
	const half = PEAK_TAPS / 2;
	return Array.from({ length: PEAK_TAPS }, (_, tap) => {
		const offset = tap - half + 1 - phase;
		const sinc = Math.abs(offset) < 1e-9 ? 1 : Math.sin(Math.PI * offset) / (Math.PI * offset);
		return sinc * (0.5 + 0.5 * Math.cos((Math.PI * offset) / (half + 0.5)));
	});
});

/** Per sample, the higher of both channels' peak there, between samples included: one gain curve then keeps the stereo image */
function linkedPeaks(audio: TStereoAudio): Float32Array {
	const peaks = new Float32Array(audio.left.length);
	let highestSoFar = 0;
	for (const channel of [audio.left, audio.right]) {
		for (let index = 0; index < channel.length; index++) {
			const sample = Math.abs(channel[index] ?? 0);
			let peak = sample;
			// Between samples a sound rises only so far over its neighbors, so the quiet stretches need no filter
			if (Math.max(sample, Math.abs(channel[index + 1] ?? 0)) > highestSoFar * 0.5) {
				for (const filter of peakFilters) {
					let value = 0;
					for (let tap = 0; tap < PEAK_TAPS; tap++) value += (channel[index + tap - PEAK_TAPS / 2 + 1] ?? 0) * (filter[tap] ?? 0);
					peak = Math.max(peak, Math.abs(value));
				}
			}
			if (peak > (peaks[index] ?? 0)) peaks[index] = peak;
			highestSoFar = Math.max(highestSoFar, peak);
		}
	}
	return peaks;
}

function highest(values: Float32Array): number {
	let top = 0;
	for (const value of values) top = Math.max(top, value);
	return top;
}

/**
 * The limiter's gain per sample, 1 where the peak stays under the ceiling. Each dip is held for the look-ahead before its
 * peak, released slowly and then smoothed over the same look-ahead: the smoothed curve can't rise above any peak's need,
 * as every sample it averages at that peak already holds the dip.
 */
function limiterCurve(peaks: Float32Array, gain: number, ceiling: number, sampleRate: number): Float32Array | null {
	if (highest(peaks) * gain <= ceiling) return null;
	const length = peaks.length;
	const ahead = Math.max(1, Math.round(LOOK_AHEAD * sampleRate));
	const needed = new Float32Array(length).fill(1);
	for (let index = 0; index < length; index++) {
		const peak = (peaks[index] ?? 0) * gain;
		if (peak <= ceiling) continue;
		const need = ceiling / peak;
		for (let hold = Math.max(0, index - ahead); hold <= index; hold++) needed[hold] = Math.min(needed[hold] ?? 1, need);
	}
	const release = 1 - Math.exp(-1 / (RELEASE * sampleRate));
	let current = 1;
	for (let index = 0; index < length; index++) {
		current = Math.min(needed[index] ?? 1, current + (1 - current) * release);
		needed[index] = current;
	}
	const curve = new Float32Array(length);
	// Before the first sample the curve stands at its first value, so a note on the very first sample is held too
	const first = needed[0] ?? 1;
	let sum = first * ahead;
	for (let index = 0; index < length; index++) {
		sum += (needed[index] ?? 1) - (index >= ahead ? (needed[index - ahead] ?? 1) : first);
		curve[index] = sum / ahead;
	}
	return curve;
}

function applyGain(audio: TStereoAudio, dry: { left: Float32Array; right: Float32Array }, gain: number, curve: Float32Array | null): void {
	for (let index = 0; index < audio.left.length; index++) {
		const level = gain * (curve?.[index] ?? 1);
		audio.left[index] = (dry.left[index] ?? 0) * level;
		audio.right[index] = (dry.right[index] ?? 0) * level;
	}
}

function dbToGain(db: number): number {
	return 10 ** (db / 20);
}

function gainToDb(gain: number): number {
	return 20 * Math.log10(Math.max(gain, 1e-9));
}
