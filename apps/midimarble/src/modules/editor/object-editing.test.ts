import { describe, expect, it } from 'vitest';
import { createWorldObject } from '../project/fixtures/sample-project';
import { getObjectMovePatch, getObjectSizePatch } from './object-editing';

describe('getObjectMovePatch function', () => {
	it('should replace the visible offset across repeated drags before a bake finishes', () => {
		const baked = {
			...createWorldObject('bar', [10, 20, 30]),
			binding: { noteId: 'note', offset: [1, 2, 3] as [number, number, number] }
		};
		const first = getObjectMovePatch(baked, baked, [11, 20, 30]);
		const current = { ...baked, ...first };
		expect(getObjectMovePatch(current, baked, [12, 20, 30])?.binding?.offset).toEqual([3, 2, 3]);
	});
	it('should use a fresh offset when an object has been relinked to another note', () => {
		const baked = {
			...createWorldObject('bar', [10, 20, 30]),
			binding: { noteId: 'old', offset: [5, 0, 0] as [number, number, number] }
		};
		const current = {
			...baked,
			binding: { noteId: 'new', offset: [0, 0, 0] as [number, number, number] }
		};
		expect(getObjectMovePatch(current, baked, [11, 20, 30])?.binding?.offset).toEqual([1, 0, 0]);
	});
	it('should retain time-anchor offsets across repeated drags without accumulating the last edit', () => {
		const baked = {
			...createWorldObject('rail', [10, 20, 0.4]),
			trajectoryAnchor: { time: 3, offset: [1, 2, 0] as [number, number, number] }
		};
		const first = getObjectMovePatch(baked, baked, [11, 20, 0.4]);
		const current = { ...baked, ...first };
		expect(getObjectMovePatch(current, baked, [12, 20, 0.4])?.trajectoryAnchor).toEqual({
			time: 3,
			offset: [3, 2, 0]
		});
		const changed = {
			...current,
			trajectoryAnchor: { time: 4, offset: [0, 0, 0] as [number, number, number] }
		};
		expect(getObjectMovePatch(changed, baked, [12, 20, 0.4])?.trajectoryAnchor).toEqual({
			time: 4,
			offset: [2, 0, 0]
		});
	});
	it('should move a world object directly and keep locks intact', () => {
		const object = createWorldObject('bar', [0, 0, 0]);
		expect(getObjectMovePatch(object, undefined, [3, 4, 5])).toEqual({ position: [3, 4, 5] });
		expect(getObjectMovePatch({ ...object, locked: true }, undefined, [3, 4, 5])).toBeNull();
	});
	it('should wait for the first resolved anchor before moving a linked object', () => {
		const object = {
			...createWorldObject('bar', [0, 0, 0]),
			binding: { noteId: 'note', offset: [0, 0, 0] as [number, number, number] }
		};
		expect(getObjectMovePatch(object, undefined, [3, 4, 5])).toBeNull();
	});
	it('should change physical rail length without changing the wire gap or vertical curve', () => {
		const object = {
			...createWorldObject('rail', [0, 0, 0]),
			size: [2, 0.045, 0.34] as [number, number, number],
			path: [
				[0, 0, 0],
				[2, -0.4, 0]
			] as [number, number, number][]
		};
		expect(getObjectSizePatch(object, [4, 0.045, 0.34]).path).toEqual([
			[0, 0, 0],
			[4, -0.4, 0]
		]);
		expect(getObjectSizePatch(object, [2, 0.05, 0.4]).path).toBeUndefined();
	});
});
