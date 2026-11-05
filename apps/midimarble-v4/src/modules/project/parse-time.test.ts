import { describe, expect, it } from 'vitest';
import { formatTime } from './format';
import { parseTime } from './parse-time';

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
