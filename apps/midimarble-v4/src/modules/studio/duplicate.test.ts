import { beforeAll, describe, expect, it } from 'vitest';
import { newlyBroken } from '@/modules/building';
import { createProject, type TPiece, type TProject, freePosition, tieOf } from '@/modules/project';
import { createSimulator, type TSimulationResult } from '@/modules/simulation';
import { createStaircaseProject } from '@/modules/simulation/fixture-projects';
import { DUPLICATE_OFFSET, duplicateClear, type TDuplicate } from './duplicate';

function freePlatform(id: string, name: string, x: number): TPiece {
	return {
		id,
		name,
		type: 'platform', params: {}, angle: 0.1, place: { kind: 'free', position: { x, y: 0.2 } }
	} as TPiece;
}

/** Duplicate without a run, which copies to the usual spot */
async function duplicateWithoutRun(project: TProject, entityIds: string[]): Promise<TDuplicate> {
	const outcome = await duplicateClear(project, null, entityIds, null, []);
	if (outcome.spot === 'refused') throw new Error('Refused');
	return outcome;
}

describe('duplicateClear without a run', () => {
	it('should copy a free piece beside it with the next default name', async () => {
		const project = { ...createProject(), track: { ...createProject().track, pieces: [...createProject().track.pieces, freePlatform('a', 'Platform 1', 0.3)] } };
		const { commands, copies } = await duplicateWithoutRun(project, ['a']);
		expect(commands).toHaveLength(1);
		const copy = copies[0];
		expect(copy?.id).not.toBe('a');
		expect(copy?.name).toBe('Platform 2');
		expect(freePosition(copy)?.x).toBeCloseTo(0.3 + DUPLICATE_OFFSET.x);
		expect(freePosition(copy)?.y).toBeCloseTo(0.2 + DUPLICATE_OFFSET.y);
		expect(copy?.angle).toBe(0.1);
	});

	it('should number several copies one after another', async () => {
		const project = { ...createProject(), track: { ...createProject().track, pieces: [freePlatform('a', 'Platform 1', 0), freePlatform('b', 'Platform 2', 0.2)] } };
		expect((await duplicateWithoutRun(project, ['a', 'b'])).copies.map((copy) => copy.name)).toEqual(['Platform 3', 'Platform 4']);
	});

	it('should skip a tied piece without a run to read its pose from', async () => {
		const tied: TPiece = { ...freePlatform('a', 'Platform 1', 0), place: { kind: 'plays', marbleId: 'l', hitId: 'h', contactAt: 0.5 } };
		const project = { ...createProject(), track: { ...createProject().track, pieces: [tied] } };
		expect((await duplicateWithoutRun(project, ['a'])).commands).toEqual([]);
	});
});

describe('duplicateClear', () => {
	let simulate: (project: TProject) => TSimulationResult;
	let project: TProject;
	let run: TSimulationResult;

	beforeAll(async () => {
		const simulator = await createSimulator();
		simulate = (next) => simulator.simulate(next);
		project = createStaircaseProject();
		run = { ...simulate(project), revision: project.revision };
	});

	function withCopies(copies: TPiece[]): TProject {
		return { ...project, track: { ...project.track, pieces: [...project.track.pieces, ...copies] } };
	}

	it('should place the copy of a platform that plays a note clear of every path, keeping every hit', async () => {
		const placed = await duplicateClear(project, run, ['piece-1-3'], async (next) => simulate(next), []);
		if (placed.spot === 'refused') throw new Error('refused');
		const copy = placed.copies[0];
		expect(tieOf(copy)).toBeNull();
		const after = simulate(withCopies(placed.copies));
		expect(newlyBroken(run.hits, after.hits)).toEqual([]);
		expect(after.contacts.some((contact) => contact.otherId === copy?.id)).toBe(false);
	});

	it('should place several copies together, with the same shift', async () => {
		const placed = await duplicateClear(project, run, ['piece-1-3', 'piece-1-4'], async (next) => simulate(next), []);
		if (placed.spot === 'refused') throw new Error('refused');
		expect(placed.copies).toHaveLength(2);
		expect(newlyBroken(run.hits, simulate(withCopies(placed.copies)).hits)).toEqual([]);
	});

	it('should go beside the run and say so when no nearby spot passes its what-if', async () => {
		let calls = 0;
		const placed = await duplicateClear(project, run, ['piece-1-3'], async (next) => {
			calls += 1;
			// The three nearby tries come back broken
			return calls <= 3 ? { ...simulate(next), hits: run.hits.map((hit, index) => (index === 0 ? { ...hit, status: 'missed' as const } : hit)) } : simulate(next);
		}, []);
		expect(calls).toBe(4);
		expect(placed.spot).toBe('beside the run');
		if (placed.spot === 'refused') return;
		const x = freePosition(placed.copies[0])?.x ?? 0;
		const y = freePosition(placed.copies[0])?.y ?? 0;
		const height = run.marbles.flatMap((track) => track.samples).filter((sample) => Math.abs(sample.position.y - y) < 0.05);
		expect(height.every((sample) => Math.abs(sample.position.x - x) > 0.02)).toBe(true);
	});

	it('should copy nothing when every spot would break hits', async () => {
		const placed = await duplicateClear(project, run, ['piece-1-3'], async (next) => ({
			...simulate(next),
			hits: run.hits.map((hit, index) => (index < 2 ? { ...hit, status: 'missed' as const } : hit))
		}), []);
		expect(placed).toEqual({ spot: 'refused', breaks: 2 });
	});
});
