import { describe, expect, it } from 'vitest';
import { convexHull, selectionHull } from './draft-outline';

describe('draft outline', () => {
	it('should hull the corners at the wall and the front of a piece', () => {
		const back = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 2 }, { x: 0, y: 2 }];
		const front = back.map((point) => ({ x: point.x, y: point.y + 4 }));
		const hull = convexHull([...back, ...front]);
		expect(hull).toHaveLength(4);
		expect(hull).toEqual(expect.arrayContaining([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 0, y: 6 }]));
	});

	it('should move the outline out by the margin and skip points off screen', () => {
		const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: Number.NaN, y: 3 }];
		const outline = selectionHull(square, 3);
		expect(outline).toHaveLength(4);
		const xs = outline.map((point) => point.x);
		const ys = outline.map((point) => point.y);
		expect(Math.min(...xs)).toBeCloseTo(-3);
		expect(Math.max(...xs)).toBeCloseTo(13);
		expect(Math.min(...ys)).toBeCloseTo(-3);
		expect(Math.max(...ys)).toBeCloseTo(13);
	});
});
