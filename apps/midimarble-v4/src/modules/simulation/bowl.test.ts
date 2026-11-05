import { beforeAll, describe, expect, it } from 'vitest';
import type { TProject } from '@/modules/project';
import { bowlCatch, bowlOfLane } from './bowl';
import { createBareRunProject } from './fixture-projects';
import { bowlGeometry } from './piece-layout';
import { bowlDefinition, resolvePieceParams } from './pieces';
import { createSimulator, type TSimulator } from './simulate';

let simulator: TSimulator;

beforeAll(async () => {
	simulator = await createSimulator();
});

/** A marble that falls onto a free Bowl whose mouth is at the origin, arriving at `speed` with `vx` sideways */
function drop(speed: number, vx: number, gravityScale = 0.5): TProject {
	const g = 9.81 * gravityScale;
	const height = (speed * speed) / (2 * g);
	const time = speed / g;
	const project = createBareRunProject({
		id: 'bowl',
		title: 'Bowl',
		end: time + 2.5,
		gravityScale,
		marbles: [{ x: -vx * time, y: height, releaseTime: 0, velocity: { x: vx, y: 0 }, hitTimes: [] }]
	});
	project.entities.push({
		id: 'bowl-1',
		name: 'Bowl 1',
		components: { piece: { type: 'bowl', params: {} }, transform: { position: { x: 0, y: 0 }, angle: 0 } }
	});
	return project;
}

describe('bowlGeometry', () => {
	it('lies around the marble on the side `mirror` picks, its mouth clear of the wire', () => {
		const params = resolvePieceParams('bowl', {});
		const plain = bowlGeometry(params, { x: 0, y: 0 }, 0.012);
		const mirrored = bowlGeometry({ ...params, mirror: 1 }, { x: 0, y: 0 }, 0.012);
		expect(plain.centre.x).toBeLessThan(0);
		expect(mirrored.centre.x).toBeGreaterThan(0);
		expect(plain.top).toBeGreaterThan(0);
		expect(plain.bottom).toBeLessThan(-0.05);
	});

	it('closes into a bowl with both rims over the centre', () => {
		const bowl = bowlGeometry(resolvePieceParams('bowl', {}), { x: 0, y: 0 }, 0.012);
		const first = bowl.wire[0];
		const last = bowl.wire[bowl.wire.length - 1];
		expect(first?.y).toBeCloseTo(last?.y ?? 0, 6);
		expect((first?.y ?? 0) - bowl.centre.y).toBeGreaterThan(0.03);
	});
});

describe('bowlCatch', () => {
	it('catches the marble and holds it, up to 4 m/s', () => {
		// Faster, the marble can swirl up and out of its mouth
		for (const speed of [1, 1.5, 2, 3, 4]) {
			for (const vx of [0, 0.3, 0.6]) {
				const result = simulator.simulate(drop(speed, vx));
				const caught = bowlCatch(result, 'bowl-1');
				expect(caught.status, `${speed} m/s, ${vx} m/s sideways`).toBe('caught');
			}
		}
	}, 20_000);

	it('catches at Earth gravity too', () => {
		for (const speed of [1.5, 3, 4]) expect(bowlCatch(simulator.simulate(drop(speed, 0.3, 1)), 'bowl-1').status).toBe('caught');
	});

	it('reports a marble that falls past the Bowl as missed', () => {
		const project = drop(2, 0);
		const bowl = project.entities.find((entity) => entity.id === 'bowl-1');
		if (bowl?.components.transform != null) bowl.components.transform.position = { x: 0.3, y: 0 };
		expect(bowlCatch(simulator.simulate(project), 'bowl-1').status).toBe('missed');
	});

	it('plays no note', () => {
		expect(bowlDefinition.musical).not.toBe(true);
		expect(bowlOfLane(drop(1, 0), 'lane-1')).toBeUndefined();
	});
});
