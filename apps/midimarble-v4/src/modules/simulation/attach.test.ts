import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyProjectCommands, parseProject, type TEntity, type TProject } from '@/modules/project';
import { ANCHOR_DELAY } from './pieces';
import { anchorHit, anchorPiece, linkPieceToHit, unanchorPiece, unlinkPiece } from './attach';
import { createSimulator, type TSimulator } from './simulate';
import type { TResolvedPiece, TSimulationResult } from './types';

function loadFixture(name: string): TProject {
	const json = readFileSync(new URL(`../../../fixtures/${name}.marble.json`, import.meta.url), 'utf8');
	const [isProjectOk, projectErr, project] = parseProject(json);
	if (!isProjectOk) throw projectErr;
	return project;
}

function apply(project: TProject, commands: Parameters<typeof applyProjectCommands>[1]): TProject {
	const [isApplied, applyErr, next] = applyProjectCommands(project, commands);
	if (!isApplied) throw applyErr;
	return next;
}

function pieceOf(result: TSimulationResult, entityId: string): TResolvedPiece {
	const piece = result.pieces.find((item) => item.entityId === entityId);
	if (piece == null) throw new Error(`No piece ${entityId}`);
	return piece;
}

// Free rails and switchbacks report their transform as the position, so compare their world points
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
		const lane = project.music.lanes[0];
		const hit = lane?.hits[8];
		const linked = project.entities.find((entity) => entity.components.hitLink?.hitId === hit?.id);
		if (lane == null || hit == null || linked == null) throw new Error('No linked platform');

		const [isUnlinked, unlinkErr, unlinked] = unlinkPiece(project, result, linked.id);
		if (!isUnlinked) throw unlinkErr;
		const free = apply(project, unlinked.commands);
		const freeResult = simulator.simulate(free);

		expect(unlinked.entity.components.hitLink).toBeUndefined();
		expectSamePose(pieceOf(freeResult, linked.id), pieceOf(result, linked.id));
		expect(freeResult.hits.find((item) => item.hitId === hit.id)?.status).toBe('open');

		const [isLinked, linkErr, relinked] = linkPieceToHit(free, freeResult, linked.id, lane.id, hit.id);
		if (!isLinked) throw linkErr;
		const back = simulator.simulate(apply(free, relinked.commands));

		expect(back.hits.find((item) => item.hitId === hit.id)?.status).toBe('onTime');
		expectSamePose(pieceOf(back, linked.id), pieceOf(result, linked.id), 0.003);
	});

	it('should refuse to link scenery or a hit that already sounds', () => {
		const project = loadFixture('zigzag');
		const result = simulator.simulate(project);
		const lane = project.music.lanes[0];
		const [first, second] = project.entities.filter((entity) => entity.components.hitLink != null);
		if (lane == null || first == null || second == null) throw new Error('No linked platforms');

		const [isLinked, linkErr] = linkPieceToHit(project, result, first.id, lane.id, second.components.hitLink?.hitId ?? '');

		expect(isLinked).toBe(false);
		expect(linkErr?.message).toMatch(/already has/);
	});

	it('should anchor free pieces to a moment on the trajectory and free them in place', () => {
		const base = loadFixture('zigzag');
		const lane = base.music.lanes[0];
		if (lane == null) throw new Error('No lane');
		const away = (id: string, type: string, x: number, y: number, angle: number): TEntity => ({
			id,
			name: id,
			components: { piece: { type, params: {} }, transform: { position: { x, y }, angle } }
		});
		const project = apply(base, [
			{ type: 'upsertEntity', entity: away('scenery-rail', 'rail', 1.5, -0.4, -0.2) },
			{ type: 'upsertEntity', entity: away('scenery-switchback', 'switchback', -1.5, -0.6, -0.15) },
			{ type: 'upsertEntity', entity: away('scenery-windmill', 'windmill', 1.5, 0.2, 0.3) }
		]);
		let result = simulator.simulate(project);
		let current = project;
		const time = (lane.hits[3]?.time ?? 1) + 0.1;

		for (const id of ['scenery-rail', 'scenery-switchback', 'scenery-windmill']) {
			const before = pieceOf(result, id);
			const [isAnchored, anchorErr, anchored] = anchorPiece(current, result, id, lane.id, time);
			if (!isAnchored) throw anchorErr;
			current = apply(current, anchored.commands);
			result = simulator.simulate(current);
			const after = pieceOf(result, id);

			expect(anchored.entity.components.hitLink).toEqual(expect.objectContaining({ anchored: true, hitId: lane.hits[3]?.id }));
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
		const lane = base.music.lanes[0];
		const first = lane?.hits[0];
		if (lane == null || first == null) throw new Error('No lane');
		const project = apply(base, [
			{
				type: 'upsertEntity',
				entity: { id: 'early-windmill', name: 'early-windmill', components: { piece: { type: 'windmill', params: {} }, transform: { position: { x: 1.5, y: 0.2 }, angle: 0 } } }
			}
		]);
		const result = simulator.simulate(project);
		const before = pieceOf(result, 'early-windmill');
		const time = first.time / 2;

		const [isAnchored, anchorErr, anchored] = anchorPiece(project, result, 'early-windmill', lane.id, time);
		if (!isAnchored) throw anchorErr;
		const next = simulator.simulate(apply(project, anchored.commands));

		expect(anchored.entity.components.hitLink?.hitId).toBe(first.id);
		expect(anchored.entity.components.piece?.params['entryDelay']).toBeCloseTo(time - first.time, 9);
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
