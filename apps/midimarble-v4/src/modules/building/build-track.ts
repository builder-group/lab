import { applyProjectCommands, freePosition, type TPiece, type TProject, type TProjectCommand, tieOf } from '@/modules/project';
import { isPathPieceType, paceAt, createLinkedPiece, bandAlongGuide, isMusicalPiece, PLACEMENT_LENGTH, startRailId, type THitResult, type TSimulationResult, type TSimulator, BOWL_TYPE, bowlOfMarble } from '@/modules/simulation';
import { changedPieces } from './edit-rule';
import { columnOffset } from './build-track-defaults';
import { gapPieceReads } from './gap-pieces';
import { findLongGaps, mirrorPiece, openLongGaps, type TLongGap } from './assists';
import { gapTypeOf, restOrder } from './rest-order';
import { addKnownFaults, hitKey, noKnownFaults, reasonWords, verdictWithRoom, type TKnownFaults } from './verdict';
import { answerWorkerRequest, type TAutoPlaceAnswer, type TContinueAnswer, type TGapAnswer, type TGapPieceType } from './worker-protocol';
import { checkFraming } from './export-preflight';
import { withBowls } from './bowl-assist';
import { withStartRails } from './start-rail';
import { hitReach, openHits } from './reachability';

// Build Track: the app's own way of building a whole track from a song, one implementation for the command, Next's
// fallback and the fixture script. Marbles are built together in time order, so each keeps clear of what the others
// have built so far. Each step takes the first of these that keeps every placed hit on time, every marble on its own
// pieces and striking each platform once, every piece clear of the others on the wall, the next dot in
// frame and near the shared pace: what fills a rest, in the order of `restOrder` (`fillRest`), Continue and Mirror when the rhythm repeats and
// the next dot stays on its column, Auto place (which launches into a coming gap and ranks its angles by how regular the
// track looks), a wider Auto place. When none does,
// it does what a person tries next: turn the marble's previous platform, turn the other marble's platform in the way,
// lean this platform by hand, then back up a few hits, turn the platform there and build forward again. A song that
// still gets stuck, or whose finished run leaves the pace or the camera's frame, is started again with the releases a
// few millimeters over, as a person would: what a stuck hit tries costs more than a song's first hits, so a release
// ends at the first hit nothing solves. That goes on until `SEARCHES_PER_HIT` searches per hit are spent; the attempt that got
// furthest then finishes past the hits nothing solves and names them, for Fix. The limit counts searches, not seconds,
// so every choice follows from the project and the same project always gets the same track.

const DEGREE = Math.PI / 180;
/** Release shifts tried in turn, in meters */
const RELEASE_SHIFTS = [0, 0.005, -0.005, 0.01, -0.01, 0.015, -0.015, 0.02, -0.02, 0.025, -0.025, 0.03, -0.03, 0.04, -0.04];
/**
 * Auto place and gap piece searches per hit of the song, over every attempt, before the build stops looking for a clean
 * run. A search is nearly all of a build's time, about half a second each: Jingle Bells takes 1.6 per hit from a release that goes well.
 */
const SEARCHES_PER_HIT = 6;
/** What the attempt that goes on past a stuck hit may search on top, per hit; once spent, each hit gets one plain step */
const FORCED_SEARCHES_PER_HIT = 2;
/** What one attempt may search per hit, so a release that goes badly leaves room for the next: Jingle Bells takes about 2 when it goes well */
const ATTEMPT_SEARCHES_PER_HIT = 3;
/** A rebuild keeps its releases, so its attempts differ in the turn of each marble's first new platform instead, in degrees */
const REBUILD_TURNS = [0, 3, -3, 6, -6, 9, -9, 12, -12];
const PREVIOUS_TURNS = [3, -3, 6, -6, 9, -9, 12, -12, 18, -18];
const OTHER_TURNS = [3, -3, 6, -6, 9, -9];
/** Turns tried on the last platform before a stretch the camera loses a marble in, one per try */
const FRAME_TURNS = [3, -3, 6, -6, 9, -9, 12, -12];
/** How far before that stretch the build backs up to, in seconds, and how far ahead the camera needs a settled run */
const FRAME_BACKUP = 0.5;
/** How much further back each back-up from a stuck hit reaches, in seconds */
const STUCK_REACH = 0.5;
const CAMERA_SETTLE = 1.5;
const FRAME_CHECK_EVERY = 1;
/** How many times one attempt backs up before it counts as stuck */
const MAX_BACK_UPS = 16;
/** How many hits before the stuck one the build backs up to, and the turns it tries for the platform there */
const REWIND_DEPTHS = [2, 3];
const REWIND_TURNS = [3, -3, 6, -6, 9, -9];
const LEANS = [0, 3, -3, 6, -6, 9, -9, 12, -12, 15, -15, 18, -18, 21, -21, 24, -24];
/** At most this many dots may sit beyond the pace limit, and none more than `PACE_OVERSHOOT` beyond it */
const OFF_PACE_DOTS = 2;
const PACE_OVERSHOOT = 0.15;
/** A copied tilt counts only while the next dot lands this close to its column, in piece lengths; Auto place corrects the rest */
const COLUMN_TOLERANCE = 0.6;
/** The drop a copied tilt may give, as a share of the pace's */
const COPY_DROP_SHARE = 1.25;
/** Steps show at most this often, in milliseconds: each one simulates and draws the whole window again */
const SHOW_EVERY = 250;
/** How many hits ahead a choice between pieces is tried, and what each hit it can't reach counts for against its look */
const LOOK_AHEAD_HITS = 3;
const DEAD_END_COST = 100;
/** What the Switchback layout costs against a straight rail that also works, and more when the marble just rode one, in units of `lookCost` */
const SWITCHBACK_COST = 0.3;
const SWITCHBACK_IN_A_ROW_COST = 0.3;

export interface TBuildCounts {
	next: number;
	/** A single Curved Rail across a rest */
	curve: number;
	switchback: number;
	chain: number;
	rail: number;
	continue: number;
	continued: number;
	mirror: number;
	autoPlace: number;
	launch: number;
	wide: number;
	lean: number;
	backtrack: number;
	unblock: number;
	rewind: number;
	frame: number;
	failed: number;
}

/** How far the build is: `done` of `total` hits have a platform that lands on time */
export interface TBuildProgress {
	done: number;
	total: number;
	/** Song time of the hit being worked on */
	at: number;
	/** 0 to 1, through the song from the first hit to the last */
	fraction: number;
	/** How many times the build has started over with the releases moved */
	restarts: number;
}

export interface TBuildAttention {
	marbleId: string;
	hitId: string;
	/** Position among the marble's hits, from 0 */
	index: number;
	time: number;
	status: THitResult['status'];
}

export interface TBuildOutcome {
	project: TProject;
	result: TSimulationResult;
	/** Pieces the build added */
	added: number;
	/** The person's pieces it had to turn, by piece ID */
	turned: string[];
	/** How far it moved the releases, in meters; 0 when they stayed */
	releaseShift: number;
	/** Hits that are not on time, in time order, or Open after the build */
	attention: TBuildAttention[];
	/** What each Bowl search said */
	bowls: string[];
	counts: TBuildCounts;
	/** Attempts started, the first included */
	attempts: number;
	/** Stopped with Stop or by another edit, with the pieces found so far kept */
	isStopped: boolean;
}

export interface TBuildAutoPlaceRequest {
	project: TProject;
	marbleId: string;
	hitId: string;
	type: string;
	pieceId: string;
	range?: [number, number];
}

export interface TBuildGapRequest {
	type: TGapPieceType;
	project: TProject;
	marbleId: string;
	fromHitId: string;
	toHitId: string;
	pieceId: string;
}

export interface TBuildTrackDeps {
	simulate: (project: TProject) => Promise<TSimulationResult> | TSimulationResult;
	/** Rejects when no angle passes */
	autoPlace: (request: TBuildAutoPlaceRequest) => Promise<TAutoPlaceAnswer> | TAutoPlaceAnswer;
	/** Rejects when no piece fits */
	gapPiece: (request: TBuildGapRequest) => Promise<TGapAnswer> | TGapAnswer;
	continueRun: (request: { project: TProject; marbleId: string; canTurn?: boolean }) => Promise<TContinueAnswer | null> | TContinueAnswer | null;
	/** Shows a step: the first starts the undo step, later ones join it. False stops the build. */
	commit?: (commands: TProjectCommand[], isFirst: boolean, hit: THitResult | null) => boolean;
	onProgress?: (progress: TBuildProgress) => void;
	onLog?: (line: string) => void;
	isCanceled?: () => boolean;
}

export type TBuildGapPreference = 'rail' | 'switchback' | 'chain';

export interface TBuildOptions {
	/**
	 * Rebuild From Here: everything up to this hit stays exactly as it is, on every marble and with the pieces this hit
	 * already has, and what plays after it is built again. Nothing kept is ever turned and no release moves.
	 */
	from?: { marbleId: string; hitId: string };
	/** A gap piece asked for by name, tried first at every rest with the one it falls back to (`restOrder`) */
	gapPiece?: TBuildGapPreference;
	/** Build Up to Here: builds the notes up to this time on every marble and leaves the rest open, with no Bowl */
	until?: number;
}

/** Deps that answer in this thread with the same requests the assist workers answer, for scripts and tests */
export function localBuildDeps(simulator: TSimulator): Pick<TBuildTrackDeps, 'simulate' | 'autoPlace' | 'gapPiece' | 'continueRun'> {
	return {
		simulate: (project) => simulator.simulate(project),
		autoPlace: (request) => answerWorkerRequest(simulator, { kind: 'autoPlace', ...request }) as TAutoPlaceAnswer,
		gapPiece: (request) => answerWorkerRequest(simulator, { kind: 'gapPiece', ...request }) as TGapAnswer,
		continueRun: (request) => answerWorkerRequest(simulator, { kind: 'continue', ...request }) as TContinueAnswer | null
	};
}

/** How one pass through the song ended */
interface TAttempt {
	project: TProject;
	/** Song time of the hit that stopped it, Infinity when it got through */
	reached: number;
	/** The same project with its Bowls, when it got through and asked for them */
	finished?: { project: TProject; messages: string[] };
}

/** What one build carries from step to step */
interface TBuildState {
	deps: TBuildTrackDeps;
	counts: TBuildCounts;
	/** Why the current hit's options failed, for the log */
	reasons: string[];
	/** Other marbles' hits the current hit's options left Blocked or Stopped */
	inTheWay: { marbleId: string; hitId: string }[];
	/** Pieces there before the build, which backing up never takes away */
	own: Set<string>;
	/** Hits left without a piece, which every check looks past */
	skipped: Set<string>;
	/** Problems the run already had, which no step is judged by: the person's, and what a forced step left */
	known: TKnownFaults;
	/** Whether a piece that was there before the build may be turned when nothing else solves a hit */
	canTurnOwn: boolean;
	gapPiece: TBuildGapPreference | null;
	/** Trying a choice ahead, which doesn't try choices of its own */
	isLooking: boolean;
	/** Taking a gap piece that ends beyond the pace limit, once nothing else solves the hit: the run seldom recovers from one */
	mayLeavePace: boolean;
	/** Searches made and allowed, over every attempt */
	searches: TSearchBudget;
	runs: WeakMap<TProject, Promise<TSimulationResult>>;
}

interface TSearchBudget {
	used: number;
	limit: number;
}

function emptyCounts(): TBuildCounts {
	return { next: 0, curve: 0, switchback: 0, chain: 0, rail: 0, continue: 0, continued: 0, mirror: 0, autoPlace: 0, launch: 0, wide: 0, lean: 0, backtrack: 0, unblock: 0, rewind: 0, frame: 0, failed: 0 };
}

function createState(deps: TBuildTrackDeps, project: TProject, canTurnOwn = true, gapPiece: TBuildGapPreference | null = null, searches: TSearchBudget = { used: 0, limit: Infinity }): TBuildState {
	return { deps, counts: emptyCounts(), reasons: [], inTheWay: [], own: new Set(project.track.pieces.map((piece) => piece.id)), skipped: new Set(), known: noKnownFaults(), canTurnOwn, gapPiece, isLooking: false, mayLeavePace: false, searches, runs: new WeakMap() };
}

/** A project is never changed once made, so one run answers for it */
function run(state: TBuildState, project: TProject): Promise<TSimulationResult> {
	let known = state.runs.get(project);
	if (known == null) {
		known = Promise.resolve(state.deps.simulate(project));
		state.runs.set(project, known);
	}
	return known;
}

function isCanceled(state: TBuildState): boolean {
	return state.deps.isCanceled?.() === true;
}

/** Whether the search budget is gone, which ends the searching but not the build */
function isSpent(state: TBuildState): boolean {
	return state.searches.used >= state.searches.limit;
}

function shouldStopLooking(state: TBuildState): boolean {
	return isCanceled(state) || isSpent(state);
}

function reject(state: TBuildState, reason: string): null {
	state.reasons.push(reason);
	return null;
}

function apply(current: TProject, commands: TProjectCommand[]): TProject | null {
	const [isAppliedOk, , applied] = applyProjectCommands(current, commands);
	return isAppliedOk ? applied : null;
}

function isShared(current: TProject): boolean {
	return current.marbles.length > 1;
}

function remainingHits(state: TBuildState, result: TSimulationResult): THitResult[] {
	return openHits(result).filter((hit) => !state.skipped.has(hitKey(hit.marbleId, hit.hitId)));
}

function nextOpenPerMarble(state: TBuildState, result: TSimulationResult): Map<string, THitResult> {
	const next = new Map<string, THitResult>();
	for (const hit of remainingHits(state, result)) if (!next.has(hit.marbleId)) next.set(hit.marbleId, hit);
	return next;
}

function isBeforeLongGap(current: TProject, hit: THitResult): boolean {
	return findLongGaps(current, hit.marbleId).some((gap) => gap.toHitId === hit.hitId && gap.bridgedBy == null);
}

/** The interval to this hit equals the interval before, so a mirrored piece keeps the zigzag rhythm */
function repeatsInterval(current: TProject, marbleId: string, hitId: string): boolean {
	const hits = current.marbles.find((marble) => marble.id === marbleId)?.hits ?? [];
	const index = hits.findIndex((hit) => hit.id === hitId);
	const [a, b, c] = [hits[index - 2], hits[index - 1], hits[index]];
	if (a == null || b == null || c == null) return false;
	return Math.abs(c.time - b.time - (b.time - a.time)) < 0.015;
}

/** A new piece's ID follows from its hit, so a project always gets the same IDs */
function newPieceId(current: TProject, hitId: string): string {
	return freeId(current, /^hit/.test(hitId) ? hitId.replace(/^hit/, 'piece') : `piece-${hitId}`);
}

function freeId(current: TProject, id: string): string {
	if (!current.track.pieces.some((piece) => piece.id === id)) return id;
	let index = 2;
	while (current.track.pieces.some((piece) => piece.id === `${id}-${index}`)) index++;
	return `${id}-${index}`;
}

function gapPieceId(state: TBuildState, current: TProject, type: TGapPieceType, marbleId: string): string {
	const marble = current.marbles.findIndex((item) => item.id === marbleId) + 1;
	return freeId(current, `${type}-${marble}-${state.counts.switchback + state.counts.chain + state.counts.rail + 1}`);
}

/** Applies the commands when every fact holds, stated by the verdict: with `checksNext`, the marble's next open dot counts too */
async function accept(state: TBuildState, current: TProject, commands: TProjectCommand[], marbleId: string, checksNext = true): Promise<TProject | null> {
	const applied = apply(current, commands);
	if (applied == null) return reject(state, 'commands do not apply');
	const result = await run(state, applied);
	const { reasons } = await verdictWithRoom({ before: { project: current, result: await run(state, current) }, after: { project: applied, result }, marbleId, known: state.known, skipped: state.skipped, checksNext, stopsAtFirst: true }, state.deps.simulate);
	if (!reasons.length) return applied;
	for (const reason of reasons) {
		if (reason.kind === 'late' && (reason.why === 'blocked' || reason.why === 'resting')) state.inTheWay.push({ marbleId: reason.marbleId, hitId: reason.hitId });
	}
	return reject(state, reasons.map((reason) => reasonWords(applied, reason)).join(' '));
}

/**
 * Whether the marble's next open dot still lands on the column opposite this one: a copied tilt keeps its shape only while
 * it does, and otherwise the small errors of each copy add up and the run wanders. Before a long gap any spot will do,
 * since a gap piece picks the marble up.
 */
function staysOnColumn(state: TBuildState, project: TProject, result: TSimulationResult, marbleId: string): boolean {
	const next = nextOpenPerMarble(state, result).get(marbleId);
	if (next?.dot == null || isBeforeLongGap(project, next)) return true;
	const marble = project.marbles.find((item) => item.id === marbleId);
	const previous = marble?.hits[(marble.hits.findIndex((hit) => hit.id === next.hitId) ?? 0) - 1];
	const from = result.hits.find((hit) => hit.marbleId === marbleId && hit.hitId === previous?.id)?.dot;
	if (from == null) return true;
	const bandAt = bandAlongGuide(project, marbleId);
	const length = PLACEMENT_LENGTH;
	const column = bandAt(next.dot.y).centerX - Math.sign(from.x - bandAt(from.y).centerX) * columnOffset(length);
	if (Math.abs(next.dot.x - column) > COLUMN_TOLERANCE * length) return false;
	// Nor may it fall much further than the pace asks: a copy keeps whatever drop it was given, and Auto place corrects it
	return result.pace == null || previous == null || from.y - next.dot.y <= COPY_DROP_SHARE * result.pace.rate * (next.targetTime - previous.time);
}

/** How regular the marble's last hits look, lower is better, per hit: how far each drop lies from the pace's for its interval, in piece lengths */
function lookCost(result: TSimulationResult, marbleId: string): number {
	const length = PLACEMENT_LENGTH;
	const played = result.hits.filter((hit) => hit.marbleId === marbleId && hit.pieceId != null && hit.dot != null).sort((a, b) => a.targetTime - b.targetTime).slice(-1 - LOOK_AHEAD_HITS);
	let cost = 0;
	played.forEach((hit, index) => {
		const before = played[index - 1];
		if (before?.dot != null && hit.dot != null && result.pace != null) cost += Math.abs(before.dot.y - hit.dot.y - result.pace.rate * (hit.targetTime - before.targetTime)) / length;
	});
	return cost / Math.max(1, played.length);
}

/** Builds on from a candidate for a few hits, first choice each time, and says how that went; the build's counts stay as they were */
async function lookAhead(state: TBuildState, start: TProject, marbleId: string): Promise<number> {
	const counts = { ...state.counts };
	const reasons = [...state.reasons];
	const inTheWay = [...state.inTheWay];
	state.isLooking = true;
	let current = start;
	let cost = 0;
	for (let done = 0; done < LOOK_AHEAD_HITS && !shouldStopLooking(state); done++) {
		const result = await run(state, current);
		const target = nextTarget(state, current, result);
		if (target == null) break;
		const next = await buildStep(state, current, target, false);
		if (next == null) {
			cost += DEAD_END_COST * (LOOK_AHEAD_HITS - done);
			break;
		}
		current = next;
	}
	state.isLooking = false;
	Object.assign(state.counts, counts);
	state.reasons.splice(0, state.reasons.length, ...reasons);
	state.inTheWay.splice(0, state.inTheWay.length, ...inTheWay);
	return cost + lookCost(await run(state, current), marbleId);
}

/** The option that looks and goes on best over the next few hits, the first of equals */
async function chooseAhead<T extends { project: TProject; cost?: number; label: string }>(state: TBuildState, options: T[], marbleId: string): Promise<T | null> {
	let best: T | null = null;
	let bestCost = Infinity;
	for (const option of options) {
		if (shouldStopLooking(state)) return best ?? options[0] ?? null;
		const cost = (option.cost ?? 0) + (await lookAhead(state, option.project, marbleId));
		state.deps.onLog?.(`  ahead: ${option.label} costs ${cost.toFixed(2)}`);
		if (cost < bestCost - 1e-9) {
			best = option;
			bestCost = cost;
		}
	}
	return best;
}

async function ask<T>(state: TBuildState, kind: string, question: () => Promise<T> | T): Promise<T | null> {
	if (kind !== 'continue') state.searches.used++;
	try {
		return await question();
	} catch (error) {
		return reject(state, `${kind}: ${(error as Error).message}`);
	}
}

/**
 * What fills the rest before a note, the whole decision in one place: the kinds of `restOrder` in turn, each asked of the
 * workers and judged by `accept`. A piece that ends far from the pace leaves the rest to the next kind, except the last,
 * which has to do. The first that fits wins when it's the Curved Rail, asked for by name, or tried while looking ahead;
 * otherwise the plain Rail and the Switchback layout that both fit are each built on for a few notes (`chooseAhead`), the
 * Switchback's hooks costing more. One log line says what each kind did. Null leaves the note to a Platform.
 */
async function fillRest(state: TBuildState, current: TProject, result: TSimulationResult, gap: TLongGap): Promise<TProject | null> {
	const { deps, counts } = state;
	const { marbleId } = gap;
	// One marble keeps no shared height, so a gap piece may land it anywhere it can go on from
	const paceLimit = isShared(current) ? (result.pace?.limit ?? Infinity) : Infinity;
	const order = restOrder(state.gapPiece).flatMap((kind) => gapTypeOf(kind) ?? []);
	const options: { project: TProject; type: TGapPieceType; cost: number; log: string; label: string }[] = [];
	const said: string[] = [];
	const rodeSwitchback = current.track.pieces.filter((piece) => tieOf(piece)?.marbleId === marbleId && piece.type !== 'platform' && !state.own.has(piece.id)).at(-1)?.layout === 'switchback';
	for (const type of order) {
		if (isCanceled(state)) return null;
		const reasonsBefore = state.reasons.length;
		const passed = (): void => {
			said.push(`${type} no (${state.reasons.slice(reasonsBefore).join('; ')})`);
		};
		const pieceId = gapPieceId(state, current, type, marbleId);
		const answer = await ask(state, 'gapPiece', () => deps.gapPiece({ type, project: current, marbleId, fromHitId: gap.fromHitId, toHitId: gap.toHitId, pieceId }));
		const paceError = Math.abs(answer?.check?.paceError ?? 0);
		if ((type !== order.at(-1) && answer?.check != null && !gapPieceReads(answer.check, paceLimit)) || (!state.mayLeavePace && paceError > paceLimit)) {
			reject(state, `the ${type} ends ${paceError.toFixed(2)} m from the pace`);
			passed();
			continue;
		}
		// The note after the gap piece is placed by construction wherever the marble arrives
		const accepted = answer != null ? await accept(state, current, answer.commands, marbleId, false) : null;
		if (accepted == null) {
			passed();
			continue;
		}
		const params = answer?.piece.params ?? {};
		const pace = answer?.check?.paceError;
		const log = `${type}${type === 'switchback' || type === 'chain' ? ` (${params['turns']} turns at ${(Math.abs(answer?.piece.angle ?? 0) / DEGREE).toFixed(0)}°)` : ''}, next dot ${pace != null ? `${pace.toFixed(2)} m from y*` : 'without pace'}`;
		const isAsked = state.gapPiece === type;
		options.push({ project: accepted, type, log, label: type, cost: isAsked || type !== 'switchback' ? 0 : SWITCHBACK_COST + (rodeSwitchback ? SWITCHBACK_IN_A_ROW_COST : 0) });
		said.push(`${type} fits`);
		if (isAsked || state.isLooking || type === 'curve') break;
	}
	const chosen = options.length > 1 ? await chooseAhead(state, options, marbleId) : options[0];
	const rest = `  ${gap.fromHitId} -> ${gap.toHitId}, a rest of ${gap.duration.toFixed(2)} s: ${said.join('; ')}`;
	if (chosen == null) {
		deps.onLog?.(`${rest}; a Platform at ${gap.toHitId} instead`);
		return null;
	}
	counts[chosen.type === 'switchback' || chosen.type === 'chain' || chosen.type === 'curve' ? chosen.type : 'rail']++;
	deps.onLog?.(`${rest}; ${chosen.log}`);
	return chosen.project;
}

/**
 * One option after another for the hit: what fills the rest when a long gap ends at it (`fillRest`), otherwise Continue,
 * then Mirror when the rhythm repeats, then Auto place (which launches the marble into the coming gap piece before a long
 * gap), then Auto place over a wider range. Each must pass `accept`; the first that does wins. With `canLean`, last the
 * platform is leaned by hand until the next dot comes back as close to the marble's band as it gets.
 */
async function buildStep(state: TBuildState, current: TProject, target: THitResult, canLean: boolean): Promise<TProject | null> {
	const { deps, counts } = state;
	const { marbleId, hitId } = target;
	const result = await run(state, current);
	const gap = findLongGaps(current, marbleId).find((item) => item.toHitId === hitId && item.bridgedBy == null);
	const filled = gap != null ? await fillRest(state, current, result, gap) : null;
	if (filled != null) return filled;
	if (isCanceled(state)) return null;

	const isLaunch = findLongGaps(current, marbleId).some((item) => item.fromHitId === hitId && item.bridgedBy == null);
	const continued = !isLaunch ? await ask(state, 'continue', () => deps.continueRun({ project: current, marbleId, canTurn: false })) : null;
	// Ghosts get the build's IDs, so the track is the same on every run
	const taken = new Set<string>();
	const ghosts: TProjectCommand[] = (continued?.commands ?? []).map((command) => {
		const link = command.type === 'addPiece' ? tieOf(command.piece) : undefined;
		if (command.type !== 'addPiece' || link == null) return command;
		const id = newPieceId(current, link.hitId);
		taken.add(id);
		return { ...command, piece: { ...command.piece, id } };
	});
	if (ghosts.length > 0) {
		const accepted = await accept(state, current, ghosts, marbleId);
		if (accepted != null && staysOnColumn(state, accepted, await run(state, accepted), marbleId)) {
			counts.continue++;
			counts.continued += ghosts.length;
			return accepted;
		}
	}

	const marble = current.marbles.find((item) => item.id === marbleId);
	const hits = marble?.hits ?? [];
	const isLast = hits.at(-1)?.id === hitId;
	// Like Continue, Mirror leaves the hit ahead of a launch to Auto place, which checks the launch is struck firmly
	const following = hits[hits.findIndex((hit) => hit.id === hitId) + 1];
	const isBeforeLaunch = following != null && findLongGaps(current, marbleId).some((item) => item.fromHitId === following.id);
	const id = newPieceId(current, hitId);
	if (!isLaunch && !isLast && !isBeforeLaunch && repeatsInterval(current, marbleId, hitId)) {
		const [isMirrorOk, , mirrored] = mirrorPiece(current, result, marbleId, { id });
		const accepted = isMirrorOk && mirrored.hitId === hitId ? await accept(state, current, mirrored.commands, marbleId) : null;
		if (accepted != null && staysOnColumn(state, accepted, await run(state, accepted), marbleId)) {
			counts.mirror++;
			return accepted;
		}
	}
	if (isCanceled(state)) return null;

	const placed = await ask(state, 'autoPlace', () => deps.autoPlace({ project: current, marbleId, hitId, type: 'platform', pieceId: id }));
	const accepted = placed != null ? await accept(state, current, [{ type: 'addPiece', piece: placed.piece }], marbleId) : null;
	if (accepted != null) {
		if (isLaunch) counts.launch++;
		else counts.autoPlace++;
		return accepted;
	}
	if (isCanceled(state)) return null;
	// What a person tries next: turning further than Auto place searches. A search that found nothing already tried these.
	if (placed != null) {
		const wide = await ask(state, 'wide autoPlace', () => deps.autoPlace({ project: current, marbleId, hitId, type: 'platform', pieceId: id, range: [-60 * DEGREE, 60 * DEGREE] }));
		const widened = wide != null ? await accept(state, current, [{ type: 'addPiece', piece: wide.piece }], marbleId) : null;
		if (widened != null) {
			counts.wide++;
			return widened;
		}
	}
	if (!canLean) return null;
	const bandAt = bandAlongGuide(current, marbleId);
	const { halfWidth } = bandAt(target.dot?.y ?? 0);
	let best: { project: TProject; angle: number; offset: number } | null = null;
	for (let degrees = -24; degrees <= 24; degrees += 3) {
		if (isCanceled(state)) return null;
		const piece = createLinkedPiece('platform', marbleId, hitId, degrees * DEGREE, { id, pieces: current.track.pieces });
		const leaned = await accept(state, current, [{ type: 'addPiece', piece }], marbleId, false);
		if (leaned == null) continue;
		const dot = nextOpenPerMarble(state, await run(state, leaned)).get(marbleId)?.dot;
		const offset = dot == null ? 0 : Math.abs(dot.x - bandAt(dot.y).centerX);
		// A lean that throws the marble out of its marble only moves the trouble: it lands among the other marble's pieces
		if (offset > halfWidth) continue;
		if (best == null || offset < best.offset - 1e-6) best = { project: leaned, angle: degrees, offset };
	}
	if (best == null) return null;
	counts.lean++;
	deps.onLog?.(`  ${hitId}: rotated by hand to ${best.angle}°, next dot ${best.offset.toFixed(2)} m from its band center (${state.reasons.at(-1) ?? ''})`);
	return best.project;
}

/** The marble's previous platform turned a little so the marble arrives differently, then the step again */
async function backtrack(state: TBuildState, current: TProject, target: THitResult, canTurnOwn = false): Promise<TProject | null> {
	const marble = current.marbles.find((item) => item.id === target.marbleId);
	const index = marble?.hits.findIndex((hit) => hit.id === target.hitId) ?? -1;
	const previousHit = marble?.hits[index - 1];
	const previous = current.track.pieces.find((piece) => tieOf(piece)?.hitId === previousHit?.id && piece.type === 'platform');
	const angle = tieOf(previous) != null ? previous?.angle : undefined;
	if (previous == null || angle == null || (state.own.has(previous.id) && !canTurnOwn)) return null;
	for (const delta of PREVIOUS_TURNS) {
		if (shouldStopLooking(state)) return null;
		const rotated = structuredClone(previous);
		if (tieOf(rotated) != null) rotated.angle = angle + delta * DEGREE;
		const turned = await accept(state, current, [{ type: 'addPiece', piece: rotated }], target.marbleId, false);
		if (turned == null) continue;
		const moved = (await run(state, turned)).hits.find((hit) => hit.marbleId === target.marbleId && hit.hitId === target.hitId);
		if (moved?.dot == null || moved.status !== 'open') continue;
		const next = await buildStep(state, turned, moved, false);
		if (next != null) {
			state.counts.backtrack++;
			state.deps.onLog?.(`  ${previous.id}: rotated by ${delta}° by hand so ${target.hitId} can be placed`);
			return next;
		}
	}
	return null;
}

/** When every option left another marble's piece Blocked or Stopped, that piece is turned so the marbles keep clear */
async function unblock(state: TBuildState, current: TProject, target: THitResult, canTurnOwn = false): Promise<TProject | null> {
	const seen = new Set<string>();
	const others = state.inTheWay.filter((hit) => {
		const key = hitKey(hit.marbleId, hit.hitId);
		if (hit.marbleId === target.marbleId || seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	for (const other of others) {
		const piece = current.track.pieces.find((piece) => tieOf(piece)?.hitId === other.hitId && piece.type === 'platform');
		const angle = piece?.angle;
		if (piece == null || angle == null || (state.own.has(piece.id) && !canTurnOwn)) continue;
		for (const delta of OTHER_TURNS) {
			if (shouldStopLooking(state)) return null;
			const rotated = structuredClone(piece);
			if (tieOf(rotated) != null) rotated.angle = angle + delta * DEGREE;
			const turned = apply(current, [{ type: 'addPiece', piece: rotated }]);
			if (turned == null) continue;
			const result = await run(state, turned);
			if (result.hits.some((hit) => hit.status !== 'open' && hit.status !== 'onTime' && hit.targetTime <= target.targetTime && !state.known.hits.has(hitKey(hit.marbleId, hit.hitId)))) continue;
			const moved = result.hits.find((hit) => hit.marbleId === target.marbleId && hit.hitId === target.hitId);
			if (moved == null) continue;
			const next = (await buildStep(state, turned, moved, false)) ?? (moved.dot != null ? await backtrack(state, turned, moved) : null);
			if (next != null) {
				state.counts.unblock++;
				state.deps.onLog?.(`  ${piece.id}: rotated by ${delta}° by hand so ${target.hitId} keeps clear of it`);
				return next;
			}
		}
	}
	return null;
}

/**
 * Backs up a few hits on the marble: the platform there is turned a little, the pieces the build placed after it go, and
 * the marble is built forward again up to the stuck hit. Pieces that were there before the build stop it going further back.
 */
async function rewind(state: TBuildState, current: TProject, target: THitResult): Promise<TProject | null> {
	const hits = current.marbles.find((marble) => marble.id === target.marbleId)?.hits ?? [];
	const index = hits.findIndex((hit) => hit.id === target.hitId);
	for (const depth of REWIND_DEPTHS) {
		const from = hits[index - depth];
		const pivot = current.track.pieces.find((piece) => tieOf(piece)?.hitId === from?.id && piece.type === 'platform');
		const angle = pivot?.angle;
		if (from == null || pivot == null || angle == null || state.own.has(pivot.id)) continue;
		const after = new Set(hits.slice(index - depth + 1, index).map((hit) => hit.id));
		const dropped = current.track.pieces.filter((piece) => {
			const link = tieOf(piece);
			if (link?.marbleId !== target.marbleId) return false;
			// A gap piece hangs on the hit before its gap, so the one on the turned platform goes as well
			return after.has(link.hitId) || (link.hitId === from.id && piece.id !== pivot.id);
		});
		if (dropped.some((piece) => state.own.has(piece.id))) continue;
		for (const delta of REWIND_TURNS) {
			if (shouldStopLooking(state)) return null;
			const rotated = structuredClone(pivot);
			if (tieOf(rotated) != null) rotated.angle = angle + delta * DEGREE;
			let next = await accept(state, current, [...(dropped.length > 0 ? [{ type: 'removePieces' as const, pieceIds: dropped.map((piece) => piece.id) }] : []), { type: 'addPiece', piece: rotated }], target.marbleId, false);
			for (let step = 0; next != null && step < depth * 2 + 2; step++) {
				const project: TProject = next;
				const result = await run(state, project);
				const open = result.hits.filter((hit) => hit.marbleId === target.marbleId && hit.status === 'open').sort((a, b) => a.targetTime - b.targetTime)[0];
				if (open == null || open.targetTime > target.targetTime + 1e-9) {
					state.counts.rewind++;
					state.deps.onLog?.(`  ${pivot.id}: rotated by ${delta}° and the ${depth - 1} after it built again so ${target.hitId} can be placed`);
					return project;
				}
				next = await buildStep(state, project, open, false);
			}
		}
	}
	return null;
}

/** A gap piece far from the pace, when nothing else solves the hit */
async function stepLeavingPace(state: TBuildState, current: TProject, target: THitResult): Promise<TProject | null> {
	if (!findLongGaps(current, target.marbleId).some((gap) => gap.toHitId === target.hitId && gap.bridgedBy == null)) return null;
	state.mayLeavePace = true;
	const next = await buildStep(state, current, target, false);
	state.mayLeavePace = false;
	return next;
}

/** Everything the build tries for one hit before it counts as stuck */
async function solveHit(state: TBuildState, current: TProject, target: THitResult): Promise<TProject | null> {
	state.reasons.length = 0;
	state.inTheWay.length = 0;
	return (
		(await buildStep(state, current, target, false)) ??
		(target.dot != null && !shouldStopLooking(state) ? await backtrack(state, current, target) : null) ??
		(!shouldStopLooking(state) ? await unblock(state, current, target) : null) ??
		(!shouldStopLooking(state) ? await buildStep(state, current, target, true) : null) ??
		(!shouldStopLooking(state) ? await rewind(state, current, target) : null) ??
		(!shouldStopLooking(state) ? await stepLeavingPace(state, current, target) : null) ??
		// A piece that was there before the build turns only when nothing else solves the hit
		(target.dot != null && state.canTurnOwn && !shouldStopLooking(state) ? await backtrack(state, current, target, true) : null) ??
		(state.canTurnOwn && !shouldStopLooking(state) ? await unblock(state, current, target, true) : null)
	);
}

/**
 * A hit nothing solved, so the rest can still be built: the flattest tilt that plays it on time whatever else it does,
 * or no piece at all when none does. What it breaks stays for Fix, and later steps are not judged by it.
 */
async function forceHit(state: TBuildState, current: TProject, target: THitResult): Promise<TProject> {
	const key = hitKey(target.marbleId, target.hitId);
	state.counts.failed++;
	if (target.dot != null) {
		const id = newPieceId(current, target.hitId);
		const bandAt = bandAlongGuide(current, target.marbleId);
		const { halfWidth } = bandAt(target.dot.y);
		// Of the leans that play it, the one whose next dot stays nearest the marble, or a forced run wanders off in a long diagonal
		let best: { project: TProject; degrees: number; offset: number } | null = null;
		for (const degrees of LEANS) {
			if (isCanceled(state)) break;
			const piece = createLinkedPiece('platform', target.marbleId, target.hitId, degrees * DEGREE, { id, pieces: current.track.pieces });
			const placed = apply(current, [{ type: 'addPiece', piece }]);
			if (placed == null) continue;
			const result = await run(state, placed);
			const status = result.hits.find((hit) => hit.marbleId === target.marbleId && hit.hitId === target.hitId)?.status;
			if (status !== 'onTime' && status !== 'drifting') continue;
			const dot = nextOpenPerMarble(state, result).get(target.marbleId)?.dot;
			const offset = dot != null ? Math.abs(dot.x - bandAt(dot.y).centerX) : 0;
			if (best == null || offset < best.offset - 1e-6) best = { project: placed, degrees, offset };
			if (offset <= halfWidth / 2) break;
		}
		if (best != null) {
			state.deps.onLog?.(`  ${target.hitId}: placed at ${best.degrees}° for Fix (${state.reasons.at(-1) ?? ''})`);
			await tolerate(state, best.project);
			return best.project;
		}
	}
	state.deps.onLog?.(`  ${target.hitId}: left open for Fix (${state.reasons.at(-1) ?? ''})`);
	state.skipped.add(key);
	return current;
}

/** Problems of this run stay as they are; steps after it are judged by what they add */
async function tolerate(state: TBuildState, project: TProject): Promise<void> {
	addKnownFaults(state.known, project, await run(state, project));
}

/**
 * The hit a step works on: the earliest open hit of any marble, or an earlier long gap after a marble's last piece,
 * across which it may have fallen too far to leave a dot. A hit no platform can ever reach is set aside.
 */
function nextTarget(state: TBuildState, current: TProject, result: TSimulationResult): THitResult | null {
	for (;;) {
		const open = remainingHits(state, result)[0];
		const gap = current.marbles
			.flatMap((marble) => openLongGaps(current, marble.id))
			.filter((item) => !state.skipped.has(hitKey(item.marbleId, item.toHitId)))
			.sort((a, b) => a.to - b.to)[0];
		const atGap = gap != null && (open == null || gap.to <= open.targetTime + 1e-9) ? result.hits.find((hit) => hit.marbleId === gap.marbleId && hit.hitId === gap.toHitId) : undefined;
		if (atGap != null) return atGap;
		if (open == null) return null;
		// Only what no earlier piece changes is set aside: a note too soon after the release, a marble without a marble
		const reach = hitReach(current, result, open).kind;
		if (reach !== 'tooSoon' && reach !== 'noMarble') return open;
		state.skipped.add(hitKey(open.marbleId, open.hitId));
	}
}

/** At most `OFF_PACE_DOTS` dots beyond the pace limit, and none far beyond it; one marble keeps no shared pace */
function keepsPace(project: TProject, result: TSimulationResult): boolean {
	if (!isShared(project)) return true;
	const pace = result.pace;
	if (pace == null) return false;
	const offsets = result.hits.map((hit) => Math.abs((hit.dot?.y ?? Infinity) - paceAt(pace, hit.targetTime)));
	return offsets.filter((offset) => offset > pace.limit).length <= OFF_PACE_DOTS && Math.max(...offsets) < pace.limit + PACE_OVERSHOOT;
}

/**
 * The first stretch in which the camera loses a playing marble, as the export preflight checks, before `until`: the
 * camera looks ahead, so a run is only final some way before its marbles' next open hits
 */
function framingTrouble(project: TProject, result: TSimulationResult, until = Infinity): { marbleId: string; from: number } | null {
	const stretches = checkFraming(project, result)?.stretches ?? [];
	return stretches.find((stretch) => stretch.to < until) ?? null;
}

/** Time up to which every marble's run is built, with a hit that has no piece yet as its end */
function builtUntil(state: TBuildState, result: TSimulationResult): number {
	return (remainingHits(state, result)[0]?.targetTime ?? Infinity) - CAMERA_SETTLE;
}

/** The first dot further from the shared pace than `keepsPace` allows, when the run does not keep it */
function paceTrouble(project: TProject, result: TSimulationResult): { marbleId: string; from: number } | null {
	const pace = result.pace;
	if (pace == null || keepsPace(project, result)) return null;
	const off = result.hits.filter((hit) => Math.abs((hit.dot?.y ?? Infinity) - paceAt(pace, hit.targetTime)) > pace.limit).sort((a, b) => a.targetTime - b.targetTime)[0];
	return off != null ? { marbleId: off.marbleId, from: off.targetTime } : null;
}

function marblesWithHits(project: TProject): string[] {
	return project.marbles.filter((marble) => marble.hits.length > 0).map((marble) => marble.id);
}

/** A marble no Bowl could catch: its last platforms go another way, so its fall ends somewhere a Bowl fits */
function bowlTrouble(project: TProject): { marbleId: string; from: number } | null {
	const marble = project.marbles.find((item) => item.hits.length > 0 && bowlOfMarble(project, item.id) == null);
	return marble != null ? { marbleId: marble.id, from: marble.hits.at(-1)?.time ?? 0 } : null;
}

/** The commands that turn `from` into `to`: marbles added or released elsewhere, pieces changed, added and removed, the length and the camera */
function diffCommands(from: TProject, to: TProject): TProjectCommand[] {
	const commands: TProjectCommand[] = [];
	const kept = new Set(to.track.pieces.map((piece) => piece.id));
	const gone = from.track.pieces.filter((piece) => !kept.has(piece.id)).map((piece) => piece.id);
	if (gone.length > 0) commands.push({ type: 'removePieces', pieceIds: gone });
	const marbles = new Map(from.marbles.map((marble) => [marble.id, marble]));
	for (const marble of to.marbles) {
		const before = marbles.get(marble.id);
		if (before == null) commands.push({ type: 'addMarble', marble });
		else if (before.start !== marble.start && JSON.stringify(before.start) !== JSON.stringify(marble.start)) commands.push({ type: 'updateMarble', marbleId: marble.id, patch: { start: marble.start } });
	}
	for (const piece of changedPieces(from, to)) commands.push({ type: 'addPiece', piece });
	if (from.length !== to.length) commands.push({ type: 'updateProject', patch: { length: to.length } });
	if (from.film !== to.film && JSON.stringify(from.film) !== JSON.stringify(to.film)) commands.push({ type: 'updateFilm', film: to.film });
	return commands;
}

/** The project with the releases of the marbles without pieces moved sideways */
function withReleaseShift(project: TProject, shift: number, bareMarbles: Set<string>): TProject {
	if (shift === 0) return project;
	const moved = (x: number): number => Math.round((x + shift) * 1e4) / 1e4;
	return {
		...project,
		marbles: project.marbles.map((marble) => (bareMarbles.has(marble.id) ? { ...marble, start: { ...marble.start, position: { x: moved(marble.start.position.x), y: marble.start.position.y } } } : marble)),
		track: {
			...project.track,
			pieces: project.track.pieces.map((piece) => {
				const position = freePosition(piece);
				// A marble's start rail goes with it
				if (position == null || ![...bareMarbles].some((marbleId) => startRailId(marbleId) === piece.id)) return piece;
				return { ...piece, place: { kind: 'free' as const, position: { x: moved(position.x), y: position.y } } };
			})
		}
	};
}

export function attentionOf(project: TProject, result: TSimulationResult): TBuildAttention[] {
	return result.hits
		.filter((hit) => hit.status !== 'onTime' && hit.status !== 'drifting')
		.sort((a, b) => a.targetTime - b.targetTime)
		.map((hit) => ({
			marbleId: hit.marbleId,
			hitId: hit.hitId,
			index: project.marbles.find((marble) => marble.id === hit.marbleId)?.hits.findIndex((item) => item.id === hit.hitId) ?? 0,
			time: hit.targetTime,
			status: hit.status
		}));
}

/**
 * The project without what Rebuild From Here builds again: platforms, switchbacks, rails, tunnels and Bowls that belong
 * to later hits on any marble. A gap piece hangs on the hit before its gap, so one reaching past `from` goes with them,
 * and the marbles are built together, so every marble is cut at the same time. Scenery a person tied to a marble stays.
 */
export function withoutPiecesAfter(project: TProject, from: { marbleId: string; hitId: string }): TProject {
	const time = project.marbles.find((marble) => marble.id === from.marbleId)?.hits.find((hit) => hit.id === from.hitId)?.time;
	if (time == null) return project;
	const nextOf = new Map<string, number>();
	const timeOf = new Map<string, number>();
	for (const marble of project.marbles) {
		marble.hits.forEach((hit, index) => {
			timeOf.set(`${marble.id}/${hit.id}`, hit.time);
			nextOf.set(`${marble.id}/${hit.id}`, marble.hits[index + 1]?.time ?? Infinity);
		});
	}
	const isRebuilt = (piece: TPiece): boolean => {
		const tie = tieOf(piece);
		if (tie == null) return false;
		const key = `${tie.marbleId}/${tie.hitId}`;
		if (piece.type === BOWL_TYPE) return (timeOf.get(key) ?? Infinity) > time - 1e-9 || (nextOf.get(key) ?? Infinity) > time;
		if (isPathPieceType(piece.type)) return (nextOf.get(key) ?? Infinity) > time + 1e-9;
		return isMusicalPiece(piece.type) && (timeOf.get(key) ?? Infinity) > time + 1e-9;
	};
	return { ...project, track: { ...project.track, pieces: project.track.pieces.filter((piece) => !isRebuilt(piece)) } };
}

/** `built` with each new platform in the skin of the piece that played its note in `was` */
function withSkinsOf(was: TProject, built: TProject): TProject {
	const skins = new Map<string, NonNullable<TPiece['skin']>>();
	for (const piece of was.track.pieces) {
		const tie = tieOf(piece);
		if (tie != null && piece.skin != null) skins.set(`${piece.type}/${tie.marbleId}/${tie.hitId}`, piece.skin);
	}
	if (skins.size === 0) return built;
	return {
		...built,
		track: { ...built.track, pieces: built.track.pieces.map((piece) => {
			const tie = tieOf(piece);
			const wanted = tie != null ? skins.get(`${piece.type}/${tie.marbleId}/${tie.hitId}`) : undefined;
			return wanted != null && piece.skin == null ? { ...piece, skin: wanted } : piece;
		}) }
	};
}

/**
 * One step of the build for the hit next in time, as Next's answer to a gap it cannot bridge, leaving every piece already
 * there as it is. Null when nothing works.
 */
export async function buildOneStep(project: TProject, deps: TBuildTrackDeps): Promise<{ project: TProject; commands: TProjectCommand[]; target: THitResult } | null> {
	// Continue would add several pieces, where a press adds one
	const state = createState({ ...deps, continueRun: () => null }, project, false);
	await tolerate(state, project);
	const target = nextTarget(state, project, await run(state, project));
	if (target == null) return null;
	const next = await solveHit(state, project, target);
	return next == null ? null : { project: next, commands: diffCommands(project, next), target };
}

/**
 * Builds every marble's open hits of `project` in time order, starting each bare marble on a Rail and ending each marble in a Bowl. Pieces already there
 * stay; one is turned only when nothing else solves a hit, and the outcome names it. Releases move only for marbles
 * without pieces. Each accepted step goes to `deps.commit`, so the pieces appear as they are found.
 */
export async function buildTrack(whole: TProject, deps: TBuildTrackDeps, options: TBuildOptions = {}): Promise<TBuildOutcome> {
	const { from, gapPiece = null, until } = options;
	const asked = until != null ? upTo(whole, until) : whole;
	// What Rebuild From Here keeps; the first commit takes the rest away, so it all stays one undo step
	const project = from != null ? withoutPiecesAfter(asked, from) : asked;
	const people = new Map(project.track.pieces.map((piece) => [piece.id, playedShape(piece)]));
	const build = createBuildRun(asked, project, deps, gapPiece, from);
	const best = await bestAttempt(build);
	if (best == null) throw new Error('Build Entire Track started no attempt');
	let current = await goOnPastStuck(build, best);

	// Each marble ends in a Bowl after its last note, and the film length follows
	const bowls: string[] = [];
	if (until == null && !build.isStopped && !isCanceled(best.state)) {
		const finished = best.finished ?? (await withBowls(current, { simulate: (next) => deps.simulate(next), isCanceled: deps.isCanceled }, { marbles: marblesWithHits(current) }));
		bowls.push(...finished.messages);
		if (isCanceled(best.state)) build.isStopped = true;
		else {
			current = finished.project;
			if (!publish(build, current, null)) build.isStopped = true;
		}
	}

	// A rebuilt platform keeps the skin the one on its note had
	if (from != null && !build.isStopped) current = withSkinsOf(whole, current);
	// What the last steps left unshown, a stopped build's too
	if (!publish(build, current, null, true)) build.isStopped = true;
	const result = await deps.simulate(current);
	deps.onProgress?.({ done: result.hits.filter((hit) => hit.pieceId != null && hit.status === 'onTime').length, total: build.total, at: build.lastTime, fraction: 1, restarts: build.restarts });
	return {
		project: current,
		result,
		added: current.track.pieces.filter((piece: TPiece) => !people.has(piece.id)).length,
		turned: [...people].filter(([id, was]) => {
			const piece = current.track.pieces.find((item) => item.id === id);
			return piece != null && playedShape(piece) !== was;
		}).map(([id]) => id),
		releaseShift: best.shift,
		attention: attentionOf(current, result),
		bowls,
		counts: build.counts,
		attempts: build.attempts,
		isStopped: build.isStopped
	};
}

/** The project with no notes past `time`, which a build then knows nothing of */
function upTo(project: TProject, time: number): TProject {
	return { ...project, marbles: project.marbles.map((marble) => ({ ...marble, hits: marble.hits.filter((hit) => hit.time <= time + 1e-9) })) };
}

/** What a build's turn of a person's piece would change: its tie with the tied angle, its type and its parameters */
function playedShape(piece: TPiece): string {
	const link = tieOf(piece);
	return JSON.stringify({ link, angle: link != null ? piece.angle : undefined, type: piece.type, layout: piece.layout, params: piece.params });
}

/** One Build Track, through all its attempts: what it builds, what the window shows of it and how far it got */
interface TBuildRun {
	deps: TBuildTrackDeps;
	project: TProject;
	gapPiece: TBuildOptions['gapPiece'] | null;
	canTurnOwn: boolean;
	/** Marbles without pieces, whose releases may move */
	bareMarbles: Set<string>;
	total: number;
	/** Hits it builds: all of them, or those after Rebuild From Here's hit */
	rest: number;
	isRebuild: boolean;
	/** This attempt's turn of each marble's first new platform, in degrees */
	firstTurn: number;
	firstTime: number;
	lastTime: number;
	searches: TSearchBudget;
	counts: TBuildCounts;
	attempts: number;
	restarts: number;
	furthest: number;
	shown: TProject;
	shownAt: number;
	isFirstCommit: boolean;
	isStopped: boolean;
}

/** An attempt and what it was made with */
type TBestAttempt = TAttempt & { shift: number; state: TBuildState };

function createBuildRun(whole: TProject, project: TProject, deps: TBuildTrackDeps, gapPiece: TBuildRun['gapPiece'], from: TBuildOptions['from']): TBuildRun {
	const total = project.marbles.reduce((sum, marble) => sum + marble.hits.length, 0);
	const allTimes = project.marbles.flatMap((marble) => marble.hits.map((hit) => hit.time));
	const fromTime = from != null ? (whole.marbles.find((marble) => marble.id === from.marbleId)?.hits.find((hit) => hit.id === from.hitId)?.time ?? -Infinity) : -Infinity;
	// The budget is per hit that gets built, so a rebuild of the last hits doesn't search as long as a whole song
	const rest = allTimes.filter((time) => time > fromTime).length;
	return {
		deps,
		project,
		gapPiece,
		canTurnOwn: from == null,
		bareMarbles: new Set(from != null ? [] : project.marbles.filter((marble) => !project.track.pieces.some((piece) => tieOf(piece)?.marbleId === marble.id)).map((marble) => marble.id)),
		total,
		firstTime: Math.max(fromTime, Math.min(...allTimes, Infinity)),
		lastTime: Math.max(...allTimes, -Infinity),
		rest,
		isRebuild: from != null,
		firstTurn: 0,
		searches: { used: 0, limit: SEARCHES_PER_HIT * rest },
		counts: emptyCounts(),
		attempts: 0,
		restarts: 0,
		furthest: 0,
		shown: whole,
		shownAt: -Infinity,
		isFirstCommit: true,
		isStopped: false
	};
}

/** Shows `next` in the window, or leaves it for the next step soon after the last; false stops the build */
function publish(build: TBuildRun, next: TProject, hit: THitResult | null, mustShow = false): boolean {
	const canCommit = build.deps.commit;
	if (canCommit == null) return true;
	if (!mustShow && performance.now() - build.shownAt < SHOW_EVERY) return true;
	const commands = diffCommands(build.shown, next);
	if (!commands.length) return true;
	build.shown = next;
	build.shownAt = performance.now();
	const isOk = canCommit(commands, build.isFirstCommit, hit);
	build.isFirstCommit = false;
	return isOk;
}

function reportBuildProgress(build: TBuildRun, result: TSimulationResult, at: number): void {
	const { total, firstTime, lastTime, restarts } = build;
	const done = result.hits.filter((hit) => hit.pieceId != null && hit.status === 'onTime').length;
	const span = lastTime - firstTime;
	build.furthest = Math.max(build.furthest, span > 0 ? Math.min(1, Math.max(0, (at - firstTime) / span)) : 1);
	build.deps.onProgress?.({ done, total, at, fraction: build.furthest, restarts });
}

function addCounts(counts: TBuildCounts, from: TBuildCounts): void {
	for (const key of Object.keys(counts) as (keyof TBuildCounts)[]) counts[key] += from[key];
}

/** Tries the releases in turn until one gets through; the attempt that got furthest, or null when none started */
async function bestAttempt(build: TBuildRun): Promise<TBestAttempt | null> {
	const { deps, project, bareMarbles, searches, canTurnOwn, gapPiece } = build;
	const variants = bareMarbles.size > 0 ? RELEASE_SHIFTS : build.isRebuild ? REBUILD_TURNS : [0];
	let best: TBestAttempt | null = null;
	for (const variant of variants) {
		if (build.attempts > 0 && searches.used >= searches.limit) break;
		build.attempts++;
		const shift = build.isRebuild ? 0 : variant;
		build.firstTurn = build.isRebuild ? variant : 0;
		const budget = searches.limit;
		searches.limit = Math.min(budget, searches.used + ATTEMPT_SEARCHES_PER_HIT * build.rest);
		const start = withStartRails(withReleaseShift(project, shift, bareMarbles), bareMarbles);
		const state = createState(deps, start, canTurnOwn, gapPiece, searches);
		await tolerate(state, start);
		deps.onLog?.(build.isRebuild ? `first new platforms turned by ${variant}°` : `releases shifted by ${shift.toFixed(3)} m`);
		if (build.attempts > 1) build.restarts++;
		if (!publish(build, start, null, true)) {
			build.isStopped = true;
			break;
		}
		const attempted = await attemptBuild(build, state, start, false);
		searches.limit = budget;
		addCounts(build.counts, state.counts);
		if (build.isStopped) {
			best = { ...attempted, shift, state };
			break;
		}
		const reached = await reachedWhenChecked(state, attempted);
		if (best == null || reached > best.reached) best = { ...attempted, reached, shift, state };
		if (reached === Infinity) break;
	}
	return best;
}

/** How far an attempt counts as having got: one through the song that leaves the pace, a Bowl or the frame stopped at the end */
async function reachedWhenChecked(state: TBuildState, attempted: TAttempt): Promise<number> {
	if (attempted.reached !== Infinity) return attempted.reached;
	const finished = await run(state, attempted.project);
	if (!keepsPace(attempted.project, finished) || bowlTrouble(attempted.finished?.project ?? attempted.project) != null) {
		state.deps.onLog?.('  the dots leave the shared pace or a marble misses its Bowl, so the build counts as stopped at the end');
		return attempted.project.length;
	}
	if (framingTrouble(attempted.project, finished) != null) {
		state.deps.onLog?.('  the camera loses a marble, so the build counts as stopped at the end');
		return attempted.project.length;
	}
	return Infinity;
}

/** The attempt that got furthest goes on past what stopped it; the project it ends with */
async function goOnPastStuck(build: TBuildRun, best: TBestAttempt): Promise<TProject> {
	const { project, deps, searches, rest: restHits, counts } = build;
	const { state } = best;
	if (build.isStopped) return best.project;
	if (!publish(build, best.project, null)) build.isStopped = true;
	if (build.isStopped || best.reached === Infinity || best.reached >= project.length) return best.project;
	deps.onLog?.(`no attempt got through, so the one that reached ${best.reached.toFixed(2)} s goes on past it`);
	const before = { ...state.counts };
	state.counts = emptyCounts();
	searches.limit = searches.used + FORCED_SEARCHES_PER_HIT * restHits;
	build.firstTurn = 0;
	const rest = await attemptBuild(build, state, best.project, true);
	addCounts(counts, state.counts);
	state.counts = before;
	best.finished = rest.finished;
	return rest.project;
}

/** Where one attempt has got to, and what lets it back up */
interface TAttemptProgress {
	current: TProject;
	history: { project: TProject; time: number }[];
	nextFrameCheck: number;
	tried: Set<string>;
	backUps: number;
}

/**
 * Backs up to before the time trouble starts and turns that marble's last platform there, so the rest of the run
 * is built another way. False when every turn was tried or does not hold. Each time reaches further back.
 */
async function backUp(build: TBuildRun, state: TBuildState, progress: TAttemptProgress, trouble: { marbleId: string; from: number }): Promise<boolean> {
	if (progress.backUps >= MAX_BACK_UPS || isSpent(state)) return false;
	progress.backUps++;
	const { history, tried } = progress;
	let before = history.length - 1;
	while (before > 0 && (history[before]?.time ?? -Infinity) >= trouble.from - FRAME_BACKUP) before--;
	const base = history[Math.max(0, before)]?.project;
	if (base == null) return false;
	const hits = base.marbles.find((marble) => marble.id === trouble.marbleId)?.hits ?? [];
	const owned = base.track.pieces.filter((piece) => tieOf(piece)?.marbleId === trouble.marbleId && piece.type === 'platform' && !state.own.has(piece.id));
	const pivot = owned.map((piece) => ({ piece, time: hits.find((hit) => hit.id === tieOf(piece)?.hitId)?.time ?? -Infinity })).sort((a, b) => b.time - a.time)[0]?.piece;
	const angle = pivot?.angle;
	if (pivot == null || angle == null) return false;
	for (const delta of FRAME_TURNS) {
		if (tried.has(`${pivot.id}/${delta}`)) continue;
		tried.add(`${pivot.id}/${delta}`);
		const rotated = structuredClone(pivot);
		if (tieOf(rotated) != null) rotated.angle = angle + delta * DEGREE;
		const turned = await accept(state, base, [{ type: 'addPiece', piece: rotated }], trouble.marbleId, false);
		if (turned == null) continue;
		build.deps.onLog?.(`  backing up from ${trouble.from.toFixed(2)} s on ${trouble.marbleId}: ${pivot.id} turns by ${delta}° and the build goes on from there`);
		history.length = Math.max(0, before) + 1;
		history[history.length - 1] = { project: turned, time: history.at(-1)?.time ?? -Infinity };
		progress.current = turned;
		progress.nextFrameCheck = build.firstTime + FRAME_CHECK_EVERY;
		state.counts.frame++;
		return true;
	}
	return false;
}

/** `project` with the platform of `target` turned by `degrees`, or as it is when the turn doesn't hold */
async function turned(state: TBuildState, project: TProject, target: THitResult, degrees: number): Promise<TProject> {
	const platform = project.track.pieces.find((piece) => tieOf(piece)?.marbleId === target.marbleId && tieOf(piece)?.hitId === target.hitId && piece.type === 'platform');
	if (platform == null || tieOf(platform) == null) return project;
	const rotated = structuredClone(platform);
	if (tieOf(rotated) != null) rotated.angle += degrees * DEGREE;
	return (await accept(state, project, [{ type: 'addPiece', piece: rotated }], target.marbleId, false)) ?? project;
}

/**
 * Steps through the song from `start`. Without `canForce` it ends at the first hit nothing solves; with it, that
 * hit is left for Fix and the rest gets built.
 */
async function attemptBuild(build: TBuildRun, state: TBuildState, start: TProject, canForce: boolean): Promise<TAttempt> {
	const { deps, total, firstTime } = build;
	const progress: TAttemptProgress = { current: start, history: [{ project: start, time: -Infinity }], nextFrameCheck: firstTime + FRAME_CHECK_EVERY, tried: new Set(), backUps: 0 };
	const turnedMarbles = new Set<string>();
	const stopped = (): TAttempt => {
		build.isStopped = true;
		return { project: progress.current, reached: -Infinity };
	};
	/** Backs up for `trouble` and shows the result; true when the build goes on from there */
	const wentBack = async (trouble: { marbleId: string; from: number }): Promise<boolean> => {
		if (!(await backUp(build, state, progress, trouble))) return false;
		if (!publish(build, progress.current, null)) build.isStopped = true;
		return true;
	};
	for (let step = 0; step < total * 8 + 16; step++) {
		if (isCanceled(state)) return stopped();
		const { current } = progress;
		const result = await run(state, current);
		const target = nextTarget(state, current, result);
		if (target == null) {
			// The whole run is built, so the camera's answer, the pace and the Bowls are final
			const finished = await withBowls(current, { simulate: (next) => deps.simulate(next), isCanceled: deps.isCanceled }, { marbles: marblesWithHits(current) });
			if (isCanceled(state)) return stopped();
			const trouble = canForce ? null : (framingTrouble(finished?.project ?? current, finished != null ? await deps.simulate(finished.project) : result) ?? paceTrouble(current, result) ?? bowlTrouble(finished?.project ?? current));
			if (trouble != null && (await wentBack(trouble))) continue;
			return { project: current, reached: Infinity, ...(finished != null ? { finished } : {}) };
		}
		if (!canForce && target.targetTime >= progress.nextFrameCheck) {
			progress.nextFrameCheck = target.targetTime + FRAME_CHECK_EVERY;
			const trouble = framingTrouble(current, result, builtUntil(state, result));
			if (trouble != null && (await wentBack(trouble))) continue;
		}
		// The search budget is gone: this attempt ends here, and the one that got furthest goes on past it
		if (!canForce && isSpent(state)) return { project: current, reached: target.targetTime };
		state.counts.next++;
		reportBuildProgress(build, result, target.targetTime);
		const next = await solveHit(state, current, target);
		if (isCanceled(state)) return stopped();
		if (next == null && !canForce) {
			deps.onLog?.(`  ${target.hitId}: nothing solves it at ${target.targetTime.toFixed(2)} s (${state.reasons.join('; ') || 'no assist found a piece'})`);
			// With another release to try, that comes cheaper than backing up: a song's first hits take few searches, a stuck hit dozens
			if (build.bareMarbles.size === 0 && !build.isRebuild && (await wentBack({ marbleId: target.marbleId, from: target.targetTime - progress.backUps * STUCK_REACH }))) continue;
			return { project: current, reached: target.targetTime };
		}
		const played = next != null && build.firstTurn !== 0 && !turnedMarbles.has(target.marbleId) ? await turned(state, next, target, build.firstTurn) : next;
		if (next != null) turnedMarbles.add(target.marbleId);
		progress.current = played ?? (await forceHit(state, current, target));
		progress.history.push({ project: progress.current, time: target.targetTime });
		if (!publish(build, progress.current, target)) return stopped();
	}
	return { project: progress.current, reached: Infinity };
}
