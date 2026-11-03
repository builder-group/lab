import { describe, expect, it } from 'vitest';
import { sliderToZoom, zoomToSlider } from './timeline-layout';

describe('zoom slider', () => {
	it('should map the zoom range to the ends of the slider', () => {
		expect(zoomToSlider(20)).toBe(0);
		expect(zoomToSlider(800)).toBe(1);
	});

	it('should map a slider position back to the same zoom', () => {
		expect(sliderToZoom(zoomToSlider(80))).toBeCloseTo(80);
	});
});
