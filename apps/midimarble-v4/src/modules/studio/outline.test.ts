import { describe, expect, it } from 'vitest';
import type { TEntity, TProject } from '@/modules/project';
import { buildOutline, DECOR_KEY, FREE_PIECES_KEY, isFilmRow, LIGHTS_KEY, TITLES_KEY } from './outline';
import { CAMERA_KEY, KEY_LIGHT_KEY, SCENE_KEY, SONG_KEY, toLightKey, toShotKey, WALL_KEY } from './selection';

function piece(id: string, hitLink?: { laneId: string; hitId: string }): TEntity {
	return { id, components: { piece: { type: 'platform' }, ...(hitLink != null ? { hitLink } : {}) } } as unknown as TEntity;
}

function project(options: { hasSong?: boolean; entities?: TEntity[]; shots?: { id: string; time: number }[] } = {}): TProject {
	const { hasSong = true, entities = [], shots = [] } = options;
	return {
		music: {
			sources: hasSong ? [{ id: 'source', kind: 'midi', name: 'Jingle Bells.mid' }] : [],
			lanes: [
				{ id: 'lane-1', name: 'Melody', hits: [{ id: 'a', time: 1 }, { id: 'b', time: 2 }] },
				{ id: 'lane-2', name: 'Bass', hits: [] }
			],
			backing: []
		},
		entities: [{ id: 'marble-1', components: { marble: { laneId: 'lane-1' } } }, { id: 'marble-2', components: { marble: { laneId: 'lane-2' } } }, ...entities],
		design: { theme: 'pegboard', themes: [], wall: {}, lights: { added: [] }, decor: [], madeInBlender: [], camera: { shots } }
	} as unknown as TProject;
}

describe('buildOutline function', () => {
	it('should order Song, marbles with their pieces in hit order, Pieces, Wall, Lights, Camera with shots and Titles', () => {
		const title = { id: 'title-1', components: { wallText: { text: 'Jingle Bells' } } } as unknown as TEntity;
		const rows = buildOutline(
			project({
				entities: [piece('p-b', { laneId: 'lane-1', hitId: 'b' }), piece('p-a', { laneId: 'lane-1', hitId: 'a' }), piece('free-1'), piece('free-2'), title],
				shots: [
					{ id: 'late', time: 5 },
					{ id: 'early', time: 1 }
				]
			})
		);

		expect(rows.map((row) => row.id)).toEqual([
			SCENE_KEY,
			SONG_KEY,
			'marble-1',
			'p-a',
			'p-b',
			'marble-2',
			FREE_PIECES_KEY,
			'free-2',
			'free-1',
			WALL_KEY,
			LIGHTS_KEY,
			KEY_LIGHT_KEY,
			CAMERA_KEY,
			toShotKey('early'),
			toShotKey('late'),
			TITLES_KEY,
			'title-1',
			DECOR_KEY
		]);
	});

	it('should list added lights after the Key Light, in Film only', () => {
		const lit = project();
		lit.design.lights = { added: [{ id: 'light-1', name: 'Fill', color: '#ffffff', strength: 2, side: 0.5, height: 0.3 }] };

		const film = buildOutline(lit);
		const lights = film.filter((row) => row.kind === 'light');
		expect(lights.map((row) => row.id)).toEqual([KEY_LIGHT_KEY, toLightKey('light-1')]);
		expect(lights.every((row) => isFilmRow(row))).toBe(true);

		const compose = buildOutline(lit, { workspace: 'compose' });
		expect(compose.some((row) => row.id === WALL_KEY || row.id === LIGHTS_KEY || row.kind === 'light')).toBe(false);
		expect(buildOutline(lit, { collapsed: [LIGHTS_KEY] }).some((row) => row.kind === 'light')).toBe(false);
	});

	it('should name the unlinked pieces\' group Pieces with its help', () => {
		const rows = buildOutline(project({ entities: [piece('free-1')] }), { workspace: 'compose' });
		const group = rows.find((row) => row.id === FREE_PIECES_KEY);

		expect(group?.kind === 'group' ? group.label : null).toBe('Track Pieces');
		expect(group?.kind === 'group' ? group.help : null).toBe('Parts of the track no marble plays or follows; marbles can still hit them');
	});

	it('should leave out the Song without one and an empty Pieces group, and keep Titles and Decor in Film when empty', () => {
		const rows = buildOutline(project({ hasSong: false }));

		expect(rows.map((row) => row.kind)).toEqual(['scene', 'marble', 'marble', 'wall', 'group', 'light', 'camera', 'group', 'group']);
		expect(rows.filter((row) => row.id === TITLES_KEY || row.id === DECOR_KEY)).toMatchObject([{ isEmpty: true, childIds: [] }, { isEmpty: true, childIds: [] }]);
		expect(buildOutline(project({ hasSong: false }), { workspace: 'compose' }).map((row) => row.kind)).toEqual(['scene', 'marble', 'marble']);
	});

	it('should start Layers with the Scene in both workspaces, with no timeline row', () => {
		for (const workspace of ['compose', 'design'] as const) expect(buildOutline(project({}), { workspace })[0]).toMatchObject({ kind: 'scene', id: SCENE_KEY });
	});

	it('should name the Song row Song, whatever its file is called', () => {
		expect(buildOutline(project({}))[1]).toMatchObject({ kind: 'song', label: 'Song' });
	});

	it('should leave out the children of collapsed groups', () => {
		const rows = buildOutline(project({ entities: [piece('p-a', { laneId: 'lane-1', hitId: 'a' }), piece('free-1')], shots: [{ id: 'shot', time: 1 }] }), {
			collapsed: ['lane-1', FREE_PIECES_KEY, CAMERA_KEY]
		});

		expect(rows.map((row) => row.id)).toEqual([SCENE_KEY, SONG_KEY, 'marble-1', 'marble-2', FREE_PIECES_KEY, WALL_KEY, LIGHTS_KEY, KEY_LIGHT_KEY, CAMERA_KEY, TITLES_KEY, DECOR_KEY]);
		expect(rows.find((row) => row.id === 'marble-1')).toMatchObject({ hasChildren: true, isOpen: false });
	});

	it('should mark the Wall, Lights, camera, shots and titles as Film rows', () => {
		const title = { id: 'title-1', components: { wallText: { text: 'End' } } } as unknown as TEntity;
		const rows = buildOutline(project({ entities: [title], shots: [{ id: 'shot', time: 1 }] }));

		expect(rows.filter(isFilmRow).map((row) => row.id)).toEqual([WALL_KEY, LIGHTS_KEY, KEY_LIGHT_KEY, CAMERA_KEY, toShotKey('shot'), TITLES_KEY, 'title-1', DECOR_KEY]);
	});
});
