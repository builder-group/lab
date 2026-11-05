import { describe, expect, it } from 'vitest';
import type { TPiece } from '@/modules/project';
import { createBareRunProject } from './fixture-projects';
import { gapPieceOrder, gapPieceTypeOf, gapSearch, type TGapSearchPlan, type TGapTry } from './gap-pieces';
import { chainGeometry, layoutAtMarble, layoutFree, layoutOf, switchbackGeometry, type TLayoutInput } from './piece-layout';
import { railLayoutInfo, resolvePieceParams, RAIL_LAYOUTS, type TRailLayout } from './pieces';
import { createSimulator } from './simulate';

function input(layout: TRailLayout, params: Record<string, number> = {}): TLayoutInput {
	return { type: 'rail', layout, params: resolvePieceParams('rail', { ...railLayoutInfo[layout].defaults, ...params }), path: [], angle: -0.14, contactAt: 0.5, marbleRadius: 0.012 };
}

describe('Rail layouts', () => {
	it('should generate its paths around the entry for every layout but Drawn', () => {
		for (const layout of RAIL_LAYOUTS) {
			expect(layoutOf('rail', layout)).toBe(layout === 'path' ? 'path' : 'generated');
			if (layout === 'path') continue;
			const placed = layoutAtMarble(input(layout), { x: 0, y: 0 }, null);
			expect(placed.paths?.length, layout).toBeGreaterThan(0);
			expect(placed.shapes.every((shape) => shape.kind === 'capsule')).toBe(true);
		}
	});

	it('should lay the Switchback layout out on exactly the wires of `switchbackGeometry`', () => {
		const params = resolvePieceParams('rail', {});
		const wires = switchbackGeometry(params, -0.14, 0.5, { x: 0.1, y: 0.2 }, 0.012, null).wires;
		expect(layoutAtMarble(input('switchback'), { x: 0.1, y: 0.2 }, null).paths).toEqual(wires);
		expect(wires).toHaveLength(4);
	});

	it('should chain separate turns, each a curve, with no stop after the last', () => {
		const { wires, legs } = chainGeometry({ width: 0.12, turns: 3, drop: 0.07, arc: 0.05, sweep: 100, radius: 0.00375 }, -0.14, 0.5, { x: 0, y: 0 }, 0.012, null);
		expect(wires).toHaveLength(3);
		expect(legs).toHaveLength(3);
		// Every turn is under the one before
		const lows = wires.map((wire) => Math.min(...wire.map((point) => point.y)));
		expect(lows[1] ?? 0).toBeLessThan(lows[0] ?? 0);
		expect(lows[2] ?? 0).toBeLessThan(lows[1] ?? 0);
	});

	it('should give a C one turn however many a Chain had', () => {
		expect(layoutFree(input('c', { turns: 5 }), { x: 0, y: 0 }).paths).toHaveLength(1);
	});

	it('should hold a drawn Rail\'s further paths as colliders of the one piece', async () => {
		const project = createBareRunProject({ id: 'two-paths', title: 'Two Paths', end: 1.2, gravity: 0.5, marbles: [{ x: 0, y: 0.1, releaseTime: 0, hitTimes: [] }] });
		const rail: TPiece = {
			id: 'rail',
			type: 'rail', params: {}, angle: 0, place: { kind: 'free', position: { x: 0, y: 0 } }, path: { points: [{ x: 0.3, y: 0 }, { x: 0.5, y: 0 }], paths: [[{ x: -0.1, y: 0 }, { x: 0.1, y: -0.02 }]] }
		};
		project.track.pieces.push(rail);
		const simulator = await createSimulator();
		const result = simulator.simulate(project);
		expect(result.pieces.find((piece) => piece.pieceId === 'rail')?.paths).toHaveLength(2);
		// The marble lands on the further path
		expect(result.contacts.some((contact) => contact.otherId === 'rail')).toBe(true);
		simulator.dispose();
	}, 20_000);
});

describe('asking for a gap piece', () => {
	it('should fall back from a Chain to the Switchback layout, and leave the default alone', () => {
		expect(gapPieceOrder('chain')).toEqual(['chain', 'switchback']);
		expect(gapPieceOrder()).toEqual(['rail', 'switchback']);
		expect(gapPieceTypeOf({ type: 'rail', layout: 'chain' })).toBe('chain');
		expect(gapPieceTypeOf({ type: 'rail' })).toBe('rail');
		expect(gapPieceTypeOf({ type: 'tunnel' })).toBe('tunnel');
	});

	it('should refuse a candidate that keeps the marble in its turns', () => {
		const candidate: TGapTry = { entryTime: 1, downhill: 1, contactAt: 0.5, width: 0.12, turns: 2, slope: 0.1 };
		const stuck = { dot: null, isDotInFrame: true, isRunInFrame: true, leaveTime: null, pieceStatus: 'placed', nextStatus: null };
		const plan: TGapSearchPlan = { type: 'chain', id: 'chain', count: 0, marbleId: 'marble', fromHitId: 'hit', fromTime: 0.5, candidates: [candidate], fallback: candidate, isRefined: false };
		const steps = gapSearch(plan);
		steps.next();
		const done = steps.next([{ score: 0, check: stuck }]);
		const [isOk, error] = done.value as unknown as [boolean, Error];
		expect(done.done).toBe(true);
		expect(isOk).toBe(false);
		expect(error.message).toMatch(/holds the marble/);
	});
});
