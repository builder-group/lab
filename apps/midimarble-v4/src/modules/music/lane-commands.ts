import {
	BACKING_ID,
	createId,
	createLane,
	createMarble,
	LANE_SPACING,
	type THit,
	type TLane,
	type TProject,
	type TProjectCommand,
	type TSource
} from '@/modules/project';
import { MIN_HIT_GAP } from './lane-proposal';
import type { TMidiNote } from './midi';

/**
 * Creates lanes and marbles for proposed note lists and adds the other notes to Backing. Empty projects are
 * replaced so a fresh import starts clean; projects with hits keep their lanes and Backing and gain new ones.
 */
export function createImportCommands(
	project: TProject,
	options: TImportCommandsOptions
): TProjectCommand[] {
	const { lanes, backing = [], backingInstrument, source, instrument } = options;
	const hasHits = project.music.lanes.some((lane) => lane.hits.length > 0);
	const commands: TProjectCommand[] = [];
	let index = project.music.lanes.length;

	if (!hasHits) {
		for (const lane of project.music.lanes) commands.push({ type: 'removeLane', laneId: lane.id });
		if (project.music.backing.length > 0) {
			commands.push({ type: 'removeHits', laneId: BACKING_ID, hitIds: project.music.backing.map((hit) => hit.id) });
		}
		index = 0;
	}
	if (source != null) commands.push({ type: 'upsertSource', source });

	for (const notes of lanes) {
		const lane: TLane = {
			...createLane(index),
			instrument: instrument ?? createLane(index).instrument,
			hits: notes.map((note) => noteToHit(note))
		};
		commands.push({ type: 'upsertLane', lane });
		const marble = createMarble(lane, { x: index * LANE_SPACING, y: 0.6 });
		// Released a short drop before its first note, so the film does not open on a long empty fall
		const first = lane.hits.reduce((min, hit) => Math.min(min, hit.time), Infinity);
		if (marble.components.release != null && Number.isFinite(first)) {
			marble.components.release.time = round(Math.max(0, first - IMPORT_RELEASE_LEAD));
		}
		commands.push({ type: 'upsertEntity', entity: marble });
		index++;
	}
	if (backing.length > 0) commands.push({ type: 'upsertHits', laneId: BACKING_ID, hits: backing.map((note) => noteToHit(note)) });
	if (backingInstrument != null) commands.push({ type: 'setBackingInstrument', instrument: backingInstrument });
	// A fresh import fits the film to the song; an import next to existing hits only lengthens it
	const played = lanes.flat().length > 0 ? lanes.flat() : backing;
	if (played.length > 0) {
		const end = songEnd(played.reduce((max, note) => Math.max(max, note.time), 0));
		if (!hasHits ? Math.abs(end - project.end) > 1e-6 : end > project.end) commands.push({ type: 'setEnd', end });
	}
	return commands;
}

/**
 * Seconds a film runs on after the last note. The follow camera holds on the last hit, and the marble that struck
 * it leaves that held frame 0.47 to 1 s later (Reference 20 to Jingle Bells), so a longer tail ends on an empty
 * frame. The soundtrack fades out over the last `FILM_AUDIO_FADE` seconds so the final note is not cut off.
 */
export const SONG_TAIL = 0.4;

/** Film length for a song whose last note starts at `lastNote`, rounded to 0.01 s */
export function songEnd(lastNote: number): number {
	return Math.round((lastNote + SONG_TAIL) * 100) / 100;
}

/**
 * Seconds between an imported marble's release and its first note: a 0.6 m drop at half gravity. Shorter leads
 * built Jingle Bells worse (0.35 s crossed the lanes), as the first arrival speed shapes the whole run.
 */
export const IMPORT_RELEASE_LEAD = 0.5;

export interface TImportCommandsOptions {
	lanes: TMidiNote[][];
	// Notes no marble plays
	backing?: TMidiNote[];
	// General MIDI program Backing plays with
	backingInstrument?: number;
	source?: TSource;
	instrument?: number;
}

export function noteToHit(note: TMidiNote): THit {
	return {
		id: createId('hit'),
		time: round(note.time),
		pitch: note.pitch,
		velocity: round(note.velocity),
		...(note.duration > 0 ? { duration: round(note.duration) } : {})
	};
}

/** Hits that follow their predecessor too closely for one marble */
export function findLaneConflicts(lane: TLane, minGap = MIN_HIT_GAP): Set<string> {
	const conflicts = new Set<string>();
	for (let index = 1; index < lane.hits.length; index++) {
		const previous = lane.hits[index - 1];
		const hit = lane.hits[index];
		if (previous == null || hit == null) continue;
		if (hit.time - previous.time < minGap - 1e-9) {
			conflicts.add(previous.id);
			conflicts.add(hit.id);
		}
	}
	return conflicts;
}

function round(value: number): number {
	return Math.round(value * 10000) / 10000;
}
