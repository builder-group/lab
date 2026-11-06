import { beforeAll, describe, expect, it } from 'vitest';
import { NO_BLENDER_OBJECTS, checkRun, problemSummary } from './export-preflight';
import { assignNotesCommands } from './assign-notes';
import { applyProjectCommands, BACKING_ID, type TProject } from '@/modules/project';
import { loadFixture } from '@/modules/project/test-helpers';
import { autoPlace, createRailForGap, createSimulator, createSwitchbackForGap, createTunnelForGap, type THitResult, type TSimulationResult } from '@/modules/simulation';
import { addedProblems, brokenHits, fixMessage, fixTrack, type TFixDeps } from './fix-it';

function hitsNeedingAttention(result: TSimulationResult): THitResult[] {
	return result.hits.filter((hit) => hit.status === 'drifting' || hit.status === 'missed' || hit.status === 'blocked');
}

describe('fixTrack function on Jingle Bells', () => {
	let simulate: (project: TProject) => TSimulationResult;

	beforeAll(async () => {
		const simulator = await createSimulator();
		simulate = (project) => simulator.simulate(project);
	});

	function deps(): TFixDeps {
		return {
			simulate: async (project) => simulate(project),
			autoPlace: async (project, target, piece) => {
				const [isOk, error, placement] = autoPlace(project, simulate(project), target.marbleId, target.hitId, { simulate, type: piece.type });
				if (!isOk) throw error;
				return placement.piece;
			},
			gapPiece: async (project, gap, type, id) => {
				const create = type === 'switchback' ? createSwitchbackForGap : type === 'rail' ? createRailForGap : createTunnelForGap;
				const [isOk, error, proposal] = create(project, simulate(project), gap.marbleId, gap.fromHitId, gap.toHitId, { simulate, id });
				if (!isOk) throw error;
				return proposal.piece;
			},
			commit: (project, commands) => {
				const [isOk, error, next] = applyProjectCommands(project, commands);
				if (!isOk) throw error;
				return next;
			}
		};
	}

	function handFirstNotesToBacking(count: number): { before: TSimulationResult; edited: TProject; broken: TSimulationResult } {
		const project = loadFixture('jingle-bells');
		const before = simulate(project);
		const notes = project.marbles[0]?.hits.slice(0, count).map((item) => item.id) ?? [];
		const [isEditOk, editErr, edited] = applyProjectCommands(project, assignNotesCommands(project, before, notes, BACKING_ID));
		if (!isEditOk) throw editErr;
		return { before, edited, broken: simulate(edited) };
	}

	function messageOf(edited: TProject, broken: TSimulationResult, outcome: Awaited<ReturnType<typeof fixTrack>>): string {
		const summary = problemSummary(checkRun(outcome.project, outcome.result, NO_BLENDER_OBJECTS));
		return fixMessage(edited, broken.hits, outcome, { label: summary.label, hitProblems: summary.hitProblems, added: addedProblems(edited, broken, outcome.project, outcome.result, NO_BLENDER_OBJECTS) });
	}

	it('should recover every hit after 4 Melody notes become Backing, within a minute, and name what it added', async () => {
		// Prepare
		const { before, edited, broken } = handFirstNotesToBacking(4);
		const startedAt = performance.now();
		const progress: { done: number; total: number }[] = [];

		// Act
		const outcome = await fixTrack(edited, broken, { ...deps(), onProgress: (done, total) => progress.push({ done, total }) }, before.hits);

		// Assert
		expect(hitsNeedingAttention(outcome.result)).toEqual([]);
		const counted = brokenHits(broken.hits).length;
		expect(new Set(progress.map((item) => item.total))).toEqual(new Set([counted]));
		expect(progress.every((item, index) => index === 0 || item.done >= (progress[index - 1]?.done ?? 0))).toBe(true);
		expect(messageOf(edited, broken, outcome)).toMatch(/^Fixed \d+ hits · .*\d+ of \d+ hits on time/);
		// A problem the new run adds is said out loud
		const added = addedProblems(edited, broken, outcome.project, outcome.result, NO_BLENDER_OBJECTS);
		for (const problem of added) expect(messageOf(edited, broken, outcome)).toContain(problem.title);
		expect(performance.now() - startedAt).toBeLessThan(60_000);
	}, 120_000);

	it('should keep the Bowl and say what is left when it cannot recover the run after 6 Melody notes', async () => {
		// Prepare: the moved release carries the old arrival and spin, yet the small difference grows
		const { before, edited, broken } = handFirstNotesToBacking(6);

		// Act
		const outcome = await fixTrack(edited, broken, deps(), before.hits);

		// Assert
		expect(brokenHits(outcome.result.hits).length).toBeLessThan(brokenHits(broken.hits).length);
		expect(outcome.project.track.pieces.some((piece) => piece.id === 'bowl-marble-1')).toBe(true);
		expect(messageOf(edited, broken, outcome)).toMatch(/Turn them by hand or undo the edit/);
	}, 120_000);
});
