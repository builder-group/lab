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
 * Too Soon. An open hit without a dot after the release means the marble has fallen out of the run.
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
	const samples = result?.marbles.find((track) => track.laneId === hit.laneId)?.samples ?? [];
	if (hit.dot == null) return { kind: 'outOfReach', lastTime: samples[samples.length - 1]?.time ?? release.time };
	// Still for the last REST_WINDOW seconds, unlike the slow top of a bounce
	const before = samples.find((sample) => sample.time >= hit.targetTime - REST_WINDOW);
	if (before != null && before.time < hit.targetTime - REST_WINDOW / 2 && Math.hypot(hit.dot.x - before.position.x, hit.dot.y - before.position.y) < radius / 2) return { kind: 'resting' };
	return { kind: 'reachable' };
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
			return { label: 'Out of Reach', detail: 'No marble plays this track' };
		case 'reachable':
			return null;
	}
}

/** What N says when the next open hit cannot be reached: what happened, then what to do */
export function reachMessage(reach: THitReach, names: { hit: string; marble: string }, fix: TReleaseFix | null): string | null {
	switch (reach.kind) {
		case 'tooSoon':
			return fix != null
				? `${names.hit} is too soon for ${names.marble}. Move the release earlier or make it Backing.`
				: `${names.hit} is too soon for ${names.marble}. Make it Backing, or move the note later.`;
		case 'outOfReach':
			return fix != null
				? `${names.marble} has fallen out of the run before ${names.hit}. Move the release later or make it Backing.`
				: `${names.marble} has fallen out of the run before ${names.hit}. Add platforms for the notes before it or make it Backing.`;
		case 'resting':
			return `${names.marble} lies still before ${names.hit}. Fix the platform it stops on or make it Backing.`;
		case 'noMarble':
			return `No marble plays ${names.hit}. Add a marble or make it Backing.`;
		case 'reachable':
			return null;
	}
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

/** Open hits that cannot get a platform, for the hit summary */
export function unreachableHits(project: TProject, result: TSimulationResult | null): THitResult[] {
	if (result == null) return [];
	return result.hits.filter((hit) => hit.status === 'open' && isUnreachable(hitReach(project, result, hit)));
}

/** The Too Soon or Out of Reach status of an open hit with its tooltip, or null when it can get a platform */
export function unreachableStatus(project: TProject, result: TSimulationResult | null, hit: THitResult): { label: string; detail: string } | null {
	if (hit.status !== 'open') return null;
	const marble = project.music.lanes.find((lane) => lane.id === hit.laneId)?.name ?? 'The marble';
	return reachStatus(hitReach(project, result, hit), { marble, time: formatTime(hit.targetTime) });
}
