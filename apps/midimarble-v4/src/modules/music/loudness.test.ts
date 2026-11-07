import { describe, expect, it } from 'vitest';
import { FILM_LOUDNESS, FILM_PEAK, formatLoudness, measureLoudness, normalizeLoudness } from './loudness';
import type { TStereoAudio } from './synthesize';

const SAMPLE_RATE = 48000;

function tone(options: { frequency?: number; db: number; seconds?: number; right?: number }): TStereoAudio {
	const { frequency = 997, db, seconds = 3, right = 1 } = options;
	const length = Math.round(seconds * SAMPLE_RATE);
	const left = new Float32Array(length);
	const other = new Float32Array(length);
	const amplitude = 10 ** (db / 20);
	for (let index = 0; index < length; index++) {
		left[index] = amplitude * Math.sin((2 * Math.PI * frequency * index) / SAMPLE_RATE);
		other[index] = (left[index] ?? 0) * right;
	}
	return { sampleRate: SAMPLE_RATE, left, right: other };
}

/** A note every half second that rings down, as a marble's notes do: far louder at its attack than on average */
function notes(db: number): TStereoAudio {
	const audio = tone({ db, seconds: 6 });
	for (let index = 0; index < audio.left.length; index++) {
		const since = (index % (SAMPLE_RATE / 2)) / SAMPLE_RATE;
		const decay = Math.exp(-since * 14);
		audio.left[index] = (audio.left[index] ?? 0) * decay;
		audio.right[index] = (audio.right[index] ?? 0) * decay;
	}
	return audio;
}

describe('measureLoudness function', () => {
	it('should read a stereo sine at 997 Hz as its own level, as BS.1770 calibrates', () => {
		expect(measureLoudness(tone({ db: -20 })).lufs).toBeCloseTo(-20, 0);
	});

	it('should read one channel 3 dB under both', () => {
		const both = measureLoudness(tone({ db: -20 })).lufs ?? 0;
		const one = measureLoudness(tone({ db: -20, right: 0 })).lufs ?? 0;
		expect(both - one).toBeCloseTo(3.01, 1);
	});

	it('should see a peak between samples', () => {
		// A quarter of the sample rate at 45° never lands a sample on its crest, which stands 3 dB over the samples
		const length = SAMPLE_RATE;
		const left = new Float32Array(length);
		for (let index = 0; index < length; index++) left[index] = 0.5 * Math.sin((Math.PI / 2) * index + Math.PI / 4);
		const audio = { sampleRate: SAMPLE_RATE, left, right: left.slice() };
		expect(measureLoudness(audio).truePeak).toBeGreaterThan(20 * Math.log10(0.5) - 0.5);
	});

	it('should have no loudness for silence or for a sound too short to measure', () => {
		expect(measureLoudness(tone({ db: -200 })).lufs).toBeNull();
		expect(measureLoudness(tone({ db: -20, seconds: 0.2 })).lufs).toBeNull();
	});
});

describe('normalizeLoudness function', () => {
	it('should raise a quiet sound to the film loudness by one gain', () => {
		const audio = tone({ db: -30 });
		const result = normalizeLoudness(audio);
		expect(result.lufs).toBeCloseTo(FILM_LOUDNESS, 1);
		// A steady tone has headroom to spare, so nothing limits it: it stays a pure sine at the higher level
		expect(result.truePeak).toBeLessThan(FILM_PEAK);
		expect(Math.max(...audio.left.subarray(0, 1000))).toBeCloseTo(10 ** ((-30 + (FILM_LOUDNESS + 30)) / 20), 1);
	});

	it('should lower a loud sound too', () => {
		expect(normalizeLoudness(tone({ db: -3 })).lufs).toBeCloseTo(FILM_LOUDNESS, 1);
	});

	it('should keep the balance between channels', () => {
		const audio = tone({ db: -30, right: 0.5 });
		normalizeLoudness(audio);
		for (const index of [100, 1000, 5000]) expect(audio.right[index]).toBeCloseTo((audio.left[index] ?? 0) * 0.5, 5);
	});

	it('should hold the peak at the limit on notes with strong attacks and still reach the loudness', () => {
		const audio = notes(-20);
		const before = measureLoudness(audio);
		expect((before.truePeak ?? 0) - (before.lufs ?? 0)).toBeGreaterThan(-FILM_PEAK - FILM_LOUDNESS * -1);
		const after = normalizeLoudness(audio);
		expect(after.lufs).toBeCloseTo(FILM_LOUDNESS, 0);
		expect(after.truePeak).toBeLessThanOrEqual(FILM_PEAK + 0.01);
	});

	it('should stay quieter than the target rather than squash sharp clicks', () => {
		// One click a second: far more than the most the limiter may take off
		const length = SAMPLE_RATE * 6;
		const left = new Float32Array(length);
		for (let index = 0; index < length; index += SAMPLE_RATE) left[index] = 0.5;
		const audio = { sampleRate: SAMPLE_RATE, left, right: left.slice() };
		const after = normalizeLoudness(audio);
		expect(after.lufs ?? 0).toBeLessThan(FILM_LOUDNESS - 1);
		expect(after.truePeak).toBeLessThanOrEqual(FILM_PEAK + 0.01);
	});

	it('should leave silence silent', () => {
		const audio = tone({ db: -200 });
		const result = normalizeLoudness(audio);
		expect(result.lufs).toBeNull();
		expect(formatLoudness(result)).toBe('no sound');
	});
});

describe('formatLoudness function', () => {
	it('should say both figures with real minus signs', () => {
		expect(formatLoudness({ lufs: -14, truePeak: -1.04 })).toBe('−14.0 LUFS · peak −1.0 dB');
	});
});
