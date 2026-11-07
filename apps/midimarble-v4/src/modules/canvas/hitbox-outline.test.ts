import { describe, expect, it } from 'vitest';
import type { TVec2 } from '@/modules/project';
import type { TResolvedPiece } from '@/modules/simulation';
import { shapeDistance, type TPieceShape } from '@/modules/simulation';
import { hitboxOutlines, shapeOutlines } from './hitbox-outline';

function piece(values: Partial<TResolvedPiece>): TResolvedPiece {
	return { pieceId: 'piece', type: 'platform', position: { x: 0, y: 0 }, angle: 0, params: {}, contactPoint: null, contactNormal: null, hitTime: null, status: 'ok', ...values } as TResolvedPiece;
}

/** Each outline corner lies on the collider's own outline: distance zero from the shape */
function expectOnShape(outline: TVec2[], shape: TPieceShape): void {
	for (const corner of outline) expect(Math.abs(shapeDistance(shape, corner.x, corner.y))).toBeLessThan(1e-9);
}

describe('hitboxOutlines function', () => {
	it('should outline a platform by the box the simulation collides with, turned with it', () => {
		const platform = piece({ position: { x: 1, y: 2 }, angle: Math.PI / 2, params: { length: 0.1, thickness: 0.02 } });

		const [outline = []] = hitboxOutlines(platform, 0);

		expect(outline).toHaveLength(4);
		expectOnShape(outline, { kind: 'box', box: { cx: 1, cy: 2, angle: Math.PI / 2, halfLength: 0.05, halfThickness: 0.01 } });
		const ys = outline.map((corner) => corner.y);
		expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.1);
	});

	it('should outline a windmill as it turned by the playhead', () => {
		const params = { bladeCount: 2, bladeLength: 0.1, bladeThickness: 0.01, hubRadius: 0.02 };
		const windmill = piece({ type: 'windmill', params, motion: [{ time: 0, angle: 0 }, { time: 1, angle: Math.PI / 2 }] } as Partial<TResolvedPiece>);

		// The hub, then the arm that starts along +x and has turned to +y after a second
		const outlines = hitboxOutlines(windmill, 1);

		expect(outlines).toHaveLength(3);
		const arm = outlines[1] ?? [];
		expect(Math.max(...arm.map((corner) => corner.y))).toBeCloseTo(0.12);
		expect(Math.max(...arm.map((corner) => Math.abs(corner.x)))).toBeCloseTo(0.005);
	});
});

describe('shapeOutlines function', () => {
	it('should join capsules that continue one another into one outline at their radius', () => {
		const radius = 0.003;
		const shapes: TPieceShape[] = [
			{ kind: 'capsule', a: { x: 0, y: 0 }, b: { x: 0.1, y: 0 }, radius },
			{ kind: 'capsule', a: { x: 0.1, y: 0 }, b: { x: 0.2, y: -0.02 }, radius }
		];

		const outlines = shapeOutlines(shapes);

		expect(outlines).toHaveLength(1);
		// Every corner lies on the union of the two capsules' outlines, the bend's inside and outside within a hair
		for (const corner of outlines[0] ?? []) {
			const distance = Math.min(...shapes.map((shape) => shapeDistance(shape, corner.x, corner.y)));
			expect(Math.abs(distance)).toBeLessThan(1e-4);
		}
	});

	it('should keep a capsule that starts elsewhere or has another radius apart', () => {
		const outlines = shapeOutlines([
			{ kind: 'capsule', a: { x: 0, y: 0 }, b: { x: 0.1, y: 0 }, radius: 0.003 },
			{ kind: 'capsule', a: { x: 0.1, y: 0 }, b: { x: 0.2, y: 0 }, radius: 0.002 },
			{ kind: 'capsule', a: { x: 0.5, y: 0 }, b: { x: 0.6, y: 0 }, radius: 0.002 }
		]);

		expect(outlines).toHaveLength(3);
	});

	it('should outline a ball by its radius', () => {
		const shape: TPieceShape = { kind: 'ball', center: { x: 0.1, y: 0.2 }, radius: 0.01 };

		const [outline = []] = shapeOutlines([shape]);

		expect(outline.length).toBeGreaterThan(8);
		expectOnShape(outline, shape);
	});
});
