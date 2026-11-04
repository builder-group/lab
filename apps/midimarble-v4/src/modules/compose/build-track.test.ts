import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { preflightExport, problemSummary } from '@/modules/design/export-preflight';
import { expandCommands } from '@/modules/mcp/project-commands';
import { alignNotes, createImportCommands, parseMidiFile, proposeLanes } from '@/modules/music';
import { applyProjectCommands, createProject, parseProject, type TProject, type TProjectCommand } from '@/modules/project';
import { createSimulator, extraStrikes, findLongGaps, finishOfLane, touchingPairs, type TAutoPlaceAnswer, type TSimulator } from '@/modules/simulation';
import { buildOneStep, buildTrack, localBuildDeps, withoutPiecesAfter, type TBuildOutcome, type TBuildProgress } from './build-track';

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
	const [isOk, error, project] = parseProject(readFileSync(new URL(`../../../fixtures/${name}.marble.json`, import.meta.url), 'utf8'));
	if (!isOk) throw error;
	return { ...project, entities: project.entities.filter((entity) => entity.components.piece == null) };
}

/** The app's import sheet at its defaults: every melodic track, split across up to four marbles, a second of lead-in */
function importedJingle(): TProject {
	const [isMidiOk, midiErr, midi] = parseMidiFile(readFileSync(new URL('../../../fixtures/jingle-bells.mid', import.meta.url)));
	if (!isMidiOk) throw midiErr;
	const proposal = proposeLanes(alignNotes(midi.tracks.flatMap((track) => track.notes), 1), { strategy: 'split', maxLanes: 4 });
	const project = createProject({ id: 'jingle', title: 'Jingle Bells' });
	const [isOk, error, applied] = applyProjectCommands(project, createImportCommands(project, { lanes: proposal.lanes, backing: proposal.backing as never }));
	if (!isOk) throw error;
	return applied;
}

function problemsBesidesSong(project: TProject, outcome: TBuildOutcome): string[] {
	return preflightExport(project, { ...outcome.result, revision: project.revision }).issues.filter((issue) => issue.kind !== 'song').map((issue) => issue.title);
}

function piecesOf(project: TProject): string[] {
	return project.entities.filter((entity) => entity.components.piece != null).map((entity) => JSON.stringify(entity.components));
}

describe('buildTrack function', () => {
	it('builds Jingle Bells from the imported MIDI at default settings, with a clean preflight', async () => {
		const project = importedJingle();
		expect(project.physics.gravityScale).toBe(0.5);
		const progress: TBuildProgress[] = [];
		const outcome = await buildTrack(project, { ...localBuildDeps(simulator), onProgress: (item) => progress.push(item) });
		expect(outcome.result.hits.filter((hit) => hit.status === 'onTime')).toHaveLength(115);
		expect(outcome.attention).toEqual([]);
		expect(problemsBesidesSong(outcome.project, outcome)).toEqual([]);
		for (const lane of outcome.project.music.lanes) expect(finishOfLane(outcome.project, lane.id)).not.toBeNull();
		expect(progress.at(-1)).toMatchObject({ done: 115, total: 115, fraction: 1 });
		expect(problemSummary(preflightExport(outcome.project, { ...outcome.result, revision: outcome.project.revision })).label).toBe('115 of 115 hits on time');
		// How it looks: nothing touches as the film shows it, each platform is struck once
		expect(touchingPairs(outcome.project, outcome.result)).toEqual([]);
		expect(extraStrikes(outcome.project, outcome.result)).toEqual([]);
	}, 10 * MINUTES);

	it('builds one marble with long gaps, a tapped list with irregular gaps and two tapped marbles', async () => {
		const songs = [
			[Array.from({ length: 16 }, (_, index) => 1 + index * 0.5)],
			[[0.92, 1.37, 1.91, 2.28, 2.95, 3.31, 3.84, 4.62, 5.07, 5.33, 5.98, 6.71, 7.02, 7.66, 8.49, 8.81, 9.24, 10.3, 10.72, 11.15]],
			[[1.1, 1.73, 2.21, 3.02, 3.44, 4.31, 4.92, 5.67, 6.1, 7.24, 7.8, 8.33], [1.4, 2.02, 2.66, 3.13, 3.97, 4.45, 5.21, 5.88, 6.62, 7.05, 7.61, 8.71]]
		];
		for (const song of songs) {
			const outcome = await buildTrack(fromHitTimes(song), localBuildDeps(simulator));
			expect(outcome.attention).toEqual([]);
			expect(problemsBesidesSong(outcome.project, outcome)).toEqual([]);
		}
	}, 3 * MINUTES);

	it('builds the zigzag and staircase hit patterns', async () => {
		for (const name of ['zigzag', 'staircase']) {
			const outcome = await buildTrack(bareFixture(name), localBuildDeps(simulator));
			expect(outcome.attention).toEqual([]);
			expect(problemsBesidesSong(outcome.project, outcome)).toEqual([]);
		}
	});

	it('gives the same track every time, from a fresh or a used simulator', async () => {
		const project = fromHitTimes([[0.92, 1.37, 1.91, 2.28, 2.95, 3.31, 3.84, 4.62, 5.07, 5.33]]);
		const first = await buildTrack(project, localBuildDeps(simulator));
		const again = await buildTrack(project, localBuildDeps(simulator));
		const fresh = await createSimulator();
		const third = await buildTrack(project, localBuildDeps(fresh));
		fresh.dispose();
		expect(piecesOf(again.project)).toEqual(piecesOf(first.project));
		expect(piecesOf(third.project)).toEqual(piecesOf(first.project));
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
		const tied = (id: string, type: string, laneId: string, hitId: string) => ({ id, components: { piece: { type, params: {} }, hitLink: { laneId, hitId, angle: 0, contactAt: 0.5, pinned: false } } });
		const kept = { ...project, entities: [...project.entities, tied('a1', 'platform', laneA?.id ?? '', hitOf(0)), tied('a2', 'platform', laneA?.id ?? '', hitOf(1)), tied('bridge', 'switchback', laneA?.id ?? '', hitOf(1)), tied('a3', 'platform', laneA?.id ?? '', hitOf(2)), tied('b1', 'platform', laneB?.id ?? '', hitOf(0, laneB)), tied('b2', 'platform', laneB?.id ?? '', hitOf(1, laneB))] };
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
