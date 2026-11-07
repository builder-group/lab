import { patched, type TFollows, type TMarble, type TPiece, type TPlays, type TProject, type TProjectCommand, type TVec2, tieOf } from '@/modules/project';
import { BOWL_TYPE, isPathPieceType, getPieceDefinition, gravityOf, isMusicalPiece, layoutOf, shapesBounds, shapesDistance, soundsHit, trajectoryAt, transformShape, type THitResult, type TResolvedPiece, type TSimulationResult, resolvedPieceShapes, shapesGap } from '@/modules/simulation';
import { extraStrikes, rollingHits, passThroughs, touchingPairs } from './track-problems';
import { freePose } from './attach';
import { findLongGaps, type TLongGap, crossesOtherMarbles, openFrontiers } from './assists';
import { gapPieceTypeOf } from './gap-pieces';
import { type TGapPieceType } from './worker-protocol';
import { bowlFix, hitKeyOf, isBroken, newlyBroken } from './bowl-assist';
import type { TBlenderObject } from '@/modules/scene';
import { NO_BLENDER_OBJECTS, checkRun, type TPreflightIssue, type TProblemSummary } from './export-preflight';

// The one Fix, after an edit that broke the run or for a piece with a problem. The edit's notice, the hit summary's
// menu, a piece's status pill and A all offer it. Undo goes back; Rebuild From Here deletes and builds again.

/** A hit that needs attention while its marble's run is being mended: broken, early or late */
function needsFix(hit: THitResult): boolean {
	return isBroken(hit) || hit.status === 'drifting';
}

/**
 * The broken hits Fix counts, in time order: Blocked, Missed or Stopped hits, and the early or late ones after the
 * first of them on the same marble, which the same edit usually pushed off
 */
export function brokenHits(results: THitResult[]): THitResult[] {
	const sorted = results.filter((hit) => hit.pieceId != null).sort((a, b) => a.targetTime - b.targetTime);
	const firstBroken = new Map<string, number>();
	for (const hit of sorted) if (isBroken(hit) && !firstBroken.has(hit.marbleId)) firstBroken.set(hit.marbleId, hit.targetTime);
	return sorted.filter((hit) => {
		const from = firstBroken.get(hit.marbleId);
		return from != null && hit.targetTime >= from && (isBroken(hit) || hit.status === 'drifting');
	});
}

/** Whether Fix has anything to do for the whole run */
export function hasFixes(project: TProject, result: TSimulationResult): boolean {
	return brokenHits(result.hits).length > 0 || blockedScenery(project, result).length > 0 || problemPieces(project, result).length > 0;
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

/** What a Fix is judged by, from the one problem model */
export type TFixCount = Pick<TProblemSummary, 'onTime' | 'total' | 'otherProblems'>;

/** Hits that don't play on time, waiting ones too, and the problems beside them */
function fixTotal(run: TFixCount): number {
	return run.total - run.onTime + run.otherProblems;
}

/** A Fix keeps its result only when the total of broken hits and problems falls */
export function fixHelps(before: TFixCount, after: TFixCount): boolean {
	return fixTotal(after) < fixTotal(before);
}

function countWords(run: TFixCount): string {
	const broken = run.total - run.onTime;
	const hits = `${broken} broken ${broken === 1 ? 'note' : 'notes'}`;
	return run.otherProblems > 0 ? `${hits} and ${run.otherProblems} other ${run.otherProblems === 1 ? 'problem' : 'problems'}` : hits;
}

/** Why a Fix didn't land, with the real counts: "Fix would leave 71 broken hits and 88 other problems, where there are now 20 broken hits and 5 other problems, so nothing changed." */
export function fixWorseWords(before: TFixCount, after: TFixCount): string {
	if (fixTotal(after) === fixTotal(before)) return `Fix found nothing better than the ${countWords(before)} there are now, so nothing changed. Undo the edit, or turn the pieces by hand.`;
	return `Fix would leave ${countWords(after)}, where there ${before.total - before.onTime + before.otherProblems === 1 ? 'is' : 'are'} now ${countWords(before)}, so nothing changed. Undo the edit, or turn the pieces by hand.`;
}

/**
 * What Fix did, in words.md's form: how many hits it fixed, what it changed, then how the run stands, ending with the
 * hit summary's label and the problems the fix added: "Fixed 37 hits · placed 13 platforms again · 108 of 108 hits on time"
 */
export function fixMessage(project: TProject, before: THitResult[], outcome: Pick<TFixOutcome, 'project' | 'result' | 'replaced' | 'moved' | 'cleared' | 'releases'>, standing: TFixStanding): string {
	const counted = brokenHits(before).map(hitKeyOf);
	const total = counted.length;
	const fixed = fixedCount(counted, outcome.result.hits);
	const others = [...outcome.moved, ...outcome.cleared].map((id) => pieceName(outcome.project, id));
	const parts = [
		total === 0 ? '' : fixed < total ? `Fixed ${fixed} of ${total} notes` : total === 1 ? 'Fixed the note' : `Fixed ${total} notes`,
		outcome.replaced > 0 ? `placed ${outcome.replaced} ${outcome.replaced === 1 ? 'platform' : 'platforms'} again` : '',
		outcome.releases.length > 0 ? `moved ${outcome.releases.length === 1 ? 'the release' : `${outcome.releases.length} releases`}` : '',
		others.length > 0 ? `moved ${joinWords(others)}` : '',
		standing.label,
		standing.added.length > 0 ? `${standing.added.length} new ${standing.added.length === 1 ? 'problem' : 'problems'}: ${standing.added.map((issue) => issue.title).join('; ')}` : ''
	].filter(Boolean);
	const advice = standing.hitProblems > 0 ? `. Turn ${standing.hitProblems === 1 ? 'it' : 'them'} by hand or undo the edit.` : '';
	return `${capitalize(parts.join(' · '))}${advice}`;
}

/** How many of the `counted` hits (`marbleId/hitId` keys) are no longer broken in `hits` */
function fixedCount(counted: string[], hits: THitResult[]): number {
	const still = new Set(brokenHits(hits).map(hitKeyOf));
	return counted.filter((key) => !still.has(key)).length;
}

// MARK: - Move Clear

/** Scenery that follows a marble but is left out because the marble's earlier run passes through it */
export function blockedScenery(project: TProject, result: TSimulationResult): TResolvedPiece[] {
	return result.pieces.filter((other) => {
		if (other.status !== 'blocked') return false;
		const piece = project.track.pieces.find((item) => item.id === other.pieceId);
		const link = tieOf(piece);
		return link != null && !soundsHit(piece?.type ?? other.type, link);
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
export function moveClear(project: TProject, result: TSimulationResult, pieceId: string): { commands: TProjectCommand[]; distance: number } | null {
	const piece = project.track.pieces.find((item) => item.id === pieceId);
	const link = tieOf(piece);
	const resolved = result.pieces.find((piece) => piece.pieceId === pieceId);
	if (piece == null || link == null || link.kind !== 'follows' || resolved == null) return null;
	if (resolved.status !== 'blocked' && !strayHitters(project, result, pieceId).length) return null;
	const type = piece.type ?? resolved.type;
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
		const isOther = track.marbleId !== link.marbleId;
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
		.filter((piece) => piece.pieceId !== pieceId && piece.status !== 'blocked' && piece.status !== 'unreached')
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
	let angle = piece.angle;
	if (link.offset != null) {
		offset = { x: link.offset.x + best.d.x, y: link.offset.y + best.d.y };
	} else {
		// A piece placed touching the marble gets the offset that keeps its pose, then the nudge
		const track = result.marbles.find((item) => item.marbleId === link.marbleId);
		const sample = track != null ? trajectoryAt(track.samples, time, gravityOf(project)) : null;
		if (track == null || sample == null) return null;
		const pose = freePose(piece, resolved, track.radius);
		offset = {
			x: pose.position.x + best.d.x - sample.position.x,
			y: pose.position.y + best.d.y - sample.position.y
		};
		angle = pose.angle;
	}
	const place = { ...link, offset: { x: round4(offset.x), y: round4(offset.y) } };
	return {
		commands: [{ type: 'updatePiece', pieceId: pieceId, patch: { place, angle } }],
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
	/** What no local change can do without breaking later hits: Rebuild From Here, from this hit */
	rebuildFrom?: { marbleId: string; hitId: string };
}

/**
 * Fix for one piece. A Bowl is placed again on its marble's fall, a piece struck twice, rolled on or touching gets
 * another tilt, scenery gets a new bridge or moves clear, a platform another marble hits has that marble's platform
 * before the hit tilted again, and a platform that doesn't land on time is placed again. A change to another piece
 * is kept only when the what-if run clears this one, breaks no hit that is on time and adds no problem.
 */
export async function fixPiece(
	project: TProject,
	result: TSimulationResult,
	pieceId: string,
	deps: Pick<TFixDeps, 'simulate' | 'autoPlace'> & Partial<Pick<TFixDeps, 'gapPiece' | 'settle' | 'blenderObjects'>>
): Promise<TPieceFix> {
	const piece = project.track.pieces.find((item) => item.id === pieceId);
	const link = tieOf(piece);
	const type = piece?.type;
	const name = pieceName(project, pieceId);
	if (piece != null && link == null && hasPieceProblem(project, result, pieceId)) return { commands: null, message: `${name} is tied to nothing, so Fix leaves it where it is. Drag it clear of what it touches.` };
	if (piece == null || link == null || type == null) return { commands: null, message: `${name} has nothing to fix` };
	const hitters = strayHitters(project, result, pieceId);
	const check = (commands: TProjectCommand[]): Promise<TFixTrial> => tryOnRun(project, result, pieceId, commands, deps);

	// A Bowl is placed again on its marble's fall, wherever it went wrong
	if (type === BOWL_TYPE) return bowlFix(project, result, pieceId, deps);
	// Struck twice, rolled on, touching or passed through: another tilt, unless something more serious about the piece comes first
	if (!hitters.length && result.pieces.find((piece) => piece.pieceId === pieceId)?.status !== 'blocked') {
		const toFix = problemPieces(project, result).includes(pieceId) ? pieceId : touchingPairs(project, result).find((pair) => pair.a === pieceId)?.b;
		if (toFix != null) return fixProblemPiece(project, result, toFix, check, deps);
	}
	if (!soundsHit(type, link)) return sceneryFix(project, result, pieceId, deps);

	// A platform another marble hits: that marble's platform before the hit tilts so it passes clear
	const hitter = hitters[0];
	if (hitter == null) {
		const hit = result.hits.find((item) => item.marbleId === link.marbleId && item.hitId === link.hitId);
		if (hit == null || hit.status === 'onTime') return { commands: null, message: `${name} has nothing to fix` };
		let placed: TPiece;
		try {
			placed = await deps.autoPlace(project, hit, piece);
		} catch {
			return { commands: null, message: 'No tilt lands the marble on time with the next note in the frame. Turn the platform by hand or move the note.' };
		}
		const commands = replaceCommands(project, placed);
		return commands.length ? { commands, message: `Placed ${name} again` } : { commands: null, message: `${name} has nothing to fix` };
	}
	const before = result.hits
		.filter((hit) => hit.marbleId === hitter.marbleId && hit.pieceId != null && hit.targetTime < hitter.time - 1e-6)
		.sort((a, b) => b.targetTime - a.targetTime)
		.slice(0, 2);
	let refused = '';
	for (const target of before) {
		const platform = project.track.pieces.find((item) => item.id === target.pieceId);
		if (platform == null) continue;
		let placed: TPiece;
		try {
			placed = await deps.autoPlace(project, target, platform);
		} catch {
			continue;
		}
		const commands = replaceCommands(project, placed);
		if (!commands.length) continue;
		const what = await check(commands);
		if (what.isClear && what.broken === 0 && what.added.length === 0) {
			return { commands, run: what.run, message: `Placed ${pieceName(project, platform.id)} again: ${marbleName(project, hitter.marbleId)} now passes clear of ${name}` };
		}
		refused ||= what.isClear ? `${costOf(`Placing ${pieceName(project, platform.id)} again`, what)}, so nothing moved` : '';
	}
	return { commands: null, message: `${refused || `No new tilt of ${marbleName(project, hitter.marbleId)}'s platforms before it keeps ${marbleName(project, hitter.marbleId)} clear of ${name}`}. Drag it by hand, or move ${marbleName(project, hitter.marbleId)}'s platforms.` };
}

/** The run of `commands`, with what it means for the piece: clear of every marble, hits broken, problems added */
async function tryOnRun(project: TProject, result: TSimulationResult, pieceId: string, commands: TProjectCommand[], deps: Pick<TFixDeps, 'simulate'> & Partial<Pick<TFixDeps, 'blenderObjects'>>): Promise<TFixTrial> {
	const next = withCommands(project, commands);
	const run = await deps.simulate(next);
	const isClear = run.pieces.find((piece) => piece.pieceId === pieceId)?.status !== 'blocked' && !strayHitters(next, run, pieceId).length;
	return { run, broken: newlyBroken(result.hits, run.hits).length, added: addedProblems(project, result, next, run, deps.blenderObjects?.() ?? NO_BLENDER_OBJECTS), isClear };
}

interface TFixTrial {
	run: TSimulationResult;
	broken: number;
	added: TPreflightIssue[];
	isClear: boolean;
}

/** What a refused try would have cost */
function costOf(what: string, { broken, added }: Pick<TFixTrial, 'broken' | 'added'>): string {
	return broken > 0 ? `${what} would break ${broken === 1 ? 'a note' : `${broken} hits`}` : `${what} would add a problem (${added[0]?.title ?? 'another marble'})`;
}

function marbleName(project: TProject, marbleId: string): string {
	return project.marbles.find((marble) => marble.id === marbleId)?.name ?? 'the marble';
}

/** Pieces a marble strikes twice or rolls on, and the later piece of each pair that touches, in time order */
export function problemPieces(project: TProject, result: TSimulationResult): string[] {
	const items = [...extraStrikes(project, result).map((strike) => ({ id: strike.pieceId, time: strike.time })), ...rollingHits(project, result).map((roll) => ({ id: roll.pieceId, time: roll.time })), ...touchingPairs(project, result).map((pair) => ({ id: pair.b, time: pair.time })), ...passThroughs(project, result).map((pass) => ({ id: pass.pieceId, time: pass.time }))];
	return [...new Set(items.sort((a, b) => a.time - b.time).map((item) => item.id))];
}

/** Whether a piece has a problem of its own in the list, either side of a touching pair */
export function hasPieceProblem(project: TProject, result: TSimulationResult, pieceId: string): boolean {
	return problemPieces(project, result).includes(pieceId) || touchingPairs(project, result).some((pair) => pair.a === pieceId);
}

/**
 * The Fix of a platform its marble strikes twice or rolls on or of a piece touching another, each try kept only when its what-if clears
 * the piece, breaks no hit, adds no problem and moves no problem onto another piece. In order of how little they change:
 * for a touching platform a shorter length, which changes nothing in the run, or its strike further along it; then a
 * small turn of the platform, then of the one before it, which sets where the marble arrives; then Auto place for both;
 * then the small turns again with the next platforms taking up the change, as they do after a turn by hand.
 */
async function fixProblemPiece(
	project: TProject,
	result: TSimulationResult,
	pieceId: string,
	check: (commands: TProjectCommand[]) => Promise<TFixTrial>,
	deps: Pick<TFixDeps, 'autoPlace'> & Partial<Pick<TFixDeps, 'settle'>>
): Promise<TPieceFix> {
	const name = pieceName(project, pieceId);
	const piece = project.track.pieces.find((item) => item.id === pieceId);
	const link = tieOf(piece);
	const time = result.hits.find((hit) => hit.marbleId === link?.marbleId && hit.hitId === link?.hitId)?.targetTime ?? Infinity;
	const platforms = result.hits
		.filter((hit) => hit.marbleId === link?.marbleId && hit.pieceId != null && hit.targetTime <= time + 1e-6)
		.sort((a, b) => b.targetTime - a.targetTime)
		.slice(0, 2)
		.flatMap((hit) => project.track.pieces.find((item) => item.id === hit.pieceId) ?? []);
	const problemsBefore = new Set(problemPieces(project, result));
	const isStruck = extraStrikes(project, result).some((strike) => strike.pieceId === pieceId);
	const isRolled = rollingHits(project, result).some((roll) => roll.pieceId === pieceId);
	const tryCommands = async (commands: TProjectCommand[], did: string): Promise<TPieceFix | null> => {
		if (!commands.length) return null;
		const what = await check(commands);
		if (what.broken > 0 || what.added.length > 0) return null;
		const next = withCommands(project, commands);
		const problemsAfter = problemPieces(next, what.run);
		if (problemsAfter.includes(pieceId) || problemsAfter.some((id) => !problemsBefore.has(id))) return null;
		return { commands, run: what.run, message: `${did}: ${isStruck ? `the marble now hits ${name} once` : isRolled ? `the marble now bounces off ${name}` : `${name} now stands clear`}` };
	};
	if (!isStruck && !isRolled && piece != null && link != null && isMusicalPiece(piece.type)) {
		const length = piece.params['length'] ?? getPieceDefinition(piece.type)?.params['length']?.default;
		for (const share of SHORTER_LENGTHS) {
			if (length == null) break;
			const params = { ...piece.params, length: round4(length * share) };
			const fixed = await tryCommands([{ type: 'updatePiece', pieceId: pieceId, patch: { params } }], `Shortened ${name}`);
			if (fixed != null) return fixed;
		}
		for (const contactAt of OTHER_CONTACTS) {
			const fixed = await tryCommands([{ type: 'updatePiece', pieceId: pieceId, patch: { place: { ...link, contactAt } } }], `Moved ${name} along its surface`);
			if (fixed != null) return fixed;
		}
	}
	/** The small turns of each platform, with what `takeUp` adds to each */
	const tryTurns = async (takeUp?: (turn: TProjectCommand) => Promise<TProjectCommand[]>): Promise<TPieceFix | null> => {
		for (const platform of platforms) {
			if (tieOf(platform) == null) continue;
			for (const degrees of SMALL_TURNS) {
				const turn: TProjectCommand = { type: 'updatePiece', pieceId: platform.id, patch: { angle: round4(platform.angle + degrees * DEGREE) } };
				const fixed = await tryCommands([turn, ...((await takeUp?.(turn)) ?? [])], `Turned ${pieceName(project, platform.id)} by ${degrees}°`);
				if (fixed != null) return fixed;
			}
		}
		return null;
	};
	const turned = await tryTurns();
	if (turned != null) return turned;
	for (const platform of platforms) {
		const target = result.hits.find((hit) => hit.pieceId === platform.id);
		if (target == null) continue;
		let placed: TPiece;
		try {
			placed = await deps.autoPlace(project, target, platform);
		} catch {
			continue;
		}
		const fixed = await tryCommands(replaceCommands(project, placed), `Placed ${pieceName(project, platform.id)} again`);
		if (fixed != null) return fixed;
	}
	const { settle } = deps;
	if (settle != null) {
		const settled = await tryTurns(async (turn) => settle(project, withCommands(project, [turn])));
		if (settled != null) return settled;
	}
	// Every marble's later hits follow each tilt, so what is left is to build them again from the hit before this one
	const hits = project.marbles.find((marble) => marble.id === link?.marbleId)?.hits ?? [];
	const before = hits[hits.findIndex((hit) => hit.id === link?.hitId) - 1];
	return {
		commands: null,
		message: `Any new tilt of ${name} moves the notes after it. Rebuild From Here keeps the track before it and builds the rest again.`,
		...(before != null && link != null ? { rebuildFrom: { marbleId: link.marbleId, hitId: before.id } } : {})
	};
}

/**
 * The other marbles that hit a piece tied to a marble, in the order they first do, as the problem model reports
 * them ("Bass hits Switchback 6 of Melody"): a marble touching another marble's piece outside a note
 */
export function strayHitters(project: TProject, result: TSimulationResult, pieceId: string): { marbleId: string; time: number }[] {
	const link = tieOf(project.track.pieces.find((piece) => piece.id === pieceId));
	if (link == null) return [];
	const hitters = new Map<string, { marbleId: string; time: number }>();
	for (const contact of result.contacts) {
		if (contact.otherId !== pieceId || contact.time > result.duration || hitters.has(contact.marbleId) || contact.marbleId === link.marbleId) continue;
		hitters.set(contact.marbleId, { marbleId: contact.marbleId, time: contact.time });
	}
	return [...hitters.values()].sort((a, b) => a.time - b.time);
}

/**
 * The first fix of a windmill, rail or tunnel that is Blocked or that another marble hits, which a what-if run
 * passes: it clears the piece, breaks no hit that is on time and adds no problem. In order: a bridge of a long gap is
 * suggested again for its gap (switchback or rail, as Next does), then the piece moves clear (Move Clear). Without
 * `gapPiece`, bridges are not suggested again.
 */
export async function sceneryFix(
	project: TProject,
	result: TSimulationResult,
	pieceId: string,
	deps: Pick<TFixDeps, 'simulate'> & Partial<Pick<TFixDeps, 'gapPiece' | 'blenderObjects'>> & { isCanceled?: () => boolean }
): Promise<TPieceFix> {
	const piece = project.track.pieces.find((item) => item.id === pieceId);
	const link = tieOf(piece);
	const name = pieceName(project, pieceId);
	if (piece == null || link == null) return { commands: null, message: `${name} follows no marble` };
	const hitters = strayHitters(project, result, pieceId);
	const isBlocked = result.pieces.find((piece) => piece.pieceId === pieceId)?.status === 'blocked';
	if (!isBlocked && !hitters.length) return { commands: null, message: `${name} is clear of every run` };
	const runs = joinWords([...new Set([link.marbleId, ...hitters.map((hitter) => hitter.marbleId)])].map((marbleId) => marbleName(project, marbleId)));
	let refusal = '';
	const check = async (commands: TProjectCommand[], what: string): Promise<TSimulationResult | null> => {
		const trial = await tryOnRun(project, result, pieceId, commands, deps);
		if (trial.isClear && trial.broken === 0 && trial.added.length === 0) return trial.run;
		refusal ||= !trial.isClear ? `${what} leaves it in the way` : costOf(what, trial);
		return null;
	};

	// A bridge suggested again for its gap, for the run without it
	const gap = findLongGaps(project, link.marbleId).find((item) => item.bridgedBy === pieceId);
	if (gap != null && deps.gapPiece != null) {
		const commands = await bridgeCommands({ gapPiece: deps.gapPiece, isCanceled: () => deps.isCanceled?.() === true }, project, gap, piece);
		if (deps.isCanceled?.() === true) return { commands: null, message: '' };
		const run = commands == null ? null : await check(commands, `Placing ${name} again`);
		if (commands != null && run != null) return { commands, run, message: `${name} placed again for its gap, clear of ${runs}'s run` };
	}

	const move = moveClear(project, result, pieceId);
	if (move != null) {
		const run = await check(move.commands, `Moving ${name} clear`);
		if (run != null) return { commands: move.commands, run, message: `${name} moved ${Math.max(1, Math.round(move.distance * 100))} cm, clear of ${runs}'s run` };
	} else refusal ||= `No spot within 40 cm clears ${name} of ${runs}'s run`;
	return { commands: null, message: `${refusal || `Nothing clears ${name}`}, so nothing changed. Drag it by hand or Detach it.` };
}

/** A piece tied to a marble that plays no note, such as a windmill, rail or tunnel */
function isStrayScenery(project: TProject, pieceId: string): boolean {
	const piece = project.track.pieces.find((item) => item.id === pieceId);
	const link = tieOf(piece);
	const type = piece?.type;
	return link != null && type != null && !soundsHit(type, link);
}

function pieceName(project: TProject, id: string): string {
	const piece = project.track.pieces.find((item) => item.id === id);
	const other = project.marbles.find((item) => item.id === id)?.name ?? project.film.titles.find((item) => item.id === id)?.name;
	return piece?.name ?? other ?? getPieceDefinition(piece?.type ?? '')?.label ?? 'Piece';
}

function joinWords(items: string[]): string {
	if (items.length < 2) return items[0] ?? '';
	return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}

function capitalize(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Commands that give `piece` the angle and settings Auto place chose, keeping its name, skin and other components */
export function replaceCommands(project: TProject, placed: TPiece): TProjectCommand[] {
	const current = project.track.pieces.find((piece) => piece.id === placed.id);
	const link = tieOf(placed);
	if (current == null || link == null) return [];
	const commands: TProjectCommand[] = [];
	const currentLink = tieOf(current);
	if (currentLink == null || (currentLink.kind === 'plays' && currentLink.leaves != null) || current.angle !== placed.angle) {
		// Placed again, a platform follows the marble, whatever it kept from an earlier edit
		commands.push({ type: 'updatePiece', pieceId: current.id, patch: { place: withoutKept(currentLink ?? link), angle: placed.angle } });
	}
	if (JSON.stringify(current.params) !== JSON.stringify(placed.params)) {
		commands.push({ type: 'updatePiece', pieceId: current.id, patch: { params: placed.params } });
	}
	return commands;
}

/** A tie without what it kept from an earlier edit */
function withoutKept(tie: TPlays | TFollows): TPlays | TFollows {
	if (tie.kind !== 'plays') return tie;
	const { leaves: _leaves, ...plays } = tie;
	return plays;
}

export interface TFixDeps {
	/** What Blender reports now, for the problems a fix must not add. Without it there are none: a script or a test */
	blenderObjects?: () => readonly TBlenderObject[];
	simulate: (project: TProject) => Promise<TSimulationResult>;
	/** Auto place for a hit's existing platform; rejects when no angle passes */
	autoPlace: (project: TProject, hit: THitResult, piece: TPiece) => Promise<TPiece>;
	/** A new rail or tunnel for a long gap, replacing `pieceId`; rejects when none fits */
	gapPiece: (project: TProject, gap: TLongGap, type: TGapPieceType, pieceId: string) => Promise<TPiece>;
	/** What takes up an edit so the rest of the run stays as it was (`answerEdit`) */
	settle?: (before: TProject, after: TProject) => Promise<TProjectCommand[]>;
	/** Applies one step's commands; the first step starts the undo step, later ones join it. Null stops. */
	commit: (project: TProject, commands: TProjectCommand[], isFirst: boolean) => TProject | null;
	/** `done` of `total` broken hits are fixed and `fraction` (0 to 1) is how far through the song the work is */
	onProgress?: (done: number, total: number, fraction: number) => void;
	isCanceled?: () => boolean;
}

export interface TFixOutcome {
	project: TProject;
	result: TSimulationResult;
	/** Platforms that got a new angle */
	replaced: number;
	/** Rails and tunnels suggested again for their gap */
	moved: string[];
	/** Broken hits left, and Blocked scenery that could not move clear */
	failed: number;
	/** Marbles whose marble release moved to just before its first note */
	releases: string[];
	/** Blocked scenery moved clear of the run or placed again for its gap */
	cleared: string[];
	/** Stopped by the user or by another edit */
	isStopped: boolean;
}

/**
 * Fix for the whole run: builds it again from each marble's first problem onward, the way the step loop built it. A
 * first fall that grew long because the marble's first notes went elsewhere is fixed first by moving the release
 * (`before`: the hits from before the edit). Then, at the earliest hit that needs attention, Auto place tilts the
 * platform before it again; a launch into a bridged long gap is tilted for the open gap and its rail or tunnel
 * suggested again. Each try is simulated up to `TRY_HORIZON` past the problem, and a change is kept only when,
 * simulated to the end, the problem moves later, no other marble loses a hit, it crosses no other marble and it adds no
 * problem besides the work still ahead on that marble (`addedProblems`). When the platform before cannot fix it, Fix
 * goes back up to `MAX_BACKTRACK` platforms and builds forward from there, and then turns one of the two platforms
 * before the problem by hand. A problem nothing fixes is left and Fix carries on after it, up to `MAX_LEFT` broken
 * hits per marble. Then Blocked scenery gets a new bridge or moves clear, and last the pieces struck twice, rolled on
 * or touching get their own Fix.
 */
export async function fixTrack(project: TProject, result: TSimulationResult, deps: TFixDeps, before?: THitResult[]): Promise<TFixOutcome> {
	const fixing: TFixing = {
		project,
		result,
		deps,
		current: project,
		latest: result,
		failed: 0,
		isFirst: true,
		changed: new Set(),
		moved: new Set(),
		releases: [],
		cleared: [],
		bridges: new Map(),
		left: new Map(),
		leftCount: new Map(),
		steps: new Map()
	};
	const startTime = firstBrokenTime(result);
	deps.onProgress?.(0, brokenHits(result.hits).length, 0);
	if (!(await moveReleases(fixing, before))) return fixOutcome(fixing, true);
	const progress = fixProgress(fixing, startTime);
	// Platforms first, since the run they make often clears scenery by itself; then Blocked scenery moves clear,
	// and the platforms after it are fitted once more to the run with the piece in it
	for (let pass = 0; pass < 2; pass++) {
		if (!(await fixPlatforms(fixing, progress))) return fixOutcome(fixing, true);
		if (pass > 0 || isCanceled(fixing)) break;
		if (!(await fixScenery(fixing))) return fixOutcome(fixing, true);
		if (!fixing.cleared.length) break;
	}
	if (!(await fixPieces(fixing))) return fixOutcome(fixing, true);
	return fixOutcome(fixing, isCanceled(fixing));
}

/** One Fix run: where it started, where it has got to and what it worked out on the way */
interface TFixing {
	project: TProject;
	result: TSimulationResult;
	deps: TFixDeps;
	current: TProject;
	latest: TSimulationResult;
	failed: number;
	isFirst: boolean;
	changed: Set<string>;
	moved: Set<string>;
	releases: string[];
	cleared: string[];
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
	/** The hits broken when Fix started */
	counted: string[];
	total: number;
	startTime: number;
	lastTime: number;
	done: number;
	fraction: number;
}

function isCanceled(fixing: TFixing): boolean {
	return fixing.deps.isCanceled?.() === true;
}

function fixOutcome(fixing: TFixing, isStopped: boolean): TFixOutcome {
	const { current, latest, changed, moved, cleared, failed, releases } = fixing;
	return {
		project: current,
		result: latest,
		replaced: changed.size,
		moved: [...moved].filter((id) => !cleared.includes(id)),
		failed: failed + brokenHits(latest.hits).length,
		releases,
		cleared,
		isStopped
	};
}

/** Applies `commands`; `run` is the trial run of the same edit, which saves simulating it again */
async function commitFix(fixing: TFixing, commands: TProjectCommand[], isPiece = true, run?: TSimulationResult): Promise<boolean> {
	const next = fixing.deps.commit(fixing.current, commands, fixing.isFirst);
	if (next == null) return false;
	fixing.isFirst = false;
	fixing.current = next;
	// Platforms count as placed again; a rail or tunnel suggested again is named in the result
	for (const id of isPiece ? new Set(commands.map(commandPieceId)) : []) {
		const type = next.track.pieces.find((piece) => piece.id === id)?.type;
		if (type != null && isMusicalPiece(type)) fixing.changed.add(id);
		else if (type != null) fixing.moved.add(id);
	}
	fixing.latest = run ?? (await fixing.deps.simulate(fixing.current));
	return true;
}

async function placeAgain(fixing: TFixing, base: TProject, target: THitResult): Promise<TPiece | null> {
	const piece = base.track.pieces.find((item) => item.id === target.pieceId);
	const type = piece?.type;
	if (piece == null || type == null || !isMusicalPiece(type)) return null;
	try {
		return await fixing.deps.autoPlace(base, target, piece);
	} catch {
		return null;
	}
}

/** A first fall that grew long is fixed first by moving the release. False when a commit was refused. */
async function moveReleases(fixing: TFixing, before: THitResult[] | undefined): Promise<boolean> {
	for (const marbleId of new Set(brokenHits(fixing.latest.hits).map((hit) => hit.marbleId))) {
		const commands = releaseFix(fixing.current, fixing.latest.hits, marbleId, before);
		if (!commands.length) continue;
		if (!(await commitFix(fixing, commands, false))) return false;
		fixing.releases.push(marbleId);
	}
	return true;
}

function fixProgress(fixing: TFixing, startTime: number): TFixProgress {
	// One count for the whole run: the hits broken when Fix started. A moved release may break a few more for a
	// moment, but they are not counted, so "0 of 37" never turns into "0 of 38".
	const counted = brokenHits(fixing.result.hits).map(hitKeyOf);
	return {
		counted,
		total: Math.max(1, counted.length),
		startTime,
		lastTime: Math.max(startTime, ...fixing.latest.hits.filter((hit) => hit.pieceId != null).map((hit) => hit.targetTime)),
		done: 0,
		fraction: 0
	};
}

/** Progress runs through the song from the first problem to the last linked hit */
function reportProblem(fixing: TFixing, progress: TFixProgress, problem: THitResult): void {
	const { counted, total, startTime, lastTime } = progress;
	progress.done = Math.min(total, Math.max(progress.done, fixedCount(counted, fixing.latest.hits)));
	const span = lastTime - startTime;
	progress.fraction = Math.max(progress.fraction, span > 0 ? Math.min(1, (problem.targetTime - startTime) / span) : 0);
	fixing.deps.onProgress?.(progress.done, total, progress.fraction);
}

/** A new rail or tunnel for `gap` in place of `bridge`, for the run in `base` without it */
async function bridgeCommands(deps: Pick<TFixDeps, 'gapPiece'> & { isCanceled: () => boolean }, base: TProject, gap: TLongGap, bridge: TPiece): Promise<TProjectCommand[] | null> {
	if (!isPathPieceType(bridge.type)) return null;
	const bridgeType = gapPieceTypeOf(bridge);
	// Like Next, a straight rail where no Switchback fits any more, and a Switchback where no straight rail does
	const types: TGapPieceType[] = bridgeType === 'switchback' ? ['switchback', 'rail'] : bridgeType === 'chain' ? ['chain', 'switchback'] : bridgeType === 'rail' ? ['rail', 'switchback'] : [bridgeType];
	const without = { ...base, track: { ...base.track, pieces: base.track.pieces.filter((item) => item.id !== bridge.id) } };
	for (const type of types) {
		let suggested: TPiece | null;
		try {
			suggested = await deps.gapPiece(without, gap, type, bridge.id);
		} catch {
			suggested = null;
		}
		if (deps.isCanceled()) return null;
		if (suggested == null) continue;
		// A bridge of another kind takes that kind's name
		const name = type === bridgeType ? bridge.name : (suggested.name ?? bridge.name);
		return [{ type: 'addPiece', piece: { ...suggested, id: bridge.id, name } }];
	}
	return null;
}

/** The bridge after `launch` suggested again for the run in `base`, when the hit after it needs attention */
async function suggestBridge(fixing: TFixing, base: TProject, run: TSimulationResult, launch: THitResult): Promise<TProjectCommand[] | null> {
	const gap = findLongGaps(base, launch.marbleId).find((item) => item.fromHitId === launch.hitId && item.bridgedBy != null);
	const after = gap == null ? undefined : run.hits.find((hit) => hit.marbleId === gap.marbleId && hit.hitId === gap.toHitId);
	const bridge = gap == null ? undefined : base.track.pieces.find((item) => item.id === gap.bridgedBy);
	if (gap == null || after == null || bridge == null || !needsFix(after)) return null;
	const dot = run.hits.find((hit) => hitKeyOf(hit) === hitKeyOf(launch))?.dot;
	const angle = base.track.pieces.find((item) => item.id === launch.pieceId)?.angle;
	const key = `${bridge.id}@${dot?.x.toFixed(4)},${dot?.y.toFixed(4)},${angle?.toFixed(5)}`;
	if (fixing.bridges.has(key)) return fixing.bridges.get(key) ?? null;
	const commands = await bridgeCommands({ gapPiece: fixing.deps.gapPiece, isCanceled: () => isCanceled(fixing) }, base, gap, bridge);
	if (!isCanceled(fixing)) fixing.bridges.set(key, commands);
	return commands;
}

/**
 * The commands that tilt `target` again for the run in `base`, with its bridge when it launches into one: by
 * Auto place, or turned by `turn` from its tilt as a user turns a piece by hand. Null when Auto place finds nothing.
 */
async function replaceStep(fixing: TFixing, base: TProject, run: TSimulationResult, target: THitResult, turn?: number): Promise<TProjectCommand[] | null> {
	// A launch into a bridged gap is tilted for the open gap, as Next placed it before the bridge existed
	const gap = findLongGaps(base, target.marbleId).find((item) => item.fromHitId === target.hitId && item.bridgedBy != null);
	let commands: TProjectCommand[];
	if (turn != null) {
		const piece = base.track.pieces.find((item) => item.id === target.pieceId);
		const link = tieOf(piece);
		const type = piece?.type;
		if (piece == null || link == null || type == null || !isMusicalPiece(type)) return null;
		commands = [{ type: 'updatePiece', pieceId: piece.id, patch: { angle: round4(piece.angle + turn) } }];
	} else {
		const open = gap == null ? base : { ...base, track: { ...base.track, pieces: base.track.pieces.filter((item) => item.id !== gap.bridgedBy) } };
		const placed = await placeAgain(fixing, open, target);
		if (placed == null || isCanceled(fixing)) return null;
		commands = replaceCommands(base, placed);
	}
	if (gap == null) return commands;
	const tilted = withCommands(base, commands);
	const bridge = await suggestBridge(fixing, tilted, commands.length ? await fixing.deps.simulate(tilted) : run, target);
	return [...commands, ...(bridge ?? [])];
}

/** The earliest hit to work on. A marble without broken hits is done */
function firstProblem(fixing: TFixing, run: TSimulationResult, marbleId?: string): THitResult | undefined {
	const open = run.hits.filter((hit) => hit.pieceId != null && (marbleId == null || hit.marbleId === marbleId) && hit.targetTime > (fixing.left.get(hit.marbleId) ?? -Infinity) + 1e-6);
	const marbles = new Set(open.filter(isBroken).map((hit) => hit.marbleId));
	return open.filter((hit) => marbles.has(hit.marbleId) && needsFix(hit)).sort((a, b) => a.targetTime - b.targetTime)[0];
}

/** Whether `trial` fixes `problem` without setting another marble back */
function advances(fixing: TFixing, base: TProject, trial: TSimulationResult, problem: THitResult): boolean {
	const { latest } = fixing;
	// A try simulated only up to its horizon is judged on the hits before it
	const end = trial.duration - 1e-6;
	const tried = { ...trial, hits: trial.hits.filter((hit) => hit.targetTime < end) };
	const was = latest.hits.filter((hit) => hit.targetTime < end);
	if ((firstProblem(fixing, tried, problem.marbleId)?.targetTime ?? Infinity) <= problem.targetTime + 1e-6) return false;
	for (const marble of base.marbles) {
		if (marble.id === problem.marbleId) continue;
		const first = firstProblem(fixing, latest, marble.id)?.targetTime ?? Infinity;
		if ((firstProblem(fixing, tried, marble.id)?.targetTime ?? Infinity) < Math.min(first, end) - 1e-6) return false;
	}
	return !newlyBroken(was, tried.hits).some((hit) => hit.marbleId !== problem.marbleId);
}

/**
 * Whether the pieces `commands` change cross another marble's run in `trial` where they did not before:
 * Auto place's own marble check (`crossesOtherMarbles`), from the earliest changed piece's hit to the trial's end
 */
function crossesMarbles(fixing: TFixing, base: TProject, trial: TSimulationResult, problem: THitResult, commands: TProjectCommand[]): boolean {
	const { current, latest } = fixing;
	const frontiers = openFrontiers(base, latest);
	for (const id of new Set(commands.map(commandPieceId))) {
		const link = tieOf(base.track.pieces.find((piece) => piece.id === id));
		if (link == null || id === '') continue;
		const from = latest.hits.find((hit) => hit.marbleId === link.marbleId && hit.hitId === link.hitId)?.targetTime ?? problem.targetTime;
		const until = trial.duration;
		if (crossesOtherMarbles(latest, trial, base, link.marbleId, id, from, until, frontiers) && !crossesOtherMarbles(latest, latest, current, link.marbleId, id, from, until, frontiers)) return true;
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
	if (!advances(fixing, base, trial, problem) || crossesMarbles(fixing, base, trial, problem, commands)) return null;
	const whole = { ...base, length: current.length };
	const run = trial.duration >= current.length - 1e-6 ? trial : await deps.simulate(whole);
	if (isCanceled(fixing) || !advances(fixing, whole, run, problem)) return null;
	const added = addedProblems(current, latest, whole, run, fixing.deps.blenderObjects?.() ?? NO_BLENDER_OBJECTS, { marbleId: problem.marbleId, from: problem.targetTime });
	return added.length ? null : { commands, run };
}

/** The project as Fix tries it for `problem`: simulated up to `TRY_HORIZON` after it */
function clipped(fixing: TFixing, problem: THitResult): TProject {
	return { ...fixing.current, length: Math.min(fixing.current.length, problem.targetTime + TRY_HORIZON) };
}

/**
 * Commands that fix `problem`, placing again from `depth` platforms before the one before it onward; null when none
 * does. With `turn`, the first of them is turned by hand by that much instead.
 */
async function rebuild(fixing: TFixing, run: THitResult[], index: number, depth: number, problem: THitResult, turn?: number): Promise<TFix | null> {
	const { deps, steps } = fixing;
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
			if (isCanceled(fixing)) return null;
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
async function fixProblem(fixing: TFixing, problem: THitResult): Promise<TFix | null> {
	const { deps, latest } = fixing;
	const run = latest.hits.filter((hit) => hit.marbleId === problem.marbleId && hit.pieceId != null).sort((a, b) => a.targetTime - b.targetTime);
	const index = run.findIndex((hit) => hitKeyOf(hit) === hitKeyOf(problem));
	// A marble's first hit depends on its release alone
	const previous = run[index - 1];
	if (previous == null) return null;
	// Before a long gap the bridge alone may be what no longer fits
	const bridge = await suggestBridge(fixing, clipped(fixing, problem), latest, previous);
	if (bridge != null && !isCanceled(fixing)) {
		const base = withCommands(clipped(fixing, problem), bridge);
		const kept = await keepFix(fixing, base, await deps.simulate(base), problem, bridge);
		if (kept != null) return kept;
	}
	for (let depth = 0; depth <= MAX_BACKTRACK && index - 1 - depth >= 0 && !isCanceled(fixing); depth++) {
		const rebuilt = await rebuild(fixing, run, index, depth, problem);
		if (rebuilt != null) return rebuilt;
	}
	// Auto place gives the same tilts for the same run, so what a user tries next: turning the platform before
	// the problem, or the one before that, by hand, and placing from there
	for (let depth = 0; depth < TURN_DEPTH && index - 1 - depth >= 0; depth++) {
		for (const degrees of TURNS) {
			if (isCanceled(fixing)) return null;
			const rebuilt = await rebuild(fixing, run, index, depth, problem, degrees * DEGREE);
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
	while (!isCanceled(fixing)) {
		const problem = firstProblem(fixing, fixing.latest);
		if (problem == null) break;
		reportProblem(fixing, progress, problem);
		const fixed = await fixProblem(fixing, problem);
		if (isCanceled(fixing)) return false;
		if (fixed != null) {
			if (!(await commitFix(fixing, fixed.commands, true, fixed.run))) return false;
			continue;
		}
		const count = (leftCount.get(problem.marbleId) ?? 0) + 1;
		leftCount.set(problem.marbleId, count);
		left.set(problem.marbleId, count >= MAX_LEFT ? Infinity : problem.targetTime);
	}
	return true;
}

/** Blocked scenery, and scenery the new run carries into another marble's way that was clear before. False when stopped. */
async function fixScenery(fixing: TFixing): Promise<boolean> {
	const { project, result, deps } = fixing;
	const strays = addedProblems(project, result, fixing.current, fixing.latest, fixing.deps.blenderObjects?.() ?? NO_BLENDER_OBJECTS)
		.filter((issue) => issue.kind === 'contact')
		.flatMap((issue) => issue.target?.ids ?? [])
		.filter((id) => isStrayScenery(fixing.current, id));
	const pieces = [...new Set([...blockedScenery(fixing.current, fixing.latest).map((piece) => piece.pieceId), ...strays])];
	for (const pieceId of pieces) {
		const fixed = await sceneryFix(fixing.current, fixing.latest, pieceId, { simulate: deps.simulate, gapPiece: deps.gapPiece, isCanceled: () => isCanceled(fixing) });
		if (isCanceled(fixing)) return false;
		if (fixed.commands == null || fixed.run == null) {
			fixing.failed++;
			continue;
		}
		if (!(await commitFix(fixing, fixed.commands, false, fixed.run))) return false;
		fixing.cleared.push(pieceId);
	}
	return true;
}

/** With nothing else wrong, what remains is pieces struck twice, rolled on or touching: each gets its own Fix, kept when it passes. False when stopped. */
async function fixPieces(fixing: TFixing): Promise<boolean> {
	const { deps } = fixing;
	if (brokenHits(fixing.latest.hits).length > 0 || blockedScenery(fixing.current, fixing.latest).length > 0) return true;
	for (const pieceId of problemPieces(fixing.current, fixing.latest)) {
		if (isCanceled(fixing)) return false;
		if (!problemPieces(fixing.current, fixing.latest).includes(pieceId)) continue;
		const fixed = await fixPiece(fixing.current, fixing.latest, pieceId, deps);
		if (isCanceled(fixing)) return false;
		if (fixed.commands != null && !(await commitFix(fixing, fixed.commands, true, fixed.run))) return false;
	}
	return true;
}

/** Commands that fix a problem, with the run they make */
interface TFix {
	commands: TProjectCommand[];
	run: TSimulationResult;
}

// Platforms Fix goes back before the one before a problem that it cannot fix
const MAX_BACKTRACK = 3;
// Seconds after a problem that Fix simulates each try; one that fixes it is then simulated to the end
const TRY_HORIZON = 3;
// Problems per marble that nothing fixes before Fix stops working on that marble
const MAX_LEFT = 3;
// What the Fix of a piece struck twice or touching tries: shares of its length, strikes along it and small turns
const SHORTER_LENGTHS = [5 / 6, 2 / 3];
const OTHER_CONTACTS = [0.35, 0.65, 0.2, 0.8];
const SMALL_TURNS = [2, -2, 4, -4, 7, -7];
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
 * arrives where, how fast and with the spin it did in `before`, the hits from before the edit, which keeps the rest of the run
 * as it was. Returns no commands when nothing on the marble is broken, its first fall is short already or
 * `before` does not know the old arrival.
 */
export function releaseFix(project: TProject, results: THitResult[], marbleId: string, before?: THitResult[]): TProjectCommand[] {
	const marble = project.marbles.find((item) => item.id === marbleId);
	const first = marble?.hits[0];
	if (marble == null || first == null) return [];
	const release = marble.start;
	// A first fall longer than twice the lead is what handing the first notes away leaves behind
	if (!results.some((hit) => hit.marbleId === marbleId && isBroken(hit)) || first.time - release.time <= 2 * RELEASE_LEAD + 1e-6) return [];
	const old = before?.find((hit) => hit.marbleId === marbleId && hit.hitId === first.id);
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
	const next: TMarble['start'] = {
		...release,
		time: round4(first.time - lead),
		position: { x: round4(position.x), y: round4(position.y) },
		velocity: { x: round4(velocity.x), y: round4(velocity.y) },
		...(old.spin != null ? { spin: round4(old.spin) } : {})
	};
	return [{ type: 'updateMarble', marbleId: marble.id, patch: { start: next } }];
}

function commandPieceId(command: TProjectCommand): string {
	return command.type === 'addPiece' ? command.piece.id : command.type === 'updatePiece' ? command.pieceId : '';
}

/**
 * Problems of the one problem model (`checkRun`) that `after` has and `before` did not, which a fix must
 * not add: another marble's hits, framing or pace, Blocked scenery, and contacts such as "Bass hits Switchback 6
 * of Melody". With `working`, that marble's problems from `from` on (its hits, framing, Blocked scenery and its
 * pieces another marble hits) are left out, since Fix works through them next, and so are pieces touching from `from`
 * on, any marble's: they still move while Fix places the rest, and what is left then gets its own Fix.
 */
export function addedProblems(
	beforeProject: TProject,
	before: TSimulationResult,
	afterProject: TProject,
	after: TSimulationResult,
	blenderObjects: readonly TBlenderObject[],
	working?: { marbleId: string; from: number }
): TPreflightIssue[] {
	const warnings = (project: TProject, result: TSimulationResult): TPreflightIssue[] =>
		// A fix that plays the hits again may cost a second bounce or a roll, which keep their own problem and their own Fix
		checkRun(project, result, blenderObjects).issues.filter((issue) => issue.severity === 'warning' && issue.kind !== 'strike' && issue.kind !== 'roll');
	const had = new Set(warnings(beforeProject, before).map((issue) => issue.id));
	return warnings(afterProject, after).filter((issue) => {
		if (had.has(issue.id)) return false;
		if (working != null && issue.kind === 'touching' && (issue.time ?? Infinity) >= working.from - 1e-6) return false;
		if (working == null || issue.marbleId !== working.marbleId) return true;
		// The marble being fixed: its later hits, framing, Blocked scenery and pieces another marble hits are the
		// work still ahead, since its later platforms move them again; what is left at the end counts
		return (issue.time ?? Infinity) < working.from - 1e-6;
	});
}

/** `project` with `updatePiece`, `updateMarble`, `addPiece` and `removePieces` commands applied, for a trial run before a commit */
export function withCommands(project: TProject, commands: TProjectCommand[]): TProject {
	let pieces = project.track.pieces;
	let marbles = project.marbles;
	for (const command of commands) {
		if (command.type === 'removePieces') pieces = pieces.filter((piece) => !command.pieceIds.includes(piece.id));
		if (command.type === 'addPiece') {
			const isNew = !pieces.some((piece) => piece.id === command.piece.id);
			pieces = isNew ? [...pieces, command.piece] : pieces.map((piece) => (piece.id === command.piece.id ? command.piece : piece));
		}
		if (command.type === 'updatePiece') pieces = pieces.map((piece) => (piece.id === command.pieceId ? patched(piece, command.patch) : piece));
		if (command.type === 'updateMarble') marbles = marbles.map((marble) => (marble.id === command.marbleId ? patched(marble, command.patch) : marble));
	}
	return { ...project, marbles, track: { ...project.track, pieces }, revision: project.revision + 1 };
}


/** Where Fix starts in the song: the first broken hit, or the first Blocked piece */
function firstBrokenTime(result: TSimulationResult): number {
	const times = [...brokenHits(result.hits).map((hit) => hit.targetTime), ...result.pieces.filter((piece) => piece.status === 'blocked').map((piece) => piece.entryTime ?? piece.hitTime ?? 0)];
	return times.length ? Math.min(...times) : 0;
}

function round4(value: number): number {
	return Math.round(value * 10000) / 10000;
}
