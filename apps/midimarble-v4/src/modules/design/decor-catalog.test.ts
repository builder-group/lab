import { describe, expect, it } from 'vitest';
import type { TProject } from '@/modules/project';
import { defaultScatterSources } from './decor-actions';
import { DECOR_CATEGORIES, DECOR_ITEMS, themeDecorSet } from './decor-catalog';

describe('Decor catalog', () => {
	it('should sort every item into a category and leave none empty', () => {
		expect(DECOR_ITEMS.every((item) => DECOR_CATEGORIES.includes(item.category))).toBe(true);
		expect(DECOR_CATEGORIES.every((category) => DECOR_ITEMS.some((item) => item.category === category))).toBe(true);
	});
});

describe('defaultScatterSources function', () => {
	const project = (decorSet?: string[]): TProject => ({ design: { theme: 'theme-1', themes: [{ id: 'theme-1', base: 'brass', ...(decorSet != null ? { decorSet } : {}) }] } }) as unknown as TProject;

	it('should start from a project theme\'s own Decor set', () => {
		expect(defaultScatterSources(project(['decor:star']))).toEqual(['decor:star']);
	});

	it('should fall back to the base theme\'s set', () => {
		expect(defaultScatterSources(project())).toEqual([...themeDecorSet('brass')]);
	});

	it('should start empty for a theme with an empty set, so the panel asks for items', () => {
		expect(defaultScatterSources(project([]))).toEqual([]);
	});
});
