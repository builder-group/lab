import { describe, expect, it, vi } from 'vitest';
import { fittedHeight, HEADER_WIDTH, MIN_HEIGHT, sliderToZoom, TIME_INSET, TIME_ORIGIN, zoomToSlider } from './timeline-layout';

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
