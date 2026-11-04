import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SONG_TAIL } from '@/modules/music';
import { parseProject, type TProject } from '@/modules/project';
import { createSimulator } from '@/modules/simulation/simulate';
import { exitRunProject, finishExit, fittedSongEnd } from './finish-exit';

const SIMULATION_TIMEOUT = 20_000;

function loadFixture(name: string): TProject {
	const [isOk, err, project] = parseProject(readFileSync(new URL(`../../../fixtures/${name}.marble.json`, import.meta.url), 'utf8'));
	if (!isOk) throw err;
	return project;
}

describe('finishExit', () => {
	it(
		'should measure when the last marble leaves the frame and what Fit to Song gives',
		async () => {
			const simulator = await createSimulator();
			const simulate = (project: TProject) => simulator.simulate(project);

			const jingle = loadFixture('jingle-bells');
			const trial = exitRunProject(jingle) as TProject;
			const exit = finishExit(trial, simulate(trial));
			expect(exit).toBeGreaterThan(0.9);
			expect(exit).toBeLessThan(1.1);
			expect(await fittedSongEnd(jingle, simulate)).toBe(jingle.end);

			// A marble that stays in frame to the end of the run gets the longest tail
			const reference = loadFixture('reference-20');
			expect(finishExit(exitRunProject(reference) as TProject, simulate(exitRunProject(reference) as TProject))).toBe(Number.POSITIVE_INFINITY);
			expect(await fittedSongEnd(reference, simulate)).toBe(reference.end);
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
