import { beforeAll, describe, expect, it } from 'vitest';
import { checkRun, NO_BLENDER_OBJECTS, strayCause } from '@/modules/building';
import { type TProject, tieOf } from '@/modules/project';
import { loadFixture } from '@/modules/project/test-helpers';
import { answerSettle, editStart, marbleEdits, reconnect, release, settleBase, type TSettleAnswer, withRides } from './local-edit';
import { createSimulator, type TSimulator } from './simulate';
import type { TSimulationResult } from './types';

const DEGREE = Math.PI / 180;

function turned(project: TProject, id: string, by: number): TProject {
	return {
		...project,
		revision: project.revision + 1,
		track: { ...project.track, pieces: project.track.pieces.map((piece) => {
			const link = tieOf(piece);
			return piece.id === id && link != null ? { ...piece, angle: piece.angle + by } : piece;
		}) }
	};
}

function landed(project: TProject, answer: TSettleAnswer): TProject {
	const changed = new Map(answer.pieces.map((piece) => [piece.id, piece]));
	return { ...project, track: { ...project.track, pieces: project.track.pieces.map((piece) => changed.get(piece.id) ?? piece) } };
}

function shift(a: TSimulationResult, b: TSimulationResult, hitId: string): number {
	const dotA = a.hits.find((hit) => hit.hitId === hitId)?.dot;
	const dotB = b.hits.find((hit) => hit.hitId === hitId)?.dot;
	return dotA != null && dotB != null ? Math.hypot(dotA.x - dotB.x, dotA.y - dotB.y) : Infinity;
}

describe('settling an edit', () => {
	let simulator: TSimulator;
	const fresh = async (project: TProject): Promise<TSimulationResult> => (await createSimulator()).simulate(project);

	beforeAll(async () => {
		simulator = await createSimulator();
	});

	describe('marbleEdits function', () => {
		const project = loadFixture('zigzag');

		it('should name the marble and the hit of a turned platform', () => {
			expect(marbleEdits(project, turned(project, 'piece-1-5', 0.01))).toEqual([{ marbleId: 'marble-1', afterIndex: 4 }]);
		});

		it('should only keep the rides for a slide along the bar, and ask nothing of a turn of the last platform', () => {
			const slid = {
				...project,
				track: { ...project.track, pieces: project.track.pieces.map((piece) => {
					const link = tieOf(piece);
					return piece.id === 'piece-1-5' && link != null ? { ...piece, place: { ...link, contactAt: 0.3 } } : piece;
				}) }
			};
			expect(marbleEdits(project, slid)).toEqual([{ marbleId: 'marble-1', afterIndex: project.marbles[0]?.hits.length }]);
			expect(marbleEdits(project, turned(project, 'piece-1-16', 0.01))).toEqual([]);
		});

		it('should count the platform before one taken away among those that take up the change', () => {
			const without = { ...project, track: { ...project.track, pieces: project.track.pieces.filter((piece) => piece.id !== 'piece-1-5') } };
			expect(marbleEdits(project, without)).toEqual([{ marbleId: 'marble-1', afterIndex: 2 }]);
		});
	});

	describe('answerSettle function', () => {
		const withFreePlatform = (project: TProject, position: { x: number; y: number }): TProject => ({
			...project,
			revision: project.revision + 1,
			track: { ...project.track, pieces: [...project.track.pieces, { id: 'free', name: 'Free', type: 'platform', params: {}, angle: 0, place: { kind: 'free', position } }] }
		});

		it('should leave every hit where it was when a piece clear of the run comes near a rail', async () => {
			// Prepare: a platform within a marble's reach while it rides, so its collider enters that marble's world
			const project = loadFixture('long-gap');
			const before = await fresh(project);
			const rail = project.track.pieces.find((piece) => piece.type === 'rail');
			const entry = before.pieces.find((piece) => piece.pieceId === rail?.id)?.entryTime;
			const sample = before.marbles[0]?.samples.find((item) => item.time >= (entry ?? Infinity));
			if (sample == null) throw new Error('Missing ride');
			const after = withFreePlatform(project, { x: sample.position.x - 0.13, y: sample.position.y });

			// Act
			const { answer, memo } = answerSettle(simulator, { before: project, after }, null);
			const run = await fresh(landed(after, answer));

			// Assert
			expect(marbleEdits(project, after).every((edit) => edit.isElsewhere === true)).toBe(true);
			expect(answer.broken).toEqual([]);
			expect(run.contacts.some((contact) => contact.otherId === 'free')).toBe(false);
			for (const hit of run.hits) expect(shift(run, memo.base, hit.hitId)).toBeLessThan(1e-4);
		});

		it('should keep the break one problem and name the piece when a free piece stands in the run', async () => {
			// Prepare: right on the marble's way to a later hit
			const project = loadFixture('zigzag');
			const before = await fresh(project);
			const hit = before.hits[6];
			if (hit?.dot == null) throw new Error('Missing dot');
			const after = withFreePlatform(project, { x: hit.dot.x, y: hit.dot.y + 0.02 });

			// Act
			const { answer } = answerSettle(simulator, { before: project, after }, null);
			const landedProject = landed(after, answer);
			const run = await fresh(landedProject);
			const broken = checkRun(landedProject, run, NO_BLENDER_OBJECTS).issues.filter((issue) => issue.kind === 'hit');

			// Assert
			expect(answer.heldFrom).toHaveLength(1);
			expect(broken.length).toBeLessThanOrEqual(2);
			expect(strayCause(landedProject, run, 'marble-1', hit.targetTime)).toMatch(/hits Free at/);
			expect(broken[0]?.detail).toMatch(/hits Free at/);
		});

		it('should keep every later platform where it was when one is tilted', async () => {
			// Prepare
			const project = loadFixture('zigzag');
			const before = await fresh(project);

			// Act
			const after = turned(project, 'piece-1-5', 1 * DEGREE);
			const { answer } = answerSettle(simulator, { before: project, after }, null);
			const run = await fresh(landed(after, answer));

			// Assert
			expect(answer.absorbedBy).toEqual(['piece-1-6', 'piece-1-7']);
			expect(answer.broken).toEqual([]);
			expect(run.hits.every((hit) => hit.status === 'onTime')).toBe(true);
			for (const hit of run.hits.slice(7)) expect(shift(run, before, hit.hitId)).toBeLessThan(0.002);
		});

		it('should give the same answer from a cold simulator', async () => {
			const project = loadFixture('zigzag');
			const after = turned(project, 'piece-1-3', -2 * DEGREE);
			const warm = answerSettle(simulator, { before: project, after }, null).answer;
			const cold = answerSettle(await createSimulator(), { before: project, after }, null).answer;
			expect(cold.pieces).toEqual(warm.pieces);
		});

		it('should send the marble to a dragged platform and back on the old run after it', async () => {
			// Prepare
			const project = loadFixture('zigzag');
			const before = await fresh(project);
			const hit = before.hits.find((item) => item.hitId === 'hit-1-5');
			if (hit?.dot == null) throw new Error('Missing dot');
			const dot = { x: hit.dot.x, y: hit.dot.y - 0.008 };

			// Act
			const { answer } = answerSettle(simulator, { before: project, after: project, movedDot: { marbleId: 'marble-1', hitId: 'hit-1-5', dot } }, null);
			const run = await fresh(landed(project, answer));

			// Assert
			const moved = run.hits.find((item) => item.hitId === 'hit-1-5');
			expect(moved?.dot?.y).toBeCloseTo(dot.y, 2);
			expect(run.hits.every((item) => item.status === 'onTime')).toBe(true);
			for (const later of run.hits.slice(7)) expect(shift(run, before, later.hitId)).toBeLessThan(0.003);
		});
	});

	describe('a dragged piece', () => {
		it('should leave every piece before the platform aiming at it where it was, rides not played back', async () => {
			// Prepare
			const project = loadFixture('long-gap');
			const before = await fresh(project);
			const marble = project.marbles[0];
			const hits = marble?.hits ?? [];
			const target = hits[hits.length - 2];
			const aiming = hits[hits.length - 3];
			const dot = before.hits.find((hit) => hit.hitId === target?.id)?.dot;
			if (marble == null || target == null || aiming == null || dot == null) throw new Error('Missing hit');

			// Act
			const { answer } = answerSettle(simulator, { before: project, after: project, movedDot: { marbleId: marble.id, hitId: target.id, dot: { x: dot.x + 0.02, y: dot.y } } }, null);
			const run = await fresh(landed(project, answer));

			// Assert
			const timeOf = (id: string): number => {
				const link = tieOf(project.track.pieces.find((piece) => piece.id === id));
				return hits.find((hit) => hit.id === link?.hitId)?.time ?? Infinity;
			};
			const earlier = before.pieces.filter((piece) => timeOf(piece.pieceId) < aiming.time);
			expect(earlier.length).toBeGreaterThan(0);
			for (const piece of earlier) {
				const now = run.pieces.find((item) => item.pieceId === piece.pieceId);
				expect(now?.position).toEqual(piece.position);
				expect(now?.angle).toEqual(piece.angle);
			}
			expect(answer.pieces.filter((piece) => timeOf(piece.id) < aiming.time)).toEqual([]);
		});

		it('should start an edit at its earliest changed hit, or the platform before a moved dot', () => {
			const project = loadFixture('zigzag');
			const hits = project.marbles[0]?.hits ?? [];
			expect(editStart(project, turned(project, 'piece-1-5', 0.01))).toBe(hits[4]?.time);
			expect(editStart(project, project, { marbleId: 'marble-1', hitId: hits[6]?.id ?? '' })).toBe(hits[5]?.time);
			expect(editStart(project, project)).toBe(-Infinity);
		});
	});

	describe('a ride through a gap piece', () => {
		it('should play as the run it came from, whatever comes before it', async () => {
			// Prepare
			const project = loadFixture('long-gap');
			const run = await fresh(project);
			const ridden = withRides(project, run);
			const pieces = ridden.track.pieces.filter((piece) => piece.ride != null);

			// Act
			const again = await fresh(ridden);
			const tiny = turned(ridden, 'piece-1-1', 1e-5);
			const nudged = await fresh(tiny);

			// Assert
			expect(pieces.length).toBeGreaterThan(0);
			for (const hit of again.hits) expect(shift(again, run, hit.hitId)).toBeLessThan(0.01);
			for (const hit of nudged.hits) expect(shift(nudged, again, hit.hitId)).toBeLessThan(0.002);
		});

		it('should be simulated again once the piece changes', async () => {
			const project = loadFixture('long-gap');
			const ridden = withRides(project, await fresh(project));
			const ride = ridden.track.pieces.find((piece) => piece.ride != null);
			if (ride == null) throw new Error('No ride');
			const changed = {
				...ridden,
				track: { ...ridden.track, pieces: ridden.track.pieces.map((piece) => {
					const tie = tieOf(piece);
					return piece.id === ride.id && tie != null ? { ...piece, angle: piece.angle + 0.05 } : piece;
				}) }
			};
			const a = await fresh(ridden);
			const b = await fresh(changed);
			expect(a.marbles[0]?.samples).not.toEqual(b.marbles[0]?.samples);
		});
	});

	describe('a break nothing takes up', () => {
		const breakIt = (): { project: TProject; after: TProject; answer: TSettleAnswer } => {
			const project = loadFixture('zigzag');
			const after = turned(project, 'piece-1-5', -85 * DEGREE);
			return { project, after, answer: answerSettle(simulator, { before: project, after }, null).answer };
		};

		it('should keep later pieces where they were, with one problem at one hit', async () => {
			// Prepare
			const { project, after, answer } = breakIt();
			const before = await fresh(project);

			// Act
			const run = await fresh(landed(after, answer));

			// Assert
			expect(answer.heldFrom.length).toBe(1);
			expect(run.hits.filter((hit) => hit.status === 'missed' || hit.status === 'blocked')).toHaveLength(1);
			const first = answer.heldFrom[0]?.time ?? 0;
			for (const piece of run.pieces) {
				const was = before.pieces.find((item) => item.pieceId === piece.pieceId);
				if ((piece.hitTime ?? 0) >= first && piece.status === 'held' && piece.pieceId !== 'piece-1-5') expect(Math.hypot(piece.position.x - (was?.position.x ?? 0), piece.position.y - (was?.position.y ?? 0))).toBeLessThan(0.002);
			}
		});

		it('should bring the marble back once the edit is taken back by hand', async () => {
			// Prepare
			const { after, answer } = breakIt();
			const held = landed(after, answer);

			// Act
			const back = turned(held, 'piece-1-5', 85 * DEGREE);
			const reconnected = reconnect(simulator, back);
			if (reconnected == null) throw new Error('No way back');
			const run = await fresh(landed(back, { ...answer, pieces: reconnected.pieces }));

			// Assert
			expect(run.hits.every((hit) => hit.status === 'onTime')).toBe(true);
			expect(run.pieces.every((piece) => piece.status !== 'held')).toBe(true);
		});

		it('should let every piece follow the marble again on release', async () => {
			const { after, answer } = breakIt();
			const released = release(landed(after, answer));
			expect(released.track.pieces.every((piece) => tieOf(piece)?.held == null)).toBe(true);
		});
	});

	describe('settleBase function', () => {
		it('should keep the run it knows for the same project', () => {
			const project = loadFixture('zigzag');
			const known = settleBase(simulator, project, null);
			expect(settleBase(simulator, project, known)).toBe(known);
		});
	});
});
