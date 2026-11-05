import { describe, expect, it } from 'vitest';
import { applyProjectCommands, createHistory, parseProject, pushHistory, serializeProject, undoHistory, type TProject, type TProjectCommand } from '@/modules/project';
import { createStaircaseProject } from '@/modules/simulation/fixture-projects';
import { draftWall } from './draft-look';
import { appliedOverrides, duplicateThemeCommands, hasLayerChanges, resolveTheme, sceneThemeOverrides, themeCommands } from './project-themes';
import { addedLights, addLightCommands, deleteLightsCommands, keyLightCommands, keyLightLayer, lightPlacement, resetKeyLightCommands, sceneLayers, updateLightCommands, wallCommands, wallKindOverride, wallLayer } from './scene-layers';
import { apply } from '@/modules/project/test-helpers';

function withTheme(theme: string): TProject {
	const project = createStaircaseProject();
	return { ...project, film: { ...project.film, theme } };
}

describe('wall layer', () => {
	it('should show plain Pegboard in its color under the skin None, whatever the theme, and leave it out of a theme\'s changes', () => {
		const project = createStaircaseProject();
		const brass = apply(project, themeCommands(project, 'brass'));
		const colored = apply(brass, [{ type: 'updateFilm', film: { wall: { labelColor: '#2f6f8f' } } }]);
		// Under any other skin the theme's wall stays
		expect(appliedOverrides(colored.film).wallColor).toBeUndefined();
		expect(hasLayerChanges(colored.film)).toBe(false);

		const none = apply(colored, wallCommands(colored, { kind: 'none' }));
		expect(appliedOverrides(none.film).wallColor).toBe('#2f6f8f');
		expect(sceneLayers(none.film).wallKind).toBe('pegboard');
		expect(wallLayer(none.film)).toMatchObject({ kind: 'none', color: '#2f6f8f' });
	});

	it('should override a built-in theme per project and return to the theme on reset', () => {
		const project = withTheme('brass');
		expect(wallLayer(project.film)).toMatchObject({ color: '#a79ebc', kind: 'plaster', own: {} });

		const colored = apply(project, wallCommands(project, { color: '#336699', backgroundColor: '#112233', kind: 'grid' }));
		expect(wallLayer(colored.film)).toMatchObject({ color: '#336699', backgroundColor: '#112233', kind: 'grid' });
		expect(sceneThemeOverrides(colored.film)).toEqual({ wallColor: '#336699', backgroundColor: '#112233' });
		expect(sceneLayers(colored.film)).toEqual({ wallKind: 'grid' });
		expect(draftWall('brass', appliedOverrides(colored.film), wallKindOverride(colored.film))).toEqual({ color: '#336699', holes: null });

		const reset = apply(colored, wallCommands(colored, { color: null, backgroundColor: null, kind: null }));
		expect(reset.film.wall).toEqual({});
		expect(sceneThemeOverrides(reset.film)).toBeUndefined();
		expect(sceneLayers(reset.film)).toEqual({});
	});

	it('should put peg holes on any theme with the Pegboard skin', () => {
		const project = withTheme('neon');
		const pegs = apply(project, wallCommands(project, { kind: 'pegboard' }));
		expect(draftWall('neon', {}, wallKindOverride(pegs.film)).holes).not.toBeNull();
	});

	it('should keep the override through a theme switch, like a piece skin', () => {
		const project = withTheme('brass');
		const colored = apply(project, wallCommands(project, { color: '#336699' }));
		const neon = apply(colored, themeCommands(colored, 'neon'));
		expect(wallLayer(neon.film).color).toBe('#336699');
	});

	it('should change nothing when the value is already set', () => {
		const colored = apply(withTheme('brass'), wallCommands(withTheme('brass'), { color: '#336699' }));
		expect(wallCommands(colored, { color: '#336699' })).toEqual([]);
	});
});

describe('key light layer', () => {
	it('should read the theme until the project changes it, then reset to the theme', () => {
		const project = withTheme('brass');
		const themed = keyLightLayer(project.film);
		expect(themed).toMatchObject({ color: '#fff9f1', strength: 5.2, own: {} });
		expect(themed.side).toBeLessThan(0);

		const lit = apply(project, keyLightCommands(project, { color: '#FF8800', strength: 9, side: 0.25 }));
		expect(keyLightLayer(lit.film)).toMatchObject({ color: '#ff8800', strength: 9, side: 0.25, height: themed.height });
		expect(sceneThemeOverrides(lit.film)).toEqual({ lightColor: '#ff8800' });
		expect(sceneLayers(lit.film)).toEqual({ keyLight: { strength: 9, side: 0.25 } });
		// Softness, Exposure and Bloom: read from the theme until set, stored with the pose, cleared by Reset
		expect(themed.softness).toBeCloseTo(30 / 60);
		expect(themed).toMatchObject({ exposure: 0, bloom: 0 });
		const soft = apply(lit, keyLightCommands(lit, { softness: 0.5, exposure: 0.4, bloom: 0.3 }));
		expect(keyLightLayer(soft.film)).toMatchObject({ softness: 0.5, exposure: 0.4, bloom: 0.3 });
		expect(sceneLayers(soft.film).keyLight).toEqual({ strength: 9, side: 0.25, softness: 0.5, exposure: 0.4, bloom: 0.3 });

		const reset = apply(lit, resetKeyLightCommands(lit));
		expect(reset.film.lights).toEqual({ added: [] });
		expect(keyLightLayer(reset.film)).toMatchObject({ color: themed.color, strength: 5.2 });
	});

	it('should turn a travel direction into Side and Height', () => {
		expect(lightPlacement([0, 1, 0])).toEqual({ side: 0, height: 0 });
		expect(lightPlacement([1, 0, 0]).side).toBe(-1);
		expect(lightPlacement([0, 0, -1]).height).toBe(1);
		expect(lightPlacement([0.62, 0.62, -0.48]).side).toBeCloseTo(-0.5, 3);
	});
});

describe('added lights', () => {
	it('should add, edit and delete a light, each as one undo step', () => {
		const project = withTheme('brass');
		let history = createHistory(project);
		const edit = (current: TProject, commands: TProjectCommand[]): TProject => {
			const next = apply(current, commands);
			history = pushHistory(history, next);
			return next;
		};
		const { commands, lightId } = addLightCommands(project);
		const added = edit(project, commands);
		expect(addedLights(added.film)).toMatchObject([{ id: lightId, name: 'Light 1', color: '#ffffff' }]);
		// The first light fills from the other side of the wall than Brass's Key Light on the left
		expect(addedLights(added.film)[0]?.side).toBeGreaterThan(0);

		const changed = edit(added, updateLightCommands(added, lightId, { color: '#00FF88', strength: 4, side: -0.2, height: 0.6 }));
		expect(addedLights(changed.film)[0]).toMatchObject({ color: '#00ff88', strength: 4, side: -0.2, height: 0.6 });
		expect(sceneLayers(changed.film).lights).toEqual([{ id: lightId, name: 'Light 1', color: '#00ff88', strength: 4, side: -0.2, height: 0.6 }]);

		const deleted = edit(changed, deleteLightsCommands(changed, [lightId]));
		expect(addedLights(deleted.film)).toEqual([]);
		expect(deleted.film.lights).toEqual({ added: [] });

		history = undoHistory(history);
		expect(addedLights(history.present.film)[0]?.color).toBe('#00ff88');
		history = undoHistory(history);
		expect(addedLights(history.present.film)[0]?.color).toBe('#ffffff');
		history = undoHistory(history);
		expect(history.present.film.lights).toEqual({ added: [] });
	});

	it('should name the next light after the taken ones and ignore unknown IDs', () => {
		const project = withTheme('pegboard');
		const first = apply(project, addLightCommands(project).commands);
		const second = apply(first, addLightCommands(first).commands);
		expect(addedLights(second.film).map((light) => light.name)).toEqual(['Light 1', 'Light 2']);
		expect(updateLightCommands(second, 'light-unknown', { strength: 1 })).toEqual([]);
		expect(deleteLightsCommands(second, ['light-unknown'])).toEqual([]);
	});
});

describe('save as theme', () => {
	it("should move the project's Wall and Lights into the new theme and keep the look", () => {
		const project = withTheme('brass');
		let current = apply(project, wallCommands(project, { color: '#336699', kind: 'pegboard' }));
		current = apply(current, keyLightCommands(current, { color: '#ff8800', strength: 7, softness: 0.6, exposure: 0.25, bloom: 0.5 }));
		const { commands: lightCommands, lightId } = addLightCommands(current);
		current = apply(current, lightCommands);
		expect(hasLayerChanges(current.film)).toBe(true);
		const before = { overrides: sceneThemeOverrides(current.film), layers: sceneLayers(current.film) };

		const { commands, themeId } = duplicateThemeCommands(current, 'brass');
		const saved = apply(current, commands);
		expect(saved.film.theme).toBe(themeId);
		expect(saved.film.wall).toEqual({});
		expect(saved.film.lights).toEqual({ added: [] });
		expect(hasLayerChanges(saved.film)).toBe(false);
		expect(resolveTheme(saved.film).projectTheme).toMatchObject({ overrides: { wallColor: '#336699', lightColor: '#ff8800' }, wallKind: 'pegboard', keyLight: { strength: 7, softness: 0.6, exposure: 0.25, bloom: 0.5 } });
		expect({ overrides: sceneThemeOverrides(saved.film), layers: sceneLayers(saved.film) }).toEqual(before);

		// A light the theme holds is still a layer that edits and deletes
		const edited = apply(saved, updateLightCommands(saved, lightId, { strength: 3 }));
		expect(addedLights(edited.film)[0]?.strength).toBe(3);
		const removed = apply(edited, deleteLightsCommands(edited, [lightId]));
		expect(addedLights(removed.film)).toEqual([]);
	});

	it('should leave out the project changes when duplicating another theme', () => {
		const project = withTheme('brass');
		const colored = apply(project, wallCommands(project, { color: '#336699' }));
		const copied = apply(colored, duplicateThemeCommands(colored, 'neon').commands);
		expect(resolveTheme(copied.film).projectTheme?.overrides).toEqual({});
		expect(copied.film.wall.color).toBe('#336699');
	});
});

describe('project file', () => {
	it('should round-trip the layers', () => {
		const project = withTheme('brass');
		const plain = serializeProject(project);
		expect(JSON.parse(plain).film.wall).toEqual({});
		expect(parseProject(plain)[2]).toEqual(project);

		let current = apply(project, wallCommands(project, { color: '#336699', kind: 'grid' }));
		current = apply(current, keyLightCommands(current, { side: -0.4 }));
		current = apply(current, addLightCommands(current).commands);
		const [isParsedOk, , parsed] = parseProject(serializeProject(current));
		expect(isParsedOk).toBe(true);
		expect(parsed?.film.wall).toEqual({ color: '#336699', kind: 'grid' });
		expect(parsed?.film.lights).toEqual(current.film.lights);

		const reset = apply(current, [...wallCommands(current, { color: null, kind: null })]);
		expect(JSON.parse(serializeProject(reset)).film.wall).toEqual({});
	});
});

describe('Wall skins', () => {
	it('should keep a wall skin in Save as Theme and round-trip through the file', () => {
		const staircase = createStaircaseProject();
		const source: TProject = { ...staircase, film: { ...staircase.film, theme: 'brass', wall: { kind: 'grid' } } };
		const { commands, themeId } = duplicateThemeCommands(source, 'brass');
		const [isOk, err, saved] = applyProjectCommands(source, commands);
		if (!isOk) throw err;
		expect(resolveTheme(saved.film, themeId).projectTheme).toMatchObject({ wallKind: 'grid' });
		const [isParsed, parseErr, parsed] = parseProject(serializeProject(saved));
		if (!isParsed) throw parseErr;
		expect(wallLayer(parsed.film)).toMatchObject({ kind: 'grid' });
	});
});
