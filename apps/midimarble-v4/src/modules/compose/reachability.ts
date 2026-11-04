import type { TProject, TProjectCommand } from '@/modules/project';
import { gravityOf, IMPACT_SPEED, type THitResult, type TSimulationResult } from '@/modules/simulation';
import { formatTime } from '@/modules/studio/format';

// Why an open hit has no place for a platform, read from the marble's release and its simulated run, so
// the hit gets a status with a reason and a fix instead of a silent dead end.

export type THitReach =
	| { kind: 'reachable' }
	/** The lane has no marble that could play it */
	| { kind: 'noMarble' }
	/** The note comes before the marble is released, or so soon after that it cannot strike a platform yet */
	| { kind: 'tooSoon'; releaseTime: number; earliest: number }
	/** The marble has left the run before the note: it fell past the end of the simulation */
	| { kind: 'outOfReach'; lastTime: number }
	/** The marble lies still on a piece at the note, so a platform there could only stop it */
	| { kind: 'resting' };

// A release this long before the note gives a marble room to fall onto a platform, like a new marble's
export const RELEASE_LEAD = 0.5;
const REST_WINDOW = 0.2;

/**
 * Whether the marble can reach an open hit, and why not. A marble needs to fall at least its diameter and reach
 * the strike speed before a platform under it plays a note; before that, and before the release, the note is
 * Too Soon. An open hit without a dot after the release means the marble has fallen out of the run, unless an
 * earlier note of the same marble is still Open: that note is the next step, and the ones after it wait for it.
 */
export function hitReach(project: TProject, result: TSimulationResult | null, hit: THitResult): THitReach {
	if (hit.status !== 'open') return { kind: 'reachable' };
	const marble = project.entities.find((entity) => entity.components.marble?.laneId === hit.laneId);
	const release = marble?.components.release;
	if (marble == null || release == null) return { kind: 'noMarble' };
	const g = -gravityOf(project);
	const radius = marble.components.marble?.radius ?? 0.012;
	// Strike speed scales with gravity in the simulation, so it does here too
	const strike = IMPACT_SPEED * (g / -gravityOf({}));
	const down = Math.max(0, -(release.velocity?.y ?? 0));
	const toSpeed = Math.max(0, (strike - down) / g);
	const toFall = (-down + Math.sqrt(down * down + 4 * g * radius)) / g;
	const earliest = release.time + Math.max(toSpeed, toFall);
	if (hit.targetTime < earliest) return { kind: 'tooSoon', releaseTime: release.time, earliest };
	// A run is only judged up to the first note still waiting for its platform: past it the marble falls
	// freely, so later notes stay Open until that note is placed
	const waiting = result?.hits.some((item) => item.laneId === hit.laneId && item.status === 'open' && item.targetTime < hit.targetTime - 1e-9) === true;
	if (waiting) return { kind: 'reachable' };
	const samples = result?.marbles.find((track) => track.laneId === hit.laneId)?.samples ?? [];
	if (hit.dot == null) return { kind: 'outOfReach', lastTime: samples[samples.length - 1]?.time ?? release.time };
	// Still for the last REST_WINDOW seconds, unlike the slow top of a bounce
	const before = samples.find((sample) => sample.time >= hit.targetTime - REST_WINDOW);
	if (before != null && before.time < hit.targetTime - REST_WINDOW / 2 && Math.hypot(hit.dot.x - before.position.x, hit.dot.y - before.position.y) < radius / 2)
		return { kind: 'resting' };
	return { kind: 'reachable' };
}

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
			return { label: 'Out of Reach', detail: `${names.marble} has fallen out of the run by ${names.time}` };
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
export function reachMessage(reach: THitReach, names: { hit: string; marble: string }, fix: TReleaseFix | null, hasSong = true): string | null {
	const away = hasSong ? 'make it Backing' : 'delete it';
	switch (reach.kind) {
		case 'tooSoon':
			if (fix != null) return `${names.hit} is too soon for ${names.marble}. Move the release earlier or ${away}.`;
			return hasSong
				? `${names.hit} is too soon for ${names.marble}. Make it Backing, or move the note later.`
				: `${names.hit} is too soon for ${names.marble}. Move the hit later or delete it.`;
		case 'outOfReach':
			return fix != null
				? `${names.marble} has fallen out of the run before ${names.hit}. Move the release later or ${away}.`
				: `${names.marble} has fallen out of the run before ${names.hit}. Add platforms for the notes before it or ${away}.`;
		case 'resting':
			return `${names.marble} lies still before ${names.hit}. Fix the platform it stops on or ${away}.`;
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
	return project.music.sources.length > 0;
}

/**
 * Move Hit Later for a Too Soon tapped hit whose release cannot move earlier: the hit moves to the first time
 * the marble can strike a platform. Only in a project without a song, where hits are tapped rather than the
 * song's notes, and only while the hit stays before the marble's next one.
 */
export function moveHitLaterFix(project: TProject, hit: THitResult, reach: THitReach): { label: string; time: number; commands: TProjectCommand[] } | null {
	if (reach.kind !== 'tooSoon' || canMakeBacking(project)) return null;
	const lane = project.music.lanes.find((item) => item.id === hit.laneId);
	const current = lane?.hits.find((item) => item.id === hit.hitId);
	if (lane == null || current == null) return null;
	// The next hundredth past the earliest strike, so the hit is clearly reachable
	const time = Math.ceil((reach.earliest + 0.005) * 100) / 100;
	const next = lane.hits.find((item) => item.id !== hit.hitId && item.time > current.time);
	if (time <= current.time || (next != null && time >= next.time - 0.01)) return null;
	return { label: 'Move Hit Later', time, commands: [{ type: 'upsertHits', laneId: lane.id, hits: [{ ...current, time }] }] };
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
	const marble = project.entities.find((entity) => entity.components.marble?.laneId === hit.laneId);
	const release = marble?.components.release;
	const lane = project.music.lanes.find((item) => item.id === hit.laneId);
	if (marble == null || release == null || lane == null) return null;
	const isFirst = lane.hits.every((item) => item.id === hit.hitId || item.time > hit.targetTime);
	if (!isFirst) return null;
	const time = Math.round(Math.max(0, hit.targetTime - RELEASE_LEAD) * 10000) / 10000;
	const command = (value: number): TProjectCommand[] => [{ type: 'setComponent', entityId: marble.id, component: { name: 'release', value: { ...release, time: value } } }];
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
	const marble = project.music.lanes.find((lane) => lane.id === hit.laneId)?.name ?? 'The marble';
	return reachStatus(hitReach(project, result, hit), { marble, time: formatTime(hit.targetTime) });
}
