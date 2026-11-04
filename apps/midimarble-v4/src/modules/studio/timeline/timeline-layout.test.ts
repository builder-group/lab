import { describe, expect, it } from 'vitest';
import { HEADER_WIDTH, sliderToZoom, TIME_INSET, TIME_ORIGIN, zoomToSlider } from './timeline-layout';

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
		// The head is 13 px wide and centred on the time
		expect(TIME_INSET).toBeGreaterThanOrEqual(7);
		expect(TIME_ORIGIN).toBe(HEADER_WIDTH + TIME_INSET);
	});
});
