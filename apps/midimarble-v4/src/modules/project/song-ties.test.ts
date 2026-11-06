import { describe, expect, it } from 'vitest';
import { applyProjectCommands, backingOf, earliestSongStart, hitsOfSong, SProjectCommand, songPlayingAt, type TProjectCommand } from './commands';
import { createMarble, createProject } from './create-project';
import { createHistory, pushHistory, undoHistory } from './history';
import { BACKING_ID, type THit, type TProject, type TSong } from './schema';

const song = (id: string, patch: Partial<TSong> = {}): TSong => ({ id, name: `${id}.mid`, kind: 'midi', path: `${id}.mid`, start: 1, backing: [], ...patch });
const tied = (id: string, time: number, songId = 'a'): THit => ({ id, time, pitch: 60, songId });
const own = (id: string, time: number): THit => ({ id, time });

function project(songs: TSong[], melody: THit[], bass: THit[] = []): TProject {
	const base = createProject({ title: 'Ties' });
	return {
		...base,
		songs,
		marbles: [
			{ ...createMarble(0, { x: 0, y: 0 }, 'melody'), start: { position: { x: 0, y: 0 }, time: 0.5 }, hits: melody },
			{ ...createMarble(1, { x: 0.26, y: 0 }, 'bass'), start: { position: { x: 0.26, y: 0 }, time: 0.5 }, hits: bass }
		]
	};
}

function apply(from: TProject, commands: TProjectCommand[]): TProject {
	const [isOk, error, next] = applyProjectCommands(from, commands);
	if (!isOk) throw error;
	return next;
}

const hitTimes = (from: TProject, marbleId: string): number[] => from.marbles.find((marble) => marble.id === marbleId)?.hits.map((hit) => hit.time) ?? [];

describe('moveSong command', () => {
	it('should shift the start, the hits tied to the song and its Backing, and leave other hits where they are', () => {
		const from = project([song('a', { backing: [{ id: 'n', time: 2, pitch: 40 }] }), song('b')], [tied('x', 1), own('y', 1.5)], [tied('z', 3, 'b')]);

		const moved = apply(from, [{ type: 'moveSong', songId: 'a', start: 3 }]);

		expect(moved.songs.map((item) => item.start)).toEqual([3, 1]);
		expect(hitTimes(moved, 'melody')).toEqual([1.5, 3]);
		expect(hitTimes(moved, 'bass')).toEqual([3]);
		expect(backingOf(moved).map((hit) => hit.time)).toEqual([4]);
	});

	it('should take one Undo, however many hits move', () => {
		const from = project([song('a')], [tied('x', 1), tied('y', 2)], [tied('z', 3)]);

		const history = pushHistory(createHistory(from), apply(from, [{ type: 'moveSong', songId: 'a', start: 2 }]));

		const { marbles, songs } = undoHistory(history).present;
		expect({ marbles, songs }).toEqual({ marbles: from.marbles, songs: from.songs });
	});

	it('should move the release of a marble that plays only this song, so its whole run moves', () => {
		const from = project([song('a')], [tied('x', 1), own('y', 1.5)], [tied('z', 3)]);

		const moved = apply(from, [{ type: 'moveSong', songId: 'a', start: 2 }]);

		expect(moved.marbles.map((marble) => marble.start.time)).toEqual([0.5, 1.5]);
	});

	it('should leave a marble with no hits and no song where it is', () => {
		const from = project([song('a')], [tied('x', 1)], []);

		const moved = apply(from, [{ type: 'moveSong', songId: 'a', start: 2 }]);

		expect(moved.marbles[1]).toBe(from.marbles[1]);
	});

	it('should come back to the same times after moving there and back', () => {
		const from = project([song('a')], [tied('x', 1.2345)]);

		const back = apply(apply(from, [{ type: 'moveSong', songId: 'a', start: 1.37 }]), [{ type: 'moveSong', songId: 'a', start: 1 }]);

		expect(hitTimes(back, 'melody')).toEqual([1.2345]);
	});

	it('should refuse a start that would put a note or a release before 0 and name the song', () => {
		const from = project([song('a')], [tied('x', 2)]);

		expect(earliestSongStart(from, 'a')).toBe(0.5);
		const [isOk, error] = applyProjectCommands(from, [{ type: 'moveSong', songId: 'a', start: 0.4 }]);
		expect(isOk).toBe(false);
		expect(error?.message).toContain('Song a');
		expect(applyProjectCommands(from, [{ type: 'moveSong', songId: 'nope', start: 1 }])[0]).toBe(false);
	});

	it('should let a recording start before 0, like trimming a clip, as far as what goes with it allows', () => {
		const alone = project([song('a', { kind: 'audio', start: 0.75 })], [own('x', 0.2)]);
		expect(earliestSongStart(alone, 'a')).toBe(Number.NEGATIVE_INFINITY);

		const [isOk, error, moved] = applyProjectCommands(alone, [{ type: 'moveSong', songId: 'a', start: -3 }]);
		if (!isOk) throw error;
		expect(moved.songs[0]?.start).toBe(-3);

		const withHit = project([song('a', { kind: 'audio', start: 0.75 })], [tied('t', 2)]);
		expect(earliestSongStart(withHit, 'a')).toBeCloseTo(0.25, 6);
	});

	it('should not change a start through updateSong, which would leave the hits behind', () => {
		const from = project([song('a')], []);

		expect(SProjectCommand.safeParse({ type: 'updateSong', songId: from.songs[0]?.id, patch: { start: 2 } }).success).toBe(false);
	});
});

describe('Backing per song', () => {
	it('should keep each song its own Backing when notes are added and edited', () => {
		const from = project([song('a', { backing: [{ id: 'n', time: 1, pitch: 40 }] }), song('b')], []);

		const next = apply(from, [{ type: 'upsertHits', marbleId: BACKING_ID, hits: [{ id: 'n', time: 1.5, pitch: 40 }, { id: 'm', time: 2, pitch: 41, songId: 'b' }] }]);

		expect(next.songs.map((item) => item.backing)).toEqual([[{ id: 'n', time: 1.5, pitch: 40 }], [{ id: 'm', time: 2, pitch: 41 }]]);
	});

	it('should tie a Backing note to its song when a marble takes it, and hand it back to that song', () => {
		const from = project([song('a'), song('b', { backing: [{ id: 'n', time: 1, pitch: 40 }] })], []);

		const taken = apply(from, [{ type: 'assignHits', hitIds: ['n'], marbleId: 'melody' }]);
		expect(taken.marbles[0]?.hits).toEqual([{ id: 'n', time: 1, pitch: 40, songId: 'b' }]);
		expect(backingOf(taken)).toEqual([]);

		const back = apply(taken, [{ type: 'assignHits', hitIds: ['n'], marbleId: BACKING_ID }]);
		expect(back.songs.map((item) => item.backing)).toEqual([[], [{ id: 'n', time: 1, pitch: 40 }]]);
	});

	it('should keep the tie when a hit goes to another marble, and clear it when its song is deleted', () => {
		const from = project([song('a')], [tied('x', 1)]);

		const handed = apply(from, [{ type: 'assignHits', hitIds: ['x'], marbleId: 'bass' }]);
		expect(handed.marbles[1]?.hits[0]?.songId).toBe('a');

		const deleted = apply(handed, [{ type: 'removeSong', songId: 'a' }]);
		expect(deleted.marbles[1]?.hits).toEqual([{ id: 'x', time: 1, pitch: 60 }]);
	});
});

describe('hitsOfSong function', () => {
	it('should list the hits tied to it on every marble and its Backing', () => {
		const from = project([song('a', { backing: [{ id: 'n', time: 2 }] })], [tied('x', 1), own('y', 1.5)], [tied('z', 3)]);

		expect(hitsOfSong(from, 'a').map((hit) => hit.id)).toEqual(['x', 'z', 'n']);
	});
});

describe('songPlayingAt function', () => {
	it('should give the song that started last by then, and none before the first', () => {
		const from = project([song('a', { start: 1 }), song('b', { start: 5 })], []);

		expect(songPlayingAt(from, 0.5)).toBeUndefined();
		expect(songPlayingAt(from, 2)?.id).toBe('a');
		expect(songPlayingAt(from, 6)?.id).toBe('b');
	});
});
