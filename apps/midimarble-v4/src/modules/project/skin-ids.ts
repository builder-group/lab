import catalog from '../../../blender/mm_worker/skin_catalog.json';
import type { TProject, TProjectTheme, TSkinComponent } from './schema';

// Skin ids carry no theme: `platform:copper`, `rail:chrome`, `marble:glass`. Projects from before that read here, and a
// skin that left the catalog reads as the one that took its place.

const BUILT_IN_IDS = new Set(Object.values(catalog.elements).flatMap((element) => element.skins.map((skin) => skin.id)));

/** The theme-free id of a built-in skin: `brass:copper` reads `platform:copper`; library item IDs pass through */
export function canonicalSkinId(assetId: string): string {
	const { prefix, element, fallback, removed } = catalog.canonical;
	if (!assetId.startsWith(prefix)) return (removed as Record<string, string>)[assetId] ?? assetId;
	const id = `${element}:${assetId.slice(prefix.length)}`;
	return BUILT_IN_IDS.has(id) ? id : fallback;
}

/** A skin component with its `assetId` in today's form */
export function canonicalSkin(skin: TSkinComponent): TSkinComponent {
	return skin.assetId == null ? skin : { ...skin, assetId: canonicalSkinId(skin.assetId) };
}

/**
 * Brings an opened project's skins up to date, within `marble-project@4`: old skin ids take their theme-free form, and
 * Colour by Note, once a project option, becomes the theme's default for platforms. A project theme stores it; a built-in
 * theme is read-only, so the project gets a theme of its own, "Neon by Note", so its platforms and new ones look the same.
 */
export function migrateSkins(project: TProject): TProject {
	const entities = project.entities.map((entity) => {
		const skin = entity.components.skin;
		if (skin?.assetId == null || canonicalSkinId(skin.assetId) === skin.assetId) return entity;
		return { ...entity, components: { ...entity.components, skin: canonicalSkin(skin) } };
	});
	const design = canonicalThemeParts(project.design);
	if (design.themeOptions == null) return { ...project, entities, design };
	const { themeOptions, ...rest } = design;
	if (themeOptions.colorByNote !== true) return { ...project, entities, design: rest };
	const themes = design.themes ?? [];
	const applied = themes.find((theme) => theme.id === design.theme);
	if (applied != null) {
		return { ...project, entities, design: { ...rest, themes: themes.map((theme) => (theme === applied ? withNoteColour(theme) : theme)) } };
	}
	const base = design.theme in catalog.themes ? design.theme : 'pegboard';
	const name = `${base.charAt(0).toUpperCase()}${base.slice(1)} by Note`;
	const theme = withNoteColour({ id: `theme-${base}-by-note`, name, base, overrides: {} });
	return { ...project, entities, design: { ...rest, theme: theme.id, themes: [...themes, theme] } };
}

/** A project theme's parts name their skins in today's form; the same object when none changes */
function canonicalThemeParts(design: TProject['design']): TProject['design'] {
	const themes = design.themes?.map((theme) => {
		const parts = Object.entries(theme.parts ?? {});
		if (parts.every(([, part]) => part.skin == null || canonicalSkinId(part.skin) === part.skin)) return theme;
		return { ...theme, parts: Object.fromEntries(parts.map(([element, part]) => [element, part.skin != null ? { ...part, skin: canonicalSkinId(part.skin) } : part])) };
	});
	return themes != null && themes.some((theme, index) => theme !== design.themes?.[index]) ? { ...design, themes } : design;
}

function withNoteColour(theme: TProjectTheme): TProjectTheme {
	return { ...theme, parts: { ...theme.parts, platform: { ...theme.parts?.platform, colour: 'note' } } };
}
