import { Err, Ok, type TResult } from 'tuple-result';
import { z } from 'zod';
import { BACKING_ID, SFilm, SGroup, SHit, SMarble, SPiece, SProject, SSong, tieOf, type TGroup, type THit, type TMarble, type TProject, type TSong } from './schema';

// Every edit of a project, an agent's too. One definition per command: its fields here, with an example beside them, and the
// TypeScript type inferred. `add` replaces what has the same ID, `update` changes the named fields and deletes one with
// `null`, `remove` also takes what can't stand without it.

/** A record's fields as an update names them: any of them, and `null` to delete it */
function patchOf<GShape extends z.ZodRawShape>(record: z.ZodObject<GShape>) {
	const entries = Object.entries(record.shape)
		.filter(([name]) => name !== 'id')
		.map(([name, field]) => [name, (field as z.ZodType).nullable().optional()]);
	return z.strictObject(Object.fromEntries(entries) as { [GName in Exclude<keyof GShape, 'id'>]: z.ZodOptional<z.ZodNullable<GShape[GName]>> });
}

const SUpdateProject = z.strictObject({ type: z.literal('updateProject'), patch: SProject.pick({ title: true, length: true, format: true, gravity: true }).partial().strict() });
const SAddSong = z.strictObject({ type: z.literal('addSong'), song: SSong });
// A song's start changes only by `moveSong`, which takes what is tied to it along
const SUpdateSong = z.strictObject({ type: z.literal('updateSong'), songId: z.string(), patch: patchOf(SSong.omit({ start: true })) });
const SMoveSong = z.strictObject({ type: z.literal('moveSong'), songId: z.string(), start: z.number() });
const SRemoveSong = z.strictObject({ type: z.literal('removeSong'), songId: z.string() });
const SAddMarble = z.strictObject({ type: z.literal('addMarble'), marble: SMarble });
const SUpdateMarble = z.strictObject({ type: z.literal('updateMarble'), marbleId: z.string(), patch: patchOf(SMarble) });
const SRemoveMarble = z.strictObject({ type: z.literal('removeMarble'), marbleId: z.string() });
const SUpsertHits = z.strictObject({ type: z.literal('upsertHits'), marbleId: z.string(), hits: z.array(SHit) });
const SRemoveHits = z.strictObject({ type: z.literal('removeHits'), marbleId: z.string(), hitIds: z.array(z.string()) });
const SAssignHits = z.strictObject({ type: z.literal('assignHits'), hitIds: z.array(z.string()), marbleId: z.string() });
const SAddPiece = z.strictObject({ type: z.literal('addPiece'), piece: SPiece });
const SUpdatePiece = z.strictObject({ type: z.literal('updatePiece'), pieceId: z.string(), patch: patchOf(SPiece) });
const SRemovePieces = z.strictObject({ type: z.literal('removePieces'), pieceIds: z.array(z.string()) });
const SAddGroup = z.strictObject({ type: z.literal('addGroup'), group: SGroup });
const SUpdateGroup = z.strictObject({ type: z.literal('updateGroup'), groupId: z.string(), patch: patchOf(SGroup) });
const SRemoveGroups = z.strictObject({ type: z.literal('removeGroups'), groupIds: z.array(z.string()) });
const SUpdateFilm = z.strictObject({ type: z.literal('updateFilm'), film: SFilm.partial() });

export const SProjectCommand = z.discriminatedUnion('type', [SUpdateProject, SAddSong, SUpdateSong, SMoveSong, SRemoveSong, SAddMarble, SUpdateMarble, SRemoveMarble, SUpsertHits, SRemoveHits, SAssignHits, SAddPiece, SUpdatePiece, SRemovePieces, SAddGroup, SUpdateGroup, SRemoveGroups, SUpdateFilm]);

export type TProjectCommand = z.infer<typeof SProjectCommand>;

/** What each command looks like, as an error shows it to an agent and its guide lists it */
export const PROJECT_COMMAND_EXAMPLES: Record<TProjectCommand['type'], string> = {
	updateProject: "{ type: 'updateProject', patch: { title: 'Name', length: 32, format: { width: 9, height: 16 }, gravity: 0.5 } }",
	addSong: "{ type: 'addSong', song: { id, name, kind: 'audio', path: 'audio/song.wav', start: 1, backing: [] } }",
	updateSong: "{ type: 'updateSong', songId, patch: { tempo: { bpm: 120, beatsPerBar: 4 }, backingSound: 0 } }",
	moveSong: "{ type: 'moveSong', songId, start: 2 }",
	removeSong: "{ type: 'removeSong', songId }",
	addMarble: "{ type: 'addMarble', marble: { id, name, labelColor: '#3478f6', sound: 9, radius: 0.012, start: { position: { x, y }, time: 0 }, hits: [] } }",
	updateMarble: "{ type: 'updateMarble', marbleId, patch: { name: 'Melody', start: { position: { x, y }, time: 0 } } }",
	removeMarble: "{ type: 'removeMarble', marbleId }",
	upsertHits: "{ type: 'upsertHits', marbleId, hits: [{ id, time }] }",
	removeHits: "{ type: 'removeHits', marbleId, hitIds: [] }",
	assignHits: "{ type: 'assignHits', hitIds: [], marbleId }",
	addPiece: "{ type: 'addPiece', piece: { id, name, type: 'platform', params: {}, angle: 0, place: { kind: 'free', position: { x, y } } } }",
	updatePiece: "{ type: 'updatePiece', pieceId, patch: { angle: 0.2, skin: null } }",
	removePieces: "{ type: 'removePieces', pieceIds: [] }",
	addGroup: "{ type: 'addGroup', group: { id, name, pieceIds: [] } }",
	updateGroup: "{ type: 'updateGroup', groupId, patch: { name: 'Bridge', pattern: null } }",
	removeGroups: "{ type: 'removeGroups', groupIds: [] }",
	updateFilm: "{ type: 'updateFilm', film: { theme: 'brass' } }"
};

/**
 * Applies a batch of commands as one edit. The result is validated and the revision increases once. Nothing is copied that
 * didn't change, so an unchanged section keeps its identity, and the source project is never touched.
 */
export function applyProjectCommands(project: TProject, commands: TProjectCommand[]): TResult<TProject, Error> {
	let next = project;
	for (const command of commands) {
		const [isApplied, applyErr, applied] = applyCommand(next, command);
		if (!isApplied) return Err(applyErr);
		next = applied;
	}
	next = { ...next, revision: project.revision + 1 };
	const parsed = SProject.safeParse(next);
	if (!parsed.success) {
		return Err(new Error(`Invalid edit: ${parsed.error.issues[0]?.message ?? 'unknown issue'}`));
	}
	return Ok(next);
}

function applyCommand(project: TProject, command: TProjectCommand): TResult<TProject, Error> {
	switch (command.type) {
		case 'updateProject':
			return Ok({ ...project, ...definedOf(command.patch) });
		case 'addSong':
			return Ok({ ...project, songs: upsertById(project.songs, { ...command.song, backing: sortHits(command.song.backing) }) });
		case 'updateSong':
			return updateList(project, 'songs', command.songId, command.patch, 'Song');
		case 'moveSong':
			return moveSong(project, command.songId, command.start);
		case 'removeSong':
			// The hits stay; only their tie to the song goes
			return Ok({ ...project, songs: project.songs.filter((song) => song.id !== command.songId), marbles: project.marbles.map((marble) => untied(marble, command.songId)) });
		case 'addMarble':
			return Ok({ ...project, marbles: upsertById(project.marbles, { ...command.marble, hits: sortHits(command.marble.hits) }) });
		case 'updateMarble': {
			const patch = command.patch.hits != null ? { ...command.patch, hits: sortHits(command.patch.hits) } : command.patch;
			return updateList(project, 'marbles', command.marbleId, patch, 'Marble');
		}
		case 'removeMarble': {
			// A marble owns its hits, and the pieces tied to them can't stand without them
			const tied = new Set(project.track.pieces.filter((piece) => tieOf(piece)?.marbleId === command.marbleId).map((piece) => piece.id));
			const track = withoutPieces(project.track, tied);
			return Ok({
				...project,
				marbles: project.marbles.filter((marble) => marble.id !== command.marbleId),
				track: { ...track, groups: track.groups.filter((group) => group.marbleId !== command.marbleId) }
			});
		}
		case 'upsertHits': {
			if (command.marbleId === BACKING_ID) return Ok({ ...project, songs: withBacking(project.songs, command.hits) });
			const marble = project.marbles.find((item) => item.id === command.marbleId);
			if (marble == null) return Err(new Error(`Marble ${command.marbleId} does not exist`));
			return Ok({ ...project, marbles: upsertById(project.marbles, { ...marble, hits: withHits(marble.hits, command.hits) }) });
		}
		case 'removeHits': {
			const removed = new Set(command.hitIds);
			if (command.marbleId === BACKING_ID) {
				return Ok({ ...project, songs: project.songs.map((song) => (song.backing.some((hit) => removed.has(hit.id)) ? { ...song, backing: song.backing.filter((hit) => !removed.has(hit.id)) } : song)) });
			}
			const marble = project.marbles.find((item) => item.id === command.marbleId);
			if (marble == null) return Err(new Error(`Marble ${command.marbleId} does not exist`));
			return Ok({ ...project, marbles: upsertById(project.marbles, { ...marble, hits: marble.hits.filter((hit) => !removed.has(hit.id)) }) });
		}
		case 'assignHits':
			return assignHits(project, command.hitIds, command.marbleId);
		case 'addPiece':
			return Ok({ ...project, track: { ...project.track, pieces: upsertById(project.track.pieces, command.piece) } });
		case 'updatePiece': {
			const pieces = updatedById(project.track.pieces, command.pieceId, command.patch);
			if (pieces == null) return Err(new Error(`Piece ${command.pieceId} does not exist`));
			return Ok({ ...project, track: { ...project.track, pieces } });
		}
		case 'removePieces':
			return Ok({ ...project, track: withoutPieces(project.track, new Set(command.pieceIds)) });
		case 'addGroup':
			return Ok({ ...project, track: { ...project.track, groups: upsertById<TGroup>(project.track.groups, command.group) } });
		case 'updateGroup': {
			const groups = updatedById(project.track.groups, command.groupId, command.patch);
			if (groups == null) return Err(new Error(`Group ${command.groupId} does not exist`));
			return Ok({ ...project, track: { ...project.track, groups } });
		}
		case 'removeGroups': {
			const removed = new Set(command.groupIds);
			return Ok({ ...project, track: { ...project.track, groups: project.track.groups.filter((group) => !removed.has(group.id)) } });
		}
		case 'updateFilm': {
			const film = { ...project.film, ...definedOf(command.film) };
			// The follow camera reads shot markers in time order
			const sorted = command.film.camera != null ? { camera: { ...film.camera, shots: [...film.camera.shots].sort((a, b) => a.time - b.time) } } : {};
			return Ok({ ...project, film: { ...film, ...sorted } });
		}
	}
}

// Hit times are kept to a millionth of a second, so a song moved back and forth comes back to where it was
const TIMES_PER_SECOND = 1e6;
const TIME_EPSILON = 1 / TIMES_PER_SECOND;

/** The song a project makes when it has notes no marble plays and no song yet */
function newNotesSong(): TSong {
	return { id: 'song-notes', name: '', kind: 'midi', start: 0, backing: [] };
}

/** The song that holds Backing: the one that has any, else the MIDI file's, else the first */
export function backingSong(project: Pick<TProject, 'songs'>): TSong | undefined {
	return project.songs.find((song) => song.backing.length > 0) ?? project.songs.find((song) => song.kind === 'midi') ?? project.songs[0];
}

/** The notes no marble plays */
export function backingOf(project: Pick<TProject, 'songs'>): THit[] {
	const holders = project.songs.filter((song) => song.backing.length > 0);
	if (holders.length <= 1) return holders[0]?.backing ?? [];
	return sortHits(holders.flatMap((song) => song.backing));
}

/** The song's meter, known from an imported MIDI file */
export function tempoOf(project: Pick<TProject, 'songs'>): TSong['tempo'] {
	return project.songs.find((song) => song.tempo != null)?.tempo;
}

/** The songs with a row: a song file or Backing notes */
export function shownSongs(project: Pick<TProject, 'songs'>): TSong[] {
	return project.songs.filter((song) => song.path != null || song.backing.length > 0);
}

/** The notes that belong to a song: the hits tied to it, on any marble, and its Backing */
export function hitsOfSong(project: Pick<TProject, 'songs' | 'marbles'>, songId: string): THit[] {
	const backing = project.songs.find((song) => song.id === songId)?.backing ?? [];
	return [...project.marbles.flatMap((marble) => marble.hits.filter((hit) => hit.songId === songId)), ...backing];
}

/** The song a time falls in: the one that started last by then */
export function songPlayingAt(project: Pick<TProject, 'songs'>, time: number): TSong | undefined {
	return shownSongs(project)
		.filter((song) => song.start <= time)
		.sort((a, b) => b.start - a.start)[0];
}

/** The earliest a song can start: no note before 0, no recording cut off and no release of a marble that goes with it before 0 */
export function earliestSongStart(project: Pick<TProject, 'songs' | 'marbles'>, songId: string): number {
	const song = project.songs.find((item) => item.id === songId);
	if (song == null) return 0;
	const tied = project.marbles.flatMap((marble) => marble.hits.filter((hit) => hit.songId === songId).map((hit) => hit.time));
	const releases = project.marbles.filter((marble) => playsOnlySong(marble, songId)).map((marble) => marble.start.time);
	const room = Math.min(...tied, ...song.backing.map((hit) => hit.time), ...releases, ...(song.kind === 'audio' && song.path != null ? [song.start] : []));
	return Number.isFinite(room) ? song.start - room : 0;
}

/** Whether every hit of a marble is tied to the song, so its whole run moves with it */
export function playsOnlySong(marble: Pick<TMarble, 'hits'>, songId: string): boolean {
	return marble.hits.length > 0 && marble.hits.every((hit) => hit.songId === songId);
}

/**
 * A song at a new start, with its Backing and the hits tied to it. A marble that plays only this song starts that much
 * later too, so its whole run moves and stays on time. Hits that aren't tied stay put, so a marble with both changes its run.
 */
function moveSong(project: TProject, songId: string, start: number): TResult<TProject, Error> {
	const song = project.songs.find((item) => item.id === songId);
	if (song == null) return Err(new Error(`Song ${songId} does not exist`));
	const earliest = earliestSongStart(project, songId);
	if (start < earliest - TIME_EPSILON) return Err(new Error(`Song ${songId} can't start before ${earliest}: its first note, or a marble that goes with it, would start before 0`));
	const delta = start - song.start;
	const shifted = (hit: THit): THit => ({ ...hit, time: shiftedTime(hit.time, delta) });
	return Ok({
		...project,
		songs: project.songs.map((item) => (item.id === songId ? { ...item, start, backing: item.backing.map(shifted) } : item)),
		marbles: project.marbles.map((marble) => {
			if (!marble.hits.some((hit) => hit.songId === songId)) return marble;
			const hits = sortHits(marble.hits.map((hit) => (hit.songId === songId ? shifted(hit) : hit)));
			return playsOnlySong(marble, songId) ? { ...marble, hits, start: { ...marble.start, time: shiftedTime(marble.start.time, delta) } } : { ...marble, hits };
		})
	});
}

function shiftedTime(time: number, delta: number): number {
	return Math.max(0, Math.round((time + delta) * TIMES_PER_SECOND) / TIMES_PER_SECOND);
}

/** Moves hits from wherever they are to a marble or to Backing (`BACKING_ID`), keeping their IDs */
function assignHits(project: TProject, hitIds: readonly string[], marbleId: string): TResult<TProject, Error> {
	const wanted = new Set(hitIds);
	const isToBacking = marbleId === BACKING_ID;
	if (!isToBacking && !project.marbles.some((marble) => marble.id === marbleId)) return Err(new Error(`Marble ${marbleId} does not exist`));
	const moved: THit[] = [];
	const without = (hits: THit[], songId?: string): THit[] => {
		const found = hits.filter((hit) => wanted.has(hit.id));
		// A note leaving a song's Backing stays tied to that song
		moved.push(...(songId == null ? found : found.map((hit) => ({ ...hit, songId }))));
		return found.length > 0 ? hits.filter((hit) => !wanted.has(hit.id)) : hits;
	};
	const marbles = project.marbles.map((marble) => {
		if (marble.id === marbleId) return marble;
		const hits = without(marble.hits);
		return hits === marble.hits ? marble : { ...marble, hits };
	});
	const songs = isToBacking
		? project.songs
		: project.songs.map((song) => {
				const backing = without(song.backing, song.id);
				return backing === song.backing ? song : { ...song, backing };
			});
	const found = new Set([...moved, ...(isToBacking ? backingOf(project) : (project.marbles.find((marble) => marble.id === marbleId)?.hits ?? []))].map((hit) => hit.id));
	const missing = hitIds.find((id) => !found.has(id));
	if (missing != null) return Err(new Error(`Hit ${missing} does not exist`));
	if (isToBacking) return Ok({ ...project, marbles, songs: withBacking(songs, moved) });
	return Ok({ ...project, songs, marbles: marbles.map((marble) => (marble.id === marbleId ? { ...marble, hits: sortHits([...marble.hits, ...moved]) } : marble)) });
}

function updateList(project: TProject, key: 'songs' | 'marbles', id: string, patch: object, noun: string): TResult<TProject, Error> {
	const items = updatedById<{ id: string }>(project[key], id, patch);
	if (items == null) return Err(new Error(`${noun} ${id} does not exist`));
	return Ok({ ...project, [key]: items });
}

function updatedById<GItem extends { id: string }>(items: GItem[], id: string, patch: object): GItem[] | null {
	const index = items.findIndex((item) => item.id === id);
	const existing = items[index];
	if (existing == null) return null;
	const next = [...items];
	next[index] = patched(existing, patch);
	return next;
}

/** The track without these pieces. A Group lists its pieces; one that lost them all is gone with them */
function withoutPieces(track: TProject['track'], removed: ReadonlySet<string>): TProject['track'] {
	const groups = track.groups.flatMap((group) => {
		if (!group.pieceIds.some((id) => removed.has(id))) return [group];
		const pieceIds = group.pieceIds.filter((id) => !removed.has(id));
		return pieceIds.length > 0 ? [{ ...group, pieceIds }] : [];
	});
	return { pieces: track.pieces.filter((piece) => !removed.has(piece.id)), groups };
}

/** The record with a patch's fields; `null` deletes one and an absent or undefined one stays */
export function patched<GItem extends object>(item: GItem, patch: object): GItem {
	const next = { ...item } as Record<string, unknown>;
	for (const [name, value] of Object.entries(patch)) {
		if (value === null) delete next[name];
		else if (value !== undefined) next[name] = value;
	}
	return next as GItem;
}

function definedOf<GPatch extends object>(patch: GPatch): GPatch {
	return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as GPatch;
}

/** A marble without its hits' tie to a song, the same object when none has one */
function untied(marble: TMarble, songId: string): TMarble {
	if (!marble.hits.some((hit) => hit.songId === songId)) return marble;
	return {
		...marble,
		hits: marble.hits.map((hit) => {
			if (hit.songId !== songId) return hit;
			const { songId: _songId, ...free } = hit;
			return free;
		})
	};
}

/**
 * Songs with these notes in Backing: each stays in the song that holds it, or goes to the song it is tied to, or else to
 * `backingSong`. Inside a song's Backing a note needs no tie.
 */
function withBacking(songs: TSong[], hits: readonly THit[]): TSong[] {
	let next = songs;
	for (const { songId, ...hit } of hits) {
		const song = next.find((item) => item.backing.some((note) => note.id === hit.id)) ?? next.find((item) => item.id === songId) ?? backingSong({ songs: next }) ?? newNotesSong();
		next = upsertById(next, { ...song, backing: withHits(song.backing, [hit]) });
	}
	return next;
}

function withHits(hits: THit[], added: readonly THit[]): THit[] {
	let next = hits;
	for (const hit of added) next = upsertById(next, hit);
	return sortHits(next);
}

function upsertById<GItem extends { id: string }>(items: GItem[], item: GItem): GItem[] {
	const index = items.findIndex((existing) => existing.id === item.id);
	if (index < 0) return [...items, item];
	const next = [...items];
	next[index] = item;
	return next;
}

function sortHits(hits: THit[]): THit[] {
	return [...hits].sort((a, b) => a.time - b.time);
}
