import { createDemoProject } from '../project/fixtures/sample-project';
import { describe, expect, it } from 'vitest';

import type { TNote, TPerformance } from '../project/types';
import { createNoteMarkers } from './note-markers';

describe('createNoteMarkers function', () => {
	it('should hide notes beyond the verified simulation frontier', () => {
		const performance = createPerformance();
		const notes = [createNote(-1), createNote(0), createNote(0.5), createNote(1)];
		expect(createNoteMarkers(notes, performance, 0.5).map((marker) => marker.time)).toEqual([0, 0.5]);
		expect(createNoteMarkers(notes, performance, -1)).toEqual([]);
	});

	it('should use the linked marble and the nearest matching note contact', () => {
		const performance = createPerformance();
		const object = performance.objects[0];
		if (object == null) throw new Error('Expected a demo object');
		const note = createNote(0.5);
		object.binding = { noteId: note.id, offset: [0, 0, 0] };
		object.marbleId = 'harmony';
		performance.additionalMarbles = [{
			id: 'harmony',
			samples: [0, 1].map((time) => ({ time, position: [10 + time, 3, 0], rotation: [0, 0, 0, 1] }))
		}];
		performance.impacts = [0.2, 0.51, 0.7].map((time) => ({
			objectId: object.id, noteId: note.id, time, position: [0, 0, 0], strength: 1
		}));
		performance.impacts.push({
			objectId: object.id, noteId: 'other-note', time: 0.5, position: [0, 0, 0], strength: 1
		});
		expect(createNoteMarkers([note], performance)[0]).toMatchObject({
			objectId: object.id, position: [10.5, 3, 0], error: expect.closeTo(0.01, 8)
		});
	});

	it('should leave music-only notes unlinked when a matching object is disabled', () => {
		const performance = createPerformance();
		const object = performance.objects[0];
		if (object == null) throw new Error('Expected a demo object');
		const note = createNote(0.5);
		object.binding = { noteId: note.id, offset: [0, 0, 0] };
		object.disabled = true;
		expect(createNoteMarkers([note], performance)[0]).toMatchObject({
			objectId: null, error: null, position: [1, 4, 0]
		});
	});
});

function createNote(time: number): TNote {
	return { id: `note-${time}`, trackId: 'music', time, midi: 60, duration: 0.2, velocity: 0.8 };
}

function createPerformance(): TPerformance {
	return {
		duration: 1, dt: 1,
		samples: [0, 1].map((time) => ({ time, position: [time * 2, 4, 0], rotation: [0, 0, 0, 1] })),
		objects: createDemoProject().objects, impacts: [], noteMarkers: [], warnings: [],
		bounds: { min: [0, 0, 0], max: [2, 4, 0] }
	};
}
