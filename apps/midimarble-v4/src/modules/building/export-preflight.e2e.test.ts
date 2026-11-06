import { beforeAll, describe, expect, it } from 'vitest';
import { backingOf, type TProject } from '@/modules/project';
import { loadFixture } from '@/modules/project/test-helpers';
import { createSimulator, type TSimulator } from '@/modules/simulation';
import { NO_BLENDER_OBJECTS, framingProblemAt, checkRun } from './export-preflight';

function withSongFixture(name: string): TProject {
	const project = loadFixture(name);
	// A Song, so the checks here are about the run and not about the missing Song
	return { ...project, songs: [{ id: 'song', kind: 'midi', path: 'song.mid', name: 'Song', start: 0, backing: backingOf(project) }] };
}

describe('checkRun function on whole songs', () => {
	let simulator: TSimulator;

	beforeAll(async () => {
		simulator = await createSimulator();
	});

	it('should pass Jingle Bells, whose camera keeps both marbles in frame, and report the marble a long Close-Up leaves out', () => {
		const project = withSongFixture('jingle-bells');
		expect(checkRun(project, simulator.simulate(project), NO_BLENDER_OBJECTS).issues.filter((issue) => issue.kind !== 'decor' && issue.kind !== 'opening' && issue.title !== 'Platform 86 touches Platform 87')).toEqual([]);

		// The automatic camera widens for any run in reach, however far sideways, and a Close-Up frames the leading marble alone
		project.film.camera.shots = [{ id: 'close', time: 5, distance: project.film.camera.distance * 0.45, hold: 20 }];
		const result = simulator.simulate(project);
		const preflight = checkRun(project, result, NO_BLENDER_OBJECTS);
		const framing = preflight.issues.filter((issue) => issue.kind === 'framing');
		const first = framing.find((issue) => issue.severity === 'warning');

		expect(first).toEqual(
			expect.objectContaining({
				id: expect.stringMatching(/^frame:marble-\d:\d+$/),
				severity: 'warning',
				title: expect.stringMatching(/^(Melody|Bass) leaves the frame at \d:\d\d\.\d\d \(\d+ hits?\)$/),
				detail: expect.stringMatching(/^Out of frame for \d\.\d s while it plays, until 0:\d\d\.\d\d\. The camera follows Bass there\.$/),
				// Framing problems open Film at their time with the Camera selected, with a span for the Camera track
				target: { ids: ['camera'], time: first?.span?.from, workspace: 'film' }
			})
		);
		// The jump lands inside the span, where the Camera panel shows the problem
		if (first?.span == null) throw new Error('No framing span');
		const shown = framingProblemAt(preflight, first.span.from);
		expect(shown?.span?.from).toBeLessThanOrEqual(first.span.from);
		expect(shown?.span?.to).toBeGreaterThanOrEqual(first.span.from);

	}, 20_000);
});
