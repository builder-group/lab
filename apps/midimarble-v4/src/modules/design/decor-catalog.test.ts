import { describe, expect, it } from 'vitest';
import { packAddedNotice } from './concept-words';
import { addedPacks } from '@/modules/library';
import { DECOR_ITEMS, listedDecorItems, usedDecorSources } from './decor-catalog';

describe('Decor catalog', () => {
	it('should offer only Particles while no Pack is added', () => {
		addedPacks.set([]);
		expect(listedDecorItems().map((item) => item.label)).toEqual(['Particles']);
	});

	it('should keep offering the items a project has, with their origin', () => {
		const inUse = usedDecorSources({ decor: [{ source: 'decor:star' }, { source: 'decor:garland' }] as never });
		const listed = listedDecorItems(inUse);
		expect(listed.map((item) => item.label)).toEqual(['Star', 'Particles']);
		expect(listed[0]?.origin).toBe('Starter');
	});

	it('should offer what an added Pack brings', () => {
		addedPacks.set([{ builtInDecor: ['decor:star'] }] as never);
		expect(listedDecorItems().map((item) => item.label)).toEqual(['Star', 'Particles']);
		addedPacks.set([]);
	});

	it('should mark the starter items and hide Garland without dropping it', () => {
		expect(DECOR_ITEMS.filter((item) => item.origin === 'Starter').map((item) => item.label)).toEqual(['Red Bauble', 'Gold Bauble', 'Gold Snowflake', 'Fairy Light', 'Gift Box', 'Star', 'Handle', 'Subscribe']);
		expect(DECOR_ITEMS.find((item) => item.id === 'decor:garland')?.hidden).toBe(true);
	});
});

describe('packAddedNotice function', () => {
	it('should say what came and that nothing changed', () => {
		expect(packAddedNotice('Christmas', { themes: 1, skins: 4, decor: 8 })).toBe('Christmas Pack added: 1 theme, 4 skins, 8 decor items. Nothing in your project changed.');
		expect(packAddedNotice('Starter Pack', { themes: 0, skins: 0, decor: 1 })).toBe('Starter Pack added: 1 decor item. Nothing in your project changed.');
	});
});
