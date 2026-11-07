import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMarble, createProject, type TProject } from '@/modules/project';
import { createSimulator, frameBand, type TSimulator } from '@/modules/simulation';
import { checkPattern } from './check-pattern';

let simulator: TSimulator;
beforeAll(async () => {
	simulator = await createSimulator();
});
afterAll(() => simulator.dispose());

/** Eight notes 0.4 s apart, on a line that goes left by `slope` per meter of drop from the first note down */
function onLine(slope: number): TProject {
	const marble = createMarble(0, { x: 0, y: 0.6 }, 'marble');
	const hits = Array.from({ length: 8 }, (_, index) => ({ id: `hit-${index}`, time: 0.5 + index * 0.4 }));
	const project: TProject = { ...createProject({ title: 'Line' }), gravity: 0.5, length: 4.5, marbles: [{ ...marble, hits }] };
	const top = simulator.simulate(project).hits[0]?.dot?.y ?? 0;
	const guide = { points: [{ x: 0, y: top }, { x: -slope * 5, y: top - 5 }] };
	return slope !== 0 ? { ...project, marbles: [{ ...marble, hits, guide }] } : project;
}

describe('Patterns on a guide line', () => {
	it('stands a Staircase on the line', () => {
		const project = onLine(1);
		const answer = checkPattern(project, { marbleId: 'marble', from: 0.5, to: 3.3, kind: 'staircase' }, { sim: simulator });
		expect(answer.refusal).toBeNull();
		const dots = simulator.simulate(answer.project).hits.flatMap((hit) => (hit.dot != null && hit.pieceId != null ? [hit.dot] : []));
		expect(dots.length).toBeGreaterThanOrEqual(7);
		// The first is where the fall lands it; from the second on each stands on the line
		for (const dot of dots.slice(1)) expect(Math.abs(dot.x - frameBand(project, 'marble', dot.y).centerX)).toBeLessThan(0.05);
	});

	it('leaves a Pattern alone on a marble with no line', () => {
		const straight = checkPattern(onLine(0), { marbleId: 'marble', from: 0.5, to: 3.3, kind: 'staircase' }, { sim: simulator });
		const xs = simulator.simulate(straight.project).hits.flatMap((hit) => (hit.dot != null && hit.pieceId != null ? [hit.dot.x] : []));
		expect(xs.length).toBeGreaterThanOrEqual(7);
		// Steps of its Width, one way
		const steps = xs.slice(1).map((x, index) => x - (xs[index] ?? 0));
		expect(steps.every((step) => Math.abs(step) > 0.03)).toBe(true);
	});
});
