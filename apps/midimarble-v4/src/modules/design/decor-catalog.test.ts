import { describe, expect, it } from 'vitest';
import { packAddedNotice } from './concept-words';
import { addedPacks } from '@/modules/library';
import { DECOR_ITEMS, listedDecorItems } from './decor-catalog';

describe('Decor catalog', () => {
	it('should offer the Starter Pack from the start, whatever else is added', () => {
		addedPacks.set([]);
		expect(listedDecorItems().map((item) => item.label)).toEqual(['Red Bauble', 'Gold Bauble', 'Gold Snowflake', 'Fairy Light', 'Gift Box', 'Star', 'Handle', 'Subscribe', 'Particles']);
		expect(listedDecorItems().every((item) => item.origin === 'Starter')).toBe(true);
	});

	it('should mark the starter items', () => {
		expect(DECOR_ITEMS.filter((item) => item.origin === 'Starter').map((item) => item.label)).toEqual(['Red Bauble', 'Gold Bauble', 'Gold Snowflake', 'Fairy Light', 'Gift Box', 'Star', 'Handle', 'Subscribe', 'Particles']);
	});
});

describe('packAddedNotice function', () => {
	it('should say what came and that nothing changed', () => {
		expect(packAddedNotice('Christmas', { themes: 1, skins: 4, decor: 8 })).toBe('Christmas Pack added: 1 theme, 4 skins, 8 decor items. Nothing in your project changed.');
		expect(packAddedNotice('Starter Pack', { themes: 0, skins: 0, decor: 1 })).toBe('Starter Pack added: 1 decor item. Nothing in your project changed.');
	});
});
