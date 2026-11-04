import { describe, expect, it } from 'vitest';
import { buildAgentBrief } from '@/modules/agents/agent-brief';
import { buildSceneDescription } from '@/modules/blender';
import { parseCandidateManifest } from '@/modules/library';
import { applyProjectCommands, createHistory, pushHistory, undoHistory, type TProject, type TProjectCommand } from '@/modules/project';
import { createStaircaseProject } from '@/modules/simulation/fixture-projects';
import { draftPieceColors, draftWall } from './draft-look';
import {
	agentThemeCommands,
	baseThemeOf,
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

	it('should add an agent theme once and update it by name', () => {
		const project = withTheme('brass');
		const first = agentThemeCommands(project, { name: 'Sunset', base: 'brass', overrides: { wallColor: '#3B2A4A' } });
		const added = apply(project, first.commands);
		expect(resolveTheme(added.design)).toMatchObject({ name: 'Sunset', base: 'brass', overrides: { wallColor: '#3b2a4a' } });
		expect(themeOrigin(resolveTheme(added.design))).toBe('Made with Agent');
		const again = agentThemeCommands(added, { name: 'Sunset', base: 'chalk', overrides: { lightColor: '#ffb070' } });
		const updated = apply(added, again.commands);
		expect(again.themeId).toBe(first.themeId);
		expect(updated.design.themes).toHaveLength(1);
		expect(resolveTheme(updated.design).overrides).toEqual({ wallColor: '#3b2a4a', lightColor: '#ffb070' });
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

describe('New Theme with Agent', () => {
	it('should ask for a theme only in a New Theme brief, from the current theme', () => {
		const project = withTheme('neon');
		const { commands } = duplicateThemeCommands(project, 'neon');
		const copied = apply(project, commands);
		const colored = apply(copied, themeOverrideCommands(copied, copied.design.theme, { wallColor: '#112233' }));
		const brief = buildAgentBrief({ project: colored, result: null, target: { kind: 'scene' }, request: '@[Project] New theme: deep sea' });
		expect(brief.theme?.base).toBe('neon');
		expect(brief.theme?.bases).toEqual(['pegboard', 'brass', 'neon']);
		expect(brief.theme?.fields.find((field) => field.name === 'wallColor')?.value).toBe('#112233');
		expect(buildAgentBrief({ project, result: null, target: { kind: 'scene' }, request: 'add fog' }).theme).toBeUndefined();
	});

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
});
