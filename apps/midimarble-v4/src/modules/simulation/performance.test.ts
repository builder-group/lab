import { describe, expect, it } from 'vitest';
import type { TProject } from '@/modules/project';
import { createPerfProject, createStaircaseProject } from './fixture-projects';
import { createSimulator } from './simulate';

function setAngle(project: TProject, entityId: string, angle: number): void {
	const hitLink = project.entities.find((entity) => entity.id === entityId)?.components.hitLink;
	if (hitLink == null) throw new Error(`Missing linked piece ${entityId}`);
	hitLink.angle = angle;
}

describe('simulation performance', () => {
	it('reflows staircase within 50 ms after rotating an early platform', async () => {
		const simulator = await createSimulator();
		const project = createStaircaseProject();
		simulator.simulate(project);
		const timings: number[] = [];
		for (const angle of [0.1, 0.12, 0.14, 0.16, 0.18]) {
			setAngle(project, 'piece-1-2', angle);
			timings.push(simulator.simulate(project).stats.computeMs);
		}
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
});
