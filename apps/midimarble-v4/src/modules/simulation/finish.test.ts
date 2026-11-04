import { beforeAll, describe, expect, it } from 'vitest';
import type { TProject } from '@/modules/project';
import { finishCatch, finishOfLane } from './finish';
import { createBareRunProject } from './fixture-projects';
import { finishGeometry } from './piece-layout';
import { FINISH_CHUTE, FINISH_CUP, finishDefinition, resolvePieceParams } from './pieces';
import { createSimulator, type TSimulator } from './simulate';

let simulator: TSimulator;

beforeAll(async () => {
	simulator = await createSimulator();
});

/** A marble that falls onto a free Finish whose mouth is at the origin, arriving at `speed` with `vx` sideways */
function drop(style: number, speed: number, vx: number, gravityScale = 0.5): TProject {
	const g = 9.81 * gravityScale;
	const height = (speed * speed) / (2 * g);
	const time = speed / g;
	const project = createBareRunProject({
		id: 'finish',
		title: 'Finish',
		end: time + 2.5,
		gravityScale,
		marbles: [{ x: -vx * time, y: height, releaseTime: 0, velocity: { x: vx, y: 0 }, hitTimes: [] }]
	});
	project.entities.push({
		id: 'finish-1',
		name: 'Finish 1',
		components: { piece: { type: 'finish', params: { style } }, transform: { position: { x: 0, y: 0 }, angle: 0 } }
	});
	return project;
}

describe('finishGeometry', () => {
	it('puts a Chute backstop on the side the marble moves toward and its run-out the other way', () => {
		const params = resolvePieceParams('finish', {});
		const plain = finishGeometry(params, { x: 0, y: 0 }, 0.012);
		const mirrored = finishGeometry({ ...params, mirror: 1 }, { x: 0, y: 0 }, 0.012);
		expect(plain.wire[0]?.x).toBeGreaterThan(0);
		expect(plain.exit?.x).toBeLessThan(-0.15);
		expect(mirrored.wire[0]?.x).toBeLessThan(0);
		expect(mirrored.exit?.x).toBeGreaterThan(0.15);
		// The cover runs above the run-out, clear of the mouth
		expect(plain.cover).toHaveLength(3);
		expect(Math.max(...(plain.cover ?? []).map((point) => point.x))).toBeLessThan(-0.02);
		// The mouth is clear of the wire by more than the marble's radius
		expect(plain.top).toBeGreaterThan(0);
		expect(plain.bottom).toBeLessThan(-0.1);
	});

	it('closes a Cup into a bowl with both rims over the centre', () => {
		const cup = finishGeometry(resolvePieceParams('finish', { style: FINISH_CUP }), { x: 0, y: 0 }, 0.012);
		expect(cup.exit).toBeNull();
		expect(cup.cover).toBeNull();
		const first = cup.wire[0];
		const last = cup.wire[cup.wire.length - 1];
		expect(first?.y).toBeCloseTo(last?.y ?? 0, 6);
		expect((first?.y ?? 0) - cup.centre.y).toBeGreaterThan(0.03);
	});
});

describe('finishCatch', () => {
	// Arrival speeds from a short drop to a 2.5 m fall at half gravity, falling straight or moving toward the backstop
	const speeds = [1, 1.5, 2, 3, 4, 5];
	const sideways = [0, 0.3, 0.6, 1];

	it('catches the marble in a Chute at every arrival speed and angle and rolls it out', () => {
		for (const speed of speeds) {
			for (const vx of sideways) {
				const result = simulator.simulate(drop(FINISH_CHUTE, speed, vx));
				const caught = finishCatch(result, 'finish-1');
				expect(caught.status, `${speed} m/s, ${vx} m/s sideways`).toBe('caught');
				expect(caught.exitTime, `${speed} m/s, ${vx} m/s sideways`).not.toBeNull();
			}
		}
	});

	it('catches the marble in a Cup and holds it, up to 4 m/s', () => {
		// Faster, a Cup can swirl the marble up and out of its mouth; the Chute leads that speed away instead
		for (const speed of speeds.filter((item) => item <= 4)) {
			for (const vx of [0, 0.3, 0.6]) {
				const result = simulator.simulate(drop(FINISH_CUP, speed, vx));
				const caught = finishCatch(result, 'finish-1');
				expect(caught.status, `${speed} m/s, ${vx} m/s sideways`).toBe('caught');
				expect(caught.exitTime).toBeNull();
			}
		}
	});

	it('catches at Earth gravity too', () => {
		for (const speed of [1.5, 3, 5]) expect(finishCatch(simulator.simulate(drop(FINISH_CHUTE, speed, 0.3, 1)), 'finish-1').status).toBe('caught');
	});

	it('reports a marble that falls past the Finish as missed', () => {
		const project = drop(FINISH_CHUTE, 2, 0);
		const finish = project.entities.find((entity) => entity.id === 'finish-1');
		if (finish?.components.transform != null) finish.components.transform.position = { x: 0.3, y: 0 };
		expect(finishCatch(simulator.simulate(project), 'finish-1').status).toBe('missed');
	});

	it('plays no note', () => {
		expect(finishDefinition.musical).not.toBe(true);
		expect(finishOfLane(drop(FINISH_CHUTE, 1, 0), 'lane-1')).toBeUndefined();
	});
});
