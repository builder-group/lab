import type { TDecodedAudio } from './synthesize';

// Max absolute sample per bucket, scaled so the loudest bucket is 1
export function computePeaks(
	samples: Float32Array,
	sampleRate: number,
	bucketSeconds: number
): Float32Array {
	const bucketSize = Math.max(1, Math.round(bucketSeconds * sampleRate));
	const peaks = new Float32Array(Math.ceil(samples.length / bucketSize));
	let max = 0;
	for (let bucket = 0; bucket < peaks.length; bucket++) {
		const end = Math.min(samples.length, (bucket + 1) * bucketSize);
		let peak = 0;
		for (let index = bucket * bucketSize; index < end; index++) {
			const value = Math.abs(samples[index] ?? 0);
			if (value > peak) peak = value;
		}
		peaks[bucket] = peak;
		if (peak > max) max = peak;
	}
	if (max > 0)
		for (let bucket = 0; bucket < peaks.length; bucket++)
			peaks[bucket] = (peaks[bucket] ?? 0) / max;
	return peaks;
}

// Decodes with WebAudio, which resamples to the context rate of 48 kHz
export async function decodeAudioFile(bytes: ArrayBuffer): Promise<TDecodedAudioFile> {
	const context = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate: 48000 });
	// `decodeAudioData` detaches its input, so decode a copy
	const buffer = await context.decodeAudioData(bytes.slice(0));
	const channels: Float32Array[] = [];
	for (let channel = 0; channel < buffer.numberOfChannels; channel++)
		channels.push(new Float32Array(buffer.getChannelData(channel)));
	return { sampleRate: buffer.sampleRate, channels, duration: buffer.duration };
}

export interface TDecodedAudioFile extends TDecodedAudio {
	duration: number;
}

// Averages all channels into one, used for onset detection and the marble waveform
export function mixToMono(channels: Float32Array[]): Float32Array {
	const first = channels[0];
	if (first == null) return new Float32Array(0);
	if (channels.length === 1) return first;
	const mono = new Float32Array(first.length);
	for (const channel of channels)
		for (let index = 0; index < mono.length; index++)
			mono[index] = (mono[index] ?? 0) + (channel[index] ?? 0) / channels.length;
	return mono;
}
