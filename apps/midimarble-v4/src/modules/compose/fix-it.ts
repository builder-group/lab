import type { TComponents, TEntity, TProject, TProjectCommand, TVec2 } from '@/modules/project';
import { FINISH_TYPE } from '@/modules/simulation/finish';
import { finishFix, hitKeyOf, isBroken, newlyBroken } from './finish-assist';
import {
	extraStrikes,
	rollingHits,
	findLongGaps,
	frameBand,
	freePose,
	getPieceDefinition,
	gravityOf,
	isMusicalPiece,
	layoutOf,
	shapesBounds,
	shapesDistance,
	soundsHit,
	touchingPairs,
	trajectoryAt,
	transformShape,
	type TGapPieceType,
	type THitResult,
	type TLongGap,
	type TResolvedPiece,
	type TSimulationResult
} from '@/modules/simulation';
import { crossesOtherLanes, openFrontiers } from '@/modules/simulation/assists';
import { resolvedPieceShapes, shapesGap } from '@/modules/simulation/clearance';
import { preflightExport, type TPreflightIssue } from '@/modules/design/export-preflight';

// Fix-its after edits that break the run, like Xcode's: the edit's notice, the Blocked or Missed platform's
// inspector header and the hit summary's menu offer Fix Hits, which runs Auto place again for the broken hits.
// Blocked scenery (a windmill, switchback, rail or tunnel that follows a marble) gets Move Clear instead.

/** A hit whose platform no longer plays it: Blocked, Missed or Stopped */
/** A hit that needs attention while its marble's run is being mended: broken, early or late, or on time but outside its lane */
function needsFix(project: TProject, hit: THitResult): boolean {
	if (isBroken(hit) || hit.status === 'drifting') return true;
	if (hit.dot == null) return false;
	const band = frameBand(project, hit.laneId);
	return Math.abs(hit.dot.x - band.centerX) > band.halfWidth;
}

/**
 * The broken hits Fix Hits counts in its label, in time order: Blocked, Missed or Stopped hits, and the early or
 * late ones after the first of them on the same marble, which the same edit usually pushed off. With `only`,
 * just those hits (`laneId/hitId` keys) when their platform does not land on time.
 */
export function brokenHits(results: THitResult[], only?: string[]): THitResult[] {
	const sorted = results.filter((hit) => hit.pieceEntityId != null).sort((a, b) => a.targetTime - b.targetTime);
	if (only != null) {
		const wanted = new Set(only);
		return sorted.filter((hit) => wanted.has(hitKeyOf(hit)) && hit.status !== 'onTime');
	}
	const firstBroken = new Map<string, number>();
	for (const hit of sorted) if (isBroken(hit) && !firstBroken.has(hit.laneId)) firstBroken.set(hit.laneId, hit.targetTime);
	return sorted.filter((hit) => {
		const from = firstBroken.get(hit.laneId);
		return from != null && hit.targetTime >= from && (isBroken(hit) || hit.status === 'drifting');
	});
}

/**
 * "Fix 24 Hits", or "Fix Hit 3 of Melody" for one: a verb and the count, like Figma's quick actions. The label
 * counts the broken hits, which are known before Fix Hits runs; how many platforms it tilts again is known only
 * after, and the result names it.
 */
export function replaceLabel(count: number, hitName?: string): string {
	if (count === 1) return hitName == null ? 'Fix 1 Hit' : `Fix ${hitName}`;
	return `Fix ${count} Hits`;
}

/** What Fix Hits will do, so its button names every kind of change before it runs */
export interface TReplacePlan {
	/** Broken hits it fixes by tilting platforms again */
	platforms: number;
	/** Names of Blocked scenery pieces it moves clear, places again or deletes */
	scenery: string[];
	/** Their entities, for the what-if that names each fix */
	sceneryIds: string[];
	/** Names of the marbles whose release moves to just before their first note */
	releases: string[];
	/** Pieces a marble strikes twice or rolls on or that touch another, fixed one by one when nothing else is wrong */
	looks: string[];
	/**
	 * The one label of the command, in the edit's notice and the hit summary's menu, a verb and a count: "Fix 45
	 * Hits", "Fix Hit 7 of Melody", or for Blocked scenery alone "Move Windmill 1 Clear". A moved release or
	 * scenery fixed along with the hits is named in the tooltip, not in the label.
	 */
	label: string;
	/**
	 * The tooltip, one sentence of about 15 words saying what it does: "Places platforms again so each hit lands on
	 * time, moves Melody's release and deletes Rail 1"
	 */
	title: string;
	isEmpty: boolean;
}

/**
 * The plan of Fix Hits for the run as it is: the broken hits, the Blocked scenery and the
 * releases `releaseFix` moves given `before`, the hits from before the edit that broke the run. `sceneryFixes`
 * holds the fix a what-if found for a Blocked piece (`sceneryFix`), so the label names what will happen to it;
 * a piece not checked yet reads Move Clear.
 */
export function replacePlan(project: TProject, result: TSimulationResult, before?: THitResult[], sceneryFixes?: ReadonlyMap<string, TSceneryFixKind | null>): TReplacePlan {
	const broken = brokenHits(result.hits);
	const platforms = broken.length;
	const names = (laneIds: Iterable<string>): string[] => [...laneIds].map((id) => project.music.lanes.find((lane) => lane.id === id)?.name ?? 'the marble');
	const releases = names([...new Set(broken.map((hit) => hit.laneId))].filter((laneId) => releaseFix(project, result.hits, laneId, before).length > 0));
	const blocked = blockedScenery(project, result).map((piece) => piece.entityId);
	const scenery = blocked.map((id) => pieceName(project, id));
	const only = broken.length === 1 ? broken[0] : undefined;
	const replace = platforms > 0 ? replaceLabel(platforms, only == null ? undefined : hitName(project, only)) : '';
	const looks = platforms === 0 && blocked.length === 0 ? lookPieces(project, result) : [];
	const kinds = new Set(blocked.map((id) => sceneryFixes?.get(id) ?? 'moveClear'));
	const kind = kinds.size === 1 ? [...kinds][0] : 'moveClear';
	const move = scenery.length === 0 ? '' : sceneryFixLabel(kind ?? 'moveClear', scenery.length <= 2 ? joinWords(scenery) : `${scenery.length} Pieces`);
	// The outcome is the label; the release and the scenery fixed along with the hits go in the tooltip
	const label = replace !== '' ? replace : move !== '' ? move : looks.length > 0 ? `Fix ${looks.length} ${looks.length === 1 ? 'Platform' : 'Platforms'}` : '';
	const sceneryVerb = (id: string): string => {
		const name = pieceName(project, id);
		const fix = sceneryFixes?.get(id) ?? 'moveClear';
		return fix === 'delete' ? `deletes ${name}` : fix === 'placeAgain' ? `places ${name} again` : `moves ${name} clear`;
	};
	const steps = [
		platforms > 0 ? (platforms === 1 ? 'Places the platform again so the hit lands on time' : 'Places platforms again so each hit lands on time') : '',
		releases.length > 0 ? `moves the release of ${joinWords(releases)}` : '',
		looks.length > 0 ? 'Tilts again what a marble strikes twice or rolls on, or what touches' : '',
		...(blocked.length > 2 ? [`fixes ${blocked.length} blocked pieces`] : blocked.map(sceneryVerb))
	].filter(Boolean);
	const title = steps.length ? capitalize(joinWords(steps)) : 'Nothing to fix';
	return {
		platforms,
		scenery,
		sceneryIds: blocked,
		releases,
		looks,
		label: label === '' ? 'Fix Hits' : label,
		title,
		isEmpty: platforms === 0 && scenery.length === 0 && looks.length === 0
	};
}

/** How the run stands after a fix, from the one problem model: the hit summary's label and the problems the fix added */
export interface TFixStanding {
	/** The hit summary's label, such as "108 of 108 hits on time · 3 other problems" */
	label: string;
	/** Hits that still need attention */
	hitProblems: number;
	/** Problems the run did not have before the fix (`addedProblems`) */
	added: TPreflightIssue[];
}

/**
 * The fix result after Fix Hits, in words.md's form: what changed, then how the run stands, ending with the hit
 * summary's label and the problems the fix added, like Xcode's new issues after a Fix-it. It names every piece it
 * changed besides platforms, and how many of the broken hits are fixed, since a moved release or one new tilt
 * often fixes many platforms at once.
 */
export function replaceResultMessage(
	project: TProject,
	before: THitResult[],
	outcome: Pick<TReplaceOutcome, 'project' | 'result' | 'replaced' | 'moved' | 'cleared' | 'releases'> & Partial<Pick<TReplaceOutcome, 'removed'>>,
	standing: TFixStanding
): string {
	const releases = outcome.releases.map((laneId) => outcome.project.music.lanes.find((lane) => lane.id === laneId)?.name ?? 'the marble');
	const started = releases.length
		? `${releases.join(' and ')} now ${releases.length === 1 ? 'starts' : 'start'} just before ${releases.length === 1 ? 'its' : 'their'} first note. `
		: '';
	const changes = [
		outcome.replaced > 0 ? `placed ${outcome.replaced} ${outcome.replaced === 1 ? 'platform' : 'platforms'} again` : '',
		outcome.moved.length > 0 ? `placed ${joinWords(outcome.moved.map((id) => pieceName(outcome.project, id)))} again` : '',
		outcome.cleared.length > 0 ? `moved ${joinWords(outcome.cleared.map((id) => pieceName(project, id)))} clear` : '',
		(outcome.removed ?? []).length > 0 ? `deleted ${joinWords((outcome.removed ?? []).map((id) => pieceName(project, id)))}, which the new run passes through and no longer uses` : ''
	].filter(Boolean);
	const wasBroken = brokenHits(before).map(hitKeyOf);
	const still = new Set(brokenHits(outcome.result.hits).map(hitKeyOf));
	const fixed = wasBroken.filter((key) => !still.has(key)).length;
	const parts = [...(changes.length ? changes : ['moved the release']), fixedWords(fixed, wasBroken.length)].filter(Boolean);
	// Names inside a part are joined with "and", so a list of three parts takes a serial comma
	const did = capitalize(parts.length > 2 ? `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1) ?? ''}` : parts.join(' and '));
	const added = standing.added.length ? ` · ${standing.added.length} new ${standing.added.length === 1 ? 'problem' : 'problems'}: ${standing.added.map((issue) => issue.title).join('; ')}` : '';
	const advice = standing.hitProblems > 0 ? `. Turn ${standing.hitProblems === 1 ? 'it' : 'them'} by hand or undo the edit.` : '';
	return `${started}${did}: ${standing.label}${added}${advice}`;
}

/**
 * The two-line result notice after Fix Hits, with the full `replaceResultMessage` behind its Details: how many
 * hits it fixed, what it changed in a few words, then the hit summary's label and the problems it added, like
 * "Fixed 37 hits · placed 13 platforms again · deleted Rail 1 · 108 of 108 hits on time"
 */
export function replaceResultSummary(
	project: TProject,
	before: THitResult[],
	outcome: Pick<TReplaceOutcome, 'project' | 'result' | 'replaced' | 'moved' | 'cleared' | 'releases'> & Partial<Pick<TReplaceOutcome, 'removed'>>,
	standing: TFixStanding
): string {
	const counted = brokenHits(before).map(hitKeyOf);
	const fixed = fixedCount(counted, outcome.result.hits);
	const total = counted.length;
	const removed = outcome.removed ?? [];
	const others = outcome.moved.length + outcome.cleared.length;
	const parts = [
		total === 0 ? '' : fixed < total ? `Fixed ${fixed} of ${total} hits` : total === 1 ? 'Fixed the hit' : `Fixed ${total} hits`,
		outcome.replaced > 0 ? `placed ${outcome.replaced} ${outcome.replaced === 1 ? 'platform' : 'platforms'} again` : '',
		outcome.releases.length > 0 ? `moved ${outcome.releases.length === 1 ? 'the release' : `${outcome.releases.length} releases`}` : '',
		others > 0 ? `moved ${others} ${others === 1 ? 'piece' : 'pieces'}` : '',
		removed.length === 1 ? `deleted ${pieceName(project, removed[0] ?? '')}` : removed.length > 1 ? `deleted ${removed.length} pieces` : '',
		standing.label,
		standing.added.length > 0 ? `${standing.added.length} new ${standing.added.length === 1 ? 'problem' : 'problems'}` : ''
	].filter(Boolean);
	return capitalize(parts.join(' · '));
}

/** How many of the `counted` hits (`laneId/hitId` keys) are no longer broken in `hits` */
export function fixedCount(counted: string[], hits: THitResult[]): number {
	const still = new Set(brokenHits(hits).map(hitKeyOf));
	return counted.filter((key) => !still.has(key)).length;
}

/** "fixed the broken hit", "fixed both broken hits", "fixed all 38 broken hits" or "fixed 37 of 38 broken hits" */
export function fixedWords(fixed: number, total: number): string {
	if (total === 0) return '';
	if (fixed < total) return `fixed ${fixed} of ${total} broken ${total === 1 ? 'hit' : 'hits'}`;
	if (total === 1) return 'fixed the broken hit';
	if (total === 2) return 'fixed both broken hits';
	return `fixed all ${total} broken hits`;
}

// MARK: - Move Clear

/** Scenery that follows a marble but is left out because the marble's earlier run passes through it */
export function blockedScenery(project: TProject, result: TSimulationResult): TResolvedPiece[] {
	return result.pieces.filter((piece) => {
		if (piece.status !== 'blocked') return false;
		const entity = project.entities.find((item) => item.id === piece.entityId);
		const link = entity?.components.hitLink;
		return link != null && !soundsHit(entity?.components.piece?.type ?? piece.type, link);
	});
}

// Clearance kept from the earlier run, beyond the marble's radius
const CLEAR_MARGIN = 0.003;
// Samples this close before the piece starts may touch it, as a piece that follows the marble touches it
const TOUCH_WINDOW = 0.1;
const CLEAR_STEP = 0.005;
const CLEAR_MAX = 0.4;
const CLEAR_DIRECTIONS = 24;

/**
 * Move Clear for a piece that follows a marble and is Blocked or hit by another marble: the smallest nudge of
 * its offset from the marble that clears every marble's run before the piece starts and the other marbles' runs
 * after it, without overlapping another piece. Its tie stays, so it still follows the same marble at the same
 * moment. The earlier run does not depend on the piece, which was left out, so the check on the current result
 * holds after the move; the other marbles' later runs hold while the move does not change them, which callers
 * check with a what-if run (`moveClearWhatIf`). Null when no spot within 40 cm clears.
 */
export function moveClear(project: TProject, result: TSimulationResult, entityId: string): { commands: TProjectCommand[]; distance: number } | null {
	const entity = project.entities.find((item) => item.id === entityId);
	const link = entity?.components.hitLink;
	const resolved = result.pieces.find((piece) => piece.entityId === entityId);
	if (entity == null || link == null || resolved == null) return null;
	const ownMarble = result.marbles.find((track) => track.laneId === link.laneId)?.entityId;
	if (resolved.status !== 'blocked' && !strayHitters(project, result, entityId).length) return null;
	const type = entity.components.piece?.type ?? resolved.type;
	const time = resolved.entryTime ?? resolved.hitTime ?? 0;
	const shapes = resolvedPieceShapes(resolved);
	const bounds = shapesBounds(shapes);
	// A turning windmill sweeps a disc around its hub
	const isTurning = layoutOf(type) === 'rotor' && (resolved.params['motorSpeed'] ?? 0) !== 0;
	const hub = resolved.position;
	const reach = Math.max(...[bounds.minX, bounds.maxX].flatMap((x) => [bounds.minY, bounds.maxY].map((y) => Math.hypot(x - hub.x, y - hub.y))));
	const pad = CLEAR_MAX + CLEAR_MARGIN + 0.05;

	const near: { x: number; y: number; clear: number }[] = [];
	for (const track of result.marbles) {
		// Other marbles' runs stay obstacles while the piece is there; its own marble rides it after it starts
		const isOther = track.entityId !== ownMarble;
		for (const sample of track.samples) {
			if (sample.time > time + 1e-9 && !isOther) break;
			const { x, y } = sample.position;
			if (x < bounds.minX - pad || x > bounds.maxX + pad || y < bounds.minY - pad || y > bounds.maxY + pad) continue;
			near.push({
				x,
				y,
				clear: track.radius + (sample.time < time - TOUCH_WINDOW || isOther ? CLEAR_MARGIN : 0)
			});
		}
	}
	const others = result.pieces
		.filter((piece) => piece.entityId !== entityId && piece.status !== 'blocked' && piece.status !== 'unreached')
		.map(resolvedPieceShapes)
		.filter((items) => {
			const other = shapesBounds(items);
			return other.maxX > bounds.minX - pad && other.minX < bounds.maxX + pad && other.maxY > bounds.minY - pad && other.minY < bounds.maxY + pad;
		});

	// The smallest clearance to the earlier run with the piece moved by `d`, minus what each sample needs
	const slack = (d: TVec2): number => {
		let least = Infinity;
		for (const sample of near) {
			const x = sample.x - d.x;
			const y = sample.y - d.y;
			const distance = isTurning ? Math.hypot(x - hub.x, y - hub.y) - reach : shapesDistance(shapes, x, y);
			least = Math.min(least, distance - sample.clear);
			if (least < 0) return least;
		}
		return least;
	};
	const overlaps = (d: TVec2): boolean => {
		if (!others.length) return false;
		const moved = shapes.map((shape) => transformShape(shape, d, 0));
		return others.some((items) => shapesGap(moved, items, 0.01) < 0.002);
	};

	let best: { d: TVec2; slack: number } | null = null;
	for (let radius = CLEAR_STEP; radius <= CLEAR_MAX + 1e-9 && best == null; radius += CLEAR_STEP) {
		for (let index = 0; index < CLEAR_DIRECTIONS; index++) {
			const angle = (index / CLEAR_DIRECTIONS) * 2 * Math.PI;
			const d = { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
			const value = slack(d);
			// The roomiest spot on the first ring that clears
			if (value >= 0 && (best == null || value > best.slack) && !overlaps(d)) best = { d, slack: value };
		}
	}
	if (best == null) return null;

	let offset: TVec2;
	let angle = link.angle;
	if (link.offset != null) {
		offset = { x: link.offset.x + best.d.x, y: link.offset.y + best.d.y };
	} else {
		// A piece placed touching the marble gets the offset that keeps its pose, then the nudge
		const track = result.marbles.find((item) => item.laneId === link.laneId);
		const sample = track != null ? trajectoryAt(track.samples, time, gravityOf(project)) : null;
		if (track == null || sample == null) return null;
		const pose = freePose(entity, resolved, track.radius);
		offset = {
			x: pose.position.x + best.d.x - sample.position.x,
			y: pose.position.y + best.d.y - sample.position.y
		};
		angle = pose.angle;
	}
	const hitLink = { ...link, angle, offset: { x: round4(offset.x), y: round4(offset.y) } };
	return {
		commands: [{ type: 'setComponent', entityId, component: { name: 'hitLink', value: hitLink } }],
		distance: Math.hypot(best.d.x, best.d.y)
	};
}

/** A fix for one piece, checked with a what-if run before it is applied */
export interface TPieceFix {
	/** Null when no change passes the check; `message` then says why and what to do */
	commands: TProjectCommand[] | null;
	/** The edit's notice, or why nothing changed */
	message: string;
	/** The run with the fix applied */
	run?: TSimulationResult;
	/** The Fix-it's label for what passed: "Move Rail 1 Clear", "Place Rail 1 Again", "Delete Rail 1", "Place Again" */
	label?: string;
	/** What no local change can do without breaking later hits: Rebuild From Here, from this hit */
	rebuildFrom?: { laneId: string; hitId: string };
	/** What passed for scenery */
	kind?: TSceneryFixKind;
}

/**
 * The Fix-it of a piece that follows a marble and is Blocked or hit by another marble, checked like the windmill
 * hover's "Breaks no hits": Move Clear nudges scenery off the runs, and a platform another marble hits gets that
 * marble's platform before the hit tilted again by Auto place, which keeps clear of the other lanes. A change is
 * kept only when the what-if run clears the piece, breaks no hit that is on time and adds no problem.
 */
export async function fixPiece(
	project: TProject,
	result: TSimulationResult,
	entityId: string,
	deps: Pick<TReplaceDeps, 'simulate' | 'autoPlace'> & Partial<Pick<TReplaceDeps, 'gapPiece'>>
): Promise<TPieceFix> {
	const entity = project.entities.find((item) => item.id === entityId);
	const link = entity?.components.hitLink;
	const type = entity?.components.piece?.type;
	const name = pieceName(project, entityId);
	if (entity == null || link == null || type == null) return { commands: null, message: `${name} follows no marble` };
	const laneName = (laneId: string): string => project.music.lanes.find((lane) => lane.id === laneId)?.name ?? 'the marble';
	const hitters = strayHitters(project, result, entityId);
	const check = async (commands: TProjectCommand[]): Promise<{ run: TSimulationResult; broken: number; added: TPreflightIssue[]; isClear: boolean }> => {
		const next = withCommands(project, commands);
		const run = await deps.simulate(next);
		const added = addedProblems(project, result, next, run);
		const isClear = run.pieces.find((piece) => piece.entityId === entityId)?.status !== 'blocked' && !strayHitters(next, run, entityId).length;
		return { run: { ...run, revision: project.revision }, broken: newlyBroken(result.hits, run.hits).length, added, isClear };
	};
	const refusal = (what: string, broken: number, added: TPreflightIssue[]): string =>
		broken > 0
			? `${what} would break ${broken === 1 ? 'a hit' : `${broken} hits`}, so nothing moved`
			: `${what} would add a problem (${added[0]?.title ?? 'another marble'}), so nothing moved`;

	// A Finish is placed again on its marble's fall, wherever it went wrong
	if (type === FINISH_TYPE) {
		const fix = await finishFix(project, result, entityId, deps);
		return { commands: fix.commands, message: fix.message, label: fix.label, kind: fix.commands != null ? 'placeAgain' : undefined };
	}
	// Struck twice, rolled on or touching: another tilt, unless something more serious about the piece comes first
	if (!hitters.length && result.pieces.find((piece) => piece.entityId === entityId)?.status !== 'blocked' && lookPieces(project, result).includes(entityId)) return fixLook(project, result, entityId, check, deps);
	if (!soundsHit(type, link)) {
		const fix = await sceneryFix(project, result, entityId, deps);
		return { commands: fix.commands, run: fix.run, message: fix.message, label: fix.kind == null ? undefined : sceneryFixLabel(fix.kind, name), kind: fix.kind ?? undefined };
	}

	// A platform another marble hits: that marble's platform before the hit tilts so it passes clear
	const hitter = hitters[0];
	if (hitter == null) return { commands: null, message: `No other marble hits ${name}` };
	const before = result.hits
		.filter((hit) => hit.laneId === hitter.laneId && hit.pieceEntityId != null && hit.targetTime < hitter.time - 1e-6)
		.sort((a, b) => b.targetTime - a.targetTime)
		.slice(0, 2);
	let refused = '';
	for (const target of before) {
		const platform = project.entities.find((item) => item.id === target.pieceEntityId);
		if (platform == null) continue;
		let placed: TEntity;
		try {
			placed = await deps.autoPlace(project, target, platform);
		} catch {
			continue;
		}
		const commands = replaceCommands(project, placed);
		if (!commands.length) continue;
		const what = await check(commands);
		if (what.isClear && what.broken === 0 && what.added.length === 0) {
			return { commands, run: what.run, label: 'Place Again', message: `Placed ${pieceName(project, platform.id)} again: ${laneName(hitter.laneId)} now passes clear of ${name}` };
		}
		refused ||= what.isClear ? refusal(`Placing ${pieceName(project, platform.id)} again`, what.broken, what.added) : '';
	}
	return { commands: null, message: `${refused || `No new tilt of ${laneName(hitter.laneId)}'s platforms before it keeps ${laneName(hitter.laneId)} clear of ${name}`}. Drag it by hand, or move ${laneName(hitter.laneId)}'s platforms.` };
}

/** Pieces a marble strikes twice or rolls on, and the later piece of each pair that touches, in time order */
export function lookPieces(project: TProject, result: TSimulationResult): string[] {
	const items = [...extraStrikes(project, result).map((strike) => ({ id: strike.entityId, time: strike.time })), ...rollingHits(project, result).map((roll) => ({ id: roll.entityId, time: roll.time })), ...touchingPairs(project, result).map((pair) => ({ id: pair.b, time: pair.time }))];
	return [...new Set(items.sort((a, b) => a.time - b.time).map((item) => item.id))];
}

/**
 * The Fix of a platform its marble strikes twice or rolls on or of a piece touching another, each try kept only when its what-if clears
 * the piece, breaks no hit, adds no problem and leaves no more pieces touching or struck twice than before. In order of how
 * little they change: for a touching platform a shorter length, which changes nothing in the run, or its strike further
 * along it; then a small turn of the platform, then of the one before it, which sets where the marble arrives; then Auto
 * place for both.
 */
async function fixLook(
	project: TProject,
	result: TSimulationResult,
	entityId: string,
	check: (commands: TProjectCommand[]) => Promise<{ run: TSimulationResult; broken: number; added: TPreflightIssue[] }>,
	deps: Pick<TReplaceDeps, 'autoPlace'>
): Promise<TPieceFix> {
	const name = pieceName(project, entityId);
	const entity = project.entities.find((item) => item.id === entityId);
	const link = entity?.components.hitLink;
	const time = result.hits.find((hit) => hit.laneId === link?.laneId && hit.hitId === link?.hitId)?.targetTime ?? Infinity;
	const platforms = result.hits
		.filter((hit) => hit.laneId === link?.laneId && hit.pieceEntityId != null && hit.targetTime <= time + 1e-6)
		.sort((a, b) => b.targetTime - a.targetTime)
		.slice(0, 2)
		.flatMap((hit) => project.entities.find((item) => item.id === hit.pieceEntityId) ?? []);
	const touching = touchingPairs(project, result).length;
	const strikes = extraStrikes(project, result).length;
	const rolls = rollingHits(project, result).length;
	const isStruck = extraStrikes(project, result).some((strike) => strike.entityId === entityId);
	const isRolled = rollingHits(project, result).some((roll) => roll.entityId === entityId);
	const tryCommands = async (commands: TProjectCommand[], did: string): Promise<TPieceFix | null> => {
		if (!commands.length) return null;
		const what = await check(commands);
		if (what.broken > 0 || what.added.length > 0) return null;
		const next = withCommands(project, commands);
		if (lookPieces(next, what.run).includes(entityId) || touchingPairs(next, what.run).length > touching || extraStrikes(next, what.run).length > strikes || rollingHits(next, what.run).length > rolls) return null;
		return { commands, run: what.run, label: 'Place Again', message: `${did}: ${isStruck ? `the marble now hits ${name} once` : isRolled ? `the marble now bounces off ${name}` : `${name} now stands clear`}` };
	};
	const piece = entity?.components.piece;
	if (!isStruck && !isRolled && entity != null && link != null && piece != null && isMusicalPiece(piece.type)) {
		const length = piece.params['length'] ?? getPieceDefinition(piece.type)?.params['length']?.default;
		for (const share of LOOK_SHORTER) {
			if (length == null) break;
			const params = { ...piece.params, length: round4(length * share) };
			const fixed = await tryCommands([{ type: 'setComponent', entityId, component: { name: 'piece', value: { ...piece, params } } }], `Shortened ${name}`);
			if (fixed != null) return fixed;
		}
		for (const contactAt of LOOK_CONTACTS) {
			const fixed = await tryCommands([{ type: 'setComponent', entityId, component: { name: 'hitLink', value: { ...link, contactAt } } }], `Moved ${name} along its surface`);
			if (fixed != null) return fixed;
		}
	}
	for (const platform of platforms) {
		const platformLink = platform.components.hitLink;
		if (platformLink == null) continue;
		for (const degrees of LOOK_TURNS) {
			const value = { ...platformLink, angle: round4(platformLink.angle + degrees * DEGREE) };
			const fixed = await tryCommands([{ type: 'setComponent', entityId: platform.id, component: { name: 'hitLink', value } }], `Turned ${pieceName(project, platform.id)} by ${degrees}°`);
			if (fixed != null) return fixed;
		}
	}
	for (const platform of platforms) {
		const target = result.hits.find((hit) => hit.pieceEntityId === platform.id);
		if (target == null) continue;
		let placed: TEntity;
		try {
			placed = await deps.autoPlace(project, target, platform);
		} catch {
			continue;
		}
		const fixed = await tryCommands(replaceCommands(project, placed), `Placed ${pieceName(project, platform.id)} again`);
		if (fixed != null) return fixed;
	}
	// Every marble's later hits follow each tilt, so what is left is to build them again from the hit before this one
	const hits = project.music.lanes.find((lane) => lane.id === link?.laneId)?.hits ?? [];
	const before = hits[hits.findIndex((hit) => hit.id === link?.hitId) - 1];
	return {
		commands: null,
		label: 'Rebuild From Here',
		message: `Any new tilt of ${name} moves the hits after it. Rebuild From Here keeps the track before it and builds the rest again.`,
		...(before != null && link != null ? { rebuildFrom: { laneId: link.laneId, hitId: before.id } } : {})
	};
}

/**
 * The other marbles that hit a piece tied to a marble, in the order they first do, as the problem model reports
 * them ("Bass hits Switchback 6 of Melody"): a marble touching another lane's piece outside a note
 */
export function strayHitters(project: TProject, result: TSimulationResult, entityId: string): { marbleEntityId: string; laneId: string; time: number }[] {
	const link = project.entities.find((entity) => entity.id === entityId)?.components.hitLink;
	if (link == null) return [];
	const hitters = new Map<string, { marbleEntityId: string; laneId: string; time: number }>();
	for (const contact of result.contacts) {
		if (contact.otherEntityId !== entityId || contact.time > result.duration || hitters.has(contact.marbleEntityId)) continue;
		const laneId = result.marbles.find((track) => track.entityId === contact.marbleEntityId)?.laneId;
		if (laneId == null || laneId === link.laneId) continue;
		hitters.set(contact.marbleEntityId, { marbleEntityId: contact.marbleEntityId, laneId, time: contact.time });
	}
	return [...hitters.values()].sort((a, b) => a.time - b.time);
}

/** What fixes a Blocked or struck piece that plays no note */
export type TSceneryFixKind = 'moveClear' | 'placeAgain' | 'delete';

/** A scenery fix a what-if run passed, or why none did */
export interface TSceneryFix {
	kind: TSceneryFixKind | null;
	commands: TProjectCommand[] | null;
	/** The edit's notice, or why nothing passes */
	message: string;
	run?: TSimulationResult;
}

/**
 * The first fix of a windmill, switchback, rail or tunnel that is Blocked or that another marble hits, which a
 * what-if run passes: it clears the piece, breaks no hit that is on time and adds no problem. In order: a bridge
 * of a long gap is suggested again for its gap (switchback or rail, as Next does), the piece moves clear (Move
 * Clear), and a Blocked piece is deleted. A Blocked piece is left out of the run, so deleting it changes no hit;
 * it is the fix when the run passes through the spot and no longer uses the piece. Without `gapPiece`, bridges
 * are not suggested again.
 */
export async function sceneryFix(
	project: TProject,
	result: TSimulationResult,
	entityId: string,
	deps: Pick<TReplaceDeps, 'simulate'> & Partial<Pick<TReplaceDeps, 'gapPiece'>> & { isCancelled?: () => boolean }
): Promise<TSceneryFix> {
	const entity = project.entities.find((item) => item.id === entityId);
	const link = entity?.components.hitLink;
	const name = pieceName(project, entityId);
	if (entity == null || link == null) return { kind: null, commands: null, message: `${name} follows no marble` };
	const laneName = (laneId: string): string => project.music.lanes.find((lane) => lane.id === laneId)?.name ?? 'the marble';
	const hitters = strayHitters(project, result, entityId);
	const isBlocked = result.pieces.find((piece) => piece.entityId === entityId)?.status === 'blocked';
	if (!isBlocked && !hitters.length) return { kind: null, commands: null, message: `${name} is clear of every run` };
	const runs = joinWords([...new Set([link.laneId, ...hitters.map((hitter) => hitter.laneId)])].map(laneName));
	let refusal = '';
	const check = async (commands: TProjectCommand[], what: string): Promise<TSimulationResult | null> => {
		const next = withCommands(project, commands);
		const run = await deps.simulate(next);
		const piece = run.pieces.find((item) => item.entityId === entityId);
		const isClear = piece?.status !== 'blocked' && !strayHitters(next, run, entityId).length;
		const broken = newlyBroken(result.hits, run.hits).length;
		const added = addedProblems(project, result, next, run);
		if (isClear && broken === 0 && added.length === 0) return { ...run, revision: project.revision };
		refusal ||= !isClear
			? `${what} leaves it in the way`
			: broken > 0
				? `${what} would break ${broken === 1 ? 'a hit' : `${broken} hits`}`
				: `${what} would add a problem (${added[0]?.title ?? 'another marble'})`;
		return null;
	};

	// A bridge suggested again for its gap, for the run without it
	const gap = findLongGaps(project, link.laneId).find((item) => item.bridgedBy === entityId);
	const type = entity.components.piece?.type;
	if (gap != null && deps.gapPiece != null && isGapPieceType(type)) {
		const types: TGapPieceType[] = type === 'switchback' ? ['switchback', 'rail'] : type === 'rail' ? ['rail', 'switchback'] : [type];
		const without = { ...project, entities: project.entities.filter((item) => item.id !== entityId) };
		for (const kind of types) {
			let suggested: TEntity | null;
			try {
				suggested = await deps.gapPiece(without, gap, kind, entityId);
			} catch {
				suggested = null;
			}
			if (deps.isCancelled?.() === true) return { kind: null, commands: null, message: '' };
			if (suggested == null) continue;
			const commands: TProjectCommand[] = [{ type: 'upsertEntity', entity: { ...suggested, id: entityId, name: kind === type ? entity.name : (suggested.name ?? entity.name) } }];
			const run = await check(commands, `Placing ${name} again`);
			if (run != null) return { kind: 'placeAgain', commands, run, message: `${name} placed again for its gap, clear of ${runs}'s run` };
			break;
		}
	}

	const move = moveClear(project, result, entityId);
	if (move != null) {
		const run = await check(move.commands, `Moving ${name} clear`);
		if (run != null) return { kind: 'moveClear', commands: move.commands, run, message: `${name} moved ${Math.max(1, Math.round(move.distance * 100))} cm, clear of ${runs}'s run` };
	} else refusal ||= `No spot within 40 cm clears ${name} of ${runs}'s run`;

	// A Finish is how the marble ends, wherever the run now goes, so it stays for the person even when Blocked
	if (isBlocked && type !== FINISH_TYPE) {
		const commands: TProjectCommand[] = [{ type: 'removeEntities', entityIds: [entityId] }];
		const run = await check(commands, `Deleting ${name}`);
		if (run != null) return { kind: 'delete', commands, run, message: `${name} deleted: ${laneName(link.laneId)} already passes through its spot, so the run never used it` };
	}
	return { kind: null, commands: null, message: `${refusal || `Nothing clears ${name}`}, so nothing changed. Drag it by hand or Detach it.` };
}

/** A piece tied to a marble that plays no note, such as a windmill, switchback, rail or tunnel */
function isStrayScenery(project: TProject, entityId: string): boolean {
	const entity = project.entities.find((item) => item.id === entityId);
	const link = entity?.components.hitLink;
	const type = entity?.components.piece?.type;
	return link != null && type != null && !soundsHit(type, link);
}

function pieceName(project: TProject, entityId: string): string {
	const entity = project.entities.find((item) => item.id === entityId);
	return entity?.name ?? getPieceDefinition(entity?.components.piece?.type ?? '')?.label ?? 'Piece';
}

/** "Hit 7 of Melody", as the problem list names a hit */
function hitName(project: TProject, hit: Pick<THitResult, 'laneId' | 'hitId'>): string {
	const lane = project.music.lanes.find((item) => item.id === hit.laneId);
	const index = lane?.hits.findIndex((item) => item.id === hit.hitId) ?? -1;
	return `Hit ${index + 1} of ${lane?.name ?? 'the marble'}`;
}

/** The Fix-it label of a Blocked or struck piece by what its what-if found: "Move Rail 1 Clear", "Place Rail 1 Again", "Delete Rail 1" */
export function sceneryFixLabel(kind: TSceneryFixKind, name: string): string {
	switch (kind) {
		case 'moveClear':
			return `Move ${name} Clear`;
		case 'placeAgain':
			return `Place ${name} Again`;
		case 'delete':
			return `Delete ${name}`;
	}
}

function joinWords(items: string[]): string {
	if (items.length < 2) return items[0] ?? '';
	return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}

function capitalize(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Commands that give `entity` the angle and settings Auto place chose, keeping its name, skin and other components */
export function replaceCommands(project: TProject, placed: TEntity): TProjectCommand[] {
	const current = project.entities.find((entity) => entity.id === placed.id);
	const link = placed.components.hitLink;
	const piece = placed.components.piece;
	if (current == null || link == null || piece == null) return [];
	const commands: TProjectCommand[] = [];
	const currentLink = current.components.hitLink;
	if (currentLink == null || currentLink.pinnedPosition != null || JSON.stringify(currentLink) !== JSON.stringify({ ...currentLink, angle: link.angle })) {
		// Placed again, a platform a drag left where it lay follows its note once more
		const { pinnedPosition: _, ...kept } = currentLink ?? link;
		commands.push({
			type: 'setComponent',
			entityId: current.id,
			component: { name: 'hitLink', value: { ...kept, angle: link.angle } }
		});
	}
	const currentPiece = current.components.piece;
	if (currentPiece != null && JSON.stringify(currentPiece.params) !== JSON.stringify(piece.params)) {
		commands.push({
			type: 'setComponent',
			entityId: current.id,
			component: { name: 'piece', value: { ...currentPiece, params: piece.params } }
		});
	}
	return commands;
}

export interface TReplaceDeps {
	simulate: (project: TProject) => Promise<TSimulationResult>;
	/** Auto place for a hit's existing platform; rejects when no angle passes */
	autoPlace: (project: TProject, hit: THitResult, entity: TEntity) => Promise<TEntity>;
	/** A new switchback, rail or tunnel for a long gap, replacing `entityId`; rejects when none fits */
	gapPiece: (project: TProject, gap: TLongGap, type: TGapPieceType, entityId: string) => Promise<TEntity>;
	/** Applies one step's commands; the first step starts the undo step, later ones join it. Null stops. */
	commit: (project: TProject, commands: TProjectCommand[], isFirst: boolean) => TProject | null;
	/**
	 * `done` of `total` broken hits are fixed, `at` is the time of the hit being worked on and `fraction` (0 to 1)
	 * how far the work is, moving on with every try so a hard problem does not stall the bar
	 */
	onProgress?: (done: number, total: number, at: number, fraction: number) => void;
	isCancelled?: () => boolean;
}

export interface TReplaceOptions {
	/** Only these hits (`laneId/hitId` keys), without touching releases or the platforms before them */
	only?: string[];
	/** Hit results from before the edit that broke the run, so a moved release keeps the run as it was */
	before?: THitResult[];
}

export interface TReplaceOutcome {
	project: TProject;
	result: TSimulationResult;
	/** Platforms that got a new angle */
	replaced: number;
	/** Switchbacks, rails and tunnels suggested again for their gap */
	moved: string[];
	/** Broken hits left, and Blocked scenery that could not move clear */
	failed: number;
	/** Lanes whose marble release moved to just before its first note */
	releases: string[];
	/** Blocked scenery moved clear of the run or placed again for its gap */
	cleared: string[];
	/** Blocked scenery deleted, since the new run passes through it and no longer uses it */
	removed: string[];
	/** Stopped by the user or by another edit */
	isStopped: boolean;
}

/**
 * Builds the run again from each marble's first problem onward, the way the step loop built it. A first fall that
 * grew long because the marble's first notes went elsewhere is fixed first by moving the release. Then, at the
 * earliest hit that needs attention, Auto place tilts the platform before it again; a launch into a bridged long
 * gap is tilted for the open gap and its switchback, rail or tunnel suggested again for the new launch, as Next
 * did. Each try is simulated up to `TRY_HORIZON` past the problem, resuming from the snapshot before its first
 * change, and steps are remembered for the next problem that goes back over the same platforms. A change is kept
 * only when, simulated to the end, the problem moves later, no other marble loses a hit, it crosses no other lane
 * and it adds no problem besides the work still ahead on that marble (`addedProblems`). When the platform
 * before cannot fix it, the arrival there is what fails, so Fix Hits goes back up to `MAX_BACKTRACK` platforms
 * further and builds forward from there, and then turns one of the two platforms before the problem by hand, as the
 * fixture builds do. A problem nothing fixes is left as it is and Fix Hits carries on after it, up to `MAX_LEFT`
 * broken hits per marble. Blocked scenery still Blocked after the platforms, and scenery the new run carried into
 * another marble's way, gets a new bridge for its gap or moves clear (Move Clear) when that breaks no hit and adds
 * no problem, and the platforms after it are fitted once more. With `only`, Auto place runs once for each
 * of those platforms.
 */
export async function replaceBroken(project: TProject, result: TSimulationResult, deps: TReplaceDeps, options: TReplaceOptions = {}): Promise<TReplaceOutcome> {
	const { only, before } = options;
	const fixing: TFixing = {
		project,
		result,
		deps,
		only,
		current: project,
		latest: result,
		failed: 0,
		isFirst: true,
		changed: new Set(),
		moved: new Set(),
		releases: [],
		cleared: [],
		removed: [],
		bridges: new Map(),
		left: new Map(),
		leftCount: new Map(),
		steps: new Map()
	};
	const startTime = firstBrokenTime(result, only);
	deps.onProgress?.(0, brokenHits(result.hits, only).length, startTime, 0);
	if (only != null) {
		const isDone = await placeEachAgain(fixing, only);
		return fixOutcome(fixing, !isDone || isCancelled(fixing));
	}
	if (!(await moveReleases(fixing, before))) return fixOutcome(fixing, true);
	const progress = fixProgress(fixing, startTime);
	// Platforms first, since the run they make often clears scenery by itself; then Blocked scenery moves clear,
	// and the platforms after it are fitted once more to the run with the piece in it
	for (let pass = 0; pass < 2; pass++) {
		if (!(await fixPlatforms(fixing, progress))) return fixOutcome(fixing, true);
		if (pass > 0 || isCancelled(fixing)) break;
		if (!(await fixScenery(fixing, progress))) return fixOutcome(fixing, true);
		if (!fixing.cleared.length && !fixing.removed.length) break;
	}
	if (!(await fixLooks(fixing))) return fixOutcome(fixing, true);
	return fixOutcome(fixing, isCancelled(fixing));
}

/** One Fix Hits run: where it started, where it has got to and what it worked out on the way */
interface TFixing {
	project: TProject;
	result: TSimulationResult;
	deps: TReplaceDeps;
	only: string[] | undefined;
	current: TProject;
	latest: TSimulationResult;
	failed: number;
	isFirst: boolean;
	changed: Set<string>;
	moved: Set<string>;
	releases: string[];
	cleared: string[];
	removed: string[];
	/** Bridges suggested per launch, since a backtrack may ask for the same one again */
	bridges: Map<string, TProjectCommand[] | null>;
	/** Problems up to this time are left as they are, per marble */
	left: Map<string, number>;
	/** How many problems were left, per marble */
	leftCount: Map<string, number>;
	/**
	 * Steps already worked out, by the run they start from (its revision and the steps before them in the try) and
	 * their hit. Problems next to each other go back over the same platforms, and a step Auto place chose once
	 * for a run is the same the next time, since the run up to the hit is.
	 */
	steps: Map<string, TProjectCommand[] | null>;
}

/** The progress bar through the platforms: from the first problem to the last linked hit */
interface TFixProgress {
	/** The hits broken when Fix Hits started */
	counted: string[];
	total: number;
	startTime: number;
	lastTime: number;
	done: number;
	fraction: number;
	/** Tries at the current problem */
	tries: number;
}

function isCancelled(fixing: TFixing): boolean {
	return fixing.deps.isCancelled?.() === true;
}

function fixOutcome(fixing: TFixing, isStopped: boolean): TReplaceOutcome {
	const { current, latest, changed, moved, cleared, removed, failed, only, releases } = fixing;
	return {
		project: current,
		result: latest,
		replaced: changed.size,
		moved: [...moved].filter((id) => !cleared.includes(id) && !removed.includes(id)),
		failed: failed + brokenHits(latest.hits, only).length,
		releases,
		cleared,
		removed,
		isStopped
	};
}

/** Applies `commands`; `run` is the trial run of the same edit, which saves simulating it again */
async function commitFix(fixing: TFixing, commands: TProjectCommand[], isPiece = true, run?: TSimulationResult): Promise<boolean> {
	const next = fixing.deps.commit(fixing.current, commands, fixing.isFirst);
	if (next == null) return false;
	fixing.isFirst = false;
	fixing.current = next;
	// Platforms count as placed again; a switchback, rail or tunnel suggested again is named in the result
	for (const id of isPiece ? new Set(commands.map(commandEntityId)) : []) {
		const type = next.entities.find((entity) => entity.id === id)?.components.piece?.type;
		if (type != null && isMusicalPiece(type)) fixing.changed.add(id);
		else if (type != null) fixing.moved.add(id);
	}
	fixing.latest = run != null ? { ...run, revision: fixing.current.revision } : await fixing.deps.simulate(fixing.current);
	return true;
}

async function placeAgain(fixing: TFixing, base: TProject, target: THitResult): Promise<TEntity | null> {
	const entity = base.entities.find((item) => item.id === target.pieceEntityId);
	const type = entity?.components.piece?.type;
	if (entity == null || type == null || !isMusicalPiece(type)) return null;
	try {
		return await fixing.deps.autoPlace(base, target, entity);
	} catch {
		return null;
	}
}

/** With `only`: Auto place once for each of those platforms. False when a commit was refused. */
async function placeEachAgain(fixing: TFixing, only: string[]): Promise<boolean> {
	const keys = brokenHits(fixing.result.hits, only).map(hitKeyOf);
	for (const [index, key] of keys.entries()) {
		const target = fixing.latest.hits.find((hit) => hitKeyOf(hit) === key);
		if (target == null || target.status === 'onTime') continue;
		const placed = await placeAgain(fixing, fixing.current, target);
		if (isCancelled(fixing)) return false;
		const commands = placed == null ? [] : replaceCommands(fixing.current, placed);
		if (commands.length && !(await commitFix(fixing, commands))) return false;
		fixing.deps.onProgress?.(index + 1, keys.length, target.targetTime, (index + 1) / keys.length);
	}
	return true;
}

/** A first fall that grew long is fixed first by moving the release. False when a commit was refused. */
async function moveReleases(fixing: TFixing, before: THitResult[] | undefined): Promise<boolean> {
	for (const laneId of new Set(brokenHits(fixing.latest.hits).map((hit) => hit.laneId))) {
		const commands = releaseFix(fixing.current, fixing.latest.hits, laneId, before);
		if (!commands.length) continue;
		if (!(await commitFix(fixing, commands, false))) return false;
		fixing.releases.push(laneId);
	}
	return true;
}

function fixProgress(fixing: TFixing, startTime: number): TFixProgress {
	// One count for the whole run, the one the label named: the hits broken when Fix Hits started. A moved release
	// may break a few more for a moment, but they are not counted, so "0 of 37" never turns into "0 of 38".
	const counted = brokenHits(fixing.result.hits).map(hitKeyOf);
	return {
		counted,
		total: Math.max(1, counted.length),
		startTime,
		lastTime: Math.max(startTime, ...fixing.latest.hits.filter((hit) => hit.pieceEntityId != null).map((hit) => hit.targetTime)),
		done: 0,
		fraction: 0,
		tries: 0
	};
}

/**
 * Progress runs through the song from the first problem to the last linked hit, and within a problem from its hit
 * toward the next one with every try, so the bar keeps moving while a hard problem is worked on
 */
function reportProblem(fixing: TFixing, progress: TFixProgress, problem: THitResult): void {
	const { counted, total, startTime, lastTime } = progress;
	const { latest } = fixing;
	progress.done = Math.min(total, Math.max(progress.done, fixedCount(counted, latest.hits)));
	const next = latest.hits.find((hit) => hit.laneId === problem.laneId && hit.pieceEntityId != null && hit.targetTime > problem.targetTime + 1e-6)?.targetTime ?? lastTime;
	const at = problem.targetTime + (Math.max(problem.targetTime, next) - problem.targetTime) * Math.min(1, progress.tries / TRIES_PER_PROBLEM);
	const span = lastTime - startTime;
	// The scenery pass after the platforms takes the last few percent
	progress.fraction = Math.max(progress.fraction, span > 0 ? Math.min(SCENERY_SHARE_START, (SCENERY_SHARE_START * (at - startTime)) / span) : 0);
	fixing.deps.onProgress?.(progress.done, total, problem.targetTime, progress.fraction);
}

/** A new switchback, rail or tunnel for `gap` in place of `bridge`, for the run in `base` without it */
async function bridgeCommands(fixing: TFixing, base: TProject, gap: TLongGap, bridge: TEntity): Promise<TProjectCommand[] | null> {
	const bridgeType = bridge.components.piece?.type;
	if (!isGapPieceType(bridgeType)) return null;
	// Like Next, a rail where no switchback fits any more, and a switchback where no rail does
	const types: TGapPieceType[] = bridgeType === 'switchback' ? ['switchback', 'rail'] : bridgeType === 'rail' ? ['rail', 'switchback'] : [bridgeType];
	const without = { ...base, entities: base.entities.filter((item) => item.id !== bridge.id) };
	for (const type of types) {
		let suggested: TEntity | null;
		try {
			suggested = await fixing.deps.gapPiece(without, gap, type, bridge.id);
		} catch {
			suggested = null;
		}
		if (isCancelled(fixing)) return null;
		if (suggested == null) continue;
		// A bridge of another kind takes that kind's name
		const name = type === bridgeType ? bridge.name : (suggested.name ?? bridge.name);
		return [{ type: 'upsertEntity', entity: { ...suggested, id: bridge.id, name } }];
	}
	return null;
}

/** The bridge after `launch` suggested again for the run in `base`, when the hit after it needs attention */
async function suggestBridge(fixing: TFixing, base: TProject, run: TSimulationResult, launch: THitResult): Promise<TProjectCommand[] | null> {
	const gap = findLongGaps(base, launch.laneId).find((item) => item.fromHitId === launch.hitId && item.bridgedBy != null);
	const after = gap == null ? undefined : run.hits.find((hit) => hit.laneId === gap.laneId && hit.hitId === gap.toHitId);
	const bridge = gap == null ? undefined : base.entities.find((item) => item.id === gap.bridgedBy);
	if (gap == null || after == null || bridge == null || !needsFix(base, after)) return null;
	const dot = run.hits.find((hit) => hitKeyOf(hit) === hitKeyOf(launch))?.dot;
	const angle = base.entities.find((item) => item.id === launch.pieceEntityId)?.components.hitLink?.angle;
	const key = `${bridge.id}@${dot?.x.toFixed(4)},${dot?.y.toFixed(4)},${angle?.toFixed(5)}`;
	if (fixing.bridges.has(key)) return fixing.bridges.get(key) ?? null;
	const commands = await bridgeCommands(fixing, base, gap, bridge);
	if (!isCancelled(fixing)) fixing.bridges.set(key, commands);
	return commands;
}

/**
 * The commands that tilt `target` again for the run in `base`, with its bridge when it launches into one: by
 * Auto place, or turned by `turn` from its tilt as a user turns a piece by hand. Null when Auto place finds nothing.
 */
async function replaceStep(fixing: TFixing, base: TProject, run: TSimulationResult, target: THitResult, turn?: number): Promise<TProjectCommand[] | null> {
	// A launch into a bridged gap is tilted for the open gap, as Next placed it before the bridge existed
	const gap = findLongGaps(base, target.laneId).find((item) => item.fromHitId === target.hitId && item.bridgedBy != null);
	let commands: TProjectCommand[];
	if (turn != null) {
		const entity = base.entities.find((item) => item.id === target.pieceEntityId);
		const link = entity?.components.hitLink;
		const type = entity?.components.piece?.type;
		if (entity == null || link == null || type == null || !isMusicalPiece(type)) return null;
		commands = [{ type: 'setComponent', entityId: entity.id, component: { name: 'hitLink', value: { ...link, angle: round4(link.angle + turn) } } }];
	} else {
		const open = gap == null ? base : { ...base, entities: base.entities.filter((item) => item.id !== gap.bridgedBy) };
		const placed = await placeAgain(fixing, open, target);
		if (placed == null || isCancelled(fixing)) return null;
		commands = replaceCommands(base, placed);
	}
	if (gap == null) return commands;
	const tilted = withCommands(base, commands);
	const bridge = await suggestBridge(fixing, tilted, commands.length ? await fixing.deps.simulate(tilted) : run, target);
	return [...commands, ...(bridge ?? [])];
}

/** The earliest hit to work on. Like Fix Hits's targets, a marble without broken hits is done, even with hits outside its band */
function firstProblem(fixing: TFixing, base: TProject, run: TSimulationResult, laneId?: string): THitResult | undefined {
	const open = run.hits.filter((hit) => hit.pieceEntityId != null && (laneId == null || hit.laneId === laneId) && hit.targetTime > (fixing.left.get(hit.laneId) ?? -Infinity) + 1e-6);
	const lanes = new Set(open.filter(isBroken).map((hit) => hit.laneId));
	return open.filter((hit) => lanes.has(hit.laneId) && needsFix(base, hit)).sort((a, b) => a.targetTime - b.targetTime)[0];
}

/**
 * Whether `trial` fixes `problem` without setting another marble back. A hit that plays on time but outside its
 * frame band is fixed only without breaking hits after it.
 */
function advances(fixing: TFixing, base: TProject, trial: TSimulationResult, problem: THitResult): boolean {
	const { current, latest } = fixing;
	// A try simulated only up to its horizon is judged on the hits before it
	const end = trial.duration - 1e-6;
	const tried = { ...trial, hits: trial.hits.filter((hit) => hit.targetTime < end) };
	const was = latest.hits.filter((hit) => hit.targetTime < end);
	if ((firstProblem(fixing, base, tried, problem.laneId)?.targetTime ?? Infinity) <= problem.targetTime + 1e-6) return false;
	const broken = (hits: THitResult[]): number => brokenHits(hits).filter((hit) => hit.laneId === problem.laneId).length;
	// Broken hits are counted over the whole song only, since a try may break one early and mend many after it
	const isWhole = trial.duration >= current.end - 1e-6;
	if (isWhole && !isBroken(problem) && problem.status !== 'drifting' && broken(tried.hits) > broken(was)) return false;
	for (const lane of base.music.lanes) {
		if (lane.id === problem.laneId) continue;
		const first = firstProblem(fixing, current, latest, lane.id)?.targetTime ?? Infinity;
		if ((firstProblem(fixing, base, tried, lane.id)?.targetTime ?? Infinity) < Math.min(first, end) - 1e-6) return false;
	}
	return !newlyBroken(was, tried.hits).some((hit) => hit.laneId !== problem.laneId);
}

/**
 * Whether the pieces `commands` change cross another marble's run in `trial` where they did not before:
 * Auto place's own lane check (`crossesOtherLanes`), from the earliest changed piece's hit to the trial's end
 */
function crossesLanes(fixing: TFixing, base: TProject, trial: TSimulationResult, problem: THitResult, commands: TProjectCommand[]): boolean {
	const { current, latest } = fixing;
	const frontiers = openFrontiers(base, latest);
	for (const id of new Set(commands.map(commandEntityId))) {
		const link = base.entities.find((entity) => entity.id === id)?.components.hitLink;
		if (link == null || id === '') continue;
		const from = latest.hits.find((hit) => hit.laneId === link.laneId && hit.hitId === link.hitId)?.targetTime ?? problem.targetTime;
		const until = trial.duration;
		if (crossesOtherLanes(latest, trial, base, link.laneId, id, from, until, frontiers) && !crossesOtherLanes(latest, latest, current, link.laneId, id, from, until, frontiers)) return true;
	}
	return false;
}

/**
 * Keeps a try that fixes `problem` within its horizon only when the whole song agrees: the try is simulated to
 * the end, from the snapshot at the horizon, and must still fix the problem without adding a problem of
 * another kind (`addedProblems`), such as another marble hitting one of the moved pieces
 */
async function keepFix(fixing: TFixing, base: TProject, trial: TSimulationResult, problem: THitResult, commands: TProjectCommand[]): Promise<TFix | null> {
	const { current, latest, deps } = fixing;
	if (!advances(fixing, base, trial, problem) || crossesLanes(fixing, base, trial, problem, commands)) return null;
	const whole = { ...base, end: current.end };
	const run = trial.duration >= current.end - 1e-6 ? trial : await deps.simulate(whole);
	if (isCancelled(fixing) || !advances(fixing, whole, run, problem)) return null;
	const added = addedProblems(current, latest, whole, run, { laneId: problem.laneId, from: problem.targetTime });
	return added.length ? null : { commands, run };
}

/** The project as Fix Hits tries it for `problem`: simulated up to `TRY_HORIZON` after it */
function clipped(fixing: TFixing, problem: THitResult): TProject {
	return { ...fixing.current, end: Math.min(fixing.current.end, problem.targetTime + TRY_HORIZON) };
}

/**
 * Commands that fix `problem`, placing again from `depth` platforms before the one before it onward; null when none
 * does. With `turn`, the first of them is turned by hand by that much instead.
 */
async function rebuild(fixing: TFixing, progress: TFixProgress, run: THitResult[], index: number, depth: number, problem: THitResult, turn?: number): Promise<TFix | null> {
	const { deps, steps } = fixing;
	progress.tries++;
	reportProblem(fixing, progress, problem);
	let base = clipped(fixing, problem);
	let trial = fixing.latest;
	// Whether `trial` is behind `base`; it is simulated only when a step is not remembered
	let isStale = false;
	const commands: TProjectCommand[] = [];
	const start = index - 1 - depth;
	for (let k = start; k < index; k++) {
		const key = hitKeyOf(run[k] ?? problem);
		const stepTurn = k === start ? turn : undefined;
		const memoKey = `${fixing.current.revision}|${key}|${stepTurn ?? ''}|${JSON.stringify(commands)}`;
		let step = steps.get(memoKey);
		if (step === undefined) {
			if (isStale) {
				trial = await deps.simulate(base);
				isStale = false;
			}
			const target = trial.hits.find((hit) => hitKeyOf(hit) === key);
			if (target == null) return null;
			step = await replaceStep(fixing, base, trial, target, stepTurn);
			if (isCancelled(fixing)) return null;
			steps.set(memoKey, step);
		}
		// The platform just before the problem must take a new tilt; earlier ones may keep theirs. When the first
		// platform of a deeper window keeps its tilt, the rest repeats the shallower try.
		if (step == null && k === index - 1) return null;
		if (k === start && depth > 0 && turn == null && !step?.length) return null;
		if (step == null || !step.length) continue;
		base = withCommands(base, step);
		commands.push(...step);
		isStale = true;
	}
	if (!commands.length) return null;
	return keepFix(fixing, base, isStale ? await deps.simulate(base) : trial, problem, commands);
}

/** What fixes `problem`: its bridge alone, placing again from further and further back, then turning by hand */
async function fixProblem(fixing: TFixing, progress: TFixProgress, problem: THitResult): Promise<TFix | null> {
	const { deps, latest } = fixing;
	const run = latest.hits.filter((hit) => hit.laneId === problem.laneId && hit.pieceEntityId != null).sort((a, b) => a.targetTime - b.targetTime);
	const index = run.findIndex((hit) => hitKeyOf(hit) === hitKeyOf(problem));
	// A marble's first hit depends on its release alone
	const previous = run[index - 1];
	if (previous == null) return null;
	// Before a long gap the bridge alone may be what no longer fits
	const bridge = await suggestBridge(fixing, clipped(fixing, problem), latest, previous);
	if (bridge != null && !isCancelled(fixing)) {
		const base = withCommands(clipped(fixing, problem), bridge);
		const kept = await keepFix(fixing, base, await deps.simulate(base), problem, bridge);
		if (kept != null) return kept;
	}
	for (let depth = 0; depth <= MAX_BACKTRACK && index - 1 - depth >= 0 && !isCancelled(fixing); depth++) {
		const rebuilt = await rebuild(fixing, progress, run, index, depth, problem);
		if (rebuilt != null) return rebuilt;
	}
	// A hit that plays on time outside its marble's part of the frame is not turned by hand: turns rarely bring
	// it in, and they cost most of the time
	if (!isBroken(problem) && problem.status !== 'drifting') return null;
	// Auto place gives the same tilts for the same run, so what a user tries next: turning the platform before
	// the problem, or the one before that, by hand, and placing from there
	for (let depth = 0; depth < TURN_DEPTH && index - 1 - depth >= 0; depth++) {
		for (const degrees of TURNS) {
			if (isCancelled(fixing)) return null;
			const rebuilt = await rebuild(fixing, progress, run, index, depth, problem, degrees * DEGREE);
			if (rebuilt != null) return rebuilt;
		}
	}
	return null;
}

/** Works through the problems in time order, leaving what nothing fixes. False when stopped. */
async function fixPlatforms(fixing: TFixing, progress: TFixProgress): Promise<boolean> {
	const { left, leftCount } = fixing;
	left.clear();
	leftCount.clear();
	while (!isCancelled(fixing)) {
		const problem = firstProblem(fixing, fixing.current, fixing.latest);
		if (problem == null) break;
		progress.tries = 0;
		reportProblem(fixing, progress, problem);
		const fixed = await fixProblem(fixing, progress, problem);
		if (isCancelled(fixing)) return false;
		if (fixed != null) {
			if (!(await commitFix(fixing, fixed.commands, true, fixed.run))) return false;
			continue;
		}
		// Only broken hits count toward giving up on a marble; one outside its band is just left as it is
		const count = (leftCount.get(problem.laneId) ?? 0) + (isBroken(problem) ? 1 : 0);
		leftCount.set(problem.laneId, count);
		left.set(problem.laneId, count >= MAX_LEFT ? Infinity : problem.targetTime);
	}
	return true;
}

/** Blocked scenery, and scenery the new run carries into another marble's way that was clear before. False when stopped. */
async function fixScenery(fixing: TFixing, progress: TFixProgress): Promise<boolean> {
	const { project, result, deps } = fixing;
	const strays = addedProblems(project, result, fixing.current, fixing.latest)
		.filter((issue) => issue.kind === 'contact')
		.flatMap((issue) => issue.target?.ids ?? [])
		.filter((id) => isStrayScenery(fixing.current, id));
	const pieces = [...new Set([...blockedScenery(fixing.current, fixing.latest).map((piece) => piece.entityId), ...strays])];
	for (const [index, entityId] of pieces.entries()) {
		deps.onProgress?.(progress.done, progress.total, progress.lastTime, SCENERY_SHARE_START + ((1 - SCENERY_SHARE_START) * index) / pieces.length);
		// Fix Hits keeps its promise to fix the run: a bridge suggested again, Move Clear or, for a piece the new
		// run passes through and no longer uses, deleting it, each only when its what-if breaks no hit now on
		// time and adds no problem (`sceneryFix`)
		const fixed = await sceneryFix(fixing.current, fixing.latest, entityId, { simulate: deps.simulate, gapPiece: deps.gapPiece, isCancelled: () => isCancelled(fixing) });
		if (isCancelled(fixing)) return false;
		if (fixed.commands == null || fixed.run == null) {
			fixing.failed++;
			continue;
		}
		if (!(await commitFix(fixing, fixed.commands, false, fixed.run))) return false;
		if (fixed.kind === 'delete') fixing.removed.push(entityId);
		else fixing.cleared.push(entityId);
	}
	return true;
}

/** With nothing else wrong, what remains is how the track looks: each piece gets its own Fix, kept when it passes. False when stopped. */
async function fixLooks(fixing: TFixing): Promise<boolean> {
	const { project, result, deps } = fixing;
	if (brokenHits(result.hits).length > 0 || blockedScenery(project, result).length > 0) return true;
	for (const entityId of lookPieces(project, result)) {
		if (isCancelled(fixing)) return false;
		if (!lookPieces(fixing.current, fixing.latest).includes(entityId)) continue;
		const fixed = await fixPiece(fixing.current, fixing.latest, entityId, deps);
		if (isCancelled(fixing)) return false;
		if (fixed.commands != null && !(await commitFix(fixing, fixed.commands, true, fixed.run))) return false;
	}
	return true;
}

/** Commands that fix a problem, with the run they make */
interface TFix {
	commands: TProjectCommand[];
	run: TSimulationResult;
}

// Tries a problem takes at most: its bridge, the backtracks and the turns by hand, for progress within it
const TRIES_PER_PROBLEM = 21;
// Share of the progress bar for the platforms; the Blocked scenery after them takes the rest
const SCENERY_SHARE_START = 0.96;

// Platforms Fix Hits goes back before the one before a problem that it cannot fix
const MAX_BACKTRACK = 3;
// Seconds after a problem that Fix Hits simulates each try; one that fixes it is then simulated to the end
const TRY_HORIZON = 3;
// Problems per marble that nothing fixes before Fix Hits stops working on that marble
const MAX_LEFT = 3;
// What the Fix of a piece struck twice or touching tries: shares of its length, strikes along it and small turns
const LOOK_SHORTER = [5 / 6, 2 / 3];
const LOOK_CONTACTS = [0.35, 0.65, 0.2, 0.8];
const LOOK_TURNS = [2, -2, 4, -4, 7, -7];
// Turns by hand in degrees, nearest first, like the fixture builds, of the platform before a problem and the one before it
const TURNS = [3, -3, 6, -6, 9, -9, 12, -12];
const TURN_DEPTH = 2;
const DEGREE = Math.PI / 180;

// The release follows the first note by at most this long, like a new marble's
const RELEASE_LEAD = 0.5;
const MIN_RELEASE_LEAD = 0.1;

/**
 * When a marble's first notes went elsewhere, its remaining run starts with a long fall from the release that
 * breaks everything after it. This moves the release to just before the first remaining note, so the marble
 * arrives where and how fast it did in `before`, the hits from before the edit, which keeps the rest of the run
 * as it was. Returns no commands when nothing on the marble is broken, its first fall is short already or
 * `before` does not know the old arrival.
 */
export function releaseFix(project: TProject, results: THitResult[], laneId: string, before?: THitResult[]): TProjectCommand[] {
	const lane = project.music.lanes.find((item) => item.id === laneId);
	const marble = project.entities.find((entity) => entity.components.marble?.laneId === laneId);
	const release = marble?.components.release;
	const first = lane?.hits[0];
	if (lane == null || marble == null || release == null || first == null) return [];
	// A first fall longer than twice the lead is what handing the first notes away leaves behind
	if (!results.some((hit) => hit.laneId === laneId && isBroken(hit)) || first.time - release.time <= 2 * RELEASE_LEAD + 1e-6) return [];
	const old = before?.find((hit) => hit.laneId === laneId && hit.hitId === first.id);
	// Without the old arrival a later release only trades one broken run for another
	if (old?.dot == null || old.velocity == null || old.status !== 'onTime') return [];
	const g = -gravityOf(project);
	// Free flight back from the old arrival, short enough that the marble is not thrown upward
	const lead = Math.min(RELEASE_LEAD, Math.max(MIN_RELEASE_LEAD, -old.velocity.y / g));
	const velocity = { x: old.velocity.x, y: old.velocity.y + g * lead };
	const position = {
		x: old.dot.x - velocity.x * lead,
		y: old.dot.y - velocity.y * lead + (g * lead * lead) / 2
	};
	const next: NonNullable<TComponents['release']> = {
		...release,
		time: round4(first.time - lead),
		position: { x: round4(position.x), y: round4(position.y) },
		velocity: { x: round4(velocity.x), y: round4(velocity.y) }
	};
	return [{ type: 'setComponent', entityId: marble.id, component: { name: 'release', value: next } }];
}

function commandEntityId(command: TProjectCommand): string {
	return command.type === 'upsertEntity' ? command.entity.id : command.type === 'setComponent' ? command.entityId : '';
}

/**
 * Problems of the one problem model (`preflightExport`) that `after` has and `before` did not, which a fix must
 * not add: another marble's hits, framing or pace, Blocked scenery, and contacts such as "Bass hits Switchback 6
 * of Melody". With `working`, that marble's problems from `from` on (its hits, framing, Blocked scenery and its
 * pieces another marble hits) are left out, since Fix Hits works through them next.
 */
export function addedProblems(
	beforeProject: TProject,
	before: TSimulationResult,
	afterProject: TProject,
	after: TSimulationResult,
	working?: { laneId: string; from: number }
): TPreflightIssue[] {
	const warnings = (project: TProject, result: TSimulationResult): TPreflightIssue[] =>
		// A fix that plays the hits again may cost a second bounce or a roll, which keep their own problem and their own Fix
		preflightExport(project, { ...result, revision: project.revision }).issues.filter((issue) => issue.severity === 'warning' && issue.kind !== 'strike' && issue.kind !== 'roll');
	const had = new Set(warnings(beforeProject, before).map((issue) => issue.id));
	return warnings(afterProject, after).filter((issue) => {
		if (had.has(issue.id)) return false;
		if (working == null || issue.laneId !== working.laneId) return true;
		// The marble being fixed: its later hits, framing, Blocked scenery and pieces another marble hits are the
		// work still ahead, since its later platforms move them again; what is left at the end counts
		return (issue.time ?? Infinity) < working.from - 1e-6;
	});
}

/** `project` with `setComponent`, `upsertEntity` and `removeEntities` commands applied, for a trial run before a commit */
export function withCommands(project: TProject, commands: TProjectCommand[]): TProject {
	let entities = project.entities;
	for (const command of commands) {
		if (command.type === 'removeEntities') entities = entities.filter((entity) => !command.entityIds.includes(entity.id));
		if (command.type === 'upsertEntity') {
			const isNew = !entities.some((entity) => entity.id === command.entity.id);
			entities = isNew ? [...entities, command.entity] : entities.map((entity) => (entity.id === command.entity.id ? command.entity : entity));
		}
		if (command.type !== 'setComponent') continue;
		entities = entities.map((entity) =>
			entity.id === command.entityId ? { ...entity, components: { ...entity.components, [command.component.name]: command.component.value } } : entity
		);
	}
	return { ...project, entities, revision: project.revision + 1 };
}

/** Where Fix Hits starts in the song: the first broken hit, or the first Blocked piece */
function firstBrokenTime(result: TSimulationResult, only?: string[]): number {
	const times = [
		...brokenHits(result.hits, only).map((hit) => hit.targetTime),
		...(only == null ? result.pieces.filter((piece) => piece.status === 'blocked').map((piece) => piece.entryTime ?? piece.hitTime ?? 0) : [])
	];
	return times.length ? Math.min(...times) : 0;
}

function isGapPieceType(type: string | undefined): type is TGapPieceType {
	return type === 'switchback' || type === 'rail' || type === 'tunnel';
}

function round4(value: number): number {
	return Math.round(value * 10000) / 10000;
}
