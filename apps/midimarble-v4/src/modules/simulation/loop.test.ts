import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseProject, type TProject } from '@/modules/project';
import {
	checkLoop,
	createLoop,
	LOOP_ENTRY_DROP,
	LOOP_ENTRY_MARGIN,
	LOOP_GRID,
	LOOP_POSITION_TOLERANCE,
	LOOP_VELOCITY_TOLERANCE
} from './loop';
import { createSimulator, trajectoryAt, type TSimulator } from './simulate';
import type { TSimulationResult } from './types';

function loadLoopFixture(): TProject {
	const json = readFileSync(new URL('../../../fixtures/loop.marble.json', import.meta.url), 'utf8');
	const [isProjectOk, projectErr, project] = parseProject(json);
	if (!isProjectOk) throw projectErr;
	return project;
}

function onGrid(time: number): boolean {
	return Math.abs(time / LOOP_GRID - Math.round(time / LOOP_GRID)) < 1e-6;
}

let simulator: TSimulator;
let project: TProject;
let result: TSimulationResult;

beforeAll(async () => {
	simulator = await createSimulator();
	project = loadLoopFixture();
	result = simulator.simulate(project);
});

describe('loop', () => {
	describe('createLoop function', () => {
		it('should start once the marble fell out of the entry and end on the project end', () => {
			const loop = createLoop(project, result);
			expect(loop).not.toBeNull();
			if (loop == null) return;
			expect(onGrid(loop.start) && onGrid(loop.length)).toBe(true);
			expect(loop.end).toBeCloseTo(project.end, 9);
			const samples = result.marbles[0]?.samples ?? [];
			const top = Math.max(...samples.filter((sample) => sample.time <= loop.start).map((sample) => sample.position.y));
			const atStart = trajectoryAt(samples, loop.start);
			expect(top - (atStart?.position.y ?? 0)).toBeGreaterThanOrEqual(LOOP_ENTRY_DROP * project.design.camera.distance);
		});

		it('should make the loop three whole bars at the fixture tempo', () => {
			const loop = createLoop(project, result);
			expect(loop?.bars?.count).toBe(3);
			expect(Math.abs(loop?.bars?.offset ?? 1)).toBeLessThan(1e-9);
		});

		it('should give the ghost the marble state of the start at the end', () => {
			const loop = createLoop(project, result);
			const samples = result.marbles[0]?.samples ?? [];
			const ghost = loop?.ghosts[0];
			expect(ghost?.marbleEntityId).toBe(result.marbles[0]?.entityId);
			if (loop == null || ghost == null) return;
			// Every frame of the last second before the end replays the second before the start
			for (let frame = -30; frame <= 0; frame++) {
				const marble = trajectoryAt(samples, loop.start + frame / 30);
				const replay = trajectoryAt(ghost.samples, loop.end + frame / 30);
				if (marble == null) continue;
				expect(replay).not.toBeNull();
				expect(Math.hypot((replay?.position.x ?? 0) - marble.position.x, (replay?.position.y ?? 0) - marble.position.y)).toBeLessThan(LOOP_POSITION_TOLERANCE);
				expect(Math.hypot((replay?.velocity.x ?? 0) - marble.velocity.x, (replay?.velocity.y ?? 0) - marble.velocity.y)).toBeLessThan(LOOP_VELOCITY_TOLERANCE);
			}
		});

		it('should return null when the run never falls far enough to enter from above', () => {
			const flat = structuredClone(project);
			flat.end = 0.2;
			expect(createLoop(flat, simulator.simulate(flat))).toBeNull();
		});
	});

	describe('checkLoop function', () => {
		it('should pass on the loop fixture', () => {
			const loop = createLoop(project, result);
			if (loop == null) throw new Error('no loop');
			const check = checkLoop(project, result, loop);
			expect(check.issues).toEqual([]);
			expect(check.isOk).toBe(true);
			expect(check.positionError).toBeLessThan(LOOP_POSITION_TOLERANCE);
			expect(check.velocityError).toBeLessThan(LOOP_VELOCITY_TOLERANCE);
			const firstContact = result.contacts[0]?.time ?? 0;
			expect(firstContact).toBeGreaterThanOrEqual(loop.start + LOOP_ENTRY_MARGIN);
			expect(result.hits.every((hit) => hit.status === 'onTime')).toBe(true);
		});

		it('should report an end off the bar grid with the snapped end', () => {
			const moved = structuredClone(project);
			moved.end = project.end - 0.4;
			const movedResult = simulator.simulate(moved);
			const loop = createLoop(moved, movedResult);
			if (loop == null) throw new Error('no loop');
			const issue = checkLoop(moved, movedResult, loop).issues.find((item) => item.kind === 'bars');
			expect(issue).toMatchObject({ kind: 'bars', snappedEnd: expect.closeTo(project.end, 6) as number });
		});

		it('should report a marble still near the entry and a piece still reacting when the loop ends too early', () => {
			const early = structuredClone(project);
			const secondHit = early.music.lanes[0]?.hits[1]?.time ?? 0;
			early.end = secondHit + 0.1;
			const earlyResult = simulator.simulate(early);
			const loop = createLoop(early, earlyResult);
			if (loop == null) throw new Error('no loop');
			const kinds = checkLoop(early, earlyResult, loop).issues.map((issue) => issue.kind);
			expect(kinds).toContain('stillInView');
			expect(kinds).toContain('reaction');
		});
	});
});
