import { describe, expect, it } from 'vitest';
import { noteName, parseHexColor, parseNoteName, stepPitch } from './format';

describe('parseHexColor function', () => {
	it('should read a typed color with or without its #, also the short form', () => {
		expect(parseHexColor('#3478F6')).toBe('#3478f6');
		expect(parseHexColor(' 3478f6 ')).toBe('#3478f6');
		expect(parseHexColor('#3af')).toBe('#33aaff');
	});

	it('should refuse anything else', () => {
		for (const value of ['', '#', '#12', '#12345', '#1234567', '#12345g', 'red']) expect(parseHexColor(value)).toBeNull();
	});
});

describe('note names', () => {
	it('should name MIDI pitches with the octave', () => {
		expect(noteName(69)).toBe('A4');
		expect(noteName(61)).toBe('C♯4');
	});

	it('should parse note names with sharps, flats and MIDI numbers', () => {
		expect(parseNoteName('A4')).toBe(69);
		expect(parseNoteName('f#3')).toBe(54);
		expect(parseNoteName('Bb3')).toBe(58);
		expect(parseNoteName('60')).toBe(60);
	});

	it('should clear on empty input and reject invalid names', () => {
		expect(parseNoteName(' ')).toBeNull();
		expect(parseNoteName('H2')).toBeUndefined();
		expect(parseNoteName('200')).toBeUndefined();
	});

	it('should keep stepped pitches inside the MIDI range', () => {
		expect(stepPitch(69, 1)).toBe(70);
		expect(stepPitch(126, 12)).toBe(127);
		expect(stepPitch(3, -12)).toBe(0);
	});
});
