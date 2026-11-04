import { describe, expect, it } from 'vitest';
import { applyProjectCommands, createHistory, parseProject, pushHistory, serializeProject, undoHistory, type TProject, type TProjectCommand } from '@/modules/project';
import { createStaircaseProject } from '@/modules/simulation/fixture-projects';
import { DRAFT_TINSEL, draftTinselBand, draftWall } from './draft-look';
import { appliedOverrides, duplicateThemeCommands, hasLayerChanges, resolveTheme, sceneThemeOverrides, themeCommands } from './project-themes';
import {
	addedLights,
	addLightCommands,
	deleteLightsCommands,
	keyLightCommands,
	keyLightLayer,
	lightPlacement,
	resetKeyLightCommands,
	sceneLayers,
	updateLightCommands,
	WALL_BANDS,
	WALL_KINDS,
	wallBandOverride,
	wallCommands,
	wallKindOverride,
	wallLayer
} from './scene-layers';

function apply(project: TProject, commands: TProjectCommand[]): TProject {
	const [isAppliedOk, appliedErr, applied] = applyProjectCommands(project, commands);
	if (!isAppliedOk) throw appliedErr;
	return applied;
}

function withTheme(theme: string): TProject {
	const project = createStaircaseProject();
	return { ...project, design: { ...project.design, theme } };
}

describe('wall layer', () => {
	it('should override a built-in theme per project and return to the theme on reset', () => {
		const project = withTheme('brass');
		expect(wallLayer(project.design)).toMatchObject({ color: '#ada1c0', kind: 'plaster', own: {} });

		const colored = apply(project, wallCommands(project, { color: '#336699', backgroundColor: '#112233', kind: 'grid' }));
		expect(wallLayer(colored.design)).toMatchObject({ color: '#336699', backgroundColor: '#112233', kind: 'grid' });
		expect(sceneThemeOverrides(colored.design)).toEqual({ wallColor: '#336699', backgroundColor: '#112233' });
		expect(sceneLayers(colored.design)).toEqual({ wallKind: 'grid' });
		expect(draftWall('brass', appliedOverrides(colored.design), wallKindOverride(colored.design))).toEqual({ color: '#336699', holes: null });

		const reset = apply(colored, wallCommands(colored, { color: null, backgroundColor: null, kind: null }));
		expect(reset.design.wall).toBeUndefined();
		expect(sceneThemeOverrides(reset.design)).toBeUndefined();
		expect(sceneLayers(reset.design)).toEqual({});
	});

	it('should put peg holes on any theme with the Pegboard skin', () => {
		const project = withTheme('neon');
		const pegs = apply(project, wallCommands(project, { kind: 'pegboard' }));
		expect(draftWall('neon', {}, wallKindOverride(pegs.design)).holes).not.toBeNull();
	});

	it('should keep the override through a theme switch, like a piece skin', () => {
		const project = withTheme('brass');
		const colored = apply(project, wallCommands(project, { color: '#336699' }));
		const neon = apply(colored, themeCommands(colored, 'neon'));
		expect(wallLayer(neon.design).color).toBe('#336699');
	});

	it('should change nothing when the value is already set', () => {
		const colored = apply(withTheme('brass'), wallCommands(withTheme('brass'), { color: '#336699' }));
		expect(wallCommands(colored, { color: '#336699' })).toEqual([]);
	});
});

describe('key light layer', () => {
	it('should read the theme until the project changes it, then reset to the theme', () => {
		const project = withTheme('brass');
		const themed = keyLightLayer(project.design);
		expect(themed).toMatchObject({ color: '#fff9f1', strength: 5.2, own: {} });
		expect(themed.side).toBeLessThan(0);

		const lit = apply(project, keyLightCommands(project, { color: '#FF8800', strength: 9, side: 0.25 }));
		expect(keyLightLayer(lit.design)).toMatchObject({ color: '#ff8800', strength: 9, side: 0.25, height: themed.height });
		expect(sceneThemeOverrides(lit.design)).toEqual({ lightColor: '#ff8800' });
		expect(sceneLayers(lit.design)).toEqual({ keyLight: { strength: 9, side: 0.25 } });
		// Softness, Exposure and Bloom: read from the theme until set, stored with the pose, cleared by Reset
		expect(themed.softness).toBeCloseTo(16 / 60);
		expect(themed).toMatchObject({ exposure: 0, bloom: 0 });
		const soft = apply(lit, keyLightCommands(lit, { softness: 0.5, exposure: 0.4, bloom: 0.3 }));
		expect(keyLightLayer(soft.design)).toMatchObject({ softness: 0.5, exposure: 0.4, bloom: 0.3 });
		expect(sceneLayers(soft.design).keyLight).toEqual({ strength: 9, side: 0.25, softness: 0.5, exposure: 0.4, bloom: 0.3 });

		const reset = apply(lit, resetKeyLightCommands(lit));
		expect(reset.design.lights).toBeUndefined();
		expect(keyLightLayer(reset.design)).toMatchObject({ color: themed.color, strength: 5.2 });
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
		expect(addedLights(added.design)).toMatchObject([{ id: lightId, name: 'Light 1', color: '#ffffff' }]);
		// The first light fills from the other side of the wall than Brass's Key Light on the left
		expect(addedLights(added.design)[0]?.side).toBeGreaterThan(0);

		const changed = edit(added, updateLightCommands(added, lightId, { color: '#00FF88', strength: 4, side: -0.2, height: 0.6 }));
		expect(addedLights(changed.design)[0]).toMatchObject({ color: '#00ff88', strength: 4, side: -0.2, height: 0.6 });
		expect(sceneLayers(changed.design).lights).toEqual([{ id: lightId, name: 'Light 1', color: '#00ff88', strength: 4, side: -0.2, height: 0.6 }]);

		const deleted = edit(changed, deleteLightsCommands(changed, [lightId]));
		expect(addedLights(deleted.design)).toEqual([]);
		expect(deleted.design.lights).toBeUndefined();

		history = undoHistory(history);
		expect(addedLights(history.present.design)[0]?.color).toBe('#00ff88');
		history = undoHistory(history);
		expect(addedLights(history.present.design)[0]?.color).toBe('#ffffff');
		history = undoHistory(history);
		expect(history.present.design.lights).toBeUndefined();
	});

	it('should name the next light after the taken ones and ignore unknown IDs', () => {
		const project = withTheme('pegboard');
		const first = apply(project, addLightCommands(project).commands);
		const second = apply(first, addLightCommands(first).commands);
		expect(addedLights(second.design).map((light) => light.name)).toEqual(['Light 1', 'Light 2']);
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
		expect(hasLayerChanges(current.design)).toBe(true);
		const before = { overrides: sceneThemeOverrides(current.design), layers: sceneLayers(current.design) };

		const { commands, themeId } = duplicateThemeCommands(current, 'brass');
		const saved = apply(current, commands);
		expect(saved.design.theme).toBe(themeId);
		expect(saved.design.wall).toBeUndefined();
		expect(saved.design.lights).toBeUndefined();
		expect(hasLayerChanges(saved.design)).toBe(false);
		expect(resolveTheme(saved.design).projectTheme).toMatchObject({ overrides: { wallColor: '#336699', lightColor: '#ff8800' }, wallKind: 'pegboard', keyLight: { strength: 7, softness: 0.6, exposure: 0.25, bloom: 0.5 } });
		expect({ overrides: sceneThemeOverrides(saved.design), layers: sceneLayers(saved.design) }).toEqual(before);

		// A light the theme holds is still a layer that edits and deletes
		const edited = apply(saved, updateLightCommands(saved, lightId, { strength: 3 }));
		expect(addedLights(edited.design)[0]?.strength).toBe(3);
		const removed = apply(edited, deleteLightsCommands(edited, [lightId]));
		expect(addedLights(removed.design)).toEqual([]);
	});

	it('should leave out the project changes when duplicating another theme', () => {
		const project = withTheme('brass');
		const colored = apply(project, wallCommands(project, { color: '#336699' }));
		const copied = apply(colored, duplicateThemeCommands(colored, 'neon').commands);
		expect(resolveTheme(copied.design).projectTheme?.overrides).toEqual({});
		expect(copied.design.wall?.color).toBe('#336699');
	});
});

describe('project file', () => {
	it('should round-trip the layers and load older projects without them', () => {
		const project = withTheme('brass');
		const plain = serializeProject(project);
		expect(JSON.parse(plain).design).not.toHaveProperty('wall');
		expect(parseProject(plain)[2]).toEqual(project);

		let current = apply(project, wallCommands(project, { color: '#336699', kind: 'grid' }));
		current = apply(current, keyLightCommands(current, { side: -0.4 }));
		current = apply(current, addLightCommands(current).commands);
		const [isParsedOk, , parsed] = parseProject(serializeProject(current));
		expect(isParsedOk).toBe(true);
		expect(parsed?.design.wall).toEqual({ color: '#336699', kind: 'grid' });
		expect(parsed?.design.lights).toEqual(current.design.lights);

		// A reset leaves no empty fields in the file
		const reset = apply(current, [...wallCommands(current, { color: null, kind: null })]);
		expect(JSON.parse(serializeProject(reset)).design).not.toHaveProperty('wall');
	});
});

describe('Tinsel wall', () => {
	const christmas = { id: 'theme-christmas', name: 'Christmas', base: 'brass', overrides: { wallColor: '#f9f9f8' }, wallKind: 'tinsel' as const, wallBand: 'right' as const };

	function project(design: Partial<TProject['design']> = {}): TProject {
		const staircase = createStaircaseProject();
		return { ...staircase, design: { ...staircase.design, theme: 'brass', ...design } };
	}

	it('should offer Tinsel as a Skin and Layout as its own choice', () => {
		expect(WALL_KINDS.map((item) => item.label)).toContain('Tinsel');
		expect(WALL_BANDS.map((item) => item.label)).toEqual(['Full Wall', 'Left Side', 'Right Side']);
	});

	it("should read a project theme's Tinsel band and send it to Blender", () => {
		const design = project({ theme: christmas.id, themes: [christmas] }).design;
		expect(wallLayer(design)).toMatchObject({ kind: 'tinsel', band: 'right', color: '#f9f9f8', own: {} });
		expect(sceneLayers(design)).toMatchObject({ wallKind: 'tinsel', wallBand: 'right' });
	});

	it('should draw Full Wall in the green and a side band on the wall colour', () => {
		expect(draftWall('brass', {}, 'tinsel').color).toBe(DRAFT_TINSEL);
		expect(draftWall('brass', {}, 'tinsel', 'left').color).toBe('#a098ac');
		expect(draftTinselBand('tinsel', 'left')).toBe('left');
		expect(draftTinselBand('plaster', 'left')).toBeNull();
		expect(draftTinselBand()).toBeNull();
	});

	it('should default a Tinsel wall on any theme to Full Wall and take a changed Layout', () => {
		const changed = project({ wall: { kind: 'tinsel' } });
		expect(wallLayer(changed.design).band).toBe('full');
		const left = project({ wall: { kind: 'tinsel', band: 'left' } });
		expect(wallBandOverride(left.design)).toBe('left');
		expect(sceneLayers(left.design)).toMatchObject({ wallKind: 'tinsel', wallBand: 'left' });
	});

	it('should keep the Layout in Save as Theme and round-trip through the file', () => {
		const source = project({ wall: { kind: 'tinsel', band: 'left' } });
		const { commands, themeId } = duplicateThemeCommands(source, 'brass');
		const [isOk, err, saved] = applyProjectCommands(source, commands);
		if (!isOk) throw err;
		expect(resolveTheme(saved.design, themeId).projectTheme).toMatchObject({ wallKind: 'tinsel', wallBand: 'left' });
		const [isParsed, parseErr, parsed] = parseProject(serializeProject(saved));
		if (!isParsed) throw parseErr;
		expect(wallLayer(parsed.design)).toMatchObject({ kind: 'tinsel', band: 'left' });
	});
});
