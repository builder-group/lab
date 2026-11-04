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

/**
 * Seconds a film runs on after the last note when every marble that plays last has a Finish (`filmTail`): the
 * camera's held ending frames the Finish; the marble lands in it 0.38 to 0.49 s after its last note, rolls off the
 * Chute's end 0.83 to 0.87 s after it and leaves the held frame 1 s after it in Jingle Bells, while Reference 20's
 * stays in frame past 1.5 s. 1.2 s shows the catch and the roll-out and ends as the marble falls away, with at most
 * 0.2 s of empty chute (1.5 s left Jingle Bells 0.5 s on it)
 */
export const FINISH_TAIL = 1.2;

/** The piece type that catches a marble after its last note */
const FINISH_TYPE = 'finish';

/** Film length for a song whose last note starts at `lastNote`, rounded to 0.01 s */
export function songEnd(lastNote: number, tail = SONG_TAIL): number {
	return Math.round((lastNote + tail) * 100) / 100;
}

/**
 * The marbles that play last: those whose last hit falls within `FINISH_TAIL` of the song's last hit, so they
 * would still fall through the frame during a Finish's tail. Lane IDs, empty without hits.
 */
export function lastPlayingLanes(project: TProject): string[] {
	const lasts = project.music.lanes.flatMap((lane) => (lane.hits.length ? [{ id: lane.id, time: Math.max(...lane.hits.map((hit) => hit.time)) }] : []));
	if (!lasts.length) return [];
	const last = Math.max(...lasts.map((item) => item.time));
	return lasts.filter((item) => item.time >= last - FINISH_TAIL - 1e-9).map((item) => item.id);
}

/** Whether a marble's lane has a Finish, the piece that catches it after its last note */
export function hasFinish(project: TProject, laneId: string): boolean {
	return project.entities.some((entity) => entity.components.piece?.type === FINISH_TYPE && entity.components.hitLink?.laneId === laneId);
}

/**
 * The one rule for how long a film runs on after its last note: `FINISH_TAIL` when every marble that plays last
 * has a Finish, so the film ends on the catch, else `SONG_TAIL`. Whether the Finish catches its marble is the
 * problem model's to say ("Melody misses the Finish"); the length follows the pieces, so it never changes with a run.
 */
export function filmTail(project: TProject): number {
	const lanes = lastPlayingLanes(project);
	return lanes.length > 0 && lanes.every((laneId) => hasFinish(project, laneId)) ? FINISH_TAIL : SONG_TAIL;
}

/** The length that fits the project's song: its last hit plus `filmTail`; null without notes */
export function projectSongEnd(project: TProject): number | null {
	const last = lastHitTime(project);
	return last == null ? null : songEnd(last, filmTail(project));
}

/** The length of a new project (`createProject`) before it has hits */
export const DEFAULT_PROJECT_END = 12;

/** Time of the last hit the marbles play, or of Backing without them; null without notes */
export function lastHitTime(project: TProject): number | null {
	const played = project.music.lanes.flatMap((lane) => lane.hits.map((hit) => hit.time));
	const times = played.length ? played : project.music.backing.map((hit) => hit.time);
	return times.length ? Math.max(...times) : null;
}

/**
 * Whether the length still follows the song: the untouched default of a new project, or the last hit plus
 * `SONG_TAIL` or `FINISH_TAIL`, as an import, Fit to Song or the automatic fit left it. A length the user set to
 * anything else is theirs and never changes silently.
 */
export function isAutoEnd(project: TProject): boolean {
	if (Math.abs(project.end - DEFAULT_PROJECT_END) < 1e-6) return true;
	const last = lastHitTime(project);
	return last != null && [SONG_TAIL, FINISH_TAIL].some((tail) => Math.abs(project.end - songEnd(last, tail)) < 0.005);
}

/**
 * The length after an edit of the hits or the Finishes, while it follows the song: the last hit plus `filmTail`, so
 * a tapped project ends with its last hit instead of filming 8 s of empty wall, and a Finish added for the last
 * marble lengthens the film to show the catch. `before` is the project the edit started from; a length the user
 * set, an edit without notes and an edit that keeps the length give null.
 */
export function autoEnd(before: TProject, after: TProject): number | null {
	if (!isAutoEnd(before)) return null;
	const end = projectSongEnd(after);
	if (end == null) return null;
	return Math.abs(end - after.end) < 1e-6 ? null : end;
}

/** Whether an edit changes notes without setting the length itself, so the length may follow the song (`autoEnd`) */
export function changesHitsOnly(commands: readonly TProjectCommand[]): boolean {
	if (commands.some((command) => command.type === 'setEnd')) return false;
	return commands.some((command) => HIT_COMMANDS.has(command.type));
}

/**
 * Whether an edit that does not set the length changes the film's tail, by adding or removing the Finish of a marble
 * that plays last, so the length may follow the song (`autoEnd`)
 */
export function changesTail(commands: readonly TProjectCommand[], before: TProject, after: TProject): boolean {
	if (commands.some((command) => command.type === 'setEnd')) return false;
	return filmTail(before) !== filmTail(after);
}

const HIT_COMMANDS = new Set<TProjectCommand['type']>(['upsertLane', 'removeLane', 'upsertHits', 'removeHits', 'assignHits']);

/**
 * Fit to Song to offer where the user set the length: the fitted length when the song ends more than
 * `FIT_OFFER_GAP` before it, or after it, so its last hits are cut off. Null while the length follows the song.
 */
export function fitToSongOffer(project: TProject): number | null {
	const end = projectSongEnd(project);
	if (end == null || isAutoEnd(project)) return null;
	return end < project.end - FIT_OFFER_GAP || end > project.end + 1e-6 ? end : null;
}

// Seconds of film past the song's end before Fit to Song is offered
const FIT_OFFER_GAP = 1;

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
