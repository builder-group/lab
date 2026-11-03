import { describe, expect, it } from 'vitest';
import { quickHelpRegions, regionsFor, splitShortcut } from './quick-help';

describe('splitShortcut function', () => {
	it('should take the shortcut out of a tooltip like a menu key equivalent', () => {
		expect(splitShortcut('Show Agent (⌘J)')).toEqual({ title: 'Show Agent', shortcut: '⌘J' });
		expect(splitShortcut('Play the song (Space)')).toEqual({ title: 'Play the song', shortcut: 'Space' });
	});

	it('should keep words in parentheses that are not a shortcut', () => {
		expect(splitShortcut('Melody (lead)')).toEqual({ title: 'Melody (lead)' });
	});
});

describe('regionsFor function', () => {
	it('should name the wall in Compose and the preview in Film', () => {
		expect(regionsFor('compose').find((region) => region.id === 'wall')?.title).toBe('Wall');
		expect(regionsFor('design').find((region) => region.id === 'wall')?.title).toBe('Preview');
	});

	it('should give every region one line without a period', () => {
		for (const region of quickHelpRegions) expect(region.line.endsWith('.')).toBe(false);
	});
});
