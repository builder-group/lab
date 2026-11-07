import { BACKING_ID, createId, createMarble, MARBLE_SPACING, type THit, type TMarble, type TProject, type TProjectCommand, type TSong, backingOf, backingSong, tieOf } from '@/modules/project';
import { MIN_HIT_GAP } from './marble-proposal';
import type { TMidiNote } from './midi';

/**
 * Creates marbles for proposed note lists and adds the other notes to Backing, on the song when there is one. Empty
 * projects are replaced so a fresh import starts clean; projects with hits keep their marbles and Backing and gain new
 * ones.
 */
export function createImportCommands(
	project: TProject,
	options: TImportCommandsOptions
): TProjectCommand[] {
	const { marbles, names = [], backing = [], backingInstrument, source, keepsBacking = false, instrument } = options;
	const hasHits = project.marbles.some((marble) => marble.hits.length > 0);
	const commands: TProjectCommand[] = [];
	let index = project.marbles.length;
	const backingHits = backing.map((note) => noteToHit(note));
	const backingSound = backingInstrument != null ? { backingSound: backingInstrument } : {};

	if (source != null) commands.push({ type: 'addSong', song: { ...source, backing: [...source.backing, ...backingHits], ...backingSound } });
	if (!hasHits) {
		for (const marble of project.marbles) commands.push({ type: 'removeMarble', marbleId: marble.id });
		if (!keepsBacking && backingOf(project).length > 0) {
			commands.push({ type: 'removeHits', marbleId: BACKING_ID, hitIds: backingOf(project).map((hit) => hit.id) });
		}
		index = 0;
	}

	const takenNames = new Set(hasHits ? project.marbles.map((marble) => marble.name) : []);
	for (const [marbleIndex, notes] of marbles.entries()) {
		const named = names[marbleIndex];
		const created = createMarble(index, { x: index * MARBLE_SPACING, y: 0.6 });
		const hits = notes.map((note) => noteToHit(note, source?.id));
		// Released a short drop before its first note, so the film does not open on a long empty fall
		const first = hits.reduce((min, hit) => Math.min(min, hit.time), Infinity);
		const marble: TMarble = {
			...created,
			...(named != null && !takenNames.has(named) ? { name: named } : {}),
			sound: instrument ?? created.sound,
			start: Number.isFinite(first) ? { ...created.start, time: round(Math.max(0, first - IMPORT_RELEASE_LEAD)) } : created.start,
			hits
		};
		commands.push({ type: 'addMarble', marble });
		index++;
	}
	if (source == null) {
		const holder = backingSong(project);
		if (holder == null) {
			if (backingHits.length > 0) commands.push({ type: 'addSong', song: { id: createId('song'), name: '', kind: 'midi', start: 0, backing: backingHits, ...backingSound } });
		} else {
			if (backingHits.length > 0) commands.push({ type: 'upsertHits', marbleId: BACKING_ID, hits: backingHits });
			if (backingInstrument != null) commands.push({ type: 'updateSong', songId: holder.id, patch: { backingSound: backingInstrument } });
		}
	}
	// A fresh import fits the film to the song; an import next to existing hits only lengthens it
	const played = marbles.flat().length > 0 ? marbles.flat() : backing;
	if (played.length > 0) {
		const end = songEnd(played.reduce((max, note) => Math.max(max, note.time), 0));
		if (!hasHits ? Math.abs(end - project.length) > 1e-6 : end > project.length) commands.push({ type: 'updateProject', patch: { length: end } });
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
 * Seconds a film runs on after the last note while every marble that plays last has a Bowl but its run is not
 * measured yet, or a Bowl misses: long enough to show the catch. A measured run replaces it
 * (`bowlTail`).
 */
export const BOWL_TAIL = 1.2;

/**
 * The bounds of a measured tail: below 0.6 s the catch has not read yet, and past 1.5 s the film holds on a marble that
 * stays in frame, as in a Bowl
 */
export const BOWL_TAIL_MIN = 0.6;
export const BOWL_TAIL_MAX = 1.5;

/** Seconds the frame stays after the marble has left it, so the film does not cut on the marble's last pixel */
const BOWL_TAIL_MARGIN = 0.1;

/**
 * Tail for a marble that leaves the frame `exit` seconds after the last note (`bowlExit`, `Infinity` if it stays),
 * clamped to `BOWL_TAIL_MIN` and `BOWL_TAIL_MAX`, or `BOWL_TAIL` without a measurement
 */
export function bowlTail(exit: number | null): number {
	if (exit == null) return BOWL_TAIL;
	return Math.round(Math.min(BOWL_TAIL_MAX, Math.max(BOWL_TAIL_MIN, exit + BOWL_TAIL_MARGIN)) * 100) / 100;
}

/** The piece type that catches a marble after its last note */
const BOWL_TYPE = 'bowl';

/** Film length for a song whose last note starts at `lastNote`, rounded to 0.01 s */
export function songEnd(lastNote: number, tail = SONG_TAIL): number {
	return Math.round((lastNote + tail) * 100) / 100;
}

/**
 * The marbles that play last: those whose last hit falls within `BOWL_TAIL` of the song's last hit, so they
 * would still fall through the frame during a Bowl's tail. Marble IDs, empty without hits.
 */
export function lastPlayingMarbles(project: TProject): string[] {
	const lasts = project.marbles.flatMap((marble) => (marble.hits.length ? [{ id: marble.id, time: Math.max(...marble.hits.map((hit) => hit.time)) }] : []));
	if (!lasts.length) return [];
	const last = Math.max(...lasts.map((item) => item.time));
	return lasts.filter((item) => item.time >= last - BOWL_TAIL - 1e-9).map((item) => item.id);
}

/** Whether a marble's marble has a Bowl, the piece that catches it after its last note */
export function hasBowl(project: TProject, marbleId: string): boolean {
	return project.track.pieces.some((piece) => piece.type === BOWL_TYPE && tieOf(piece)?.marbleId === marbleId);
}

/** Whether every marble that plays last has a Bowl, so the film ends on the catch */
export function endsOnBowl(project: TProject): boolean {
	const marbles = lastPlayingMarbles(project);
	return marbles.length > 0 && marbles.every((marbleId) => hasBowl(project, marbleId));
}

/**
 * The one rule for how long a film runs on after its last note: `bowlTail` when every marble that plays last has
 * a Bowl, from `exit`, the seconds until the last marble leaves the frame (`bowlExit`, null while unmeasured or
 * when a Bowl misses its marble); else `SONG_TAIL`. The problem model says whether a Bowl catches its marble
 * ("Melody misses the Bowl").
 */
export function filmTail(project: TProject, exit: number | null = null): number {
	return endsOnBowl(project) ? bowlTail(exit) : SONG_TAIL;
}

/** The length that fits the project's song: its last hit plus `filmTail`; null without notes */
export function projectSongEnd(project: TProject, exit: number | null = null): number | null {
	const last = lastHitTime(project);
	return last == null ? null : songEnd(last, filmTail(project, exit));
}

/** The length of a new project (`createProject`) before it has hits */
export const DEFAULT_PROJECT_END = 12;

/** Time of the last hit the marbles play, or of Backing without them; null without notes */
export function lastHitTime(project: TProject): number | null {
	const played = project.marbles.flatMap((marble) => marble.hits.map((hit) => hit.time));
	const times = played.length ? played : backingOf(project).map((hit) => hit.time);
	return times.length ? Math.max(...times) : null;
}

/**
 * Whether the length still follows the song: the untouched default of a new project, the last hit plus `SONG_TAIL`,
 * or plus a tail between `BOWL_TAIL_MIN` and `BOWL_TAIL_MAX` when the film ends on a Bowl, as an import, Fit to
 * Song or the automatic fit left it. A length the user set to anything else is theirs and never changes silently.
 */
export function isAutoEnd(project: TProject): boolean {
	if (Math.abs(project.length - DEFAULT_PROJECT_END) < 1e-6) return true;
	const last = lastHitTime(project);
	if (last == null) return false;
	if (Math.abs(project.length - songEnd(last, SONG_TAIL)) < 0.005) return true;
	const tail = project.length - last;
	return endsOnBowl(project) && tail > BOWL_TAIL_MIN - 0.005 && tail < BOWL_TAIL_MAX + 0.005;
}

/**
 * Whether the length already is what the tail rule gives, so Fit to Song has nothing to do: the last hit plus
 * `SONG_TAIL`, or plus a measured tail between the bounds when the film ends on a Bowl
 */
export function fitsSong(project: TProject): boolean {
	const last = lastHitTime(project);
	if (last == null) return false;
	if (!endsOnBowl(project)) return Math.abs(project.length - songEnd(last, SONG_TAIL)) < 0.005;
	const tail = project.length - last;
	return tail > BOWL_TAIL_MIN - 0.005 && tail < BOWL_TAIL_MAX + 0.005;
}

/**
 * Seconds between an imported marble's release and its first note: a 0.6 m drop at half gravity. Shorter leads
 * built Jingle Bells worse (0.35 s crossed the marbles), as the first arrival speed shapes the whole run.
 */
export const IMPORT_RELEASE_LEAD = 0.5;

export interface TImportCommandsOptions {
	marbles: TMidiNote[][];
	// What to call each marble; null or missing keeps "Marble 1"
	names?: readonly (string | null)[];
	// Notes no marble plays
	backing?: TMidiNote[];
	// General MIDI program Backing plays with
	backingInstrument?: number;
	source?: TSong;
	instrument?: number;
	// Another song stays, so its Backing does too
	keepsBacking?: boolean;
}

export function noteToHit(note: TMidiNote, songId?: string): THit {
	return {
		id: createId('hit'),
		time: round(note.time),
		pitch: note.pitch,
		velocity: round(note.velocity),
		...(note.duration > 0 ? { duration: round(note.duration) } : {}),
		...(songId != null ? { songId } : {})
	};
}

/** Hits that follow their predecessor too closely for one marble */
export function findMarbleConflicts(marble: TMarble): Set<string> {
	const conflicts = new Set<string>();
	for (let index = 1; index < marble.hits.length; index++) {
		const previous = marble.hits[index - 1];
		const hit = marble.hits[index];
		if (previous == null || hit == null) continue;
		if (hit.time - previous.time < MIN_HIT_GAP - 1e-9) {
			conflicts.add(previous.id);
			conflicts.add(hit.id);
		}
	}
	return conflicts;
}

function round(value: number): number {
	return Math.round(value * 10000) / 10000;
}
