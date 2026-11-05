import { describe, expect, it } from 'vitest';
import type { TResolvedPiece } from '@/modules/simulation';
import { pathMeshes, spots } from './path-meshes';

function rail(path: { x: number; y: number }[], overrides: Partial<TResolvedPiece> = {}): TResolvedPiece {
	return { entityId: 'r', type: 'rail', position: { x: 0, y: 0 }, angle: 0, params: { radius: 0.0025 }, shapes: [], path, ...overrides } as unknown as TResolvedPiece;
}

describe('pathMeshes function', () => {
	it('should put a rail at the depth the marble runs at, with posts back to the wall', () => {
		const { wires, posts, shell } = pathMeshes(rail([{ x: 0, y: 0 }, { x: 0.3, y: -0.1 }]), 0.04);
		wires?.computeBoundingBox();
		posts?.computeBoundingBox();
		expect(wires?.boundingBox?.min.z).toBeGreaterThan(0.03);
		expect(wires?.boundingBox?.max.z).toBeLessThan(0.05);
		expect(posts?.boundingBox?.min.z).toBeCloseTo(0);
		expect(shell).toBeNull();
	});

	it('should build a Bowl from each of its wires', () => {
		const { wires } = pathMeshes(rail([], { type: 'bowl', paths: [[{ x: 0, y: 0 }, { x: 0.1, y: 0 }], [{ x: 0, y: 0.1 }, { x: 0.1, y: 0.1 }]] }), 0.04);
		wires?.computeBoundingBox();
		expect(wires?.boundingBox?.max.y).toBeGreaterThan(0.09);
	});

	it('should leave out a path too short to have a direction', () => {
		expect(pathMeshes(rail([{ x: 0, y: 0 }]), 0.04).wires).toBeNull();
	});
});

describe('spots function', () => {
	it('should reach both ends of a line', () => {
		const points = spots([{ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 0.1, y: 0.1 }], 0.08);
		expect(points[0]).toEqual({ x: 0, y: 0 });
		expect(points.at(-1)?.y).toBeCloseTo(0.1);
	});
});
