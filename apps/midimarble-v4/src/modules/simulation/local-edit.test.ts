import { beforeAll, describe, expect, it } from 'vitest';
import type { TProject } from '@/modules/project';
import { loadFixture } from '@/modules/project/test-helpers';
import { answerSettle, laneEdits, reconnect, release, settleBase, type TSettleAnswer, withRides } from './local-edit';
import { createSimulator, type TSimulator } from './simulate';
import type { TSimulationResult } from './types';

const DEGREE = Math.PI / 180;

function turned(project: TProject, id: string, by: number): TProject {
	return {
		...project,
		revision: project.revision + 1,
		entities: project.entities.map((entity) => {
			const link = entity.components.hitLink;
			return entity.id === id && link != null ? { ...entity, components: { ...entity.components, hitLink: { ...link, angle: link.angle + by } } } : entity;
		})
	};
}

function landed(project: TProject, answer: TSettleAnswer): TProject {
	const changed = new Map(answer.entities.map((entity) => [entity.id, entity]));
	return { ...project, entities: project.entities.map((entity) => changed.get(entity.id) ?? entity) };
}

function shift(a: TSimulationResult, b: TSimulationResult, hitId: string): number {
	const dotA = a.hits.find((hit) => hit.hitId === hitId)?.dot;
	const dotB = b.hits.find((hit) => hit.hitId === hitId)?.dot;
	return dotA != null && dotB != null ? Math.hypot(dotA.x - dotB.x, dotA.y - dotB.y) : Infinity;
}

describe('settling an edit', () => {
	let simulator: TSimulator;
	const fresh = async (project: TProject): Promise<TSimulationResult> => (await createSimulator()).simulate(project);

	beforeAll(async () => {
		simulator = await createSimulator();
	});

	describe('laneEdits function', () => {
		const project = loadFixture('zigzag');

		it('should name the lane and the hit of a turned platform', () => {
			expect(laneEdits(project, turned(project, 'piece-1-5', 0.01))).toEqual([{ laneId: 'lane-1', afterIndex: 4 }]);
		});

		it('should only keep the rides for a slide along the bar, and ask nothing of a turn of the last platform', () => {
			const slid = {
				...project,
				entities: project.entities.map((entity) => {
					const link = entity.components.hitLink;
					return entity.id === 'piece-1-5' && link != null ? { ...entity, components: { ...entity.components, hitLink: { ...link, contactAt: 0.3 } } } : entity;
				})
			};
			expect(laneEdits(project, slid)).toEqual([{ laneId: 'lane-1', afterIndex: project.music.lanes[0]?.hits.length }]);
			expect(laneEdits(project, turned(project, 'piece-1-16', 0.01))).toEqual([]);
		});

		it('should count the platform before one taken away among those that take up the change', () => {
			const without = { ...project, entities: project.entities.filter((entity) => entity.id !== 'piece-1-5') };
			expect(laneEdits(project, without)).toEqual([{ laneId: 'lane-1', afterIndex: 2 }]);
		});
	});

	describe('answerSettle function', () => {
		it('should keep every later platform where it was when one is tilted', async () => {
			// Prepare
			const project = loadFixture('zigzag');
			const before = await fresh(project);

			// Act
			const after = turned(project, 'piece-1-5', 1 * DEGREE);
			const { answer } = answerSettle(simulator, { before: project, after }, null);
			const run = await fresh(landed(after, answer));

			// Assert
			expect(answer.absorbedBy).toEqual(['piece-1-6', 'piece-1-7']);
			expect(answer.broken).toEqual([]);
			expect(run.hits.every((hit) => hit.status === 'onTime')).toBe(true);
			for (const hit of run.hits.slice(7)) expect(shift(run, before, hit.hitId)).toBeLessThan(0.002);
		});

		it('should give the same answer from a cold simulator', async () => {
			const project = loadFixture('zigzag');
			const after = turned(project, 'piece-1-3', -2 * DEGREE);
			const warm = answerSettle(simulator, { before: project, after }, null).answer;
			const cold = answerSettle(await createSimulator(), { before: project, after }, null).answer;
			expect(cold.entities).toEqual(warm.entities);
		});

		it('should send the marble to a dragged platform and back on the old run after it', async () => {
			// Prepare
			const project = loadFixture('zigzag');
			const before = await fresh(project);
			const hit = before.hits.find((item) => item.hitId === 'hit-1-5');
			if (hit?.dot == null) throw new Error('Missing dot');
			const dot = { x: hit.dot.x, y: hit.dot.y - 0.008 };

			// Act
			const { answer } = answerSettle(simulator, { before: project, after: project, movedDot: { laneId: 'lane-1', hitId: 'hit-1-5', dot } }, null);
			const run = await fresh(landed(project, answer));

			// Assert
			const moved = run.hits.find((item) => item.hitId === 'hit-1-5');
			expect(moved?.dot?.y).toBeCloseTo(dot.y, 2);
			expect(run.hits.every((item) => item.status === 'onTime')).toBe(true);
			for (const later of run.hits.slice(7)) expect(shift(run, before, later.hitId)).toBeLessThan(0.003);
		});
	});

	describe('a ride through a gap piece', () => {
		it('should play as the run it came from, whatever comes before it', async () => {
			// Prepare
			const project = loadFixture('long-gap');
			const run = await fresh(project);
			const ridden = withRides(project, run);
			const pieces = ridden.entities.filter((entity) => entity.components.transit != null);

			// Act
			const again = await fresh(ridden);
			const tiny = turned(ridden, 'piece-1-1', 1e-5);
			const nudged = await fresh(tiny);

			// Assert
			expect(pieces.length).toBeGreaterThan(0);
			for (const hit of again.hits) expect(shift(again, run, hit.hitId)).toBeLessThan(0.01);
			for (const hit of nudged.hits) expect(shift(nudged, again, hit.hitId)).toBeLessThan(0.002);
		});

		it('should be simulated again once the piece changes', async () => {
			const project = loadFixture('long-gap');
			const ridden = withRides(project, await fresh(project));
			const ride = ridden.entities.find((entity) => entity.components.transit != null);
			if (ride == null) throw new Error('No ride');
			const changed = {
				...ridden,
				entities: ridden.entities.map((entity) => {
					const { hitLink } = entity.components;
					return entity.id === ride.id && hitLink != null ? { ...entity, components: { ...entity.components, hitLink: { ...hitLink, angle: hitLink.angle + 0.05 } } } : entity;
				})
			};
			const a = await fresh(ridden);
			const b = await fresh(changed);
			expect(a.marbles[0]?.samples).not.toEqual(b.marbles[0]?.samples);
		});
	});

	describe('a break nothing takes up', () => {
		const breakIt = (): { project: TProject; after: TProject; answer: TSettleAnswer } => {
			const project = loadFixture('zigzag');
			const after = turned(project, 'piece-1-5', -85 * DEGREE);
			return { project, after, answer: answerSettle(simulator, { before: project, after }, null).answer };
		};

		it('should keep later pieces where they were, with one problem at one hit', async () => {
			// Prepare
			const { project, after, answer } = breakIt();
			const before = await fresh(project);

			// Act
			const run = await fresh(landed(after, answer));

			// Assert
			expect(answer.heldFrom.length).toBe(1);
			expect(run.hits.filter((hit) => hit.status === 'missed' || hit.status === 'blocked')).toHaveLength(1);
			const first = answer.heldFrom[0]?.time ?? 0;
			for (const piece of run.pieces) {
				const was = before.pieces.find((item) => item.entityId === piece.entityId);
				if ((piece.hitTime ?? 0) >= first && piece.status === 'held' && piece.entityId !== 'piece-1-5') expect(Math.hypot(piece.position.x - (was?.position.x ?? 0), piece.position.y - (was?.position.y ?? 0))).toBeLessThan(0.002);
			}
		});

		it('should bring the marble back once the edit is taken back by hand', async () => {
			// Prepare
			const { after, answer } = breakIt();
			const held = landed(after, answer);

			// Act
			const back = turned(held, 'piece-1-5', 85 * DEGREE);
			const reconnected = reconnect(simulator, back);
			if (reconnected == null) throw new Error('No way back');
			const run = await fresh(landed(back, { ...answer, entities: reconnected.entities }));

			// Assert
			expect(run.hits.every((hit) => hit.status === 'onTime')).toBe(true);
			expect(run.pieces.every((piece) => piece.status !== 'held')).toBe(true);
		});

		it('should let every piece follow the marble again on release', async () => {
			const { after, answer } = breakIt();
			const released = release(landed(after, answer));
			expect(released.entities.every((entity) => entity.components.hitLink?.held == null)).toBe(true);
		});
	});

	describe('settleBase function', () => {
		it('should keep the run it knows for the same project', () => {
			const project = loadFixture('zigzag');
			const known = settleBase(simulator, project, null);
			expect(settleBase(simulator, project, known)).toBe(known);
		});
	});
});
