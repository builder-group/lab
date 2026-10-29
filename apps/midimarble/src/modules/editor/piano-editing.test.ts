import { describe, expect, it } from 'vitest';
import type { TNote } from '../project';
import {
	drawPianoNote,
	duplicatePianoNotes,
	editPianoVelocity,
	fitPianoPitchView,
	getPianoMarquee,
	getPianoPitchRange,
	isPianoBlackKey,
	movePianoNotes,
	pianoBeatTickStep,
	pianoPitchAtY,
	pianoPitchTop,
	pianoPitchZoomAnchor
} from './piano-editing';

describe('piano editing functions', () => {
	it('should align every semitone and keyboard row without compressing the pitch range', () => {
		const range = { minPitch: 48, maxPitch: 84 };
		for (const height of [4, 8, 14, 24])
			for (let pitch = 48; pitch <= 84; pitch++)
				expect(pianoPitchAtY(pianoPitchTop(pitch, range, height) + height / 2, range, height)).toBe(
					pitch
				);
		expect(pianoPitchTop(59, range, 14) - pianoPitchTop(60, range, 14)).toBe(14);
	});
	it('should keep extreme pitches and an empty keyboard within MIDI bounds', () => {
		expect(getPianoPitchRange([{ midi: 0 }, { midi: 127 }])).toEqual({
			minPitch: 0,
			maxPitch: 127
		});
		const low = getPianoPitchRange([{ midi: 0 }]);
		const high = getPianoPitchRange([{ midi: 127 }]);
		expect(low.minPitch).toBe(0);
		expect(high.maxPitch).toBe(127);
		expect(getPianoPitchRange([])).toEqual({ minPitch: 48, maxPitch: 72 });
	});
	it('should map black keys to chromatic rows and keep C and F white', () => {
		expect([60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71].filter(isPianoBlackKey)).toEqual([
			61, 63, 66, 68, 70
		]);
	});
	it('should draw in either direction with the same musical duration', () => {
		const snap = { mode: 'sixteenth' as const, fps: 30, bpm: 120 };
		expect(drawPianoNote(2, 2.51, 10, snap, 0.25)).toEqual({ time: 2, duration: 0.5 });
		expect(drawPianoNote(2.51, 2, 10, snap, 0.25)).toEqual({ time: 2, duration: 0.5 });
	});
	it('should clip a pencil drag at project boundaries and preserve click length', () => {
		const snap = { mode: 'off' as const, fps: 30, bpm: 120 };
		expect(drawPianoNote(2, -1, 10, snap, 0.25)).toEqual({ time: 0, duration: 2 });
		expect(drawPianoNote(3, 3, 10, snap, 0.5)).toEqual({ time: 3, duration: 0.5 });
		const end = drawPianoNote(9.8, 12, 10, snap, 0.5);
		expect(end.time + end.duration).toBeCloseTo(10);
	});
	it('should edit velocity in MIDI steps and clamp without making silent note-ons', () => {
		expect(editPianoVelocity(64 / 127, -50 / 127, 50)).toBe(65 / 127);
		expect(editPianoVelocity(0.8, -100, 50)).toBe(1);
		expect(editPianoVelocity(0.8, 100, 50)).toBe(1 / 127);
	});
	it('should keep musical ruler ticks on whole beats when tempo or zoom changes', () => {
		for (const bpm of [75, 90, 120, 163]) {
			for (const zoom of [24, 96, 300]) {
				const tick = pianoBeatTickStep(zoom, bpm);
				expect(tick / (60 / bpm)).toBeCloseTo(Math.round(tick / (60 / bpm)));
				expect(tick * zoom).toBeGreaterThanOrEqual(60);
			}
		}
	});

	describe('pitch view', () => {
		const range = { minPitch: 0, maxPitch: 127 };
		it('should fit a seventeen-note phrase spanning thirty semitones inside a short viewport', () => {
			const notes = Array.from({ length: 17 }, (_, index) => ({ midi: 53 + (index % 16) * 2 }));
			expect(notes).toHaveLength(17);
			expect(Math.min(...notes.map((note) => note.midi))).toBe(53);
			expect(Math.max(...notes.map((note) => note.midi))).toBe(83);
			const view = fitPianoPitchView(notes, range, 187);
			expect(view.rowHeight).toBe(5);
			for (const note of notes) {
				const top = pianoPitchTop(note.midi, range, view.rowHeight) + 1;
				expect(top).toBeGreaterThanOrEqual(view.scrollTop);
				expect(top + view.rowHeight - 2).toBeLessThanOrEqual(view.scrollTop + 187);
			}
		});
		it('should bound zoom and scrolling for narrow, full-range, and empty phrases', () => {
			expect(fitPianoPitchView([{ midi: 127 }], range, 187)).toEqual({
				rowHeight: 24,
				scrollTop: 0
			});
			const low = fitPianoPitchView([{ midi: 0 }], range, 187);
			expect(low).toEqual({ rowHeight: 24, scrollTop: 128 * 24 - 187 });
			const wide = fitPianoPitchView([{ midi: 0 }, { midi: 127 }], range, 187);
			expect(wide.rowHeight).toBe(4);
			expect(wide.scrollTop).toBeGreaterThanOrEqual(0);
			expect(wide.scrollTop).toBeLessThanOrEqual(128 * 4 - 187);
			expect(fitPianoPitchView([], range, 187).rowHeight).toBe(14);
		});
		it('should keep the pitch at the zoom anchor stable unless clamped at the top', () => {
			const next = pianoPitchZoomAnchor(500, 90, 14, 24);
			expect((next + 90) / 24).toBeCloseTo((500 + 90) / 14);
			expect(pianoPitchZoomAnchor(0, 90, 24, 8)).toBe(0);
		});
	});

	describe('marquee selection', () => {
		const range = { minPitch: 60, maxPitch: 64 };
		const notes: TNote[] = [
			{ id: 'short', trackId: 'track', midi: 60, time: 1, duration: 0.01, velocity: 0.8 },
			{ id: 'long', trackId: 'track', midi: 62, time: 2, duration: 2, velocity: 0.8 },
			{ id: 'white', trackId: 'track', midi: 64, time: 3, duration: 0.5, velocity: 0.8 },
			{ id: 'black', trackId: 'track', midi: 63, time: 3, duration: 0.5, velocity: 0.8 }
		];
		it('should find intersecting sustained notes in either drag direction even when their onsets are outside the box', () => {
			const start = { x: 250, y: 28 };
			const end = { x: 350, y: 44 };
			const forward = getPianoMarquee(notes, start, end, range, 14, 100);
			expect(forward).toEqual({ left: 250, top: 28, width: 100, height: 16, ids: ['long'] });
			expect(getPianoMarquee(notes, end, start, range, 14, 100)).toEqual(forward);
		});
		it('should select the visible minimum width of a short note', () => {
			expect(
				getPianoMarquee(notes, { x: 105, y: 60 }, { x: 107, y: 65 }, range, 14, 100).ids
			).toEqual(['short']);
		});
		it('should respect chromatic pitch rows and leave gaps between note rectangles unselected', () => {
			expect(
				getPianoMarquee(notes, { x: 305, y: 16 }, { x: 310, y: 20 }, range, 14, 100).ids
			).toEqual(['black']);
			expect(
				getPianoMarquee(notes, { x: 305, y: 13.5 }, { x: 310, y: 14.5 }, range, 14, 100).ids
			).toEqual([]);
		});
		it('should hit the same chromatic note after pitch rows are zoomed', () => {
			for (const height of [4, 8, 24]) {
				const top = pianoPitchTop(63, range, height) + 2;
				expect(
					getPianoMarquee(
						notes,
						{ x: 305, y: top },
						{ x: 310, y: top + Math.max(1, height - 4) },
						range,
						height,
						100
					).ids
				).toEqual(['black']);
			}
		});
	});

	describe('moving a selected phrase', () => {
		const notes: TNote[] = [
			{ id: 'first', trackId: 'track', midi: 3, time: 1.03, duration: 0.5, velocity: 0.8 },
			{ id: 'second', trackId: 'track', midi: 122, time: 2.17, duration: 1, velocity: 0.7 }
		];
		const snap = { mode: 'sixteenth' as const, fps: 30, bpm: 120 };

		it('should snap the dragged anchor while preserving every timing offset and duration', () => {
			const updates = movePianoNotes(notes, 0.6, 0, 10, snap, 'second');
			expect(updates[1]?.patch.time).toBe(2.75);
			expect((updates[1]?.patch.time ?? 0) - (updates[0]?.patch.time ?? 0)).toBeCloseTo(1.14);
			expect(updates.map(({ patch }) => patch.duration)).toEqual([0.5, 1]);
		});
		it('should jointly clamp time at both score boundaries without compressing a phrase', () => {
			const early = movePianoNotes(notes, -100, 0, 10, snap);
			const late = movePianoNotes(notes, 100, 0, 10, snap);
			expect(early[0]?.patch.time).toBe(0);
			expect(early[1]?.patch.time).toBeCloseTo(1.14);
			expect(late[1]?.patch.time).toBe(9);
			expect(late[0]?.patch.time).toBeCloseTo(7.86);
		});
		it('should transpose by a shared bounded interval and leave off-grid times unchanged', () => {
			const high = movePianoNotes(notes, 0, 12, 10, snap);
			const low = movePianoNotes(notes, 0, -12, 10, snap);
			expect(high.map(({ patch }) => patch.midi)).toEqual([8, 127]);
			expect(low.map(({ patch }) => patch.midi)).toEqual([0, 119]);
			expect(high.map(({ patch }) => patch.time)).toEqual([1.03, 2.17]);
		});
		it('should preserve precise timing when snapping is disabled and accept an empty selection', () => {
			const updates = movePianoNotes(notes, 0.017, 0, 10, { ...snap, mode: 'off' });
			expect(updates[0]?.patch.time).toBeCloseTo(1.047);
			expect(updates[1]?.patch.time).toBeCloseTo(2.187);
			expect(movePianoNotes([], 1, 12, 10, snap)).toEqual([]);
		});
		it('should duplicate after the phrase on the next grid boundary and preserve internal offsets', () => {
			const copies = duplicatePianoNotes(notes, snap);
			expect(copies[0]?.time).toBeCloseTo(3.25);
			expect(copies[1]?.time).toBeCloseTo(4.39);
			expect(copies.map((note) => note.duration)).toEqual([0.5, 1]);
			expect(copies.map((note) => note.midi)).toEqual([3, 122]);
			expect(new Set([...notes, ...copies].map((note) => note.id)).size).toBe(4);
			expect(notes.map((note) => note.time)).toEqual([1.03, 2.17]);
		});
		it('should copy directly after an aligned or unsnapped phrase without clamping over originals', () => {
			const aligned: TNote[] = [
				{ id: 'aligned', trackId: 'track', midi: 60, time: 9, duration: 1, velocity: 0.8 }
			];
			expect(duplicatePianoNotes(aligned, snap)[0]?.time).toBe(10);
			expect(duplicatePianoNotes(notes, { ...snap, mode: 'off' })[0]?.time).toBeCloseTo(3.17);
			expect(duplicatePianoNotes([], snap)).toEqual([]);
		});
	});
});
