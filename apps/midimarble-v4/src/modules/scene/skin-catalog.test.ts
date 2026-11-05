import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { TSkin, TThemeParts } from '@/modules/project';
import { catalogSkin, catalogSkins, resolveSkinLook, sharedSkinProperties, SKIN_ELEMENTS, skinElement, themeDefaultSkin, type TSkinElement } from './skin-catalog';

const cases = JSON.parse(readFileSync(new URL('../../../blender/tests/skin_look_cases.json', import.meta.url), 'utf8')) as {
	name: string;
	base: string;
	element: TSkinElement;
	parts?: TThemeParts;
	component?: TSkin;
	expected: Record<string, unknown>;
}[];

describe('skin catalog', () => {
	it('should give every placeable element a set with a preview on disk that works in every theme', () => {
		for (const element of SKIN_ELEMENTS) {
			const skins = catalogSkins(element);
			expect(skins.length).toBeGreaterThanOrEqual(3);
			for (const skin of skins) {
				expect(existsSync(new URL(`../../../public${skin.previewUrl}`, import.meta.url)), skin.id).toBe(true);
				expect(skin.id.startsWith(`${element}:`)).toBe(true);
			}
		}
		expect(catalogSkins('platform').map((skin) => skin.label)).toEqual(['None', 'Gold', 'Copper', 'Silver', 'Gold Plate', 'Copper Plate', 'Wood Plate', 'Chrome Device', 'Dark Housing', 'Pegboard', 'Neon']);
		expect(catalogSkins('marble').map((skin) => skin.label)).toEqual(['None', 'Glass', 'Metal', 'Magic']);
		expect(themeDefaultSkin('brass', 'rail')).toBe('rail:chrome');
		expect(skinElement('unknown')).toBe('platform');
	});

	it('should give Gift its Ribbon Color as an extra property with the standard Color choices', () => {
		const skin = catalogSkin('platform:gift');
		expect(skin?.properties.map((property) => [property.name, property.type])).toEqual([['Ribbon Color', 'color']]);
		expect(skin?.colorSources).toEqual(['skin', 'marble', 'note']);
		expect(catalogSkin('platform:gold')?.properties).toEqual([]);
	});

	it('should let any theme wear Gift, Candy and Green Glass, and register no Christmas theme', () => {
		expect(resolveSkinLook('brass', { platform: { skin: 'platform:gift' } }, 'platform').skin).toBe('platform:gift');
		expect(resolveSkinLook('neon', null, 'marble', { assetId: 'marble:glass-green' }).variant).toBe('swirl');
		expect(themeDefaultSkin('christmas', 'platform')).toBe(themeDefaultSkin('pegboard', 'platform'));
	});

	it.each(cases)('should resolve like skin_catalog.py: $name', ({ base, element, parts, component, expected }) => {
		expect(resolveSkinLook(base, parts, element, component)).toMatchObject(expected);
	});

	it('should show only what a selection shares', () => {
		const look = (element: TSkinElement, component?: TSkin) => ({ element, look: resolveSkinLook('brass', null, element, component) });
		const platforms = sharedSkinProperties([look('platform'), look('platform', { assetId: 'platform:device' })]);
		expect(platforms.colorSources).toEqual(['skin', 'marble', 'note']);
		expect(platforms.onHit).toEqual(['none', 'press', 'wobble', 'glow']);
		expect(platforms.variants).toEqual([]);
		const mixed = sharedSkinProperties([look('platform'), look('rail')]);
		expect(mixed.colorSources).toEqual(['skin', 'marble']);
		expect(mixed.onHit).toEqual(['none', 'glow']);
		expect(mixed.glowColor).toBe(false);
		const devices = sharedSkinProperties([look('platform', { assetId: 'platform:device' })]);
		expect(devices.variants.map((item) => item.label)).toEqual(['Gold', 'Copper', 'Silver', 'Dark']);
		expect(sharedSkinProperties([look('platform', { onHit: 'glow' })]).glowColor).toBe(true);
		const marble = sharedSkinProperties([look('marble', { assetId: 'marble:magic' })]);
		expect(marble.onHit).toEqual([]);
		expect(marble.glowColor).toBe(true);
		expect(marble.colorSources).toEqual(['marble', 'skin']);
	});
});
