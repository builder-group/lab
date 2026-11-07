import { describe, expect, it } from 'vitest';
import { openingFrameNotes, type TOpeningFrame } from './opening-frame';

const GOOD: TOpeningFrame = { time: 0.8, heroName: 'Melody', heroShare: 0.07, lookAlike: null, piecesInFrame: 8, beginsBare: false, underButtons: [] };

describe('openingFrameNotes function', () => {
	it('should say nothing about a frame that holds up', () => {
		expect(openingFrameNotes(GOOD)).toEqual([]);
	});

	it('should name a small marble with its measure', () => {
		expect(openingFrameNotes({ ...GOOD, heroShare: 0.042 })).toEqual(["Melody is 4.2 % of the frame's width, and about 6 % reads on a phone."]);
	});

	it('should say so when the marble is out of the frame', () => {
		expect(openingFrameNotes({ ...GOOD, heroShare: 0 })).toEqual(["Melody isn't in the first frame."]);
	});

	it('should name round Decor that can pass for the marble', () => {
		expect(openingFrameNotes({ ...GOOD, lookAlike: 'Red Bauble' })).toEqual(['Red Bauble is round and close enough to Melody to pass for it.']);
	});

	it('should count pieces unless the song truly begins bare', () => {
		expect(openingFrameNotes({ ...GOOD, piecesInFrame: 3 })).toEqual(['3 pieces are in the first frame, and 6 or more show a track at once.']);
		expect(openingFrameNotes({ ...GOOD, piecesInFrame: 3, beginsBare: true })).toEqual([]);
	});

	it('should name what sits under the buttons', () => {
		expect(openingFrameNotes({ ...GOOD, underButtons: ['Bass'] })).toEqual(["Bass is in the bottom fifth, where YouTube's buttons cover it."]);
	});
});
