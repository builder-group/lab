import { describe, expect, it } from 'vitest';
import type { TImpact, TNoteMarker } from '../project';
import { classifyTimelineContact } from './timeline-contacts';

describe('classifyTimelineContact function', () => {
	const impact: TImpact = {
		objectId: 'spoon',
		noteId: 'note',
		time: 1,
		position: [0, 0, 0],
		strength: 1
	};
	const marker: TNoteMarker = {
		noteId: 'note',
		objectId: 'spoon',
		time: 1,
		position: [0, 0, 0],
		error: 0
	};
	it('should match an assigned late hit by object and measured error rather than by note time', () => {
		const late = { ...impact, time: 1.217 };
		const lateMarker = { ...marker, error: 0.217 };
		expect(classifyTimelineContact(late, 1, lateMarker)).toBe('primary');
		expect(classifyTimelineContact({ ...late, objectId: 'other' }, 1, lateMarker)).toBe('extra');
		expect(classifyTimelineContact(late, 1, { ...lateMarker, noteId: 'other' })).toBe('extra');
	});
	it('should classify a later bounce as a recontact and an earlier unassigned hit as extra', () => {
		expect(classifyTimelineContact(impact, 1, marker)).toBe('primary');
		expect(classifyTimelineContact({ ...impact, time: 1.217 }, 1, marker)).toBe('recontact');
		expect(classifyTimelineContact({ ...impact, time: 0.9 }, 1, marker)).toBe('extra');
	});
	it('should preserve world contacts and treat missing assigned hits as extra physical contacts', () => {
		expect(classifyTimelineContact({ ...impact, noteId: null }, undefined, undefined)).toBe(
			'world'
		);
		expect(classifyTimelineContact(impact, 1, { ...marker, error: null })).toBe('extra');
	});
});
