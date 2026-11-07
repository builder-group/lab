import { describe, expect, it } from 'vitest';
import { hitsBeforeStart, hitsBeforeStartWords } from './marble-start';

const marble = { hits: [{ id: 'a', time: 1 }, { id: 'b', time: 1.5 }, { id: 'c', time: 2 }] };

describe('hitsBeforeStart function', () => {
	it('should count the hits at or before the start', () => {
		expect(hitsBeforeStart(marble, 0.5)).toBe(0);
		expect(hitsBeforeStart(marble, 1)).toBe(1);
		expect(hitsBeforeStart(marble, 1.7)).toBe(2);
		expect(hitsBeforeStart({ hits: [] }, 1)).toBe(0);
	});
});

describe('hitsBeforeStartWords function', () => {
	it('should say nothing before the first note and name the notes past it', () => {
		expect(hitsBeforeStartWords(marble, 0.5)).toBeNull();
		expect(hitsBeforeStartWords(marble, 1.2)).toBe('Hit 1 comes before this start');
		expect(hitsBeforeStartWords(marble, 2.5)).toBe('Hits 1 to 3 come before this start');
	});
});
