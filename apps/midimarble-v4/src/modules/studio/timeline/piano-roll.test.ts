import { describe, expect, it } from 'vitest';
import type { TLane } from '@/modules/project';
import { clampPitch, hasPitches, isBlackKey, OPENING_GAP, openingRollOffset, pitchDeltaFor, pitchRange, pitchToRow, rowCount, rowToPitch } from './piano-roll';

function lane(pitches: (number | undefined)[]): TLane {
	return {
		id: 'lane',
		name: 'Melody',
		color: '#f00',
		instrument: 9,
		hits: pitches.map((pitch, index) => ({ id: `hit-${index}`, time: index, pitch }))
	};
}

describe('piano roll', () => {
	describe('pitchRange function', () => {
		it('should span the notes plus two semitones on each side', () => {
			expect(pitchRange(lane([64, 60, 67]))).toEqual({ low: 58, high: 69 });
		});

		it('should return null for a track without pitches', () => {
			expect(pitchRange(lane([undefined, undefined]))).toBeNull();
			expect(hasPitches(lane([undefined]))).toBe(false);
		});

		it('should stay inside the MIDI range', () => {
			expect(pitchRange(lane([0, 127]))).toEqual({ low: 0, high: 127 });
		});
	});

	describe('row mapping', () => {
		const range = { low: 58, high: 69 };

		it('should put the highest pitch in the top row', () => {
			expect(rowCount(range)).toBe(12);
			expect(pitchToRow(69, range)).toBe(0);
			expect(pitchToRow(58, range)).toBe(11);
		});

		it('should map a y offset back to the pitch of its row', () => {
			expect(rowToPitch(0, range, 12)).toBe(69);
			expect(rowToPitch(12 * 3 + 5, range, 12)).toBe(66);
		});

		it('should clamp offsets outside the rows', () => {
			expect(rowToPitch(-30, range, 12)).toBe(69);
			expect(rowToPitch(1000, range, 12)).toBe(58);
			expect(clampPitch(80, range)).toBe(69);
		});
	});

	describe('pitchDeltaFor function', () => {
		it('should snap a drag to whole semitones with up being higher', () => {
			expect(pitchDeltaFor(-24, 12)).toBe(2);
			expect(pitchDeltaFor(5, 12)).toBe(0);
			expect(pitchDeltaFor(7, 12)).toBe(-1);
		});
	});

	describe('isBlackKey function', () => {
		it('should mark sharps as black keys', () => {
			expect([60, 61, 62, 63, 64, 65, 66].map(isBlackKey)).toEqual([false, true, false, true, false, false, true]);
		});
	});
});

describe('openingRollOffset', () => {
	// 40 rows of 10 px in a 120 px track: C2 (36) to D♯5 (75)
	const range = { low: 36, high: 75 };

	it('should open with the first notes\' top row just below the ruler', () => {
		const notes = [
			{ time: 5, pitch: 74 },
			{ time: 0, pitch: 67 },
			{ time: 0.5, pitch: 64 },
			{ time: 0.2, pitch: 40 }
		];
		// Without the D5 the opening tops out at G4 (67), row 8; with it, D5 is row 1
		expect(openingRollOffset(notes.slice(1), range, 10, 120)).toBe(8 * 10 - OPENING_GAP);
		expect(openingRollOffset(notes, range, 10, 120)).toBe(1 * 10 - OPENING_GAP);
	});

	it('should stay within the roll and open at the top without pitches', () => {
		expect(openingRollOffset([{ time: 0, pitch: 36 }], range, 10, 120)).toBe(400 - 120);
		expect(openingRollOffset([{ time: 0, pitch: 75 }], range, 10, 120)).toBe(0);
		expect(openingRollOffset([{ time: 0 }], range, 10, 120)).toBe(0);
	});
});
