import { describe, expect, it } from 'vitest';
import { applyProjectCommands, createMarble, createProject, type THit, type TProject } from '@/modules/project';
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
	it('should leave the length, whatever it followed: an edit never changes it', () => {
		expect(moved(project([tied('a', 2)], 2.4), 3).length).toBe(2.4);
		expect(moved(project([tied('a', 2)], 30), 3).length).toBe(30);
		expect(moved(project([tied('a', 2)], 12), 3).length).toBe(12);
		expect(moved(project([tied('a', 2)], 12), 20).length).toBe(12);
	});
});
