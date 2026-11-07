import { describe, expect, it } from 'vitest';
import { formatSignedTime, formatTime } from './format';
import { parseSignedTime, parseTime } from './parse-time';

describe('parseTime function', () => {
	it('should read minutes, seconds and hundredths', () => {
		expect(parseTime('1:23.45')).toBeCloseTo(83.45);
		expect(parseTime('0:05')).toBe(5);
	});

	it('should read plain seconds', () => {
		expect(parseTime('12.5')).toBe(12.5);
		expect(parseTime(' 90 ')).toBe(90);
		expect(parseTime('.5')).toBe(0.5);
		expect(parseTime('3,25')).toBe(3.25);
	});

	it('should read back what the time display shows', () => {
		expect(parseTime(formatTime(75.36))).toBeCloseTo(75.36);
	});

	it('should reject text that is not a time', () => {
		expect(parseTime('')).toBeNull();
		expect(parseTime('abc')).toBeNull();
		expect(parseTime('-3')).toBeNull();
		expect(parseTime('1:75')).toBeNull();
	});
});

describe('parseSignedTime function', () => {
	it('should read a time before 0 as formatSignedTime writes it', () => {
		expect(parseSignedTime(formatSignedTime(-2.5))).toBeCloseTo(-2.5);
		expect(parseSignedTime('-1.5')).toBeCloseTo(-1.5);
		expect(parseSignedTime('0:03')).toBeCloseTo(3);
		expect(parseSignedTime('-abc')).toBeNull();
	});
});
