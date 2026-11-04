import { describe, expect, it } from 'vitest';
import type { TProject } from '@/modules/project';
import { songFitEnd } from './world';

function projectWithHits(times: number[][]): TProject {
	return {
		music: { sources: [], lanes: times.map((hits, index) => ({ id: `lane-${index}`, hits: hits.map((time, hit) => ({ id: `hit-${hit}`, time })) })) }
	} as unknown as TProject;
}

describe('songFitEnd function', () => {
	it('should end SONG_TAIL after the last note of any marble', () => {
		expect(songFitEnd(projectWithHits([[0.5, 4.2], [6.04]]))).toBe(6.44);
	});

	it('should return null without notes', () => {
		expect(songFitEnd(projectWithHits([[]]))).toBeNull();
	});
});
