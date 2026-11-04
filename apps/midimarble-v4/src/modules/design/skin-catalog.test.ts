import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalSkinId, createProject, parseProject, serializeProject, type TProject, type TSkinComponent, type TThemeParts } from '@/modules/project';
import { catalogSkin, catalogSkins, entitySkinElement, resolveSkinLook, sharedSkinProperties, SKIN_ELEMENTS, skinElement, themeDefaultSkin, type TSkinElement } from './skin-catalog';

const cases = JSON.parse(readFileSync(new URL('../../../blender/tests/skin_look_cases.json', import.meta.url), 'utf8')) as {
	name: string;
	base: string;
	element: TSkinElement;
	parts?: TThemeParts;
	component?: TSkinComponent;
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
		expect(catalogSkins('platform').map((skin) => skin.label)).toEqual(['Gold', 'Copper', 'Silver', 'Pegboard', 'Neon']);
		expect(catalogSkins('marble').map((skin) => skin.label)).toEqual(['Glass', 'Metal', 'Magic']);
		expect(themeDefaultSkin('brass', 'rail')).toBe('rail:chrome');
		expect(skinElement('unknown')).toBe('platform');
	});

	it('should give Gift its Ribbon Colour as an extra property with the standard Colour choices', () => {
		const skin = catalogSkin('platform:gift');
		expect(skin?.properties.map((property) => [property.name, property.type])).toEqual([['Ribbon Colour', 'colour']]);
		expect(skin?.colours).toEqual(['skin', 'marble', 'note']);
		expect(catalogSkin('platform:gold')?.properties).toEqual([]);
	});

	it('should let any theme wear Gift, Candy and Green Glass, and register no Christmas theme', () => {
		expect(resolveSkinLook('brass', { platform: { skin: 'platform:gift' } }, 'platform').skin).toBe('platform:gift');
		expect(resolveSkinLook('neon', null, 'marble', { assetId: 'marble:glass-green', link: 'linked' }).variant).toBe('swirl');
		expect(themeDefaultSkin('christmas', 'platform')).toBe(themeDefaultSkin('pegboard', 'platform'));
	});

	it('should keep old skin ids loading in their theme-free form', () => {
		expect(canonicalSkinId('brass:device-copper')).toBe('platform:device-copper');
		expect(canonicalSkinId('brass:nope')).toBe('platform:gold');
		expect(canonicalSkinId('my-agent-skin')).toBe('my-agent-skin');
		expect(canonicalSkinId('marble:glass')).toBe('marble:glass');
		expect(canonicalSkinId('platform:books')).toBe('platform:gift');
	});

	it.each(cases)('should resolve like skin_catalog.py: $name', ({ base, element, parts, component, expected }) => {
		expect(resolveSkinLook(base, parts, element, component)).toMatchObject(expected);
	});

	it('should show only what a selection shares', () => {
		const look = (element: TSkinElement, component?: TSkinComponent) => ({ element, look: resolveSkinLook('brass', null, element, component) });
		const platforms = sharedSkinProperties([look('platform'), look('platform', { assetId: 'platform:device', link: 'linked' })]);
		expect(platforms.colours).toEqual(['skin', 'marble', 'note']);
		expect(platforms.onHit).toEqual(['none', 'press', 'wobble', 'glow']);
		expect(platforms.variants).toEqual([]);
		const mixed = sharedSkinProperties([look('platform'), look('rail')]);
		expect(mixed.colours).toEqual(['skin', 'marble']);
		expect(mixed.onHit).toEqual(['none', 'glow']);
		expect(mixed.glowColor).toBe(false);
		const devices = sharedSkinProperties([look('platform', { assetId: 'platform:device', link: 'linked' })]);
		expect(devices.variants.map((item) => item.label)).toEqual(['Gold', 'Copper', 'Silver', 'Dark']);
		expect(sharedSkinProperties([look('platform', { link: 'linked', onHit: 'glow' })]).glowColor).toBe(true);
		const marble = sharedSkinProperties([look('marble', { assetId: 'marble:magic', link: 'linked' })]);
		expect(marble.onHit).toEqual([]);
		expect(marble.glowColor).toBe(true);
		expect(marble.colours).toEqual(['marble', 'skin']);
	});
});

describe('skins on load', () => {
	function reload(project: TProject): TProject {
		const [isOk, error, parsed] = parseProject(serializeProject(project));
		if (!isOk) throw error;
		return parsed;
	}

	function withPlatform(project: TProject, assetId: string): TProject {
		return {
			...project,
			entities: [...project.entities, { id: 'old', components: { piece: { type: 'platform', params: {} }, transform: { position: { x: 0, y: 0 }, angle: 0 }, skin: { assetId, link: 'linked' } } }]
		};
	}

	it('should load old projects unchanged but for their skin ids', () => {
		const loaded = reload(withPlatform(createProject(), 'brass:copper'));
		expect(loaded.entities.find((entity) => entity.id === 'old')?.components.skin).toEqual({ assetId: 'platform:copper', link: 'linked' });
		const piece = loaded.entities.find((entity) => entity.id === 'old');
		expect(piece != null && entitySkinElement(piece)).toBe('platform');
	});

	it('should move Colour by Note into the theme: a project theme stores it', () => {
		const project = createProject();
		const loaded = reload({
			...project,
			design: { ...project.design, theme: 'mine', themes: [{ id: 'mine', name: 'Mine', base: 'neon', overrides: {} }], themeOptions: { colorByNote: true } }
		});
		expect(loaded.design.themeOptions).toBeUndefined();
		expect(loaded.design.theme).toBe('mine');
		expect(loaded.design.themes?.[0]?.parts).toEqual({ platform: { colour: 'note' } });
	});

	it('should move Colour by Note into a theme of its own on a built-in theme, and drop it when off', () => {
		const project = createProject();
		const loaded = reload({ ...project, design: { ...project.design, theme: 'neon', themeOptions: { colorByNote: true } } });
		expect(loaded.design.themeOptions).toBeUndefined();
		expect(loaded.design.themes?.[0]).toMatchObject({ name: 'Neon by Note', base: 'neon', parts: { platform: { colour: 'note' } } });
		expect(loaded.design.theme).toBe(loaded.design.themes?.[0]?.id);
		const off = reload({ ...project, design: { ...project.design, theme: 'neon', themeOptions: { colorByNote: false } } });
		expect(off.design).not.toHaveProperty('themeOptions');
		expect(off.design.theme).toBe('neon');
	});
});
