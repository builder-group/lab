import { beforeAll, describe, expect, it } from 'vitest';
import { newlyBroken } from '@/modules/building';
import { createProject, type TEntity, type TProject } from '@/modules/project';
import { createSimulator, type TSimulationResult } from '@/modules/simulation';
import { createStaircaseProject } from '@/modules/simulation/fixture-projects';
import { DUPLICATE_OFFSET, duplicateClear, duplicatePieces } from './duplicate';

function freePlatform(id: string, name: string, x: number): TEntity {
	return {
		id,
		name,
		components: {
			piece: { type: 'platform', params: {} },
			transform: { position: { x, y: 0.2 }, angle: 0.1 }
		}
	} as TEntity;
}

describe('duplicatePieces', () => {
	it('should copy a free piece beside it with the next default name', () => {
		const project = { ...createProject(), entities: [...createProject().entities, freePlatform('a', 'Platform 1', 0.3)] };
		const { commands, copies } = duplicatePieces(project, null, ['a']);
		expect(commands).toHaveLength(1);
		const copy = copies[0];
		expect(copy?.id).not.toBe('a');
		expect(copy?.name).toBe('Platform 2');
		expect(copy?.components.transform?.position.x).toBeCloseTo(0.3 + DUPLICATE_OFFSET.x);
		expect(copy?.components.transform?.position.y).toBeCloseTo(0.2 + DUPLICATE_OFFSET.y);
		expect(copy?.components.transform?.angle).toBe(0.1);
	});

	it('should number several copies one after another', () => {
		const project = { ...createProject(), entities: [freePlatform('a', 'Platform 1', 0), freePlatform('b', 'Platform 2', 0.2)] };
		expect(duplicatePieces(project, null, ['a', 'b']).copies.map((copy) => copy.name)).toEqual(['Platform 3', 'Platform 4']);
	});

	it('should skip a tied piece without a run to read its pose from', () => {
		const tied = { ...freePlatform('a', 'Platform 1', 0), components: { ...freePlatform('a', 'Platform 1', 0).components, hitLink: { laneId: 'l', hitId: 'h', angle: 0, contactAt: 0.5 } } } as TEntity;
		const project = { ...createProject(), entities: [tied] };
		expect(duplicatePieces(project, null, ['a']).commands).toEqual([]);
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

	function withCopies(copies: TEntity[]): TProject {
		return { ...project, entities: [...project.entities, ...copies] };
	}

	it('should place the copy of a platform that plays a note clear of every path, keeping every hit', async () => {
		const placed = await duplicateClear(project, run, ['piece-1-3'], async (next) => simulate(next), []);
		if (placed.spot === 'refused') throw new Error('refused');
		const copy = placed.copies[0];
		expect(copy?.components.hitLink).toBeUndefined();
		const after = simulate(withCopies(placed.copies));
		expect(newlyBroken(run.hits, after.hits)).toEqual([]);
		expect(after.contacts.some((contact) => contact.otherEntityId === copy?.id)).toBe(false);
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
		const x = placed.copies[0]?.components.transform?.position.x ?? 0;
		const y = placed.copies[0]?.components.transform?.position.y ?? 0;
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
