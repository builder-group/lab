import { describe, expect, it } from 'vitest';
import { blenderState } from './blender-state';

describe('blenderState function', () => {
	it('should show a ready Blender in green with its version in the tooltip', () => {
		expect(blenderState('ready', '4.5.1 LTS')).toEqual({ tone: 'good', label: 'Blender', detail: 'Blender 4.5.1 is connected' });
	});

	it('should mark a missing Blender in red and work without a version', () => {
		expect(blenderState('missing', null)).toMatchObject({ tone: 'bad', label: 'No Blender' });
		expect(blenderState('rendering', null).detail).toBe('Blender: rendering the preview…');
	});
});
