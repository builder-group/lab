import { describe, expect, it } from 'vitest';
import type { TEntity, TProject } from '@/modules/project';
import { buildOutline, FREE_PIECES_KEY, isFilmRow, TITLES_KEY } from './outline';
import { CAMERA_KEY, SONG_KEY, toShotKey } from './selection';

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
		design: { camera: { shots } }
	} as unknown as TProject;
}

describe('buildOutline function', () => {
	it('should order Song, marbles with their pieces in hit order, Pieces, Camera with shots and Titles', () => {
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
			SONG_KEY,
			'marble-1',
			'p-a',
			'p-b',
			'marble-2',
			FREE_PIECES_KEY,
			'free-2',
			'free-1',
			CAMERA_KEY,
			toShotKey('early'),
			toShotKey('late'),
			TITLES_KEY,
			'title-1'
		]);
	});

	it('should name the unlinked pieces\' group Pieces with its help', () => {
		const rows = buildOutline(project({ entities: [piece('free-1')] }), { workspace: 'compose' });
		const group = rows.find((row) => row.id === FREE_PIECES_KEY);

		expect(group?.kind === 'group' ? group.label : null).toBe('Pieces');
		expect(group?.kind === 'group' ? group.help : null).toBe('Pieces no marble plays or follows; marbles can still hit them');
	});

	it('should give the Song, marbles and Camera a track and nothing else', () => {
		const rows = buildOutline(project({ entities: [piece('free-1')] }));

		expect(rows.filter((row) => row.track != null).map((row) => row.track)).toEqual(['song', 'lane', 'lane', 'camera']);
	});

	it('should leave out the Song without one and empty Pieces and Titles groups', () => {
		const rows = buildOutline(project({ hasSong: false }));

		expect(rows.map((row) => row.kind)).toEqual(['marble', 'marble', 'camera']);
	});

	it('should leave out the children of collapsed groups', () => {
		const rows = buildOutline(project({ entities: [piece('p-a', { laneId: 'lane-1', hitId: 'a' }), piece('free-1')], shots: [{ id: 'shot', time: 1 }] }), {
			collapsed: ['lane-1', FREE_PIECES_KEY, CAMERA_KEY]
		});

		expect(rows.map((row) => row.id)).toEqual([SONG_KEY, 'marble-1', 'marble-2', FREE_PIECES_KEY, CAMERA_KEY]);
		expect(rows.find((row) => row.id === 'marble-1')).toMatchObject({ hasChildren: true, isOpen: false });
	});

	it('should mark the camera, shots and titles as Film rows', () => {
		const title = { id: 'title-1', components: { wallText: { text: 'End' } } } as unknown as TEntity;
		const rows = buildOutline(project({ entities: [title], shots: [{ id: 'shot', time: 1 }] }));

		expect(rows.filter(isFilmRow).map((row) => row.id)).toEqual([CAMERA_KEY, toShotKey('shot'), TITLES_KEY, 'title-1']);
	});
});
