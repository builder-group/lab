import { describe, expect, it } from 'vitest';
import { buildSceneDescription } from './scene-builder';
import { applyProjectCommands, createProject, type TProject } from '@/modules/project';
import { addWallTextCommands } from '@/modules/film';
import { defaultTitleColor, themeCommands, titleColorOnWall } from './project-themes';
import { songDisplayName, titleClips, titleSpan, withTitleTime } from './titles';

const TEXT = { text: 'Fin', font: 'Bfont Regular', size: 0.03, color: '#1d1d1f' };

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
		const { commands, titleId } = addWallTextCommands(project, { x: 0, y: 0.2 }, { color: '#1f3a5f', frameHeight: 0.5, text: 'Fin' });
		const [isAddedOk, addedErr, added] = applyProjectCommands(project, commands);
		if (!isAddedOk) throw addedErr;
		const [isTimedOk, timedErr, timed] = applyProjectCommands(added, [
			{ type: 'updateFilm', film: { titles: added.film.titles.map((title) => (title.id === titleId ? { ...title, in: 1, out: 3 } : title)) } }
		]);
		if (!isTimedOk) throw timedErr;
		project = timed;

		// Act
		const clips = titleClips(project);
		const description = buildSceneDescription(project, { revision: 0, duration: project.length, marbles: [], pieces: [], hits: [], contacts: [] } as never, { fps: 30 }).description;

		// Assert
		expect(clips).toEqual([{ titleId, text: 'Fin', start: 1, end: 3 }]);
		expect(description.wallTexts).toEqual([expect.objectContaining({ id: titleId, in: 1, out: 3 })]);
	});
});

describe('songDisplayName function', () => {
	const song = (name: string | null, title = 'Untitled 8') => ({
		title,
		songs: name == null ? [] : [{ name, path: `midi/${name}` }]
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

describe('title color', () => {
	const DARK = '#1f3a5f';
	const WHITE = '#ffffff';

	it('should read on the wall: dark on a light wall, white on a dark one', () => {
		expect(titleColorOnWall('#f7f5f0')).toBe(DARK);
		expect(titleColorOnWall('#141a2a')).toBe(WHITE);
	});

	it('should follow the wall the project shows: its own color, then its theme', () => {
		const project = createProject({ id: 'p', title: 'T' });
		expect(defaultTitleColor({ ...project.film, theme: { base: 'brass' } })).toBe(WHITE);
		expect(defaultTitleColor({ ...project.film, theme: { base: 'brass' }, wall: { color: '#f7f5f0' } })).toBe(DARK);
		expect(defaultTitleColor({ ...project.film, theme: { base: 'brass' }, wall: { color: '#101010' } })).toBe(WHITE);
	});

	it('should give an unset title the default in the scene, and leave one out of a theme switch', () => {
		const project = createProject({ id: 'p', title: 'T' });
		project.film.theme = { base: 'pegboard' };
		const { color: _color, ...unset } = TEXT;
		project.film.titles.push({ id: 'text-1', name: 'Fin', ...unset, position: { x: 0, y: 0 }, angle: 0 });
		const build = buildSceneDescription(project, { revision: project.revision, duration: 1, marbles: [], pieces: [], hits: [] } as never, { fps: 30 });
		expect(build.description.wallTexts?.[0]?.color).toBe(WHITE);
		expect(themeCommands(project, 'neon')).toHaveLength(1);
	});
});
