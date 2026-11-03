import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseProject, type TProject } from '@/modules/project';
import { createSimulator } from '@/modules/simulation/simulate';
import { describeLoop } from './loop-status';

function loadLoopFixture(): TProject {
	const json = readFileSync(new URL('../../../fixtures/loop.marble.json', import.meta.url), 'utf8');
	const [isProjectOk, projectErr, project] = parseProject(json);
	if (!isProjectOk) throw projectErr;
	return project;
}

describe('describeLoop function', () => {
	it('should report the loop range, its bars and a match on the loop fixture', async () => {
		const project = loadLoopFixture();
		const simulator = await createSimulator();

		const status = describeLoop(project, simulator.simulate(project));

		expect(status).toEqual({ isOk: true, summary: 'Loops 0:00.47 to 0:09.47 · 3 bars · start and end match', details: [], snappedEnd: null });
	});

	it('should offer the bar-aligned end when the loop is off the bar grid', async () => {
		const project = loadLoopFixture();
		const barEnd = project.end;
		project.end -= 0.5;
		const simulator = await createSimulator();

		const status = describeLoop(project, simulator.simulate(project));

		expect(status.isOk).toBe(false);
		expect(status.details.some((detail) => detail.includes('than whole bars'))).toBe(true);
		expect(status.snappedEnd).toBeCloseTo(barEnd, 6);
	});
});
