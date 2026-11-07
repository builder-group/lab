import { describe, expect, it } from 'vitest';
import { addLayerRows } from './add-layers';

const titles = (...args: Parameters<typeof addLayerRows>): string[] => addLayerRows(...args).map((row) => row.title);

describe('addLayerRows function', () => {
	it('should offer what each place holds, from one list', () => {
		expect(titles('track', 'layers')).toEqual(['Song…', 'Marble', 'Shot']);
		expect(titles('track', 'timeline')).toEqual(['Song…', 'Marble', 'Shot']);
		expect(titles('film', 'timeline')).toEqual(['Song…', 'Shot', 'Title']);
		expect(titles('film', 'layers')).toEqual(['Song…', 'Shot', 'Title', 'Light', 'Decor…']);
	});
});
