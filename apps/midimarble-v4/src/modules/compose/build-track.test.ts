import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { preflightExport, problemSummary } from '@/modules/design/export-preflight';
import { alignNotes, createImportCommands, parseMidiFile, proposeLanes } from '@/modules/music';
import { applyProjectCommands, createProject, parseProject, type TProject, type TProjectCommand } from '@/modules/project';
import { createSimulator, finishOfLane, type TAutoPlaceAnswer, type TSimulator } from '@/modules/simulation';
import { buildOneStep, buildTrack, localBuildDeps, type TBuildOutcome, type TBuildProgress } from './build-track';

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
	}, 5 * MINUTES);

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

describe('buildOneStep function', () => {
	it('takes the next step, for Next past a gap it cannot bridge', async () => {
		const project = fromHitTimes([[1, 1.5, 2, 2.5]]);
		const step = await buildOneStep(project, localBuildDeps(simulator));
		expect(step?.target.targetTime).toBe(1);
		expect(step?.commands.length).toBeGreaterThan(0);
	});
});
