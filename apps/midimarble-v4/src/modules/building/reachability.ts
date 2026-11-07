import type { TProject, TProjectCommand, TVec2 } from '@/modules/project';
import { gravityOf, IMPACT_SPEED, startRailOf, type THitResult, type TSimulationResult } from '@/modules/simulation';
import { formatTime, tieOf } from '@/modules/project';

// Why an open hit has no place for a platform, read from the marble's release and its simulated run, so
// the hit gets a status with a reason and a fix instead of a silent dead end.

export type THitReach =
	| { kind: 'reachable' }
	/** The marble has no marble that could play it */
	| { kind: 'noMarble' }
	/** The note comes before the marble is released, or so soon after that it cannot strike a platform yet */
	| { kind: 'tooSoon'; releaseTime: number; earliest: number }
	/** The marble has left the run before the note: it fell past the end of the simulation */
	| { kind: 'outOfReach'; lastTime: number }
	/** The marble lies still on a piece at the note, so a platform there could only stop it */
	| { kind: 'resting'; pieceId: string | null };

// A release this long before the note gives a marble room to fall onto a platform, like a new marble's
export const RELEASE_LEAD = 0.5;
const REST_WINDOW = 0.2;

/**
 * Whether the marble can reach an open hit, and why not. A marble needs to fall at least its diameter and reach
 * the strike speed before a platform under it plays a note; before that, and before the release, the note is
 * Too Soon. An open hit without a dot after the release means the marble has fallen off the track, unless an
 * earlier note of the same marble is still Open: that note is the next step, and the ones after it wait for it.
 */
export function hitReach(project: TProject, result: TSimulationResult | null, hit: THitResult): THitReach {
	if (hit.status !== 'open') return { kind: 'reachable' };
	const marble = project.marbles.find((item) => item.id === hit.marbleId);
	const release = marble?.start;
	if (marble == null || release == null) return { kind: 'noMarble' };
	const radius = marble.radius ?? 0.012;
	const earliest = release.time + strikeDelay(project, release, radius);
	// A marble started further along, on a Pattern, plays from there: the notes before its release are only not built yet
	if (hit.targetTime < release.time && (startRailOf(project, marble.id) != null || hasPiecesAfter(project, marble.id, hit.targetTime))) return { kind: 'reachable' };
	if (hit.targetTime < earliest) return { kind: 'tooSoon', releaseTime: release.time, earliest };
	// A run is only judged up to the first note still waiting for its platform: past it the marble falls
	// freely, so later notes stay Open until that note is placed
	const waiting = result?.hits.some((item) => item.marbleId === hit.marbleId && item.status === 'open' && item.targetTime < hit.targetTime - 1e-9) === true;
	if (waiting) return { kind: 'reachable' };
	const samples = result?.marbles.find((track) => track.marbleId === hit.marbleId)?.samples ?? [];
	if (hit.dot == null) return { kind: 'outOfReach', lastTime: samples[samples.length - 1]?.time ?? release.time };
	// Slower than a strike at the note, nothing placed there can sound it: the marble came down on the piece it left, and lies on it
	if (hit.velocity != null && Math.hypot(hit.velocity.x, hit.velocity.y) < strikeSpeed(project)) return { kind: 'resting', pieceId: lastPieceTouched(result, hit) };
	// Still for the last REST_WINDOW seconds, unlike the slow top of a bounce
	const before = samples.find((sample) => sample.time >= hit.targetTime - REST_WINDOW);
	if (before != null && before.time < hit.targetTime - REST_WINDOW / 2 && Math.hypot(hit.dot.x - before.position.x, hit.dot.y - before.position.y) < radius / 2)
		return { kind: 'resting', pieceId: lastPieceTouched(result, hit) };
	return { kind: 'reachable' };
}

function lastPieceTouched(result: TSimulationResult | null, hit: THitResult): string | null {
	return result?.contacts.filter((contact) => contact.marbleId === hit.marbleId && contact.kind === 'piece' && contact.time <= hit.targetTime).at(-1)?.otherId ?? null;
}

function hasPiecesAfter(project: TProject, marbleId: string, time: number): boolean {
	const marble = project.marbles.find((item) => item.id === marbleId);
	return project.track.pieces.some((piece) => {
		const tie = tieOf(piece);
		return tie?.marbleId === marbleId && (marble?.hits.find((hit) => hit.id === tie.hitId)?.time ?? -Infinity) > time;
	});
}

/** Seconds from a release until the marble has fallen its diameter and reached the strike speed */
function strikeDelay(project: TProject, release: { velocity?: TVec2 | undefined }, radius: number): number {
	const g = -gravityOf(project);
	const strike = strikeSpeed(project);
	const down = Math.max(0, -(release.velocity?.y ?? 0));
	const toSpeed = Math.max(0, (strike - down) / g);
	const toFall = (-down + Math.sqrt(down * down + 4 * g * radius)) / g;
	return Math.max(toSpeed, toFall);
}

/** The least speed that sounds a note. It scales with gravity in the simulation, so it does here too */
function strikeSpeed(project: TProject): number {
	return IMPACT_SPEED * (gravityOf(project) / gravityOf({}));
}

/**
 * The first time a tap on this marble can be played, to the next hundredth so it clearly can. A marble with no track
 * yet counts from 0:00, as its release follows its first hit (`releaseFollowsFirstHit`). Null without a marble.
 */
export function earliestHitTime(project: TProject, marbleId: string): number | null {
	const marble = project.marbles.find((item) => item.id === marbleId);
	const release = marble?.start;
	if (marble == null || release == null) return null;
	const from = hasNoTrack(project) ? 0 : release.time;
	return Math.ceil((from + strikeDelay(project, release, marble.radius ?? 0.012) + 0.005) * 100) / 100;
}

function hasNoTrack(project: TProject): boolean {
	return project.track.pieces.length === 0;
}

/**
 * With no track yet a marble has nothing to fall onto, so a first hit at 0:03 would be out of reach: each marble whose
 * first hit an edit of the hits changed is released `RELEASE_LEAD` before it, never before the song starts. Gives the
 * project with those releases; once there are pieces, or when the edit does more than hits, it stays as it was.
 */
export function releaseFollowsFirstHit(before: TProject, after: TProject, commands: readonly TProjectCommand[]): TProject {
	if (!hasNoTrack(after) || !commands.every((command) => HIT_EDITS.has(command.type))) return after;
	const firstTime = (project: TProject, marbleId: string): number | null => {
		const times = project.marbles.find((marble) => marble.id === marbleId)?.hits.map((hit) => hit.time) ?? [];
		return times.length ? Math.min(...times) : null;
	};
	const marbles = after.marbles.map((marble) => {
		const release = marble.start;
		const first = firstTime(after, marble.id);
		const was = firstTime(before, marble.id);
		if (first == null || first === was) return marble;
		// A marble on a start rail keeps the time the rail takes
		const hasRail = was != null && startRailOf(after, marble.id) != null;
		const time = Math.round(Math.max(0, first - (hasRail ? was - release.time : RELEASE_LEAD)) * 10000) / 10000;
		return time === release.time ? marble : { ...marble, start: { ...release, time } };
	});
	return marbles.some((marble, index) => marble !== after.marbles[index]) ? { ...after, marbles } : after;
}

const HIT_EDITS = new Set<TProjectCommand['type']>(['upsertHits', 'removeHits', 'assignHits']);

/**
 * What a click on an open note's dot does: says why no platform can play it, or shows what bridges its long gap or the
 * piece it would get. Only the platform is offered for now.
 */
export type TDotClickAction = { kind: 'explain' } | { kind: 'bridge'; fromHitId: string } | { kind: 'preview'; type: string };

export function dotClickAction(project: TProject, result: TSimulationResult, hit: THitResult, gap: { fromHitId: string } | undefined): TDotClickAction {
	if (isUnreachable(hitReach(project, result, hit))) return { kind: 'explain' };
	return gap != null ? { kind: 'bridge', fromHitId: gap.fromHitId } : { kind: 'preview', type: 'platform' };
}

/** Whether an open hit has a reason it cannot get a platform */
export function isUnreachable(reach: THitReach): boolean {
	return reach.kind !== 'reachable';
}

/** The status pill and its tooltip for an unreachable hit, in the words of the Timing statuses table */
export function reachStatus(reach: THitReach, names: { marble: string; time: string }): { label: string; detail: string } | null {
	switch (reach.kind) {
		case 'tooSoon':
			return { label: 'Too Soon', detail: `${names.marble} can't reach a platform by ${names.time}` };
		case 'outOfReach':
			return { label: 'Out of Reach', detail: `${names.marble} has fallen off the track by ${names.time}` };
		case 'resting':
			return { label: 'Out of Reach', detail: `${names.marble} lies still on a piece at ${names.time}` };
		case 'noMarble':
			return { label: 'Out of Reach', detail: 'No marble plays these notes' };
		case 'reachable':
			return null;
	}
}

/**
 * What N says when the next open hit cannot be reached: what happened, then what to do, naming the fixes on
 * offer. Without a song a tapped hit has no note to fall back to, so it is moved or deleted instead of made Backing.
 */
export function reachMessage(reach: THitReach, names: { hit: string; marble: string; piece?: string | undefined }, fix: TReleaseFix | null, hasSong = true): string | null {
	const away = hasSong ? 'make it Backing' : 'delete it';
	switch (reach.kind) {
		case 'tooSoon':
			if (fix != null) return `${names.hit} is too soon for ${names.marble}. Move the release earlier or ${away}.`;
			return hasSong
				? `${names.hit} is too soon for ${names.marble}. Make it Backing, or move the note later.`
				: `${names.hit} is too soon for ${names.marble}. Move the hit later or delete it.`;
		case 'outOfReach':
			return fix != null
				? `${names.marble} has fallen off the track before ${names.hit}. Move the release later or ${away}.`
				: `${names.marble} has fallen off the track before ${names.hit}. Add platforms for the notes before it or ${away}.`;
		case 'resting':
			return `${names.marble} lies still on ${names.piece ?? 'a piece'} before ${names.hit}. Turn or fix ${names.piece ?? 'it'}, or ${away}.`;
		case 'noMarble':
			return `No marble plays ${names.hit}. Add a marble or ${away}.`;
		case 'reachable':
			return null;
	}
}

/**
 * Whether notes can be made Backing. Backing notes show in the Song track's piano roll; a project without a song
 * has no Song track, so a tapped hit made Backing could not be seen or selected again.
 */
export function canMakeBacking(project: TProject): boolean {
	return project.songs.some((song) => song.path != null);
}

/**
 * Move Hit Later for a Too Soon tapped hit whose release cannot move earlier: the hit moves to the first time
 * the marble can strike a platform. Only in a project without a song, where hits are tapped rather than the
 * song's notes, and only while the hit stays before the marble's next one.
 */
export function moveHitLaterFix(project: TProject, hit: THitResult, reach: THitReach): { label: string; time: number; commands: TProjectCommand[] } | null {
	if (reach.kind !== 'tooSoon' || canMakeBacking(project)) return null;
	const marble = project.marbles.find((item) => item.id === hit.marbleId);
	const current = marble?.hits.find((item) => item.id === hit.hitId);
	if (marble == null || current == null) return null;
	// The next hundredth past the earliest strike, so the hit is clearly reachable
	const time = Math.ceil((reach.earliest + 0.005) * 100) / 100;
	const next = marble.hits.find((item) => item.id !== hit.hitId && item.time > current.time);
	if (time <= current.time || (next != null && time >= next.time - 0.01)) return null;
	return { label: 'Move Hit Later', time, commands: [{ type: 'upsertHits', marbleId: marble.id, hits: [{ ...current, time }] }] };
}

export interface TReleaseFix {
	/** Button title: Move Release Earlier or Move Release Later */
	label: string;
	commands: TProjectCommand[];
}

/**
 * The release change that makes an unreachable first note reachable: a Too Soon note moves the release
 * `RELEASE_LEAD` before it (never before the song starts), and a marble that fell out of the run before its
 * first note starts that long before the note instead. Null when no release time fixes it: a note too close to
 * the song's start, or a note after other notes of the marble, which the run before it decides.
 */
export function releaseFixFor(project: TProject, hit: THitResult, reach: THitReach): TReleaseFix | null {
	const marble = project.marbles.find((item) => item.id === hit.marbleId);
	if (marble == null) return null;
	const release = marble.start;
	const isFirst = marble.hits.every((item) => item.id === hit.hitId || item.time > hit.targetTime);
	if (!isFirst) return null;
	const time = Math.round(Math.max(0, hit.targetTime - RELEASE_LEAD) * 10000) / 10000;
	const command = (value: number): TProjectCommand[] => [{ type: 'updateMarble', marbleId: marble.id, patch: { start: { ...release, time: value } } }];
	if (reach.kind === 'tooSoon') {
		if (reach.earliest - release.time + time > hit.targetTime || time >= release.time) return null;
		return { label: 'Move Release Earlier', commands: command(time) };
	}
	if (reach.kind === 'outOfReach' && time > release.time) return { label: 'Move Release Later', commands: command(time) };
	return null;
}

/** The Too Soon or Out of Reach status of an open hit with its tooltip, or null when it can get a platform */
export function unreachableStatus(project: TProject, result: TSimulationResult | null, hit: THitResult): { label: string; detail: string } | null {
	if (hit.status !== 'open') return null;
	const marble = project.marbles.find((marble) => marble.id === hit.marbleId)?.name ?? 'The marble';
	return reachStatus(hitReach(project, result, hit), { marble, time: formatTime(hit.targetTime) });
}

/** Open hits that a marble reaches, in time order */
export function openHits(result: TSimulationResult): THitResult[] {
	return result.hits
		.filter((hit) => hit.status === 'open' && hit.dot != null)
		.sort((a, b) => a.targetTime - b.targetTime);
}
