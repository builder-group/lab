import { describe, expect, it } from 'vitest';
import { BACKING_ID, type THit, type TProject, type TSong } from '@/modules/project';
import { addNoteCommands, clampPitch, isBlackKey, maxNoteLength, noteDragCommands, OPENING_GAP, openingRollOffset, pitchDeltaFor, pitchToRow, resizedNoteLength, rowCount, snapNoteTime, songRollRange } from './piano-roll';

function project(marbles: (number | undefined)[][], backing: (number | undefined)[] = []): TProject {
	const hits = (id: string, pitches: (number | undefined)[]): THit[] => pitches.map((pitch, index) => ({ id: `${id}-${index}`, time: index, pitch }));
	return {
		songs: [{ id: 'song', name: '', kind: 'midi', start: 0, backing: hits('backing', backing) }],
		marbles: marbles.map((pitches, index) => ({ id: `marble-${index}`, name: 'Melody', labelColor: '#f00', sound: 9, hits: hits(`hit-${index}`, pitches).map((hit) => ({ ...hit, songId: 'song' })) }))
	} as unknown as TProject;
}

/** The same notes as hits of the marbles' own */
function untied(marbles: (number | undefined)[][], backing: (number | undefined)[] = []): TProject {
	const tied = project(marbles, backing);
	return { ...tied, marbles: tied.marbles.map((marble) => ({ ...marble, hits: marble.hits.map(({ songId: _songId, ...hit }) => hit) })) };
}

const midi = { id: 'song', kind: 'midi' } as TSong;
const audio = { id: 'song', kind: 'audio' } as TSong;

describe('piano roll', () => {
	describe('adding a note', () => {
		it('should be one edit that gives the marble a pitched hit with its length, so the run gets a dot for it', () => {
			const song = project([[64, 60]]);
			const { hit, commands } = addNoteCommands('marble-0', 'midi', { time: 0.5, pitch: 67, duration: 0.25 });

			expect(commands).toEqual([{ type: 'upsertHits', marbleId: 'marble-0', hits: [hit] }]);
			expect(hit).toMatchObject({ time: 0.5, pitch: 67, duration: 0.25 });
			expect(songRollRange(song, midi)).not.toBeNull();
		});

		it('should snap to the sixteenth only when the pointer is close to it', () => {
			// 120 BPM: sixteenths every 0.125 s; at 100 px/s a line within 6 px is within 0.06 s
			expect(snapNoteTime(0.51, 120, 100)).toBeCloseTo(0.5);
			expect(snapNoteTime(0.56, 120, 100)).toBeCloseTo(0.56);
			expect(snapNoteTime(0.51, undefined, 100)).toBeCloseTo(0.5);
		});

		it('should limit a resized note to what it can sound for', () => {
			expect(resizedNoteLength('marble-0', 0.25, 50, 100)).toBeCloseTo(0.6);
			expect(resizedNoteLength(BACKING_ID, 0.25, 50, 100)).toBeCloseTo(0.75);
			expect(resizedNoteLength('marble-0', 0.25, -500, 100)).toBeCloseTo(0.05);
			expect(maxNoteLength(BACKING_ID)).toBeGreaterThan(maxNoteLength('marble-0'));
		});
	});

	describe('songRollRange function', () => {
		it('should span every note of the marbles and Backing plus two semitones on each side', () => {
			expect(songRollRange(project([[64, 60]], [67]), midi)).toEqual({ low: 58, high: 69 });
			expect(songRollRange(project([], [64]), midi)).toEqual({ low: 62, high: 66 });
		});

		it('should leave out the hits of a marble that are not tied to the song', () => {
			const song = project([[64]]);
			const own = { ...song, marbles: song.marbles.map((marble) => ({ ...marble, hits: [...marble.hits, { id: 'own', time: 3, pitch: 90 }] })) };

			expect(songRollRange(own, midi)).toEqual({ low: 62, high: 66 });
		});

		it('should give a recording no roll, so its layer stays a flat waveform', () => {
			expect(songRollRange(project([[64, 60]]), audio)).toBeNull();
		});

		it('should give a song without pitched notes no empty roll', () => {
			expect(songRollRange(project([[undefined]]), midi)).toBeNull();
			expect(songRollRange(project([]), midi)).toBeNull();
		});

		it('should stay inside the MIDI range', () => {
			expect(songRollRange(project([[0, 127]]), midi)).toEqual({ low: 0, high: 127 });
		});
	});

	describe('noteDragCommands function', () => {
		const range = { low: 58, high: 69 };

		it('should move a marble\'s note and a Backing note in time and pitch, one edit per owner', () => {
			const commands = noteDragCommands(untied([[60, 62]], [64]), { keys: ['hit:marble-0:hit-0-1', `hit:${BACKING_ID}:backing-0`], delta: 0.5, pitchDelta: 2 }, range);

			expect(commands).toEqual([
				{ type: 'upsertHits', marbleId: 'marble-0', hits: [{ id: 'hit-0-1', time: 1.5, pitch: 64 }] },
				{ type: 'upsertHits', marbleId: BACKING_ID, hits: [{ id: 'backing-0', time: 0.5, pitch: 66 }] }
			]);
		});

		it('should keep pitches inside the roll and times from going negative', () => {
			const commands = noteDragCommands(untied([[68]]), { keys: ['hit:marble-0:hit-0-0'], delta: -3, pitchDelta: 5 }, range);

			expect(commands).toEqual([{ type: 'upsertHits', marbleId: 'marble-0', hits: [{ id: 'hit-0-0', time: 0, pitch: 69 }] }]);
		});

		it('should leave pitches alone when a diamond moves in a flat row', () => {
			const commands = noteDragCommands(untied([[60, undefined]]), { keys: ['hit:marble-0:hit-0-0', 'hit:marble-0:hit-0-1'], delta: 1, pitchDelta: 0 }, null);

			expect(commands).toEqual([
				{
					type: 'upsertHits',
					marbleId: 'marble-0',
					hits: [
						{ id: 'hit-0-0', time: 1, pitch: 60 },
						{ id: 'hit-0-1', time: 2, pitch: undefined }
					]
				}
			]);
		});

		it('should make no edit for keys it does not hold', () => {
			expect(noteDragCommands(untied([[60]]), { keys: ['platform-1'], delta: 1, pitchDelta: 0 }, null)).toEqual([]);
		});
	});

	describe('row mapping', () => {
		const range = { low: 58, high: 69 };

		it('should put the highest pitch in the top row', () => {
			expect(rowCount(range)).toBe(12);
			expect(pitchToRow(69, range)).toBe(0);
			expect(pitchToRow(58, range)).toBe(11);
		});

		it('should clamp pitches outside the rows', () => {
			expect(clampPitch(80, range)).toBe(69);
			expect(clampPitch(40, range)).toBe(58);
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
