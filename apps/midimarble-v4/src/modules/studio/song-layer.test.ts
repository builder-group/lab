import { describe, expect, it } from 'vitest';
import { applyProjectCommands, createHistory, createProject, pushHistory, undoHistory, type TProject, type TSong, toSongKey, backingOf, backingSong } from '@/modules/project';
import { buildOutline } from './outline';
import { deleteSongCommands, deleteSongNotice, deleteSongQuestion, hasSongLayer, songLayerName, targetSong } from './song-layer';

function songProject(options: { hasFile?: boolean; backing?: number; backingInstrument?: number } = {}): TProject {
	const { hasFile = true, backing = 0, backingInstrument } = options;
	const project = createProject({ id: 'project', title: 'Jingle Bells' });
	const marble = project.marbles[0];
	if (marble != null) marble.hits = [{ id: 'hit-1', time: 1, pitch: 64 }, { id: 'hit-2', time: 2, pitch: 67 }];
	const notes = Array.from({ length: backing }, (_, index) => ({ id: `backing-${index}`, time: 1 + index * 0.5, pitch: 48 }));
	const sound = backingInstrument != null ? { backingSound: backingInstrument } : {};
	if (hasFile) project.songs = [{ id: 'source-1', kind: 'midi', path: 'song.mid', name: 'Jingle Bells.mid', start: 0, backing: notes, ...sound }];
	else project.songs = backing > 0 ? [{ id: 'song-notes', name: '', kind: 'midi', start: 0, backing: notes, ...sound }] : [];
	return project;
}

function firstSong(project: TProject): TSong {
	const song = project.songs[0];
	if (song == null) throw new Error('No song');
	return song;
}

describe('hasSongLayer function', () => {
	it('should have no Song layer in a new project or a project of tapped hits', () => {
		const project = songProject({ hasFile: false });

		expect(hasSongLayer(createProject())).toBe(false);
		expect(hasSongLayer(project)).toBe(false);
		expect(buildOutline(project).some((row) => row.kind === 'song')).toBe(false);
	});

	it('should have a Song layer with a song file', () => {
		const project = songProject();

		expect(hasSongLayer(project)).toBe(true);
		expect(songLayerName(firstSong(project))).toBe('Jingle Bells.mid');
		expect(buildOutline(project).find((row) => row.kind === 'song')).toMatchObject({ id: toSongKey('source-1'), label: 'Song' });
	});

	it('should keep a Song layer named Song for Backing notes without a file', () => {
		const project = songProject({ hasFile: false, backing: 2 });

		expect(hasSongLayer(project)).toBe(true);
		expect(songLayerName(firstSong(project))).toBe('Song');
		expect(buildOutline(project).find((row) => row.kind === 'song')).toMatchObject({ source: { id: 'song-notes' }, label: 'Song' });
	});
});

describe('deleteSongCommands function', () => {
	it('should remove the song file, Backing and its instrument while the marbles keep their hits', () => {
		const project = songProject({ backing: 3, backingInstrument: 33 });

		const [isOk, , deleted] = applyProjectCommands(project, deleteSongCommands(project, firstSong(project).id));

		expect(isOk).toBe(true);
		expect(deleted?.songs).toEqual([]);
		expect(backingOf(deleted as TProject)).toEqual([]);
		expect(backingSong(deleted as TProject)?.backingSound).toBeUndefined();
		expect(deleted?.marbles[0]?.hits.map((hit) => hit.id)).toEqual(['hit-1', 'hit-2']);
		expect(deleted != null && hasSongLayer(deleted)).toBe(false);
	});

	it('should be one undo step that brings the song and Backing back', () => {
		const project = songProject({ backing: 2 });
		const [, , deleted] = applyProjectCommands(project, deleteSongCommands(project, firstSong(project).id));
		if (deleted == null) throw new Error('Delete failed');

		const history = undoHistory(pushHistory(createHistory(project), deleted));

		expect(history.present.songs).toEqual(project.songs);
		expect(backingOf(history.present)).toEqual(backingOf(project));
		expect(history.past).toEqual([]);
	});

	it('should do nothing for a song that is gone', () => {
		expect(deleteSongCommands(songProject({ hasFile: false }), 'gone')).toEqual([]);
	});

	it('should take only the one song, and leave the others their Backing and ties', () => {
		const project = songProject({ backing: 1 });
		const other: TSong = { id: 'other', kind: 'midi', path: 'b.mid', name: 'b.mid', start: 9, backing: [{ id: 'kept', time: 9, pitch: 40 }] };
		const both: TProject = { ...project, songs: [...project.songs, other], marbles: project.marbles.map((marble) => ({ ...marble, hits: marble.hits.map((hit, index) => ({ ...hit, songId: index === 0 ? 'source-1' : 'other' })) })) };

		const [isOk, , deleted] = applyProjectCommands(both, deleteSongCommands(both, 'source-1'));

		expect(isOk).toBe(true);
		expect(deleted?.songs.map((song) => song.id)).toEqual(['other']);
		expect(backingOf(deleted as TProject).map((hit) => hit.id)).toEqual(['kept']);
		expect(deleted?.marbles[0]?.hits.map((hit) => hit.songId)).toEqual([undefined, 'other']);
	});
});

describe('deleteSongQuestion function', () => {
	it('should ask only when Backing notes would be lost', () => {
		expect(deleteSongQuestion(firstSong(songProject()))).toBeNull();
		expect(deleteSongQuestion(firstSong(songProject({ backing: 1 })))).toBe('Delete Jingle Bells.mid and its 1 Backing note?');
		expect(deleteSongQuestion(firstSong(songProject({ backing: 40 })))).toBe('Delete Jingle Bells.mid and its 40 Backing notes?');
	});
});

describe('deleteSongNotice function', () => {
	it('should say what went and that the marbles keep their hits', () => {
		expect(deleteSongNotice(firstSong(songProject()))).toBe('Deleted Jingle Bells.mid. The marbles keep their notes.');
		expect(deleteSongNotice(firstSong(songProject({ backing: 2 })))).toBe('Deleted Jingle Bells.mid and its 2 Backing notes. The marbles keep their notes.');
	});
});

describe('targetSong function', () => {
	const project = songProject();
	const other: TSong = { id: 'other', kind: 'audio', path: 'b.wav', name: 'b.wav', start: 9, backing: [] };
	const both: TProject = { ...project, songs: [...project.songs, other] };

	it('should give the selected song, or the only one, and none while several could be meant', () => {
		expect(targetSong(project, [])?.id).toBe('source-1');
		expect(targetSong(both, [toSongKey('other')])?.id).toBe('other');
		expect(targetSong(both, [])).toBeUndefined();
	});

	it('should give every song its own row in Layers, in order', () => {
		expect(buildOutline(both).filter((row) => row.kind === 'song').map((row) => row.id)).toEqual([toSongKey('source-1'), toSongKey('other')]);
	});
});
