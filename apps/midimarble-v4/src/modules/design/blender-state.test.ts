import { describe, expect, it } from 'vitest';
import { blenderState } from './blender-state';

describe('blenderState function', () => {
	it('should show a ready Blender in its orange with its version in the tooltip', () => {
		expect(blenderState('ready', '4.5.1 LTS')).toEqual({ tone: 'ready', label: 'Ready', detail: 'Blender 4.5.1 is connected' });
		expect(blenderState('idle', '4.5.1')).toMatchObject({ tone: 'ready', label: 'Ready' });
	});

	it('should mark a missing Blender in grey and work without a version', () => {
		expect(blenderState('missing', null)).toMatchObject({ tone: 'idle', label: 'Not Installed' });
		expect(blenderState('rendering', null)).toMatchObject({ label: 'Rendering Preview', detail: 'Blender: rendering the preview…' });
	});

	it('should show the browser state as a hollow dot rather than a problem', () => {
		expect(blenderState('unavailable', null)).toMatchObject({ tone: 'off', detail: 'Blender connects in the desktop app' });
	});

	it('should put the error message in the tooltip', () => {
		expect(blenderState('error', '4.5.1', 'Worker stopped')).toMatchObject({ label: 'Error', detail: 'Blender 4.5.1 reported a problem: Worker stopped' });
	});

	it('should show the background preview render while the worker is free', () => {
		expect(blenderState('ready', '4.5.1', null, true)).toMatchObject({ tone: 'busy', label: 'Rendering Preview', detail: 'Blender 4.5.1: rendering the preview in the background…' });
		expect(blenderState('error', '4.5.1', 'Worker stopped', true)).toMatchObject({ label: 'Error' });
	});
});
