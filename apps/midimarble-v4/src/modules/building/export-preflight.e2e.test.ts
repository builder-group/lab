import { beforeAll, describe, expect, it } from 'vitest';
import { type TProject } from '@/modules/project';
import { loadFixture } from '@/modules/project/test-helpers';
import { createSimulator, type TSimulator } from '@/modules/simulation';
import { NO_BLENDER_OBJECTS, framingProblemAt, preflightExport } from './export-preflight';

function withSongFixture(name: string): TProject {
	const project = loadFixture(name);
	// A Song, so the checks here are about the run and not about the missing Song
	return { ...project, music: { ...project.music, sources: [{ id: 'song', kind: 'midi', path: 'song.mid', name: 'Song', offset: 0 }] } };
}

describe('preflightExport function on whole songs', () => {
	let simulator: TSimulator;

	beforeAll(async () => {
		simulator = await createSimulator();
	});

	it('should pass Jingle Bells, whose camera keeps both marbles in frame, and report a marble the camera loses once the bass moves far sideways', () => {
		const project = withSongFixture('jingle-bells');
		expect(preflightExport(project, simulator.simulate(project), NO_BLENDER_OBJECTS).issues).toEqual([]);

		// The bass pieces follow their marble, so moving its release moves its whole run away from the melody. The 120° camera widens for any run in reach, so it takes 8 m to lose a marble
		const bass = project.entities.find((entity) => entity.name === 'Bass' && entity.components.release != null);
		if (bass?.components.release == null) throw new Error('No bass release');
		bass.components.release.position.x += 8;
		const result = simulator.simulate(project);
		const preflight = preflightExport(project, result, NO_BLENDER_OBJECTS);
		const framing = preflight.issues.filter((issue) => issue.kind === 'framing');
		const first = framing.find((issue) => issue.laneId === 'lane-2');

		expect(first).toEqual(
			expect.objectContaining({
				id: 'frame:lane-2:1',
				severity: 'warning',
				title: expect.stringMatching(/^Bass leaves the frame at 0:0\d\.\d\d \(\d+ hits\)$/),
				detail: expect.stringMatching(/^Out of frame for \d\.\d s while it plays, until 0:\d\d\.\d\d\.$/),
				// Framing problems open Film at their time with the Camera selected, with a span for the Camera track
				target: { ids: ['camera'], time: first?.span?.from, workspace: 'track' }
			})
		);
		// The jump lands inside the span, where the Camera panel shows the problem
		if (first?.span == null) throw new Error('No framing span');
		const shown = framingProblemAt(preflight, first.span.from);
		expect(shown?.span?.from).toBeLessThanOrEqual(first.span.from);
		expect(shown?.span?.to).toBeGreaterThanOrEqual(first.span.from);

	}, 20_000);
});
