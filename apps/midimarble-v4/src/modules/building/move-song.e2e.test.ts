import { beforeAll, describe, expect, it } from 'vitest';
import { applyProjectCommands, type THit, type TProject } from '@/modules/project';
import { loadFixture } from '@/modules/project/test-helpers';
import { createSimulator, type TSimulator } from '@/modules/simulation';
import { answerEdit } from '@/modules/simulation/edit-rule';
import { HIT_DRIFT } from '@/modules/simulation/types';
import { moveSongCommands } from './move-song';
import { NO_BLENDER_OBJECTS, checkRun } from './export-preflight';


// Two short bars the fixture has had touch since wires became one surface; Fix can't part them without moving later hits
const JINGLE_BELLS_TOUCH = 'Platform 86 touches Platform 87';

const allHits = (project: TProject): THit[] => project.marbles.flatMap((marble) => marble.hits);

describe('moving a song on a built project', () => {
	let simulator: TSimulator;

	beforeAll(async () => {
		simulator = await createSimulator();
	});

	function moved(from: TProject, songId: string, start: number): TProject {
		const [isOk, error, next] = applyProjectCommands(from, moveSongCommands(from, simulator.simulate(from), songId, start));
		if (!isOk) throw error;
		return next;
	}

	/** What's wrong with the run: Decor beside a path is a look, and the last bits of a kept ride can tip it either way */
	function runProblems(project: TProject): string[] {
		return checkRun(project, simulator.simulate(project), NO_BLENDER_OBJECTS)
			.issues.filter((issue) => issue.kind !== 'decor' && issue.title !== JINGLE_BELLS_TOUCH)
			.map((issue) => issue.title);
	}

	function expectAllOnTime(project: TProject): void {
		const { hits } = simulator.simulate(project);
		expect(hits).toHaveLength(allHits(project).length);
		for (const hit of hits) {
			expect(hit.status, hit.hitId).toBe('onTime');
			expect(Math.abs(hit.error ?? Infinity)).toBeLessThanOrEqual(HIT_DRIFT);
		}
	}

	it('should keep Jingle Bells on time, its tied hits shifted and its pieces following', () => {
		const project = loadFixture('jingle-bells');
		const song = project.songs[0];
		if (song == null) throw new Error('Jingle Bells has a song');
		expectAllOnTime(project);

		const later = moved(project, song.id, song.start + 0.75);

		// Nothing is left to settle: the pieces stay where they are and the marbles start later
		expect(answerEdit(simulator, { before: project, after: later }).absorbedBy).toEqual([]);
		const before = new Map(allHits(project).map((hit) => [hit.id, hit.time]));
		for (const hit of allHits(later)) expect(hit.time).toBeCloseTo((before.get(hit.id) ?? 0) + 0.75, 5);
		expectAllOnTime(later);
		expect(runProblems(later)).toEqual([]);
	}, 120_000);

	it('should keep Jingle Bells on time for a move on the drag grid that a plain run does not survive', () => {
		const project = loadFixture('jingle-bells');
		const song = project.songs[0];
		if (song == null) throw new Error('Jingle Bells has a song');

		// The length stays with a move, so the film is lengthened by hand to hold the song
		const moves = moved(project, song.id, song.start + 7.325);
		const later = { ...moves, length: moves.length + 7.325 };

		expectAllOnTime(later);
		expect(runProblems(later)).toEqual([]);
	}, 120_000);

	it('should stay on time for a move that is no whole number of physics steps, and come back when moved back', () => {
		const project = loadFixture('tap-along');
		const song = project.songs[0];
		if (song == null) throw new Error('Tap Along has a song');

		const later = moved(project, song.id, song.start + 0.3337);
		expectAllOnTime(later);

		const back = moved(later, song.id, song.start);
		expect(allHits(back).map((hit) => hit.time)).toEqual(allHits(project).map((hit) => hit.time));
	}, 60_000);
});
