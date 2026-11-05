import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expandCommands } from '@/modules/mcp/project-commands';
import { createImportCommands } from '@/modules/music';
import { applyProjectCommands, createProject, type TProject, type TProjectCommand } from '@/modules/project';
import { loadFixture } from '@/modules/project/test-helpers';
import { createSimulator, findLongGaps, type TAutoPlaceAnswer, type TSimulator } from '@/modules/simulation';
import { buildOneStep, buildTrack, localBuildDeps, withoutPiecesAfter } from './build-track';

const MINUTES = 60_000;
let simulator: TSimulator;

beforeAll(async () => {
	simulator = await createSimulator();
});
afterAll(() => simulator.dispose());

function fromHitTimes(lanes: number[][]): TProject {
	const project = createProject({ id: 'build', title: 'Build' });
	const notes = lanes.map((times) => times.map((time, index) => ({ time, duration: 0.2, midi: 60 + (index % 12), velocity: 0.8, id: `note-${index}` })));
	const [isOk, error, applied] = applyProjectCommands(project, createImportCommands(project, { lanes: notes as never }));
	if (!isOk) throw error;
	return applied;
}

function bareFixture(name: string): TProject {
	const project = loadFixture(name);
	return { ...project, entities: project.entities.filter((entity) => entity.components.piece == null) };
}

/** The same project with other hit IDs, as another import would give it */
function withHitIds(project: TProject, order: 'lane 0 sorts first' | 'last lane sorts first'): TProject {
	const count = project.music.lanes.length;
	const lanes = project.music.lanes.map((lane, laneIndex) => ({
		...lane,
		hits: lane.hits.map((hit, hitIndex) => ({ ...hit, id: `hit-${order === 'lane 0 sorts first' ? laneIndex : count - laneIndex}-${String(hitIndex).padStart(3, '0')}` }))
	}));
	return { ...project, music: { ...project.music, lanes } };
}

function piecesByOrder(project: TProject): string[] {
	const order = new Map(project.music.lanes.flatMap((lane) => lane.hits).map((hit, index) => [hit.id, index]));
	return project.entities
		.filter((entity) => entity.components.piece != null)
		.map(({ components: { hitLink, ...rest } }) => JSON.stringify({ ...rest, hitLink: hitLink == null ? null : { ...hitLink, hitId: order.get(hitLink.hitId) } }));
}

function piecesOf(project: TProject): string[] {
	return project.entities.filter((entity) => entity.components.piece != null).map((entity) => JSON.stringify(entity.components));
}

describe('buildTrack function', () => {
	it('gives the same track every time, from a fresh or a used simulator', async () => {
		const project = fromHitTimes([[0.92, 1.37, 1.91, 2.28, 2.95, 3.31]]);
		const first = await buildTrack(project, localBuildDeps(simulator));
		const again = await buildTrack(project, localBuildDeps(simulator));
		const fresh = await createSimulator();
		const third = await buildTrack(project, localBuildDeps(fresh));
		fresh.dispose();
		expect(piecesOf(again.project)).toEqual(piecesOf(first.project));
		expect(piecesOf(third.project)).toEqual(piecesOf(first.project));
	}, MINUTES);

	it('gives the same track whatever the random IDs, when hits of two marbles coincide', async () => {
		const project = fromHitTimes([[1, 1.5, 2, 2.5], [1, 1.5, 2, 2.5]]);
		const first = await buildTrack(withHitIds(project, 'lane 0 sorts first'), localBuildDeps(simulator));
		const second = await buildTrack(withHitIds(project, 'last lane sorts first'), localBuildDeps(simulator));
		expect(piecesByOrder(second.project)).toEqual(piecesByOrder(first.project));
	}, MINUTES);

	it('keeps the pieces already placed and builds the rest', async () => {
		const project = fromHitTimes([Array.from({ length: 10 }, (_, index) => 1 + index * 0.5)]);
		const lane = project.music.lanes[0];
		const first = lane?.hits[0];
		if (lane == null || first == null) throw new Error('No hit');
		const { entity: mine, angle } = localBuildDeps(simulator).autoPlace({ project, laneId: lane.id, hitId: first.id, type: 'platform', entityId: 'mine' }) as TAutoPlaceAnswer;
		const [isOk, error, placed] = applyProjectCommands(project, [{ type: 'upsertEntity', entity: mine }]);
		if (!isOk) throw error;
		const outcome = await buildTrack(placed, localBuildDeps(simulator));
		expect(outcome.attention).toEqual([]);
		expect(outcome.turned).toEqual([]);
		expect(outcome.releaseShift).toBe(0);
		expect(outcome.project.entities.find((entity) => entity.id === 'mine')?.components.hitLink?.angle).toBe(angle);
	}, MINUTES);

	it('finishes the rest and names a hit no platform can play', async () => {
		// The first note comes before the marble can have fallen at all
		const project = fromHitTimes([[0.005, 1, 1.5, 2, 2.5, 3]]);
		project.entities = project.entities.map((entity) => (entity.components.release != null ? { ...entity, components: { ...entity.components, release: { ...entity.components.release, time: 0 } } } : entity));
		const outcome = await buildTrack(project, localBuildDeps(simulator));
		expect(outcome.attention.map((hit) => hit.index)).toEqual([0]);
		expect(outcome.result.hits.filter((hit) => hit.status === 'onTime')).toHaveLength(5);
	}, MINUTES);

	it('stops searching at its limit and still ends, with every hit it could not place named', async () => {
		// Prepare: no search ever finds anything, the worst a song can do
		const project = fromHitTimes([Array.from({ length: 12 }, (_, index) => 1 + index * 0.5)]);
		let searches = 0;
		const refuse = (): never => {
			searches++;
			throw new Error('Nothing fits');
		};

		// Act
		const outcome = await buildTrack(project, { ...localBuildDeps(simulator), autoPlace: refuse, gapPiece: refuse });

		// Assert: 6 per hit to look for a clean run, 2 to go on past it, then one Auto place for each hit left
		expect(searches).toBeLessThanOrEqual(12 * 12);
		expect(outcome.isStopped).toBe(false);
		expect(outcome.result.hits).toHaveLength(12);
		expect(outcome.result.hits.filter((hit) => hit.status === 'onTime').length + outcome.attention.length).toBe(12);
	}, MINUTES);

	it('sends its steps to commit, the first starting the undo step, so they replay to the same project', async () => {
		const project = fromHitTimes([Array.from({ length: 8 }, (_, index) => 1 + index * 0.5)]);
		let shown = project;
		const firsts: boolean[] = [];
		const outcome = await buildTrack(project, {
			...localBuildDeps(simulator),
			commit: (commands: TProjectCommand[], isFirst) => {
				firsts.push(isFirst);
				const [isOk, error, applied] = applyProjectCommands(shown, commands);
				if (!isOk) throw error;
				shown = applied;
				return true;
			}
		});
		expect(firsts.filter(Boolean)).toHaveLength(1);
		expect(firsts[0]).toBe(true);
		expect(piecesOf(shown)).toEqual(piecesOf(outcome.project));
	}, MINUTES);

	it('stops between steps and keeps what it built', async () => {
		const project = bareFixture('zigzag');
		let steps = 0;
		const outcome = await buildTrack(project, {
			...localBuildDeps(simulator),
			commit: () => {
				steps++;
				return true;
			},
			isCancelled: () => steps >= 1
		});
		expect(outcome.isStopped).toBe(true);
		expect(outcome.project.entities.filter((entity) => entity.components.piece != null).length).toBeGreaterThan(0);
		expect(outcome.attention.length).toBeGreaterThan(0);
	});
});

describe('Rebuild From Here', () => {
	const song = (): TProject => fromHitTimes([Array.from({ length: 14 }, (_, index) => 1 + index * 0.5)]);

	it('should keep everything up to the hit and build the rest again, as one undo step', async () => {
		const built = await buildTrack(song(), localBuildDeps(simulator));
		const lane = built.project.music.lanes[0];
		const hit = lane?.hits[5];
		if (lane == null || hit == null) throw new Error('No hit');
		// The person turns the platform of that hit, which steers what comes after it
		const mine = built.project.entities.find((entity) => entity.components.hitLink?.hitId === hit.id);
		if (mine?.components.hitLink == null) throw new Error('No platform');
		mine.components.hitLink.angle -= 0.05;
		const before = built.project.entities.filter((entity) => {
			const link = entity.components.hitLink;
			return link != null && (lane.hits.find((item) => item.id === link.hitId)?.time ?? Infinity) <= hit.time;
		});
		let shown = built.project;
		const firsts: boolean[] = [];
		const outcome = await buildTrack(built.project, {
			...localBuildDeps(simulator),
			commit: (commands: TProjectCommand[], isFirst) => {
				firsts.push(isFirst);
				const [isOk, error, applied] = applyProjectCommands(shown, commands);
				if (!isOk) throw error;
				shown = applied;
				return true;
			}
		}, { from: { laneId: lane.id, hitId: hit.id } });
		expect(outcome.turned).toEqual([]);
		expect(outcome.releaseShift).toBe(0);
		for (const entity of before) expect(outcome.project.entities.find((item) => item.id === entity.id)?.components.hitLink).toEqual(entity.components.hitLink);
		expect(outcome.attention).toEqual([]);
		expect(firsts.filter(Boolean)).toHaveLength(1);
		expect(piecesOf(shown)).toEqual(piecesOf(outcome.project));
		// A second go gives the same track
		const again = await buildTrack(built.project, localBuildDeps(simulator), { from: { laneId: lane.id, hitId: hit.id } });
		expect(piecesOf(again.project)).toEqual(piecesOf(outcome.project));
	}, 2 * MINUTES);

	it('should cut every marble at the same time, with a gap piece that reaches past it', () => {
		const project = fromHitTimes([[1, 1.5, 3, 3.5], [1.2, 1.7, 3.2]]);
		const [laneA, laneB] = project.music.lanes;
		const hitOf = (index: number, lane = laneA) => lane?.hits[index]?.id ?? '';
		const tied = (id: string, type: string, laneId: string, hitId: string) => ({ id, components: { piece: { type, params: {} }, hitLink: { laneId, hitId, angle: 0, contactAt: 0.5 } } });
		const kept = { ...project, entities: [...project.entities, tied('a1', 'platform', laneA?.id ?? '', hitOf(0)), tied('a2', 'platform', laneA?.id ?? '', hitOf(1)), tied('bridge', 'rail', laneA?.id ?? '', hitOf(1)), tied('a3', 'platform', laneA?.id ?? '', hitOf(2)), tied('b1', 'platform', laneB?.id ?? '', hitOf(0, laneB)), tied('b2', 'platform', laneB?.id ?? '', hitOf(1, laneB))] };
		const ids = withoutPiecesAfter(kept as TProject, { laneId: laneA?.id ?? '', hitId: hitOf(1) }).entities.filter((entity) => entity.components.piece != null).map((entity) => entity.id);
		expect(ids).toEqual(['a1', 'a2', 'b1']);
	});
});

describe('gap pieces', () => {
	const gappy = (): TProject => fromHitTimes([[1, 1.5, 2, 3, 3.5, 4, 5, 5.5, 6]]);

	it('should build through long gaps whichever piece it is asked to try first', async () => {
		for (const gapPiece of ['rail', 'switchback'] as const) {
			const outcome = await buildTrack(gappy(), localBuildDeps(simulator), { gapPiece });
			expect(outcome.attention).toEqual([]);
			for (const gap of findLongGaps(outcome.project, outcome.project.music.lanes[0]?.id ?? '')) expect(gap.bridgedBy).not.toBeNull();
		}
	}, 2 * MINUTES);
});

describe('a chosen gap piece', () => {
	it('should bridge the gap when placed with project.execute, and stay through Build Track', async () => {
		const project = fromHitTimes([[1, 1.5, 2, 3, 3.5, 4]]);
		const lane = project.music.lanes[0];
		const from = lane?.hits[2];
		if (lane == null || from == null) throw new Error('No hit');
		// The platforms up to the gap, then the rail a person or an agent picked
		let current = project;
		for (const hit of lane.hits.slice(0, 3)) {
			const placed = localBuildDeps(simulator).autoPlace({ project: current, laneId: lane.id, hitId: hit.id, type: 'platform', entityId: `mine-${hit.id}` }) as TAutoPlaceAnswer;
			const [isOk, error, applied] = applyProjectCommands(current, [{ type: 'upsertEntity', entity: placed.entity }]);
			if (!isOk) throw error;
			current = applied;
		}
		const [isExpanded, expandError, expanded] = expandCommands(current, simulator.simulate(current), [], [{ type: 'placePiece', pieceType: 'rail', hit: { laneId: lane.id, hitId: from.id }, params: { entryDelay: 0.3 }, name: 'My Rail' }]);
		if (!isExpanded) throw expandError;
		const [isOk, error, chosen] = applyProjectCommands(current, expanded.commands);
		if (!isOk) throw error;
		expect(findLongGaps(chosen, lane.id).map((gap) => gap.bridgedBy)).not.toContain(null);
		const outcome = await buildTrack(chosen, localBuildDeps(simulator));
		expect(outcome.project.entities.find((entity) => entity.name === 'My Rail')?.components.piece?.type).toBe('rail');
	}, MINUTES);
});

describe('buildOneStep function', () => {
	it('takes the next step, for Next past a gap it cannot bridge', async () => {
		const project = fromHitTimes([[1, 1.5, 2, 2.5]]);
		const step = await buildOneStep(project, localBuildDeps(simulator));
		expect(step?.target.targetTime).toBe(1);
		expect(step?.commands.length).toBeGreaterThan(0);
	});
});
