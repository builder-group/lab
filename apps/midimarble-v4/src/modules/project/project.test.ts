import { describe, expect, it } from 'vitest';
import { applyProjectCommands, askedFilmLength, backingOf, type TProjectCommand } from './commands';
import { createMarble, createProject } from './create-project';
import { createHistory, pushHistory, redoHistory, undoHistory } from './history';
import { parseProject, serializeProject } from './project-file';
import { BACKING_ID, type TGroup, type TPiece, type TProject, type TSong, freePosition } from './schema';

function apply(project: TProject, commands: TProjectCommand[]): TProject {
	const [isOk, err, next] = applyProjectCommands(project, commands);
	if (!isOk) throw err;
	return next;
}

function piece(id: string): TPiece {
	return { id, name: id, type: 'platform', params: {}, angle: 0, place: { kind: 'free', position: { x: 0, y: 0 } } };
}

function group(id: string, pieceIds: string[]): TGroup {
	return { id, name: id, pieceIds };
}

function song(id: string): TSong {
	return { id, name: id, kind: 'audio', path: `audio/${id}.wav`, start: 0, backing: [] };
}

function deepFreeze<GValue>(value: GValue): GValue {
	if (value != null && typeof value === 'object') {
		for (const item of Object.values(value)) deepFreeze(item);
		Object.freeze(value);
	}
	return value;
}

function firstMarbleId(project: TProject): string {
	const marble = project.marbles[0];
	if (marble == null) throw new Error('Missing marble');
	return marble.id;
}

describe('project document', () => {
	it('round-trips through JSON', () => {
		const project = createProject({ title: 'Song' });
		const [isParsedOk, parsedErr, parsed] = parseProject(serializeProject(project));
		expect(parsedErr).toBeUndefined();
		expect(isParsedOk).toBe(true);
		expect(parsed).toEqual(project);
	});

	it('accepts the draft render preset alongside the earlier presets', () => {
		const project = createProject();
		for (const renderPreset of ['draft', 'final'] as const) {
			const [isParsedOk, , parsed] = parseProject(serializeProject({ ...project, film: { ...project.film, quality: renderPreset } }));
			expect(isParsedOk).toBe(true);
			expect(parsed?.film.quality).toBe(renderPreset);
		}
	});

	it('should reject a removed film field', () => {
		const project = createProject();
		expect(parseProject(JSON.stringify({ ...project, film: { ...project.film, themeOptions: { glow: 1 } } }))[0]).toBe(false);
	});

	it('should round-trip the theme and reject a malformed one', () => {
		const project = createProject();
		const theme = { base: 'neon', glowColor: '#00ff88', parts: { rail: { skin: 'rail:candy' } }, pack: { packId: 'christmas', packName: 'Christmas', version: '1.0', themeId: 'theme-1', themeName: 'Night' } };
		const [isParsedOk, parsedErr, parsed] = parseProject(serializeProject({ ...project, film: { ...project.film, theme } }));
		expect(isParsedOk, parsedErr?.message).toBe(true);
		expect(parsed?.film.theme).toEqual(theme);
		expect(parseProject(JSON.stringify({ ...project, film: { ...project.film, theme: { ...theme, glowColor: 'blue' } } }))[0]).toBe(false);
		expect(parseProject(JSON.stringify({ ...project, film: { ...project.film, theme: { ...theme, overrides: {} } } }))[0]).toBe(false);
		expect(parseProject(JSON.stringify({ ...project, film: { ...project.film, theme: 'neon' } }))[0]).toBe(false);
	});

	it('rejects unknown versions and malformed files', () => {
		const project = createProject();
		expect(parseProject(JSON.stringify({ ...project, $schema: 'marble-project@99' }))[0]).toBe(false);
		expect(parseProject('{nope')[0]).toBe(false);
		expect(parseProject(JSON.stringify({ ...project, extra: true }))[0]).toBe(false);
	});
});

describe('commands', () => {
	it('should hand hits to Backing and back, keeping their IDs and order', () => {
		const project = createProject();
		const marbleId = firstMarbleId(project);
		const [isEditOk, editErr, edited] = applyProjectCommands(project, [
			{ type: 'upsertHits', marbleId, hits: [{ id: 'a', time: 1 }, { id: 'b', time: 2, duration: 0.25 }] },
			{ type: 'upsertHits', marbleId: BACKING_ID, hits: [{ id: 'c', time: 1.5 }] },
			{ type: 'assignHits', hitIds: ['b'], marbleId: BACKING_ID }
		]);
		if (!isEditOk) throw editErr;
		expect(edited.marbles[0]?.hits.map((hit) => hit.id)).toEqual(['a']);
		expect(backingOf(edited)).toEqual([{ id: 'c', time: 1.5 }, { id: 'b', time: 2, duration: 0.25 }]);

		const [isBackOk, backErr, back] = applyProjectCommands(edited, [{ type: 'assignHits', hitIds: ['c', 'b', 'a'], marbleId }]);
		if (!isBackOk) throw backErr;
		expect(back.marbles[0]?.hits.map((hit) => hit.id)).toEqual(['a', 'c', 'b']);
		expect(backingOf(back)).toEqual([]);
	});

	it('should refuse to assign a hit that does not exist', () => {
		const project = createProject();
		const [isEditOk] = applyProjectCommands(project, [{ type: 'assignHits', hitIds: ['missing'], marbleId: BACKING_ID }]);
		expect(isEditOk).toBe(false);
	});

	it('applies a batch as one revision and keeps hits sorted', () => {
		const project = createProject();
		const marbleId = firstMarbleId(project);
		const [isEditOk, editErr, edited] = applyProjectCommands(project, [
			{ type: 'upsertHits', marbleId, hits: [{ id: 'b', time: 2 }] },
			{ type: 'upsertHits', marbleId, hits: [{ id: 'a', time: 1 }] },
			{ type: 'updateProject', patch: { title: 'Renamed' } }
		]);
		expect(editErr).toBeUndefined();
		expect(isEditOk).toBe(true);
		expect(edited?.revision).toBe(project.revision + 1);
		expect(edited?.marbles[0]?.hits.map((hit) => hit.id)).toEqual(['a', 'b']);
		expect(project.marbles[0]?.hits).toEqual([]);
	});

	it('leaves the source untouched when a batch is invalid', () => {
		const project = createProject();
		const [isEditOk] = applyProjectCommands(project, [
			{ type: 'updateProject', patch: { title: 'Changed' } },
			{ type: 'upsertHits', marbleId: 'missing', hits: [] }
		]);
		expect(isEditOk).toBe(false);
		expect(project.title).toBe('Untitled');

		const [isNegativeOk] = applyProjectCommands(project, [
			{ type: 'upsertHits', marbleId: firstMarbleId(project), hits: [{ id: 'x', time: -1 }] }
		]);
		expect(isNegativeOk).toBe(false);
	});

	it('sets and removes the fields of a piece', () => {
		const project = apply(createProject(), [{ type: 'addPiece', piece: piece('a') }]);
		const [, , withPiece] = applyProjectCommands(project, [{ type: 'updatePiece', pieceId: 'a', patch: { angle: 0.1, place: { kind: 'free', position: { x: 1, y: 2 } } } }]);
		expect(freePosition(withPiece?.track.pieces[0])?.x).toBe(1);
		const [, , skinned] = applyProjectCommands(withPiece as TProject, [{ type: 'updatePiece', pieceId: 'a', patch: { skin: { assetId: 'platform:copper' } } }]);
		expect(skinned?.track.pieces[0]?.skin).toEqual({ assetId: 'platform:copper' });
		const [, , without] = applyProjectCommands(skinned as TProject, [{ type: 'updatePiece', pieceId: 'a', patch: { skin: null } }]);
		expect(without?.track.pieces[0]?.skin).toBeUndefined();
	});

	it('removes a marble', () => {
		const project = createProject();
		const [, , edited] = applyProjectCommands(project, [
			{ type: 'removeMarble', marbleId: firstMarbleId(project) }
		]);
		expect(edited?.marbles).toEqual([]);
		expect(edited?.track.pieces).toEqual([]);
	});

	it('should take a marble\'s tied pieces with it and drop them from Groups', () => {
		// Prepare
		const plays = (id: string, marbleId: string): TPiece => ({ ...piece(id), place: { kind: 'plays', marbleId, hitId: 'h1', contactAt: 0.5 } });
		const follows = (id: string, marbleId: string): TPiece => ({ ...piece(id), type: 'bowl', place: { kind: 'follows', marbleId, hitId: 'h1' } });
		const hits = [{ id: 'h1', time: 1 }];
		const project = apply(createProject({ id: 'p', title: 'T' }), [
			{ type: 'addMarble', marble: { ...createMarble(1, { x: 0, y: 0 }, 'gone'), hits } },
			{ type: 'addMarble', marble: { ...createMarble(2, { x: 0, y: 0 }, 'kept'), hits: [{ id: 'h2', time: 1 }] } },
			{ type: 'addPiece', piece: plays('a', 'gone') },
			{ type: 'addPiece', piece: follows('b', 'gone') },
			{ type: 'addPiece', piece: plays('c', 'kept') },
			{ type: 'addPiece', piece: piece('d') },
			{ type: 'addGroup', group: group('mixed', ['a', 'd']) },
			{ type: 'addGroup', group: group('only', ['b']) }
		]);

		// Act
		const edited = apply(project, [{ type: 'removeMarble', marbleId: 'gone' }]);

		// Assert
		expect(edited.track.pieces.map((item) => item.id)).toEqual(['c', 'd']);
		expect(edited.track.groups).toEqual([group('mixed', ['d'])]);
	});
});

describe('askedFilmLength function', () => {
	it('should keep a length between half a second and an hour', () => {
		expect(askedFilmLength(120, 32)).toBe(120);
		expect(askedFilmLength(1e9, 32)).toBe(3600);
		expect(askedFilmLength(0.1, 32)).toBe(0.5);
	});

	it('should keep what a long song set, and let it shorten', () => {
		expect(askedFilmLength(1e9, 7200)).toBe(7200);
		expect(askedFilmLength(7000, 7200)).toBe(7000);
	});
});

describe('update commands', () => {
	it('should merge the named fields and delete one with null', () => {
		const marbleId = 'marble-1';
		const project = apply(createProject({ id: 'p', title: 'T' }), [
			{ type: 'addMarble', marble: { ...createMarble(1, { x: 0, y: 0 }, marbleId), skin: { variant: 'a' } } },
			{ type: 'addSong', song: { ...song('s'), tempo: { bpm: 120, beatsPerBar: 4 } } },
			{ type: 'addPiece', piece: { ...piece('a'), labelColor: '#445566' } },
			{ type: 'addGroup', group: { ...group('g', ['a']), marbleId } }
		]);

		const next = apply(project, [
			{ type: 'updateMarble', marbleId, patch: { name: 'Bass', skin: null } },
			{ type: 'updateSong', songId: 's', patch: { name: 'Mine', tempo: null } },
			{ type: 'updatePiece', pieceId: 'a', patch: { angle: 0.5, labelColor: null } },
			{ type: 'updateGroup', groupId: 'g', patch: { name: 'Bridge', marbleId: null } }
		]);

		const marble = next.marbles.find((item) => item.id === marbleId);
		expect(marble).toMatchObject({ name: 'Bass', radius: 0.012, sound: 9 });
		expect(marble).not.toHaveProperty('skin');
		expect(next.songs[0]).toMatchObject({ name: 'Mine', path: 'audio/s.wav' });
		expect(next.songs[0]).not.toHaveProperty('tempo');
		expect(next.track.pieces[0]).toMatchObject({ name: 'a', angle: 0.5 });
		expect(next.track.pieces[0]).not.toHaveProperty('labelColor');
		expect(next.track.groups[0]).toEqual({ id: 'g', name: 'Bridge', pieceIds: ['a'] });
	});

	it('should leave a field given as undefined as it was', () => {
		const project = apply(createProject(), [{ type: 'addPiece', piece: piece('a') }]);
		const next = apply(project, [{ type: 'updatePiece', pieceId: 'a', patch: { name: undefined } }]);
		expect(next.track.pieces[0]?.name).toBe('a');
	});

	it('should refuse an ID that is not there', () => {
		const project = createProject();
		for (const command of [
			{ type: 'updateMarble', marbleId: 'nope', patch: { name: 'x' } },
			{ type: 'updateSong', songId: 'nope', patch: { name: 'x' } },
			{ type: 'updatePiece', pieceId: 'nope', patch: { angle: 1 } },
			{ type: 'updateGroup', groupId: 'nope', patch: { name: 'x' } }
		] satisfies TProjectCommand[]) {
			expect(applyProjectCommands(project, [command])[0]).toBe(false);
		}
	});
});

describe('add commands', () => {
	it('should replace what has the same ID and keep the order', () => {
		const first = createMarble(1, { x: 0, y: 0 }, 'marble-a');
		const second = createMarble(2, { x: 0, y: 0 }, 'marble-b');
		const project = apply({ ...createProject(), marbles: [] }, [
			{ type: 'addMarble', marble: first },
			{ type: 'addMarble', marble: second },
			{ type: 'addSong', song: song('s1') },
			{ type: 'addSong', song: song('s2') },
			{ type: 'addPiece', piece: piece('a') },
			{ type: 'addPiece', piece: piece('b') },
			{ type: 'addGroup', group: group('g1', []) },
			{ type: 'addGroup', group: group('g2', []) }
		]);

		const next = apply(project, [
			{ type: 'addMarble', marble: { ...first, name: 'Again' } },
			{ type: 'addSong', song: { ...song('s1'), name: 'Again' } },
			{ type: 'addPiece', piece: { ...piece('a'), name: 'Again' } },
			{ type: 'addGroup', group: { ...group('g1', []), name: 'Again' } }
		]);

		expect(next.marbles.map((item) => [item.id, item.name])).toEqual([['marble-a', 'Again'], ['marble-b', second.name]]);
		expect(next.songs.map((item) => [item.id, item.name])).toEqual([['s1', 'Again'], ['s2', 's2']]);
		expect(next.track.pieces.map((item) => [item.id, item.name])).toEqual([['a', 'Again'], ['b', 'b']]);
		expect(next.track.groups.map((item) => [item.id, item.name])).toEqual([['g1', 'Again'], ['g2', 'g2']]);
	});
});

describe('remove commands', () => {
	it('should clear songId on the hits of a removed song and keep them', () => {
		const project = createProject();
		const marbleId = firstMarbleId(project);
		const edited = apply(project, [
			{ type: 'addSong', song: song('s1') },
			{ type: 'addSong', song: song('s2') },
			{ type: 'upsertHits', marbleId, hits: [{ id: 'a', time: 1, pitch: 60, songId: 's1' }, { id: 'b', time: 2, songId: 's2' }, { id: 'c', time: 3 }] }
		]);

		const next = apply(edited, [{ type: 'removeSong', songId: 's1' }]);

		expect(next.songs.map((item) => item.id)).toEqual(['s2']);
		expect(next.marbles[0]?.hits).toEqual([{ id: 'a', time: 1, pitch: 60 }, { id: 'b', time: 2, songId: 's2' }, { id: 'c', time: 3 }]);
	});

	it('should make a song without a path for Backing notes on a project with no song', () => {
		const project = createProject();
		expect(project.songs).toEqual([]);

		const next = apply(project, [{ type: 'upsertHits', marbleId: BACKING_ID, hits: [{ id: 'b', time: 2 }, { id: 'a', time: 1 }] }]);

		expect(next.songs).toHaveLength(1);
		expect(next.songs[0]).not.toHaveProperty('path');
		expect(backingOf(next).map((hit) => hit.id)).toEqual(['a', 'b']);
	});

	it('should drop a Group left with no pieces and keep one that has some', () => {
		const project = apply(createProject(), [
			{ type: 'addPiece', piece: piece('a') },
			{ type: 'addPiece', piece: piece('b') },
			{ type: 'addPiece', piece: piece('c') },
			{ type: 'addGroup', group: group('gone', ['a', 'b']) },
			{ type: 'addGroup', group: group('kept', ['b', 'c']) },
			{ type: 'addGroup', group: group('other', ['c']) }
		]);

		const next = apply(project, [{ type: 'removePieces', pieceIds: ['a', 'b'] }]);

		expect(next.track.pieces.map((item) => item.id)).toEqual(['c']);
		expect(next.track.groups).toEqual([group('kept', ['c']), group('other', ['c'])]);
		// One whose pieces stay is the same object
		expect(next.track.groups[1]).toBe(project.track.groups[2]);
	});
});

describe('applyProjectCommands function', () => {
	function fullProject(): TProject {
		const marbleId = 'marble-1';
		return apply(createProject({ id: 'p', title: 'T' }), [
			{ type: 'addMarble', marble: { ...createMarble(1, { x: 0, y: 0 }, marbleId), hits: [{ id: 'a', time: 1, songId: 's' }, { id: 'b', time: 2 }] } },
			{ type: 'addSong', song: { ...song('s'), kind: 'midi', backing: [{ id: 'c', time: 3 }] } },
			{ type: 'addPiece', piece: { ...piece('p1'), skin: { assetId: 'platform:copper' } } },
			{ type: 'addPiece', piece: piece('p2') },
			{ type: 'addGroup', group: group('g', ['p1']) },
			{ type: 'updateFilm', film: { camera: { auto: true, distance: 1, tilt: 1, sway: 1, shots: [{ id: 'shot-2', time: 2, distance: 1 }, { id: 'shot-1', time: 1, distance: 1 }] } } }
		]);
	}

	// One command of every type: a type left out here doesn't compile
	const commands: { [GType in TProjectCommand['type']]: Extract<TProjectCommand, { type: GType }> } = {
		updateProject: { type: 'updateProject', patch: { title: 'New', length: 20 } },
		addSong: { type: 'addSong', song: { ...song('s2'), backing: [{ id: 'y', time: 2 }, { id: 'x', time: 1 }] } },
		updateSong: { type: 'updateSong', songId: 's', patch: { name: 'Mine', path: null } },
		moveSong: { type: 'moveSong', songId: 's', start: 2 },
		removeSong: { type: 'removeSong', songId: 's' },
		addMarble: { type: 'addMarble', marble: { ...createMarble(2, { x: 1, y: 0 }, 'marble-2'), hits: [{ id: 'z', time: 2 }, { id: 'w', time: 1 }] } },
		updateMarble: { type: 'updateMarble', marbleId: 'marble-1', patch: { name: 'Bass', hits: [{ id: 'd', time: 2 }, { id: 'e', time: 1 }] } },
		removeMarble: { type: 'removeMarble', marbleId: 'marble-1' },
		upsertHits: { type: 'upsertHits', marbleId: 'marble-1', hits: [{ id: 'f', time: 0.5 }] },
		removeHits: { type: 'removeHits', marbleId: 'marble-1', hitIds: ['a'] },
		assignHits: { type: 'assignHits', hitIds: ['a', 'c'], marbleId: 'marble-1' },
		addPiece: { type: 'addPiece', piece: { ...piece('p1'), angle: 1 } },
		updatePiece: { type: 'updatePiece', pieceId: 'p1', patch: { angle: 1, skin: null } },
		removePieces: { type: 'removePieces', pieceIds: ['p1'] },
		addGroup: { type: 'addGroup', group: group('g2', ['p2']) },
		updateGroup: { type: 'updateGroup', groupId: 'g', patch: { name: 'Bridge' } },
		removeGroups: { type: 'removeGroups', groupIds: ['g'] },
		updateFilm: { type: 'updateFilm', film: { theme: { base: 'brass' }, titles: [], camera: { auto: false, distance: 2, tilt: 1, sway: 0, shots: [{ id: 'shot-4', time: 4, distance: 1 }, { id: 'shot-3', time: 3, distance: 1 }] } } }
	};

	it.each(Object.values(commands))('should never mutate its input: $type', (command) => {
		// Prepare
		const project = deepFreeze(fullProject());
		const before = structuredClone(project);
		deepFreeze(command);

		// Act
		const [isOk, err] = applyProjectCommands(project, [command]);

		// Assert
		expect(err).toBeUndefined();
		expect(isOk).toBe(true);
		expect(project).toEqual(before);
	});

	it('should never mutate its input on the way to Backing', () => {
		const project = deepFreeze(fullProject());
		const before = structuredClone(project);
		const backing: TProjectCommand[] = [
			{ type: 'upsertHits', marbleId: BACKING_ID, hits: [{ id: 'g', time: 0.1 }] },
			{ type: 'assignHits', hitIds: ['b'], marbleId: BACKING_ID },
			{ type: 'removeHits', marbleId: BACKING_ID, hitIds: ['g'] }
		];

		const [isOk, err] = applyProjectCommands(project, backing);

		expect(err).toBeUndefined();
		expect(isOk).toBe(true);
		expect(project).toEqual(before);
	});

	it('should keep the identity of the sections that did not change', () => {
		const project = fullProject();

		const pieceEdit = apply(project, [{ type: 'updatePiece', pieceId: 'p1', patch: { angle: 1 } }]);
		expect(pieceEdit.film).toBe(project.film);
		expect(pieceEdit.marbles).toBe(project.marbles);
		expect(pieceEdit.songs).toBe(project.songs);
		expect(pieceEdit.track).not.toBe(project.track);
		expect(pieceEdit.track.groups).toBe(project.track.groups);
		expect(pieceEdit.track.pieces[1]).toBe(project.track.pieces[1]);

		const filmEdit = apply(project, [{ type: 'updateFilm', film: { theme: { base: 'brass' } } }]);
		expect(filmEdit.track).toBe(project.track);
		expect(filmEdit.marbles).toBe(project.marbles);
		expect(filmEdit.songs).toBe(project.songs);
		expect(filmEdit.film.camera).toBe(project.film.camera);

		const marbleEdit = apply(project, [{ type: 'updateMarble', marbleId: 'marble-1', patch: { name: 'Bass' } }]);
		expect(marbleEdit.track).toBe(project.track);
		expect(marbleEdit.film).toBe(project.film);
		expect(marbleEdit.songs).toBe(project.songs);
	});
});

describe('history', () => {
	it('undoes and redoes with increasing revisions', () => {
		const project = createProject();
		const [, , renamed] = applyProjectCommands(project, [{ type: 'updateProject', patch: { title: 'A' } }]);
		let history = pushHistory(createHistory(project), renamed as TProject);
		history = undoHistory(history);
		expect(history.present.title).toBe('Untitled');
		expect(history.present.revision).toBe(2);
		history = redoHistory(history);
		expect(history.present.title).toBe('A');
		expect(history.present.revision).toBe(3);
	});
});

describe('older files', () => {
	it('should refuse them in plain words', () => {
		const project = createProject();
		const [isParsedOk, parsedErr] = parseProject(JSON.stringify({ ...project, $schema: 'marble-project@4' }));
		expect(isParsedOk).toBe(false);
		expect(parsedErr?.message).toBe("This project was made with a different version of MidiMarble and can't be opened.");
	});

	it('should name what is wrong with a file of this version', () => {
		const stored = JSON.parse(serializeProject(createProject())) as { marbles: { color?: string }[]; film: { theme: unknown; themes?: unknown[] } };
		const marble = stored.marbles[0];
		if (marble != null) marble.color = '#778899';
		stored.film.theme = 'brass';
		stored.film.themes = [];
		const [isParsedOk, parsedErr] = parseProject(JSON.stringify(stored));
		expect(isParsedOk).toBe(false);
		expect(parsedErr?.message).toMatch(/^This project can't be opened: /);
		expect(parsedErr?.message).toMatch(/film\.theme should be an object/);
		expect(parsedErr?.message).toMatch(/doesn't match this version/);
	});

	it('should say a file that is not JSON is damaged, without the parser\'s words', () => {
		const [isParsedOk, parsedErr] = parseProject('{ "title": ');
		expect(isParsedOk).toBe(false);
		expect(parsedErr?.message).toMatch(/damaged/);
		expect(parsedErr?.message).not.toMatch(/JSON/);
	});

	it('should say the same of a file with no version', () => {
		const [isParsedOk, parsedErr] = parseProject('{ "title": "Mine" }');
		expect(isParsedOk).toBe(false);
		expect(parsedErr?.message).toBe("This project was made with a different version of MidiMarble and can't be opened.");
	});
});

