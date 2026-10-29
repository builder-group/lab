import { describe, expect, it } from 'vitest';
import { createWorldObject } from '../project/fixtures/sample-project';
import { getStrikePoint, getStrikePointPatch } from './object-editing';

describe('getStrikePointPatch function', () => {
	it('should move along a pitched key while preserving its contact height and sideways offset', () => {
		const object = createWorldObject('bar', [0, 0, 0]);
		object.rotation = [Math.PI / 2, 0, 0];
		object.size = [0.35, 0.045, 1.5];
		object.binding = { noteId: 'music', offset: [0.2, 0.3, 0.4] };
		const patch = getStrikePointPatch(object, 'tip');
		expect(patch?.binding?.noteId).toBe('music');
		expect(patch?.binding?.offset[0]).toBeCloseTo(0.2);
		expect(patch?.binding?.offset[1]).toBeCloseTo(0.675);
		expect(patch?.binding?.offset[2]).toBeCloseTo(0.4);
		expect(getStrikePoint({ ...object, ...patch })).toBe('tip');
	});

	it('should retain a silent anchor and use the long axis of a wide, rotated panel', () => {
		const object = createWorldObject('bar', [0, 0, 0]);
		object.rotation = [0, 0, Math.PI / 2];
		object.size = [2, 0.045, 0.8];
		object.trajectoryAnchor = { time: 3, offset: [0.1, 0.2, 0.3] };
		const patch = getStrikePointPatch(object, 'mount');
		expect(patch?.trajectoryAnchor?.time).toBe(3);
		expect(patch?.trajectoryAnchor?.offset[0]).toBeCloseTo(0.1);
		expect(patch?.trajectoryAnchor?.offset[1]).toBeCloseTo(0.9);
		expect(patch?.trajectoryAnchor?.offset[2]).toBeCloseTo(0.3);
		expect(getStrikePoint({ ...object, ...patch })).toBe('mount');
	});

	it('should leave world objects and locked instruments unchanged', () => {
		const object = createWorldObject('bar', [0, 0, 0]);
		expect(getStrikePointPatch(object, 'center')).toBeNull();
		object.binding = { noteId: 'music', offset: [0, 0, 0] };
		object.locked = true;
		expect(getStrikePointPatch(object, 'tip')).toBeNull();
	});
});
