import { describe, expect, it } from 'vitest';
import { createProject, type TDecor, type TPiece, type TProject, CAMERA_KEY, KEY_LIGHT_KEY, SCENE_KEY, SONG_KEY, toDecorKey, toHitKey, toLightKey, toShotKey, WALL_KEY } from '@/modules/project';
import { inspectorTarget, selectionEnteringFilm } from './inspector-target';
import { buildOutline, DECOR_KEY, isSelectableRow, TITLES_KEY, type TOutlineRow } from './outline';

function fullProject(): TProject {
	const project = createProject({ id: 'project', title: 'Jingle Bells' });
	const marble = project.marbles[0];
	if (marble != null) marble.hits = [{ id: 'hit-1', time: 1, pitch: 64 }];
	project.songs = [{ id: 'source-1', kind: 'midi', path: 'song.mid', name: 'Jingle Bells.mid', start: 0, backing: [] }];
	const platform: TPiece = { id: 'platform-1', type: 'platform', params: {}, angle: 0, place: { kind: 'plays', marbleId: marble?.id ?? '', hitId: 'hit-1', contactAt: 0.5 } };
	const free: TPiece = { id: 'rail-1', type: 'rail', params: {}, angle: 0, place: { kind: 'free', position: { x: 0, y: 0 } } };
	project.track.pieces.push(platform, free);
	project.film.titles = ['title-1', 'title-2'].map((id) => ({ id, name: id, text: id, font: 'sans', size: 0.1, position: { x: 0, y: 0 }, angle: 0 }));
	project.film.camera.shots = [{ id: 'shot-1', time: 2, kind: 'wide' } as TProject['film']['camera']['shots'][number]];
	return project;
}

/** The selection a click on a row in Layers makes: the row itself, or a group's children */
function rowSelection(row: TOutlineRow): string[] {
	return row.kind === 'group' ? row.childIds : [row.id];
}

describe('inspectorTarget function', () => {
	it('should show the Wall and the lights for their layers and the Project for a light that is gone', () => {
		const project = fullProject();
		project.film.lights = { added: [{ id: 'light-1', name: 'Fill', color: '#ffffff', strength: 2, side: 0.5, height: 0.3 }] };

		expect(inspectorTarget(project, [WALL_KEY])).toEqual({ kind: 'wall' });
		expect(inspectorTarget(project, [KEY_LIGHT_KEY])).toEqual({ kind: 'light', id: 'key' });
		expect(inspectorTarget(project, [toLightKey('light-1')])).toEqual({ kind: 'light', id: 'light-1' });
		expect(inspectorTarget(project, [KEY_LIGHT_KEY, toLightKey('light-1')])).toEqual({ kind: 'scene' });
		expect(inspectorTarget(project, [toLightKey('light-gone')])).toEqual({ kind: 'scene' });
	});

	it('should show the Project without a selection', () => {
		expect(inspectorTarget(fullProject(), [])).toEqual({ kind: 'scene' });
	});

	it('should give every layer in Layers its own inspector', () => {
		const project = fullProject();
		const kinds = buildOutline(project).map((row) => [row.id, inspectorTarget(project, rowSelection(row)).kind]);

		expect(kinds).toEqual([
			[SCENE_KEY, 'scene'],
			[SONG_KEY, 'song'],
			[CAMERA_KEY, 'camera'],
			[toShotKey('shot-1'), 'shot'],
			[WALL_KEY, 'wall'],
			[project.marbles[0]?.id, 'marble'],
			['platform-1', 'pieces'],
			['group:free', 'pieces'],
			['rail-1', 'pieces'],
			['group:lights', 'light'],
			[KEY_LIGHT_KEY, 'light'],
			[TITLES_KEY, 'titles'],
			['title-2', 'title'],
			['title-1', 'title']
		]);
	});

	it('should show the same inspector for a timeline row as for its row in Layers', () => {
		const project = fullProject();
		const marbleId = project.marbles[0]?.id ?? '';
		const rows = buildOutline(project).filter(isSelectableRow);
		// The keys the timeline's row headers and clips select: Song, a marble, Camera, a shot and a title
		const timelineKeys = [SONG_KEY, marbleId, CAMERA_KEY, toShotKey('shot-1'), 'title-1'];

		for (const key of timelineKeys) {
			const row = rows.find((item) => item.id === key);
			expect(row, key).toBeDefined();
			expect(inspectorTarget(project, [key])).toEqual(inspectorTarget(project, rowSelection(row as TOutlineRow)));
		}
		// The Titles row header selects every title, as the Titles group in Layers does
		const group = buildOutline(project).find((row) => row.id === TITLES_KEY);
		expect(inspectorTarget(project, ['title-1', 'title-2'])).toEqual(inspectorTarget(project, group == null ? [] : rowSelection(group)));
	});

	it('should show hits before the marble they belong to', () => {
		const project = fullProject();
		const marbleId = project.marbles[0]?.id ?? '';

		expect(inspectorTarget(project, [toHitKey(marbleId, 'hit-1')])).toEqual({ kind: 'hits', keys: [toHitKey(marbleId, 'hit-1')] });
	});

	it('should show the Project for a Song key once the song is deleted', () => {
		const project = fullProject();
		project.songs = [];

		expect(inspectorTarget(project, [SONG_KEY])).toEqual({ kind: 'scene' });
	});
});

describe('the Scene', () => {
	it('should be what an emptied selection shows, in both workspaces', () => {
		for (const workspace of ['track', 'film'] as const) expect(inspectorTarget(fullProject(), [], workspace)).toEqual({ kind: 'scene' });
	});

	it('should show for a Film layer left selected in Track, and not in Film', () => {
		expect(inspectorTarget(fullProject(), [KEY_LIGHT_KEY], 'track')).toEqual({ kind: 'scene' });
		expect(inspectorTarget(fullProject(), [KEY_LIGHT_KEY], 'film')).toEqual({ kind: 'light', id: 'key' });
		expect(inspectorTarget(fullProject(), [WALL_KEY], 'track')).toEqual({ kind: 'wall' });
		expect(inspectorTarget(fullProject(), [CAMERA_KEY], 'track')).toEqual({ kind: 'camera' });
	});
});

describe('selectionEnteringFilm function', () => {
	it('should select the Scene when Track left a piece or a hit selected', () => {
		const project = fullProject();
		const marbleId = project.marbles[0]?.id ?? '';
		expect(selectionEnteringFilm(project, ['platform-1'])).toEqual([]);
		expect(selectionEnteringFilm(project, ['platform-1', 'rail-1'])).toEqual([]);
		expect(selectionEnteringFilm(project, [toHitKey(marbleId, 'hit-1')])).toEqual([]);
	});

	it('should keep a layer Film is about', () => {
		const project = fullProject();
		const marble = project.marbles[0]?.id ?? '';
		for (const selection of [[WALL_KEY], [CAMERA_KEY], [toShotKey('shot-1')], ['title-1'], [SONG_KEY], [marble], [toLightKey('key')]]) {
			expect(selectionEnteringFilm(project, selection)).toEqual(selection);
		}
		expect(selectionEnteringFilm(project, [])).toEqual([]);
	});
});

describe('buildOutline function in Track', () => {
	it('should list the Song, the Camera, the Wall and the marbles with their pieces; Film lists every layer', () => {
		const project = fullProject();

		expect(buildOutline(project, { workspace: 'track' }).map((row) => row.kind)).toEqual(['scene', 'song', 'camera', 'shot', 'wall', 'marble', 'piece', 'group', 'piece']);
		expect(buildOutline(project, { workspace: 'film' }).map((row) => row.kind)).toContain('camera');
		expect(buildOutline(project, { workspace: 'film' }).map((row) => row.kind)).toContain('title');
	});
});

describe('several Decor items', () => {
	it('should have an inspector of their own in Film, and show the Scene in Track', () => {
		const base = createProject({ title: 'Decor' });
		const decor = (id: string): TDecor => ({ id, source: 'decor:sphere', position: { x: 0, y: 0 }, scale: 1, rotation: 0 }) as unknown as TDecor;
		const project = { ...base, film: { ...base.film, decor: [decor('a'), decor('b')] } };

		expect(inspectorTarget(project, [toDecorKey('a'), toDecorKey('b')])).toEqual({ kind: 'decorItems', ids: ['a', 'b'] });
		expect(inspectorTarget(project, [toDecorKey('a'), toDecorKey('b')], 'track').kind).toBe('scene');
	});
});
