import type { THit, TLane } from '@/modules/project';
import type { TStereoAudio } from './synthesize';

// Soundtracks of seamless loops. Synthesized lanes are rendered from the hits inside the loop only, and the
// tails of notes that ring past the end are added onto the beginning, so the repeated soundtrack sounds as if
// the music went on. A recording is cut to the loop with its end crossfaded into what precedes the start.

/** Seconds rendered past the loop end for note tails and reverb */
export const LOOP_AUDIO_TAIL = 3;
const RECORDING_CROSSFADE = 0.05;

export interface TLoopRange {
	start: number;
	length: number;
}

/** Lanes with only the hits inside the loop, moved so the loop starts at time 0 */
export function loopLanes(lanes: TLane[], range: TLoopRange): TLane[] {
	return lanes.map((lane) => ({ ...lane, hits: loopHits(lane.hits, range) }));
}

/** Hits inside the loop, moved so the loop starts at time 0 */
export function loopHits(hits: THit[], range: TLoopRange): THit[] {
	return hits
		.filter((hit) => hit.time >= range.start - 1e-9 && hit.time < range.start + range.length - 1e-9)
		.map((hit) => ({ ...hit, time: hit.time - range.start }));
}

/** Adds everything past `length` seconds onto the beginning, wrapping as often as needed */
export function foldLoopAudio(audio: TStereoAudio, length: number): TStereoAudio {
	const frames = Math.max(1, Math.round(length * audio.sampleRate));
	const left = new Float32Array(frames);
	const right = new Float32Array(frames);
	for (let index = 0; index < audio.left.length; index++) {
		const target = index % frames;
		left[target] = (left[target] ?? 0) + (audio.left[index] ?? 0);
		right[target] = (right[target] ?? 0) + (audio.right[index] ?? 0);
	}
	return { sampleRate: audio.sampleRate, left, right };
}

/** Cuts [start, start + length) and crossfades its end into the audio just before `start` */
export function cutLoopAudio(audio: TStereoAudio, range: TLoopRange, crossfade = RECORDING_CROSSFADE): TStereoAudio {
	const rate = audio.sampleRate;
	const frames = Math.max(1, Math.round(range.length * rate));
	const offset = Math.round(range.start * rate);
	const fade = Math.min(frames, Math.round(crossfade * rate));
	const left = new Float32Array(frames);
	const right = new Float32Array(frames);
	for (let index = 0; index < frames; index++) {
		let a = audio.left[offset + index] ?? 0;
		let b = audio.right[offset + index] ?? 0;
		const into = index - (frames - fade);
		if (into >= 0) {
			const weight = (into + 1) / (fade + 1);
			const before = offset - fade + into;
			a = a * (1 - weight) + (before >= 0 ? (audio.left[before] ?? 0) : 0) * weight;
			b = b * (1 - weight) + (before >= 0 ? (audio.right[before] ?? 0) : 0) * weight;
		}
		left[index] = a;
		right[index] = b;
	}
	return { sampleRate: rate, left, right };
}
