import { describe, expect, it } from 'vitest';
import { bowlTail, SONG_TAIL, songEnd } from '@/modules/music';
import { type TProject } from '@/modules/project';
import { createSimulator } from '@/modules/simulation';
import { exitRunProject, bowlExit, fittedSongEnd } from './bowl-exit';
import { loadFixture } from '@/modules/project/test-helpers';

const SIMULATION_TIMEOUT = 20_000;

describe('bowlExit', () => {
	it(
		'should hold the marbles in frame in their Bowls and give the longest tail to Fit to Song',
		async () => {
			const simulator = await createSimulator();
			const simulate = (project: TProject) => simulator.simulate(project);

			const duet = loadFixture('two-marbles');
			const trial = exitRunProject(duet) as TProject;
			const exit = bowlExit(trial, simulate(trial));
			expect(exit).toBe(Number.POSITIVE_INFINITY);
			expect(await fittedSongEnd(duet, simulate)).toBe(songEnd(1.55, bowlTail(exit ?? 0)));
			simulator.dispose();
		},
		SIMULATION_TIMEOUT
	);

	it(
		'should keep the song tail without a Bowl',
		async () => {
			const simulator = await createSimulator();
			const zigzag = loadFixture('zigzag');
			const last = Math.max(...zigzag.marbles.flatMap((marble) => marble.hits.map((hit) => hit.time)));
			expect(await fittedSongEnd(zigzag, (project) => simulator.simulate(project))).toBeCloseTo(last + SONG_TAIL, 6);
			simulator.dispose();
		},
		SIMULATION_TIMEOUT
	);
});
