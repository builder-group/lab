import { describe, expect, it } from 'vitest';
import type { THitResult, TMarbleTrack, TSimulationResult } from '@/modules/simulation';
import { bakeFollowCamera, type TCameraTrack } from './follow-camera';
import { framingStretches } from './framing';

// Two marbles falling side by side 1.5 m apart; a close shot follows one at a time
const SPREAD = 0.75;

function samples(x: number): TMarbleTrack['samples'] {
	return Array.from({ length: 101 }, (_, index) => ({
		time: index / 10,
		position: { x, y: -0.3 * (index / 10) },
		angle: 0,
		velocity: { x: 0, y: -0.3 }
	}));
}

function scene(melody: number[], bass: number[], isClose = true): { result: TSimulationResult; track: TCameraTrack } {
	const marbles: TMarbleTrack[] = [
		{ marbleId: 'melody', radius: 0.012, samples: samples(-SPREAD) },
		{ marbleId: 'bass', radius: 0.012, samples: samples(SPREAD) }
	];
	const hit = (marbleId: string, time: number, index: number): THitResult => ({
		marbleId,
		hitId: `${marbleId}-${index}`,
		targetTime: time,
		pieceId: null,
		dot: null,
		velocity: null,
		actualTime: time,
		error: 0,
		status: 'onTime'
	});
	const result: TSimulationResult = {
		revision: 1,
		duration: 10,
		marbles,
		pieces: [],
		contacts: [],
		hits: [...melody.map((time, index) => hit('melody', time, index)), ...bass.map((time, index) => hit('bass', time, index))],
		stats: { computeMs: 0, reusedUntil: 0, steps: 0 }
	};
	const track = bakeFollowCamera({
		fps: 30,
		duration: 10,
		frame: { width: 1080, height: 1920 },
		camera: { mode: 'rig', distance: 0.7, pitch: 1.15, lead: 0.15, smoothing: 0.6, shots: isClose ? [{ time: -2, distance: 0.3 }] : [] },
		marbles: marbles.map((marble, index) => ({
			id: marble.marbleId,
			radius: marble.radius,
			hitTimes: index === 0 ? melody : bass,
			motion: {
				time: Float64Array.from(marble.samples, (sample) => sample.time),
				x: Float64Array.from(marble.samples, (sample) => sample.position.x),
				y: Float64Array.from(marble.samples, (sample) => sample.position.y)
			}
		}))
	});
	if (track == null) throw new Error('No track');
	return { result, track };
}

describe('framingStretches function', () => {
	it('should not count a marble out of frame while it does not play', () => {
		// The melody plays first and the bass later; the camera pans from one to the other
		const { result, track } = scene([0.5, 1, 1.5, 2, 2.5], [7, 7.5, 8, 8.5, 9, 9.5]);

		expect(framingStretches(result, track)).toEqual([]);
	});

	it('should report the marble the camera leaves out while it plays, with its notes there', () => {
		// Both play throughout; the melody, with more notes ahead, leads the frame
		const melody = Array.from({ length: 19 }, (_, index) => 0.5 + index * 0.5);
		const bass = [1.25, 3.25, 5.25, 7.25, 9.25];
		const { result, track } = scene(melody, bass);

		const stretches = framingStretches(result, track);

		expect(stretches.length).toBeGreaterThan(0);
		for (const stretch of stretches) {
			expect(stretch.marbleId).toBe('bass');
			expect(stretch.to - stretch.from).toBeGreaterThan(0.5);
			expect(stretch.notes.length).toBeGreaterThan(0);
			for (const note of stretch.notes) expect(note >= stretch.from && note <= stretch.to).toBe(true);
		}
		expect(stretches.flatMap((stretch) => stretch.notes)).toEqual(bass.filter((time) => stretches.some((stretch) => time >= stretch.from && time <= stretch.to)));
	});
});
