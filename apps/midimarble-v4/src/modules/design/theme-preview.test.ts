import { describe, expect, it } from 'vitest';
import { themePreview, themeSwatches } from './theme-preview';

describe('themePreview function', () => {
	it('should draw the wall in the theme colour, not its base', () => {
		const preview = themePreview('pegboard', { wallColor: '#e8742c' }, ['#3a7bd5']);
		expect(preview.wall).toBe('#e8742c');
		// Pegboard keeps its peg holes on a recoloured wall
		expect(preview.holes).not.toBeNull();
		expect(preview.platforms).toHaveLength(3);
	});

	it('should glow only in Neon', () => {
		expect(themePreview('neon', { glowColor: '#ff00aa' }, []).glow).toBe('#ff00aa');
		expect(themePreview('brass', {}, []).glow).toBeNull();
	});

	it('should fall back to Pegboard for an unknown base', () => {
		expect(themePreview('sunset', {}, []).wall).toBe(themePreview('pegboard', {}, []).wall);
	});
});

describe('themeSwatches function', () => {
	it('should show the theme colours first and the base colours for the rest', () => {
		const swatches = themeSwatches('pegboard', { wallColor: '#e8742c' });
		expect(swatches[0]).toEqual({ label: 'Wall', color: '#e8742c' });
		expect(swatches.map((swatch) => swatch.label)).toContain('Light');
	});
});
