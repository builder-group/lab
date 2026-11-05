// One-off: turns a marble-project@5 document into @6. Every ID stays but a start Rail's, which says its marble's ID, and pieces
// and marbles keep their relative order. Used for
// the fixtures and the owner's local projects; the app itself refuses other versions.
// As a module its default export takes the @5 JSON and returns the @6 JSON; `.local/golden/README.md` says how the golden dump
// uses it. Differences from @5 that can't be kept go to `notes`.
import { getPieceDefinition } from '../src/modules/simulation/pieces';

type TAny = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- @5 has no type any more, and it's only read here

/** The default the @5 schema didn't store: a follow camera's `lead` and `smoothing` are constants in @6 */
const CAMERA_LEAD = 0.15;
const CAMERA_SMOOTHING = 0.6;
const RAIL_MARGIN = 0.01;

export function convertProject(raw: TAny, notes: string[] = []): TAny {
	if (raw?.$schema !== 'marble-project@5') throw new Error(`Expected marble-project@5, found ${String(raw?.$schema)}`);
	const entities: TAny[] = raw.entities;
	const lanes: TAny[] = raw.music.lanes;
	const marbleEntities = entities.filter((entity) => entity.components.marble != null);

	// Marble IDs are the entity's; a hit's or piece's lane ID maps to it
	const marbleIdOf = new Map<string, string>();
	const marbles = marbleEntities.flatMap((entity) => {
		const parts = entity.components;
		const lane = lanes.find((item) => item.id === parts.marble.laneId);
		if (lane == null) {
			notes.push(`Marble ${entity.id} has no lane: it's dropped, as a marble that plays nothing`);
			return [];
		}
		if (parts.release == null) notes.push(`Marble ${entity.id} has no release: it starts at the wall's origin at 0 s`);
		marbleIdOf.set(lane.id, entity.id);
		// An older field the schema no longer allows: the marble's own film color, which a skin holds now
		const skin = parts.marble.color != null && parts.skin?.color == null ? { ...parts.skin, color: parts.marble.color } : parts.skin;
		if (parts.marble.color != null) notes.push(`Marble ${entity.id}'s color ${parts.marble.color} moves to its skin`);
		return [
			{
				id: entity.id,
				name: lane.name,
				labelColor: lane.color,
				sound: lane.instrument,
				radius: parts.marble.radius,
				start: parts.release ?? { position: { x: 0, y: 0 }, time: 0 },
				...(skin != null ? { skin } : {}),
				hits: lane.hits
			}
		];
	});
	for (const lane of lanes) {
		if (marbleIdOf.has(lane.id)) continue;
		notes.push(`Lane ${lane.id} has no marble and ${lane.hits.length} hits: it's dropped`);
	}
	const marbleOrder = marbleEntities.map((entity) => entity.components.marble.laneId).join();
	if (marbleOrder !== lanes.map((lane) => lane.id).join() && marbleOrder.length > 0 && lanes.length === marbleEntities.length) notes.push('Marbles and lanes were in different orders; the marbles keep the entity order, which sets physics bodies');
	const marbleId = (laneId: string): string => marbleIdOf.get(laneId) ?? laneId;

	const pieces = entities.filter((entity) => entity.components.piece != null).map((entity) => convertPiece(entity, marbleId, notes));
	const titles = entities.filter((entity) => entity.components.wallText != null).map((entity) => convertTitle(entity, notes));
	const ignored = entities.filter((entity) => entity.components.marble == null && entity.components.piece == null && entity.components.wallText == null);
	if (ignored.length > 0) notes.push(`${ignored.length} entities are no marble, piece or title and are dropped: ${ignored.map((entity) => entity.id).join(', ')}`);

	const groups = (raw.groups ?? []).map((group: TAny) => convertGroup(group, lanes, marbleId, notes));
	const songs = convertSongs(raw.music, notes);
	// A MIDI note belongs to its file; in a project with only a recording every hit was made against it
	const midiSongId = songs.find((song: TAny) => song.kind === 'midi' && song.path != null)?.id;
	const recordingId = songs.find((song: TAny) => song.kind === 'audio' && song.path != null)?.id;
	const songOf = (hit: TAny): string | undefined => (midiSongId != null ? (hit.pitch != null ? midiSongId : undefined) : recordingId);
	const tied = marbles.map((marble) => ({ ...marble, hits: marble.hits.map((hit: TAny) => (songOf(hit) != null ? { ...hit, songId: songOf(hit) } : hit)) }));

	// A marble's start Rail is found by its ID, which says whose it is
	const startRails = new Map([...marbleIdOf].map(([laneId, id]) => [`start-rail-${laneId}`.slice(0, 64), `start-rail-${id}`.slice(0, 64)]));
	const { renderPreset, camera, ...film } = raw.design;
	if (renderPreset !== 'draft' && renderPreset !== 'final') notes.push(`The render preset ${renderPreset} is gone; it's final now`);
	const { mode, pitch, lead, smoothing, side, shots, ...rig } = camera;
	if (lead !== CAMERA_LEAD || smoothing !== CAMERA_SMOOTHING) notes.push(`The camera's lead ${lead} and smoothing ${smoothing} become the constants ${CAMERA_LEAD} and ${CAMERA_SMOOTHING}`);
	return withIds(startRails, {
		$schema: 'marble-project@6',
		id: raw.id,
		title: raw.title,
		revision: raw.revision,
		format: raw.frame,
		length: raw.end,
		gravity: raw.physics.gravityScale,
		songs,
		marbles: tied,
		track: { pieces, groups },
		film: {
			...film,
			titles,
			quality: renderPreset === 'draft' ? 'draft' : 'final',
			camera: {
				auto: mode === 'rig',
				...rig,
				tilt: pitch,
				...(side != null ? { turn: side } : {}),
				shots: shots.map(({ length, ...shot }: TAny) => ({ ...shot, ...(length != null ? { hold: length } : {}) }))
			}
		}
	});
}

/** The project with some IDs replaced, wherever they're used: as a piece's ID, in a Group, among what a ride touches */
function withIds(ids: ReadonlyMap<string, string>, project: TAny): TAny {
	const swap = (value: TAny): TAny => {
		if (typeof value === 'string') return ids.get(value) ?? value;
		if (Array.isArray(value)) return value.map(swap);
		if (value == null || typeof value !== 'object') return value;
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, swap(item)]));
	};
	return swap(project);
}

function convertPiece(entity: TAny, marbleId: (laneId: string) => string, notes: string[]): TAny {
	const parts = entity.components;
	const link = parts.hitLink;
	const placedAt = parts.transform;
	const base = {
		id: entity.id,
		...(entity.name != null ? { name: entity.name } : {}),
		...(entity.labelColor != null ? { labelColor: entity.labelColor } : {}),
		type: parts.piece.type,
		...(parts.piece.layout != null ? { layout: parts.piece.layout } : {}),
		params: parts.piece.params
	};
	const rest = {
		...(parts.path != null ? { path: parts.path } : {}),
		...(parts.skin != null ? { skin: parts.skin } : {}),
		...(parts.transit != null ? { ride: parts.transit } : {})
	};
	if (link == null) {
		if (placedAt == null) notes.push(`Piece ${entity.id} has neither a hit nor a place, so it was never on the wall; it's free at the wall's origin now`);
		return { ...base, angle: placedAt?.angle ?? 0, place: { kind: 'free', position: placedAt?.position ?? { x: 0, y: 0 } }, ...rest };
	}
	if (placedAt != null) notes.push(`Piece ${entity.id} has a hit and a transform; the hit decides, as it did`);
	const tie = { marbleId: marbleId(link.laneId), hitId: link.hitId };
	const plays = link.anchored !== true && getPieceDefinition(parts.piece.type)?.musical === true;
	if (plays) {
		if (link.offset != null) notes.push(`Platform ${entity.id} plays a hit and has an offset, which never counted; it's dropped`);
		return {
			...base,
			angle: link.angle,
			place: { kind: 'plays', ...tie, contactAt: link.contactAt, ...(link.held != null ? { held: link.held } : {}), ...(link.leaves != null ? { leaves: link.leaves } : {}) },
			...rest
		};
	}
	if (link.leaves != null) notes.push(`Piece ${entity.id} follows a hit and has how the marble leaves it, which only a platform uses; it's dropped`);
	return {
		...base,
		angle: link.angle,
		place: { kind: 'follows', ...tie, ...(link.contactAt !== 0.5 ? { contactAt: link.contactAt } : {}), ...(link.offset != null ? { offset: link.offset } : {}), ...(link.held != null ? { held: link.held } : {}) },
		...rest
	};
}

function convertTitle(entity: TAny, notes: string[]): TAny {
	const placedAt = entity.components.transform;
	if (placedAt == null) notes.push(`Title ${entity.id} has no place; it's at the wall's origin`);
	return {
		id: entity.id,
		...(entity.name != null ? { name: entity.name } : {}),
		...(entity.labelColor != null ? { labelColor: entity.labelColor } : {}),
		...entity.components.wallText,
		position: placedAt?.position ?? { x: 0, y: 0 },
		angle: placedAt?.angle ?? 0
	};
}

/** A Group's range as the hits it holds, the way a run of the Pattern finds them */
function convertGroup(group: TAny, lanes: TAny[], marbleId: (laneId: string) => string, notes: string[]): TAny {
	const base = { id: group.id, name: group.name, ...(group.laneId != null ? { marbleId: marbleId(group.laneId) } : {}), pieceIds: group.pieceIds };
	if (group.kind == null) return base;
	const hits: TAny[] = lanes.find((lane) => lane.id === group.laneId)?.hits ?? [];
	let hitIds: string[];
	if (group.kind === 'longRail') {
		const before = [...hits].reverse().find((hit) => hit.time < group.from + RAIL_MARGIN / 2);
		const after = hits.find((hit) => hit.time > group.to - RAIL_MARGIN / 2);
		hitIds = [before?.id, after?.id].filter((id) => id != null);
	} else {
		hitIds = hits.filter((hit) => hit.time >= group.from - 1e-6 && hit.time <= group.to + 1e-6).map((hit) => hit.id);
	}
	if (!hitIds.length) notes.push(`Pattern ${group.id} holds no hits now`);
	return {
		...base,
		pattern: {
			kind: group.kind,
			hitIds,
			width: group.width,
			bounce: group.bounce,
			...(group.maxTilt != null ? { maxTilt: group.maxTilt } : {}),
			...(group.problems != null ? { problems: group.problems } : {})
		}
	};
}

/** Backing, its Sound and the tempo go on the MIDI file's song, else the first. Backing with no file at all is a song without a path. */
function convertSongs(music: TAny, notes: string[]): TAny[] {
	const songs: TAny[] = music.sources.map((source: TAny) => ({ id: source.id, name: source.name, kind: source.kind, path: source.path, start: source.offset, backing: [] }));
	const hasNotes = music.backing.length > 0 || music.backingInstrument != null;
	if (!songs.length && !hasNotes) {
		if (music.tempo != null) notes.push("The tempo had no song to go on: a project without a song has no use for it, so it's dropped");
		return [];
	}
	if (!songs.length) songs.push({ id: 'song-notes', name: '', kind: 'midi', start: 0, backing: [] });
	const holder = songs.find((song) => song.kind === 'midi') ?? songs[0];
	holder.backing = music.backing;
	if (music.backingInstrument != null) holder.backingSound = music.backingInstrument;
	if (music.tempo != null) holder.tempo = music.tempo;
	return songs;
}

export default function convert(raw: unknown): unknown {
	return convertProject(raw);
}
