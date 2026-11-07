import { describe, expect, it } from 'vitest';
import { createMarble, createProject, freePosition, type TPiece, type TProject, tieOf } from '@/modules/project';
import { createLinkedPiece, layoutFree, resolvePieceParams, resolvePiecePath, smoothPath } from '@/modules/simulation';
import { asAnchored, asFree, asLinked, attachState, createFreePiece, displayPiece, railPath, rotateResolved, withSnap, rebaseNodes, sampleNodes, segmentPoint, withNodeHandle, withNodePoint } from '@/modules/building';
import { distanceToSegment } from '@/modules/scene';

describe('bezier', () => {
	const curve = [
		{ point: { x: 0, y: 0 }, out: { x: 0.05, y: 0 } },
		{ point: { x: 0.1, y: -0.05 }, in: { x: -0.05, y: 0 } }
	];

	it('should sample the curve from its first to its last node with the requested spacing', () => {
		const points = sampleNodes(curve, 0.01);
		expect(points[0]).toEqual({ x: 0, y: 0 });
		expect(points.at(-1)?.x).toBeCloseTo(0.1, 9);
		expect(points.at(-1)?.y).toBeCloseTo(-0.05, 9);
		for (let i = 1; i < points.length; i++) {
			const a = points[i - 1];
			const b = points[i];
			if (a == null || b == null) continue;
			expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(0.011);
		}
	});

	it('should keep the curve through the engine smoothing', () => {
		const points = sampleNodes(curve);
		const smoothed = smoothPath(points);
		const middle = segmentPoint(curve[0] as (typeof curve)[0], curve[1] as (typeof curve)[1], 0.5);
		const nearest = Math.min(...smoothed.slice(1).map((point, i) => distanceToSegment(middle, smoothed[i] ?? point, point)));
		expect(nearest).toBeLessThan(0.001);
	});

	it('should mirror the opposite handle unless broken, and move handles with their node', () => {
		const mirrored = withNodeHandle(curve, 0, 'out', { x: 0.02, y: 0.03 });
		expect(mirrored[0]?.in).toEqual({ x: -0.02, y: -0.03 });
		const broken = withNodeHandle(curve, 1, 'in', { x: -0.01, y: 0.02 }, false);
		expect(broken[1]?.out).toBeUndefined();
		const moved = withNodePoint(curve, 1, { x: 0.2, y: 0 });
		expect(moved[1]?.in).toEqual(curve[1]?.in);
	});

	it('should rebase nodes so the first one is the origin', () => {
		const { nodes, shift } = rebaseNodes(withNodePoint(curve, 0, { x: 0.03, y: 0.01 }));
		expect(shift).toEqual({ x: 0.03, y: 0.01 });
		expect(nodes[0]?.point).toEqual({ x: 0, y: 0 });
		expect(nodes[1]?.point.x).toBeCloseTo(0.07, 9);
	});
});

describe('open canvas attachments', () => {
	function project(): { project: TProject } {
		const base = createProject({ title: 'Test' });
		const marble = { ...createMarble(0, { x: 0, y: 0.6 }, 'marble-1'), hits: [{ id: 'hit-a', time: 0.5 }, { id: 'hit-b', time: 1 }] };
		return { project: { ...base, marbles: [marble] } };
	}

	it('should keep the pose when a free platform links to a dot and frees again', () => {
		const { project: base } = project();
		const piece = createFreePiece('platform', { position: { x: 0.1, y: 0.2 }, angle: 0.2 }, base.track.pieces);
		const dot = { x: 0.12, y: 0.215 };
		const linked = asLinked(piece, { position: { x: 0.1, y: 0.2 }, angle: 0.2 }, 'marble-1', 'hit-b', dot);
		expect(freePosition(linked)).toBeUndefined();
		expect(linked.angle).toBe(0.2);
		expect(tieOf(linked)?.contactAt).toBeGreaterThan(0.5);
		expect(attachState(base, linked)).toEqual({ kind: 'linked', marbleId: 'marble-1', hitId: 'hit-b' });
		const free = asFree(linked, { position: { x: 0.1, y: 0.2 }, angle: 0.2 });
		expect(tieOf(free)).toBeNull();
		expect(free.params['entryDelay']).toBeUndefined();
		expect(attachState(base, free)).toEqual({ kind: 'free' });
	});

	it('should anchor to the latest hit before the moment with the offset from the marble', () => {
		const { project: base } = project();
		const piece = createFreePiece('windmill', { position: { x: 0.1, y: 0.2 }, angle: 0 }, base.track.pieces);
		const anchored = asAnchored(base, piece, { position: { x: 0.1, y: 0.2 }, angle: 0 }, 'marble-1', 1.25, { x: 0.05, y: 0.25 });
		const place = anchored?.place;
		if (place?.kind !== 'follows') throw new Error('An anchored piece follows');
		expect(place.hitId).toBe('hit-b');
		expect(place.offset?.x).toBeCloseTo(0.05, 9);
		expect(place.offset?.y).toBeCloseTo(-0.05, 9);
		expect(anchored?.params['entryDelay']).toBeCloseTo(0.25, 6);
		expect(attachState(base, anchored as TPiece)).toEqual({ kind: 'anchored', marbleId: 'marble-1', hitId: 'hit-b', time: 1.25 });
		// Before the first hit the anchor counts back from it
		const early = asAnchored(base, piece, { position: { x: 0, y: 0 }, angle: 0 }, 'marble-1', 0.2, { x: 0, y: 0 });
		expect(tieOf(early)).toMatchObject({ kind: 'follows', hitId: 'hit-a' });
		expect(attachState(base, early as TPiece)).toMatchObject({ kind: 'anchored', hitId: 'hit-a' });
		expect((attachState(base, early as TPiece) as { time: number }).time).toBeCloseTo(0.2, 6);
		// A marble without hits has nothing to count from, so a drop stays free
		expect(tieOf(withSnap(base, piece, { position: { x: 0, y: 0 }, angle: 0 }, { kind: 'anchor', marbleId: 'missing', time: 0.2, marble: { x: 0, y: 0 } }))).toBeNull();
	});

	it('should draw a free piece where the engine lays it out', () => {
		const { project: base } = project();
		const nodes = [{ point: { x: 0, y: 0 } }, { point: { x: 0.1, y: -0.02 } }];
		const rail = createFreePiece('rail', { position: { x: 0.3, y: 0.1 }, angle: 0.1 }, base.track.pieces, railPath(nodes));
		const shown = displayPiece(rail, { pose: { position: { x: 0.3, y: 0.1 }, angle: 0.1 } });
		const type = 'rail';
		const layout = layoutFree(
			{ type, params: resolvePieceParams(type, rail.params ?? {}), path: resolvePiecePath(type, rail.path?.points), angle: 0.1, contactAt: 0.5, marbleRadius: 0.012 },
			{ x: 0.3, y: 0.1 }
		);
		expect(shown.path).toEqual(layout.path);
		// The first node is the local origin, so the rail starts at its transform
		expect(shown.path?.[0]?.x).toBeCloseTo(0.3, 9);
	});

	it('should turn a resolved piece around its pivot', () => {
		const piece = displayPiece(createLinkedPiece('platform', 'marble-1', 'hit-a', 0), { pose: { position: { x: 0.1, y: 0 }, angle: 0 } });
		const turned = rotateResolved(piece, { x: 0, y: 0 }, Math.PI / 2);
		expect(turned.position.x).toBeCloseTo(0, 9);
		expect(turned.position.y).toBeCloseTo(0.1, 9);
		expect(turned.angle).toBeCloseTo(Math.PI / 2, 9);
	});
});
