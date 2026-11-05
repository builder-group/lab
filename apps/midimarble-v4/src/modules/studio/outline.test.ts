import { describe, expect, it } from 'vitest';
import type { TPiece, TProject, TTitle } from '@/modules/project';
import { startRailId } from '@/modules/simulation';
import { buildOutline, DECOR_KEY, FREE_PIECES_KEY, isFilmRow, LIGHTS_KEY, TITLES_KEY } from './outline';
import { CAMERA_KEY, KEY_LIGHT_KEY, SCENE_KEY, SONG_KEY, toLightKey, toShotKey, WALL_KEY } from '@/modules/project';

function piece(id: string, tie?: { marbleId: string; hitId: string }): TPiece {
	return { id, type: 'platform', params: {}, angle: 0, place: tie != null ? { kind: 'plays', ...tie, contactAt: 0.5 } : { kind: 'free', position: { x: 0, y: 0 } } };
}

function project(options: { hasSong?: boolean; pieces?: TPiece[]; titles?: TTitle[]; shots?: { id: string; time: number }[] } = {}): TProject {
	const { hasSong = true, pieces = [], titles = [], shots = [] } = options;
	return {
		songs: hasSong ? [{ id: 'source', kind: 'midi', path: 'song.mid', name: 'Jingle Bells.mid', start: 0, backing: [] }] : [],
		marbles: [
			{ id: 'marble-1', name: 'Melody', hits: [{ id: 'a', time: 1 }, { id: 'b', time: 2 }] },
			{ id: 'marble-2', name: 'Bass', hits: [] }
		],
		track: { pieces, groups: [] },
		film: { theme: 'pegboard', themes: [], wall: {}, lights: { added: [] }, decor: [], madeInBlender: [], titles, camera: { shots } }
	} as unknown as TProject;
}

describe('buildOutline function', () => {
	it('should list a marble\'s start rail first under it, not under Track Pieces', () => {
		const rows = buildOutline(project({ pieces: [piece('p-a', { marbleId: 'marble-1', hitId: 'a' }), piece('free-1'), piece(startRailId('marble-1'))] }), { workspace: 'track' });
		const rail = rows.find((row) => row.id === startRailId('marble-1'));

		expect(rows.map((row) => row.id)).toEqual([SCENE_KEY, SONG_KEY, CAMERA_KEY, WALL_KEY, 'marble-1', startRailId('marble-1'), 'p-a', 'marble-2', FREE_PIECES_KEY, 'free-1']);
		expect(rail).toMatchObject({ kind: 'piece', parentId: 'marble-1', marbleId: 'marble-1', depth: 1 });
	});

	it('should order Song, Camera with shots, Wall, marbles with their pieces in hit order, Pieces, Lights and Titles, leaving out empty groups', () => {
		const title = { id: 'title-1', text: 'Jingle Bells' } as TTitle;
		const rows = buildOutline(
			project({
				pieces: [piece('p-b', { marbleId: 'marble-1', hitId: 'b' }), piece('p-a', { marbleId: 'marble-1', hitId: 'a' }), piece('free-1'), piece('free-2')],
				titles: [title],
				shots: [
					{ id: 'late', time: 5 },
					{ id: 'early', time: 1 }
				]
			})
		);

		expect(rows.map((row) => row.id)).toEqual([
			SCENE_KEY,
			SONG_KEY,
			CAMERA_KEY,
			toShotKey('early'),
			toShotKey('late'),
			WALL_KEY,
			'marble-1',
			'p-a',
			'p-b',
			'marble-2',
			FREE_PIECES_KEY,
			'free-2',
			'free-1',
			LIGHTS_KEY,
			KEY_LIGHT_KEY,
			TITLES_KEY,
			'title-1'
		]);
	});

	it('should list added lights after the Key Light, in Film only', () => {
		const lit = project();
		lit.film.lights = { added: [{ id: 'light-1', name: 'Fill', color: '#ffffff', strength: 2, side: 0.5, height: 0.3 }] };

		const film = buildOutline(lit);
		const lights = film.filter((row) => row.kind === 'light');
		expect(lights.map((row) => row.id)).toEqual([KEY_LIGHT_KEY, toLightKey('light-1')]);
		expect(lights.every((row) => isFilmRow(row))).toBe(true);

		const trackRows = buildOutline(lit, { workspace: 'track' });
		expect(trackRows.some((row) => row.id === LIGHTS_KEY || row.kind === 'light')).toBe(false);
		expect(trackRows.some((row) => row.id === WALL_KEY)).toBe(true);
		expect(buildOutline(lit, { collapsed: [LIGHTS_KEY] }).some((row) => row.kind === 'light')).toBe(false);
	});

	it('should name the unlinked pieces\' group Pieces with its help', () => {
		const rows = buildOutline(project({ pieces: [piece('free-1')] }), { workspace: 'track' });
		const group = rows.find((row) => row.id === FREE_PIECES_KEY);

		expect(group?.kind === 'group' ? group.label : null).toBe('Track Pieces');
		expect(group?.kind === 'group' ? group.help : null).toBe('Pieces no marble plays or follows; marbles can still hit them');
	});

	it('should leave out the Song without one and empty groups: Pieces, Titles and Decor', () => {
		const rows = buildOutline(project({ hasSong: false }));

		expect(rows.map((row) => row.kind)).toEqual(['scene', 'camera', 'wall', 'marble', 'marble', 'group', 'light']);
		expect(rows.some((row) => row.id === TITLES_KEY || row.id === DECOR_KEY)).toBe(false);
		expect(buildOutline(project({ hasSong: false }), { workspace: 'track' }).map((row) => row.kind)).toEqual(['scene', 'camera', 'wall', 'marble', 'marble']);
	});

	it('should start Layers with the Scene in both workspaces, with no timeline row', () => {
		for (const workspace of ['track', 'film'] as const) expect(buildOutline(project({}), { workspace })[0]).toMatchObject({ kind: 'scene', id: SCENE_KEY });
	});

	it('should name the Song row Song, whatever its file is called', () => {
		expect(buildOutline(project({}))[1]).toMatchObject({ kind: 'song', label: 'Song' });
	});

	it('should leave out the children of collapsed groups', () => {
		const rows = buildOutline(project({ pieces: [piece('p-a', { marbleId: 'marble-1', hitId: 'a' }), piece('free-1')], shots: [{ id: 'shot', time: 1 }] }), {
			collapsed: ['marble-1', FREE_PIECES_KEY, CAMERA_KEY]
		});

		expect(rows.map((row) => row.id)).toEqual([SCENE_KEY, SONG_KEY, CAMERA_KEY, WALL_KEY, 'marble-1', 'marble-2', FREE_PIECES_KEY, LIGHTS_KEY, KEY_LIGHT_KEY]);
		expect(rows.find((row) => row.id === 'marble-1')).toMatchObject({ hasChildren: true, isOpen: false });
	});

	it('should mark Lights and titles as Film rows', () => {
		const title = { id: 'title-1', text: 'End' } as TTitle;
		const rows = buildOutline(project({ titles: [title], shots: [{ id: 'shot', time: 1 }] }));

		expect(rows.filter(isFilmRow).map((row) => row.id)).toEqual([LIGHTS_KEY, KEY_LIGHT_KEY, TITLES_KEY, 'title-1']);
	});
});
