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
		expect(proposal.notes).toEqual([{ hitId: 'hit-0', number: 1, time: 0.5, state: 'onTime', words: 'Note 1 plays on time.' }]);
		expect(proposal.changes).toEqual([]);
		expect(proposal.facts).toMatchObject({ onTime: 1, total: 4, lost: 0, hasRoomAtNext: true });
	});

	it('says what a piece would show and where the marble goes next, for a hint', async () => {
		const proposal = await asked(fourNotes(), 'hit-0');
		expect(proposal.shown.map((piece) => piece.pieceId)).toEqual(proposal.pieces.map((piece) => piece.id));
		expect(proposal.nextDot).not.toBeNull();
		expect(proposal.flight.length).toBeGreaterThan(1);
	});

	it('proposes a flip of a note\'s platform and lands it as one edit', async () => {
		const project = fourNotes();
		const built = landed(project, await asked(project, 'hit-0'));
		const before = built.track.pieces[0]?.angle ?? 0;
		const proposal = await asked(built, 'hit-0', 'flip');
		expect(proposal.status).not.toBe('refused');
		expect(landed(built, proposal).track.pieces[0]?.angle).toBeCloseTo(-before);
	});

	it('proposes Fix as a hint, changing nothing until it lands, and says when there is nothing to fix', async () => {
		const project = fourNotes();
		const built = landed(project, await asked(project, 'hit-0'));
		const piece = built.track.pieces[0];
		if (piece == null) throw new Error('No piece');
		expect((await asked(built, 'hit-0', 'fix')).words).toMatch(/nothing to fix/);
		// The second platform turned steeply by hand has a Problem, and Fix tilts it again
		const two = landed(built, await asked(built, 'hit-1'));
		const second = two.track.pieces[1];
		if (second == null) throw new Error('No second piece');
		const [isTurned, , broken] = applyProjectCommands(two, [{ type: 'updatePiece', pieceId: second.id, patch: { angle: 1.2 } }]);
		if (!isTurned) throw new Error('Not turned');
		const before = JSON.stringify(broken);
		const proposal = await asked(broken, 'hit-1', 'fix');
		expect(JSON.stringify(broken)).toBe(before);
		expect(proposal.status).toBe('fits');
		expect(proposal.pieces.map((item) => item.id)).toEqual([second.id]);
		expect(landed(broken, proposal).track.pieces[1]?.angle).not.toBeCloseTo(1.2);
		expect(await asked(fourNotes(), 'hit-0', 'fix')).toMatchObject({ status: 'refused', words: 'There is no piece here to fix.' });
	});

	it('proposes a removal, says which notes stop playing and shows the piece where it stands', async () => {
		const project = fourNotes();
		const one = landed(project, await asked(project, 'hit-0'));
		const two = landed(one, await asked(one, 'hit-1'));
		const proposal = await asked(two, 'hit-0', 'remove');
		expect(proposal.commands[0]).toEqual({ type: 'removePieces', pieceIds: [two.track.pieces[0]?.id] });
		expect(proposal.shown.map((piece) => piece.pieceId)).toEqual([two.track.pieces[0]?.id]);
		expect(proposal.facts?.lostNumbers).toContain(1);
		expect(proposal.changes.map((change) => change.pieceId)).not.toContain(two.track.pieces[0]?.id);
	});

	it('refuses to flip or remove what isn\'t there', async () => {
		const project = fourNotes();
		expect((await asked(project, 'hit-0', 'flip')).status).toBe('refused');
		expect((await asked(project, 'hit-0', 'remove')).status).toBe('refused');
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

describe('propose a Pattern', () => {
	/** Eight notes 0.4 s apart, the first with its piece */
	async function regular(): Promise<TProject> {
		const project = fourNotes();
		const marble = project.marbles[0];
		if (marble == null) throw new Error('No marble');
		const hits = Array.from({ length: 8 }, (_, index) => ({ id: `hit-${index}`, time: 0.5 + index * 0.4 }));
		const notes: TProject = { ...project, gravity: 0.5, length: 4.5, marbles: [{ ...marble, hits }] };
		return landed(notes, await asked(notes, 'hit-0'));
	}

	it('fits a Zigzag over the notes asked, each with its verdict, and lands it', async () => {
		const project = await regular();
		const ids = ['hit-1', 'hit-2', 'hit-3', 'hit-4'];
		const before = JSON.stringify(project);
		const proposal = await propose(project, { marbleId: 'marble', hitIds: ids, kind: 'zigzag' }, deps);
		expect(JSON.stringify(project)).toBe(before);
		expect(proposal.status).toBe('fits');
		expect(proposal.notes.map((note) => note.state)).toEqual(['onTime', 'onTime', 'onTime', 'onTime']);
		expect(proposal.pieces.length).toBeGreaterThanOrEqual(4);
		const next = landed(project, proposal);
		expect(next.track.groups.at(-1)?.pattern?.kind).toBe('zigzag');
		const played = simulator.simulate(next).hits.filter((hit) => ids.includes(hit.hitId));
		expect(played.every((hit) => hit.status === 'onTime' || hit.status === 'drifting')).toBe(true);
	});

	it('names the note when a Pattern is refused, and places nothing', async () => {
		const project = await regular();
		const words = "Zigzag doesn't fit at Note 2 of Marble 1. Nothing changed.";
		const refusing: TProposeDeps = { ...deps, pattern: () => ({ commands: [], refusal: { marbleId: 'marble', hitId: 'hit-1', words }, verdicts: [{ hitId: 'hit-1', fits: false, words: 'The marble misses this note.' }], ending: null }) };
		const proposal = await propose(project, { marbleId: 'marble', hitIds: ['hit-1', 'hit-2'], kind: 'zigzag' }, refusing);
		expect(proposal.commands).toEqual([]);
		expect(proposal.status).toBe('refused');
		expect(proposal.words).toBe(words);
		expect(proposal.notes[0]?.words).toBe('The marble misses this note.');
	});

	it('answers a note after a rest with what fills the rest, kept apart from a plain platform', async () => {
		const project = fourNotes();
		const marble = project.marbles[0];
		if (marble == null) throw new Error('No marble');
		const gapped: TProject = { ...project, length: 6, marbles: [{ ...marble, hits: [{ id: 'hit-0', time: 0.5 }, { id: 'hit-1', time: 3 }] }] };
		const placed = landed(gapped, await asked(gapped, 'hit-0'));
		const noLongRail: TProposeDeps = { ...deps, pattern: () => ({ commands: [], refusal: { marbleId: 'marble', hitId: 'hit-1', words: 'No rail holds the marble.' }, verdicts: [], ending: null }) };
		const proposal = await propose(placed, { marbleId: 'marble', hitIds: ['hit-1'], kind: 'platform' }, noLongRail);
		expect(proposal.status).toBe('refused');
		expect(proposal.words).toBe('A rest comes before this note.');
		expect(proposal.instead?.slice(0, 2).map((item) => item.ask.kind)).toEqual(['longRail', 'switchback']);
		for (const item of proposal.instead ?? []) expect(item.base).toBe(placed);
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
