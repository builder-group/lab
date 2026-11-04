import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseProject, type TProject } from '@/modules/project';
import { createPerfProject, createStaircaseProject } from './fixture-projects';
import { createSimulator } from './simulate';

function setAngle(project: TProject, entityId: string, angle: number): void {
	const hitLink = project.entities.find((entity) => entity.id === entityId)?.components.hitLink;
	if (hitLink == null) throw new Error(`Missing linked piece ${entityId}`);
	hitLink.angle = angle;
}

describe('simulation performance', () => {
	it('reflows staircase within 50 ms after rotating an early platform', async () => {
		// Other test files run in parallel, so each edit keeps its best of three runs to filter out
		// scheduler and GC pauses
		const runs: number[][] = [];
		for (let run = 0; run < 3; run++) {
			const simulator = await createSimulator();
			const project = createStaircaseProject();
			simulator.simulate(project);
			const timings: number[] = [];
			for (const angle of [0.1, 0.12, 0.14, 0.16, 0.18]) {
				setAngle(project, 'piece-1-2', angle);
				timings.push(simulator.simulate(project).stats.computeMs);
			}
			simulator.dispose();
			runs.push(timings);
		}
		const timings = (runs[0] ?? []).map((_, i) =>
			Math.min(...runs.map((run) => run[i] ?? Infinity))
		);
		const worst = Math.max(...timings);
		console.log(`staircase reflow: ${timings.map((t) => t.toFixed(1)).join(', ')} ms`);
		expect(worst).toBeLessThan(50);
	});

	it('reflows a 60 second, four marble project within 250 ms after an edit at 10 s', async () => {
		const simulator = await createSimulator();
		const project = createPerfProject();
		const full = simulator.simulate(project);
		const timings: number[] = [];
		for (const angle of [0.25, 0.27, 0.29, 0.31, 0.33]) {
			setAngle(project, 'piece-1-17', angle);
			const result = simulator.simulate(project);
			expect(result.stats.reusedUntil).toBeCloseTo(10.2, 6);
			timings.push(result.stats.computeMs);
		}
		const pieces = project.entities.filter((entity) => entity.components.piece != null).length;
		console.log(
			`60 s, 4 marbles, ${pieces} platforms: full ${full.stats.computeMs.toFixed(1)} ms, reflow from 10.2 s ${timings.map((t) => t.toFixed(1)).join(', ')} ms`
		);
		const median = timings.slice().sort((a, b) => a - b)[2] ?? Infinity;
		expect(median).toBeLessThan(250);
	}, 30000);

	it('simulates the windmill fixture and reflows it within 50 ms', async () => {
		const json = readFileSync(
			new URL('../../../fixtures/windmill.marble.json', import.meta.url),
			'utf8'
		);
		const [isProjectOk, projectErr, project] = parseProject(json);
		if (!isProjectOk) throw projectErr;
		const simulator = await createSimulator();
		const full = simulator.simulate(project);
		const timings: number[] = [];
		for (const angle of [0.26, 0.28, 0.3, 0.32, 0.34]) {
			setAngle(project, 'piece-1-2', angle);
			timings.push(simulator.simulate(project).stats.computeMs);
		}
		simulator.dispose();
		const median = timings.slice().sort((a, b) => a - b)[2] ?? Infinity;
		console.log(
			`windmill ${full.stats.steps} steps: full ${full.stats.computeMs.toFixed(1)} ms, reflow from 0.45 s ${timings.map((t) => t.toFixed(1)).join(', ')} ms`
		);
		expect(median).toBeLessThan(50);
	});
});
