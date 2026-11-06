import { describe, expect, it, vi } from 'vitest';
import { fittedHeight, HEADER_WIDTH, MIN_HEIGHT, playheadScroll, sliderToZoom, TIME_INSET, TIME_ORIGIN, zoomToSlider, tieSpans } from './timeline-layout';

describe('playheadScroll function', () => {
	const view = TIME_ORIGIN + 800;

	it('should stay put while the playhead shows past the Layers column', () => {
		expect(playheadScroll(0, 80, 0, view)).toBeNull();
		expect(playheadScroll(9, 80, 0, view)).toBeNull();
		expect(playheadScroll(12, 80, 400, view)).toBeNull();
	});

	it('should bring a playhead Go to Beginning left off the rows back to the start', () => {
		expect(playheadScroll(0, 80, 1360, view)).toBe(0);
	});

	it('should page to a playhead that runs off the right', () => {
		expect(playheadScroll(22, 80, 0, view)).toBe(22 * 80 - 24);
	});
});

describe('tieSpans function', () => {
	it('should give one stretch per song, ended by a hit of its own or of another song', () => {
		const spans = tieSpans([
			{ time: 3, songId: 'a' },
			{ time: 1, songId: 'a' },
			{ time: 4 },
			{ time: 5, songId: 'a' },
			{ time: 6, songId: 'b' },
			{ time: 7, songId: 'b' }
		]);

		expect(spans).toEqual([
			{ songId: 'a', from: 1, to: 3 },
			{ songId: 'a', from: 5, to: 5 },
			{ songId: 'b', from: 6, to: 7 }
		]);
	});

	it('should have nothing to draw for own hits', () => {
		expect(tieSpans([{ time: 1 }, { time: 2 }])).toEqual([]);
	});
});

describe('zoom slider', () => {
	it('should map the zoom range to the ends of the slider', () => {
		expect(zoomToSlider(20)).toBe(0);
		expect(zoomToSlider(800)).toBe(1);
	});

	it('should map a slider position back to the same zoom', () => {
		expect(sliderToZoom(zoomToSlider(80))).toBeCloseTo(80);
	});
});

describe('time origin', () => {
	it('should leave room for the whole playhead head at 0:00', () => {
		// The head is 13 px wide and centered on the time
		expect(TIME_INSET).toBeGreaterThanOrEqual(7);
		expect(TIME_ORIGIN).toBe(HEADER_WIDTH + TIME_INSET);
	});
});

describe('fittedHeight function', () => {
	it('should keep the transport and a row in a window that opens tiny or hidden', () => {
		vi.stubGlobal('window', { innerHeight: 2 });
		expect(fittedHeight(400)).toBe(MIN_HEIGHT);
		vi.unstubAllGlobals();
	});
});
