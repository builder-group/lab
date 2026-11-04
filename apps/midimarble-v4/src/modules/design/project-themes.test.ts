import { describe, expect, it } from 'vitest';
import { buildSceneDescription } from '@/modules/blender';
import { parseCandidateManifest } from '@/modules/library';
import { applyProjectCommands, createHistory, createProject, pushHistory, undoHistory, type TProject, type TProjectCommand } from '@/modules/project';
import { createStaircaseProject } from '@/modules/simulation/fixture-projects';
import { draftPieceColors, draftWall } from './draft-look';
import {
	baseThemeOf,
	hasSkinChoices,
	currentLookThemeCommands,
	sceneThemeParts,
	themePartCommands,
	copyName,
	deleteThemeCommands,
	duplicateThemeCommands,
	renameThemeCommands,
	resolveTheme,
	sceneThemeOverrides,
	themeCommands,
	themeDefaultColor,
	themeOrigin,
	themeOverrideCommands
} from './project-themes';

function apply(project: TProject, commands: TProjectCommand[]): TProject {
	const [isAppliedOk, appliedErr, applied] = applyProjectCommands(project, commands);
	if (!isAppliedOk) throw appliedErr;
	return applied;
}

function withTheme(theme: string): TProject {
	const project = createStaircaseProject();
	return { ...project, design: { ...project.design, theme } };
}

describe('resolveTheme function', () => {
	it('should resolve built-in, project and unknown themes to a base', () => {
		const project = withTheme('neon');
		expect(resolveTheme(project.design)).toMatchObject({ id: 'neon', name: 'Neon', base: 'neon', isBuiltIn: true, overrides: {} });
		const design = { ...project.design, theme: 'theme-1', themes: [{ id: 'theme-1', name: 'Night', base: 'neon', overrides: { wallColor: '#112233' } }] };
		expect(resolveTheme(design)).toMatchObject({ name: 'Night', base: 'neon', isBuiltIn: false, overrides: { wallColor: '#112233' } });
		expect(baseThemeOf(design)).toBe('neon');
		// An unknown id or base draws as Pegboard, as in Blender
		expect(resolveTheme({ ...design, theme: 'gone' })).toMatchObject({ name: 'gone', base: 'pegboard', projectTheme: null });
		expect(baseThemeOf({ ...design, themes: [{ id: 'theme-1', name: 'Odd', base: 'chalk', overrides: {} }] })).toBe('pegboard');
	});

	it("should give each override its base's own colour while it is not set", () => {
		expect(themeDefaultColor('brass', 'wallColor')).toBe('#ada1c0');
		expect(themeDefaultColor('neon', 'lightColor')).toBe('#eff6ff');
		expect(themeDefaultColor('neon', 'glowColor')).toBeNull();
	});
});

describe('project theme commands', () => {
	it('should duplicate a theme as a copy that is applied, named like Finder', () => {
		const project = withTheme('neon');
		const first = duplicateThemeCommands(project, 'neon');
		const copied = apply(project, first.commands);
		expect(copied.design.theme).toBe(first.themeId);
		expect(resolveTheme(copied.design)).toMatchObject({ name: 'Neon Copy', base: 'neon', overrides: {} });
		expect(themeOrigin(resolveTheme(copied.design))).toBe('Based on Neon');
		const second = apply(copied, duplicateThemeCommands(copied, first.themeId).commands);
		expect(second.design.themes?.map((theme) => theme.name)).toEqual(['Neon Copy', 'Neon Copy 2']);
		expect(copyName('Neon Copy 2', ['Neon Copy', 'Neon Copy 2'])).toBe('Neon Copy 3');
	});

	it('should copy the overrides of a project theme and undo each theme edit in one step', () => {
		const project = withTheme('brass');
		let history = createHistory(project);
		const edit = (commands: TProjectCommand[]): TProject => {
			const next = apply(history.present, commands);
			history = pushHistory(history, next);
			return next;
		};
		const { commands, themeId } = duplicateThemeCommands(project, 'brass');
		let current = edit(commands);
		current = edit(themeOverrideCommands(current, themeId, { wallColor: '#336699', lightColor: '#FF8800' }));
		expect(resolveTheme(current.design).overrides).toEqual({ wallColor: '#336699', lightColor: '#ff8800' });
		current = edit(renameThemeCommands(current, themeId, '  Blue Room '));
		expect(resolveTheme(current.design).name).toBe('Blue Room');
		const copy = apply(current, duplicateThemeCommands(current, themeId).commands);
		expect(resolveTheme(copy.design)).toMatchObject({ name: 'Blue Room Copy', overrides: { wallColor: '#336699', lightColor: '#ff8800' } });
		current = edit(themeOverrideCommands(current, themeId, { lightColor: null }));
		expect(resolveTheme(current.design).overrides).toEqual({ wallColor: '#336699' });

		history = undoHistory(history);
		expect(resolveTheme(history.present.design).overrides).toEqual({ wallColor: '#336699', lightColor: '#ff8800' });
		history = undoHistory(history);
		expect(resolveTheme(history.present.design).name).toBe('Brass Copy');
		history = undoHistory(history);
		history = undoHistory(history);
		expect(history.present.design.theme).toBe('brass');
		expect(history.present.design.themes).toBeUndefined();
	});

	it('should ignore an empty name and an override that changes nothing', () => {
		const project = withTheme('neon');
		const { commands, themeId } = duplicateThemeCommands(project, 'neon');
		const copied = apply(project, commands);
		expect(renameThemeCommands(copied, themeId, '   ')).toEqual([]);
		expect(themeOverrideCommands(copied, themeId, { wallColor: null })).toEqual([]);
		expect(themeOverrideCommands(copied, 'neon', { wallColor: '#000000' })).toEqual([]);
	});

	it('should fall back to the base when the film uses a deleted theme', () => {
		const project = withTheme('neon');
		const { commands, themeId } = duplicateThemeCommands(project, 'neon');
		const copied = apply(project, commands);
		const deleted = apply(copied, deleteThemeCommands(copied, themeId));
		expect(deleted.design.theme).toBe('neon');
		expect(deleted.design.themes).toEqual([]);
		// A theme the film does not use goes without changing the applied theme
		const other = apply(copied, themeCommands(copied, 'brass'));
		expect(apply(other, deleteThemeCommands(other, themeId)).design.theme).toBe('brass');
	});

	it("should recolour titles by the base theme's title colour", () => {
		const project = withTheme('pegboard');
		const title = { id: 'text-1', components: { wallText: { text: 'Hi', font: 'Bfont Regular', size: 0.03, depth: 0.002, color: '#1f3a5f' } } };
		const withTitle = { ...project, entities: [...project.entities, title] };
		const neonCopy = apply({ ...withTitle, design: { ...withTitle.design, theme: 'neon' } }, duplicateThemeCommands({ ...withTitle, design: { ...withTitle.design, theme: 'neon' } }, 'neon').commands);
		const back = apply(neonCopy, themeCommands(neonCopy, 'pegboard'));
		expect(back.entities.find((entity) => entity.id === 'text-1')?.components.wallText?.color).toBe('#1f3a5f');
		const themed = apply(back, themeCommands(back, neonCopy.design.theme));
		expect(themed.entities.find((entity) => entity.id === 'text-1')?.components.wallText?.color).toBe('#ffffff');
	});

});

describe('project themes in Blender and the Draft Preview', () => {
	it('should send the base and the overrides in the scene description', () => {
		const project = withTheme('neon');
		const { commands, themeId } = duplicateThemeCommands(project, 'neon');
		const themed = apply(project, [...commands]);
		const result = { revision: themed.revision, duration: 1, marbles: [], pieces: [], hits: [] } as never;
		expect(buildSceneDescription(themed, result, { fps: 30 }).description).not.toHaveProperty('themeOverrides');
		const colored = apply(themed, themeOverrideCommands(themed, themeId, { wallColor: '#112233', glowColor: '#00FF88' }));
		const description = buildSceneDescription(colored, result, { fps: 30 }).description;
		expect(description.theme).toBe('neon');
		expect(description.themeOverrides).toEqual({ wallColor: '#112233', glowColor: '#00ff88' });
		expect(sceneThemeOverrides(withTheme('brass').design)).toBeUndefined();
	});

	it("should draw a project theme's wall and glow in the Draft Preview", () => {
		expect(draftWall('neon', { wallColor: '#112233' }).color).toBe('#112233');
		expect(draftWall('pegboard', { wallColor: '#336699' })).toMatchObject({ color: '#336699', holes: expect.any(String) });
		expect(draftWall('brass').color).toBe('#a098ac');
		const piece = { type: 'platform', color: '#d94f4f', skin: null };
		expect(draftPieceColors('neon', piece, false, { glowColor: '#00ff88' }).bar).toBe('#00ff88');
		expect(draftPieceColors('neon', piece, false).bar).not.toBe('#00ff88');
	});
});

describe('Theme manifests and parts', () => {
	it("should keep an agent's theme in its manifest with only the known colours", () => {
		const manifest = {
			$schema: 'marble-asset@1',
			id: 'SunsetBar',
			label: 'Sunset bar',
			role: 'skin',
			theme: { name: ' Sunset ', base: 'Brass', overrides: { wallColor: '#3B2A4A', fog: '#ffffff', lightColor: 'orange' } }
		};
		const [isOk, , parsed] = parseCandidateManifest(JSON.stringify(manifest));
		expect(isOk).toBe(true);
		expect(parsed?.theme).toEqual({ name: 'Sunset', base: 'brass', overrides: { wallColor: '#3b2a4a' } });
		const [isBrokenOk, , broken] = parseCandidateManifest(JSON.stringify({ ...manifest, theme: { overrides: {} } }));
		expect(isBrokenOk).toBe(true);
		expect(broken?.theme).toBeUndefined();
	});

	it('should resolve a theme of parts, the same for a built-in and a project theme', () => {
		const project = createProject();
		expect(resolveTheme({ theme: 'brass' }).parts.platform.skin).toBe('platform:gold');
		expect(resolveTheme({ theme: 'neon' }).parts.marble.skin).toBe('marble:contrast');
		const themes = [{ id: 'mine', name: 'Mine', base: 'neon', overrides: {}, parts: { platform: { skin: 'platform:copper' }, marble: { skin: 'marble:glass' } } }];
		const resolved = resolveTheme({ theme: 'mine', themes });
		expect(resolved.parts.platform.skin).toBe('platform:copper');
		expect(resolved.parts.rail.skin).toBe('rail:glow');
		expect(resolved.parts.marble.skin).toBe('marble:glass');
		expect(sceneThemeParts({ theme: 'mine', themes })).toEqual(themes[0]?.parts);
		expect(sceneThemeParts({ theme: 'neon', themes })).toBeUndefined();
		// Duplicate Theme keeps the parts
		const withTheme = { ...project, design: { ...project.design, theme: 'mine', themes } };
		const { commands, themeId } = duplicateThemeCommands(withTheme, 'mine');
		const [isOk, , next] = applyProjectCommands(withTheme, commands);
		expect(isOk && resolveTheme(next.design, themeId).parts.marble.skin).toBe('marble:glass');
	});

	it('should set and clear a part of a project theme, never of a built-in one', () => {
		const project = { ...createProject(), design: { ...createProject().design, themes: [{ id: 'mine', name: 'Mine', base: 'neon', overrides: {} }], theme: 'mine' } };
		expect(themePartCommands(project, 'neon', 'platform', { skin: 'platform:gold' })).toEqual([]);
		const [isSetOk, , set] = applyProjectCommands(project, themePartCommands(project, 'mine', 'platform', { skin: 'platform:gold' }));
		expect(isSetOk && set.design.themes?.[0]?.parts).toEqual({ platform: { skin: 'platform:gold' } });
		if (!isSetOk) return;
		const [isClearOk, , cleared] = applyProjectCommands(set, themePartCommands(set, 'mine', 'platform', { skin: null }));
		expect(isClearOk && cleared.design.themes?.[0]?.parts).toBeUndefined();
	});

	it('should keep the current look as a theme: the look most of a type wear becomes its part, exceptions stay', () => {
		const base = createProject();
		const platform = (id: string, assetId?: string) => ({
			id,
			components: { piece: { type: 'platform', params: {} }, transform: { position: { x: 0, y: 0 }, angle: 0 }, ...(assetId != null ? { skin: { assetId, link: 'linked' as const } } : {}) }
		});
		const project = { ...base, design: { ...base.design, theme: 'brass' }, entities: [...base.entities, platform('a', 'platform:copper'), platform('b', 'platform:copper'), platform('c', 'platform:key'), platform('d', 'library-skin')] };
		expect(hasSkinChoices(project)).toBe(true);
		expect(hasSkinChoices(base)).toBe(false);
		const { commands, themeId } = currentLookThemeCommands(project);
		const [isOk, error, next] = applyProjectCommands(project, commands);
		if (!isOk) throw error;
		const theme = resolveTheme(next.design, themeId);
		expect(next.design.theme).toBe(themeId);
		expect(theme.name).toBe('Brass Copy');
		expect(theme.parts.platform.skin).toBe('platform:copper');
		const skinOf = (id: string) => next.entities.find((entity) => entity.id === id)?.components.skin;
		expect(skinOf('a')).toBeUndefined();
		expect(skinOf('c')?.assetId).toBe('platform:key');
		expect(skinOf('d')?.assetId).toBe('library-skin');
	});
});
