import { describe, expect, it } from 'vitest';
import { buildSceneDescription } from '@/modules/blender/scene-builder';
import { applyProjectCommands, createProject, type TProject } from '@/modules/project';
import { addWallTextCommands, defaultTitleColor, themeCommands, themeTitleColor } from './design-commands';
import { titleColorOnWall } from './project-themes';
import { songDisplayName, titleClips, titleSpan, withTitleTime } from './titles';

const TEXT = { text: 'Fin', font: 'Bfont Regular', size: 0.03, depth: 0.002, color: '#1d1d1f' };

describe('title timing', () => {
	it('should default to the whole film', () => {
		expect(titleSpan(TEXT, 35)).toEqual({ start: 0, end: 35 });
	});

	it('should read typed In and Out times and drop the defaults', () => {
		const timed = withTitleTime(TEXT, 'in', '0:02.5', 35);
		expect(timed).toEqual({ ...TEXT, in: 2.5 });
		const closed = withTitleTime(timed ?? TEXT, 'out', '12', 35);
		expect(closed).toEqual({ ...TEXT, in: 2.5, out: 12 });
		expect(withTitleTime(closed ?? TEXT, 'in', '0:00', 35)).toEqual({ ...TEXT, out: 12 });
		expect(withTitleTime(closed ?? TEXT, 'out', '1:00', 35)).toEqual({ ...TEXT, in: 2.5 });
	});

	it('should reject text that is not a time or an Out before In', () => {
		const timed = { ...TEXT, in: 4 };
		expect(withTitleTime(timed, 'out', 'soon', 35)).toBeNull();
		expect(withTitleTime(timed, 'out', '0:03', 35)).toBeNull();
		expect(withTitleTime({ ...TEXT, out: 3 }, 'in', '5', 35)).toBeNull();
	});

	it('should list titles as clips by start and pass the times to the scene description', () => {
		// Prepare
		let project: TProject = createProject({ title: 'Titles' });
		const { commands, entityId } = addWallTextCommands({ x: 0, y: 0.2 }, { color: '#1f3a5f', frameHeight: 0.5, text: 'Fin' });
		const [isAddedOk, addedErr, added] = applyProjectCommands(project, commands);
		if (!isAddedOk) throw addedErr;
		const text = added.entities.find((entity) => entity.id === entityId)?.components.wallText ?? TEXT;
		const [isTimedOk, timedErr, timed] = applyProjectCommands(added, [
			{ type: 'setComponent', entityId, component: { name: 'wallText', value: { ...text, in: 1, out: 3 } } }
		]);
		if (!isTimedOk) throw timedErr;
		project = timed;

		// Act
		const clips = titleClips(project);
		const description = buildSceneDescription(project, { revision: 0, duration: project.end, marbles: [], pieces: [], hits: [], contacts: [] } as never, { fps: 30 }).description;

		// Assert
		expect(clips).toEqual([{ entityId, text: 'Fin', start: 1, end: 3 }]);
		expect(description.wallTexts).toEqual([expect.objectContaining({ id: entityId, in: 1, out: 3 })]);
	});
});

describe('songDisplayName function', () => {
	const song = (name: string | null, title = 'Untitled 8') => ({
		title,
		music: {
			sources:
				name == null
					? []
					: [{ id: 's', kind: 'midi' as const, path: `midi/${name}`, name, offset: 0 }],
			lanes: []
		}
	});

	it('should read the song file as words in Title Case', () => {
		expect(songDisplayName(song('jingle-bells.mid'))).toBe('Jingle Bells');
		expect(songDisplayName(song('ode_to__joy.mid'))).toBe('Ode To Joy');
		expect(songDisplayName(song('ABBA-mamma mia.wav'))).toBe('ABBA Mamma Mia');
	});

	it('should fall back to the project title, never to Untitled', () => {
		expect(songDisplayName(song(null, 'Morning Run'))).toBe('Morning Run');
		expect(songDisplayName(song(null, 'Untitled 8'))).toBeNull();
		expect(songDisplayName(song(null, 'Untitled'))).toBeNull();
	});
});

describe('title colour', () => {
	const DARK = '#1f3a5f';
	const WHITE = '#ffffff';

	it('should read on the wall: dark on a light wall, white on a dark one', () => {
		expect(titleColorOnWall('#f7f5f0')).toBe(DARK);
		expect(titleColorOnWall('#141a2a')).toBe(WHITE);
	});

	it("should keep the built-in themes' title colours", () => {
		expect(themeTitleColor('pegboard')).toBe(DARK);
		expect(themeTitleColor('brass')).toBe(WHITE);
		expect(themeTitleColor('neon')).toBe(WHITE);
	});

	it('should follow the wall the project shows: its own colour, then its theme', () => {
		const project = createProject({ id: 'p', title: 'T' });
		const christmas = { id: 'theme-x', name: 'Christmas', base: 'brass', overrides: { wallColor: '#f7f5f0' } };
		expect(defaultTitleColor({ ...project.design, theme: 'brass' })).toBe(WHITE);
		expect(defaultTitleColor({ ...project.design, theme: 'theme-x', themes: [christmas] })).toBe(DARK);
		expect(defaultTitleColor({ ...project.design, theme: 'theme-x', themes: [christmas], wall: { color: '#101010' } })).toBe(WHITE);
	});

	it('should give an unset title the default in the scene, and leave one out of a theme switch', () => {
		const project = createProject({ id: 'p', title: 'T' });
		project.design.theme = 'pegboard';
		const { color: _color, ...unset } = TEXT;
		const entity = { id: 'text-1', name: 'Fin', components: { wallText: unset, transform: { position: { x: 0, y: 0 }, angle: 0 } } };
		project.entities.push(entity);
		const build = buildSceneDescription(project, { revision: project.revision, duration: 1, marbles: [], pieces: [], hits: [] } as never, { fps: 30 });
		expect(build.description.wallTexts?.[0]?.color).toBe(DARK);
		expect(themeCommands(project, 'neon')).toHaveLength(1);
	});
});
