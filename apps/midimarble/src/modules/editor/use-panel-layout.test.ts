import { describe, expect, it } from 'vitest';
import { parsePanelLayout } from './use-panel-layout';

describe('parsePanelLayout function', () => {
	it('should restore finite sizes for recognized panels only', () => {
		expect(parsePanelLayout('{"outliner":250,"properties":300,"timeline":400,"unknown":200}'))
			.toEqual({ outliner: 250, properties: 300, timeline: 400 });
	});
	it('should clamp saved sizes to the allowed panel bounds', () => {
		expect(parsePanelLayout('{"outliner":-100,"properties":9999,"timeline":0,"piano":9999}'))
			.toEqual({ outliner: 145, properties: 440, timeline: 145, piano: 650 });
	});
	it('should roundtrip separate timeline and focused piano sizes', () => {
		const preferences = { timeline: 170, piano: 380 };
		expect(parsePanelLayout(JSON.stringify(preferences))).toEqual(preferences);
	});
	it('should ignore nonnumeric and nonfinite sizes while keeping valid preferences', () => {
		expect(parsePanelLayout('{"outliner":"250","properties":1e999,"timeline":250}'))
			.toEqual({ timeline: 250 });
	});
	it('should use CSS defaults for missing, malformed, or nonobject storage', () => {
		for (const saved of [null, '', 'NaN', 'null', '[]', '300', '{'])
			expect(parsePanelLayout(saved)).toEqual({});
	});
});
