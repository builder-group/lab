import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyProjectCommands, createMarble, createProject, type TMarble, type TProject } from '@/modules/project';
import { bandAlongGuide, frameBand } from './placement';
import { createSimulator, type TSimulator } from './simulate';

const LINE = { points: [{ x: 0, y: 0.6 }, { x: -0.3, y: 0 }, { x: 0.1, y: -0.4 }] };

function withMarbles(marbles: TMarble[]): TProject {
	return { ...createProject({ title: 'Line' }), marbles };
}

describe('guide line', () => {
	let simulator: TSimulator;
	beforeAll(async () => {
		simulator = await createSimulator();
	});
	afterAll(() => simulator.dispose());

	it('leaves the band alone without a stored line', () => {
		const project = withMarbles([createMarble(0, { x: 0.1, y: 0.6 })]);
		expect(frameBand(project, project.marbles[0]?.id, -2)).toEqual(frameBand(project, project.marbles[0]?.id));
		expect(frameBand(project, undefined, -2)).toEqual(frameBand(project));
	});

	it('centers the band on the line at the height asked, straight past its ends', () => {
		const project = withMarbles([{ ...createMarble(0, { x: 0, y: 0.6 }), guide: LINE }]);
		const at = bandAlongGuide(project, project.marbles[0]?.id);
		expect(at(0.3).centerX).toBeCloseTo(-0.15);
		expect(at(-0.2).centerX).toBeCloseTo(-0.1);
		expect(at(2).centerX).toBeCloseTo(0);
		expect(at(-5).centerX).toBeCloseTo(0.1);
		expect(at(0.3).halfWidth).toBe(frameBand(project).halfWidth);
		// With one marble its band and the band covering every marble are the same
		expect(bandAlongGuide(project)(0).centerX).toBeCloseTo(-0.3);
	});

	it('moves only its own marble, and the band covering them by the mean', () => {
		const [a, b] = [{ ...createMarble(0, { x: 0, y: 0.6 }), guide: LINE }, createMarble(1, { x: 0.26, y: 0.6 })];
		const project = withMarbles([a, b]);
		const plain = withMarbles([{ ...a, guide: undefined }, b]);
		expect(frameBand(project, b.id, 0)).toEqual(frameBand(plain, b.id));
		expect(frameBand(project, a.id, 0).centerX).toBeCloseTo(-0.3);
		const shift = -0.3 - frameBand(plain, a.id).centerX;
		expect(frameBand(project, undefined, 0).centerX).toBeCloseTo(frameBand(plain).centerX + shift / 2);
	});

	it('is set by the project command and refused going up', () => {
		const project = withMarbles([createMarble(0, { x: 0, y: 0.6 })]);
		const marbleId = project.marbles[0]?.id ?? '';
		const [isSetOk, , set] = applyProjectCommands(project, [{ type: 'updateMarble', marbleId, patch: { guide: LINE } }]);
		expect(isSetOk).toBe(true);
		expect(set?.marbles[0]?.guide).toEqual(LINE);
		const [isUpOk] = applyProjectCommands(project, [{ type: 'updateMarble', marbleId, patch: { guide: { points: [{ x: 0, y: 0 }, { x: 0, y: 1 }] } } }]);
		expect(isUpOk).toBe(false);
	});

	it('changes nothing a run does', () => {
		const marble = createMarble(0, { x: 0, y: 0.6 });
		const hit = { id: 'hit-a', time: 0.5, pitch: 60, duration: 0.2, velocity: 100 };
		const plain = withMarbles([{ ...marble, hits: [hit] }]);
		const guided = withMarbles([{ ...marble, hits: [hit], guide: LINE }]);
		expect(simulator.simulate(guided).marbles[0]?.samples).toEqual(simulator.simulate(plain).marbles[0]?.samples);
	});
});
