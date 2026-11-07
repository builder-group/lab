import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyProjectCommands, createMarble, createProject, type TPiece, type TProject, type TProjectCommand } from '@/modules/project';
import { createLinkedPiece, createSimulator, type TSimulator } from '@/modules/simulation';
import { addKnownFaults, noKnownFaults, reasonWords, verdictOf, verdictWithRoom, type TVerdictAsk } from './verdict';
import { answerWorkerRequest, type TAutoPlaceAnswer } from './worker-protocol';

let simulator: TSimulator;
beforeAll(async () => {
	simulator = await createSimulator();
});
afterAll(() => simulator.dispose());

function applied(project: TProject, commands: TProjectCommand[]): TProject {
	const [isOk, error, next] = applyProjectCommands(project, commands);
	if (!isOk) throw error;
	return next;
}

/** The piece Auto place gives this note */
function placed(project: TProject, hitId: string): TPiece {
	return (answerWorkerRequest(simulator, { kind: 'autoPlace', project, marbleId: 'marble', hitId, type: 'platform', pieceId: `piece-${hitId}` }) as TAutoPlaceAnswer).piece;
}

/** A marble with four notes close together, the first two with their pieces */
function twoPlaced(): TProject {
	const marble = createMarble(0, { x: 0, y: 0.6 }, 'marble');
	const hits = [0.5, 1, 1.5, 2].map((time, index) => ({ id: `hit-${index}`, time }));
	let project: TProject = { ...createProject({ title: 'Verdict' }), marbles: [{ ...marble, hits }], length: 2.5 };
	for (const hitId of ['hit-0', 'hit-1']) project = applied(project, [{ type: 'addPiece', piece: placed(project, hitId) }]);
	return project;
}

/** The project with a free piece where the marble flies on its way to the second note */
function withPieceInTheWay(project: TProject): TProject {
	const samples = simulator.simulate(project).marbles[0]?.samples ?? [];
	const position = samples.find((sample) => sample.time >= 0.8)?.position ?? { x: 0, y: 0 };
	const piece = createLinkedPiece('platform', 'marble', 'hit-1', 0, { id: 'in-the-way' });
	return applied(project, [{ type: 'addPiece', piece: { ...piece, place: { kind: 'free', position } } }]);
}

function askFor(before: TProject, after: TProject): TVerdictAsk {
	return { before: { project: before, result: simulator.simulate(before) }, after: { project: after, result: simulator.simulate(after) }, marbleId: 'marble', known: noKnownFaults() };
}

describe('verdict', () => {
	it('says what changed and that a good step breaks nothing', () => {
		const before = twoPlaced();
		const piece = placed(before, 'hit-2');
		const verdict = verdictOf(askFor(before, applied(before, [{ type: 'addPiece', piece }])));
		expect(verdict.changed.map((item) => item.id)).toEqual([piece.id]);
		expect(verdict.removed).toEqual([]);
		expect(verdict.onTime).toBe(3);
		expect(verdict.total).toBe(4);
		expect(verdict.lost).toEqual([]);
		expect(verdict.reasons).toEqual([]);
	});

	it('names a note it loses, and whoever asks decides what that means', () => {
		const before = twoPlaced();
		const after = withPieceInTheWay(before);
		const verdict = verdictOf(askFor(before, after));
		expect(verdict.lost).toContainEqual({ marbleId: 'marble', hitId: 'hit-1' });
		const late = verdict.reasons.find((reason) => reason.kind === 'late');
		expect(late).toMatchObject({ hitId: 'hit-1' });
		expect(late != null ? reasonWords(after, late) : '').toMatch(/^Note 2 of Marble 1 no longer plays on time/);
	});

	it('judges nothing by what the run already had', () => {
		const broken = withPieceInTheWay(twoPlaced());
		const known = noKnownFaults();
		addKnownFaults(known, broken, simulator.simulate(broken));
		const again = applied(broken, [{ type: 'updateProject', patch: { title: 'Again' } }]);
		expect(verdictOf({ ...askFor(broken, again), known }).reasons).toEqual([]);
	});

	it('stops at the first kind of fact when a search asks it to', () => {
		const before = twoPlaced();
		const kinds = new Set(verdictOf({ ...askFor(before, withPieceInTheWay(before)), stopsAtFirst: true }).reasons.map((reason) => reason.kind));
		expect([...kinds]).toEqual(['late']);
	});

	it('asks a further run about the room at the next dot, only of a step nothing else is wrong with', async () => {
		const before = twoPlaced();
		const after = applied(before, [{ type: 'addPiece', piece: placed(before, 'hit-2') }]);
		let asked = 0;
		const simulate = (project: TProject): ReturnType<TSimulator['simulate']> => {
			asked++;
			return simulator.simulate(project);
		};
		expect((await verdictWithRoom({ ...askFor(before, after), checksNext: true }, simulate)).reasons).toEqual([]);
		expect(asked).toBe(1);
		await verdictWithRoom({ ...askFor(after, withPieceInTheWay(after)), checksNext: true }, simulate);
		expect(asked).toBe(1);
	});
});
