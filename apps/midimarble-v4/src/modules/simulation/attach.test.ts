import { beforeAll, describe, expect, it } from 'vitest';
import { type TPiece, tieOf } from '@/modules/project';
import { ANCHOR_DELAY } from './pieces';
import { anchorHit, anchorPiece, linkPieceToHit, unanchorPiece, unlinkPiece } from './attach';
import { createSimulator, type TSimulator } from './simulate';
import type { TResolvedPiece, TSimulationResult } from './types';
import { apply, loadFixture } from '@/modules/project/test-helpers';

function pieceOf(result: TSimulationResult, entityId: string): TResolvedPiece {
	const piece = result.pieces.find((item) => item.entityId === entityId);
	if (piece == null) throw new Error(`No piece ${entityId}`);
	return piece;
}

// Free rails report their transform as the position, so compare their world points
function expectSamePose(after: TResolvedPiece, before: TResolvedPiece, tolerance = 1e-6): void {
	const points = (piece: TResolvedPiece) => piece.paths?.flat() ?? piece.path ?? [piece.position];
	const a = points(after);
	const b = points(before);
	expect(a.length).toBe(b.length);
	expect(Math.max(...a.map((point, i) => Math.hypot(point.x - (b[i]?.x ?? NaN), point.y - (b[i]?.y ?? NaN))))).toBeLessThan(tolerance);
	expect(Math.abs(after.angle - before.angle)).toBeLessThan(1e-9);
}

describe('attach helpers', () => {
	let simulator: TSimulator;

	beforeAll(async () => {
		simulator = await createSimulator();
	});

	it('should unlink a platform in place and link it back onto its hit', () => {
		const project = loadFixture('zigzag');
		const result = simulator.simulate(project);
		const marble = project.marbles[0];
		const hit = marble?.hits[8];
		const linked = project.track.pieces.find((piece) => tieOf(piece)?.hitId === hit?.id);
		if (marble == null || hit == null || linked == null) throw new Error('No linked platform');

		const [isUnlinked, unlinkErr, unlinked] = unlinkPiece(project, result, linked.id);
		if (!isUnlinked) throw unlinkErr;
		const free = apply(project, unlinked.commands);
		const freeResult = simulator.simulate(free);

		expect(tieOf(unlinked.piece)).toBeNull();
		expectSamePose(pieceOf(freeResult, linked.id), pieceOf(result, linked.id));
		expect(freeResult.hits.find((item) => item.hitId === hit.id)?.status).toBe('open');

		const [isLinked, linkErr, relinked] = linkPieceToHit(free, freeResult, linked.id, marble.id, hit.id);
		if (!isLinked) throw linkErr;
		const back = simulator.simulate(apply(free, relinked.commands));

		expect(back.hits.find((item) => item.hitId === hit.id)?.status).toBe('onTime');
		expectSamePose(pieceOf(back, linked.id), pieceOf(result, linked.id), 0.003);
	});

	it('should refuse to link scenery or a hit that already sounds', () => {
		const project = loadFixture('zigzag');
		const result = simulator.simulate(project);
		const marble = project.marbles[0];
		const [first, second] = project.track.pieces.filter((piece) => tieOf(piece) != null);
		if (marble == null || first == null || second == null) throw new Error('No linked platforms');

		const [isLinked, linkErr] = linkPieceToHit(project, result, first.id, marble.id, tieOf(second)?.hitId ?? '');

		expect(isLinked).toBe(false);
		expect(linkErr?.message).toMatch(/already has/);
	});

	it('should anchor free pieces to a moment on the trajectory and free them in place', () => {
		const base = loadFixture('zigzag');
		const marble = base.marbles[0];
		if (marble == null) throw new Error('No marble');
		const away = (id: string, type: string, x: number, y: number, angle: number, layout?: 'switchback'): TPiece => ({
			id,
			name: id,
			type,
			...(layout != null ? { layout } : {}),
			params: {},
			angle,
			place: { kind: 'free', position: { x, y } }
		});
		const project = apply(base, [
			{ type: 'addPiece', piece: away('scenery-rail', 'rail', 1.5, -0.4, -0.2) },
			{ type: 'addPiece', piece: away('scenery-switchback', 'rail', -1.5, -0.6, -0.15, 'switchback') },
			{ type: 'addPiece', piece: away('scenery-windmill', 'windmill', 1.5, 0.2, 0.3) }
		]);
		let result = simulator.simulate(project);
		let current = project;
		const time = (marble.hits[3]?.time ?? 1) + 0.1;

		for (const id of ['scenery-rail', 'scenery-switchback', 'scenery-windmill']) {
			const before = pieceOf(result, id);
			const [isAnchored, anchorErr, anchored] = anchorPiece(current, result, id, marble.id, time);
			if (!isAnchored) throw anchorErr;
			current = apply(current, anchored.commands);
			result = simulator.simulate(current);
			const after = pieceOf(result, id);

			expect(tieOf(anchored.piece)).toEqual(expect.objectContaining({ kind: 'follows', hitId: marble.hits[3]?.id }));
			expect(after.entryTime).toBeCloseTo(time, 9);
			expectSamePose(after, before);
		}
		expect(result.hits.filter((item) => item.status !== 'onTime')).toEqual([]);

		const frozen = pieceOf(result, 'scenery-switchback');
		const [isFreed, freeErr, freed] = unanchorPiece(current, result, 'scenery-switchback');
		if (!isFreed) throw freeErr;
		const freedResult = simulator.simulate(apply(current, freed.commands));

		expectSamePose(pieceOf(freedResult, 'scenery-switchback'), frozen);
		expect(unlinkPiece(current, result, 'scenery-rail')[0]).toBe(false);
	});

	it('should anchor before the first hit with a negative delay on it', () => {
		const base = loadFixture('zigzag');
		const marble = base.marbles[0];
		const first = marble?.hits[0];
		if (marble == null || first == null) throw new Error('No marble');
		const project = apply(base, [
			{
				type: 'addPiece',
				piece: { id: 'early-windmill', name: 'early-windmill', type: 'windmill', params: {}, angle: 0, place: { kind: 'free', position: { x: 1.5, y: 0.2 } } }
			}
		]);
		const result = simulator.simulate(project);
		const before = pieceOf(result, 'early-windmill');
		const time = first.time / 2;

		const [isAnchored, anchorErr, anchored] = anchorPiece(project, result, 'early-windmill', marble.id, time);
		if (!isAnchored) throw anchorErr;
		const next = simulator.simulate(apply(project, anchored.commands));

		expect(tieOf(anchored.piece)?.hitId).toBe(first.id);
		expect(anchored.piece.params['entryDelay']).toBeCloseTo(time - first.time, 9);
		expect(pieceOf(next, 'early-windmill').entryTime).toBeCloseTo(time, 9);
		expectSamePose(pieceOf(next, 'early-windmill'), before);
		expect(next.hits.filter((item) => item.status !== 'onTime')).toEqual([]);
	});
});

describe('anchorHit', () => {
	const hits = [{ time: 1 }, { time: 2 }, { time: 3 }];

	it('should pick the last hit at or before the moment', () => {
		expect(anchorHit(hits, 2.5)).toBe(hits[1]);
		expect(anchorHit(hits, 2)).toBe(hits[1]);
	});

	it('should pick the first hit for a moment before it', () => {
		expect(anchorHit(hits, 0.4)).toBe(hits[0]);
	});

	it('should refuse moments further than the longest delay', () => {
		expect(anchorHit(hits, 3 + ANCHOR_DELAY + 0.1)).toBeNull();
		expect(anchorHit(hits, 1 - ANCHOR_DELAY - 0.1)).toBeNull();
		expect(anchorHit([], 1)).toBeNull();
	});
});
