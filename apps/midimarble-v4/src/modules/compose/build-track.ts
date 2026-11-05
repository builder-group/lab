import { applyProjectCommands, type TEntity, type TProject, type TProjectCommand } from '@/modules/project';
import {
	answerWorkerRequest,
	columnOffset,
	gapPieceOrder,
	gapPieceReads,
	extraStrikes,
	rollingHits,
	findLongGaps,
	isInBand,
	mirrorPiece,
	openLongGaps,
	paceAt,
	createLinkedPiece,
	frameBand,
	isMusicalPiece,
	PLACEMENT_LENGTH,
	resolvePieceParams,
	startRailId,
	touchingPairs,
	type TAutoPlaceAnswer,
	type TContinueAnswer,
	type TGapAnswer,
	type TGapPieceType,
	type THitResult,
	type TSimulationResult,
	type TSimulator
} from '@/modules/simulation';
import { checkFraming } from '@/modules/design/export-preflight';
import { BOWL_TYPE, bowlOfLane } from '@/modules/simulation';
import { withBowls } from './bowl-assist';
import { withStartRails } from './start-rail';
import { openHits } from './step-loop';
import { hitReach } from './reachability';

// Build Track: the app's own way of building a whole track from a song, one implementation for the command, Next's
// fallback and the fixture script. Marbles are built together in time order, so each keeps clear of what the others
// have built so far. Each step takes the first of these that keeps every placed hit on time, every marble on its own
// pieces and striking each platform once, every piece clear of the others on the wall, the next dot in
// frame and near the shared pace: a rail across a long gap, or its Switchback layout where a straight one won't do, Continue and Mirror when the rhythm repeats and
// the next dot stays on its column, Auto place (which launches into a coming gap and ranks its angles by how regular the
// track looks), a wider Auto place. When none does,
// it does what a person tries next: turn the lane's previous platform, turn the other marble's platform in the way,
// lean this platform by hand, then back up a few hits, turn the platform there and build forward again. A song that
// still gets stuck, or whose finished run leaves the pace or the camera's frame, is started again with the releases a
// few millimetres over, as a person would: what a stuck hit tries costs more than a song's first hits, so a release
// ends at the first hit nothing solves. That goes on until `SEARCHES_PER_HIT` searches per hit are spent; the attempt that got
// furthest then finishes past the hits nothing solves and names them, for Fix. The limit counts searches, not seconds,
// so every choice follows from the project and the same project always gets the same track.

const DEGREE = Math.PI / 180;
/** Release shifts tried in turn, in metres */
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
const COLUMN_TOLERANCE = 0.25;
/** Steps show at most this often, in milliseconds: each one simulates and draws the whole window again */
const SHOW_EVERY = 250;
/** How many hits ahead a choice between pieces is tried, and what each hit it can't reach counts for against its look */
const LOOK_AHEAD_HITS = 3;
const DEAD_END_COST = 100;
/** What the Switchback layout costs against a straight rail that also works, and more when the marble just rode one, in units of `lookCost` */
const SWITCHBACK_COST = 0.3;
const SWITCHBACK_IN_A_ROW_COST = 0.3;
/** Look of a tilt away from about 10°, in the same units per 10° */
const LOOK_TILT = 10 * DEGREE;

export interface TBuildCounts {
	next: number;
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
	laneId: string;
	hitId: string;
	/** Position among the lane's hits, from 0 */
	index: number;
	time: number;
	status: THitResult['status'];
}

export interface TBuildOutcome {
	project: TProject;
	result: TSimulationResult;
	/** Pieces the build added */
	added: number;
	/** The person's pieces it had to turn, by entity ID */
	turned: string[];
	/** How far it moved the releases, in metres; 0 when they stayed */
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
	laneId: string;
	hitId: string;
	type: string;
	entityId: string;
	range?: [number, number];
}

export interface TBuildGapRequest {
	type: TGapPieceType;
	project: TProject;
	laneId: string;
	fromHitId: string;
	toHitId: string;
	entityId: string;
}

export interface TBuildTrackDeps {
	simulate: (project: TProject) => Promise<TSimulationResult> | TSimulationResult;
	/** Rejects when no angle passes */
	autoPlace: (request: TBuildAutoPlaceRequest) => Promise<TAutoPlaceAnswer> | TAutoPlaceAnswer;
	/** Rejects when no piece fits */
	gapPiece: (request: TBuildGapRequest) => Promise<TGapAnswer> | TGapAnswer;
	continueRun: (request: { project: TProject; laneId: string; canTurn?: boolean }) => Promise<TContinueAnswer | null> | TContinueAnswer | null;
	/** Shows a step: the first starts the undo step, later ones join it. False stops the build. */
	commit?: (commands: TProjectCommand[], isFirst: boolean, hit: THitResult | null) => boolean;
	onProgress?: (progress: TBuildProgress) => void;
	onLog?: (line: string) => void;
	isCancelled?: () => boolean;
}

export type TBuildGapPreference = 'rail' | 'switchback' | 'chain';

export interface TBuildOptions {
	/**
	 * Rebuild From Here: everything up to this hit stays exactly as it is, on every marble and with the pieces this hit
	 * already has, and what plays after it is built again. Nothing kept is ever turned and no release moves.
	 */
	from?: { laneId: string; hitId: string };
	/** What is tried first across a long gap, the other when it doesn't fit: a straight rail unless asked otherwise; a Chain falls back to the Switchback layout */
	gapPiece?: TBuildGapPreference;
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
	/** Other lanes' hits the current hit's options left Blocked or Stopped */
	inTheWay: { laneId: string; hitId: string }[];
	/** Pieces there before the build, which backing up never takes away */
	own: Set<string>;
	/** Hits left without a piece, which every check looks past */
	skipped: Set<string>;
	/** Problems the run already had, which no step is judged by: the person's, and what a forced step left */
	tolerated: { hits: Set<string>; pieces: Set<string>; contacts: Set<string>; strikes: Set<string>; rolls: Set<string>; touching: Set<string> };
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
	return { next: 0, switchback: 0, chain: 0, rail: 0, continue: 0, continued: 0, mirror: 0, autoPlace: 0, launch: 0, wide: 0, lean: 0, backtrack: 0, unblock: 0, rewind: 0, frame: 0, failed: 0 };
}

function createState(deps: TBuildTrackDeps, project: TProject, canTurnOwn = true, gapPiece: TBuildGapPreference | null = null, searches: TSearchBudget = { used: 0, limit: Infinity }): TBuildState {
	return { deps, counts: emptyCounts(), reasons: [], inTheWay: [], own: new Set(project.entities.filter((entity) => entity.components.piece != null).map((entity) => entity.id)), skipped: new Set(), tolerated: { hits: new Set(), pieces: new Set(), contacts: new Set(), strikes: new Set(), rolls: new Set(), touching: new Set() }, canTurnOwn, gapPiece, isLooking: false, mayLeavePace: false, searches, runs: new WeakMap() };
}

const hitKey = (laneId: string, hitId: string): string => `${laneId}/${hitId}`;
const contactKey = (marble: string, other: string): string => `${marble}/${other}`;
const pairKey = (a: string, b: string): string => (a < b ? `${a}/${b}` : `${b}/${a}`);

/** A project is never changed once made, so one run answers for it */
function run(state: TBuildState, project: TProject): Promise<TSimulationResult> {
	let known = state.runs.get(project);
	if (known == null) {
		known = Promise.resolve(state.deps.simulate(project));
		state.runs.set(project, known);
	}
	return known;
}

function isCancelled(state: TBuildState): boolean {
	return state.deps.isCancelled?.() === true;
}

/** Whether the search budget is gone, which ends the searching but not the build */
function isSpent(state: TBuildState): boolean {
	return state.searches.used >= state.searches.limit;
}

function shouldStopLooking(state: TBuildState): boolean {
	return isCancelled(state) || isSpent(state);
}

function reject(state: TBuildState, reason: string): null {
	state.reasons.push(reason);
	return null;
}

function apply(current: TProject, commands: TProjectCommand[]): TProject | null {
	const [isAppliedOk, , applied] = applyProjectCommands(current, commands);
	return isAppliedOk ? applied : null;
}

function laneOfEntity(current: TProject, entityId: string): string | null {
	const entity = current.entities.find((item) => item.id === entityId);
	return entity?.components.hitLink?.laneId ?? entity?.components.marble?.laneId ?? null;
}

function marbleOfLane(current: TProject, laneId: string): string {
	return current.entities.find((entity) => entity.components.marble?.laneId === laneId)?.id ?? '';
}

function isShared(current: TProject): boolean {
	return current.entities.filter((entity) => entity.components.marble != null).length > 1;
}

function remainingHits(state: TBuildState, result: TSimulationResult): THitResult[] {
	return openHits(result).filter((hit) => !state.skipped.has(hitKey(hit.laneId, hit.hitId)));
}

function nextOpenPerLane(state: TBuildState, result: TSimulationResult): Map<string, THitResult> {
	const next = new Map<string, THitResult>();
	for (const hit of remainingHits(state, result)) if (!next.has(hit.laneId)) next.set(hit.laneId, hit);
	return next;
}

function isBeforeLongGap(current: TProject, hit: THitResult): boolean {
	return findLongGaps(current, hit.laneId).some((gap) => gap.toHitId === hit.hitId && gap.bridgedBy == null);
}

/** The interval to this hit equals the interval before, so a mirrored piece keeps the zigzag rhythm */
function repeatsInterval(current: TProject, laneId: string, hitId: string): boolean {
	const hits = current.music.lanes.find((lane) => lane.id === laneId)?.hits ?? [];
	const index = hits.findIndex((hit) => hit.id === hitId);
	const [a, b, c] = [hits[index - 2], hits[index - 1], hits[index]];
	if (a == null || b == null || c == null) return false;
	return Math.abs(c.time - b.time - (b.time - a.time)) < 0.015;
}

/** A new piece's ID follows from its hit, so a project always gets the same IDs */
function pieceId(current: TProject, hitId: string): string {
	return freeId(current, /^hit/.test(hitId) ? hitId.replace(/^hit/, 'piece') : `piece-${hitId}`);
}

function freeId(current: TProject, id: string): string {
	if (!current.entities.some((entity) => entity.id === id)) return id;
	let index = 2;
	while (current.entities.some((entity) => entity.id === `${id}-${index}`)) index++;
	return `${id}-${index}`;
}

function gapPieceId(state: TBuildState, current: TProject, type: TGapPieceType, laneId: string): string {
	const lane = current.music.lanes.findIndex((item) => item.id === laneId) + 1;
	return freeId(current, `${type}-${lane}-${state.counts.switchback + state.counts.chain + state.counts.rail + 1}`);
}

/**
 * Applies the commands when every hit with a piece stays on time afterwards (a resting first contact counts as
 * missed), in the lane being built and in the other lanes up to the other marbles' next open hits, no switchback,
 * rail or tunnel is blocked, each marble touches only its own pieces, every placed dot of the lane lies in its band,
 * and the lane's next open dot lies in its band and, with several marbles, within the pace limit of y* (or no further
 * than the target dot already was). Before a long gap the dot cannot do either until a gap piece exists.
 */
async function accept(state: TBuildState, current: TProject, commands: TProjectCommand[], laneId: string, checkFrame = true): Promise<TProject | null> {
	const applied = apply(current, commands);
	if (applied == null) return reject(state, 'commands do not apply');
	const result = await run(state, applied);
	const { tolerated } = state;
	// Each marble's path is final up to its next open hit; beyond that it is free flight that later pieces change,
	// and it may pass through or bump into what the other marble has built
	const frontier = new Map<string, number>();
	for (const hit of result.hits) {
		if (hit.status !== 'open' || state.skipped.has(hitKey(hit.laneId, hit.hitId))) continue;
		const marbleId = marbleOfLane(applied, hit.laneId);
		frontier.set(marbleId, Math.min(frontier.get(marbleId) ?? Infinity, hit.targetTime));
	}
	// Across a long gap that nothing bridges yet the marble falls freely until its switchback exists
	for (const lane of applied.music.lanes) {
		const marbleId = marbleOfLane(applied, lane.id);
		for (const gap of openLongGaps(applied, lane.id)) {
			if (!state.skipped.has(hitKey(lane.id, gap.toHitId))) frontier.set(marbleId, Math.min(frontier.get(marbleId) ?? Infinity, gap.from + 0.3));
		}
	}
	const othersFrontier = (lane: string): number =>
		Math.min(Infinity, ...applied.entities.filter((entity) => entity.components.marble != null && entity.components.marble.laneId !== lane).map((entity) => frontier.get(entity.id) ?? Infinity));
	// The lane being built keeps all its placed hits on time; another lane's hits only count up to where this lane's
	// path is final
	const late = result.hits.filter((hit) => hit.status !== 'open' && hit.status !== 'onTime' && !tolerated.hits.has(hitKey(hit.laneId, hit.hitId)) && (hit.laneId === laneId || hit.targetTime < othersFrontier(hit.laneId)));
	if (late.length > 0) {
		for (const hit of late) {
			const why = hit.reason ?? hit.status;
			if (why === 'blocked' || why === 'resting') state.inTheWay.push({ laneId: hit.laneId, hitId: hit.hitId });
		}
		return reject(state, `late ${late.map((hit) => `${hit.hitId}:${hit.reason ?? hit.status}`).join(' ')}`);
	}
	// A switchback, rail or tunnel the marble's run now passes through earlier is left out, like a blocked hit
	const blocked = result.pieces.filter((piece) => {
		const lane = laneOfEntity(applied, piece.entityId);
		const time = piece.entryTime ?? piece.hitTime ?? 0;
		return piece.status === 'blocked' && !tolerated.pieces.has(piece.entityId) && lane != null && (lane === laneId || time < othersFrontier(lane));
	});
	if (blocked.length > 0) return reject(state, `blocked ${blocked.map((piece) => piece.entityId).join(' ')}`);
	// Each marble may only touch its own lane's pieces and never the other marble; a free piece is the person's scenery
	const crossed = result.contacts.filter((contact) => {
		if (tolerated.contacts.has(contactKey(contact.marbleEntityId, contact.otherEntityId))) return false;
		const reach = Math.min(frontier.get(contact.marbleEntityId) ?? Infinity, contact.kind === 'marble' ? (frontier.get(contact.otherEntityId) ?? Infinity) : Infinity);
		if (contact.time >= reach) return false;
		if (contact.kind === 'marble') return true;
		const lane = laneOfEntity(applied, contact.otherEntityId);
		return contact.kind === 'piece' && lane != null && lane !== laneOfEntity(applied, contact.marbleEntityId);
	});
	if (crossed.length > 0) return reject(state, `crossing ${crossed.map((contact) => `${contact.marbleEntityId}/${contact.otherEntityId}`).join(' ')}`);
	// Every hit of the lane with a piece keeps its dot in frame; its own lane's centre is only Auto place's preference
	const band = frameBand(applied);
	const outside = result.hits.filter((hit) => hit.laneId === laneId && hit.pieceEntityId != null && hit.dot != null && !tolerated.hits.has(hitKey(hit.laneId, hit.hitId)) && !isInBand(hit.dot, band, 1));
	if (outside.length > 0) return reject(state, `outside the band ${outside.map((hit) => hit.hitId).join(' ')}`);
	// Each marble strikes each platform once, for its note, up to where its path is final
	const struck = extraStrikes(applied, result).filter((strike) => !tolerated.strikes.has(strike.entityId) && strike.time < (frontier.get(marbleOfLane(applied, strike.laneId)) ?? Infinity));
	if (struck.length > 0) return reject(state, `struck twice ${struck.map((strike) => strike.hitId).join(' ')}`);
	// And bounces off it, a platform not being for rolling
	const rolling = rollingHits(applied, result).filter((roll) => !tolerated.rolls.has(roll.entityId) && roll.time < (frontier.get(marbleOfLane(applied, roll.laneId)) ?? Infinity));
	if (rolling.length > 0) return reject(state, `rolls ${rolling.map((roll) => roll.hitId).join(' ')}`);
	// No two pieces touch on the wall
	const touching = touchingPairs(applied, result).filter((pair) => !tolerated.touching.has(pairKey(pair.a, pair.b)));
	if (touching.length > 0) return reject(state, `touching ${touching.map((pair) => `${pair.a}/${pair.b}`).join(' ')}`);
	if (!checkFrame) return applied;
	const next = nextOpenPerLane(state, result).get(laneId);
	if (next?.dot == null || isBeforeLongGap(applied, next)) return applied;
	// A tenth of a lane inside the frame's edge, as Auto place asks
	if (!isInBand(next.dot, band, 1 - (0.1 * frameBand(applied, laneId).halfWidth) / band.halfWidth)) return reject(state, `out of band ${next.hitId}@${next.dot.x.toFixed(2)}`);
	// A flat platform must still fit at the next dot, as Auto place checks for its own pieces
	const probe = createLinkedPiece('platform', laneId, next.hitId, 0, { id: 'accept-probe' });
	const probed = await state.deps.simulate({ ...applied, entities: [...applied.entities, probe], end: Math.min(applied.end, next.targetTime + 0.05) });
	if (probed.pieces.find((piece) => piece.entityId === probe.id)?.status === 'blocked') return reject(state, `no room at ${next.hitId}`);
	const pace = result.pace;
	if (pace != null && isShared(applied)) {
		const before = (await run(state, current)).hits.find((hit) => hit.laneId === laneId && hit.status === 'open' && hit.dot != null);
		if (before?.dot != null) {
			// Beyond the limit a dot may not get further from the pace than the one before it
			const allowed = Math.max(pace.limit, Math.abs(before.dot.y - paceAt(pace, before.targetTime)));
			const off = Math.abs(next.dot.y - paceAt(pace, next.targetTime));
			if (off > allowed) return reject(state, `off pace ${next.hitId} by ${off.toFixed(2)} m`);
		}
	}
	return applied;
}

/**
 * Whether the lane's next open dot still lands on the column opposite this one: a copied tilt keeps its shape only while
 * it does, and otherwise the small errors of each copy add up and the run wanders. Before a long gap any spot will do,
 * since a gap piece picks the marble up.
 */
function staysOnColumn(state: TBuildState, project: TProject, result: TSimulationResult, laneId: string): boolean {
	const next = nextOpenPerLane(state, result).get(laneId);
	if (next?.dot == null || isBeforeLongGap(project, next)) return true;
	const lane = project.music.lanes.find((item) => item.id === laneId);
	const previous = lane?.hits[(lane.hits.findIndex((hit) => hit.id === next.hitId) ?? 0) - 1];
	const from = result.hits.find((hit) => hit.laneId === laneId && hit.hitId === previous?.id)?.dot;
	if (from == null) return true;
	const band = frameBand(project, laneId);
	const length = PLACEMENT_LENGTH;
	const column = band.centerX - Math.sign(from.x - band.centerX) * columnOffset(length);
	return Math.abs(next.dot.x - column) <= COLUMN_TOLERANCE * length;
}

/**
 * How regular the lane's last hits look, lower is better, per hit: how far its dot lies from a column, in piece lengths,
 * how far its drop lies from the pace's for its interval, and how far its tilt lies from about 10°
 */
function lookCost(project: TProject, result: TSimulationResult, laneId: string): number {
	const band = frameBand(project, laneId);
	const length = PLACEMENT_LENGTH;
	const played = result.hits.filter((hit) => hit.laneId === laneId && hit.pieceEntityId != null && hit.dot != null).sort((a, b) => a.targetTime - b.targetTime).slice(-1 - LOOK_AHEAD_HITS);
	let cost = 0;
	played.forEach((hit, index) => {
		const before = played[index - 1];
		const angle = project.entities.find((entity) => entity.id === hit.pieceEntityId)?.components.hitLink?.angle ?? 0;
		cost += Math.abs(Math.abs((hit.dot?.x ?? 0) - band.centerX) - columnOffset(length)) / length + Math.abs(Math.abs(angle) - LOOK_TILT) / LOOK_TILT;
		if (before?.dot != null && hit.dot != null && result.pace != null) cost += Math.abs(before.dot.y - hit.dot.y - result.pace.rate * (hit.targetTime - before.targetTime)) / length;
	});
	return cost / Math.max(1, played.length);
}

/** Builds on from a candidate for a few hits, first choice each time, and says how that went; the build's counts stay as they were */
async function lookAhead(state: TBuildState, start: TProject, laneId: string): Promise<number> {
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
	return cost + lookCost(current, await run(state, current), laneId);
}

/** The option that looks and goes on best over the next few hits, the first of equals */
async function chooseAhead<T extends { project: TProject; cost?: number; label: string }>(state: TBuildState, options: T[], laneId: string): Promise<T | null> {
	let best: T | null = null;
	let bestCost = Infinity;
	for (const option of options) {
		if (shouldStopLooking(state)) return best ?? options[0] ?? null;
		const cost = (option.cost ?? 0) + (await lookAhead(state, option.project, laneId));
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
 * One option after another for the hit: a rail, or a switchback, when a long gap ends at it, otherwise Continue, then
 * Mirror when the rhythm repeats, then Auto place (which launches the marble into the coming gap piece before a long
 * gap), then Auto place over a wider range. Each must pass `accept`; the first that does wins, except that a rail and a
 * switchback that both pass are each built on for a few hits (`chooseAhead`), since a rail that reads well can leave the
 * marble nowhere to go. With `canLean`, last the platform is leaned by hand until the next dot comes back as close to the
 * marble's band as it gets.
 */
async function buildStep(state: TBuildState, current: TProject, target: THitResult, canLean: boolean): Promise<TProject | null> {
	const { deps, counts } = state;
	const { laneId, hitId } = target;
	const result = await run(state, current);
	const gap = findLongGaps(current, laneId).find((item) => item.toHitId === hitId && item.bridgedBy == null);
	if (gap != null) {
		const options: { project: TProject; type: TGapPieceType; cost: number; log: string; label: string }[] = [];
		const rodeSwitchback = current.entities.filter((entity) => entity.components.hitLink?.laneId === laneId && entity.components.piece != null && entity.components.piece.type !== 'platform' && !state.own.has(entity.id)).at(-1)?.components.piece?.layout === 'switchback';
		for (const type of gapPieceOrder(state.gapPiece)) {
			if (isCancelled(state)) return null;
			const entityId = gapPieceId(state, current, type, laneId);
			const answer = await ask(state, 'gapPiece', () => deps.gapPiece({ type, project: current, laneId, fromHitId: gap.fromHitId, toHitId: gap.toHitId, entityId }));
			// A piece that ends far from the pace or the lane leaves the gap to the other, which has to do
			if (type !== gapPieceOrder(state.gapPiece).at(-1) && answer?.check != null && !gapPieceReads(answer.check, result.pace?.limit ?? Infinity)) {
				reject(state, `the ${type} ends ${Math.abs(answer.check.paceError ?? 0).toFixed(2)} m from the pace`);
				continue;
			}
			if (!state.mayLeavePace && Math.abs(answer?.check?.paceError ?? 0) > (result.pace?.limit ?? Infinity)) {
				reject(state, `the ${type} ends ${Math.abs(answer?.check?.paceError ?? 0).toFixed(2)} m from the pace`);
				continue;
			}
			// The hit after the gap piece is placed by construction wherever the marble arrives
			const accepted = answer != null ? await accept(state, current, answer.commands, laneId, false) : null;
			if (accepted == null) continue;
			const params = answer?.entity.components.piece?.params ?? {};
			const pace = answer?.check?.paceError;
			const log = `  ${gap.fromHitId} -> ${gap.toHitId}: ${type} over ${gap.duration.toFixed(2)} s${type === 'switchback' || type === 'chain' ? ` (${params['turns']} turns at ${(Math.abs(answer?.entity.components.hitLink?.angle ?? 0) / DEGREE).toFixed(0)}°)` : ''}, next dot ${pace != null ? `${pace.toFixed(2)} m from y*` : 'without pace'}`;
			const isAsked = state.gapPiece === type;
			options.push({ project: accepted, type, log, label: type, cost: isAsked || (type !== 'switchback') ? 0 : SWITCHBACK_COST + (rodeSwitchback ? SWITCHBACK_IN_A_ROW_COST : 0) });
			// Asked for by name, or trying ahead already: the first that fits
			if (isAsked || state.isLooking) break;
		}
		const chosen = options.length > 1 ? await chooseAhead(state, options, laneId) : options[0];
		if (chosen != null) {
			counts[chosen.type === 'switchback' || chosen.type === 'chain' ? chosen.type : 'rail']++;
			deps.onLog?.(chosen.log);
			return chosen.project;
		}
		deps.onLog?.(`  ${gap.fromHitId} -> ${gap.toHitId}: no gap piece fits the ${gap.duration.toFixed(2)} s gap (${state.reasons.at(-1) ?? ''})`);
	}
	if (isCancelled(state)) return null;

	const isLaunch = findLongGaps(current, laneId).some((item) => item.fromHitId === hitId && item.bridgedBy == null);
	const continued = !isLaunch ? await ask(state, 'continue', () => deps.continueRun({ project: current, laneId, canTurn: false })) : null;
	// Ghosts get the build's IDs, so the track is the same on every run
	const taken = new Set<string>();
	const ghosts: TProjectCommand[] = (continued?.commands ?? []).map((command) => {
		const link = command.type === 'upsertEntity' ? command.entity.components.hitLink : undefined;
		if (command.type !== 'upsertEntity' || link == null) return command;
		const id = pieceId(current, link.hitId);
		taken.add(id);
		return { ...command, entity: { ...command.entity, id } };
	});
	if (ghosts.length > 0) {
		const accepted = await accept(state, current, ghosts, laneId);
		if (accepted != null && staysOnColumn(state, accepted, await run(state, accepted), laneId)) {
			counts.continue++;
			counts.continued += ghosts.length;
			return accepted;
		}
	}

	const lane = current.music.lanes.find((item) => item.id === laneId);
	const hits = lane?.hits ?? [];
	const isLast = hits.at(-1)?.id === hitId;
	// Like Continue, Mirror leaves the hit ahead of a launch to Auto place, which checks the launch is struck firmly
	const following = hits[hits.findIndex((hit) => hit.id === hitId) + 1];
	const isBeforeLaunch = following != null && findLongGaps(current, laneId).some((item) => item.fromHitId === following.id);
	const id = pieceId(current, hitId);
	if (!isLaunch && !isLast && !isBeforeLaunch && repeatsInterval(current, laneId, hitId)) {
		const [isMirrorOk, , mirrored] = mirrorPiece(current, result, laneId, { id });
		const accepted = isMirrorOk && mirrored.hitId === hitId ? await accept(state, current, mirrored.commands, laneId) : null;
		if (accepted != null && staysOnColumn(state, accepted, await run(state, accepted), laneId)) {
			counts.mirror++;
			return accepted;
		}
	}
	if (isCancelled(state)) return null;

	const placed = await ask(state, 'autoPlace', () => deps.autoPlace({ project: current, laneId, hitId, type: 'platform', entityId: id }));
	const accepted = placed != null ? await accept(state, current, [{ type: 'upsertEntity', entity: placed.entity }], laneId) : null;
	if (accepted != null) {
		if (isLaunch) counts.launch++;
		else counts.autoPlace++;
		return accepted;
	}
	if (isCancelled(state)) return null;
	// What a person tries next: turning further than Auto place searches. A search that found nothing already tried these.
	if (placed != null) {
		const wide = await ask(state, 'wide autoPlace', () => deps.autoPlace({ project: current, laneId, hitId, type: 'platform', entityId: id, range: [-60 * DEGREE, 60 * DEGREE] }));
		const widened = wide != null ? await accept(state, current, [{ type: 'upsertEntity', entity: wide.entity }], laneId) : null;
		if (widened != null) {
			counts.wide++;
			return widened;
		}
	}
	if (!canLean) return null;
	const band = frameBand(current, laneId);
	let best: { project: TProject; angle: number; offset: number } | null = null;
	for (let degrees = -24; degrees <= 24; degrees += 3) {
		if (isCancelled(state)) return null;
		const entity = createLinkedPiece('platform', laneId, hitId, degrees * DEGREE, { id, entities: current.entities });
		const leaned = await accept(state, current, [{ type: 'upsertEntity', entity }], laneId, false);
		if (leaned == null) continue;
		const dot = nextOpenPerLane(state, await run(state, leaned)).get(laneId)?.dot;
		const offset = dot == null ? 0 : Math.abs(dot.x - band.centerX);
		// A lean that throws the marble out of its lane only moves the trouble: it lands among the other marble's pieces
		if (offset > band.halfWidth) continue;
		if (best == null || offset < best.offset - 1e-6) best = { project: leaned, angle: degrees, offset };
	}
	if (best == null) return null;
	counts.lean++;
	deps.onLog?.(`  ${hitId}: rotated by hand to ${best.angle}°, next dot ${best.offset.toFixed(2)} m from its band centre (${state.reasons.at(-1) ?? ''})`);
	return best.project;
}

/** The lane's previous platform turned a little so the marble arrives differently, then the step again */
async function backtrack(state: TBuildState, current: TProject, target: THitResult, canTurnOwn = false): Promise<TProject | null> {
	const lane = current.music.lanes.find((item) => item.id === target.laneId);
	const index = lane?.hits.findIndex((hit) => hit.id === target.hitId) ?? -1;
	const previousHit = lane?.hits[index - 1];
	const previous = current.entities.find((entity) => entity.components.hitLink?.hitId === previousHit?.id && entity.components.piece?.type === 'platform');
	const angle = previous?.components.hitLink?.angle;
	if (previous == null || angle == null || (state.own.has(previous.id) && !canTurnOwn)) return null;
	for (const delta of PREVIOUS_TURNS) {
		if (shouldStopLooking(state)) return null;
		const rotated = structuredClone(previous);
		if (rotated.components.hitLink != null) rotated.components.hitLink.angle = angle + delta * DEGREE;
		const turned = await accept(state, current, [{ type: 'upsertEntity', entity: rotated }], target.laneId, false);
		if (turned == null) continue;
		const moved = (await run(state, turned)).hits.find((hit) => hit.laneId === target.laneId && hit.hitId === target.hitId);
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
		const key = hitKey(hit.laneId, hit.hitId);
		if (hit.laneId === target.laneId || seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	for (const other of others) {
		const piece = current.entities.find((entity) => entity.components.hitLink?.hitId === other.hitId && entity.components.piece?.type === 'platform');
		const angle = piece?.components.hitLink?.angle;
		if (piece == null || angle == null || (state.own.has(piece.id) && !canTurnOwn)) continue;
		for (const delta of OTHER_TURNS) {
			if (shouldStopLooking(state)) return null;
			const rotated = structuredClone(piece);
			if (rotated.components.hitLink != null) rotated.components.hitLink.angle = angle + delta * DEGREE;
			const turned = apply(current, [{ type: 'upsertEntity', entity: rotated }]);
			if (turned == null) continue;
			const result = await run(state, turned);
			if (result.hits.some((hit) => hit.status !== 'open' && hit.status !== 'onTime' && hit.targetTime <= target.targetTime && !state.tolerated.hits.has(hitKey(hit.laneId, hit.hitId)))) continue;
			const moved = result.hits.find((hit) => hit.laneId === target.laneId && hit.hitId === target.hitId);
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
 * Backs up a few hits on the lane: the platform there is turned a little, the pieces the build placed after it go, and
 * the lane is built forward again up to the stuck hit. Pieces that were there before the build stop it going further back.
 */
async function rewind(state: TBuildState, current: TProject, target: THitResult): Promise<TProject | null> {
	const hits = current.music.lanes.find((lane) => lane.id === target.laneId)?.hits ?? [];
	const index = hits.findIndex((hit) => hit.id === target.hitId);
	for (const depth of REWIND_DEPTHS) {
		const from = hits[index - depth];
		const pivot = current.entities.find((entity) => entity.components.hitLink?.hitId === from?.id && entity.components.piece?.type === 'platform');
		const angle = pivot?.components.hitLink?.angle;
		if (from == null || pivot == null || angle == null || state.own.has(pivot.id)) continue;
		const after = new Set(hits.slice(index - depth + 1, index).map((hit) => hit.id));
		const dropped = current.entities.filter((entity) => {
			const link = entity.components.hitLink;
			if (link?.laneId !== target.laneId || entity.components.piece == null) return false;
			// A gap piece hangs on the hit before its gap, so the one on the turned platform goes as well
			return after.has(link.hitId) || (link.hitId === from.id && entity.id !== pivot.id);
		});
		if (dropped.some((entity) => state.own.has(entity.id))) continue;
		for (const delta of REWIND_TURNS) {
			if (shouldStopLooking(state)) return null;
			const rotated = structuredClone(pivot);
			if (rotated.components.hitLink != null) rotated.components.hitLink.angle = angle + delta * DEGREE;
			let next = await accept(state, current, [...(dropped.length > 0 ? [{ type: 'removeEntities' as const, entityIds: dropped.map((entity) => entity.id) }] : []), { type: 'upsertEntity', entity: rotated }], target.laneId, false);
			for (let step = 0; next != null && step < depth * 2 + 2; step++) {
				const project: TProject = next;
				const result = await run(state, project);
				const open = result.hits.filter((hit) => hit.laneId === target.laneId && hit.status === 'open').sort((a, b) => a.targetTime - b.targetTime)[0];
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
	if (!findLongGaps(current, target.laneId).some((gap) => gap.toHitId === target.hitId && gap.bridgedBy == null)) return null;
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
	const key = hitKey(target.laneId, target.hitId);
	state.counts.failed++;
	if (target.dot != null) {
		const id = pieceId(current, target.hitId);
		const band = frameBand(current, target.laneId);
		// Of the leans that play it, the one whose next dot stays nearest the lane, or a forced run wanders off in a long diagonal
		let best: { project: TProject; degrees: number; offset: number } | null = null;
		for (const degrees of LEANS) {
			if (isCancelled(state)) break;
			const entity = createLinkedPiece('platform', target.laneId, target.hitId, degrees * DEGREE, { id, entities: current.entities });
			const placed = apply(current, [{ type: 'upsertEntity', entity }]);
			if (placed == null) continue;
			const result = await run(state, placed);
			const status = result.hits.find((hit) => hit.laneId === target.laneId && hit.hitId === target.hitId)?.status;
			if (status !== 'onTime' && status !== 'drifting') continue;
			const dot = nextOpenPerLane(state, result).get(target.laneId)?.dot;
			const offset = dot != null ? Math.abs(dot.x - band.centerX) : 0;
			if (best == null || offset < best.offset - 1e-6) best = { project: placed, degrees, offset };
			if (offset <= band.halfWidth / 2) break;
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
	const result = await run(state, project);
	for (const hit of result.hits) if (hit.status !== 'open' && hit.status !== 'onTime') state.tolerated.hits.add(hitKey(hit.laneId, hit.hitId));
	for (const piece of result.pieces) if (piece.status === 'blocked') state.tolerated.pieces.add(piece.entityId);
	for (const contact of result.contacts) {
		const lane = laneOfEntity(project, contact.otherEntityId);
		if (contact.kind === 'marble' || (lane != null && lane !== laneOfEntity(project, contact.marbleEntityId))) state.tolerated.contacts.add(contactKey(contact.marbleEntityId, contact.otherEntityId));
	}
	const band = frameBand(project);
	for (const hit of result.hits) if (hit.pieceEntityId != null && hit.dot != null && !isInBand(hit.dot, band, 1)) state.tolerated.hits.add(hitKey(hit.laneId, hit.hitId));
	for (const strike of extraStrikes(project, result)) state.tolerated.strikes.add(strike.entityId);
	for (const roll of rollingHits(project, result)) state.tolerated.rolls.add(roll.entityId);
	for (const pair of touchingPairs(project, result)) state.tolerated.touching.add(pairKey(pair.a, pair.b));
}

/**
 * The hit a step works on: the earliest open hit of any marble, or an earlier long gap after a marble's last piece,
 * across which it may have fallen too far to leave a dot. A hit no platform can ever reach is set aside.
 */
function nextTarget(state: TBuildState, current: TProject, result: TSimulationResult): THitResult | null {
	for (;;) {
		const open = remainingHits(state, result)[0];
		const gap = current.music.lanes
			.flatMap((lane) => openLongGaps(current, lane.id))
			.filter((item) => !state.skipped.has(hitKey(item.laneId, item.toHitId)))
			.sort((a, b) => a.to - b.to)[0];
		const atGap = gap != null && (open == null || gap.to <= open.targetTime + 1e-9) ? result.hits.find((hit) => hit.laneId === gap.laneId && hit.hitId === gap.toHitId) : undefined;
		if (atGap != null) return atGap;
		if (open == null) return null;
		// Only what no earlier piece changes is set aside: a note too soon after the release, a lane without a marble
		const reach = hitReach(current, result, open).kind;
		if (reach !== 'tooSoon' && reach !== 'noMarble') return open;
		state.skipped.add(hitKey(open.laneId, open.hitId));
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
function framingTrouble(project: TProject, result: TSimulationResult, until = Infinity): { laneId: string; from: number } | null {
	const stretches = checkFraming(project, { ...result, revision: project.revision })?.stretches ?? [];
	return stretches.find((stretch) => stretch.to < until) ?? null;
}

/** Time up to which every marble's run is built, with a hit that has no piece yet as its end */
function builtUntil(state: TBuildState, result: TSimulationResult): number {
	return (remainingHits(state, result)[0]?.targetTime ?? Infinity) - CAMERA_SETTLE;
}

/** The first dot further from the shared pace than `keepsPace` allows, when the run does not keep it */
function paceTrouble(project: TProject, result: TSimulationResult): { laneId: string; from: number } | null {
	const pace = result.pace;
	if (pace == null || keepsPace(project, result)) return null;
	const off = result.hits.filter((hit) => Math.abs((hit.dot?.y ?? Infinity) - paceAt(pace, hit.targetTime)) > pace.limit).sort((a, b) => a.targetTime - b.targetTime)[0];
	return off != null ? { laneId: off.laneId, from: off.targetTime } : null;
}

function lanesWithHits(project: TProject): string[] {
	return project.music.lanes.filter((lane) => lane.hits.length > 0).map((lane) => lane.id);
}

/** A marble no Bowl could catch: its last platforms go another way, so its fall ends somewhere a Bowl fits */
function bowlTrouble(project: TProject): { laneId: string; from: number } | null {
	const lane = project.music.lanes.find((item) => item.hits.length > 0 && bowlOfLane(project, item.id) == null);
	return lane != null ? { laneId: lane.id, from: lane.hits.at(-1)?.time ?? 0 } : null;
}

/** The commands that turn `from` into `to`: pieces and marbles changed, added and removed, the length and the camera */
function diffCommands(from: TProject, to: TProject): TProjectCommand[] {
	const commands: TProjectCommand[] = [];
	const known = new Map(from.entities.map((entity) => [entity.id, entity]));
	const kept = new Set(to.entities.map((entity) => entity.id));
	const gone = from.entities.filter((entity) => !kept.has(entity.id)).map((entity) => entity.id);
	if (gone.length > 0) commands.push({ type: 'removeEntities', entityIds: gone });
	for (const entity of to.entities) {
		const before = known.get(entity.id);
		if (before !== entity && JSON.stringify(before) !== JSON.stringify(entity)) commands.push({ type: 'upsertEntity', entity });
	}
	if (from.end !== to.end) commands.push({ type: 'setEnd', end: to.end });
	if (from.design !== to.design && JSON.stringify(from.design) !== JSON.stringify(to.design)) commands.push({ type: 'setDesign', design: to.design });
	return commands;
}

/** The project with the releases of the marbles whose lanes have no pieces moved sideways */
function withReleaseShift(project: TProject, shift: number, bareLanes: Set<string>): TProject {
	if (shift === 0) return project;
	return {
		...project,
		entities: project.entities.map((entity) => {
			const { marble, release, transform } = entity.components;
			const moved = (x: number): number => Math.round((x + shift) * 1e4) / 1e4;
			// A marble's start rail goes with it
			if (transform != null && [...bareLanes].some((laneId) => startRailId(laneId) === entity.id)) return { ...entity, components: { ...entity.components, transform: { ...transform, position: { x: moved(transform.position.x), y: transform.position.y } } } };
			if (marble == null || release == null || !bareLanes.has(marble.laneId)) return entity;
			return { ...entity, components: { ...entity.components, release: { ...release, position: { x: moved(release.position.x), y: release.position.y } } } };
		})
	};
}

function attentionOf(project: TProject, result: TSimulationResult): TBuildAttention[] {
	return result.hits
		.filter((hit) => hit.status !== 'onTime' && hit.status !== 'drifting')
		.sort((a, b) => a.targetTime - b.targetTime)
		.map((hit) => ({
			laneId: hit.laneId,
			hitId: hit.hitId,
			index: project.music.lanes.find((lane) => lane.id === hit.laneId)?.hits.findIndex((item) => item.id === hit.hitId) ?? 0,
			time: hit.targetTime,
			status: hit.status
		}));
}

/**
 * The project without what Rebuild From Here builds again: platforms, switchbacks, rails, tunnels and Bowls that belong
 * to later hits on any marble. A gap piece hangs on the hit before its gap, so one reaching past `from` goes with them,
 * and the marbles are built together, so every marble is cut at the same time. Scenery a person tied to a marble stays.
 */
export function withoutPiecesAfter(project: TProject, from: { laneId: string; hitId: string }): TProject {
	const time = project.music.lanes.find((lane) => lane.id === from.laneId)?.hits.find((hit) => hit.id === from.hitId)?.time;
	if (time == null) return project;
	const nextOf = new Map<string, number>();
	const timeOf = new Map<string, number>();
	for (const lane of project.music.lanes) {
		lane.hits.forEach((hit, index) => {
			timeOf.set(`${lane.id}/${hit.id}`, hit.time);
			nextOf.set(`${lane.id}/${hit.id}`, lane.hits[index + 1]?.time ?? Infinity);
		});
	}
	const isRebuilt = (entity: TEntity): boolean => {
		const { piece, hitLink } = entity.components;
		if (piece == null || hitLink == null) return false;
		const key = `${hitLink.laneId}/${hitLink.hitId}`;
		if (piece.type === BOWL_TYPE) return (timeOf.get(key) ?? Infinity) > time - 1e-9 || (nextOf.get(key) ?? Infinity) > time;
		if (isGapPiece(piece.type)) return (nextOf.get(key) ?? Infinity) > time + 1e-9;
		return isMusicalPiece(piece.type) && (timeOf.get(key) ?? Infinity) > time + 1e-9;
	};
	return { ...project, entities: project.entities.filter((entity) => !isRebuilt(entity)) };
}

function isGapPiece(type: string): boolean {
	return type === 'rail' || type === 'tunnel';
}

/** `built` with each new platform in the skin of the piece that played its note in `was` */
function withSkinsOf(was: TProject, built: TProject): TProject {
	const skins = new Map<string, NonNullable<TEntity['components']['skin']>>();
	for (const entity of was.entities) {
		const { hitLink, skin, piece } = entity.components;
		if (hitLink != null && skin != null && piece != null) skins.set(`${piece.type}/${hitLink.laneId}/${hitLink.hitId}`, skin);
	}
	if (skins.size === 0) return built;
	return {
		...built,
		entities: built.entities.map((entity) => {
			const { hitLink, skin, piece } = entity.components;
			const wanted = hitLink != null && piece != null ? skins.get(`${piece.type}/${hitLink.laneId}/${hitLink.hitId}`) : undefined;
			return wanted != null && skin == null ? { ...entity, components: { ...entity.components, skin: wanted } } : entity;
		})
	};
}

/** One step of the build for the hit next in time, as Next's answer to a gap it cannot bridge. Null when nothing works. */
export async function buildOneStep(project: TProject, deps: TBuildTrackDeps): Promise<{ project: TProject; commands: TProjectCommand[]; target: THitResult } | null> {
	const state = createState(deps, project);
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
	const { from, gapPiece = null } = options;
	// What Rebuild From Here keeps; the first commit takes the rest away, so it all stays one undo step
	const project = from != null ? withoutPiecesAfter(whole, from) : whole;
	const people = new Map(project.entities.filter((entity) => entity.components.piece != null).map((entity) => [entity.id, JSON.stringify({ link: entity.components.hitLink, piece: entity.components.piece })]));
	const build = createBuildRun(whole, project, deps, gapPiece, from);
	const best = await bestAttempt(build);
	if (best == null) throw new Error('Build Track started no attempt');
	let current = await goOnPastStuck(build, best);

	// Each marble ends in a Bowl after its last note, and the film length follows
	const bowls: string[] = [];
	if (!build.isStopped && !isCancelled(best.state)) {
		const finished = best.finished ?? (await withBowls(current, { simulate: (next) => deps.simulate(next), isCancelled: deps.isCancelled }, { lanes: lanesWithHits(current) }));
		bowls.push(...finished.messages);
		if (isCancelled(best.state)) build.isStopped = true;
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
	deps.onProgress?.({ done: result.hits.filter((hit) => hit.pieceEntityId != null && hit.status === 'onTime').length, total: build.total, at: build.lastTime, fraction: 1, restarts: build.restarts });
	return {
		project: current,
		result,
		added: current.entities.filter((entity: TEntity) => entity.components.piece != null && !people.has(entity.id)).length,
		turned: [...people].filter(([id, was]) => {
			const entity = current.entities.find((item) => item.id === id);
			return entity != null && JSON.stringify({ link: entity.components.hitLink, piece: entity.components.piece }) !== was;
		}).map(([id]) => id),
		releaseShift: best.shift,
		attention: attentionOf(current, result),
		bowls,
		counts: build.counts,
		attempts: build.attempts,
		isStopped: build.isStopped
	};
}

/** One Build Track, through all its attempts: what it builds, what the window shows of it and how far it got */
interface TBuildRun {
	deps: TBuildTrackDeps;
	project: TProject;
	gapPiece: TBuildOptions['gapPiece'] | null;
	canTurnOwn: boolean;
	/** Marbles without pieces, whose releases may move */
	bareLanes: Set<string>;
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
	const total = project.music.lanes.reduce((sum, lane) => sum + lane.hits.length, 0);
	const allTimes = project.music.lanes.flatMap((lane) => lane.hits.map((hit) => hit.time));
	const fromTime = from != null ? (whole.music.lanes.find((lane) => lane.id === from.laneId)?.hits.find((hit) => hit.id === from.hitId)?.time ?? -Infinity) : -Infinity;
	// The budget is per hit that gets built, so a rebuild of the last hits doesn't search as long as a whole song
	const rest = allTimes.filter((time) => time > fromTime).length;
	return {
		deps,
		project,
		gapPiece,
		canTurnOwn: from == null,
		bareLanes: new Set(from != null ? [] : project.music.lanes.filter((lane) => !project.entities.some((entity) => entity.components.hitLink?.laneId === lane.id)).map((lane) => lane.id)),
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
	const done = result.hits.filter((hit) => hit.pieceEntityId != null && hit.status === 'onTime').length;
	const span = lastTime - firstTime;
	build.furthest = Math.max(build.furthest, span > 0 ? Math.min(1, Math.max(0, (at - firstTime) / span)) : 1);
	build.deps.onProgress?.({ done, total, at, fraction: build.furthest, restarts });
}

function addCounts(counts: TBuildCounts, from: TBuildCounts): void {
	for (const key of Object.keys(counts) as (keyof TBuildCounts)[]) counts[key] += from[key];
}

/** Tries the releases in turn until one gets through; the attempt that got furthest, or null when none started */
async function bestAttempt(build: TBuildRun): Promise<TBestAttempt | null> {
	const { deps, project, bareLanes, searches, canTurnOwn, gapPiece } = build;
	const variants = bareLanes.size > 0 ? RELEASE_SHIFTS : build.isRebuild ? REBUILD_TURNS : [0];
	let best: TBestAttempt | null = null;
	for (const variant of variants) {
		if (build.attempts > 0 && searches.used >= searches.limit) break;
		build.attempts++;
		const shift = build.isRebuild ? 0 : variant;
		build.firstTurn = build.isRebuild ? variant : 0;
		const budget = searches.limit;
		searches.limit = Math.min(budget, searches.used + ATTEMPT_SEARCHES_PER_HIT * build.rest);
		const start = withStartRails(withReleaseShift(project, shift, bareLanes), bareLanes);
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
		return attempted.project.end;
	}
	if (framingTrouble(attempted.project, finished) != null) {
		state.deps.onLog?.('  the camera loses a marble, so the build counts as stopped at the end');
		return attempted.project.end;
	}
	return Infinity;
}

/** The attempt that got furthest goes on past what stopped it; the project it ends with */
async function goOnPastStuck(build: TBuildRun, best: TBestAttempt): Promise<TProject> {
	const { project, deps, searches, rest: restHits, counts } = build;
	const { state } = best;
	if (build.isStopped) return best.project;
	if (!publish(build, best.project, null)) build.isStopped = true;
	if (build.isStopped || best.reached === Infinity || best.reached >= project.end) return best.project;
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
async function backUp(build: TBuildRun, state: TBuildState, progress: TAttemptProgress, trouble: { laneId: string; from: number }): Promise<boolean> {
	if (progress.backUps >= MAX_BACK_UPS || isSpent(state)) return false;
	progress.backUps++;
	const { history, tried } = progress;
	let before = history.length - 1;
	while (before > 0 && (history[before]?.time ?? -Infinity) >= trouble.from - FRAME_BACKUP) before--;
	const base = history[Math.max(0, before)]?.project;
	if (base == null) return false;
	const hits = base.music.lanes.find((lane) => lane.id === trouble.laneId)?.hits ?? [];
	const owned = base.entities.filter((entity) => entity.components.hitLink?.laneId === trouble.laneId && entity.components.piece?.type === 'platform' && !state.own.has(entity.id));
	const pivot = owned.map((entity) => ({ entity, time: hits.find((hit) => hit.id === entity.components.hitLink?.hitId)?.time ?? -Infinity })).sort((a, b) => b.time - a.time)[0]?.entity;
	const angle = pivot?.components.hitLink?.angle;
	if (pivot == null || angle == null) return false;
	for (const delta of FRAME_TURNS) {
		if (tried.has(`${pivot.id}/${delta}`)) continue;
		tried.add(`${pivot.id}/${delta}`);
		const rotated = structuredClone(pivot);
		if (rotated.components.hitLink != null) rotated.components.hitLink.angle = angle + delta * DEGREE;
		const turned = await accept(state, base, [{ type: 'upsertEntity', entity: rotated }], trouble.laneId, false);
		if (turned == null) continue;
		build.deps.onLog?.(`  backing up from ${trouble.from.toFixed(2)} s on ${trouble.laneId}: ${pivot.id} turns by ${delta}° and the build goes on from there`);
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
	const platform = project.entities.find((entity) => entity.components.hitLink?.laneId === target.laneId && entity.components.hitLink.hitId === target.hitId && entity.components.piece?.type === 'platform');
	if (platform?.components.hitLink == null) return project;
	const rotated = structuredClone(platform);
	if (rotated.components.hitLink != null) rotated.components.hitLink.angle += degrees * DEGREE;
	return (await accept(state, project, [{ type: 'upsertEntity', entity: rotated }], target.laneId, false)) ?? project;
}

/**
 * Steps through the song from `start`. Without `canForce` it ends at the first hit nothing solves; with it, that
 * hit is left for Fix and the rest gets built.
 */
async function attemptBuild(build: TBuildRun, state: TBuildState, start: TProject, canForce: boolean): Promise<TAttempt> {
	const { deps, total, firstTime } = build;
	const progress: TAttemptProgress = { current: start, history: [{ project: start, time: -Infinity }], nextFrameCheck: firstTime + FRAME_CHECK_EVERY, tried: new Set(), backUps: 0 };
	const turnedLanes = new Set<string>();
	const stopped = (): TAttempt => {
		build.isStopped = true;
		return { project: progress.current, reached: -Infinity };
	};
	/** Backs up for `trouble` and shows the result; true when the build goes on from there */
	const wentBack = async (trouble: { laneId: string; from: number }): Promise<boolean> => {
		if (!(await backUp(build, state, progress, trouble))) return false;
		if (!publish(build, progress.current, null)) build.isStopped = true;
		return true;
	};
	for (let step = 0; step < total * 8 + 16; step++) {
		if (isCancelled(state)) return stopped();
		const { current } = progress;
		const result = await run(state, current);
		const target = nextTarget(state, current, result);
		if (target == null) {
			// The whole run is built, so the camera's answer, the pace and the Bowls are final
			const finished = await withBowls(current, { simulate: (next) => deps.simulate(next), isCancelled: deps.isCancelled }, { lanes: lanesWithHits(current) });
			if (isCancelled(state)) return stopped();
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
		if (isCancelled(state)) return stopped();
		if (next == null && !canForce) {
			deps.onLog?.(`  ${target.hitId}: nothing solves it at ${target.targetTime.toFixed(2)} s (${state.reasons.join('; ') || 'no assist found a piece'})`);
			// With another release to try, that comes cheaper than backing up: a song's first hits take few searches, a stuck hit dozens
			if (build.bareLanes.size === 0 && !build.isRebuild && (await wentBack({ laneId: target.laneId, from: target.targetTime - progress.backUps * STUCK_REACH }))) continue;
			return { project: current, reached: target.targetTime };
		}
		const played = next != null && build.firstTurn !== 0 && !turnedLanes.has(target.laneId) ? await turned(state, next, target, build.firstTurn) : next;
		if (next != null) turnedLanes.add(target.laneId);
		progress.current = played ?? (await forceHit(state, current, target));
		progress.history.push({ project: progress.current, time: target.targetTime });
		if (!publish(build, progress.current, target)) return stopped();
	}
	return { project: progress.current, reached: Infinity };
}
