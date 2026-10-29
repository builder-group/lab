import { describe, expect, it } from 'vitest';
import type { TNote } from '../project';
import {
	clampTimelineTime,
	editTimelineNote,
	snapTimelineTime,
	timelineTickStep,
	timelineZoomAnchor
} from './timeline-editing';

describe('editTimelineNote function', () => {
	const note: TNote = {
		id: 'note',
		trackId: 'melody',
		midi: 60,
		time: 2,
		duration: 1,
		velocity: 0.8
	};
	const snap = { mode: 'frame' as const, fps: 30, bpm: 120 };

	it('should preserve duration when moving against the end of the project', () => {
		expect(editTimelineNote(note, 20, null, 10, snap)).toEqual({ time: 9, duration: 1 });
	});

	it('should preserve the end when trimming the start', () => {
		expect(editTimelineNote(note, 0.5, 'start', 10, snap)).toEqual({ time: 2.5, duration: 0.5 });
	});

	it('should prevent a trim from crossing the opposite edge', () => {
		const result = editTimelineNote(note, -20, 'end', 10, snap);
		expect(result.time).toBe(2);
		expect(result.duration).toBeCloseTo(1 / 30);
	});

	it('should allow precise unsnapped movement', () => {
		const result = editTimelineNote(note, 0.017, null, 10, { ...snap, mode: 'off' });
		expect(result.time).toBeCloseTo(2.017);
	});
});

describe('snapTimelineTime function', () => {
	it('should use musical subdivisions for the current tempo', () => {
		expect(snapTimelineTime(0.61, { mode: 'sixteenth', bpm: 120, fps: 30 })).toBe(0.625);
	});

	it('should use exact output frame intervals independently of tempo', () => {
		expect(snapTimelineTime(0.05, { mode: 'frame', bpm: 83, fps: 30 })).toBeCloseTo(2 / 30);
	});
});

describe('timelineZoomAnchor function', () => {
	it('should keep the time under the pointer fixed through a zoom', () => {
		const nextScroll = timelineZoomAnchor(200, 150, 50, 100);
		expect((200 + 150) / 50).toBe((nextScroll + 150) / 100);
	});
});

describe('timelineTickStep function', () => {
	it('should keep frame ruler ticks on whole frames at high zoom', () => {
		const step = timelineTickStep(400, 24, 'frames');
		expect(Number.isInteger(step)).toBe(true);
		expect((step * 400) / 24).toBeGreaterThanOrEqual(60);
	});
});

describe('clampTimelineTime function', () => {
	it('should seek to an output frame and stay inside the project range', () => {
		expect(clampTimelineTime(1.017, 10, 30)).toBeCloseTo(1 + 1 / 30);
		expect(clampTimelineTime(99, 10, 30)).toBe(10);
		expect(clampTimelineTime(-1, 10, 30)).toBe(0);
	});
});
