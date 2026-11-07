import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NO_BLENDER_OBJECTS, checkRun, problemSummary } from './export-preflight';
import { alignNotes, createImportCommands, parseMidiFile, proposeMarbles } from '@/modules/music';
import { applyProjectCommands, createProject, type TProject, tieOf } from '@/modules/project';
import { loadFixture } from '@/modules/project/test-helpers';
import { createSimulator, extraStrikes, bowlOfMarble, touchingPairs, type TSimulator } from '@/modules/simulation';
import { buildTrack, localBuildDeps, type TBuildOutcome, type TBuildProgress } from './build-track';

const MINUTES = 60_000;
let simulator: TSimulator;

beforeAll(async () => {
	simulator = await createSimulator();
});
afterAll(() => simulator.dispose());

function fromHitTimes(marbles: number[][]): TProject {
	const project = createProject({ id: 'build', title: 'Build' });
	const notes = marbles.map((times) => times.map((time, index) => ({ time, duration: 0.2, midi: 60 + (index % 12), velocity: 0.8, id: `note-${index}` })));
	const [isOk, error, applied] = applyProjectCommands(project, createImportCommands(project, { marbles: notes as never }));
	if (!isOk) throw error;
	return applied;
}

function bareFixture(name: string): TProject {
	const project = loadFixture(name);
	return { ...project, track: { ...project.track, pieces: [] } };
}

/** The app's import sheet at its defaults: every melodic track, split across up to four marbles, a second of lead-in */
function importedJingle(): TProject {
	const [isMidiOk, midiErr, midi] = parseMidiFile(readFileSync(new URL('../../../fixtures/jingle-bells.mid', import.meta.url)));
	if (!isMidiOk) throw midiErr;
	const proposal = proposeMarbles(alignNotes(midi.tracks.flatMap((track) => track.notes), 1), { strategy: 'split', maxMarbles: 4 });
	const project = createProject({ id: 'jingle', title: 'Jingle Bells' });
	const [isOk, error, applied] = applyProjectCommands(project, createImportCommands(project, { marbles: proposal.marbles, backing: proposal.backing as never }));
	if (!isOk) throw error;
	return applied;
}

/** The same project with other hit IDs, as another import would give it */
function withHitIds(project: TProject, order: 'marble 0 sorts first' | 'last marble sorts first'): TProject {
	const count = project.marbles.length;
	const marbles = project.marbles.map((marble, marbleIndex) => ({
		...marble,
		hits: marble.hits.map((hit, hitIndex) => ({ ...hit, id: `hit-${order === 'marble 0 sorts first' ? marbleIndex : count - marbleIndex}-${String(hitIndex).padStart(3, '0')}` }))
	}));
	return { ...project, marbles };
}

function piecesByOrder(project: TProject): string[] {
	const order = new Map(project.marbles.flatMap((marble) => marble.hits).map((hit, index) => [hit.id, index]));
	return project.track.pieces.map(({ id: _id, name: _name, ...rest }) => {
		const link = tieOf(rest);
		return JSON.stringify({ ...rest, place: link == null ? rest.place : { ...link, hitId: order.get(link.hitId) } });
	});
}

/** A long fall is only a tip: Build Track still leaves one on a 1.06 s gap, which Patterns don't change */
function problemsBesidesSong(project: TProject, outcome: TBuildOutcome): string[] {
	return checkRun(project, outcome.result, NO_BLENDER_OBJECTS).issues.filter((issue) => issue.kind !== 'song' && issue.kind !== 'fall' && issue.kind !== 'opening').map((issue) => issue.title);
}

describe('buildTrack function', () => {
	it('builds Jingle Bells from the imported MIDI at default settings, with a clean preflight', async () => {
		const project = importedJingle();
		expect(project.gravity).toBe(0.25);
		const progress: TBuildProgress[] = [];
		const outcome = await buildTrack(project, { ...localBuildDeps(simulator), onProgress: (item) => progress.push(item) });
		expect(outcome.result.hits.filter((hit) => hit.status === 'onTime')).toHaveLength(115);
		expect(outcome.attention).toEqual([]);
		expect(problemsBesidesSong(outcome.project, outcome)).toEqual([]);
		for (const marble of outcome.project.marbles) expect(bowlOfMarble(outcome.project, marble.id)).not.toBeNull();
		expect(progress.at(-1)).toMatchObject({ done: 115, total: 115, fraction: 1 });
		expect(problemSummary(checkRun(outcome.project, outcome.result, NO_BLENDER_OBJECTS)).label).toBe('115 of 115 hits on time');
		// How it looks: nothing touches on the wall, each platform is struck once
		expect(touchingPairs(outcome.project, outcome.result)).toEqual([]);
		expect(extraStrikes(outcome.project, outcome.result)).toEqual([]);
	}, 10 * MINUTES);

	it('builds one marble with long gaps and a tapped list with irregular gaps', async () => {
		const songs = [
			[Array.from({ length: 16 }, (_, index) => 1 + index * 0.5)],
			[[0.92, 1.37, 1.91, 2.28, 2.95, 3.31, 3.84, 4.62, 5.07, 5.33, 5.98, 6.71, 7.02, 7.66, 8.49, 8.81, 9.24, 10.3, 10.72, 11.15]]
		];
		for (const song of songs) {
			const outcome = await buildTrack(fromHitTimes(song), localBuildDeps(simulator));
			expect(outcome.attention).toEqual([]);
			expect(problemsBesidesSong(outcome.project, outcome)).toEqual([]);
		}
	}, 3 * MINUTES);

	it('ends in reasonable time on two tapped marbles it cannot build cleanly, and says what is left', async () => {
		// Prepare: from the 0.81 s gap on no gap piece fits, on any release, since every one crosses the other marble
		const song = [[1.1, 1.73, 2.21, 3.02, 3.44, 4.31, 4.92, 5.67, 6.1, 7.24, 7.8, 8.33], [1.4, 2.02, 2.66, 3.13, 3.97, 4.45, 5.21, 5.88, 6.62, 7.05, 7.61, 8.71]];
		const startedAt = performance.now();

		// Act
		const outcome = await buildTrack(fromHitTimes(song), localBuildDeps(simulator));

		// Assert: the limit is in searches, so this holds whatever the machine does; 2.5 min is far past it
		expect(performance.now() - startedAt).toBeLessThan(2.5 * MINUTES);
		expect(outcome.isStopped).toBe(false);
		expect(outcome.result.hits.filter((hit) => hit.status === 'onTime').length + outcome.attention.length).toBe(24);
		const summary = problemSummary(checkRun(outcome.project, outcome.result, NO_BLENDER_OBJECTS));
		expect(summary.label).toMatch(/of 24 hits on time|problem/);
	}, 5 * MINUTES);

	it('builds the zigzag and staircase hit patterns', async () => {
		for (const name of ['zigzag', 'staircase']) {
			const outcome = await buildTrack(bareFixture(name), localBuildDeps(simulator));
			expect(outcome.attention).toEqual([]);
			expect(problemsBesidesSong(outcome.project, outcome)).toEqual([]);
		}
	});

	it('gives the same track whatever the random IDs, when hits of two marbles coincide', async () => {
		const opening = importedJingle();
		const project = { ...opening, marbles: opening.marbles.map((marble) => ({ ...marble, hits: marble.hits.filter((hit) => hit.time < 16) })) };
		const first = await buildTrack(withHitIds(project, 'marble 0 sorts first'), localBuildDeps(simulator));
		const second = await buildTrack(withHitIds(project, 'last marble sorts first'), localBuildDeps(simulator));
		expect(piecesByOrder(second.project)).toEqual(piecesByOrder(first.project));
	}, 10 * MINUTES);
});
