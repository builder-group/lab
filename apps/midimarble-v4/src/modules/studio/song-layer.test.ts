import { describe, expect, it } from 'vitest';
import { applyProjectCommands, createHistory, createProject, pushHistory, undoHistory, type TProject } from '@/modules/project';
import { buildOutline } from './outline';
import { SONG_KEY } from './selection';
import { deleteSongCommands, deleteSongNotice, deleteSongQuestion, hasSongLayer, songLayerName } from './song-layer';

function songProject(options: { hasFile?: boolean; backing?: number; backingInstrument?: number } = {}): TProject {
	const { hasFile = true, backing = 0, backingInstrument } = options;
	const project = createProject({ id: 'project', title: 'Jingle Bells' });
	const lane = project.music.lanes[0];
	if (lane != null) lane.hits = [{ id: 'hit-1', time: 1, pitch: 64 }, { id: 'hit-2', time: 2, pitch: 67 }];
	project.music.sources = hasFile ? [{ id: 'source-1', kind: 'midi', path: 'song.mid', name: 'Jingle Bells.mid', offset: 0 }] : [];
	project.music.backing = Array.from({ length: backing }, (_, index) => ({ id: `backing-${index}`, time: 1 + index * 0.5, pitch: 48 }));
	if (backingInstrument != null) project.music.backingInstrument = backingInstrument;
	return project;
}

describe('hasSongLayer function', () => {
	it('should have no Song layer in a new project or a project of tapped hits', () => {
		const project = songProject({ hasFile: false });

		expect(hasSongLayer(createProject())).toBe(false);
		expect(hasSongLayer(project)).toBe(false);
		expect(buildOutline(project).some((row) => row.id === SONG_KEY)).toBe(false);
	});

	it('should have a Song layer with a song file', () => {
		const project = songProject();

		expect(hasSongLayer(project)).toBe(true);
		expect(songLayerName(project)).toBe('Jingle Bells.mid');
		expect(buildOutline(project)[0]).toMatchObject({ kind: 'song', id: SONG_KEY, label: 'Song' });
	});

	it('should keep a Song layer named Song for Backing notes without a file', () => {
		const project = songProject({ hasFile: false, backing: 2 });

		expect(hasSongLayer(project)).toBe(true);
		expect(buildOutline(project)[0]).toMatchObject({ kind: 'song', source: undefined, label: 'Song' });
	});
});

describe('deleteSongCommands function', () => {
	it('should remove the song file, Backing and its instrument while the marbles keep their hits', () => {
		const project = songProject({ backing: 3, backingInstrument: 33 });

		const [isOk, , deleted] = applyProjectCommands(project, deleteSongCommands(project));

		expect(isOk).toBe(true);
		expect(deleted?.music.sources).toEqual([]);
		expect(deleted?.music.backing).toEqual([]);
		expect(deleted?.music.backingInstrument).toBeUndefined();
		expect(deleted?.music.lanes[0]?.hits.map((hit) => hit.id)).toEqual(['hit-1', 'hit-2']);
		expect(deleted != null && hasSongLayer(deleted)).toBe(false);
	});

	it('should be one undo step that brings the song and Backing back', () => {
		const project = songProject({ backing: 2 });
		const [, , deleted] = applyProjectCommands(project, deleteSongCommands(project));
		if (deleted == null) throw new Error('Delete failed');

		const history = undoHistory(pushHistory(createHistory(project), deleted));

		expect(history.present.music.sources).toEqual(project.music.sources);
		expect(history.present.music.backing).toEqual(project.music.backing);
		expect(history.past).toEqual([]);
	});

	it('should do nothing without a Song layer', () => {
		expect(deleteSongCommands(songProject({ hasFile: false }))).toEqual([]);
	});
});

describe('deleteSongQuestion function', () => {
	it('should ask only when Backing notes would be lost', () => {
		expect(deleteSongQuestion(songProject())).toBeNull();
		expect(deleteSongQuestion(songProject({ backing: 1 }))).toBe('Delete Jingle Bells.mid and its 1 Backing note?');
		expect(deleteSongQuestion(songProject({ backing: 40 }))).toBe('Delete Jingle Bells.mid and its 40 Backing notes?');
	});
});

describe('deleteSongNotice function', () => {
	it('should say what went and that the marbles keep their hits', () => {
		expect(deleteSongNotice(songProject())).toBe('Deleted Jingle Bells.mid. The marbles keep their hits.');
		expect(deleteSongNotice(songProject({ backing: 2 }))).toBe('Deleted Jingle Bells.mid and its 2 Backing notes. The marbles keep their hits.');
	});
});
