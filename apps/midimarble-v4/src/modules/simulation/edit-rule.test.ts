import { beforeAll, describe, expect, it } from 'vitest';
import { type TPiece, type TProject, tieOf } from '@/modules/project';
import { loadFixture } from '@/modules/project/test-helpers';
import { answerEdit, type TEditAnswer, withEditAnswer } from './edit-rule';
import { createSimulator, type TSimulator } from './simulate';
import type { TSimulationResult } from './types';

let simulator: TSimulator;
const DEGREE = Math.PI / 180;

beforeAll(async () => {
	simulator = await createSimulator();
});

function turned(project: TProject, id: string, by: number): TProject {
	return { ...project, revision: project.revision + 1, track: { ...project.track, pieces: project.track.pieces.map((piece) => (piece.id === id ? { ...piece, angle: piece.angle + by } : piece)) } };
}

function bars(project: TProject): TPiece[] {
	return project.track.pieces.filter((piece) => tieOf(piece)?.kind === 'plays' && piece.type === 'platform');
}

function edited(project: TProject, after: TProject): { answer: TEditAnswer; landed: TProject; run: TSimulationResult } {
	const answer = answerEdit(simulator, { before: project, after });
	const landed = withEditAnswer(after, answer);
	return { answer, landed, run: simulator.simulate(landed) };
}

/** Steps the run took for hops that aren't kept, by the stretch of song they cover */
function hopsRun(project: TProject): number {
	return simulator.walk(project).marbles.flatMap((marble) => marble.hops).filter((hop) => !hop.isKept).length;
}

/** A dropped bar straight in the marble's way, between two notes */
function droppedInTheWay(project: TProject, run: TSimulationResult, index: number): TPiece {
	const samples = run.marbles[0]?.samples ?? [];
	const at = samples[Math.floor(samples.length * index)];
	if (at == null) throw new Error('No sample');
	return { id: 'dropped', type: 'platform', params: {}, angle: 0.3, place: { kind: 'free', position: { x: at.position.x, y: at.position.y - 0.02 } } };
}

describe('answerEdit function', () => {
	it('should keep every later note on time and touch few hops across random small edits', () => {
		const project = loadFixture('zigzag');
		simulator.simulate(project);
		let seed = 11;
		const random = (): number => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
		const list = bars(project);
		for (let i = 0; i < 20; i++) {
			const piece = list[Math.floor(random() * list.length)];
			if (piece == null) continue;
			const after = turned(project, piece.id, (random() * 2 - 1) * DEGREE);

			const { answer, landed, run } = edited(project, after);

			expect(answer.heldFrom, piece.id).toEqual([]);
			expect(run.hits.every((hit) => hit.status === 'onTime'), piece.id).toBe(true);
			// The edited hop and the one that takes it up, against all sixteen
			expect(answer.absorbedBy.length, piece.id).toBeLessThanOrEqual(1);
			expect(run.stats.steps, piece.id).toBe(0);
			expect(hopsRun(landed), piece.id).toBeLessThanOrEqual(3);
		}
	});

	it('should leave later hops as they were, shifted whole', () => {
		const project = loadFixture('zigzag');
		const run = simulator.simulate(project);
		const list = bars(project);
		const piece = list[4];
		if (piece == null) throw new Error('No bar');
		const after = turned(project, piece.id, 2 * DEGREE);

		const { answer, run: next } = edited(project, after);

		const taker = answer.absorbedBy[0];
		const hits = next.hits.filter((hit) => hit.pieceId != null);
		const shift = (index: number): { x: number; y: number } => {
			const now = hits[index]?.dot;
			const was = run.hits[index]?.dot;
			return { x: (now?.x ?? 0) - (was?.x ?? 0), y: (now?.y ?? 0) - (was?.y ?? 0) };
		};
		const from = hits.findIndex((hit) => hit.pieceId === (taker ?? piece.id));
		for (let i = from + 3; i < hits.length; i++) {
			expect(shift(i).x).toBeCloseTo(shift(from + 2).x, 9);
			expect(shift(i).y).toBeCloseTo(shift(from + 2).y, 9);
		}
	});

	it('should run the same from its saved hand-overs on a fresh simulator', async () => {
		const project = loadFixture('zigzag');
		const piece = bars(project)[6];
		if (piece == null) throw new Error('No bar');
		const { landed, run } = edited(project, turned(project, piece.id, 3 * DEGREE));

		const fresh = await createSimulator();
		const saved = JSON.parse(JSON.stringify(landed)) as TProject;
		const again = fresh.simulate(saved);

		expect(again.marbles[0]?.samples).toEqual(run.marbles[0]?.samples);
		expect(again.hits).toEqual(run.hits);
		fresh.dispose();
	});

	it('should do nothing for what no hop near it reaches', () => {
		const project = loadFixture('zigzag');
		const far: TProject = { ...project, revision: project.revision + 1, track: { ...project.track, pieces: [...project.track.pieces, { id: 'far', type: 'platform', params: {}, angle: 0, place: { kind: 'free', position: { x: 20, y: 20 } } }] } };

		const answer = answerEdit(simulator, { before: project, after: far });

		expect(answer.pieces).toEqual([]);
		expect(answer.marbles).toEqual([]);
	});

	it('should bring a dragged dot where it was asked, the bar before it aiming there', () => {
		const project = loadFixture('zigzag');
		const run = simulator.simulate(project);
		const hit = run.hits[6];
		if (hit?.dot == null) throw new Error('No dot');
		const dot = { x: hit.dot.x + 0.01, y: hit.dot.y };

		const answer = answerEdit(simulator, { before: project, after: project, movedDot: { marbleId: hit.marbleId, hitId: hit.hitId, dot } });
		const next = simulator.simulate(withEditAnswer(project, answer));

		expect(answer.move?.missed ?? 1).toBeLessThan(0.003);
		expect(Math.abs((next.hits[6]?.dot?.x ?? 0) - dot.x)).toBeLessThan(0.003);
		expect(next.hits.every((item) => item.status === 'onTime')).toBe(true);
	});

	describe('a bar dropped in the way', () => {
		it('should release the marble, keep the later notes waiting, and bring them back at once when it moves away', () => {
			const project = loadFixture('zigzag');
			const run = simulator.simulate(project);
			const list = [...project.track.pieces];
			const dropped = droppedInTheWay(project, run, 0.45);
			const blocked: TProject = { ...project, revision: project.revision + 1, track: { ...project.track, pieces: [...list, dropped] } };

			const { answer, landed, run: released } = edited(project, blocked);

			// The bar really deflects the marble, as real physics
			expect(released.contacts.some((contact) => contact.otherId === 'dropped')).toBe(true);
			const isCaught = answer.heldFrom.length === 0;
			if (isCaught) {
				expect(released.hits.every((hit) => hit.status === 'onTime')).toBe(true);
				return;
			}
			const held = released.pieces.filter((piece) => piece.status === 'held');
			expect(held.length).toBeGreaterThan(0);
			expect(released.hits.some((hit) => hit.status === 'waiting')).toBe(true);
			// Later pieces stand where the stored run has them
			for (const piece of held) expect(piece.position.x).toBeCloseTo(run.pieces.find((item) => item.pieceId === piece.pieceId)?.position.x ?? 0, 6);

			// Moved away, every note is back on the same run, with nothing else changed
			const away: TProject = { ...landed, revision: landed.revision + 1, track: { ...landed.track, pieces: [...list, { ...dropped, place: { kind: 'free', position: { x: 5, y: 5 } } }] } };
			const back = edited(landed, away);

			expect(back.answer.heldFrom).toEqual([]);
			expect(back.answer.absorbedBy).toEqual([]);
			expect(back.landed.marbles[0]?.waitsFrom).toBeUndefined();
			expect(back.run.hits.map((hit) => hit.status)).toEqual(run.hits.map((hit) => hit.status));
			expect(back.run.marbles[0]?.samples).toEqual(run.marbles[0]?.samples);
		});

		it('should bring every note back on Undo, whatever the marble did', () => {
			const project = loadFixture('zigzag');
			const run = simulator.simulate(project);
			const dropped = droppedInTheWay(project, run, 0.3);
			edited(project, { ...project, revision: project.revision + 1, track: { ...project.track, pieces: [...project.track.pieces, dropped] } });

			// Undo is the project as it was
			expect(simulator.simulate(project).marbles[0]?.samples).toEqual(run.marbles[0]?.samples);
			expect(simulator.simulate(project).stats.steps).toBe(0);
		});
	});

	it('should keep Undo exact after an edit: the project before it runs as it did', () => {
		const project = loadFixture('zigzag');
		const before = simulator.simulate(project);
		const piece = bars(project)[3];
		if (piece == null) throw new Error('No bar');
		edited(project, turned(project, piece.id, 2 * DEGREE));

		expect(simulator.simulate(project).marbles[0]?.samples).toEqual(before.marbles[0]?.samples);
	});
});
