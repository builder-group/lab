import { cachedFollowCameraTrack, framingStretches, isInFrame, type TCameraTrack, type TFramingStretch } from '@/modules/camera';
import { hitReach, isUnreachable, reachStatus } from './reachability';
import { hasSong } from '@/modules/music';
import type { TProject, TVec2 } from '@/modules/project';
import { extraStrikes, BOWL_TYPE, bowlCatch, LONG_FALL, getPieceDefinition, passThroughs, rollingHits, soundsHit, touchingPairs, type THitResult, type TSimulationResult } from '@/modules/simulation';
import { formatTime, CAMERA_KEY, toHitKey } from '@/modules/project';
import { problemsInTimeOrder } from './hit-status';
import { decorOverlaps, overlapLabel, type TBlenderObject, getRenderPreset } from '@/modules/scene';

/** For a run with no Blender to ask: a worker, a script or a test */
export const NO_BLENDER_OBJECTS: readonly TBlenderObject[] = [];

/**
 * The project's problems, like Xcode's issue navigator: hits that miss or drift, hits no platform can reach yet,
 * Blocked scenery, marbles the camera leaves out of frame while they play, stray contacts, platforms struck twice or rolled on,
 * pieces that touch, the loop and a stale result. It is the one source for the hit summary in the timeline header, its menu, the export sheet and the
 * Camera track. Warnings are problems the film will show; notes are worth a look. Neither blocks the export.
 */
export function preflightExport(project: TProject, result: TSimulationResult | null, blenderObjects: readonly TBlenderObject[]): TExportPreflight {
	if (result == null || result.revision !== project.revision) {
		return {
			state: 'pending',
			issues: [{ id: 'simulation', kind: 'simulation', severity: 'info', title: 'Checking the track…', detail: 'The run is still updating after the latest edit.', target: null }],
			summary: 'Checking the track…',
			warnings: 0,
			notes: 1,
			hitCount: countHits(project),
			onTimeCount: 0
		};
	}

	const memo = preflightMemo.get(result.hits);
	if (memo?.project === project && memo.blenderObjects === blenderObjects && isSameRun(memo.result, result)) return memo.preflight;

	const names = createNames(project);
	const issues: TPreflightIssue[] = withoutBehindBreak(project, result, [
		...hitIssues(project, result, names),
		...sceneryIssues(project, result, names),
		...bowlIssues(project, result, names),
		...contactIssues(project, result, names),
		...strikeIssues(project, result, names),
		...rollIssues(project, result, names),
		...touchingIssues(project, result, names),
		...passIssues(project, result, names),
		...fallIssues(project, result, names),
		...framingIssues(project, result, names),
		...titleIssues(project),
		...decorIssues(project, result, names, blenderObjects),
		...songIssues(project)
	]);
	issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || (a.time ?? Infinity) - (b.time ?? Infinity));

	const warnings = issues.filter((issue) => issue.severity === 'warning').length;
	const notes = issues.length - warnings;
	const hitCount = result.hits.length;
	const onTimeCount = result.hits.filter((hit) => hit.status === 'onTime').length;
	const checked: TExportPreflight = { state: 'checked', issues, summary: '', warnings, notes, hitCount, onTimeCount };
	// The sheet says what the hit summary says, with the tips after it
	const tips = notes > 0 ? `${notes} ${notes === 1 ? 'tip' : 'tips'}` : '';
	const summary = problemSummary(checked);
	const preflight = { ...checked, summary: [summary.label, summary.needsSong ? ADD_SONG_LABEL : '', tips].filter(Boolean).join(' · ') };
	preflightMemo.set(result.hits, { project, result, blenderObjects, preflight });
	return preflight;
}

// Layers, the title bar, the hit summary, the inspector and the Camera track all ask about the same run. Fix and the
// assists ask about a copy stamped with the project's revision, so the run is known by its hits, not by its object.
const preflightMemo = new WeakMap<THitResult[], { project: TProject; result: TSimulationResult; blenderObjects: readonly TBlenderObject[]; preflight: TExportPreflight }>();

/** The same run under another revision stamp: nothing else differs, field by field */
function isSameRun(a: TSimulationResult, b: TSimulationResult): boolean {
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof TSimulationResult>;
	return [...keys].every((key) => key === 'revision' || a[key] === b[key]);
}

export const ADD_SONG_LABEL = 'Add a Song';

/** An older project can have hits without a Song; it plays silently and exports silently, which the sheet warns of */
function songIssues(project: TProject): TPreflightIssue[] {
	if (hasSong(project) || countHits(project) === 0) return [];
	return [{ id: 'song', kind: 'song', severity: 'warning', title: ADD_SONG_LABEL, detail: 'This project has hits but no song, so the film has no sound.', target: null }];
}

export type TProblemWorkspace = 'track' | 'film';

/** Where a problem gets fixed: camera framing, titles and Decor in Film, everything about the run in Track */
export function problemWorkspace(issue: TPreflightIssue): TProblemWorkspace {
	return issue.kind === 'framing' || issue.kind === 'title' || issue.kind === 'decor' ? 'film' : 'track';
}

/** Each workspace's open problems, for the dot on the other workspace's switch */
export function workspaceProblems(preflight: TExportPreflight): Record<TProblemWorkspace, number> {
	const counts = { track: 0, film: 0 };
	for (const issue of preflight.issues) if (issue.severity === 'warning' && issue.kind !== 'song') counts[problemWorkspace(issue)] += 1;
	return counts;
}

/**
 * The hit summary of the timeline header, read from the preflight so it never disagrees with the export sheet,
 * Layers or the Camera track: "107 of 109 hits on time · 4 other problems", "2 hits need attention", or
 * "Checking…" until the run for the current edit arrives. Problems are the warnings in time order, so the
 * summary's click and Show First Problem go to the earliest. With a workspace it counts only that workspace's
 * problems, so Track never speaks of the camera; the export sheet passes none and lists them all.
 */
export function problemSummary(preflight: TExportPreflight, workspace?: TProblemWorkspace): TProblemSummary {
	const { hitCount: total, onTimeCount: onTime } = preflight;
	if (preflight.state === 'pending') return { state: 'pending', tone: 'neutral', label: 'Checking…', problems: [], hitProblems: 0, otherProblems: 0, needsSong: false, onTime, total };
	// A missing Song is asked for beside the summary, not counted among the problems of the run
	const problems = problemsInTimeOrder(preflight.issues.filter((issue) => issue.severity === 'warning' && issue.kind !== 'song' && (workspace == null || problemWorkspace(issue) === workspace)));
	const needsSong = preflight.issues.some((issue) => issue.kind === 'song');
	const hitProblems = problems.filter((issue) => issue.kind === 'hit').length;
	const otherProblems = problems.length - hitProblems;
	const hits =
		hitProblems > 0
			? `${hitProblems} ${hitProblems === 1 ? 'hit needs' : 'hits need'} attention`
			: total > 0
				? `${onTime} of ${total} ${total === 1 ? 'hit' : 'hits'} on time`
				: '';
	const others = otherProblems > 0 ? `${otherProblems} ${hits === '' ? '' : 'other '}${otherProblems === 1 ? 'problem' : 'problems'}` : '';
	const label = [hits, others].filter(Boolean).join(' · ') || 'No hits yet';
	const tone = problems.length > 0 ? 'warn' : total > 0 && onTime === total ? 'good' : 'neutral';
	return { state: 'checked', tone, label, problems, hitProblems, otherProblems, needsSong, onTime, total };
}

/**
 * The pieces another marble hits outside a note, by entity ID, with those problems: "Bass hits Rail 6 of
 * Melody". Layers badges them and the inspector shows a pill and a fix, from the same list as the summary.
 */
export function struckPieces(preflight: TExportPreflight): Map<string, TPreflightIssue[]> {
	const struck = new Map<string, TPreflightIssue[]>();
	for (const issue of preflight.issues) {
		// Contacts between two marbles carry no lane; they are about the marbles, not a piece
		const id = issue.kind === 'contact' && issue.marbleId != null ? issue.target?.ids[0] : undefined;
		if (id != null) struck.set(id, [...(struck.get(id) ?? []), issue]);
	}
	return struck;
}

/**
 * The framing problem at `time`, as the Camera panel shows it after a jump to it: the one whose span holds the time.
 * Null when there is none.
 */
export function framingProblemAt(preflight: TExportPreflight, time: number): TPreflightIssue | null {
	return preflight.issues.find((issue) => issue.kind === 'framing' && issue.span != null && time >= issue.span.from - 1e-6 && time <= issue.span.to + 1e-6) ?? null;
}

/**
 * Platforms a marble strikes twice, rolls on or passes through and pieces that touch, by entity ID, with those problems: Layers badges them and the
 * inspector shows a pill and Fix, from the same list as the summary.
 */
export function pieceProblems(preflight: TExportPreflight): Map<string, TPreflightIssue[]> {
	const problems = new Map<string, TPreflightIssue[]>();
	for (const issue of preflight.issues) {
		if (issue.kind !== 'strike' && issue.kind !== 'roll' && issue.kind !== 'touching' && issue.kind !== 'passes') continue;
		for (const id of issue.target?.ids ?? []) problems.set(id, [...(problems.get(id) ?? []), issue]);
	}
	return problems;
}

export interface TProblemSummary {
	state: TExportPreflight['state'];
	tone: 'good' | 'warn' | 'neutral';
	label: string;
	/**
	 * Warnings in time order, as the problem menu lists them and Show First Problem picks the first: by their time,
	 * a framing span's start or their target's time; issues without one come last
	 */
	problems: TPreflightIssue[];
	hitProblems: number;
	otherProblems: number;
	/** Hits without a Song: the film would be silent, so the summary asks for one */
	needsSong: boolean;
	onTime: number;
	total: number;
}

export interface TExportPreflight {
	/** `pending` while the shown result belongs to an older revision or there is none yet */
	state: 'pending' | 'checked';
	/** Warnings first, then notes, each in time order */
	issues: TPreflightIssue[];
	/** One line for the sheet and the Output panel, such as "All 115 hits on time" or "3 issues" */
	summary: string;
	warnings: number;
	notes: number;
	hitCount: number;
	onTimeCount: number;
}

export type TPreflightSeverity = 'warning' | 'info';

/**
 * While pieces wait behind a break, the break is the one thing to fix: what the marble does after it, flying off, is no
 * problem of the track's, so nothing later of that marble is listed, and with no marble named nothing after the first break.
 */
function withoutBehindBreak(project: TProject, result: TSimulationResult, issues: TPreflightIssue[]): TPreflightIssue[] {
	const breaks = new Map<string, number>();
	for (const hit of result.hits) {
		if (hit.status !== 'missed' && hit.status !== 'blocked') continue;
		const waits = project.entities.find((entity) => entity.id === hit.pieceEntityId)?.components.hitLink?.held != null;
		if (waits && hit.targetTime < (breaks.get(hit.marbleId) ?? Infinity)) breaks.set(hit.marbleId, hit.targetTime);
	}
	if (breaks.size === 0) return issues;
	const first = Math.min(...breaks.values());
	return issues.filter((issue) => issue.time == null || issue.time <= (issue.marbleId != null ? (breaks.get(issue.marbleId) ?? Infinity) : first));
}

export interface TPreflightIssue {
	/** Stable within one result, for React keys */
	id: string;
	/**
	 * What the issue is about: `hit` for a hit that is not on time or cannot be reached, which the hit summary
	 * counts as hits; `framing` for the camera losing a marble, drawn on the Camera track; the rest are other problems
	 */
	kind: TPreflightKind;
	severity: TPreflightSeverity;
	/** For a marble hitting another lane's piece, that marble's name: "Bass" in "Bass hits Rail 6 of Melody" */
	by?: string;
	/** The marble the issue is about: for hit, framing, pace and Blocked scenery issues, and for a marble hitting another lane's piece, the lane the piece belongs to */
	marbleId?: string;
	title: string;
	detail?: string;
	/** Run time the issue happens at, if it has one */
	time?: number;
	/** A tip's or problem's words on its own layer, without its name: "Overlaps Melody's path", "Hit Twice", "Rolls", "Touching" */
	label?: string;
	/** The stretch of the run a framing issue lasts, for the Camera track */
	span?: { from: number; to: number };
	/** What Track selects and frames when the issue is clicked */
	target: TPreflightTarget | null;
}

/**
 * Decor a marble's path crosses, by selection key, with the tip: Layers badges it and the inspector shows the amber
 * words and Move Clear, from the same list as the export sheet.
 */
export function decorTips(preflight: TExportPreflight): Map<string, TPreflightIssue> {
	const tips = new Map<string, TPreflightIssue>();
	for (const issue of preflight.issues) {
		const key = issue.kind === 'decor' ? issue.target?.ids[0] : undefined;
		if (key != null) tips.set(key, issue);
	}
	return tips;
}

export interface TPreflightTarget {
	/** Selection keys: entity IDs or hit keys */
	ids: string[];
	/** Wall point to bring into view, for issues without a piece such as marble collisions */
	point?: TVec2;
	/** Playhead time to show */
	time?: number;
	/** The workspace that shows the issue; framing issues open Film with the Camera selected */
	workspace?: 'track' | 'film';
}

export type TPreflightKind = 'hit' | 'open' | 'scenery' | 'contact' | 'strike' | 'roll' | 'touching' | 'passes' | 'fall' | 'framing' | 'title' | 'decor' | 'simulation' | 'song';

const severityOrder: Record<TPreflightSeverity, number> = { warning: 0, info: 1 };


// MARK: - Hits

function hitIssues(project: TProject, result: TSimulationResult, names: TNames): TPreflightIssue[] {
	const issues: TPreflightIssue[] = [];
	const pieces = new Map(result.pieces.map((piece) => [piece.entityId, piece]));
	const open: THitResult[] = [];

	const numbers = new Map(project.music.lanes.flatMap((lane) => lane.hits.map((hit, index) => [toHitKey(lane.id, hit.id), index + 1] as const)));
	for (const hit of result.hits) {
		const lane = names.lane(hit.marbleId);
		const key = toHitKey(hit.marbleId, hit.hitId);
		// "Hit 12 of Melody is Blocked", as words.md names a hit by its number on its marble
		const is = (label: string): string => `Hit ${numbers.get(key) ?? '?'} of ${lane} is ${label}`;
		const piece = hit.pieceEntityId != null ? pieces.get(hit.pieceEntityId) : undefined;
		const target: TPreflightTarget = { ids: hit.pieceEntityId != null ? [hit.pieceEntityId] : [key], point: hit.dot ?? undefined, time: hit.targetTime };
		const id = `hit:${hit.marbleId}:${hit.hitId}`;

		if (hit.status === 'blocked') {
			issues.push({
				id,
				kind: 'hit',
				severity: 'warning',
				marbleId: hit.marbleId,
				title: is('Blocked'),
				detail: `${lane} already passes through this spot earlier in its run, so the platform is left out.`,
				time: hit.targetTime,
				target
			});
		} else if (hit.status === 'missed') {
			const label = hit.reason === 'resting' && piece?.status !== 'unreached' ? 'Stopped' : 'Missed';
			issues.push({ id, kind: 'hit', severity: 'warning', marbleId: hit.marbleId, title: is(label), detail: missDetail(hit, piece?.status), time: hit.targetTime, target });
		} else if (hit.status === 'drifting') {
			const ms = Math.round((hit.error ?? 0) * 1000);
			issues.push({
				id,
				kind: 'hit',
				severity: 'warning',
				marbleId: hit.marbleId,
				title: is(ms > 0 ? 'Late' : 'Early'),
				detail: `Lands ${Math.abs(ms)} ms ${ms > 0 ? 'after' : 'before'} the note.`,
				time: hit.targetTime,
				target
			});
		} else if (hit.status === 'open') {
			const reach = hitReach(project, result, hit);
			const status = isUnreachable(reach) ? reachStatus(reach, { marble: lane, time: formatTime(hit.targetTime) }) : null;
			if (status != null) issues.push({ id, kind: 'hit', severity: 'warning', marbleId: hit.marbleId, title: is(status.label), detail: `${status.detail}.`, time: hit.targetTime, target });
			else open.push(hit);
		}
	}

	// Open hits are grouped per lane: a sketch has many, and each row would say the same
	for (const [marbleId, hits] of groupByMarble(open, (hit) => hit.marbleId)) {
		const first = hits[0];
		if (first == null) continue;
		const count = hits.length;
		issues.push({
			id: `open:${marbleId}`,
			kind: 'open',
			severity: 'info',
			title: count === 1 ? `Open note, ${names.lane(marbleId)} at ${formatTime(first.targetTime)}` : `${count} open notes on ${names.lane(marbleId)}`,
			detail:
				count === 1
					? 'No platform plays this note yet. It still sounds in the film, without a hit.'
					: `No platforms play these notes yet, from ${formatTime(first.targetTime)}. They still sound in the film, without hits.`,
			time: first.targetTime,
			target: { ids: [toHitKey(marbleId, first.hitId)], time: first.targetTime }
		});
	}
	return issues;
}

function groupByMarble<T>(items: T[], laneOf: (item: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const item of items) groups.set(laneOf(item), [...(groups.get(laneOf(item)) ?? []), item]);
	return groups;
}

function missDetail(hit: THitResult, pieceStatus: string | undefined): string {
	if (pieceStatus === 'unreached') return 'The marble never reaches this platform.';
	if (pieceStatus === 'held') return 'An edit before it keeps the marble from this platform. The pieces after it wait where they were until this is fixed.';
	if (hit.reason === 'resting') return 'The marble stops on the platform instead of striking it.';
	if (hit.actualTime == null || hit.error == null) return 'The marble passes the platform without touching it.';
	const ms = Math.round(hit.error * 1000);
	return `Lands ${Math.abs(ms)} ms ${ms > 0 ? 'after' : 'before'} the note.`;
}

// MARK: - Scenery

/** Scenery that follows a marble but is left out of the run, because the marble's earlier run passes through it */
function sceneryIssues(project: TProject, result: TSimulationResult, names: TNames): TPreflightIssue[] {
	return result.pieces.flatMap((piece) => {
		if (piece.status !== 'blocked') return [];
		const entity = project.entities.find((item) => item.id === piece.entityId);
		const link = entity?.components.hitLink;
		// Platforms that play a note are reported with their hit
		if (link == null || soundsHit(entity?.components.piece?.type ?? piece.type, link)) return [];
		const lane = names.lane(link.marbleId);
		const time = piece.entryTime ?? piece.hitTime ?? undefined;
		const type = (getPieceDefinition(piece.type)?.label ?? 'piece').toLowerCase();
		return [
			{
				id: `scenery:${piece.entityId}`,
				kind: 'scenery' as const,
				severity: 'warning' as const,
				marbleId: link.marbleId,
				title: `${names.entity(piece.entityId)} of ${lane} is Blocked`,
				detail: `${lane} already passes through this spot earlier in its run, so the ${type} is left out.`,
				time,
				target: { ids: [piece.entityId], point: piece.position, time }
			}
		];
	});
}

// MARK: - Bowls

/**
 * Bowls that do not catch their marble: "Melody misses the Bowl" when the marble falls past it, bounces out of it,
 * or the film ends before the marble gets there. A Blocked Bowl is reported as Blocked scenery. The inspector's
 * Fix-it places it again (Place Bowl Again).
 */
function bowlIssues(project: TProject, result: TSimulationResult, names: TNames): TPreflightIssue[] {
	return project.entities.flatMap((entity) => {
		const link = entity.components.hitLink;
		if (entity.components.piece?.type !== BOWL_TYPE || link == null) return [];
		const piece = result.pieces.find((item) => item.entityId === entity.id);
		const caught = bowlCatch(result, entity.id);
		if (piece == null || caught.status === 'caught' || caught.status === 'blocked') return [];
		const lane = names.lane(link.marbleId);
		const time = piece.entryTime ?? piece.hitTime ?? undefined;
		const isLate = caught.status === 'missed' && time != null && time > result.duration - 0.05;
		const detail = isLate
			? `The film ends before ${lane} reaches the Bowl. Fit to Song lengthens it.`
			: caught.status === 'escaped'
				? `${lane} lands in the Bowl and bounces out of it.`
				: `${lane} falls past the Bowl without landing in it.`;
		return [
			{
				id: `bowl:${entity.id}`,
				kind: 'scenery' as const,
				severity: 'warning' as const,
				marbleId: link.marbleId,
				title: `${lane} misses the Bowl`,
				detail,
				time,
				target: { ids: [entity.id], point: piece.position, time }
			}
		];
	});
}

// MARK: - Contacts

/**
 * Stray contacts: marbles touching each other or another lane's pieces. Contacts with the marble's own pieces are
 * expected during the ride through a rail, tunnel or windmill, and a second strike of its own platform is
 * `strikeIssues`. Free pieces, platforms included, are environment the marbles may strike.
 */
function contactIssues(project: TProject, result: TSimulationResult, names: TNames): TPreflightIssue[] {
	const laneOfMarble = new Map(result.marbles.map((marble) => [marble.entityId, marble.marbleId]));
	const marbleOfPiece = new Map<string, string>();
	for (const entity of project.entities) {
		if (entity.components.hitLink != null) marbleOfPiece.set(entity.id, entity.components.hitLink.marbleId);
	}
	for (const hit of result.hits) {
		if (hit.pieceEntityId != null) marbleOfPiece.set(hit.pieceEntityId, hit.marbleId);
	}

	const groups = new Map<string, { kind: 'marble' | 'lane'; marbleEntityId: string; otherId: string; first: TVec2; time: number; count: number }>();
	for (const contact of result.contacts) {
		if (contact.time > result.duration) continue;
		let kind: 'marble' | 'lane';
		if (contact.kind === 'marble') {
			// Every collision is reported once per marble; keep the pair once
			if (contact.marbleEntityId > contact.otherEntityId) continue;
			kind = 'marble';
		} else {
			const pieceMarble = marbleOfPiece.get(contact.otherEntityId);
			const marbleLane = laneOfMarble.get(contact.marbleEntityId);
			// Free pieces are environment; only another lane's attached pieces are stray
			if (pieceMarble == null || pieceMarble === marbleLane) continue;
			kind = 'lane';
		}
		const key = `${contact.marbleEntityId}:${contact.otherEntityId}`;
		const group = groups.get(key);
		if (group != null) group.count++;
		else groups.set(key, { kind, marbleEntityId: contact.marbleEntityId, otherId: contact.otherEntityId, first: contact.position, time: contact.time, count: 1 });
	}

	return [...groups.values()].map((group) => {
		const marble = names.entity(group.marbleEntityId);
		const other = names.entity(group.otherId);
		const times = group.count > 1 ? `${group.count} times from ${formatTime(group.time)}` : `at ${formatTime(group.time)}`;
		const id = `contact:${group.marbleEntityId}:${group.otherId}`;
		if (group.kind === 'marble') {
			return {
				id,
				kind: 'contact' as const,
				severity: 'warning' as const,
				title: `${marble} collides with ${other}`,
				detail: `The marbles touch ${times}.`,
				time: group.time,
				target: { ids: [group.marbleEntityId, group.otherId], point: group.first, time: group.time }
			};
		}
		return {
			id,
			kind: 'contact' as const,
			severity: 'warning' as const,
			marbleId: marbleOfPiece.get(group.otherId),
			by: marble,
			title: `${marble} hits ${other} of ${names.lane(marbleOfPiece.get(group.otherId) ?? '')}`,
			detail: `Hits it ${times}, without a note.`,
			time: group.time,
			target: { ids: [group.otherId], point: group.first, time: group.time }
		};
	});
}

// MARK: - What's physically wrong with the run

/**
 * A marble striking its own platform outside the note: "Melody hits Platform 12 twice". It sounds like nothing in the
 * film but reads as a mistake, so it counts as a problem. Rests and rolls after the last note and rides on a rail
 * or in a Bowl don't count (`extraStrikes`).
 */
function strikeIssues(project: TProject, result: TSimulationResult, names: TNames): TPreflightIssue[] {
	return extraStrikes(project, result).map((strike) => {
		const count = strike.times === 2 ? 'twice' : `${strike.times} times`;
		return {
			id: `strike:${strike.entityId}`,
			kind: 'strike' as const,
			severity: 'warning' as const,
			marbleId: strike.marbleId,
			title: `${names.lane(strike.marbleId)} hits ${names.entity(strike.entityId)} ${count}`,
			label: strike.times === 2 ? 'Hit Twice' : `Hit ${strike.times} Times`,
			detail: `Hits it ${strike.times} times from ${formatTime(strike.time)}, with one note.`,
			time: strike.time,
			target: { ids: [strike.entityId], point: strike.position, time: strike.time }
		};
	});
}

/**
 * A marble that stays on its platform instead of bouncing off it: "Melody rolls on Platform 12". A platform is for
 * bouncing. Rails and the Bowl are exempt, and so is a marble's last note (`rollingHits`).
 */
function rollIssues(project: TProject, result: TSimulationResult, names: TNames): TPreflightIssue[] {
	return rollingHits(project, result).map((roll) => ({
		id: `roll:${roll.entityId}`,
		kind: 'roll' as const,
		severity: 'warning' as const,
		marbleId: roll.marbleId,
		title: `${names.lane(roll.marbleId)} rolls on ${names.entity(roll.entityId)}`,
		label: 'Rolls',
		detail: `Stays on it after the note at ${formatTime(roll.time)} instead of bouncing off.`,
		time: roll.time,
		target: { ids: [roll.entityId], point: roll.position, time: roll.time }
	}));
}

/** Two pieces closer than the least gap in the wall plane, where skins hang below their hitboxes */
function touchingIssues(project: TProject, result: TSimulationResult, names: TNames): TPreflightIssue[] {
	return touchingPairs(project, result).map((pair) => ({
		id: `touching:${pair.a}:${pair.b}`,
		kind: 'touching' as const,
		severity: 'warning' as const,
		title: `${names.entity(pair.a)} touches ${names.entity(pair.b)}`,
		label: 'Touching',
		detail: pair.gap <= 0 ? 'They overlap on the wall.' : `${(pair.gap * 100).toFixed(1)} cm apart on the wall, where skins reach below the hitbox.`,
		time: pair.time,
		target: { ids: [pair.b, pair.a], point: pair.point, time: pair.time }
	}));
}

/** A marble's path through the body of a piece's skin, which has no hitbox there */
function passIssues(project: TProject, result: TSimulationResult, names: TNames): TPreflightIssue[] {
	return passThroughs(project, result).map((pass) => ({
		id: `passes:${pass.marbleId}:${pass.entityId}`,
		kind: 'passes' as const,
		severity: 'warning' as const,
		marbleId: pass.marbleId,
		title: `${names.lane(pass.marbleId)} passes through ${names.entity(pass.entityId)}`,
		label: 'Passes Through',
		detail: `At ${formatTime(pass.time)} the marble goes through the piece’s skin, below the top the marble bounces on.`,
		time: pass.time,
		target: { ids: [pass.entityId], point: pass.position, time: pass.time }
	}));
}

/** A long free fall between two notes: a tip, since every hit still plays and the film just goes empty for a moment */
function fallIssues(project: TProject, result: TSimulationResult, names: TNames): TPreflightIssue[] {
	const issues: TPreflightIssue[] = [];
	for (const lane of project.music.lanes) {
		const hits = result.hits.filter((hit) => hit.marbleId === lane.id && hit.dot != null).sort((a, b) => a.targetTime - b.targetTime);
		for (let index = 1; index < hits.length; index++) {
			const from = hits[index - 1];
			const to = hits[index];
			if (from?.dot == null || to?.dot == null) continue;
			const fall = from.dot.y - to.dot.y;
			if (fall < LONG_FALL) continue;
			const isBridged = project.entities.some((entity) => entity.components.hitLink?.marbleId === lane.id && entity.components.hitLink.hitId === from.hitId && !soundsHit(entity.components.piece?.type ?? '', entity.components.hitLink));
			if (isBridged) continue;
			issues.push({
				id: `fall:${lane.id}:${from.hitId}`,
				kind: 'fall',
				severity: 'info',
				marbleId: lane.id,
				title: `${names.lane(lane.id)} falls ${fall.toFixed(1)} m at ${wholeSeconds(from.targetTime)}: a Long Rail fills that gap`,
				label: 'Long fall',
				time: from.targetTime,
				target: { ids: [from.pieceEntityId ?? '', project.entities.find((entity) => entity.components.marble?.marbleId === lane.id)?.id ?? ''].filter(Boolean), point: from.dot, time: from.targetTime }
			});
		}
	}
	return issues;
}

function wholeSeconds(time: number): string {
	const whole = Math.round(time);
	return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

// MARK: - Framing

/** A marble out of frame this many seconds while it plays is a mistake in the film; a shorter miss only a tip */
const LONG_OUT = 1.5;

/**
 * Marbles the automatic camera leaves out of frame while they play, from the same camera track the Draft Preview
 * draws and the film bakes: "Bass leaves the frame at 0:12.00 (6 hits)". A manual camera lives in Blender, which the
 * app cannot see, so it has none.
 */
function framingIssues(project: TProject, result: TSimulationResult, names: TNames): TPreflightIssue[] {
	const framing = checkFraming(project, result);
	if (framing == null) return [];
	const counts = new Map<string, number>();
	return framing.stretches.map((stretch, index) => {
		const lane = names.lane(stretch.marbleId);
		const number = (counts.get(stretch.marbleId) ?? 0) + 1;
		counts.set(stretch.marbleId, number);
		const hits = `${stretch.notes.length} ${stretch.notes.length === 1 ? 'hit' : 'hits'}`;
		const seconds = (stretch.to - stretch.from).toFixed(1);
		const followed = framing.followed[index] ?? [];
		const others = followed.length ? ` The camera follows ${followed.map((marbleId) => names.lane(marbleId)).join(' and ')} there.` : '';
		return {
			id: `frame:${stretch.marbleId}:${number}`,
			kind: 'framing' as const,
			// A short miss is a tip: the film still reads
			severity: stretch.to - stretch.from >= LONG_OUT ? ('warning' as const) : ('info' as const),
			marbleId: stretch.marbleId,
			title: `${lane} leaves the frame at ${formatTime(stretch.from)} (${hits})`,
			detail: `Out of frame for ${seconds} s while it plays, until ${formatTime(stretch.to)}.${others}`,
			time: stretch.from,
			span: { from: stretch.from, to: stretch.to },
			target: cameraTarget(stretch.from)
		};
	});
}

interface TFraming {
	stretches: TFramingStretch[];
	/** Per stretch, the lanes of the marbles in frame at its middle */
	followed: string[][];
}

/** Framing per run and camera settings */
const framings = new WeakMap<TSimulationResult['marbles'], Map<string, TFraming | null>>();

export function checkFraming(project: TProject, result: TSimulationResult): TFraming | null {
	if (project.design.camera.mode === 'manual') return null;
	// `renderFps`: the film's frame rate, which the Draft Preview's camera uses too
	const { fps } = getRenderPreset(project.design.renderPreset);
	const key = `${fps}:${JSON.stringify(project.design.camera)}:${project.frame.width}x${project.frame.height}:${result.duration}`;
	let byKey = framings.get(result.marbles);
	if (byKey == null) {
		byKey = new Map();
		framings.set(result.marbles, byKey);
	}
	const cached = byKey.get(key);
	if (cached !== undefined) return cached;
	const track = cachedFollowCameraTrack(project, result, fps);
	const framing = track != null ? measureFraming(project, result, track, fps) : null;
	if (byKey.size >= 8) byKey.delete(byKey.keys().next().value as string);
	byKey.set(key, framing);
	return framing;
}

function measureFraming(project: TProject, result: TSimulationResult, track: TCameraTrack, fps: number): TFraming {
	const stretches = framingStretches(result, track);
	const followed = stretches.map((stretch) => {
		const time = (stretch.from + stretch.to) / 2;
		const frame = Math.min(track.frameCount - 1, Math.round(time * fps));
		return result.marbles.filter((marble) => marble.marbleId !== stretch.marbleId && marble.samples.length && isInFrame(track, frame, marble, time)).map((marble) => marble.marbleId);
	});
	return { stretches, followed };
}

// MARK: - Titles

/** A letter's width over its height in the film's built-in font, about; a title wider than the frame by this is cut off whatever the font */
const LETTER_WIDTH = 0.55;

/** A screen title wider than the frame on any of its lines. A wall title is cut off only by where the camera looks, which a person sees */
function titleIssues(project: TProject): TPreflightIssue[] {
	const aspect = project.frame.width / project.frame.height;
	return project.entities.flatMap((entity) => {
		const title = entity.components.wallText;
		if (title == null || title.style == null || title.style === 'wall') return [];
		const longest = Math.max(...title.text.split('\n').map((line) => line.length));
		if (longest * LETTER_WIDTH * title.size <= aspect) return [];
		return [
			{
				id: `title:${entity.id}`,
				kind: 'title' as const,
				severity: 'warning' as const,
				title: `“${title.text.split('\n')[0]}” is cut off`,
				detail: 'The title is wider than the frame. A shorter line or a smaller Size fits it.',
				time: title.in ?? 0,
				target: { ids: [entity.id], time: title.in ?? 0, workspace: 'film' as const }
			}
		];
	});
}

// MARK: - Decor

/** Decor a marble's path crosses: a tip, since Decor has no hitbox and can never change a hit */
function decorIssues(project: TProject, result: TSimulationResult, names: TNames, blenderObjects: readonly TBlenderObject[]): TPreflightIssue[] {
	return decorOverlaps(project, result, blenderObjects).map((overlap) => {
		const first = overlap.lanes[0];
		const label = overlapLabel(overlap.lanes.map((item) => names.lane(item.marbleId)));
		return {
			id: `decor:${overlap.key}`,
			kind: 'decor' as const,
			severity: 'info' as const,
			title: `${overlap.name}: ${label.charAt(0).toLowerCase()}${label.slice(1)}`,
			detail: `The marble passes over it${first != null ? ` at ${formatTime(first.time)}` : ''}. Decor has no hitbox, so the hit stays the same.`,
			label,
			time: first?.time,
			target: { ids: [overlap.key], point: first?.point, time: first?.time, workspace: 'film' as const }
		};
	});
}

// MARK: - Names

interface TNames {
	lane: (id: string) => string;
	entity: (id: string) => string;
}

function createNames(project: TProject): TNames {
	const lanes = new Map(project.music.lanes.map((lane) => [lane.id, lane.name]));
	const entities = new Map(
		project.entities.map((entity) => {
			const type = entity.components.piece?.type;
			const fallback = entity.components.marble != null ? 'Marble' : type != null ? (getPieceDefinition(type)?.label ?? type) : entity.id;
			return [entity.id, entity.name ?? fallback];
		})
	);
	return { lane: (id) => lanes.get(id) ?? 'Marble', entity: (id) => entities.get(id) ?? id };
}

/** Framing issues open Film at their time with the Camera selected */
function cameraTarget(time: number): TPreflightTarget {
	return { ids: [CAMERA_KEY], time, workspace: 'film' };
}

function countHits(project: TProject): number {
	return project.music.lanes.reduce((sum, lane) => sum + lane.hits.length, 0);
}
