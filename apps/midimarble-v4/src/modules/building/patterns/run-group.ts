import { isPatternGroup, type THit, type TPiece, type TGroup, type TMarble, type TPatternGroup, type TProject, type TProjectCommand, tieOf } from '@/modules/project';
import type { TSimulationResult, TSimulator } from '@/modules/simulation';
import { LONG_FALL, soundsHit, touchingPairs } from '@/modules/simulation';
import { RELEASE_LEAD } from '../reachability';
import { arrivalAt } from './arrival';
import type { THitVerdict, TPatternCourse, TPatternMoment } from './contract';
import { railHolding } from './long-rail';
import { sampleAt } from './fit-bars';
import { fitPattern, type TFitPatternResult, type TPatternProblem } from './fit-pattern';
import { measurePattern, type TPatternMeasures } from './measures';
import { dropForBounce, patternKinds, patternLabel, patternOfKind } from './registry';
import { wordsForHitTime } from './words';

// Making or changing a Group: fits it, then fits the Groups after it on that marble again when the marble now leaves it
// differently, so everything stays on time. All of it is one edit, applied only when the whole run is done.

/** Keeps a Long Rail's block off the notes around its silence, so it holds none */
const RAIL_MARGIN = 0.01;
/** A marble needs this long to fall before its first note strikes */
const MIN_LEAD = 0.12;
/** The marble leaving within this is the same marble: later Groups keep their hand edits */
const SAME_EXIT = { position: 0.001, velocity: 0.01 };

export interface TGroupChange {
	/** The Group to change; absent makes a new one */
	groupId?: string;
	marbleId: string;
	from: number;
	to: number;
	kind: string;
	width: number;
	bounce: number;
	/** The steepest a bar may tilt, in degrees; the usual limit otherwise */
	maxTilt?: number;
}

/** What a Pattern is asked for, on a change or a Group */
type TPatternAsk = Pick<TGroupChange, 'kind' | 'width' | 'bounce' | 'maxTilt'>;

export interface TGroupRunProgress {
	/** The Group being fitted, and how far through the whole run */
	name: string;
	/** 1 is the Group asked for; more are the later Groups following it */
	step: number;
	steps: number;
	fraction: number;
}

export interface TLaterGroupOutcome {
	groupId: string;
	name: string;
	problems: TPatternProblem[];
}

export interface TGroupRunOutcome {
	/** The whole edit; empty when the Group could not be made at all, which `problems` says */
	commands: TProjectCommand[];
	groupId: string | null;
	name: string;
	problems: TPatternProblem[];
	/** One per hit it was asked to play */
	verdicts: THitVerdict[];
	/** Of the Group and the later ones, the problems that keep a hit from playing cleanly */
	blocking: TPatternProblem[];
	/** Later Groups that were fitted again */
	later: TLaterGroupOutcome[];
	/** Hits after the Group, in no Group, that are no longer on time: nothing fits those again */
	laterLateHits: number;
	/** Other marbles' pieces this run's pieces touch: each marble is worked out alone for now */
	otherMarbleTouches: string[];
	/** What's worth saying that isn't wrong */
	notes: string[];
	measures: TPatternMeasures | null;
	/** What the Group's own pieces will look like, for a preview */
	madePieces: TPiece[];
	/** The project as this edit would leave it */
	project: TProject;
}

export interface TGroupRunOptions {
	sim: TSimulator;
	/** A hover preview: one shape, only this Group, nothing after it */
	isPreview?: boolean;
	/** The way the track goes now, for a Pattern to follow */
	along?: TPatternCourse;
	/** How many drops to try */
	maxTries?: number;
	/** A check: nothing can apply after a bar that can't play */
	stopsAtBadBar?: boolean;
	onProgress?: (progress: TGroupRunProgress) => void;
}

/** The live Pattern a piece belongs to: while it has one its pieces move only by fitting it again, like Blender's Array modifier */
export function patternOfPiece(project: TProject, pieceId: string): TPatternGroup | null {
	return project.track.groups.filter(isPatternGroup).find((group) => group.pieceIds.includes(pieceId)) ?? null;
}

/** What a person or an agent is told trying to edit a piece of a live Pattern */
export function patternLockWords(group: TPatternGroup): string {
	return `Part of ${group.name}. Flatten to edit it.`;
}

/**
 * Flatten: like Blender's Apply, the pieces stay as they are and the Pattern is gone, so nothing fits them again. They stay
 * together as a plain Group, and a later Group fits against them as a fixed start.
 */
export function flattenCommands(group: TGroup): TProjectCommand[] {
	const { id, name, marbleId, pieceIds } = group;
	return [{ type: 'addGroup', group: { id, name, ...(marbleId != null ? { marbleId } : {}), pieceIds } }];
}

/**
 * The span of a Pattern's block in the timeline, from the hits it holds: bars from their first hit to their last, a Long Rail
 * between the notes around its silence, or from the marble's start to the note it opens the track for. Null without its hits.
 */
export function patternSpan(marble: TMarble, group: TPatternGroup): { from: number; to: number } | null {
	const times = group.pattern.hitIds.flatMap((id) => {
		const hit = marble.hits.find((item) => item.id === id);
		return hit == null ? [] : [hit.time];
	});
	const first = times[0];
	const last = times.at(-1);
	if (first == null || last == null) return null;
	if (!takesSilence(group.pattern.kind)) return { from: first, to: last };
	if (group.pattern.hitIds.length === 1) return { from: marble.start.time, to: last - RAIL_MARGIN };
	return times.length === 2 ? { from: first + RAIL_MARGIN, to: last - RAIL_MARGIN } : null;
}

/** A live Pattern's hits that don't play right now, worked out from the run: a verdict is never stored */
export function groupProblems(project: TProject, result: TSimulationResult | null, group: TPatternGroup): TPatternProblem[] {
	const marble = project.marbles.find((item) => item.id === group.marbleId);
	if (marble == null || result == null) return [];
	const isSilence = takesSilence(group.pattern.kind);
	return group.pattern.hitIds.flatMap((hitId) => {
		const hit = result.hits.find((item) => item.marbleId === marble.id && item.hitId === hitId);
		const isOff = hit?.status === 'missed' || hit?.status === 'blocked' || hit?.status === 'waiting' || (hit?.status === 'open' && !isSilence);
		if (hit == null || !isOff) return [];
		return [{ hitId, words: `Hit ${marble.hits.findIndex((item) => item.id === hitId) + 1} of ${marble.name} doesn't play. Fit ${group.name} again, or Flatten it.` }];
	});
}

/** The hits in a range, in time order */
export function hitsInRange(marble: TMarble, from: number, to: number): TMarble['hits'] {
	return marble.hits.filter((hit) => hit.time >= from - 1e-6 && hit.time <= to + 1e-6);
}

/** A marble's Patterns in time order; one whose hits are gone comes last */
export function groupsOfMarble(project: TProject, marbleId: string): TPatternGroup[] {
	const marble = project.marbles.find((item) => item.id === marbleId);
	const fromOf = (group: TPatternGroup): number => (marble != null ? patternSpan(marble, group)?.from : null) ?? Number.MAX_VALUE;
	return project.track.groups.filter(isPatternGroup).filter((group) => group.marbleId === marbleId).sort((a, b) => fromOf(a) - fromOf(b));
}

interface TGroupTarget {
	hitIds: string[];
	from: number;
	to: number;
	problem: TPatternProblem | null;
}

/** What a range means for a Pattern, or why it can't take it */
function targetOf(marble: TMarble, change: Pick<TGroupChange, 'from' | 'to' | 'kind'>, isBuiltBefore: (time: number) => boolean): TGroupTarget {
	const { from, to, kind } = change;
	const hits = hitsInRange(marble, from, to);
	const label = patternLabel(kind);
	const refuse = (hitId: string, words: string): TGroupTarget => ({ hitIds: [], from, to, problem: { hitId, words } });
	if (takesSilence(kind)) {
		if (hits.length > 0) return refuse(hits[0]?.id ?? '', `A ${label} fills silence, and this range holds ${hits.length} ${hits.length === 1 ? 'note' : 'notes'}. Try ${labelsFor('notes')}.`);
		const before = [...marble.hits].reverse().find((hit) => hit.time < from);
		const after = marble.hits.find((hit) => hit.time > to);
		if (after == null) return refuse(before?.id ?? '', `A ${label} ends at a note, and none comes after this range.`);
		// Before the first note it opens the track, from the marble's release at the range's start
		if (before == null || !isBuiltBefore(after.time)) return { hitIds: [after.id], from: Math.max(0, from), to: after.time - RAIL_MARGIN, problem: null };
		return { hitIds: [before.id, after.id], from: before.time + RAIL_MARGIN, to: after.time - RAIL_MARGIN, problem: null };
	}
	const first = hits[0];
	const last = hits.at(-1);
	if (first == null || last == null) return refuse('', `A ${label} plays notes, and this range holds none. Try ${labelsFor('silence')}.`);
	return { hitIds: hits.map((hit) => hit.id), from: first.time, to: last.time, problem: null };
}

/** What a Group's own span means for its Pattern; one whose hits are gone refuses as an empty range does */
function targetOfGroup(marble: TMarble, group: TPatternGroup): TGroupTarget {
	return targetOf(marble, { ...(patternSpan(marble, group) ?? { from: Infinity, to: Infinity }), kind: group.pattern.kind }, () => group.pattern.hitIds.length > 1);
}

/** Whether any piece other than these plays or follows a hit of this marble before this time */
function hasPiecesBefore(project: TProject, marble: TMarble, time: number, except: ReadonlySet<string>): boolean {
	return project.track.pieces.some((piece) => {
		const tie = tieOf(piece);
		return tie?.marbleId === marble.id && !except.has(piece.id) && (marble.hits.find((hit) => hit.id === tie.hitId)?.time ?? Infinity) < time - 1e-6;
	});
}

/**
 * When a marble with nothing before this note should be released: null when its release already falls onto that note.
 * After the note before, so that one only waits to be built, and never so late that this one comes too soon.
 */
function startFor(sim: TSimulator, project: TProject, marble: TMarble, hit: THit): number | null {
	const arrival = hit.time - marble.start.time >= MIN_LEAD ? arrivalAt(sim, project, marble.id, hit.id, hit.time) : null;
	// As it really goes: a start rail holds the marble through most of its lead
	if (arrival != null && marble.start.position.y - arrival.position.y < LONG_FALL) return null;
	const before = [...marble.hits].reverse().find((item) => item.time < hit.time)?.time ?? -Infinity;
	return Math.max(0, Math.min(hit.time - MIN_LEAD, Math.max(hit.time - RELEASE_LEAD, before + 0.01)));
}

/**
 * Notes before this one with nothing to play them, after pieces that do: the marble falls past them, and a fall this long
 * can't be turned into a hit. Said as the owner says it: this hit is out of order.
 */
function outOfOrderProblem(sim: TSimulator, project: TProject, marble: TMarble, hitId: string): TPatternProblem | null {
	const index = marble.hits.findIndex((hit) => hit.id === hitId);
	const hit = marble.hits[index];
	if (hit == null || !hasPiecesBefore(project, marble, hit.time, new Set())) return null;
	const sounds = new Set(project.track.pieces.flatMap((piece) => {
		const tie = tieOf(piece);
		return tie != null && soundsHit(piece.type, tie) ? [tie.hitId] : [];
	}));
	let firstOpen = index;
	while (firstOpen > 0 && !sounds.has(marble.hits[firstOpen - 1]?.id ?? '')) firstOpen--;
	if (firstOpen === index) return null;
	const played = marble.hits[firstOpen - 1];
	const arrival = arrivalAt(sim, project, marble.id, hit.id, hit.time);
	const from = played != null ? arrivalAt(sim, project, marble.id, played.id, played.time) : null;
	const fall = arrival != null && from != null ? from.position.y - arrival.position.y : Infinity;
	if (fall < LONG_FALL) return null;
	const open = firstOpen === index - 1 ? `Hit ${firstOpen + 1} has` : `Hits ${firstOpen + 1} to ${index} have`;
	return { hitId, words: `It's out of order: ${open} no pieces yet, so the marble falls ${Number.isFinite(fall) ? `${fall.toFixed(1)} m` : 'away'} before it.` };
}

/** Whether this Pattern fills silence, where a stored kind this version doesn't have counts as playing notes */
function takesSilence(kind: string): boolean {
	return patternOfKind(kind)?.takes === 'silence';
}

/** "Zigzag or Staircase": what to try on a range of this sort */
function labelsFor(takes: 'notes' | 'silence'): string {
	return patternKinds(takes).map(patternLabel).join(' or ');
}

/** A new name: "Zigzag", then "Zigzag 2" */
function nextGroupName(groups: readonly TGroup[], kind: string): string {
	const label = patternLabel(kind);
	const names = new Set(groups.map((group) => group.name));
	if (!names.has(label)) return label;
	for (let index = 2; ; index++) if (!names.has(`${label} ${index}`)) return `${label} ${index}`;
}

function withoutPieces(project: TProject, ids: readonly string[]): TProject {
	const removed = new Set(ids);
	return ids.length > 0 ? { ...project, track: { ...project.track, pieces: project.track.pieces.filter((piece) => !removed.has(piece.id)) } } : project;
}

function sameExit(a: TPatternMoment | null, b: TPatternMoment | null): boolean {
	if (a == null || b == null) return a === b;
	return Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y) < SAME_EXIT.position && Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y) < SAME_EXIT.velocity;
}

function marbleAt(sim: TSimulator, project: TProject, marbleId: string, time: number): TPatternMoment | null {
	const result = sim.simulate({ ...project, length: time + 0.01 });
	const sample = sampleAt(result.marbles.find((marble) => marble.marbleId === marbleId)?.samples ?? [], time);
	return sample == null ? null : { position: sample.position, velocity: sample.velocity, time: sample.time };
}

/** Runs a Group's Pattern and what follows it, and answers with one edit. The project isn't touched */
export function runGroupChange(project: TProject, change: TGroupChange, options: TGroupRunOptions): TGroupRunOutcome {
	const { sim, isPreview = false, onProgress, along, maxTries, stopsAtBadBar } = options;
	const marble = project.marbles.find((item) => item.id === change.marbleId);
	const existing = change.groupId != null ? project.track.groups.filter(isPatternGroup).find((group) => group.id === change.groupId) : undefined;
	let name = existing != null && existing.pattern.kind === change.kind ? existing.name : nextGroupName(project.track.groups, change.kind);
	const refuse = (problems: TPatternProblem[], verdicts: THitVerdict[] = problems.map((problem) => ({ ...problem, fits: false }))): TGroupRunOutcome => ({ commands: [], groupId: null, name, problems, verdicts, blocking: problems, later: [], laterLateHits: 0, otherMarbleTouches: [], notes: [], measures: null, madePieces: [], project });
	if (marble == null) return refuse([{ hitId: '', words: 'That marble is gone.' }]);
	const own = new Set(existing?.pieceIds ?? []);
	const target = targetOf(marble, change, (time) => hasPiecesBefore(project, marble, time, own));
	if (target.problem != null) return refuse([target.problem]);
	const outOfOrder = target.hitIds[0] != null ? outOfOrderProblem(sim, withoutPieces(project, [...own]), marble, target.hitIds[0]) : null;
	if (outOfOrder != null) return refuse([outOfOrder]);

	const others = groupsOfMarble(project, marble.id).filter((group) => group.id !== existing?.id);
	const later = isPreview ? [] : others.filter((group) => (patternSpan(marble, group)?.from ?? Infinity) > target.to - 1e-6);
	const { trimmed, removedGroupIds, freed } = trimOverlaps(project, others, target.hitIds, marble, target.from, target.to);
	if (existing?.pattern.kind !== change.kind) name = nextGroupName(project.track.groups.filter((group) => !removedGroupIds.includes(group.id) && group.id !== existing?.id), change.kind);

	// A rail it replaces goes first: the new one may take its ID
	let working = withoutPieces(project, [...(existing?.pieceIds ?? []), ...freed]);
	const firstHit = marble.hits.find((hit) => hit.id === target.hitIds[0]);
	const hits = target.hitIds.flatMap((id) => marble.hits.find((hit) => hit.id === id) ?? []);
	if (takesSilence(change.kind) && target.hitIds.length === 1 && railHolding(sim, project, marble.id, hits) == null) working = withReleaseAt(working, marble.id, target.from);
	// A marble with nothing to play before these notes starts just above them: the notes before wait until someone builds them
	if (!takesSilence(change.kind) && firstHit != null && !hasPiecesBefore(project, marble, firstHit.time, own)) {
		const release = startFor(sim, working, marble, firstHit);
		if (release != null) working = withReleaseAt(working, marble.id, release);
	}
	const steps = 1 + later.length;
	const askFit = (hitIds: string[], item: TPatternAsk, step: number, label: string, pieceIds: readonly string[]): TFitPatternResult =>
		keepingSkins(
			project,
			pieceIds,
			fitPattern(
				{ project: working, marbleId: marble.id, hitIds, kind: item.kind, width: item.width, bounce: item.bounce, drop: dropForBounce(item.kind, item.bounce), ...(item.maxTilt != null ? { maxTilt: item.maxTilt } : {}), ...barSizeOf(project, pieceIds), ...(isPreview ? { maxTries: 1 } : maxTries != null ? { maxTries } : {}), ...(stopsAtBadBar === true && !isPreview ? { stopsAtBadBar } : {}), ...(along != null && step === 1 ? { along } : {}) },
				{ sim, onProgress: (fraction) => onProgress?.({ name: label, step, steps, fraction: (step - 1 + fraction) / steps }) }
			)
		);

	const laterFrom = later[0] != null ? patternSpan(marble, later[0])?.from : undefined;
	const exitBefore = laterFrom != null ? marbleAt(sim, project, marble.id, laterFrom) : null;
	const before = [...others].reverse().find((group) => (patternSpan(marble, group)?.to ?? Infinity) <= target.from + 1e-6);
	let fit = askFit(target.hitIds, change, 1, name, existing?.pieceIds ?? []);
	let refitBefore: { group: TPatternGroup; fit: TFitPatternResult } | null = null;

	// A rail that doesn't fit after the turn toward the frame: the bars before it play again without that turn
	if (!fit.pieces.length && takesSilence(change.kind) && before != null && !takesSilence(before.pattern.kind) && !isPreview) {
		const refit = refitBarsWithoutTurn(before, marble, working, sim, project);
		if (refit != null) {
			const saved = working;
			working = refit.project;
			const retried = askFit(target.hitIds, change, 1, name, existing?.pieceIds ?? []);
			if (retried.pieces.length > 0) {
				fit = retried;
				refitBefore = { group: before, fit: refit };
			} else working = saved;
		}
	}
	if (!fit.pieces.length) return refuse(fit.problems, fit.verdicts);
	working = fit.project;

	const groupId = existing?.id ?? `group-${!takesSilence(change.kind) ? '' : target.hitIds.length === 1 ? 'start-' : 'rail-'}${target.hitIds[0] ?? 'range'}`.slice(0, 64);
	const group: TPatternGroup = {
		id: groupId,
		name,
		marbleId: marble.id,
		pieceIds: fit.pieces.map((piece) => piece.id),
		pattern: {
			kind: change.kind,
			hitIds: target.hitIds,
			width: change.width,
			bounce: change.bounce,
			...(change.maxTilt != null ? { maxTilt: change.maxTilt } : {})
		}
	};

	const groups = new Map<string, TPatternGroup>([[group.id, group]]);
	const outcomes: TLaterGroupOutcome[] = [];
	const blocking = [...fit.blocking];
	const exitAfter = laterFrom != null && !isPreview ? marbleAt(sim, working, marble.id, laterFrom) : null;
	if (refitBefore != null) groups.set(refitBefore.group.id, { ...refitBefore.group, pieceIds: refitBefore.fit.pieces.map((piece) => piece.id) });
	if (!sameExit(exitBefore, exitAfter)) {
		// Later Groups' pieces go first, so none of them gets in the way of the fit before it
		working = withoutPieces(working, later.flatMap((item) => item.pieceIds));
		later.forEach((item, index) => {
			const laterTarget = targetOfGroup(marble, item);
			if (laterTarget.problem != null) {
				blocking.push(laterTarget.problem);
				groups.set(item.id, { ...item, pieceIds: [] });
				outcomes.push({ groupId: item.id, name: item.name, problems: [laterTarget.problem] });
				return;
			}
			const laterFit = askFit(laterTarget.hitIds, item.pattern, index + 2, item.name, item.pieceIds);
			working = laterFit.project;
			blocking.push(...laterFit.blocking);
			groups.set(item.id, { ...item, pieceIds: laterFit.pieces.map((piece) => piece.id), pattern: { ...item.pattern, hitIds: laterTarget.hitIds } });
			outcomes.push({ groupId: item.id, name: item.name, problems: laterFit.problems });
		});
	}

	for (const item of trimmed) if (!groups.has(item.id)) groups.set(item.id, item);
	const commands = editCommands(project, working, [...groups.values()], removedGroupIds);

	const result = isPreview ? null : sim.simulate(working);
	const inGroups = new Set([...groups.values(), ...others].flatMap((item) => item.pieceIds));
	const laterLateHits = result == null ? 0 : result.hits.filter((hit) => hit.marbleId === marble.id && hit.targetTime > target.to && hit.pieceEntityId != null && !inGroups.has(hit.pieceEntityId) && hit.status !== 'onTime' && hit.status !== 'drifting' && hit.status !== 'open').length;
	const made = new Set(group.pieceIds);
	const marbleOf = (id: string): string | null => tieOf(working.track.pieces.find((piece) => piece.id === id))?.marbleId ?? null;
	const otherMarbleTouches =
		result == null
			? []
			: touchingPairs(working, result).flatMap((pair) => {
					const [mine, other] = made.has(pair.a) ? [pair.a, pair.b] : [pair.b, pair.a];
					const otherMarble = marbleOf(other);
					if (!made.has(mine) || otherMarble == null || otherMarble === marble.id) return [];
					return [`${name} touches ${working.marbles.find((item) => item.id === otherMarble)?.name ?? 'another marble'}’s pieces at ${wordsForHitTime(pair.time)}. Patterns work one marble at a time for now.`];
				});
	return {
		commands,
		groupId,
		name,
		problems: fit.problems,
		verdicts: fit.verdicts,
		blocking,
		later: outcomes,
		laterLateHits,
		otherMarbleTouches: [...new Set(otherMarbleTouches)],
		notes: fit.notes,
		measures: result != null ? measurePattern(working, result, marble.id, takesSilence(change.kind) ? undefined : target.hitIds) : null,
		madePieces: fit.pieces,
		project: working
	};
}

/** The marble released at this time, staying where it is */
function withReleaseAt(project: TProject, marbleId: string, time: number): TProject {
	return { ...project, marbles: project.marbles.map((marble) => (marble.id === marbleId ? { ...marble, start: { ...marble.start, time } } : marble)) };
}

/**
 * A fit makes its pieces new, so each takes the look and name of the piece it replaces: the one on its hit, else any of
 * the Group's of its type, so a piece a resize adds matches. A Skin's Depth comes along through `barSizeOf`.
 */
function keepingSkins(project: TProject, pieceIds: readonly string[], fit: TFitPatternResult): TFitPatternResult {
	const replaced = new Set([...pieceIds, ...fit.removedIds]);
	const old = project.track.pieces.filter((piece) => replaced.has(piece.id));
	if (!old.length) return fit;
	const dressed = new Map<string, TPiece>();
	for (const piece of fit.pieces) {
		const type = piece.type;
		const sameType = old.filter((item) => item.type === type);
		const own = sameType.find((item) => tieOf(item) != null && tieOf(item)?.hitId === tieOf(piece)?.hitId) ?? sameType.find((item) => item.id === piece.id);
		const skin = (own ?? sameType.find((item) => item.skin != null))?.skin;
		dressed.set(piece.id, { ...piece, ...(own?.name != null ? { name: own.name } : {}), ...(skin != null ? { skin } : {}) });
	}
	return { ...fit, pieces: fit.pieces.map((piece) => dressed.get(piece.id) ?? piece), project: { ...fit.project, track: { ...fit.project.track, pieces: fit.project.track.pieces.map((piece) => dressed.get(piece.id) ?? piece) } } };
}

/** The size a Group's bars have now, so running it again keeps a Length or Depth changed by hand */
function barSizeOf(project: TProject, pieceIds: readonly string[]): { barLength?: number; barDepth?: number } {
	const ids = new Set(pieceIds);
	const params = project.track.pieces.find((piece) => ids.has(piece.id) && piece.type === 'platform')?.params;
	return { ...(params?.['length'] != null ? { barLength: params['length'] } : {}), ...(params?.['depth'] != null ? { barDepth: params['depth'] } : {}) };
}

/** The bars before a rail played again, the last one keeping its own direction; null when that leaves problems of its own */
function refitBarsWithoutTurn(group: TPatternGroup, marble: TMarble, working: TProject, sim: TSimulator, wearing: TProject): TFitPatternResult | null {
	const span = patternSpan(marble, group);
	if (takesSilence(group.pattern.kind) || span == null) return null;
	const hits = hitsInRange(marble, span.from, span.to).map((hit) => hit.id);
	const fit = keepingSkins(wearing, group.pieceIds, fitPattern({ project: withoutPieces(working, group.pieceIds), marbleId: marble.id, hitIds: hits, kind: group.pattern.kind, width: group.pattern.width, bounce: group.pattern.bounce, drop: dropForBounce(group.pattern.kind, group.pattern.bounce), ...(group.pattern.maxTilt != null ? { maxTilt: group.pattern.maxTilt } : {}), keepsDirection: true, ...barSizeOf(working, group.pieceIds) }, { sim }));
	return fit.pieces.length > 0 ? fit : null;
}

/**
 * Groups a new range runs over give up what it covers: their pieces on its hits go, they keep only the hits left before
 * it, and the pieces after it stay as plain pieces. Nothing is left in a Group's list that it no longer plays.
 */
function trimOverlaps(project: TProject, others: readonly TPatternGroup[], hitIds: readonly string[], marble: TMarble, from: number, to: number): { trimmed: TPatternGroup[]; removedGroupIds: string[]; freed: string[] } {
	const trimmed: TPatternGroup[] = [];
	const removedGroupIds: string[] = [];
	const freed: string[] = [];
	const covered = new Set(hitIds);
	for (const group of others) {
		const span = patternSpan(marble, group);
		if (span == null || span.to < from || span.from > to) continue;
		if (takesSilence(group.pattern.kind)) {
			removedGroupIds.push(group.id);
			freed.push(...group.pieceIds);
			continue;
		}
		const left = hitsInRange(marble, span.from, span.to).filter((hit) => hit.time < from);
		if (!left.length) {
			removedGroupIds.push(group.id);
			continue;
		}
		const leftIds = new Set(left.map((hit) => hit.id));
		const pieceIds = group.pieceIds.filter((id) => {
			const hitId = tieOf(project.track.pieces.find((piece) => piece.id === id))?.hitId;
			return hitId != null && leftIds.has(hitId) && !covered.has(hitId);
		});
		trimmed.push({ ...group, pieceIds, pattern: { ...group.pattern, hitIds: left.map((hit) => hit.id) } });
	}
	return { trimmed, removedGroupIds, freed };
}

/** One command batch from one project to the next: pieces gone, marbles released elsewhere, pieces new or changed, Groups changed */
function editCommands(from: TProject, to: TProject, groups: readonly TGroup[], removedGroupIds: readonly string[]): TProjectCommand[] {
	const before = new Map(from.track.pieces.map((piece) => [piece.id, piece]));
	const after = new Set(to.track.pieces.map((piece) => piece.id));
	const gone = from.track.pieces.filter((piece) => !after.has(piece.id)).map((piece) => piece.id);
	const changed = to.track.pieces.filter((piece) => before.get(piece.id) !== piece);
	const starts = new Map(from.marbles.map((marble) => [marble.id, marble.start]));
	const released = to.marbles.filter((marble) => starts.get(marble.id) !== marble.start);
	return [
		...(gone.length > 0 ? [{ type: 'removePieces' as const, pieceIds: gone }] : []),
		...released.map((marble) => ({ type: 'updateMarble' as const, marbleId: marble.id, patch: { start: marble.start } })),
		...changed.map((piece) => ({ type: 'addPiece' as const, piece })),
		...(removedGroupIds.length > 0 ? [{ type: 'removeGroups' as const, groupIds: [...removedGroupIds] }] : []),
		...groups.map((group) => ({ type: 'addGroup' as const, group }))
	];
}
