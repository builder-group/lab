import { createWorldObject } from '../project/fixtures/sample-project';
import { describe, expect, it } from 'vitest';
import { type TPerformance, type TSceneObject } from '../project';
import { getVisualObjects } from './scene-objects';

describe('getVisualObjects function', () => {
	it('should show a world object edit immediately while its previous bake remains available', () => {
		const object = createWorldObject('bar', [1, 2, 3]);
		const performance = previousBake([structuredClone(object)]);
		object.position = [4, 5, 6];
		object.color = '#ff6080';
		expect(getVisualObjects([object], performance)[0]?.position).toEqual([4, 5, 6]);
		expect(getVisualObjects([object], performance)[0]?.color).toBe('#ff6080');
	});
	it('should apply a changed note offset to the previous physical anchor until the new bake finishes', () => {
		const object = createWorldObject('bar', [0, 0, 0]);
		object.binding = { noteId: 'note', offset: [0.1, 0.2, 0.3] };
		const performance = previousBake([{ ...structuredClone(object), position: [10, 20, 30] }]);
		object.binding.offset = [1.1, 2.2, 3.3];
		expect(getVisualObjects([object], performance)[0]?.position).toEqual([11, 22, 33]);
		expect(performance.objects[0]?.position).toEqual([10, 20, 30]);
	});
	it('should preview a time-anchor offset without converting a transition rail into a musical note', () => {
		const object = createWorldObject('rail', [0, 0, 0]);
		object.trajectoryAnchor = { time: 2, offset: [0.1, 0.2, 0.3] };
		const performance = previousBake([{ ...structuredClone(object), position: [10, 20, 30] }]);
		object.trajectoryAnchor.offset = [1.1, 2.2, 3.3];
		const result = getVisualObjects([object], performance)[0];
		expect(result?.position).toEqual([11, 22, 33]);
		expect(result?.binding).toBeNull();
	});
});

function previousBake(objects: TSceneObject[]): TPerformance {
	return {
		duration: 1,
		dt: 1 / 120,
		objects,
		samples: [],
		impacts: [],
		noteMarkers: [],
		warnings: [],
		bounds: { min: [0, 0, 0], max: [0, 0, 0] }
	};
}
