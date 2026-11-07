import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { answerEdit, editCommands, localProposeDeps, propose, acceptProposal, type TEditAnswer } from '@/modules/building';
import { applyProjectCommands, createHistory, createMarble, createProject, parseHitKey, type TProject, type TProjectCommand } from '@/modules/project';
import { createSimulator, type TSimulationResult, type TSimulator } from '@/modules/simulation';
import { patternPhrase } from '@/modules/track/PatternsCx';
import { StudioCx } from './StudioCx';

let simulator: TSimulator;
beforeAll(async () => {
	simulator = await createSimulator();
});
afterAll(() => simulator.dispose());

/** A platform at the first note and a Zigzag over the notes after it, as the owner built it, with the marble's start moved a little later */
async function zigzagTrack(): Promise<TProject> {
	const deps = localProposeDeps(simulator);
	const marble = createMarble(0, { x: 0, y: 0.6 }, 'marble');
	const hits = Array.from({ length: 20 }, (_, index) => ({ id: `hit-${index}`, time: 0.55 + index * 0.5 }));
	let project: TProject = { ...createProject({ title: 'Onsets' }), marbles: [{ ...marble, start: { ...marble.start, time: 0.25 }, hits }], length: 12 };
	for (const ask of [{ hitIds: ['hit-0'], kind: 'platform' }, { hitIds: patternPhrase(project, 'marble', 'hit-1').flatMap((key) => parseHitKey(key)?.hitId ?? []), kind: 'zigzag' }]) {
		const proposal = await propose(project, { marbleId: 'marble', ...ask }, deps);
		const [isAccepted, refusal, commands] = acceptProposal(project, proposal);
		if (!isAccepted) throw refusal;
		project = applied(project, commands);
	}
	return project;
}

function applied(project: TProject, commands: TProjectCommand[]): TProject {
	const [isApplied, error, next] = applyProjectCommands(project, commands);
	if (!isApplied) throw error;
	return next;
}

function studioOn(project: TProject, settle: () => Promise<TEditAnswer>): StudioCx {
	const cx = new StudioCx();
	cx.$history.set(createHistory(project));
	(cx.simulation as unknown as { client: unknown }).client = { settle };
	cx.simulation.$result.set({ ...simulator.simulate(project), revision: project.revision } as TSimulationResult);
	return cx;
}

describe('an edit that would stop a note playing', () => {
	it('lands nothing and says which note first, with Tilt Anyway to land it', async () => {
		const project = await zigzagTrack();
		const platform = project.track.pieces[0];
		if (platform == null) throw new Error('No platform');
		// Tilting the first platform sends the marble past the Zigzag's first bar, whose pieces can't take up the change
		const tilt = [{ type: 'updatePiece' as const, pieceId: platform.id, patch: { angle: platform.angle - 0.2 } }];
		const tilted = applied(project, tilt);
		const answer = answerEdit(simulator, { before: project, after: tilted });
		const landed = applied(tilted, editCommands(answer));
		expect(answer.heldFrom[0]?.hitId).toBe('hit-1');
		expect(simulator.simulate(landed).hits[1]?.status).toBe('missed');
		const cx = studioOn(project, async () => answer);

		expect(await cx.simulation.landChecked(tilt, { label: 'Tilt', anyway: 'Tilt Anyway' })).toBe(false);
		expect(cx.project).toBe(project);
		const notice = cx.$notice.get();
		expect(notice?.message).toBe("Tilt would stop Note 2 of Marble 1 playing: the pieces after it can't take it up. Nothing changed.");

		notice?.actions?.find((action) => action.label === 'Tilt Anyway')?.run();
		expect(cx.project?.track.pieces[0]?.angle).toBeCloseTo(platform.angle - 0.2);
	});

	it('lands at once when the later pieces take it up', async () => {
		const project = await zigzagTrack();
		const platform = project.track.pieces[0];
		if (platform == null) throw new Error('No platform');
		const tilt = [{ type: 'updatePiece' as const, pieceId: platform.id, patch: { angle: platform.angle + 0.1 } }];
		const answer = answerEdit(simulator, { before: project, after: applied(project, tilt) });
		expect(answer.heldFrom).toEqual([]);
		const cx = studioOn(project, async () => answer);

		expect(await cx.simulation.landChecked(tilt, { label: 'Tilt', anyway: 'Tilt Anyway' })).toBe(true);
		expect(cx.project?.track.pieces[0]?.angle).toBeCloseTo(platform.angle + 0.1);
		expect(cx.$history.get()?.past.length).toBe(1);
	});
});
