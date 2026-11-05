import { isPatternGroup, type TEntity, type TGroup, type TLane, type TPatternGroup, type TProject, type TProjectCommand } from '@/modules/project';
import type { TSimulator } from '@/modules/simulation';
import { touchingPairs } from '@/modules/simulation';
import { sampleAt, ZIGZAG_WIDTH } from './fit-bars';
import { fitPattern, type TFitPatternResult, type TPatternExit, type TPatternKind, type TPatternProblem } from './fit-pattern';
import { measurePattern, type TPatternMeasures } from './measures';
import { wordsForHitTime } from './words';

// Making or changing a Group: fits it, then fits the Groups after it on that marble again when the marble now leaves it
// differently, so everything stays on time. All of it is one edit, applied only when the whole run is done.

/** Keeps a Long Rail's block off the notes around its silence, so it holds none */
const RAIL_MARGIN = 0.01;
/** The marble leaving within this is the same marble: later Groups keep their hand edits */
const SAME_EXIT = { position: 0.001, velocity: 0.01 };

export const PATTERN_LABELS: Record<TPatternKind, string> = { zigzag: 'Zigzag', staircase: 'Staircase', longRail: 'Long Rail' };

/** Width and Bounce a Pattern starts from */
export const PATTERN_DEFAULTS: Record<TPatternKind, { width: number; bounce: number }> = {
	zigzag: { width: ZIGZAG_WIDTH, bounce: 0.5 },
	staircase: { width: 0.09, bounce: 0.5 },
	longRail: { width: 0.14, bounce: 0.5 }
};

/**
 * What the inspector's Bounce asks for. The same restitution on every bar missed hits on real rhythm (54 of 58 on the
 * reference, 38 of 58 at 0.75), so each bar's bounce is solved, and a livelier Bounce asks for less fall per hit.
 */
export function dropForBounce(kind: TPatternKind, bounce: number): number {
	return (kind === 'staircase' ? 0.12 : 0.08) * (1 + (0.5 - bounce) * 2.5);
}

export interface TGroupChange {
	/** The Group to change; absent makes a new one */
	groupId?: string;
	laneId: string;
	from: number;
	to: number;
	kind: TPatternKind;
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
	/** Of the Group and the later ones, the problems that keep a hit from playing cleanly */
	blocking: TPatternProblem[];
	/** The nearest Width with no problems, when one was found */
	nearestWidth: number | null;
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
	entities: TEntity[];
	/** The project as this edit would leave it */
	project: TProject;
}

export interface TGroupRunOptions {
	sim: TSimulator;
	/** A hover preview: one shape, only this Group, nothing after it */
	isPreview?: boolean;
	onProgress?: (progress: TGroupRunProgress) => void;
}

/** The live Pattern a piece belongs to: while it has one its pieces move only by fitting it again, like Blender's Array modifier */
export function patternOfPiece(project: TProject, pieceId: string): TPatternGroup | null {
	return project.groups?.filter(isPatternGroup).find((group) => group.pieceIds.includes(pieceId)) ?? null;
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
	const { id, name, laneId, pieceIds } = group;
	return [{ type: 'upsertGroup', group: { id, name, ...(laneId != null ? { laneId } : {}), pieceIds } }];
}

/** The hits in a range, in time order */
export function hitsInRange(lane: TLane, from: number, to: number): TLane['hits'] {
	return lane.hits.filter((hit) => hit.time >= from - 1e-6 && hit.time <= to + 1e-6);
}

export function groupsOfLane(project: TProject, laneId: string): TPatternGroup[] {
	return (project.groups ?? []).filter(isPatternGroup).filter((group) => group.laneId === laneId).sort((a, b) => a.from - b.from);
}

interface TGroupTarget {
	hitIds: string[];
	from: number;
	to: number;
	problem: TPatternProblem | null;
}

/** What a range means for a Pattern, or why it can't take it */
function targetOf(lane: TLane, change: Pick<TGroupChange, 'from' | 'to' | 'kind'>): TGroupTarget {
	const { from, to, kind } = change;
	const hits = hitsInRange(lane, from, to);
	const refuse = (hitId: string, words: string): TGroupTarget => ({ hitIds: [], from, to, problem: { hitId, words } });
	if (kind === 'longRail') {
		if (hits.length > 0) return refuse(hits[0]?.id ?? '', `A Long Rail fills silence, and this range holds ${hits.length} ${hits.length === 1 ? 'note' : 'notes'}. Try Zigzag or Staircase.`);
		const before = [...lane.hits].reverse().find((hit) => hit.time < from);
		const after = lane.hits.find((hit) => hit.time > to);
		if (after == null) return refuse(before?.id ?? '', 'A Long Rail ends at a note, and none comes after this range.');
		// Before the first note it opens the track, from the marble's release at the range's start
		if (before == null) return { hitIds: [after.id], from: Math.max(0, from), to: after.time - RAIL_MARGIN, problem: null };
		return { hitIds: [before.id, after.id], from: before.time + RAIL_MARGIN, to: after.time - RAIL_MARGIN, problem: null };
	}
	const first = hits[0];
	const last = hits.at(-1);
	if (first == null || last == null) return refuse('', `A ${PATTERN_LABELS[kind]} plays notes, and this range holds none. Try Long Rail.`);
	return { hitIds: hits.map((hit) => hit.id), from: first.time, to: last.time, problem: null };
}

/** A new name: "Zigzag", then "Zigzag 2" */
function nextGroupName(groups: readonly TGroup[], kind: TPatternKind): string {
	const label = PATTERN_LABELS[kind];
	const names = new Set(groups.map((group) => group.name));
	if (!names.has(label)) return label;
	for (let index = 2; ; index++) if (!names.has(`${label} ${index}`)) return `${label} ${index}`;
}

function withoutPieces(project: TProject, ids: readonly string[]): TProject {
	const removed = new Set(ids);
	return ids.length > 0 ? { ...project, entities: project.entities.filter((entity) => !removed.has(entity.id)) } : project;
}

function sameExit(a: TPatternExit | null, b: TPatternExit | null): boolean {
	if (a == null || b == null) return a === b;
	return Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y) < SAME_EXIT.position && Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y) < SAME_EXIT.velocity;
}

function marbleAt(sim: TSimulator, project: TProject, laneId: string, time: number): TPatternExit | null {
	const result = sim.simulate({ ...project, end: time + 0.01 });
	const sample = sampleAt(result.marbles.find((marble) => marble.laneId === laneId)?.samples ?? [], time);
	return sample == null ? null : { position: sample.position, velocity: sample.velocity, time: sample.time };
}

/** Runs a Group's Pattern and what follows it, and answers with one edit. The project isn't touched */
export function runGroupChange(project: TProject, change: TGroupChange, options: TGroupRunOptions): TGroupRunOutcome {
	const { sim, isPreview = false, onProgress } = options;
	const lane = project.music.lanes.find((item) => item.id === change.laneId);
	const existing = change.groupId != null ? project.groups?.filter(isPatternGroup).find((group) => group.id === change.groupId) : undefined;
	let name = existing != null && existing.kind === change.kind ? existing.name : nextGroupName(project.groups ?? [], change.kind);
	const refuse = (problems: TPatternProblem[]): TGroupRunOutcome => ({ commands: [], groupId: null, name, problems, blocking: problems, nearestWidth: null, later: [], laterLateHits: 0, otherMarbleTouches: [], notes: [], measures: null, entities: [], project });
	if (lane == null) return refuse([{ hitId: '', words: 'That marble is gone.' }]);
	const target = targetOf(lane, change);
	if (target.problem != null) return refuse([target.problem]);

	const others = groupsOfLane(project, lane.id).filter((group) => group.id !== existing?.id);
	const later = isPreview ? [] : others.filter((group) => group.from > target.to - 1e-6);
	const { trimmed, removedGroupIds, freed } = trimOverlaps(project, others, target.hitIds, lane, target.from, target.to);
	if (existing?.kind !== change.kind) name = nextGroupName((project.groups ?? []).filter((group) => !removedGroupIds.includes(group.id) && group.id !== existing?.id), change.kind);

	// A rail it replaces goes first: the new one may take its ID
	let working = withoutPieces(project, [...(existing?.pieceIds ?? []), ...freed]);
	if (change.kind === 'longRail' && target.hitIds.length === 1) working = withReleaseAt(working, lane.id, target.from);
	const steps = 1 + later.length;
	const askFit = (hitIds: string[], item: TPatternAsk, step: number, label: string, pieceIds: readonly string[], offersNearestWidth = false): TFitPatternResult =>
		keepingSkins(
			project,
			pieceIds,
			fitPattern(
				{ project: working, laneId: lane.id, hitIds, kind: item.kind, width: item.width, drop: dropForBounce(item.kind, item.bounce), ...(item.maxTilt != null ? { maxTilt: item.maxTilt } : {}), ...barSizeOf(project, pieceIds), ...(isPreview ? { maxTries: 1 } : {}), ...(offersNearestWidth && !isPreview ? { offersNearestWidth } : {}) },
				{ sim, onProgress: (fraction) => onProgress?.({ name: label, step, steps, fraction: (step - 1 + fraction) / steps }) }
			)
		);

	const exitBefore = later[0] != null ? marbleAt(sim, project, lane.id, later[0].from) : null;
	const before = [...others].reverse().find((group) => group.to <= target.from + 1e-6);
	let fit = askFit(target.hitIds, change, 1, name, existing?.pieceIds ?? [], true);
	let refitBefore: { group: TPatternGroup; fit: TFitPatternResult } | null = null;

	// A rail that doesn't fit after the turn toward the frame: the bars before it play again without that turn
	if (!fit.entities.length && change.kind === 'longRail' && before != null && before.kind !== 'longRail' && !isPreview) {
		const refit = refitBarsWithoutTurn(before, lane, working, sim, project);
		if (refit != null) {
			const saved = working;
			working = refit.project;
			const retried = askFit(target.hitIds, change, 1, name, existing?.pieceIds ?? [], true);
			if (retried.entities.length > 0) {
				fit = retried;
				refitBefore = { group: before, fit: refit };
			} else working = saved;
		}
	}
	if (!fit.entities.length) return refuse(fit.problems);
	working = fit.project;

	const groupId = existing?.id ?? `group-${change.kind !== 'longRail' ? '' : target.hitIds.length === 1 ? 'start-' : 'rail-'}${target.hitIds[0] ?? 'range'}`.slice(0, 64);
	const group: TPatternGroup = {
		id: groupId,
		name,
		laneId: lane.id,
		from: target.from,
		to: target.to,
		kind: change.kind,
		width: change.width,
		bounce: change.bounce,
		pieceIds: fit.entities.map((entity) => entity.id),
		...(change.maxTilt != null ? { maxTilt: change.maxTilt } : {}),
		...(fit.problems.length > 0 ? { problems: fit.problems } : {})
	};

	const groups = new Map<string, TPatternGroup>([[group.id, group]]);
	const outcomes: TLaterGroupOutcome[] = [];
	const blocking = [...fit.blocking];
	const exitAfter = later[0] != null && !isPreview ? marbleAt(sim, working, lane.id, later[0].from) : null;
	if (refitBefore != null) groups.set(refitBefore.group.id, { ...refitBefore.group, pieceIds: refitBefore.fit.entities.map((entity) => entity.id) });
	if (!sameExit(exitBefore, exitAfter)) {
		// Later Groups' pieces go first, so none of them gets in the way of the fit before it
		working = withoutPieces(working, later.flatMap((item) => item.pieceIds));
		later.forEach((item, index) => {
			const laterTarget = targetOf(lane, item);
			if (laterTarget.problem != null) {
				blocking.push(laterTarget.problem);
				groups.set(item.id, { ...item, pieceIds: [], problems: [laterTarget.problem] });
				outcomes.push({ groupId: item.id, name: item.name, problems: [laterTarget.problem] });
				return;
			}
			const laterFit = askFit(laterTarget.hitIds, item, index + 2, item.name, item.pieceIds);
			working = laterFit.project;
			blocking.push(...laterFit.blocking);
			const { problems: _old, ...plain } = item;
			groups.set(item.id, { ...plain, pieceIds: laterFit.entities.map((entity) => entity.id), ...(laterFit.problems.length > 0 ? { problems: laterFit.problems } : {}) });
			outcomes.push({ groupId: item.id, name: item.name, problems: laterFit.problems });
		});
	}

	for (const item of trimmed) if (!groups.has(item.id)) groups.set(item.id, item);
	const commands = editCommands(project, working, [...groups.values()], removedGroupIds);

	const result = isPreview ? null : sim.simulate(working);
	const inGroups = new Set([...groups.values(), ...others].flatMap((item) => item.pieceIds));
	const laterLateHits = result == null ? 0 : result.hits.filter((hit) => hit.laneId === lane.id && hit.targetTime > target.to && hit.pieceEntityId != null && !inGroups.has(hit.pieceEntityId) && hit.status !== 'onTime' && hit.status !== 'drifting' && hit.status !== 'open').length;
	const made = new Set(group.pieceIds);
	const laneOf = (id: string): string | null => working.entities.find((entity) => entity.id === id)?.components.hitLink?.laneId ?? null;
	const otherMarbleTouches =
		result == null
			? []
			: touchingPairs(working, result).flatMap((pair) => {
					const [mine, other] = made.has(pair.a) ? [pair.a, pair.b] : [pair.b, pair.a];
					const otherLane = laneOf(other);
					if (!made.has(mine) || otherLane == null || otherLane === lane.id) return [];
					return [`${name} touches ${working.music.lanes.find((item) => item.id === otherLane)?.name ?? 'another marble'}’s pieces at ${wordsForHitTime(pair.time)}. Patterns work one marble at a time for now.`];
				});
	return {
		commands,
		groupId,
		name,
		problems: fit.problems,
		blocking,
		nearestWidth: fit.nearestWidth,
		later: outcomes,
		laterLateHits,
		otherMarbleTouches: [...new Set(otherMarbleTouches)],
		notes: fit.notes,
		measures: result != null ? measurePattern(working, result, lane.id, change.kind === 'longRail' ? undefined : target.hitIds) : null,
		entities: fit.entities,
		project: working
	};
}

/** The marble released at this time, staying where it is */
function withReleaseAt(project: TProject, laneId: string, time: number): TProject {
	return { ...project, entities: project.entities.map((entity) => (entity.components.marble?.laneId === laneId && entity.components.release != null ? { ...entity, components: { ...entity.components, release: { ...entity.components.release, time } } } : entity)) };
}

/**
 * A fit makes its pieces new, so each takes the look and name of the piece it replaces: the one on its hit, else any of
 * the Group's of its type, so a piece a resize adds matches. A Skin's Depth comes along through `barSizeOf`.
 */
function keepingSkins(project: TProject, pieceIds: readonly string[], fit: TFitPatternResult): TFitPatternResult {
	const replaced = new Set([...pieceIds, ...fit.removedIds]);
	const old = project.entities.filter((entity) => replaced.has(entity.id));
	if (!old.length) return fit;
	const dressed = new Map<string, TEntity>();
	for (const entity of fit.entities) {
		const type = entity.components.piece?.type;
		const sameType = old.filter((item) => item.components.piece?.type === type);
		const own = sameType.find((item) => item.components.hitLink != null && item.components.hitLink.hitId === entity.components.hitLink?.hitId) ?? sameType.find((item) => item.id === entity.id);
		const skin = (own ?? sameType.find((item) => item.components.skin != null))?.components.skin;
		dressed.set(entity.id, { ...entity, ...(own?.name != null ? { name: own.name } : {}), components: { ...entity.components, ...(skin != null ? { skin } : {}) } });
	}
	return { ...fit, entities: fit.entities.map((entity) => dressed.get(entity.id) ?? entity), project: { ...fit.project, entities: fit.project.entities.map((entity) => dressed.get(entity.id) ?? entity) } };
}

/** The size a Group's bars have now, so running it again keeps a Length or Depth changed by hand */
function barSizeOf(project: TProject, pieceIds: readonly string[]): { barLength?: number; barDepth?: number } {
	const ids = new Set(pieceIds);
	const params = project.entities.find((entity) => ids.has(entity.id) && entity.components.piece?.type === 'platform')?.components.piece?.params;
	return { ...(params?.['length'] != null ? { barLength: params['length'] } : {}), ...(params?.['depth'] != null ? { barDepth: params['depth'] } : {}) };
}

/** The bars before a rail played again, the last one keeping its own direction; null when that leaves problems of its own */
function refitBarsWithoutTurn(group: TPatternGroup, lane: TLane, working: TProject, sim: TSimulator, wearing: TProject): TFitPatternResult | null {
	if (group.kind === 'longRail') return null;
	const hits = hitsInRange(lane, group.from, group.to).map((hit) => hit.id);
	const fit = keepingSkins(wearing, group.pieceIds, fitPattern({ project: withoutPieces(working, group.pieceIds), laneId: lane.id, hitIds: hits, kind: group.kind, width: group.width, bounce: group.bounce, ...(group.maxTilt != null ? { maxTilt: group.maxTilt } : {}), keepsDirection: true, ...barSizeOf(working, group.pieceIds) }, { sim }));
	return fit.entities.length > 0 ? fit : null;
}

/**
 * Groups a new range runs over give up what it covers: their pieces on its hits go, their range shrinks to the hits
 * left before it, and the pieces after it stay as plain pieces. Nothing is left in a Group's list that it no longer plays.
 */
function trimOverlaps(project: TProject, others: readonly TPatternGroup[], hitIds: readonly string[], lane: TLane, from: number, to: number): { trimmed: TPatternGroup[]; removedGroupIds: string[]; freed: string[] } {
	const trimmed: TPatternGroup[] = [];
	const removedGroupIds: string[] = [];
	const freed: string[] = [];
	const covered = new Set(hitIds);
	for (const group of others) {
		if (group.to < from || group.from > to) continue;
		if (group.kind === 'longRail') {
			removedGroupIds.push(group.id);
			freed.push(...group.pieceIds);
			continue;
		}
		const left = hitsInRange(lane, group.from, group.to).filter((hit) => hit.time < from);
		if (!left.length) {
			removedGroupIds.push(group.id);
			continue;
		}
		const leftIds = new Set(left.map((hit) => hit.id));
		const pieceIds = group.pieceIds.filter((id) => {
			const hitId = project.entities.find((entity) => entity.id === id)?.components.hitLink?.hitId;
			return hitId != null && leftIds.has(hitId) && !covered.has(hitId);
		});
		trimmed.push({ ...group, to: left.at(-1)?.time ?? group.to, pieceIds });
	}
	return { trimmed, removedGroupIds, freed };
}

/** One command batch from one project to the next: pieces gone, pieces new or changed, Groups changed */
function editCommands(from: TProject, to: TProject, groups: readonly TGroup[], removedGroupIds: readonly string[]): TProjectCommand[] {
	const before = new Map(from.entities.map((entity) => [entity.id, entity]));
	const after = new Set(to.entities.map((entity) => entity.id));
	const gone = from.entities.filter((entity) => !after.has(entity.id)).map((entity) => entity.id);
	const changed = to.entities.filter((entity) => before.get(entity.id) !== entity);
	return [
		...(gone.length > 0 ? [{ type: 'removeEntities' as const, entityIds: gone }] : []),
		...changed.map((entity) => ({ type: 'upsertEntity' as const, entity })),
		...(removedGroupIds.length > 0 ? [{ type: 'removeGroups' as const, groupIds: [...removedGroupIds] }] : []),
		...groups.map((group) => ({ type: 'upsertGroup' as const, group }))
	];
}
