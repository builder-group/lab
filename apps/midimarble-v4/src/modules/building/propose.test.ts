import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyProjectCommands, createMarble, createProject, type TProject } from '@/modules/project';
import { createSimulator, type TSimulator } from '@/modules/simulation';
import { nextStepOf } from './next-step';
import { acceptProposal, localProposeDeps, propose, type TProposal, type TProposeDeps } from './propose';

let simulator: TSimulator;
let deps: TProposeDeps;
beforeAll(async () => {
	simulator = await createSimulator();
	deps = localProposeDeps(simulator);
});
afterAll(() => simulator.dispose());

/** A marble with four notes close together, nothing placed */
function fourNotes(): TProject {
	const marble = createMarble(0, { x: 0, y: 0.6 }, 'marble');
	const hits = [0.5, 1, 1.5, 2].map((time, index) => ({ id: `hit-${index}`, time }));
	return { ...createProject({ title: 'Propose' }), marbles: [{ ...marble, hits }], length: 2.5 };
}

function asked(project: TProject, hitId: string, kind = 'platform'): Promise<TProposal> {
	return propose(project, { marbleId: 'marble', hitIds: [hitId], kind }, deps);
}

function landed(project: TProject, proposal: TProposal): TProject {
	const [isAccepted, refusal, commands] = acceptProposal(project, proposal);
	if (!isAccepted) throw refusal;
	const [isOk, error, next] = applyProjectCommands(project, commands);
	if (!isOk) throw error;
	return next;
}

describe('propose', () => {
	it('changes nothing, and says the note plays and what it finds', async () => {
		const project = fourNotes();
		const before = JSON.stringify(project);
		const proposal = await asked(project, 'hit-0');
		expect(JSON.stringify(project)).toBe(before);
		expect(proposal.status).toBe('fits');
		expect(proposal.pieces).toHaveLength(1);
		expect(proposal.notes).toEqual([{ hitId: 'hit-0', number: 1, time: 0.5, state: 'onTime', words: 'Hit 1 plays on time.' }]);
		expect(proposal.changes).toEqual([]);
		expect(proposal.facts).toMatchObject({ onTime: 1, total: 4, lost: 0, hasRoomAtNext: true });
	});

	it('lands exactly what it proposed', async () => {
		const project = fourNotes();
		const proposal = await asked(project, 'hit-0');
		const next = landed(project, proposal);
		expect(next.track.pieces).toEqual(proposal.pieces);
		expect(simulator.simulate(next).hits.find((hit) => hit.hitId === 'hit-0')?.status).toBe('onTime');
	});

	it('refuses a proposal for a track that has changed since', async () => {
		const project = fourNotes();
		const proposal = await asked(project, 'hit-0');
		const [isAccepted, refusal] = acceptProposal(landed(project, proposal), proposal);
		expect(isAccepted).toBe(false);
		expect(refusal?.message).toBe('The track changed since this was proposed. Propose again.');
	});

	it('answers Build up to here past the built notes, with nothing to place', async () => {
		const project = fourNotes();
		const proposal = await asked(project, 'hit-2');
		expect(proposal.status).toBe('buildUpTo');
		expect(proposal.words).toMatch(/^Build up to here/);
		expect(proposal.commands).toEqual([]);
		expect(acceptProposal(project, proposal)[0]).toBe(false);
		expect((await propose(project, { marbleId: 'marble', hitIds: ['hit-2'], kind: 'platform' }, deps, { isAnyDot: true })).status).not.toBe('buildUpTo');
	});

	it('says why when nothing can be placed, and accepts nothing', async () => {
		const project = fourNotes();
		const proposal = await propose(project, { marbleId: 'marble', hitIds: ['hit-0'], kind: 'platform' }, { ...deps, autoPlace: () => Promise.reject(new Error('No tilt works for this note.')) });
		expect(proposal.status).toBe('refused');
		expect(proposal.words).toBe('No tilt works for this note.');
		expect(acceptProposal(project, proposal)[0]).toBe(false);
	});

	it('states the facts on a piece already there, and lists what it would change', async () => {
		let project = fourNotes();
		for (const hitId of ['hit-0', 'hit-1', 'hit-2']) project = landed(project, await asked(project, hitId));
		const proposal = await asked(project, 'hit-1');
		expect(proposal.pieces[0]?.id).toBe(project.track.pieces[1]?.id);
		expect(proposal.facts?.total).toBe(4);
		for (const change of proposal.changes) expect(['changed', 'removed', 'moved']).toContain(change.how);
	});
});

describe('propose across a rest', () => {
	async function rest(): Promise<TProject> {
		const project = fourNotes();
		const marble = project.marbles[0];
		if (marble == null) throw new Error('No marble');
		const gapped: TProject = { ...project, length: 6, marbles: [{ ...marble, hits: [{ id: 'hit-0', time: 0.5 }, { id: 'hit-1', time: 3 }] }] };
		return landed(gapped, await asked(gapped, 'hit-0'));
	}

	it('proposes a rail, whose note the marble then reaches and a piece can play', async () => {
		const project = await rest();
		const proposal = await asked(project, 'hit-1', 'switchback');
		expect(['fits', 'problems']).toContain(proposal.status);
		expect(proposal.pieces[0]?.layout).toBe('switchback');
		expect(proposal.gap?.check).not.toBeNull();
		expect(proposal.facts?.hasRoomAtNext).toBeNull();
		expect(proposal.notes[0]?.state).toBe('reached');
		expect(landed(project, proposal).track.pieces.at(-1)?.id).toBe(proposal.pieces[0]?.id);
	});

	it('says why when no rail fits, and a rest needs a note before it', async () => {
		const project = await rest();
		const none = await propose(project, { marbleId: 'marble', hitIds: ['hit-1'], kind: 'rail' }, { ...deps, gapPiece: () => Promise.reject(new Error('The frame has no room')) });
		expect(none.status).toBe('refused');
		expect(none.words).toBe('The frame has no room');
		const first = await asked(project, 'hit-0', 'rail');
		expect(first.status).toBe('refused');
		expect(first.words).toMatch(/first/);
	});
});

describe('nextStepOf', () => {
	it('places at the first open dot, and says so when none is left', async () => {
		let project = fourNotes();
		const first = nextStepOf(project, simulator.simulate(project), []);
		expect(first).toMatchObject({ kind: 'place', hit: { hitId: 'hit-0' } });
		for (const hitId of ['hit-0', 'hit-1', 'hit-2', 'hit-3']) project = landed(project, await asked(project, hitId));
		expect(nextStepOf(project, simulator.simulate(project), []).kind).toBe('done');
	});

	it('finds the long gap first', async () => {
		const project = fourNotes();
		const marble = project.marbles[0];
		if (marble == null) throw new Error('No marble');
		const gapped: TProject = { ...project, length: 6, marbles: [{ ...marble, hits: [{ id: 'hit-0', time: 0.5 }, { id: 'hit-1', time: 4 }] }] };
		const placed = landed(gapped, await asked(gapped, 'hit-0'));
		expect(nextStepOf(placed, simulator.simulate(placed), [])).toMatchObject({ kind: 'gap', gap: { toHitId: 'hit-1' } });
	});
});
