import { Err, Ok, type TResult } from 'tuple-result';
import { createId, type TPiece, type TProject, type TProjectCommand, type TVec2, tieOf } from '@/modules/project';
import { crossesOtherMarbles, findHitResult, hitOwners, isInBand, openFrontiers, simulateTrial, withPieces, type TSimulateFn } from './assists';
import { gravityOf } from './geometry';
import { descentPace, paceAt } from './pace';
import { chainGeometry, chainHoldTime, layoutOf, switchbackGeometry, switchbackHoldTime } from './piece-layout';
import { getPieceDefinition, KIT_SCALE, railLayoutInfo, railParams, resolvePieceParams, type TRailLayout } from './pieces';
import { createLinkedPiece, frameBand } from './placement';
import { projectOnPath, shapesBounds } from './shapes';
import { trajectoryAt } from './simulate';
import { columnOffset } from './build-track-defaults';
import { extraStrikes, MIN_PIECE_GAP, nearestPieceGap } from './track-problems';
import { HIT_TOLERANCE, PHYSICS_HZ, type THitStatus, type TSimulationResult } from './types';
import type { TGapPieceType } from './worker-protocol';

/**
 * What a long gap gets first: a straight Rail, since the Switchback layout is only for what nothing else bridges, or the
 * one asked for. A Chain falls back to the Switchback layout, which it is measured against.
 */
export function gapPieceOrder(preferred?: 'rail' | 'switchback' | 'chain' | null): TGapPieceType[] {
	if (preferred === 'chain') return ['chain', 'switchback'];
	return preferred === 'switchback' ? ['switchback', 'rail'] : ['rail', 'switchback'];
}

/** What a gap search asks for to make a piece like this one again */
export function gapPieceTypeOf(piece: { type: string; layout?: TRailLayout | undefined }): TGapPieceType {
	if (piece.type === 'tunnel') return 'tunnel';
	return piece.layout === 'switchback' || piece.layout === 'chain' ? piece.layout : 'rail';
}

/**
 * A gap piece worth keeping: the marble rides and lands in its own marble and leaves near the pace, so the zigzag can pick up
 * again. A marble that lands near the frame's edge has nowhere left to go.
 */
export function gapPieceReads(check: TGapPieceCheck, paceLimit: number): boolean {
	return check.isDotInFrame && check.isRunInFrame && check.leaveTime != null && Math.abs(check.paceError ?? 0) <= paceLimit;
}

// Rails and tunnels for long gaps. The piece is anchored to the trajectory like a platform: it is linked
// to the hit before the gap with an entry delay, and at that time its start lies tangent under the
// marble. Upstream edits move it along with the trajectory. After it the marble flies freely, and the
// next hit's piece is placed by construction where the marble is at that hit, so timing never depends on
// the rail. Length and slope only shape the path through the gap.

interface TGapPieceOptions {
	/** When the marble enters. Defaults to shortly after the bounce apex following the first hit. */
	entryTime?: number;
	/** Horizontal run downhill from the entry in meters. Defaults to what fits in the frame band, at most 0.375 m. */
	length?: number;
	/** Downhill slope along the travel direction in radians, 6° by default */
	slope?: number;
	/**
	 * When given, candidate lengths and slopes are simulated and the one that keeps the marble and the next
	 * hit's dot inside the frame band is suggested. This is best effort; `check` reports how it went.
	 */
	simulate?: TSimulateFn;
	id?: string;
}

export interface TGapPieceProposal {
	piece: TPiece;
	commands: TProjectCommand[];
	entryTime: number;
	length: number;
	slope: number;
	/** Present when `simulate` was given: how the suggested piece plays */
	check: TGapPieceCheck | null;
}

export interface TGapPieceCheck {
	/** Dot of the hit after the gap */
	dot: TVec2 | null;
	isDotInFrame: boolean;
	/** The marble stays inside the frame band from the entry to the next hit */
	isRunInFrame: boolean;
	/** When the marble leaves the piece, null when it is still on it at the next hit */
	leaveTime: number | null;
	/** Status the piece got: placed, or blocked when the earlier trajectory crosses it */
	pieceStatus: string;
	/** Status of the hit after the gap when it already has a piece */
	nextStatus: THitStatus | null;
	/** Height of the next hit's dot above the shared pace y*, when the project has a pace */
	paceError?: number | null;
}

/** Rail starting under the marble shortly after `fromHitId`, bridging the gap to `toHitId` */
export function createRailForGap(
	project: TProject,
	result: TSimulationResult,
	marbleId: string,
	fromHitId: string,
	toHitId: string,
	options: TGapPieceOptions = {}
): TResult<TGapPieceProposal, Error> {
	return createGapPiece('rail', project, result, marbleId, fromHitId, toHitId, options);
}

/** Tunnel starting under the marble shortly after `fromHitId`, bridging the gap to `toHitId` */
export function createTunnelForGap(
	project: TProject,
	result: TSimulationResult,
	marbleId: string,
	fromHitId: string,
	toHitId: string,
	options: TGapPieceOptions = {}
): TResult<TGapPieceProposal, Error> {
	return createGapPiece('tunnel', project, result, marbleId, fromHitId, toHitId, options);
}

const DEGREE = Math.PI / 180;
const LEAD_IN = 0.006;
const FRAME_MARGIN = 0.03;
// The default kit's longest straight rail
const MAX_LENGTH = 0.25 * KIT_SCALE;
// The marble should drop for about this long between leaving the piece and the next hit
const PREFERRED_DROP = 0.15;

interface TGapCandidate {
	entryTime: number;
	/** Downhill direction along x, +1 or -1 */
	downhill: number;
	length: number;
	/** Uphill part behind the entry that catches a marble moving against the slope */
	catchLength: number;
	slope: number;
}

/** A candidate a gap search simulates: a straight rail or tunnel, or a Rail with generated turns */
export type TGapTry = TGapCandidate | TTurnsCandidate;

/** How a simulated candidate played, or null when it is never suggested */
export type TGapEvaluation = { score: number; check: TGapPieceCheck } | null;

/**
 * What a gap search needs besides the evaluations, the same in every worker that prepares the same request: the
 * candidates in the order they are tried, and what builds the piece
 */
export interface TGapSearchPlan {
	type: TGapPieceType;
	id: string;
	count: number;
	marbleId: string;
	fromHitId: string;
	fromTime: number;
	candidates: TGapTry[];
	/** What is proposed without simulating */
	fallback: TGapTry;
	/** Neighboring slopes of the best switchback are tried once more */
	isRefined: boolean;
}

/** A prepared gap search: its plan and the simulation of one candidate, independent of every other candidate */
interface TGapSearch {
	plan: TGapSearchPlan;
	evaluate: (candidate: TGapTry) => TGapEvaluation;
}

/** The proposal for one of a plan's candidates */
function gapProposal(plan: TGapSearchPlan, candidate: TGapTry, check: TGapPieceCheck | null): TGapPieceProposal {
	const entryDelay = candidate.entryTime - plan.fromTime;
	const hasTurns = (plan.type === 'switchback' || plan.type === 'chain') && 'turns' in candidate;
	const piece = hasTurns
		? turnsPiece(plan.type as TTurnsLayout, plan.id, plan.count, plan.marbleId, plan.fromHitId, entryDelay, candidate)
		: gapPiece(plan.type === 'tunnel' ? 'tunnel' : 'rail', plan.id, plan.count, plan.marbleId, plan.fromHitId, entryDelay, candidate as TGapCandidate);
	return {
		piece,
		commands: [{ type: 'addPiece', piece }],
		entryTime: candidate.entryTime,
		length: hasTurns ? candidate.width : (candidate as TGapCandidate).length,
		slope: candidate.slope,
		check
	};
}

/**
 * The gap search as stages of candidates: each yield asks for one stage, whose candidates are independent of each
 * other, and the answers are reduced in the order asked, with ties going to the first, so the choice never depends
 * on how the stage was computed. Switchbacks then try the best one's neighboring slopes.
 */
export function* gapSearch(plan: TGapSearchPlan): Generator<TGapTry[], TResult<TGapPieceProposal, Error>, TGapEvaluation[]> {
	let best: { score: number; candidate: TGapTry; check: TGapPieceCheck } | null = null;
	const hasTurns = plan.type === 'switchback' || plan.type === 'chain';
	const reduce = (candidates: TGapTry[], evaluations: TGapEvaluation[]): void => {
		candidates.forEach((candidate, index) => {
			const played = evaluations[index];
			// A marble still inside the turns at the next hit is stuck in them, whatever else the candidate does well
			if (hasTurns && played != null && played.check.leaveTime == null) return;
			if (played != null && (best == null || played.score < best.score - 1e-9)) best = { score: played.score, candidate, check: played.check };
		});
	};
	reduce(plan.candidates, yield plan.candidates);
	const found = best as { score: number; candidate: TGapTry; check: TGapPieceCheck } | null;
	if (found == null)
		return Err(new Error(hasTurns ? 'Every candidate crosses the earlier trajectory or another marble, or holds the marble' : 'Every candidate crosses the earlier trajectory or another marble'));
	// Steeper legs hold shorter and drop the marble lower; one round of neighboring slopes
	if (plan.isRefined) {
		const neighbors: TGapTry[] = [];
		for (const offset of [-2, 2, -4, 4]) {
			const slope = found.candidate.slope + offset * DEGREE;
			if (slope >= 2 * DEGREE && slope <= 25 * DEGREE) neighbors.push({ ...found.candidate, slope });
		}
		if (neighbors.length) reduce(neighbors, yield neighbors);
	}
	const chosen = best as { score: number; candidate: TGapTry; check: TGapPieceCheck } | null;
	return Ok(gapProposal(plan, chosen?.candidate ?? found.candidate, chosen?.check ?? found.check));
}

/** Runs a prepared gap search in this thread, or proposes the first candidate unsimulated without `simulate` */
function runGapSearch(prepared: TResult<TGapSearch, Error>, isSimulated: boolean): TResult<TGapPieceProposal, Error> {
	const [isOk, error, search] = prepared;
	if (!isOk) return Err(error);
	if (!isSimulated) return Ok(gapProposal(search.plan, search.plan.fallback, null));
	const steps = gapSearch(search.plan);
	let step = steps.next();
	while (step.done !== true) step = steps.next(step.value.map(search.evaluate));
	return step.value;
}

/** Prepares the search for a rail, tunnel, Switchback or Chain across a long gap; see `createRailForGap` and the others */
export function prepareGapSearch(
	type: TGapPieceType,
	project: TProject,
	result: TSimulationResult,
	marbleId: string,
	fromHitId: string,
	toHitId: string,
	options: TGapPieceOptions = {}
): TResult<TGapSearch, Error> {
	return type === 'switchback' || type === 'chain'
		? prepareTurns(type, project, result, marbleId, fromHitId, toHitId, options)
		: prepareGapPiece(type, project, result, marbleId, fromHitId, toHitId, options);
}

function createGapPiece(
	type: 'rail' | 'tunnel',
	project: TProject,
	result: TSimulationResult,
	marbleId: string,
	fromHitId: string,
	toHitId: string,
	options: TGapPieceOptions
): TResult<TGapPieceProposal, Error> {
	return runGapSearch(prepareGapPiece(type, project, result, marbleId, fromHitId, toHitId, options), options.simulate != null);
}

/** Evaluates candidates with `simulate`; a search prepared without it proposes the first candidate unsimulated */
function unsimulated(): TGapEvaluation {
	throw new Error('A gap search without `simulate` simulates no candidate');
}

function prepareGapPiece(
	type: 'rail' | 'tunnel',
	project: TProject,
	result: TSimulationResult,
	marbleId: string,
	fromHitId: string,
	toHitId: string,
	options: TGapPieceOptions
): TResult<TGapSearch, Error> {
	const marble = project.marbles.find((item) => item.id === marbleId);
	const from = marble?.hits.find((hit) => hit.id === fromHitId);
	const to = marble?.hits.find((hit) => hit.id === toHitId);
	if (marble == null || from == null || to == null)
		return Err(new Error('Both hits must exist in the marble'));
	if (to.time <= from.time) return Err(new Error('The gap must end after it starts'));
	const samples = result.marbles.find((marble) => marble.marbleId === marbleId)?.samples ?? [];
	// A new piece may reach over another marble, as long as nothing touches, with the frame as the limit
	const band = frameBand(project, hitOwners(project, marbleId).has(toHitId) ? marbleId : undefined);

	// Replaces an earlier gap piece on the same hit
	const replaced = findGapPiece(project, marbleId, fromHitId);
	const id = replaced?.id ?? options.id ?? createId('piece');
	const count = project.track.pieces.filter(
		(piece) => piece.type === type && piece.id !== replaced?.id
	).length;
	const build = (candidate: TGapCandidate): TPiece =>
		gapPiece(type, id, count, marbleId, fromHitId, candidate.entryTime - from.time, candidate);

	// Candidates: how far below the bounce apex the marble enters, whether the piece runs with the
	// marble's travel or against it, slope and length
	const entryTimes =
		options.entryTime != null
			? [options.entryTime]
			: [0.01, 0.05, 0.12]
					.map((drop) => findEntryTime(result, marbleId, from.time, to.time, drop))
					.filter((time): time is number => time != null);
	const candidates: TGapCandidate[] = [];
	for (const entryTime of entryTimes) {
		if (entryTime <= from.time || entryTime >= to.time) continue;
		const entry = trajectoryAt(samples, entryTime, gravityOf(project));
		if (entry == null) continue;
		const travel =
			Math.abs(entry.velocity.x) > 0.05
				? Math.sign(entry.velocity.x)
				: entry.position.x <= band.centerX
					? 1
					: -1;
		const roomTo = (direction: number): number =>
			Math.min(
				MAX_LENGTH,
				band.halfWidth - direction * (entry.position.x - band.centerX) - FRAME_MARGIN
			);
		for (const downhill of [travel, -travel]) {
			const maxLength = roomTo(downhill);
			const catchLength = downhill === travel ? LEAD_IN : roomTo(-downhill);
			if (maxLength < 0.04 || catchLength < LEAD_IN) continue;
			const lengths =
				options.length != null
					? [Math.min(options.length, maxLength)]
					: [maxLength, maxLength * 0.66, maxLength * 0.4];
			const slopes =
				options.slope != null
					? [options.slope]
					: (downhill === travel ? [2, 4, 6, 9, 13, 18, 25] : [3, 5, 8, 12]).map((d) => d * DEGREE);
			for (const length of lengths) {
				for (const slope of slopes)
					candidates.push({ entryTime, downhill, length, catchLength, slope });
			}
		}
	}
	const fallback = candidates.find(
		(candidate) => candidate.slope === (options.slope ?? 6 * DEGREE)
	);
	const first = fallback ?? candidates[0];
	if (first == null)
		return Err(
			new Error('The marble does not fall freely after the first hit, or the frame has no room')
		);

	const plan: TGapSearchPlan = { type, id, count, marbleId, fromHitId, fromTime: from.time, candidates, fallback: first, isRefined: false };
	const simulate = options.simulate;
	if (simulate == null) return Ok({ plan, evaluate: unsimulated });
	const hasPiece = hitOwners(project, marbleId).has(to.id);
	const frontiers = openFrontiers(project, result);
	const pace = result.pace ?? descentPace(project, result.hits);
	const marbleBand = frameBand(project, marbleId);
	const evaluate = (item: TGapTry): TGapEvaluation => {
		const candidate = item as TGapCandidate;
		const piece = build(candidate);
		// A flat probe on the next hit checks that the marble has left the piece with room for a platform
		const probe = !hasPiece
			? createLinkedPiece('platform', marbleId, to.id, 0, { id: `${piece.id}-probe` })
			: null;
		const trial = simulateTrial(
			simulate,
			withPieces(project, probe != null ? [piece, probe] : [piece]),
			to.time + 0.02
		);
		const played = checkGapPiece(
			trial,
			project,
			marbleId,
			piece.id,
			candidate.entryTime,
			to.id,
			to.time
		);
		if (played.pieceStatus !== 'placed') return null;
		// The rail must keep clear of the other marbles, as Auto place does
		if (crossesOtherMarbles(result, trial, project, marbleId, piece.id, from.time + 0.02, to.time, frontiers)) return null;
		const isTouching = nearestPieceGap(withPieces(project, [piece]), trial, piece.id, MIN_PIECE_GAP) < MIN_PIECE_GAP;
		const strikes = strikesOnTheWay(project, trial, piece, from.time);
		const outsideMarble = marbleOverhang(trial, piece.id, marbleBand);
		const pacePart = played.paceError != null && pace != null ? Math.abs(played.paceError) / pace.limit : 0;
		const score =
			STRIKE_WEIGHT * strikes +
			(hasPiece ? 0 : (isTouching ? 8 : 0) + pacePart + 3 * COLUMN_WEIGHT * columnMiss(played.dot, marbleBand) + MARBLE_WEIGHT * outsideMarble) +
			(played.isDotInFrame ? 0 : 10) +
			// At the frame's edge no tilt can send the marble on and keep the next dot in frame
			(played.dot != null && !hasPiece && !isInBand(played.dot, band, EDGE_SHARE) ? 10 : 0) +
			(played.isRunInFrame ? 0 : 5) +
			(played.leaveTime == null ? 20 : Math.abs(to.time - played.leaveTime - PREFERRED_DROP)) +
			(played.nextStatus === 'missed' || played.nextStatus === 'blocked' ? 10 : 0);
		return { score, check: hasPiece ? played : { ...played, nextStatus: null } };
	};
	return Ok({ plan, evaluate });
}

/**
 * First time after the hit when the marble falls and has dropped `drop` below its apex, leaving at least
 * 0.3 s before the gap ends
 */
export function findEntryTime(
	result: TSimulationResult,
	marbleId: string,
	from: number,
	to: number,
	drop = 0.01
): number | null {
	const samples = result.marbles.find((marble) => marble.marbleId === marbleId)?.samples ?? [];
	let apex = -Infinity;
	for (const sample of samples) {
		if (sample.time <= from + 0.01) continue;
		if (sample.time >= to - 0.3) return null;
		apex = Math.max(apex, sample.position.y);
		if (sample.velocity.y < 0 && apex - sample.position.y >= drop)
			return Math.round(sample.time * 1000) / 1000;
	}
	return null;
}

function gapPiece(
	type: 'rail' | 'tunnel',
	id: string,
	count: number,
	marbleId: string,
	hitId: string,
	entryDelay: number,
	candidate: TGapCandidate
): TPiece {
	const { downhill, length, catchLength, slope } = candidate;
	const definition = getPieceDefinition(type);
	const delay = Math.round(entryDelay * 1000) / 1000;
	const params = type === 'rail' ? railParams('path', { entryDelay: delay }) : resolvePieceParams(type, { entryDelay: delay });
	// Local path along the downhill direction through the entry point at the origin, with the catch
	// section behind it. The angle tilts it downhill.
	const scale = 1 / Math.cos(slope);
	return {
		id,
		name: `${definition?.label ?? type} ${count + 1}`,
		type,
		params,
		angle: -downhill * slope,
		place: { kind: 'follows', marbleId, hitId },
		path: {
			points: [
				{ x: round(-downhill * catchLength * scale), y: 0 },
				{ x: 0, y: 0 },
				{ x: round(downhill * length * scale), y: 0 }
			]
		}
	};
}

function round(value: number): number {
	return Math.round(value * 1e5) / 1e5;
}

function checkGapPiece(
	trial: TSimulationResult,
	project: TProject,
	marbleId: string,
	pieceId: string,
	entryTime: number,
	toHitId: string,
	toTime: number
): TGapPieceCheck {
	// Leaving the marble counts against a piece in the search, so a piece stays in it wherever one fits
	const band = frameBand(project, marbleId);
	const pace = trial.pace ?? descentPace(project, trial.hits);
	const piece = trial.pieces.find((item) => item.pieceId === pieceId);
	const marble = trial.marbles.find((item) => item.marbleId === marbleId);
	const next = findHitResult(trial, marbleId, toHitId);
	const dot = next?.dot ?? null;
	let leaveTime: number | null = null;
	let isRunInFrame = true;
	const path = piece?.path ?? [];
	const reach = (marble?.radius ?? 0.008) + (piece?.params['radius'] ?? 0.002) + 0.002;
	let isOnPiece = false;
	for (const sample of marble?.samples ?? []) {
		if (sample.time < entryTime - 1 / PHYSICS_HZ || sample.time > toTime) continue;
		if (!isInBand(sample.position, band, 1)) isRunInFrame = false;
		const isNear =
			path.length > 0 &&
			projectOnPath(path, sample.position.x, sample.position.y).distance <= reach;
		if (isNear) isOnPiece = true;
		else if (isOnPiece && leaveTime == null) leaveTime = sample.time;
		if (isNear) leaveTime = null;
	}
	return {
		dot,
		isDotInFrame: dot != null && isInBand(dot, band, 1),
		isRunInFrame,
		leaveTime: isOnPiece ? leaveTime : null,
		pieceStatus: piece?.status ?? 'unreached',
		nextStatus: next?.pieceId != null ? next.status : null,
		paceError: dot != null && pace != null ? dot.y - paceAt(pace, toTime) : null
	};
}

/** The rail or tunnel linked to a hit of the marble, if any */
function findGapPiece(project: TProject, marbleId: string, hitId: string): TPiece | undefined {
	return project.track.pieces.find((piece) => {
		const tie = tieOf(piece);
		if (piece == null || tie?.marbleId !== marbleId || tie.hitId !== hitId) return false;
		const kind = layoutOf(piece.type);
		return kind === 'path' || kind === 'tube';
	});
}

// Rails with generated turns: the Switchback and Chain layouts

const SWITCHBACK_MARGIN = 0.01;
// How far below the launching hit the marble enters, so the switchback stays clear of the piece above it as the
// film shows it: skins hang up to a marble diameter below their hitbox. In marble diameters.
const ENTRY_DROPS = [1.75, 2.5];
// Mending a run, the piece is placed again where it can keep what follows as it was
const MENDING_ENTRY_DROPS = [1.25, 2.5];
const SWITCHBACK_SLOPES = [2, 3, 5, 8, 12, 17].map((degrees) => degrees * DEGREE);
const SWITCHBACK_LEGS = [1, 2, 3, 4, 5, 6];
const SWITCHBACK_ENTRIES = [0.25, 0.5, 0.75];
// Shares of the default width
const SWITCHBACK_WIDTHS = [1, 0.8, 0.65];
// The marble must fall this far below the switchback before the next hit, on top of how high the bounce
// at that hit rises, so neither the next piece nor that bounce touches the switchback
const EXIT_CLEARANCE = 0.06;
// Per piece length a gap piece reaches over the next marble
const MARBLE_WEIGHT = 6;
// Per piece length the next dot lies from the nearest of the marble's two columns, so the zigzag picks up where it left off
const COLUMN_WEIGHT = 1;
// Estimates ignore the speed the marble enters with, so they only rank: this many per entry and width are
// simulated, and estimates up to `ESTIMATE_SLACK` too long still count
// Every strike outweighs what else a gap piece is scored on, but one that strikes is still better than none at all
const STRIKE_WEIGHT = 30;
const EDGE_SHARE = 0.75;
const SHORTLIST = 10;
const ESTIMATE_SLACK = 0.6;

type TTurnsLayout = 'switchback' | 'chain';

interface TTurnsCandidate {
	entryTime: number;
	/** Direction of the first turn along x, +1 or -1 */
	downhill: number;
	contactAt: number;
	width: number;
	turns: number;
	slope: number;
}

/**
 * A Chain's curve and lip by the slope a gap search tries: a shallow slope stands for tight, short turns that hold the
 * marble longest and a steep one for wide turns that come round further. Fitted on Jingle Bells' gaps: lips of 95° to
 * 110° and curves of 3 to 8 cm.
 */
function chainSwing(slope: number): { arc: number; sweep: number } {
	const share = (Math.min(25 * DEGREE, Math.max(2 * DEGREE, Math.abs(slope))) - 2 * DEGREE) / (23 * DEGREE);
	return { arc: Math.round((0.03 + 0.05 * share) * 1e4) / 1e4, sweep: Math.round((95 + 15 * share) * 10) / 10 };
}

/** The parameters of a candidate's turns */
function turnsParams(layout: TTurnsLayout, candidate: Pick<TTurnsCandidate, 'turns' | 'width' | 'slope'>): Record<string, number> {
	const { turns, width, slope } = candidate;
	return layout === 'chain' ? { turns, width, ...chainSwing(slope) } : { turns, width };
}

/**
 * Switchback that catches the marble after `fromHitId` and holds it in the marble's frame band, so it
 * leaves shortly before `toHitId` near the shared pace y*. The entry lies where the marble has fallen a
 * few centimeters below the launching hit, so its earlier path stays above the switchback. Leg counts
 * and slopes are ranked by their estimated hold time (`switchbackHoldTime`) and the height the marble
 * would reach at the next hit after falling from the exit; with `simulate` the best estimates are
 * simulated for two widths, both directions and three entry positions, scored by the pace error of the
 * next dot (twice as much below the pace), frame, stray contacts and room for the next piece, and the
 * best slope is refined once. The next hit's piece is placed by construction where the marble is, so
 * timing never depends on the switchback; `check` reports how close to the pace and frame it came.
 */
export function createSwitchbackForGap(
	project: TProject,
	result: TSimulationResult,
	marbleId: string,
	fromHitId: string,
	toHitId: string,
	options: TGapPieceOptions = {}
): TResult<TGapPieceProposal, Error> {
	return runGapSearch(prepareTurns('switchback', project, result, marbleId, fromHitId, toHitId, options), options.simulate != null);
}

/** A Rail with the Chain layout across a long gap, searched like the Switchback layout and always simulated */
export function createChainForGap(
	project: TProject,
	result: TSimulationResult,
	marbleId: string,
	fromHitId: string,
	toHitId: string,
	options: TGapPieceOptions = {}
): TResult<TGapPieceProposal, Error> {
	return runGapSearch(prepareTurns('chain', project, result, marbleId, fromHitId, toHitId, options), options.simulate != null);
}

function prepareTurns(
	layout: TTurnsLayout,
	project: TProject,
	result: TSimulationResult,
	marbleId: string,
	fromHitId: string,
	toHitId: string,
	options: TGapPieceOptions
): TResult<TGapSearch, Error> {
	const marble = project.marbles.find((item) => item.id === marbleId);
	const from = marble?.hits.find((hit) => hit.id === fromHitId);
	const to = marble?.hits.find((hit) => hit.id === toHitId);
	if (marble == null || from == null || to == null)
		return Err(new Error('Both hits must exist in the marble'));
	if (to.time <= from.time) return Err(new Error('The gap must end after it starts'));
	const samples = result.marbles.find((marble) => marble.marbleId === marbleId)?.samples ?? [];
	const marbleRadius =
		project.marbles.find((item) => item.id === marbleId)?.radius ?? 0.008;
	// A new switchback may reach over another marble, as long as nothing touches, with the frame as the limit
	const band = frameBand(project, hitOwners(project, marbleId).has(toHitId) ? marbleId : undefined);
	const marbleBand = frameBand(project, marbleId);
	const pace = result.pace ?? descentPace(project, result.hits);
	const GRAVITY = -gravityOf(project);
	const launch =
		findHitResult(result, marbleId, fromHitId)?.dot ??
		trajectoryAt(samples, from.time, -GRAVITY)?.position;
	if (launch == null) return Err(new Error('The marble does not reach the hit before the gap'));
	const targetY = pace != null ? paceAt(pace, to.time) : null;
	// The bounce at the hit after the gap rises about v0² / 2g, v0 the pace takeoff for the interval after it
	const after = marble.hits[marble.hits.findIndex((hit) => hit.id === toHitId) + 1];
	const afterInterval = after != null ? after.time - to.time : 0;
	const afterTakeoff =
		after != null && pace != null ? Math.max(0, (GRAVITY * afterInterval) / 2 - pace.rate) : 0;
	const minExitFall = Math.sqrt(
		(2 * (Math.min(afterTakeoff * afterTakeoff, 2 * GRAVITY * 0.6) / (2 * GRAVITY) + EXIT_CLEARANCE)) /
			GRAVITY
	);

	const replaced = findGapPiece(project, marbleId, fromHitId);
	const isMending = hitOwners(project, marbleId).has(to.id);
	const id = replaced?.id ?? options.id ?? createId('piece');
	const count = project.track.pieces.filter(
		(piece) => piece.type === 'rail' && piece.id !== replaced?.id
	).length;
	const defaults = resolvePieceParams('rail', railLayoutInfo[layout].defaults);
	const defaultWidth = resolvePieceParams('rail', {})['width'] ?? 0.15;
	const build = (candidate: TTurnsCandidate): TPiece =>
		turnsPiece(layout, id, count, marbleId, fromHitId, candidate.entryTime - from.time, candidate);

	const entryTimes =
		options.entryTime != null
			? [options.entryTime]
			: (isMending ? MENDING_ENTRY_DROPS : ENTRY_DROPS).map((drop) =>
					findDropTime(samples, from.time, to.time, launch.y - drop * 2 * marbleRadius)
				).filter(
					(time): time is number => time != null
				);
	const slopes = options.slope != null ? [options.slope] : SWITCHBACK_SLOPES;
	type TRanked = { candidate: TTurnsCandidate; predicted: number };
	const ranked: TRanked[] = [];
	for (const entryTime of [...new Set(entryTimes)]) {
		const entry = trajectoryAt(samples, entryTime, -GRAVITY);
		if (entry == null) continue;
		for (const width of SWITCHBACK_WIDTHS.map((share) => share * defaultWidth)) {
			const fits: Omit<TTurnsCandidate, 'turns' | 'slope'>[] = [];
			for (const downhill of [1, -1]) {
				for (const contactAt of SWITCHBACK_ENTRIES) {
					const a = entry.position.x - downhill * contactAt * width;
					const b = entry.position.x + downhill * (1 - contactAt) * width;
					const reach = band.halfWidth - SWITCHBACK_MARGIN;
					if (Math.abs(a - band.centerX) > reach || Math.abs(b - band.centerX) > reach) continue;
					fits.push({ entryTime, downhill, contactAt, width });
				}
			}
			if (!fits.length) continue;
			// Leg counts and slopes by their estimated pace error at the next hit
			const estimates: { turns: number; slope: number; predicted: number }[] = [];
			for (const turns of SWITCHBACK_LEGS) {
				for (const slope of slopes) {
					const sized = { ...defaults, ...turnsParams(layout, { turns, width, slope }) };
					const exitTime =
						entryTime +
						(layout === 'chain' ? chainHoldTime(sized) : switchbackHoldTime(sized, slope, GRAVITY, Math.hypot(entry.velocity.x, entry.velocity.y)));
					const fall = to.time - exitTime;
					if (fall < minExitFall - ESTIMATE_SLACK) continue;
					const geometry = (layout === 'chain' ? chainGeometry : switchbackGeometry)(sized, -slope, 0.5, entry.position, marbleRadius, null);
					const y = geometry.exit.y - (GRAVITY * fall * fall) / 2;
					estimates.push({ turns, slope, predicted: targetY != null ? y - targetY : 0 });
				}
			}
			estimates.sort(
				(a, b) =>
					Math.abs(a.predicted) - Math.abs(b.predicted) || a.turns - b.turns || a.slope - b.slope
			);
			for (const estimate of estimates.slice(0, SHORTLIST)) {
				for (const fit of fits)
					ranked.push({
						candidate: { ...fit, turns: estimate.turns, slope: estimate.slope },
						predicted: estimate.predicted
					});
			}
		}
	}
	const first = ranked[0];
	if (first == null)
		return Err(
			new Error(
				'The marble does not fall below the hit before the gap ends, or the frame has no room for the turns'
			)
		);

	const plan: TGapSearchPlan = {
		type: layout,
		id,
		count,
		marbleId,
		fromHitId,
		fromTime: from.time,
		candidates: ranked.map((item) => item.candidate),
		fallback: first.candidate,
		isRefined: options.slope == null
	};
	const simulate = options.simulate;
	if (simulate == null) return Ok({ plan, evaluate: unsimulated });
	const owners = hitOwners(project, marbleId);
	const frontiers = openFrontiers(project, result);
	const evaluate = (item: TGapTry): TGapEvaluation => {
		const candidate = item as TTurnsCandidate;
		const piece = build(candidate);
		// A flat probe on the next hit checks that its dot can take a piece below the switchback
		const probe = !owners.has(to.id)
			? createLinkedPiece('platform', marbleId, to.id, 0, { id: `${piece.id}-probe` })
			: null;
		const trial = simulateTrial(
			simulate,
			withPieces(project, probe != null ? [piece, probe] : [piece]),
			to.time + 0.02
		);
		const played = checkSwitchback(trial, project, marbleId, piece.id, candidate.entryTime, from.time, to.id, to.time);
		if (played.check.pieceStatus !== 'placed') return null;
		// Touching the marble's own pieces only costs score; touching another marble is never suggested
		if (crossesOtherMarbles(result, trial, project, marbleId, piece.id, from.time + 0.02, to.time, frontiers)) return null;
		const probeStatus = trial.pieces.find((piece) => piece.pieceId === probe?.id)?.status;
		const paceError = Math.abs(played.check.paceError ?? 0);
		const limit = pace?.limit ?? Infinity;
		const isTouching = nearestPieceGap(withPieces(project, [piece]), trial, piece.id, MIN_PIECE_GAP) < MIN_PIECE_GAP;
		const score =
			STRIKE_WEIGHT * strikesOnTheWay(project, trial, piece, from.time) +
			(played.isStray ? 20 : 0) +
			(isMending ? 0 : (isTouching ? 8 : 0) + COLUMN_WEIGHT * columnMiss(played.check.dot, marbleBand) + MARBLE_WEIGHT * marbleOverhang(trial, piece.id, marbleBand)) +
			(played.check.leaveTime == null ? 20 : 0) +
			// Dropping out as the note is due leaves the next platform right under the switchback
			(played.check.leaveTime != null && played.check.leaveTime >= to.time - 0.02 ? 2 : 0) +
			(probeStatus === 'blocked' ||
			played.check.nextStatus === 'missed' ||
			played.check.nextStatus === 'blocked'
				? 10
				: 0) +
			(played.check.isDotInFrame ? 0 : 10) +
			(played.check.isRunInFrame ? 0 : 5) +
			// Ending below the pace crowds the following pieces, above it is easy to recover from
			(Number.isFinite(limit)
				? ((played.check.paceError ?? 0) < 0 ? 2 : 1) * (paceError / limit) +
					(paceError > limit ? 5 : 0)
				: 0) +
			0.01 * candidate.turns;
		return { score, check: played.check };
	};
	return Ok({ plan, evaluate });
}

/**
 * First time after the hit when the marble falls and is at or below `level`, leaving at least 0.25 s
 * before the gap ends
 */
/** Platforms the marble strikes again on its way across the gap, since a path back past them finds them as readily as a hit */
function strikesOnTheWay(project: TProject, trial: TSimulationResult, piece: TPiece, from: number): number {
	return extraStrikes(withPieces(project, [piece]), trial).filter((strike) => strike.time > from + HIT_TOLERANCE).length;
}

/** How far a piece reaches past its own marble, in piece lengths: it may, but it then stands in the next marble's way */
function marbleOverhang(trial: TSimulationResult, pieceId: string, band: { centerX: number; halfWidth: number }): number {
	const shapes = trial.pieces.find((piece) => piece.pieceId === pieceId)?.shapes;
	if (shapes == null || !shapes.length) return 0;
	const bounds = shapesBounds(shapes);
	const length = resolvePieceParams('platform', {})['length'] ?? 0.09;
	return Math.max(0, Math.max(bounds.maxX - band.centerX, band.centerX - bounds.minX) - band.halfWidth) / length;
}

function columnMiss(dot: TVec2 | null, band: { centerX: number; halfWidth: number }): number {
	if (dot == null) return 0;
	const length = resolvePieceParams('platform', {})['length'] ?? 0.09;
	return Math.abs(Math.abs(dot.x - band.centerX) - columnOffset(length)) / length;
}

function findDropTime(
	samples: { time: number; position: TVec2; velocity: TVec2 }[],
	from: number,
	to: number,
	level: number
): number | null {
	for (const sample of samples) {
		if (sample.time <= from + 0.02) continue;
		if (sample.time >= to - 0.25) return null;
		if (sample.velocity.y < 0 && sample.position.y <= level)
			return Math.round(sample.time * 1000) / 1000;
	}
	return null;
}

function turnsPiece(
	layout: TTurnsLayout,
	id: string,
	count: number,
	marbleId: string,
	hitId: string,
	entryDelay: number,
	candidate: TTurnsCandidate
): TPiece {
	const params = railParams(layout, { entryDelay: Math.round(entryDelay * 1000) / 1000, ...turnsParams(layout, candidate) });
	return {
		id,
		name: `${getPieceDefinition('rail')?.label ?? 'Rail'} ${count + 1}`,
		type: 'rail', layout: layout, params: params, angle: round(-candidate.downhill * candidate.slope), place: { kind: 'follows', marbleId, hitId: hitId, contactAt: candidate.contactAt }
	};
}

/** How a Rail's turns played: when the marble dropped below it, frame, pace and stray contacts */
function checkSwitchback(
	trial: TSimulationResult,
	project: TProject,
	marbleId: string,
	pieceId: string,
	entryTime: number,
	fromTime: number,
	toHitId: string,
	toTime: number
): { check: TGapPieceCheck; isStray: boolean } {
	const band = frameBand(project, marbleId);
	const pace = trial.pace ?? descentPace(project, trial.hits);
	const piece = trial.pieces.find((item) => item.pieceId === pieceId);
	const marble = trial.marbles.find((item) => item.marbleId === marbleId);
	const next = findHitResult(trial, marbleId, toHitId);
	const dot = next?.dot ?? null;
	const bottom = piece?.shapes != null ? shapesBounds(piece.shapes).minY : -Infinity;
	let leaveTime: number | null = null;
	let isRunInFrame = true;
	for (const sample of marble?.samples ?? []) {
		if (sample.time < entryTime - 1 / PHYSICS_HZ || sample.time > toTime) continue;
		if (!isInBand(sample.position, band, 1)) isRunInFrame = false;
		if (leaveTime == null && sample.position.y < bottom - (marble?.radius ?? 0))
			leaveTime = sample.time;
	}
	const isStray = trial.contacts.some((contact) => {
		if (contact.time <= fromTime + 0.02 || contact.time >= toTime - 0.01) return false;
		if (contact.marbleId !== marbleId) return contact.otherId === pieceId;
		return contact.otherId !== pieceId;
	});
	return {
		check: {
			dot,
			isDotInFrame: dot != null && isInBand(dot, band, 1),
			isRunInFrame,
			leaveTime,
			pieceStatus: piece?.status ?? 'unreached',
			nextStatus: next?.pieceId != null ? next.status : null,
			paceError: dot != null && pace != null ? dot.y - paceAt(pace, toTime) : null
		},
		isStray
	};
}
