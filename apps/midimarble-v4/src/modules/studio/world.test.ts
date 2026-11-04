import { describe, expect, it } from 'vitest';
import type { TProject } from '@/modules/project';
import { songFitEnd } from './world';

function projectWithHits(times: number[][], finishes: number[] = []): TProject {
	return {
		music: { sources: [], lanes: times.map((hits, index) => ({ id: `lane-${index}`, hits: hits.map((time, hit) => ({ id: `hit-${hit}`, time })) })), backing: [] },
		entities: finishes.map((index) => ({
			id: `finish-${index}`,
			components: { piece: { type: 'finish', params: {} }, hitLink: { laneId: `lane-${index}`, hitId: 'hit-0', angle: 0, contactAt: 0.5, pinned: false, anchored: true } }
		}))
	} as unknown as TProject;
}

describe('songFitEnd function', () => {
	it('should end SONG_TAIL after the last note of any marble', () => {
		expect(songFitEnd(projectWithHits([[0.5, 4.2], [6.04]]))).toBe(6.44);
	});

	it('should end FINISH_TAIL after the last note when every marble that plays last has a Finish', () => {
		// Lane 0 ends 1.84 s before lane 1, so only lane 1 plays last
		expect(songFitEnd(projectWithHits([[0.5, 4.2], [6.04]], [1]))).toBe(7.24);
		expect(songFitEnd(projectWithHits([[0.5, 5.2], [6.04]], [1]))).toBe(6.44);
		expect(songFitEnd(projectWithHits([[0.5, 5.2], [6.04]], [0, 1]))).toBe(7.24);
	});

	it('should return null without notes', () => {
		expect(songFitEnd(projectWithHits([[]]))).toBeNull();
	});
});
