import { describe, expect, it } from 'vitest';
import type { TImpact, TNoteMarker } from '../project';
import { summarizeTimelineContacts } from './timeline-contacts';

describe('summarizeTimelineContacts function', () => {
	it('should report additional bounces even when the assigned note contact is aligned', () => {
		const marker: TNoteMarker = {
			noteId: 'note', objectId: 'key', time: 1, error: 0.004, position: [0, 0, 0]
		};
		const impacts: TImpact[] = [0.8, 1.004, 1.2].map((time) => ({
			noteId: 'note', objectId: 'key', time, position: [0, 0, 0], strength: 1
		}));
		expect(summarizeTimelineContacts({ noteMarkers: [marker], impacts })).toEqual({
			linked: 1, aligned: 1, unlinked: 0, recontacts: 1, extra: 1
		});
	});

	it('should keep music-only notes and silent world contacts out of contact alignment', () => {
		const noteMarkers: TNoteMarker[] = [{
			noteId: 'music-only', objectId: null, time: 1, error: null, position: [0, 0, 0]
		}];
		const impacts: TImpact[] = [{
			noteId: null, objectId: 'wire', time: 1, position: [0, 0, 0], strength: 1
		}];
		expect(summarizeTimelineContacts({ noteMarkers, impacts })).toEqual({
			linked: 0, aligned: 0, unlinked: 1, recontacts: 0, extra: 0
		});
	});
});
