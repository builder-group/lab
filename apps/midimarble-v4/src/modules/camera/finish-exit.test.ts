import { describe, expect, it } from 'vitest';
import { finishTail, SONG_TAIL, songEnd } from '@/modules/music';
import { type TProject } from '@/modules/project';
import { createSimulator } from '@/modules/simulation/simulate';
import { exitRunProject, finishExit, fittedSongEnd } from './finish-exit';
import { loadFixture } from '@/modules/project/test-helpers';

const SIMULATION_TIMEOUT = 20_000;

describe('finishExit', () => {
	it(
		'should measure when the last marble leaves the frame and what Fit to Song gives',
		async () => {
			const simulator = await createSimulator();
			const simulate = (project: TProject) => simulator.simulate(project);

			// Its marbles leave through their Finishes' run-outs, so the film ends on that and not at the longest tail
			const duet = loadFixture('two-marbles');
			const trial = exitRunProject(duet) as TProject;
			const exit = finishExit(trial, simulate(trial));
			expect(exit).toBeGreaterThan(0);
			expect(exit).toBeLessThan(1.4);
			expect(await fittedSongEnd(duet, simulate)).toBe(songEnd(1.55, finishTail(exit ?? 0)));
			simulator.dispose();
		},
		SIMULATION_TIMEOUT
	);

	it(
		'should keep the song tail without a Finish',
		async () => {
			const simulator = await createSimulator();
			const zigzag = loadFixture('zigzag');
			const last = Math.max(...zigzag.music.lanes.flatMap((lane) => lane.hits.map((hit) => hit.time)));
			expect(await fittedSongEnd(zigzag, (project) => simulator.simulate(project))).toBeCloseTo(last + SONG_TAIL, 6);
			simulator.dispose();
		},
		SIMULATION_TIMEOUT
	);
});
