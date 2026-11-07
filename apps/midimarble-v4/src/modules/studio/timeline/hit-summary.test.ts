import { describe, expect, it } from 'vitest';
import { summaryWords } from './hit-summary';

describe('summaryWords function', () => {
	it('should count built notes, so notes still to build never read as failures', () => {
		expect(summaryWords({ hitProblems: 0, otherProblems: 0, onTime: 11, total: 51 }, 11)).toBe('11 built · all on time');
	});

	it('should say how many need attention, with the other problems after them', () => {
		expect(summaryWords({ hitProblems: 2, otherProblems: 1, onTime: 9, total: 51 }, 11)).toBe('2 need attention · 1 other problem');
	});

	it('should say nothing is built yet on a new track', () => {
		expect(summaryWords({ hitProblems: 0, otherProblems: 0, onTime: 0, total: 51 }, 0)).toBe('Nothing built yet');
		expect(summaryWords({ hitProblems: 0, otherProblems: 2, onTime: 0, total: 0 }, 0)).toBe('2 problems');
	});
});
