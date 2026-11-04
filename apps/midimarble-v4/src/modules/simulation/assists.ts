import { Err, Ok, type TResult } from 'tuple-result';
import {
	createId,
	type TEntity,
	type THit,
	type TProject,
	type TProjectCommand,
	type TVec2
} from '@/modules/project';
import { pathGap, resolvedPieceShapes, shapesGap } from './clearance';
import { GRAVITY_Y, gravityOf, surfaceNormal } from './geometry';
import { descentPace, longGapThreshold, paceAt, takeoffSpeed } from './pace';
import { layoutOf } from './piece-layout';
import { getPieceDefinition, isMusicalPiece, resolvePieceParams, soundsHit } from './pieces';
import { createLinkedPiece, frameBand, type TFrameBand } from './placement';
import { wrapAngle, type TPieceShape } from './shapes';
import {
	HIT_TOLERANCE,
	IMPACT_SPEED,
	type THitResult,
	type THitStatus,
	type TResolvedPiece,
	type TSimulationResult
} from './types';

// Step loop assists. Each one is a pure function over the project and its latest simulation result that
// returns entities and the commands that add them. Assists that predict the future take a `simulate`
// function, normally `TSimulator.simulate`; they simulate trial copies of the project that end shortly
// after the hits they check, so trials resume from the simulator's snapshots and stay cheap.

export type TSimulateFn = (project: TProject) => TSimulationResult;

export interface TAssistPlacement {
	hitId: string;
	entity: TEntity;
	commands: TProjectCommand[];
}

export interface TAssistIdOptions {
	/** Entity ID for the new piece, generated when omitted */
	id?: string;
}

export interface TOpenHit {
	hit: THit;
	/** Index in the lane's hits, which are sorted by time */
	index: number;
	/** The hit result for the open hit, if the result has it */
	result: THitResult | null;
	/** The last hit before it that has a piece, with that piece */
	previous: { hit: THit; entity: TEntity } | null;
}

/** The first hit after the lane's last hit with a piece that has no piece itself */
export function nextOpenHit(
	project: TProject,
	result: TSimulationResult | null,
	laneId: string
): TOpenHit | null {
	const lane = project.music.lanes.find((item) => item.id === laneId);
	if (lane == null) return null;
	const owners = hitOwners(project, laneId);
	let lastOwned = -1;
	lane.hits.forEach((hit, index) => {
		if (owners.has(hit.id)) lastOwned = index;
	});
	const hit = lane.hits[lastOwned + 1];
	if (hit == null) return null;
	const previousHit = lane.hits[lastOwned];
	const previousEntity = previousHit != null ? owners.get(previousHit.id) : undefined;
	return {
		hit,
		index: lastOwned + 1,
		result: findHitResult(result, laneId, hit.id),
		previous:
			previousHit != null && previousEntity != null
				? { hit: previousHit, entity: previousEntity }
				: null
	};
}

/** Linked piece for the next open hit with the previous piece's angle, contact and parameters */
export function repeatPiece(
	project: TProject,
	result: TSimulationResult | null,
	laneId: string,
	options: TAssistIdOptions = {}
): TResult<TAssistPlacement, Error> {
	return copyToNextOpenHit(project, result, laneId, false, options);
}

/** Like `repeatPiece` with the previous piece mirrored left to right, which alternates into a zigzag */
export function mirrorPiece(
	project: TProject,
	result: TSimulationResult | null,
	laneId: string,
	options: TAssistIdOptions = {}
): TResult<TAssistPlacement, Error> {
	return copyToNextOpenHit(project, result, laneId, true, options);
}

function copyToNextOpenHit(
	project: TProject,
	result: TSimulationResult | null,
	laneId: string,
	isMirrored: boolean,
	options: TAssistIdOptions
): TResult<TAssistPlacement, Error> {
	const open = nextOpenHit(project, result, laneId);
	if (open == null) return Err(new Error('The lane has no open hit after its last piece'));
	if (open.previous == null) return Err(new Error('There is no earlier piece to copy'));
	const entity = copyLinkedPiece(open.previous.entity, open.hit.id, isMirrored, {
		entities: project.entities,
		id: options.id
	});
	return Ok({ hitId: open.hit.id, entity, commands: [{ type: 'upsertEntity', entity }] });
}

/**
 * Copy of a linked piece for another hit. Mirroring reflects it across the vertical axis: platforms
 * negate their angle and flip their contact position, windmills keep the hub on the reflected side and
 * path pieces reflect their path.
 */
export function copyLinkedPiece(
	source: TEntity,
	hitId: string,
	isMirrored: boolean,
	options: { entities?: TEntity[]; id?: string } = {}
): TEntity {
	const { entities = [], id = createId('piece') } = options;
	const { piece, hitLink, path } = source.components;
	if (piece == null || hitLink == null)
		throw new Error(`Entity ${source.id} is not a linked piece`);
	let { angle, contactAt } = hitLink;
	let points = path?.points.map((point) => ({ ...point }));
	if (isMirrored) {
		const kind = layoutOf(piece.type);
		if (kind === 'rotor') angle = wrapAngle(Math.PI - angle);
		else angle = -angle;
		if (kind === 'box') contactAt = 1 - contactAt;
		if (points != null) points = points.map((point) => ({ x: -point.x, y: point.y }));
	}
	const definition = getPieceDefinition(piece.type);
	const count = entities.filter((entity) => entity.components.piece?.type === piece.type).length;
	const entity: TEntity = {
		id,
		name: `${definition?.label ?? piece.type} ${count + 1}`,
		components: {
			piece: { type: piece.type, params: { ...piece.params } },
			hitLink: { laneId: hitLink.laneId, hitId, angle, contactAt, pinned: false }
		}
	};
	if (points != null) entity.components.path = { points };
	return entity;
}

// Auto place

export interface TAutoPlaceOptions extends TAssistIdOptions {
	simulate: TSimulateFn;
	/**
	 * Angle range searched, in radians. Defaults to −40° to 40°, widened to 1° steps near flat and then to
	 * −60° to 60° when nothing in it passes.
	 */
	range?: [number, number];
	/** Piece type for a hit without a piece; it must sound hits, so scenery types are refused */
	type?: string;
}

export interface TAutoPlacement extends TAssistPlacement {
	angle: number;
	/**
	 * Dot of the following hit with the chosen angle. Null when the lane has no later hit or the next
	 * hit lies after a long gap, which a switchback, rail or tunnel bridges.
	 */
	nextDot: TVec2 | null;
	/** Horizontal marble travel from this hit's dot to the next dot, or over the horizon without one */
	travel: number;
	/** The platform bounce chosen with the angle, when the piece has one */
	bounce?: number;
	/** Height of the next dot above the shared pace y* at its time; null without a next dot or pace */
	paceError?: number | null;
}

const DEGREE = Math.PI / 180;

/**
 * Auto place objective. Each candidate angle is simulated and must pass the hard checks: the hit stays
 * on time, before the next hit the marble touches nothing else and no other marble touches the piece,
 * the next dot lies in the inner 90 % of the lane's frame band, a flat probe piece fits at it, the
 * marble falls there (with several marbles at `IMPACT_SPEED` or faster), so the next strike comes from
 * above, and, when several marbles share the frame, the next dot lies within the pace limit of y* (or no
 * further than this hit's dot already is, plus `PACE_SLACK`) (or no further than this hit's dot already is, plus
 * `PACE_SLACK`). Without a next hit in reach the marble must stay in the band over a horizon instead:
 * `LAST_HIT_HORIZON` after the lane's last hit and `LAUNCH_HORIZON` before a long gap, where a switchback,
 * rail or tunnel picks the marble up. Passing candidates are ranked by a score, lower is better, that sums:
 *
 * - travel: `TRAVEL_WEIGHT` per share of `minTravel` the horizontal travel falls short of it, so the
 *   marble never bounces in place. `minTravel` is the piece length plus `CLEARANCE` at each end, which
 *   also keeps the next piece clear of this one.
 * - restrike: `RESTRIKE_WEIGHT` per time the marble strikes the piece again before the next hit, which
 *   sounds an extra note. Short intervals after a low bounce sometimes leave no clean angle.
 * - clearance: `CLEARANCE_WEIGHT` per share of `CLEARANCE` that the new piece's colliders, the next
 *   piece's colliders or the marble path come closer than `CLEARANCE` to another piece, overlaps
 *   included. Other lanes' open hits count as flat platforms at their dots from their hit time on.
 * - band: `BAND_WEIGHT` times the squared offset of the next dot from the band centre, in half widths,
 *   plus `TRAVEL_WEIGHT` per half width the path leaves the band. With several marbles leaving the
 *   lane's band at all is a hard rejection instead.
 * - heading, with several marbles in their narrow lanes: `HEADING_WEIGHT` times how far the next dot lies
 *   in the outer half of the band, from 0 at
 *   half the half width to 1 at its edge, when the marble arrives there moving further out, scaled up to
 *   full at 0.3 m/s sideways
 * - pace: `PACE_WEIGHT` times the squared distance of the next dot from its target height, in pace
 *   limits
 * - comfort: `COMFORT_WEIGHT` times the relative difference between the travel and a comfortable
 *   travel: the previous hit's travel when that was long enough, `COMFORT_TRAVEL` piece lengths (at most
 *   the band's half width) otherwise, and `LAUNCH_TRAVEL` piece lengths before a long gap
 * - pattern: `PATTERN_WEIGHT` when the travel goes the other way than the neighbours suggest, which is
 *   back after a single step (zigzag) and onward after two steps the same way (staircase), plus
 *   `ANGLE_WEIGHT` times the distance to the previous piece's angle or its mirror, in 40° units
 * - a tie break of 0.001 per radian toward flatter angles
 *
 * The travel and clearance weights dominate, so a short or crowded candidate wins only when nothing else
 * passes the hard checks.
 *
 * When several marbles share the frame, a platform also gets the bounce that sends the marble to the next
 * dot's target height: the pace line, or for a dot below it half way back, but at least
 * `MIN_DROP_SHARE` of the pace drop below this dot. For each angle
 * the restitution that turns the arrival into the needed upward takeoff, at most what still arrives at
 * the next hit falling at `MIN_ARRIVAL`, is solved from the surface normal
 * (`paceBounce`), and when the simulated dot misses y* by more than `PACE_TOLERANCE` one Newton step
 * corrects it. Fast arrivals, such as the first fall from the release, therefore settle in one hit. Before
 * a long gap the bounce sends the marble up at `LAUNCH_TAKEOFF` instead, a short hop that clears the piece
 * sideways and drops below it into the holder. With one marble, and for other piece types with a
 * `bounce`, the bounce brings the marble to the next hit at the steady speed of the default bounce
 * (`withSettlingBounce`), which descends at the pace rate for a regular rhythm.
 */
const CLEARANCE = 0.004;
// In piece lengths, so they scale with the kit
const COMFORT_TRAVEL = 2;
const LAUNCH_TRAVEL = 4 / 3;
const LAST_HIT_HORIZON = 0.5;
// At Earth's gravity. The launch hop rises the same height at any gravity, so its flight and this horizon
// last 1 / √(gravity scale) as long; a fixed horizon at half gravity ended before the hop came back down and
// missed launches that fell back onto their own piece
const LAUNCH_HORIZON = 0.3;
const LAUNCH_TAKEOFF = 1.2;
// Least falling speed at a hit that launches into a long gap, at Earth's gravity: half the launch takeoff
const LAUNCH_ARRIVAL = 0.6;
const MIN_ARRIVAL = 1;
const PACE_TOLERANCE = 0.02;
const PACE_SLACK = 0.05;
const PACE_RECOVERY = 0.5;
const FALLBACK_SHIFTS = [-0.12, 0.12];
const FAST_ARRIVAL = 3;
const MIN_DROP_SHARE = 0.75;
const TRAVEL_WEIGHT = 10;
const CLEARANCE_WEIGHT = 10;
const BAND_WEIGHT = 0.6;
const HEADING_WEIGHT = 1;
const PACE_WEIGHT = 1;
const COMFORT_WEIGHT = 0.5;
const PATTERN_WEIGHT = 0.3;
const ANGLE_WEIGHT = 0.2;
const RESTRIKE_WEIGHT = 5;

interface TCandidate {
	angle: number;
	score: number;
	nextDot: TVec2 | null;
	travel: number;
	bounce: number | null;
	paceError: number | null;
}

/** One angle Auto place tries, in radians, with the shift of its target height */
export interface TAngleTry {
	angle: number;
	shift: number;
}

/** Why a tried angle failed a hard check */
export type TAutoPlaceRejection = 'blocked' | 'missed' | 'strayContact' | 'otherLane' | 'outOfFrame' | 'nextBlocked' | 'offPace' | 'rising';

/** A tried angle's score, or null when it fails a hard check, with the checks its simulations failed */
export interface TAngleEvaluation {
	candidate: Omit<TCandidate, 'angle'> | null;
	rejected: TAutoPlaceRejection[];
}

/** What the search needs besides the evaluations; every worker that prepares the same request gets the same plan */
export interface TAutoPlacePlan {
	hitId: string;
	/** The piece the chosen angle and bounce are applied to */
	base: TEntity;
	isShared: boolean;
	/** The marble arrives faster than `FAST_ARRIVAL` */
	isFast: boolean;
	/** The next dot has a target height, so the fallback tries higher and lower arcs */
	hasTarget: boolean;
}

/** Answers to one batch of tries, in the order they were asked */
export interface TAutoPlaceBatch {
	plan: TAutoPlacePlan;
	evaluations: TAngleEvaluation[];
}

/** A prepared Auto place: its plan and the simulation of one tried angle, independent of every other try */
export interface TAutoPlaceSearch {
	plan: TAutoPlacePlan;
	evaluate: (angle: TAngleTry) => TAngleEvaluation;
}

const DEFAULT_RANGE: [number, number] = [-40 * DEGREE, 40 * DEGREE];

/**
 * Chooses the angle for a hit's piece by the Auto place objective above. Candidates every 5°, refined
 * to 1° around the best, or to 0.5° when several marbles share the frame and their lanes are narrow. When none passes, 1° steps between −12° and 12° are tried, which fast arrivals
 * need, quarter degrees between −3° and 3° for arrivals faster than `FAST_ARRIVAL`, then the 1° steps with
 * the target height `FALLBACK_SHIFTS` lower and higher, then 5° steps between −60° and 60°. Ties go to the first candidate searched, so the choice is
 * deterministic. The angles run one after another here; `runAutoPlaceSearch` spreads each stage over workers
 * and picks the same angle.
 */
export function autoPlace(
	project: TProject,
	result: TSimulationResult,
	laneId: string,
	hitId: string,
	options: TAutoPlaceOptions
): TResult<TAutoPlacement, Error> {
	const [isOk, error, search] = prepareAutoPlace(project, result, laneId, hitId, options);
	if (!isOk) return Err(error);
	const steps = autoPlaceSearch(options.range);
	let step = steps.next();
	while (step.done !== true) step = steps.next({ plan: search.plan, evaluations: step.value.map(search.evaluate) });
	return step.value;
}

/**
 * Runs the Auto place search with each stage's tries answered by `evaluate`, for example spread over a pool of
 * workers. The answers are reduced in the order the tries were asked, so the choice is the one `autoPlace` makes
 * however the work was split. `isCancelled` is checked between stages.
 */
export async function runAutoPlaceSearch(
	evaluate: (tries: TAngleTry[]) => Promise<TAutoPlaceBatch>,
	options: { range?: [number, number]; isCancelled?: () => boolean } = {}
): Promise<TResult<TAutoPlacement, Error>> {
	const steps = autoPlaceSearch(options.range);
	let step = steps.next();
	while (step.done !== true) {
		if (options.isCancelled?.() === true) return Err(new Error('Auto place was stopped'));
		step = steps.next(await evaluate(step.value));
	}
	return step.value;
}

/**
 * The end of Auto place's trials for a hit, the latest time its checks read from the run they start from, or null
 * when the hit does not exist. A search may start from a run that ends `HIT_TOLERANCE` and more after it, which
 * has the same hits, contacts and samples up to then as the whole run.
 */
export function autoPlaceHorizon(project: TProject, laneId: string, hitId: string): number | null {
	const hits = project.music.lanes.find((lane) => lane.id === laneId)?.hits ?? [];
	const index = hits.findIndex((hit) => hit.id === hitId);
	return index >= 0 ? trialEnd(project, hits, index) : null;
}

function trialEnd(project: TProject, hits: THit[], index: number): number {
	const hit = hits[index];
	const following = hits[index + 1];
	if (hit == null) return 0;
	if (following != null && following.time - hit.time <= longGapThreshold(project)) return following.time + 0.02;
	return hit.time + (following != null ? launchHorizon(project) : LAST_HIT_HORIZON);
}

/** The checks and score of every tried angle for a hit's piece; see `autoPlace` */
export function prepareAutoPlace(
	project: TProject,
	result: TSimulationResult,
	laneId: string,
	hitId: string,
	options: Omit<TAutoPlaceOptions, 'range'>
): TResult<TAutoPlaceSearch, Error> {
	const { simulate, type = 'platform' } = options;
	const lane = project.music.lanes.find((item) => item.id === laneId);
	const index = lane?.hits.findIndex((hit) => hit.id === hitId) ?? -1;
	const hit = lane?.hits[index];
	if (lane == null || hit == null)
		return Err(new Error(`Hit ${hitId} does not exist in lane ${laneId}`));
	if (!isMusicalPiece(type))
		return Err(new Error(`${getPieceDefinition(type)?.label ?? type} is scenery and never sounds a hit`));
	const hitResult = findHitResult(result, laneId, hitId);
	const dot = hitResult?.dot;
	if (dot == null) return Err(new Error('The marble does not reach this hit'));
	const velocity = hitResult?.velocity ?? null;

	const owners = hitOwners(project, laneId);
	const existing = owners.get(hitId);
	let base =
		existing ??
		createLinkedPiece(type, laneId, hitId, 0, { entities: project.entities, id: options.id });
	const baseType = base.components.piece?.type ?? type;
	let previousAngle: number | null = null;
	for (let i = index - 1; i >= 0 && previousAngle == null; i--) {
		const previous = owners.get(lane.hits[i]?.id ?? '');
		if (previous?.components.hitLink != null) previousAngle = previous.components.hitLink.angle;
	}
	const longGap = longGapThreshold(project);
	const followingHit = lane.hits[index + 1] ?? null;
	const nextHit =
		followingHit != null && followingHit.time - hit.time <= longGap ? followingHit : null;
	const isLaunch = nextHit == null && followingHit != null;
	const pace = result.pace ?? descentPace(project, result.hits);
	const isBox = layoutOf(baseType) === 'box';
	const bounceSpec = getPieceDefinition(baseType)?.params['bounce'];
	// Speeds scale with the project's gravity, and so do the speed thresholds below
	const g = -gravityOf(project);
	const speedScale = g / -GRAVITY_Y;
	// One marble can be followed by the camera itself and keeps the steady descent of its default bounce,
	// which is the pace rate for a regular rhythm; several marbles must keep to the shared pace
	const isShared = project.entities.filter((entity) => entity.components.marble != null).length > 1;
	const isPaced = isShared && isBox;
	if (nextHit != null && !isPaced)
		base = withSettlingBounce(base, velocity, nextHit.time - hit.time, g);
	const interval = nextHit != null ? nextHit.time - hit.time : 0;
	// Where the next dot should be, and how far from y* it may end up: a dot above the pace returns to it,
	// and a dot below recovers half its offset per hit and still drops at least `MIN_DROP_SHARE` of the
	// pace drop, so it never stacks its next piece beside the last one
	const offset = pace != null && isShared ? dot.y - paceAt(pace, hit.time) : 0;
	const targetY =
		nextHit != null && pace != null && isPaced
			? dot.y -
				(offset >= 0
					? pace.rate * interval + offset
					: Math.max(
							MIN_DROP_SHARE * pace.rate * interval,
							pace.rate * interval + PACE_RECOVERY * offset
						))
			: null;
	const allowed = pace != null ? Math.max(pace.limit, Math.abs(offset) + PACE_SLACK) : Infinity;
	// The next strike must come from above: the takeoff leaves the marble falling at `MIN_ARRIVAL` then
	const takeoff =
		!isBox || bounceSpec == null
			? null
			: isLaunch
				? LAUNCH_TAKEOFF * Math.sqrt(speedScale)
				: nextHit != null && isPaced
					? Math.min(
							g * interval - MIN_ARRIVAL * speedScale,
							targetY != null
								? takeoffSpeed(dot.y, targetY, interval, g)
								: (g * interval * bounceSpec.default) / (1 + bounceSpec.default)
						)
					: null;
	const band = frameBand(project, laneId);
	const dotShare = 0.9;
	// The next strike must come from above. Several marbles in narrow lanes need it firm, so a slow
	// arrival cannot end as a resting contact; one marble only needs it falling.
	// A next hit that launches into a long gap needs a firm strike to throw the marble; a slow arrival there
	// ends resting on the piece and nothing can bridge the gap
	const afterNext = nextHit != null ? (lane.hits[index + 2] ?? null) : null;
	const isNextLaunch = nextHit != null && afterNext != null && afterNext.time - nextHit.time > longGap;
	const fallingSpeed = Math.max(
		isShared ? IMPACT_SPEED * speedScale : 0,
		isNextLaunch ? LAUNCH_ARRIVAL * Math.sqrt(speedScale) : 0
	);
	const until = trialEnd(project, lane.hits, index);
	const marbleRadius =
		project.entities.find((entity) => entity.components.marble?.laneId === laneId)?.components
			.marble?.radius ?? 0;
	const pieceLength = resolvePieceParams(baseType, base.components.piece?.params ?? {})['length'];
	const length = pieceLength ?? resolvePieceParams('platform', {})['length'] ?? 0.09;
	const minTravel = length + 2 * CLEARANCE;
	const pattern = travelPattern(result, laneId, lane.hits, index, owners, minTravel);
	const reserved = reservedSpots(project, result, laneId, until);
	const frontiers = openFrontiers(project, result);

	/** Simulates one angle and bounce; the next dot is returned even when a hard check fails */
	const evaluate = (
		angle: number,
		bounce: number | null,
		rejected: TAutoPlaceRejection[]
	): { candidate: Omit<TCandidate, 'angle'> | null; nextDot: TVec2 | null } => {
		const entity = withBounce(withAngle(base, angle), bounce);
		// A flat probe on the next hit checks that its dot can take a piece at all
		const probe =
			nextHit != null && !owners.has(nextHit.id)
				? createLinkedPiece('platform', laneId, nextHit.id, 0, { id: `${entity.id}-probe` })
				: null;
		const trial = simulateTrial(
			simulate,
			withEntities(project, probe != null ? [entity, probe] : [entity]),
			until
		);
		const trialHit = findHitResult(trial, laneId, hitId);
		if (!isOnTime(trialHit?.status)) {
			rejected.push(trialHit?.status === 'blocked' ? 'blocked' : 'missed');
			return { candidate: null, nextDot: null };
		}
		if (hasStrayContact(trial, project, laneId, entity.id, hit.time, until, frontiers)) {
			rejected.push('strayContact');
			return { candidate: null, nextDot: null };
		}
		if (crossesOtherLanes(result, trial, project, laneId, entity.id, hit.time, until, frontiers)) {
			rejected.push('otherLane');
			return { candidate: null, nextDot: null };
		}
		const samples = trial.marbles.find((marble) => marble.laneId === laneId)?.samples ?? [];
		const marbleId = trial.marbles.find((marble) => marble.laneId === laneId)?.entityId;
		const restrikes = trial.contacts.filter(
			(contact) =>
				contact.marbleEntityId === marbleId &&
				contact.otherEntityId === entity.id &&
				contact.time > hit.time + HIT_TOLERANCE + 0.01 &&
				contact.time < until - 0.03
		).length;
		let nextDot: TVec2 | null = null;
		let end: TVec2 | null;
		let paceError: number | null = null;
		let heading = 0;
		if (nextHit != null) {
			nextDot = findHitResult(trial, laneId, nextHit.id)?.dot ?? null;
			if (nextDot == null || !isInBand(nextDot, band, dotShare)) {
				rejected.push('outOfFrame');
				return { candidate: null, nextDot: null };
			}
			const arrival = findHitResult(trial, laneId, nextHit.id)?.velocity;
			if (arrival == null || arrival.y > -fallingSpeed) {
				rejected.push('rising');
				return { candidate: null, nextDot: null };
			}
			// A dot in the outer half of the band that the marble reaches moving further out leaves the next
			// piece little room. Zigzag columns sit inside the inner half, where reaching them outward is normal.
			const side = (nextDot.x - band.centerX) / band.halfWidth;
			if (isShared)
				heading =
					2 * Math.max(0, side * Math.sign(arrival.x) - 0.5) * Math.min(1, Math.abs(arrival.x) / 0.3);
			const probed = trial.pieces.find((piece) => piece.entityId === probe?.id);
			if (probed?.status === 'blocked') {
				rejected.push('nextBlocked');
				return { candidate: null, nextDot: null };
			}
			if (pace != null) {
				paceError = nextDot.y - paceAt(pace, nextHit.time);
				if (isShared && Math.abs(paceError) > allowed) {
					rejected.push('offPace');
					return { candidate: null, nextDot };
				}
			}
			end = nextDot;
		} else {
			if (!staysInBand(trial, laneId, hit.time, until, band)) {
				rejected.push('outOfFrame');
				return { candidate: null, nextDot: null };
			}
			end = null;
			for (const sample of samples) if (sample.time <= until) end = sample.position;
		}
		const travel = end != null ? end.x - dot.x : 0;
		const distance = Math.abs(travel);

		// Clearance of the new piece, the next piece and the marble path from every other piece
		const placed = trial.pieces.filter(
			(piece) => piece.status === 'placed' || piece.status === 'pinned' || piece.status === 'free'
		);
		const own = placed.find((piece) => piece.entityId === entity.id);
		const nextId = probe?.id ?? (nextHit != null ? owners.get(nextHit.id)?.id : undefined);
		const next = placed.find((piece) => piece.entityId === nextId);
		let shortfall = 0;
		const ownShapes = own != null ? resolvedPieceShapes(own) : [];
		for (const piece of [own, next]) {
			if (piece == null) continue;
			const shapes = piece === own ? ownShapes : resolvedPieceShapes(piece);
			for (const other of placed) {
				if (other === piece || (piece === next && other === own)) continue;
				shortfall += Math.max(
					0,
					CLEARANCE - shapesGap(shapes, resolvedPieceShapes(other), CLEARANCE)
				);
			}
		}
		const others = placed
			.filter((piece) => piece !== own && piece !== next)
			.flatMap(resolvedPieceShapes);
		shortfall += Math.max(
			0,
			CLEARANCE - pathGap(samples, marbleRadius, others, hit.time + 0.005, until - 0.03)
		);
		for (const spot of reserved) {
			shortfall += Math.max(0, CLEARANCE - shapesGap(ownShapes, spot.shapes, CLEARANCE));
			shortfall += Math.max(
				0,
				CLEARANCE - pathGap(samples, marbleRadius, spot.shapes, spot.time, until - 0.03)
			);
		}

		let outside = 0;
		for (const sample of samples) {
			if (sample.time < hit.time || sample.time > until) continue;
			const offset = Math.abs(sample.position.x - band.centerX) - band.halfWidth;
			outside = Math.max(outside, offset / band.halfWidth);
		}
		// With several marbles a lane's band is a hard wall: crossing it reaches the neighbour's pieces
		if (isShared && outside > 0) {
			rejected.push('outOfFrame');
			return { candidate: null, nextDot };
		}
		const centrality = end != null ? (end.x - band.centerX) / band.halfWidth : 0;
		// A centred zigzag travels about the band's half width per hit, which caps the default in narrow lanes
		const comfort = isLaunch
			? LAUNCH_TRAVEL * length
			: (pattern.travel ?? Math.min(COMFORT_TRAVEL * length, band.halfWidth));
		const isAgainstPattern =
			!isLaunch && pattern.side != null && Math.sign(travel) !== pattern.side;
		const consistency =
			previousAngle != null
				? Math.min(Math.abs(angle - previousAngle), Math.abs(angle + previousAngle)) / (40 * DEGREE)
				: 0;
		const offPace =
			nextDot != null && targetY != null && pace != null ? (nextDot.y - targetY) / pace.limit : 0;
		const score =
			(TRAVEL_WEIGHT * Math.max(0, minTravel - distance)) / minTravel +
			(CLEARANCE_WEIGHT * shortfall) / CLEARANCE +
			BAND_WEIGHT * centrality * centrality +
			HEADING_WEIGHT * heading +
			TRAVEL_WEIGHT * outside +
			PACE_WEIGHT * offPace * offPace +
			(COMFORT_WEIGHT * Math.abs(distance - comfort)) / comfort +
			(isAgainstPattern ? PATTERN_WEIGHT : 0) +
			RESTRIKE_WEIGHT * restrikes +
			ANGLE_WEIGHT * consistency +
			1e-3 * Math.abs(angle);
		return {
			candidate: {
				score,
				nextDot,
				travel,
				bounce: entity.components.piece?.params['bounce'] ?? null,
				paceError
			},
			nextDot
		};
	};

	/**
	 * Evaluates an angle with its pace bounce, corrected once when the dot misses its target. `shift` moves
	 * the target up or down, which the fallback search uses to try higher and lower arcs.
	 */
	const evaluateAngle = ({ angle, shift }: TAngleTry): TAngleEvaluation => {
		const rejected: TAutoPlaceRejection[] = [];
		const answer = (candidate: Omit<TCandidate, 'angle'> | null): TAngleEvaluation => ({ candidate, rejected });
		const target = targetY != null ? targetY + shift : null;
		const lift =
			takeoff != null && target != null && shift !== 0
				? Math.min(g * interval - MIN_ARRIVAL * speedScale, takeoffSpeed(dot.y, target, interval, g))
				: takeoff;
		const solved =
			lift != null && bounceSpec != null ? paceBounce(velocity, angle, lift, bounceSpec) : null;
		const first = evaluate(angle, solved?.bounce ?? null, rejected);
		if (solved == null || target == null || first.nextDot == null) return answer(first.candidate);
		const error = first.nextDot.y - target;
		if (Math.abs(error) <= PACE_TOLERANCE) return answer(first.candidate);
		const corrected = clampBounce(solved.bounce - error / (interval * solved.gain), bounceSpec);
		if (bounceSpec == null || Math.abs(corrected - solved.bounce) < 0.01) return answer(first.candidate);
		const second = evaluate(angle, corrected, rejected).candidate;
		if (second == null) return answer(first.candidate);
		return answer(first.candidate == null || second.score < first.candidate.score ? second : first.candidate);
	};

	const isFast = Math.hypot(velocity?.x ?? 0, velocity?.y ?? 0) > FAST_ARRIVAL * speedScale;
	return Ok({ plan: { hitId, base, isShared, isFast, hasTarget: targetY != null }, evaluate: evaluateAngle });
}

/**
 * The Auto place search as stages of tries: each yield asks for one stage's angles, which are independent of each
 * other, and the answers are reduced in the order asked, with ties going to the first, so the choice never depends
 * on how the stage was computed
 */
function* autoPlaceSearch(
	range: [number, number] = DEFAULT_RANGE
): Generator<TAngleTry[], TResult<TAutoPlacement, Error>, TAutoPlaceBatch> {
	// Set by the first answer, so a closure assignment the narrowing cannot see
	const known: { plan: TAutoPlacePlan | null } = { plan: null };
	const rejected: Record<TAutoPlaceRejection, number> = {
		blocked: 0,
		missed: 0,
		strayContact: 0,
		otherLane: 0,
		outOfFrame: 0,
		nextBlocked: 0,
		offPace: 0,
		rising: 0
	};
	const tried = new Set<string>();
	function* search(
		angles: number[],
		best: TCandidate | null,
		limits: [number, number],
		shift = 0,
		resolution = 1
	): Generator<TAngleTry[], TCandidate | null, TAutoPlaceBatch> {
		const tries: TAngleTry[] = [];
		for (const angle of angles) {
			const steps = Math.round(angle / (resolution * DEGREE));
			const degrees = steps * resolution;
			const rounded = degrees * DEGREE;
			const key = `${degrees}/${shift}`;
			if (rounded < limits[0] - 1e-9 || rounded > limits[1] + 1e-9 || tried.has(key)) continue;
			tried.add(key);
			tries.push({ angle: rounded, shift });
		}
		if (tries.length === 0) return best;
		const batch = yield tries;
		known.plan = batch.plan;
		let chosen = best;
		batch.evaluations.forEach((evaluated, index) => {
			for (const reason of evaluated.rejected) rejected[reason]++;
			const angle = tries[index]?.angle;
			const candidate = evaluated.candidate;
			if (angle != null && candidate != null && (chosen == null || candidate.score < chosen.score - 1e-12))
				chosen = { angle, ...candidate };
		});
		return chosen;
	}
	const steps = (from: number, to: number, step: number): number[] => {
		const angles: number[] = [];
		for (let angle = from; angle <= to + 1e-9; angle += step) angles.push(angle);
		return angles;
	};
	let coarse = yield* search(steps(range[0], range[1], 5 * DEGREE), null, range);
	// The first stage always has tries, and its answer brings the plan
	const isShared = known.plan?.isShared === true;
	// Fast arrivals keep their speed along a tilted surface, so only nearly flat pieces keep them in frame
	const near: [number, number] = [-12 * DEGREE, 12 * DEGREE];
	// Narrow lanes leave windows of a degree or two, so several marbles search them in half degrees
	const step = isShared ? 0.5 : 1;
	coarse ??= yield* search(steps(near[0], near[1], step * DEGREE), null, near, 0, step);
	// A fast arrival turns every degree of tilt into several centimetres of travel per tenth of a second
	const flat: [number, number] = [-3 * DEGREE, 3 * DEGREE];
	if (coarse == null && known.plan?.isFast === true) {
		coarse = yield* search(steps(flat[0], flat[1], DEGREE / 4), null, flat, 0, 0.25);
	}
	// Higher and lower arcs pass crowded pieces differently; the pace check still bounds them
	if (coarse == null && known.plan?.hasTarget === true) {
		for (const shift of FALLBACK_SHIFTS)
			coarse ??= yield* search(steps(near[0], near[1], step * DEGREE), null, near, shift, step);
	}
	const wide: [number, number] = [-60 * DEGREE, 60 * DEGREE];
	coarse ??= yield* search(steps(wide[0], wide[1], 5 * DEGREE), null, wide);
	const found = known.plan;
	if (coarse == null || found == null) {
		return Err(
			new Error(
				`No angle keeps the next dot on time and in frame (${rejected.blocked} blocked, ${rejected.missed} missed, ${rejected.strayContact} touch something else, ${rejected.otherLane} change another marble's run, ${rejected.outOfFrame} out of frame, ${rejected.nextBlocked} leave no room at the next dot, ${rejected.offPace} off the descent pace, ${rejected.rising} still rising at the next hit)`
			)
		);
	}
	const best: TCandidate = coarse;
	const limits: [number, number] = [Math.min(range[0], best.angle), Math.max(range[1], best.angle)];
	const isQuarter = Math.abs((best.angle / DEGREE) * 2 - Math.round((best.angle / DEGREE) * 2)) > 1e-6;
	const offsets = isShared
		? [-4, -3.5, -3, -2.5, -2, -1.5, -1, -0.5, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]
		: [-4, -3, -2, -1, 1, 2, 3, 4];
	const chosen = isQuarter
		? best
		: ((yield* search(
				offsets.map((offset) => best.angle + offset * DEGREE),
				best,
				limits,
				0,
				step
			)) ?? best);

	const entity = withBounce(withAngle(found.base, chosen.angle), chosen.bounce);
	const placement: TAutoPlacement = {
		hitId: found.hitId,
		entity,
		angle: chosen.angle,
		nextDot: chosen.nextDot,
		travel: chosen.travel,
		paceError: chosen.paceError,
		commands: [{ type: 'upsertEntity', entity }]
	};
	if (chosen.bounce != null) placement.bounce = chosen.bounce;
	return Ok(placement);
}

/**
 * Flat platforms standing in for the pieces that other lanes' open hits before `until` will get, so a
 * marble keeps clear of the spots where another marble's next pieces go
 */
function reservedSpots(
	project: TProject,
	result: TSimulationResult,
	laneId: string,
	until: number
): { time: number; shapes: TPieceShape[] }[] {
	const params = resolvePieceParams('platform', {});
	const halfLength = (params['length'] ?? 0) / 2;
	const halfThickness = (params['thickness'] ?? 0) / 2;
	const spots: { time: number; shapes: TPieceShape[] }[] = [];
	for (const lane of project.music.lanes) {
		if (lane.id === laneId) continue;
		const owners = hitOwners(project, lane.id);
		const radius =
			project.entities.find((entity) => entity.components.marble?.laneId === lane.id)?.components
				.marble?.radius ?? 0;
		for (const hit of lane.hits) {
			if (hit.time >= until) break;
			const dot = findHitResult(result, lane.id, hit.id)?.dot;
			if (owners.has(hit.id) || dot == null) continue;
			const box = {
				cx: dot.x,
				cy: dot.y - radius - halfThickness,
				angle: 0,
				halfLength,
				halfThickness
			};
			spots.push({ time: hit.time, shapes: [{ kind: 'box', box }] });
		}
	}
	return spots;
}

/**
 * Travel the neighbours suggest for the hit at `index`: the side is back after one step (zigzag) and
 * onward after two long enough steps the same way (staircase); the travel is the last step's distance
 * when it was long enough. Steps count only between consecutive hits that have pieces.
 */
function travelPattern(
	result: TSimulationResult,
	laneId: string,
	hits: THit[],
	index: number,
	owners: Map<string, TEntity>,
	minTravel: number
): { side: number | null; travel: number | null } {
	const step = (to: number): number | null => {
		const from = hits[to - 1];
		const into = hits[to];
		if (from == null || into == null || !owners.has(from.id)) return null;
		const a = findHitResult(result, laneId, from.id)?.dot;
		const b = findHitResult(result, laneId, into.id)?.dot;
		return a != null && b != null ? b.x - a.x : null;
	};
	const last = step(index);
	if (last == null || Math.abs(last) < minTravel) return { side: null, travel: null };
	const before = step(index - 1);
	const isStaircase =
		before != null && Math.abs(before) >= minTravel && Math.sign(before) === Math.sign(last);
	return { side: isStaircase ? Math.sign(last) : -Math.sign(last), travel: Math.abs(last) };
}

// Continue

export interface TContinueOptions {
	simulate: TSimulateFn;
	/** Most ghost pieces offered at once */
	maxCount?: number;
	/** Largest difference between matching inter-onset intervals, in seconds */
	rhythmTolerance?: number;
	/** Entity ID per ghost hit, generated when omitted */
	idFor?: (hitId: string) => string;
}

export interface TContinueSuggestion {
	hitId: string;
	entity: TEntity;
	/** Resolved piece from the verification run */
	piece: TResolvedPiece | null;
	dot: TVec2 | null;
	status: THitStatus;
	error: number | null;
	isInFrame: boolean;
	/** Height of the dot above the shared pace y*, null without a dot or pace */
	paceError?: number | null;
	/** On time, in the lane's frame band and within the pace limit; suggestions stop after the first that is not */
	isOk: boolean;
}

export interface TContinueResult {
	pattern: 'repeat' | 'mirror';
	/** Ghosts in hit order. All but possibly the last are ok. */
	suggestions: TContinueSuggestion[];
	/** Commands that add the ok suggestions, for Tab */
	commands: TProjectCommand[];
}

const ANGLE_TOLERANCE = 0.5 * DEGREE;

/**
 * Ghost pieces that continue the lane's recent pattern. The last two to four placed pieces must repeat
 * one angle or alternate it mirrored, and each following open hit must keep the rhythm: its
 * inter-onset interval matches the interval one pattern period earlier. Ghosts stop before a hit that
 * starts a long gap, which needs a launch from Auto place, before the hit ahead of it, which must strike the
 * launch firmly, and after one, and with several marbles before a
 * lane's last hit, whose fall past the other lanes Auto place checks. The ghosts are verified in one
 * simulation and cut after the first that misses, leaves the lane's frame band or, when several marbles
 * share the frame, ends further from the pace y* than the limit (or than the open dot already is, plus a
 * little); the last one is also cut when
 * a flat probe at the hit after it would be blocked. Returns null when there is no pattern to continue.
 */
export function continueSuggestions(
	project: TProject,
	result: TSimulationResult,
	laneId: string,
	options: TContinueOptions
): TContinueResult | null {
	const {
		simulate,
		maxCount = 16,
		rhythmTolerance = 0.015,
		idFor = () => createId('piece')
	} = options;
	const lane = project.music.lanes.find((item) => item.id === laneId);
	if (lane == null) return null;
	const owners = hitOwners(project, laneId);
	const open = nextOpenHit(project, result, laneId);
	if (open == null) return null;

	// The placed run before the open hit: consecutive hits with pieces of one type that land on time
	const run: { hit: THit; entity: TEntity; angle: number }[] = [];
	for (let i = open.index - 1; i >= 0 && run.length < 4; i--) {
		const hit = lane.hits[i];
		const entity = hit != null ? owners.get(hit.id) : undefined;
		const angle = entity?.components.hitLink?.angle;
		if (hit == null || entity == null || angle == null) break;
		if (!isOnTime(findHitResult(result, laneId, hit.id)?.status)) break;
		if (run[0] != null && run[0].entity.components.piece?.type !== entity.components.piece?.type)
			break;
		run.unshift({ hit, entity, angle });
	}
	const pattern = detectPattern(run.map((item) => item.angle));
	if (pattern == null) return null;
	const period = pattern === 'repeat' ? 1 : 2;
	const longGap = longGapThreshold(project);
	const isSharedFrame = project.entities.filter((entity) => entity.components.marble != null).length > 1;

	// Source of each ghost: the piece one period earlier, placed or ghost
	const sources = new Map<number, TEntity>();
	run.forEach((item, i) => sources.set(open.index - run.length + i, item.entity));
	const ghosts: { hit: THit; entity: TEntity }[] = [];
	const entities = [...project.entities];
	for (let k = open.index; k < lane.hits.length && ghosts.length < maxCount; k++) {
		const hit = lane.hits[k];
		const previous = lane.hits[k - 1];
		const earlier = lane.hits[k - period];
		// Near the lane start the period's earlier interval may not exist; the latest one stands in
		const beforeEarlier = lane.hits[k - period - 1] ?? lane.hits[k - 2];
		const referenceEnd = lane.hits[k - period - 1] != null ? earlier : previous;
		if (
			hit == null ||
			previous == null ||
			earlier == null ||
			beforeEarlier == null ||
			referenceEnd == null
		)
			break;
		if (owners.has(hit.id)) break;
		const following = lane.hits[k + 1];
		if (following != null && following.time - hit.time > longGap) break;
		// The piece before a launch sets how firmly the launch hit is struck, which Auto place checks
		const afterFollowing = lane.hits[k + 2];
		if (following != null && afterFollowing != null && afterFollowing.time - following.time > longGap)
			break;
		// With several marbles a lane's last hit needs Auto place's check of the fall after it
		if (following == null && isSharedFrame) break;
		const interval = hit.time - previous.time;
		if (interval > longGap) break;
		const reference = referenceEnd.time - beforeEarlier.time;
		if (Math.abs(interval - reference) > rhythmTolerance) break;
		const source = sources.get(k - period);
		if (source == null) break;
		// A mirror pattern copies the piece two hits back, which equals mirroring the previous one
		const entity = copyLinkedPiece(source, hit.id, false, { entities, id: idFor(hit.id) });
		entities.push(entity);
		sources.set(k, entity);
		ghosts.push({ hit, entity });
	}
	if (!ghosts.length) return null;

	const last = ghosts[ghosts.length - 1] as { hit: THit };
	// A flat probe on the hit after the last ghost checks that the run can go on from there
	const lastIndex = lane.hits.indexOf(last.hit);
	const after = lane.hits[lastIndex + 1];
	const probe =
		after != null && !owners.has(after.id) && after.time - last.hit.time <= longGap
			? createLinkedPiece('platform', laneId, after.id, 0, { id: `${idFor(after.id)}-probe` })
			: null;
	const trial = simulateTrial(
		simulate,
		withEntities(project, [...ghosts.map((ghost) => ghost.entity), ...(probe != null ? [probe] : [])]),
		(probe != null && after != null ? after.time : last.hit.time) + 0.05
	);
	const isProbeBlocked =
		probe != null && trial.pieces.find((piece) => piece.entityId === probe.id)?.status === 'blocked';
	const band = frameBand(project, laneId);
	const isShared = project.entities.filter((entity) => entity.components.marble != null).length > 1;
	const pace = result.pace ?? descentPace(project, result.hits);
	const openDot = open.result?.dot ?? null;
	const allowed =
		pace != null && openDot != null && isShared
			? Math.max(pace.limit, Math.abs(openDot.y - paceAt(pace, open.hit.time)) + PACE_SLACK)
			: Infinity;
	const suggestions: TContinueSuggestion[] = [];
	for (const ghost of ghosts) {
		const hitResult = findHitResult(trial, laneId, ghost.hit.id);
		const dot = hitResult?.dot ?? null;
		const isInFrame = dot != null && isInBand(dot, band, 1);
		const status = hitResult?.status ?? 'missed';
		const paceError = dot != null && pace != null ? dot.y - paceAt(pace, ghost.hit.time) : null;
		const isOk =
			isOnTime(status) &&
			isInFrame &&
			Math.abs(paceError ?? 0) <= allowed &&
			!(ghost === ghosts[ghosts.length - 1] && isProbeBlocked);
		suggestions.push({
			hitId: ghost.hit.id,
			entity: ghost.entity,
			piece: trial.pieces.find((piece) => piece.entityId === ghost.entity.id) ?? null,
			dot,
			status,
			error: hitResult?.error ?? null,
			isInFrame,
			paceError,
			isOk
		});
		if (!isOk) break;
	}
	return {
		pattern,
		suggestions,
		commands: suggestions
			.filter((suggestion) => suggestion.isOk)
			.map((suggestion) => ({ type: 'upsertEntity', entity: suggestion.entity }))
	};
}

/** Repeat when the recent angles are equal, mirror when they alternate in sign */
function detectPattern(angles: number[]): 'repeat' | 'mirror' | null {
	if (angles.length < 2) return null;
	const pairs = angles.slice(1).map((angle, i) => [angles[i] ?? 0, angle] as const);
	const isMirror = pairs.every(
		([a, b]) => Math.abs(a + b) <= ANGLE_TOLERANCE && Math.abs(b) > ANGLE_TOLERANCE
	);
	if (isMirror) return 'mirror';
	const isRepeat = pairs.every(([a, b]) => Math.abs(a - b) <= ANGLE_TOLERANCE);
	if (isRepeat) return 'repeat';
	// Fall back to the most recent pair alone
	const [a, b] = pairs[pairs.length - 1] ?? [0, 0];
	if (Math.abs(a + b) <= ANGLE_TOLERANCE && Math.abs(b) > ANGLE_TOLERANCE) return 'mirror';
	if (Math.abs(a - b) <= ANGLE_TOLERANCE) return 'repeat';
	return null;
}

// Guardrails

export interface TLongGap {
	laneId: string;
	fromHitId: string;
	toHitId: string;
	from: number;
	to: number;
	duration: number;
	/** Switchback, rail or tunnel linked to the gap's first hit, if one bridges it */
	bridgedBy: string | null;
}

/**
 * Gaps between consecutive hits that are too long for a bounce and need a switchback, rail or tunnel. The
 * threshold defaults to `longGapThreshold`: the interval whose bounce at the project's pace would rise
 * more than `MAX_BOUNCE_RISE`.
 */
export function findLongGaps(
	project: TProject,
	laneId: string,
	threshold = longGapThreshold(project)
): TLongGap[] {
	const lane = project.music.lanes.find((item) => item.id === laneId);
	if (lane == null) return [];
	const gaps: TLongGap[] = [];
	for (let i = 1; i < lane.hits.length; i++) {
		const from = lane.hits[i - 1] as THit;
		const to = lane.hits[i] as THit;
		const duration = to.time - from.time;
		if (duration <= threshold) continue;
		const bridge = project.entities.find((entity) => {
			const { piece, hitLink } = entity.components;
			if (piece == null || hitLink == null) return false;
			const kind = layoutOf(piece.type);
			return (
				(kind === 'path' || kind === 'tube' || kind === 'holder') &&
				hitLink.laneId === laneId &&
				hitLink.hitId === from.id
			);
		});
		gaps.push({
			laneId,
			fromHitId: from.id,
			toHitId: to.id,
			from: from.time,
			to: to.time,
			duration,
			bridgedBy: bridge?.id ?? null
		});
	}
	return gaps;
}

/**
 * Unbridged long gaps of the lane whose first hit has a piece and whose last hit has none, in time order.
 * Next serves these before any later hit: the marble may fall so far across such a gap that the hit after
 * it has no dot until a switchback, rail or tunnel catches it.
 */
export function openLongGaps(project: TProject, laneId: string): TLongGap[] {
	const owners = hitOwners(project, laneId);
	return findLongGaps(project, laneId).filter(
		(gap) => gap.bridgedBy == null && owners.has(gap.fromHitId) && !owners.has(gap.toHitId)
	);
}

// Shared helpers

/** Pieces that sound each hit of the lane: linked musical pieces (platforms), never scenery */
export function hitOwners(project: TProject, laneId: string): Map<string, TEntity> {
	const owners = new Map<string, TEntity>();
	for (const entity of project.entities) {
		const { piece, hitLink } = entity.components;
		if (piece == null || hitLink == null || hitLink.laneId !== laneId) continue;
		if (getPieceDefinition(piece.type) == null) continue;
		if (!soundsHit(piece.type, hitLink)) continue;
		if (!owners.has(hitLink.hitId)) owners.set(hitLink.hitId, entity);
	}
	return owners;
}

export function findHitResult(
	result: TSimulationResult | null,
	laneId: string,
	hitId: string
): THitResult | null {
	return result?.hits.find((hit) => hit.laneId === laneId && hit.hitId === hitId) ?? null;
}

/** Project copy with the entities added or replaced and the run ending at `until` */
export function simulateTrial(
	simulate: TSimulateFn,
	project: TProject,
	until: number
): TSimulationResult {
	return simulate({ ...project, end: Math.max(1 / 240, Math.min(project.end, until)) });
}

export function withEntities(project: TProject, entities: TEntity[]): TProject {
	const replaced = new Map(entities.map((entity) => [entity.id, entity]));
	const kept = project.entities.map((entity) => replaced.get(entity.id) ?? entity);
	const added = entities.filter((entity) => !project.entities.some((e) => e.id === entity.id));
	return { ...project, entities: [...kept, ...added] };
}

export function isInBand(point: TVec2, band: TFrameBand, share: number): boolean {
	return Math.abs(point.x - band.centerX) <= band.halfWidth * share;
}

function isOnTime(status: THitStatus | undefined): boolean {
	return status === 'onTime' || status === 'drifting';
}

/**
 * Sets a piece's `bounce` so the marble reaches the next hit, `interval` seconds later, at the steady
 * speed of the default bounce. Hits that regular settle where each bounce sends the marble back at the
 * speed it arrived with, `g·interval / (1 + e)` downward, and a bounce of `e·steady / speed` turns a
 * faster or slower arrival into that speed. It sheds the energy of a long fall from the release in one
 * hit, where the default bounce alone would leave the marble rising at the next hits for many more.
 * Pieces without a `bounce` parameter are unchanged.
 */
function withSettlingBounce(
	entity: TEntity,
	velocity: TVec2 | null,
	interval: number,
	g = -GRAVITY_Y
): TEntity {
	const { piece } = entity.components;
	const spec = piece != null ? getPieceDefinition(piece.type)?.params['bounce'] : undefined;
	if (piece == null || spec == null || velocity == null) return entity;
	const steady = (g * interval) / (1 + spec.default);
	const speed = -velocity.y;
	const bounce =
		speed > 0 ? Math.min(spec.max, Math.max(spec.min, (spec.default * steady) / speed)) : spec.max;
	return {
		...entity,
		components: {
			...entity.components,
			piece: { ...piece, params: { ...piece.params, bounce: Math.round(bounce * 100) / 100 } }
		}
	};
}

/**
 * Platform bounce that sends a marble arriving at `velocity` up at `takeoff` after striking a surface at
 * `angle`. Restitution scales the normal part of the arrival, so the vertical takeoff is the vertical part
 * of the tangential velocity plus the bounce times `gain`, the vertical share of the normal speed. Friction
 * and spin change the tangential part a little, which the caller corrects by simulation.
 */
function paceBounce(
	velocity: TVec2 | null,
	angle: number,
	takeoff: number,
	spec: { min: number; max: number }
): { bounce: number; gain: number } | null {
	if (velocity == null) return null;
	let normal = surfaceNormal(angle);
	if (normal.x * velocity.x + normal.y * velocity.y > 0) normal = { x: -normal.x, y: -normal.y };
	const normalSpeed = velocity.x * normal.x + velocity.y * normal.y;
	const gain = -normalSpeed * normal.y;
	if (gain < 1e-6) return null;
	const tangentialY = velocity.y - normalSpeed * normal.y;
	return { bounce: clampBounce((takeoff - tangentialY) / gain, spec), gain };
}

function clampBounce(bounce: number, spec: { min: number; max: number } | undefined): number {
	if (spec == null) return bounce;
	return Math.round(Math.min(spec.max, Math.max(spec.min, bounce)) * 100) / 100;
}

function withBounce(entity: TEntity, bounce: number | null): TEntity {
	const { piece } = entity.components;
	if (piece == null || bounce == null) return entity;
	return {
		...entity,
		components: { ...entity.components, piece: { ...piece, params: { ...piece.params, bounce } } }
	};
}

function withAngle(entity: TEntity, angle: number): TEntity {
	const { hitLink } = entity.components;
	if (hitLink == null) return entity;
	return { ...entity, components: { ...entity.components, hitLink: { ...hitLink, angle } } };
}

/**
 * True when, between the hit and `until`, the lane's marble touches another hit piece or marble, or another
 * marble touches the piece. Free, anchored and scenery pieces are environment and may be struck. Another marble counts only up to `frontiers`, its next open hit: after that
 * it flies freely until its own next piece exists.
 */
function hasStrayContact(
	result: TSimulationResult,
	project: TProject,
	laneId: string,
	entityId: string,
	from: number,
	until: number,
	frontiers: Map<string, number> = new Map()
): boolean {
	const marble = project.entities.find((entity) => entity.components.marble?.laneId === laneId);
	// Free, anchored and scenery pieces are environment the marble may strike; only hit pieces are stray
	const environment = new Set(
		project.entities
			.filter((entity) => {
				const { piece, hitLink } = entity.components;
				return piece != null && entity.id !== entityId && !soundsHit(piece.type, hitLink);
			})
			.map((entity) => entity.id)
	);
	return result.contacts.some((contact) => {
		if (contact.time <= from + 0.005 || contact.time >= until - 0.03) return false;
		if (contact.marbleEntityId !== marble?.id) {
			if (contact.time > (frontiers.get(contact.marbleEntityId) ?? Infinity)) return false;
			return contact.otherEntityId === entityId;
		}
		if (contact.kind === 'marble' && contact.time > (frontiers.get(contact.otherEntityId) ?? Infinity))
			return false;
		if (contact.kind === 'piece' && environment.has(contact.otherEntityId)) return false;
		return contact.otherEntityId !== entityId;
	});
}

/**
 * True when a trial with a new piece of `laneId` crosses another lane between `from` and `until`: the lane's
 * marble touches another lane's piece or another marble, another marble touches the new piece, or a hit of
 * another lane that was on time in `base` no longer is. Narrow lanes put the other lane's pieces within
 * reach, and a piece another marble only passes near still enters its world. Each other marble counts up to
 * its frontier (`openFrontiers`), beyond which its path is unbuilt free fall.
 */
export function crossesOtherLanes(
	base: TSimulationResult,
	trial: TSimulationResult,
	project: TProject,
	laneId: string,
	entityId: string,
	from: number,
	until: number,
	frontiers: Map<string, number>
): boolean {
	const marbleOf = new Map(
		project.entities.flatMap((entity) =>
			entity.components.marble != null ? [[entity.components.marble.laneId, entity.id] as const] : []
		)
	);
	const marbleId = marbleOf.get(laneId);
	const laneOfPiece = new Map(
		project.entities.flatMap((entity) =>
			entity.components.hitLink != null ? [[entity.id, entity.components.hitLink.laneId] as const] : []
		)
	);
	const isCrossing = trial.contacts.some((contact) => {
		if (contact.time <= from + 0.005 || contact.time >= until - 0.01) return false;
		if (contact.marbleEntityId !== marbleId)
			return contact.otherEntityId === entityId && contact.time <= (frontiers.get(contact.marbleEntityId) ?? Infinity);
		if (contact.kind === 'marble') return contact.time <= (frontiers.get(contact.otherEntityId) ?? Infinity);
		const pieceLane = laneOfPiece.get(contact.otherEntityId);
		return pieceLane != null && pieceLane !== laneId;
	});
	if (isCrossing) return true;
	const before = new Map(base.hits.map((hit) => [`${hit.laneId}/${hit.hitId}`, hit.status]));
	return trial.hits.some(
		(hit) =>
			hit.laneId !== laneId &&
			hit.targetTime < until - 0.02 &&
			hit.targetTime < (frontiers.get(marbleOf.get(hit.laneId) ?? '') ?? Infinity) &&
			isOnTime(before.get(`${hit.laneId}/${hit.hitId}`)) &&
			!isOnTime(hit.status)
	);
}

/**
 * Time after which each marble's path is not built yet: its first open hit, or shortly after the launch
 * into a long gap that no switchback, rail or tunnel bridges yet, across which it falls freely
 */
export function openFrontiers(project: TProject, result: TSimulationResult): Map<string, number> {
	const frontiers = new Map<string, number>();
	const marbleOf = (laneId: string): string | undefined =>
		project.entities.find((entity) => entity.components.marble?.laneId === laneId)?.id;
	const earlier = (marbleId: string | undefined, time: number): void => {
		if (marbleId != null) frontiers.set(marbleId, Math.min(frontiers.get(marbleId) ?? Infinity, time));
	};
	for (const hit of result.hits) if (hit.status === 'open') earlier(marbleOf(hit.laneId), hit.targetTime);
	for (const lane of project.music.lanes) {
		for (const gap of openLongGaps(project, lane.id)) earlier(marbleOf(lane.id), gap.from + launchHorizon(project));
	}
	return frontiers;
}

/** How long after a launch hit Auto place follows the hop into the coming gap */
function launchHorizon(project: TProject): number {
	return LAUNCH_HORIZON / Math.sqrt(gravityOf(project) / GRAVITY_Y);
}

function staysInBand(
	result: TSimulationResult,
	laneId: string,
	from: number,
	until: number,
	band: TFrameBand
): boolean {
	const samples = result.marbles.find((marble) => marble.laneId === laneId)?.samples ?? [];
	return samples.every(
		(sample) => sample.time < from || sample.time > until || isInBand(sample.position, band, 1)
	);
}
