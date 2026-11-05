import { beforeAll, describe, expect, it } from 'vitest';
import { type TProject } from '@/modules/project';
import { loadFixture } from '@/modules/project/test-helpers';
import { createSimulator, type TSimulator } from '@/modules/simulation';
import { framingFix, framingProblemAt, preflightExport } from './export-preflight';

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

	it('should pass Jingle Bells, whose camera keeps both marbles in frame, and report a marble the camera leaves out once the bass moves sideways', () => {
		const project = withSongFixture('jingle-bells');
		expect(preflightExport(project, simulator.simulate(project)).issues).toEqual([]);

		// The bass pieces follow their marble, so moving its release 20 cm moves its whole run away from the melody
		const bass = project.entities.find((entity) => entity.name === 'Bass' && entity.components.release != null);
		if (bass?.components.release == null) throw new Error('No bass release');
		bass.components.release.position.x += 0.2;
		const result = simulator.simulate(project);
		const preflight = preflightExport(project, result);
		const framing = preflight.issues.filter((issue) => issue.kind === 'framing');
		const first = framing.find((issue) => issue.laneId === 'lane-2');

		expect(first).toEqual(
			expect.objectContaining({
				id: 'frame:lane-2:1',
				severity: 'warning',
				title: expect.stringMatching(/^Bass leaves the frame at 0:0\d\.\d\d \(\d+ hits\)$/),
				detail: expect.stringMatching(/^Out of frame for \d\.\d s while it plays, until 0:1\d\.\d\d\. The camera follows Melody there\.$/),
				// Framing problems open Film at their time with the Camera selected, with a span for the Camera track
				target: { ids: ['camera'], time: first?.span?.from, workspace: 'design' }
			})
		);
		// The jump lands inside the span, where the Camera panel shows the problem
		if (first?.span == null) throw new Error('No framing span');
		const shown = framingProblemAt(preflight, first.span.from);
		expect(shown?.span?.from).toBeLessThanOrEqual(first.span.from);
		expect(shown?.span?.to).toBeGreaterThanOrEqual(first.span.from);

		// Add Wide Shot Here is offered only after a what-if of the camera with it keeps Bass in frame there
		const fixable = framing.find((issue) => framingFix(project, result, issue) != null);
		if (fixable?.span == null) throw new Error('No framing problem a Wide shot fixes');
		const fix = framingFix(project, result, fixable);
		expect(fix).toEqual(expect.objectContaining({ label: 'Add Wide Shot Here', detail: expect.stringMatching(/^Adds a Wide shot at \d:\d\d\.\d\d that holds \d+\.\d s, so (Bass|Melody) stays in frame\.$/) }));
		const command = fix?.commands[0];
		if (command?.type !== 'setDesign' || command.design.camera == null) throw new Error('No camera edit');
		const fixed = { ...project, design: { ...project.design, camera: command.design.camera } };
		const after = preflightExport(fixed, result).issues.filter((issue) => issue.kind === 'framing');
		expect(after.length).toBeLessThan(framing.length);
		const { from, to } = fixable.span;
		expect(after.some((issue) => issue.laneId === fixable.laneId && (issue.span?.from ?? 0) < to && (issue.span?.to ?? 0) > from)).toBe(false);
	}, 20_000);
});
