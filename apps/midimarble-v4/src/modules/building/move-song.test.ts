import { describe, expect, it } from 'vitest';
import { applyProjectCommands, createMarble, createProject, type THit, type TProject } from '@/modules/project';
import { marbleEdits } from '@/modules/simulation/local-edit';
import { moveSongCommands } from './move-song';

const tied = (id: string, time: number): THit => ({ id, time, pitch: 60, songId: 'song' });

function project(hits: THit[], length: number): TProject {
	return {
		...createProject({ title: 'Move' }),
		length,
		songs: [{ id: 'song', name: 'Song.mid', kind: 'midi', path: 'song.mid', start: 1, backing: [] }],
		marbles: [{ ...createMarble(0, { x: 0, y: 0 }, 'melody'), start: { position: { x: 0, y: 0 }, time: 0.5 }, hits }]
	};
}

function moved(from: TProject, start: number): TProject {
	const [isOk, error, next] = applyProjectCommands(from, moveSongCommands(from, null, 'song', start));
	if (!isOk) throw error;
	return next;
}

describe('moveSongCommands function', () => {
	it('should take a length that follows the song along, in the same edit', () => {
		// The last hit at 2 plus the 0.4 s tail
		expect(moved(project([tied('a', 2)], 2.4), 3).length).toBeCloseTo(4.4);
	});

	it('should leave a length the person set', () => {
		expect(moved(project([tied('a', 2)], 30), 3).length).toBe(30);
	});

	it('should grow the default length when the song runs past it and never shorten it', () => {
		expect(moved(project([tied('a', 2)], 12), 3).length).toBe(12);
		expect(moved(project([tied('a', 2)], 12), 20).length).toBeCloseTo(21.4);
	});
});

describe('marbleEdits function after a song moves', () => {
	it('should have nothing to settle for a marble whose whole run moved', () => {
		const from = project([tied('a', 2), tied('b', 3)], 30);

		expect(marbleEdits(from, moved(from, 3))).toEqual([]);
	});

	it('should settle a marble that also has hits of its own, whose run changed', () => {
		const base = project([tied('a', 2), tied('b', 3), { id: 'own', time: 3.5 }], 30);
		const from: TProject = {
			...base,
			track: {
				...base.track,
				pieces: ['a', 'b', 'own'].map((hitId) => ({ id: `piece-${hitId}`, type: 'platform', params: {}, angle: 0, place: { kind: 'plays', marbleId: 'melody', hitId, contactAt: 0.5 } }))
			}
		};

		expect(marbleEdits(from, moved(from, 1.25)).map((edit) => edit.marbleId)).toEqual(['melody']);
	});
});
