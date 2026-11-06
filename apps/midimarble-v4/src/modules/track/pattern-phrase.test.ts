import { describe, expect, it } from 'vitest';
import { createMarble, createProject, type TProject, toHitKey } from '@/modules/project';
import { patternPhrase } from './PatternsCx';

function withHits(times: number[]): TProject {
	const marble = { ...createMarble(0, { x: 0, y: 0.6 }), id: 'marble', hits: times.map((time, index) => ({ id: `h${index}`, time })) };
	return { ...createProject({ title: 'Song' }), marbles: [marble] };
}

const keys = (...ids: string[]): string[] => ids.map((id) => toHitKey('marble', id));

describe('patternPhrase function', () => {
	it('should take the hit and the ones after it, up to a long gap', () => {
		const project = withHits([1, 1.5, 2, 5, 5.5]);
		expect(patternPhrase(project, 'marble', 'h0')).toEqual(keys('h0', 'h1', 'h2'));
		expect(patternPhrase(project, 'marble', 'h3')).toEqual(keys('h3', 'h4'));
	});

	it('should stop at eight notes', () => {
		const project = withHits(Array.from({ length: 12 }, (_, index) => index * 0.5));
		expect(patternPhrase(project, 'marble', 'h0')).toHaveLength(8);
	});

	it('should keep several selected hits as they are', () => {
		const selection = keys('h0', 'h2');
		expect(patternPhrase(withHits([1, 1.5, 2]), 'marble', 'h0', selection)).toEqual(selection);
	});
});
