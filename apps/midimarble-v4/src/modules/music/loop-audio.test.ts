import { describe, expect, it } from 'vitest';
import type { TLane } from '@/modules/project';
import { cutLoopAudio, foldLoopAudio, loopLanes } from './loop-audio';
import type { TStereoAudio } from './synthesize';

function ramp(length: number, sampleRate = 10): TStereoAudio {
	const left = Float32Array.from({ length }, (_, index) => index);
	return { sampleRate, left, right: left.map((value) => -value) };
}

describe('loop audio', () => {
	describe('loopLanes function', () => {
		it('should keep the hits inside the loop and move them to its start', () => {
			const lane: TLane = {
				id: 'lane-1',
				name: 'Marble 1',
				color: '#fff',
				instrument: 9,
				hits: [0.2, 0.5, 1.4, 2.5].map((time, index) => ({ id: `hit-${index}`, time }))
			};

			const [looped] = loopLanes([lane], { start: 0.5, length: 2 });

			expect(looped?.hits.map((hit) => hit.time)).toEqual([0, 0.8999999999999999]);
		});
	});

	describe('foldLoopAudio function', () => {
		it('should add everything past the loop length onto its beginning', () => {
			const audio = ramp(25);

			const folded = foldLoopAudio(audio, 1);

			expect(folded.left).toHaveLength(10);
			// Samples 0, 10 and 20 land on 0; 4 and 14 and 24 land on 4
			expect(folded.left[0]).toBe(30);
			expect(folded.left[4]).toBe(4 + 14 + 24);
			expect(folded.left[9]).toBe(9 + 19);
			expect(folded.right[0]).toBe(-30);
		});
	});

	describe('cutLoopAudio function', () => {
		it('should cut the range and fade its end into the audio before the start', () => {
			const audio = ramp(100);

			const cut = cutLoopAudio(audio, { start: 3, length: 5 }, 0.4);

			expect(cut.left).toHaveLength(50);
			expect(cut.left[0]).toBe(30);
			expect(cut.left[45]).toBe(75);
			// The last sample is mostly the sample just before the start, so the repeat continues into it
			expect(Math.abs((cut.left[49] ?? 0) - 29)).toBeLessThan(Math.abs((cut.left[49] ?? 0) - 79));
		});
	});
});
