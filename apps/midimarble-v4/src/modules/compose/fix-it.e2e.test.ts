import { beforeAll, describe, expect, it } from 'vitest';
import { preflightExport, problemSummary } from '@/modules/design/export-preflight';
import { assignNotesCommands } from '@/modules/music';
import { applyProjectCommands, BACKING_ID, type TProject } from '@/modules/project';
import { loadFixture } from '@/modules/project/test-helpers';
import { autoPlace, createRailForGap, createSimulator, createSwitchbackForGap, createTunnelForGap, type TSimulationResult } from '@/modules/simulation';
import { hitSummary } from '@/modules/studio/timeline/hit-status';
import { addedProblems, brokenHits, replaceBroken, replaceResultMessage, type TReplaceDeps } from './fix-it';

describe('replaceBroken function on Jingle Bells', () => {
	let simulate: (project: TProject) => TSimulationResult;

	beforeAll(async () => {
		const simulator = await createSimulator();
		simulate = (project) => simulator.simulate(project);
	});

	function deps(): TReplaceDeps {
		return {
			simulate: async (project) => simulate(project),
			autoPlace: async (project, target, entity) => {
				const [isOk, error, placement] = autoPlace(project, simulate(project), target.laneId, target.hitId, { simulate, type: entity.components.piece?.type });
				if (!isOk) throw error;
				return placement.entity;
			},
			gapPiece: async (project, gap, type, id) => {
				const create = type === 'switchback' ? createSwitchbackForGap : type === 'rail' ? createRailForGap : createTunnelForGap;
				const [isOk, error, proposal] = create(project, simulate(project), gap.laneId, gap.fromHitId, gap.toHitId, { simulate, id });
				if (!isOk) throw error;
				return proposal.entity;
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
		const notes = project.music.lanes[0]?.hits.slice(0, count).map((item) => item.id) ?? [];
		const [isEditOk, editErr, edited] = applyProjectCommands(project, assignNotesCommands(project, before, notes, BACKING_ID));
		if (!isEditOk) throw editErr;
		return { before, edited, broken: simulate(edited) };
	}

	function messageOf(edited: TProject, broken: TSimulationResult, outcome: Awaited<ReturnType<typeof replaceBroken>>): string {
		const summary = problemSummary(preflightExport(outcome.project, { ...outcome.result, revision: outcome.project.revision }));
		return replaceResultMessage(edited, broken.hits, outcome, { label: summary.label, hitProblems: summary.hitProblems, added: addedProblems(edited, broken, outcome.project, outcome.result) });
	}

	it('should recover every hit after 7 Melody notes become Backing, within a minute, and name what it added', async () => {
		// Prepare: the review's repro, which took 78 s in the browser
		const { before, edited, broken } = handFirstNotesToBacking(7);
		const startedAt = performance.now();
		const progress: { done: number; total: number }[] = [];

		// Act
		const outcome = await replaceBroken(edited, broken, { ...deps(), onProgress: (done, total) => progress.push({ done, total }) }, { before: before.hits });

		// Assert
		expect(hitSummary(outcome.result.hits).problems).toEqual([]);
		const counted = brokenHits(broken.hits).length;
		expect(new Set(progress.map((item) => item.total))).toEqual(new Set([counted]));
		expect(progress.every((item, index) => index === 0 || item.done >= (progress[index - 1]?.done ?? 0))).toBe(true);
		expect(messageOf(edited, broken, outcome)).toMatch(/fixed all \d+ broken hits: \d+ of \d+ hits on time/);
		// A problem the new run adds is said out loud, as Bass hitting Melody's last platform is here
		const added = addedProblems(edited, broken, outcome.project, outcome.result);
		for (const problem of added) expect(messageOf(edited, broken, outcome)).toContain(problem.title);
		expect(performance.now() - startedAt).toBeLessThan(60_000);
	}, 120_000);

	it('should keep the Bowl and say what is left when it cannot recover the run after 6 Melody notes', async () => {
		// Prepare: a released marble has no spin, so the run parts from the old one and no tilt brings it back by hit 15
		const { before, edited, broken } = handFirstNotesToBacking(6);

		// Act
		const outcome = await replaceBroken(edited, broken, deps(), { before: before.hits });

		// Assert
		expect(brokenHits(outcome.result.hits).length).toBeLessThan(brokenHits(broken.hits).length);
		expect(outcome.removed).not.toContain('bowl-lane-1');
		expect(messageOf(edited, broken, outcome)).toMatch(/Turn them by hand or undo the edit/);
	}, 120_000);
});
