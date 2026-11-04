import { describe, expect, it } from 'vitest';
import { createProject, type TEntity, type TProject } from '@/modules/project';
import { inspectorTarget } from './inspector-target';
import { buildOutline, DECOR_KEY, isSelectableRow, TITLES_KEY, type TOutlineRow } from './outline';
import { CAMERA_KEY, KEY_LIGHT_KEY, SONG_KEY, toHitKey, toLightKey, toShotKey, WALL_KEY } from './selection';

function fullProject(): TProject {
	const project = createProject({ id: 'project', title: 'Jingle Bells' });
	const lane = project.music.lanes[0];
	if (lane != null) lane.hits = [{ id: 'hit-1', time: 1, pitch: 64 }];
	project.music.sources = [{ id: 'source-1', kind: 'midi', path: 'song.mid', name: 'Jingle Bells.mid', offset: 0 }];
	const platform = { id: 'platform-1', components: { piece: { type: 'platform' }, hitLink: { laneId: lane?.id ?? '', hitId: 'hit-1' } } } as unknown as TEntity;
	const free = { id: 'rail-1', components: { piece: { type: 'rail' } } } as unknown as TEntity;
	const titles = ['title-1', 'title-2'].map((id) => ({ id, name: id, components: { wallText: { text: id } } }) as unknown as TEntity);
	project.entities.push(platform, free, ...titles);
	project.design.camera.shots = [{ id: 'shot-1', time: 2, kind: 'wide' } as TProject['design']['camera']['shots'][number]];
	return project;
}

/** The selection a click on a row in Layers makes: the row itself, or a group's children */
function rowSelection(row: TOutlineRow): string[] {
	return row.kind === 'group' ? row.childIds : [row.id];
}

describe('inspectorTarget function', () => {
	it('should show the Wall and the lights for their layers and the Project for a light that is gone', () => {
		const project = fullProject();
		project.design.lights = { added: [{ id: 'light-1', name: 'Fill', color: '#ffffff', strength: 2, side: 0.5, height: 0.3 }] };

		expect(inspectorTarget(project, [WALL_KEY])).toEqual({ kind: 'wall' });
		expect(inspectorTarget(project, [KEY_LIGHT_KEY])).toEqual({ kind: 'light', id: 'key' });
		expect(inspectorTarget(project, [toLightKey('light-1')])).toEqual({ kind: 'light', id: 'light-1' });
		expect(inspectorTarget(project, [KEY_LIGHT_KEY, toLightKey('light-1')])).toEqual({ kind: 'lights' });
		expect(inspectorTarget(project, [toLightKey('light-gone')])).toEqual({ kind: 'project' });
	});

	it('should show the Project without a selection', () => {
		expect(inspectorTarget(fullProject(), [])).toEqual({ kind: 'project' });
	});

	it('should give every layer in Layers its own inspector', () => {
		const project = fullProject();
		const kinds = buildOutline(project).map((row) => [row.id, inspectorTarget(project, rowSelection(row)).kind]);

		expect(kinds).toEqual([
			[SONG_KEY, 'song'],
			[project.entities[0]?.id, 'marble'],
			['platform-1', 'pieces'],
			['group:free', 'pieces'],
			['rail-1', 'pieces'],
			[WALL_KEY, 'wall'],
			['group:lights', 'light'],
			[KEY_LIGHT_KEY, 'light'],
			[CAMERA_KEY, 'camera'],
			[toShotKey('shot-1'), 'shot'],
			[TITLES_KEY, 'titles'],
			['title-2', 'title'],
			['title-1', 'title'],
			[DECOR_KEY, 'project']
		]);
	});

	it('should show the same inspector for a timeline row as for its row in Layers', () => {
		const project = fullProject();
		const marbleId = project.entities[0]?.id ?? '';
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
		const laneId = project.music.lanes[0]?.id ?? '';

		expect(inspectorTarget(project, [toHitKey(laneId, 'hit-1')])).toEqual({ kind: 'hits', keys: [toHitKey(laneId, 'hit-1')] });
	});

	it('should show the Project for a Song key once the song is deleted', () => {
		const project = fullProject();
		project.music.sources = [];

		expect(inspectorTarget(project, [SONG_KEY])).toEqual({ kind: 'project' });
	});
});

describe('buildOutline function in Compose', () => {
	it('should list only the Song and the marbles with their pieces; Film lists every layer', () => {
		const project = fullProject();

		expect(buildOutline(project, { workspace: 'compose' }).map((row) => row.kind)).toEqual(['song', 'marble', 'piece', 'group', 'piece']);
		expect(buildOutline(project, { workspace: 'design' }).map((row) => row.kind)).toContain('camera');
		expect(buildOutline(project, { workspace: 'design' }).map((row) => row.kind)).toContain('title');
	});
});
