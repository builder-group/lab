import { describe, expect, it } from 'vitest';
import { buildSceneDescription } from './scene-builder';
import { createProject, type TPackOrigin, type TPackTheme, type TPiece, type TProject } from '@/modules/project';
import { createStaircaseProject } from '@/modules/simulation/fixture-projects';
import { draftPieceColors, draftWall } from './draft-look';
import { baseThemeOf, currentLookTheme, packThemeCommands, resolveTheme, sceneThemeOverrides, sceneThemeParts, themeCommands, themeDefaultColor, themeOrigin } from './project-themes';
import { sceneLayers } from './scene-layers';
import { apply } from '@/modules/project/test-helpers';

const ORIGIN: TPackOrigin = { packId: 'christmas', packName: 'Christmas', version: '1.0' };
const GOLDEN: TPackTheme = { id: 'theme-golden', name: 'Golden', base: 'neon', glowColor: '#00ff88', parts: { platform: { skin: 'platform:copper' } }, wall: { color: '#f7f5f0', backgroundColor: '#112233', kind: 'plain' }, lights: { key: { color: '#ff8800', strength: 7 }, added: [{ id: 'light-1', name: 'Fill', color: '#ffffff', strength: 2, side: 0.5, height: 0.3 }] } };

function withTheme(base: string): TProject {
	const project = createStaircaseProject();
	return { ...project, film: { ...project.film, theme: { base } } };
}

describe('resolveTheme function', () => {
	it("should name a built-in by its base and a Pack's theme by its own name", () => {
		const project = withTheme('neon');
		expect(resolveTheme(project.film)).toMatchObject({ id: 'neon', name: 'Neon', base: 'neon' });
		const worn = apply(project, packThemeCommands(project, GOLDEN, ORIGIN));
		expect(resolveTheme(worn.film)).toMatchObject({ id: 'theme-golden', name: 'Golden', base: 'neon', glowColor: '#00ff88' });
		expect(themeOrigin(resolveTheme(worn.film), () => true)).toBe('Christmas Pack');
		expect(themeOrigin(resolveTheme(worn.film), () => false)).toBe('Christmas Pack · Not Added');
		expect(themeOrigin(resolveTheme(project.film), () => true)).toBe('Starter');
	});

	it('should draw an unknown base as Pegboard, as in Blender', () => {
		expect(resolveTheme({ theme: { base: 'chalk' } })).toMatchObject({ name: 'Pegboard', base: 'pegboard' });
		expect(baseThemeOf({ theme: { base: 'chalk' } })).toBe('pegboard');
	});

	it("should give each color its base's own while it is not set", () => {
		expect(themeDefaultColor('brass', 'wallColor')).toBe('#a79ebc');
		expect(themeDefaultColor('neon', 'lightColor')).toBe('#eff6ff');
		expect(themeDefaultColor('neon', 'glowColor')).toBeNull();
	});
});

describe('theme commands', () => {
	it("should write a Pack's look to the film's theme, Wall and Lights", () => {
		const project = apply(withTheme('brass'), [{ type: 'updateFilm', film: { wall: { color: '#101010', labelColor: '#2f6f8f' }, lights: { key: { strength: 1 }, added: [] } } }]);
		const worn = apply(project, packThemeCommands(project, GOLDEN, ORIGIN));
		expect(worn.film.theme).toEqual({ base: 'neon', parts: GOLDEN.parts, glowColor: '#00ff88', pack: { ...ORIGIN, themeId: 'theme-golden', themeName: 'Golden' } });
		expect(worn.film.wall).toEqual({ labelColor: '#2f6f8f', color: '#f7f5f0', backgroundColor: '#112233', kind: 'plain' });
		expect(worn.film.lights).toEqual(GOLDEN.lights);
	});

	it("should take a Pack's look along when the film leaves its theme, and keep the Wall's label color", () => {
		const project = withTheme('brass');
		const worn = apply(project, packThemeCommands(project, { ...GOLDEN, wall: { color: '#f7f5f0' } }, ORIGIN));
		const labeled = apply(worn, [{ type: 'updateFilm', film: { wall: { ...worn.film.wall, labelColor: '#2f6f8f' } } }]);
		const left = apply(labeled, themeCommands(labeled, 'brass'));
		expect(left.film.theme).toEqual({ base: 'brass' });
		expect(left.film.wall).toEqual({ labelColor: '#2f6f8f' });
		expect(left.film.lights).toEqual({ added: [] });
	});

	it('should keep Wall and Lights values between built-in themes', () => {
		const project = apply(withTheme('brass'), [{ type: 'updateFilm', film: { wall: { color: '#336699' } } }]);
		const next = apply(project, themeCommands(project, 'neon'));
		expect(next.film.wall.color).toBe('#336699');
		expect(themeCommands(next, 'neon')).toEqual([]);
	});

	it('should clear parts of its own when a built-in is chosen again', () => {
		const project = withTheme('neon');
		const parted = apply(project, [{ type: 'updateFilm', film: { theme: { base: 'neon', parts: { rail: { skin: 'rail:candy' } } } } }]);
		expect(apply(parted, themeCommands(parted, 'neon')).film.theme).toEqual({ base: 'neon' });
	});

	it("should recolor titles still in the old wall's title color", () => {
		const project = withTheme('pegboard');
		const title = { id: 'text-1', text: 'Hi', font: 'Bfont Regular', size: 0.03, color: '#ffffff', position: { x: 0, y: 0 }, angle: 0 };
		const withTitle = { ...project, film: { ...project.film, titles: [title] } };
		const onLight = apply(withTitle, packThemeCommands(withTitle, { id: 'theme-light', name: 'Light', base: 'brass', wall: { color: '#f7f5f0' } }, ORIGIN));
		expect(onLight.film.titles.find((item) => item.id === 'text-1')?.color).toBe('#1f3a5f');
		const back = apply(onLight, themeCommands(onLight, 'pegboard'));
		expect(back.film.titles.find((item) => item.id === 'text-1')?.color).toBe('#ffffff');
	});
});

describe('the look in Blender and the Draft Preview', () => {
	it('should send the base and the colors in the scene description', () => {
		const themed = withTheme('neon');
		const result = { revision: themed.revision, duration: 1, marbles: [], pieces: [], hits: [] } as never;
		expect(buildSceneDescription(themed, result, { fps: 30 }).description).not.toHaveProperty('themeOverrides');
		const colored = apply(themed, [{ type: 'updateFilm', film: { theme: { base: 'neon', glowColor: '#00FF88' }, wall: { color: '#112233' } } }]);
		const description = buildSceneDescription(colored, result, { fps: 30 }).description;
		expect(description.theme).toBe('neon');
		expect(description.themeOverrides).toEqual({ wallColor: '#112233', glowColor: '#00ff88' });
		expect(sceneThemeOverrides(withTheme('brass').film)).toBeUndefined();
	});

	it("should send a Pack's look as the scene's colors, Wall skin, Key Light and lights", () => {
		const project = withTheme('brass');
		const { film } = apply(project, packThemeCommands(project, GOLDEN, ORIGIN));
		expect(sceneThemeOverrides(film)).toEqual({ wallColor: '#f7f5f0', lightColor: '#ff8800', glowColor: '#00ff88', backgroundColor: '#112233' });
		expect(sceneLayers(film)).toEqual({ wallKind: 'plain', keyLight: { strength: 7 }, lights: GOLDEN.lights?.added });
	});

	it('should draw a wall color and glow in the Draft Preview', () => {
		expect(draftWall('neon', { wallColor: '#112233' }).color).toBe('#112233');
		expect(draftWall('pegboard', { wallColor: '#336699' })).toMatchObject({ color: '#336699', holes: expect.any(String) });
		expect(draftWall('brass').color).toBe('#888296');
		const piece = { type: 'platform', color: '#d94f4f', skin: null };
		expect(draftPieceColors('neon', piece, { glowColor: '#00ff88' }).bar).toBe('#00ff88');
		expect(draftPieceColors('neon', piece).bar).not.toBe('#00ff88');
	});
});

describe('Theme parts', () => {
	it('should resolve a theme of parts on top of its base', () => {
		expect(resolveTheme({ theme: { base: 'brass' } }).parts.platform.skin).toBe('platform:gold');
		expect(resolveTheme({ theme: { base: 'neon' } }).parts.marble.skin).toBe('marble:contrast');
		const parts = { platform: { skin: 'platform:copper' }, marble: { skin: 'marble:glass' } };
		const resolved = resolveTheme({ theme: { base: 'neon', parts } });
		expect(resolved.parts.platform.skin).toBe('platform:copper');
		expect(resolved.parts.rail.skin).toBe('rail:glow');
		expect(resolved.parts.marble.skin).toBe('marble:glass');
		expect(sceneThemeParts({ theme: { base: 'neon', parts } })).toEqual(parts);
		expect(sceneThemeParts({ theme: { base: 'neon' } })).toBeUndefined();
	});

	it('should keep the current look as a theme: the look most of a type wear becomes its part', () => {
		const base = createProject();
		const platform = (id: string, assetId?: string): TPiece => ({ id, type: 'platform', params: {}, angle: 0, place: { kind: 'free', position: { x: 0, y: 0 } }, ...(assetId != null ? { skin: { assetId } } : {}) });
		const project = { ...base, film: { ...base.film, theme: { base: 'brass' } }, track: { ...base.track, pieces: [...base.track.pieces, platform('a', 'platform:copper'), platform('b', 'platform:copper'), platform('c', 'platform:key'), platform('d', 'library-skin')] } };
		const theme = currentLookTheme(project, 'Mine');
		expect(theme).toMatchObject({ name: 'Mine', base: 'brass', parts: { platform: { skin: 'platform:copper' } } });
		expect(theme.id).not.toBe('brass');
	});

	it("should keep the project's Wall and Lights in that theme, the Wall's None as plain Pegboard in its color, and leave the label color out", () => {
		const project = withTheme('brass');
		const light = { id: 'light-1', name: 'Fill', color: '#ffffff', strength: 2, side: 0.5, height: 0.3 };
		const look = apply(project, [{ type: 'updateFilm', film: { wall: { kind: 'none', labelColor: '#2f6f8f', backgroundColor: '#112233' }, lights: { key: { color: '#ff8800', exposure: 0.25 }, added: [light] } } }]);
		const theme = currentLookTheme(look, 'Mine');
		expect(theme.wall).toEqual({ color: '#2f6f8f', backgroundColor: '#112233', kind: 'pegboard' });
		expect(theme.lights).toEqual({ key: { color: '#ff8800', exposure: 0.25 }, added: [light] });
		// Worn again it looks the same
		const before = { colors: sceneThemeOverrides(look.film), layers: sceneLayers(look.film) };
		const worn = apply(project, packThemeCommands(project, theme, ORIGIN));
		expect({ colors: sceneThemeOverrides(worn.film), layers: sceneLayers(worn.film) }).toEqual(before);
	});
});
