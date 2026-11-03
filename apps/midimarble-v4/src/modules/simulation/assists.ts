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
import { GRAVITY_Y } from './geometry';
import { layoutOf } from './piece-layout';
import { getPieceDefinition, isFollowerPiece, resolvePieceParams } from './pieces';
import { createLinkedPiece, frameBand, type TFrameBand } from './placement';
import { wrapAngle, type TPieceShape } from './shapes';
import {
	HIT_TOLERANCE,
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
	/** Angle range searched, in radians. Defaults to −40° to 40°. */
	range?: [number, number];
	/** Piece type for a hit without a piece */
	type?: string;
}

export interface TAutoPlacement extends TAssistPlacement {
	angle: number;
	/**
	 * Dot of the following hit with the chosen angle. Null when the lane has no later hit or the next
	 * hit lies after a long gap, which a rail or tunnel bridges.
	 */
	nextDot: TVec2 | null;
	/** Horizontal marble travel from this hit's dot to the next dot, or over the horizon without one */
	travel: number;
}

const DEGREE = Math.PI / 180;

/**
 * Auto place objective. Each candidate angle is simulated and must pass the hard checks: the hit stays
 * on time, before the next hit the marble touches nothing else and no other marble touches the piece,
 * the next dot lies in the inner 90 % of the frame band and a flat probe piece fits at it. Without a
 * next hit in reach the marble must stay in the band over a horizon instead: `LAST_HIT_HORIZON` after
 * the lane's last hit and `LAUNCH_HORIZON` before a long gap, where a rail or tunnel picks the marble
 * up. Passing candidates are ranked by a score, lower is better, that sums:
 *
 * - travel: `TRAVEL_WEIGHT` per share of `minTravel` the horizontal travel falls short of it, so the
 *   marble never bounces in place. `minTravel` is the piece length plus `CLEARANCE` at each end, which
 *   also keeps the next piece clear of this one.
 * - restrike: `RESTRIKE_WEIGHT` per time the marble strikes the piece again before the next hit, which
 *   sounds an extra note. Short intervals after a low bounce sometimes leave no clean angle.
 * - clearance: `CLEARANCE_WEIGHT` per share of `CLEARANCE` that the new piece's colliders, the next
 *   piece's colliders or the marble path come closer than `CLEARANCE` to another piece, overlaps
 *   included. Other lanes' open hits count as flat platforms at their dots from their hit time on.
 * - band: `BAND_WEIGHT` times the squared offset of the next dot from the frame centre, in half widths,
 *   plus `TRAVEL_WEIGHT` per half width the path leaves the band
 * - comfort: `COMFORT_WEIGHT` times the relative difference between the travel and a comfortable
 *   travel: the previous hit's travel when that was long enough, `COMFORT_TRAVEL` otherwise
 * - pattern: `PATTERN_WEIGHT` when the travel goes the other way than the neighbours suggest, which is
 *   back after a single step (zigzag) and onward after two steps the same way (staircase), plus
 *   `ANGLE_WEIGHT` times the distance to the previous piece's angle or its mirror, in 40° units
 * - a tie break of 0.001 per radian toward flatter angles
 *
 * The travel and clearance weights dominate, so a short or crowded candidate wins only when nothing else
 * passes the hard checks.
 *
 * Before the search, a piece with a `bounce` parameter gets the bounce that brings the marble to the
 * next hit at the steady speed of the default bounce (`withSettlingBounce`), so a fast or slow arrival
 * does not carry over into the following hits.
 */
const CLEARANCE = 0.004;
const COMFORT_TRAVEL = 0.12;
const LAST_HIT_HORIZON = 0.5;
const LAUNCH_HORIZON = 0.3;
/** Same default as `findLongGaps` */
const LONG_GAP = 1.2;
const TRAVEL_WEIGHT = 10;
const CLEARANCE_WEIGHT = 10;
const BAND_WEIGHT = 0.6;
const COMFORT_WEIGHT = 0.5;
const PATTERN_WEIGHT = 0.3;
const ANGLE_WEIGHT = 0.2;
const RESTRIKE_WEIGHT = 5;

interface TCandidate {
	angle: number;
	score: number;
	nextDot: TVec2 | null;
	travel: number;
}

/**
 * Chooses the angle for a hit's piece by the Auto place objective above. Candidates every 5°, refined
 * to 1° around the best. Ties go to the first candidate searched, so the choice is deterministic.
 */
export function autoPlace(
	project: TProject,
	result: TSimulationResult,
	laneId: string,
	hitId: string,
	options: TAutoPlaceOptions
): TResult<TAutoPlacement, Error> {
	const { simulate, range = [-40 * DEGREE, 40 * DEGREE], type = 'platform' } = options;
	const lane = project.music.lanes.find((item) => item.id === laneId);
	const index = lane?.hits.findIndex((hit) => hit.id === hitId) ?? -1;
	const hit = lane?.hits[index];
	if (lane == null || hit == null)
		return Err(new Error(`Hit ${hitId} does not exist in lane ${laneId}`));
	const dot = findHitResult(result, laneId, hitId)?.dot;
	if (dot == null) return Err(new Error('The marble does not reach this hit'));

	const owners = hitOwners(project, laneId);
	const existing = owners.get(hitId);
	let base =
		existing ??
		createLinkedPiece(type, laneId, hitId, 0, { entities: project.entities, id: options.id });
	let previousAngle: number | null = null;
	for (let i = index - 1; i >= 0 && previousAngle == null; i--) {
		const previous = owners.get(lane.hits[i]?.id ?? '');
		if (previous?.components.hitLink != null) previousAngle = previous.components.hitLink.angle;
	}
	const followingHit = lane.hits[index + 1] ?? null;
	const nextHit =
		followingHit != null && followingHit.time - hit.time <= LONG_GAP ? followingHit : null;
	if (nextHit != null) {
		const velocity = findHitResult(result, laneId, hitId)?.velocity ?? null;
		base = withSettlingBounce(base, velocity, nextHit.time - hit.time);
	}
	const band = frameBand(project);
	const until =
		nextHit != null
			? nextHit.time + 0.02
			: hit.time + (followingHit != null ? LAUNCH_HORIZON : LAST_HIT_HORIZON);
	const marbleRadius =
		project.entities.find((entity) => entity.components.marble?.laneId === laneId)?.components
			.marble?.radius ?? 0;
	const pieceLength = resolvePieceParams(
		base.components.piece?.type ?? type,
		base.components.piece?.params ?? {}
	)['length'];
	const minTravel = (pieceLength ?? 0.06) + 2 * CLEARANCE;
	const pattern = travelPattern(result, laneId, lane.hits, index, owners, minTravel);
	const reserved = reservedSpots(project, result, laneId, until);

	const rejected = { blocked: 0, missed: 0, strayContact: 0, outOfFrame: 0, nextBlocked: 0 };
	const evaluate = (angle: number): Omit<TCandidate, 'angle'> | null => {
		const entity = withAngle(base, angle);
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
		const hitResult = findHitResult(trial, laneId, hitId);
		if (!isOnTime(hitResult?.status)) {
			if (hitResult?.status === 'blocked') rejected.blocked++;
			else rejected.missed++;
			return null;
		}
		if (hasStrayContact(trial, project, laneId, entity.id, hit.time, until)) {
			rejected.strayContact++;
			return null;
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
		if (nextHit != null) {
			nextDot = findHitResult(trial, laneId, nextHit.id)?.dot ?? null;
			if (nextDot == null || !isInBand(nextDot, band, 0.9)) {
				rejected.outOfFrame++;
				return null;
			}
			const probed = trial.pieces.find((piece) => piece.entityId === probe?.id);
			if (probed?.status === 'blocked') {
				rejected.nextBlocked++;
				return null;
			}
			end = nextDot;
		} else {
			if (!staysInBand(trial, laneId, hit.time, until, band)) {
				rejected.outOfFrame++;
				return null;
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
		const centrality = end != null ? (end.x - band.centerX) / band.halfWidth : 0;
		const comfort = pattern.travel ?? COMFORT_TRAVEL;
		const isAgainstPattern = pattern.side != null && Math.sign(travel) !== pattern.side;
		const consistency =
			previousAngle != null
				? Math.min(Math.abs(angle - previousAngle), Math.abs(angle + previousAngle)) / (40 * DEGREE)
				: 0;
		const score =
			(TRAVEL_WEIGHT * Math.max(0, minTravel - distance)) / minTravel +
			(CLEARANCE_WEIGHT * shortfall) / CLEARANCE +
			BAND_WEIGHT * centrality * centrality +
			TRAVEL_WEIGHT * outside +
			(COMFORT_WEIGHT * Math.abs(distance - comfort)) / comfort +
			(isAgainstPattern ? PATTERN_WEIGHT : 0) +
			RESTRIKE_WEIGHT * restrikes +
			ANGLE_WEIGHT * consistency +
			1e-3 * Math.abs(angle);
		return { score, nextDot, travel };
	};

	const search = (angles: number[], best: TCandidate | null): TCandidate | null => {
		let chosen = best;
		for (const angle of angles) {
			const rounded = Math.round(angle / DEGREE) * DEGREE;
			if (rounded < range[0] - 1e-9 || rounded > range[1] + 1e-9) continue;
			const evaluated = evaluate(rounded);
			if (evaluated != null && (chosen == null || evaluated.score < chosen.score - 1e-12))
				chosen = { angle: rounded, ...evaluated };
		}
		return chosen;
	};
	const coarseAngles: number[] = [];
	for (let angle = range[0]; angle <= range[1] + 1e-9; angle += 5 * DEGREE)
		coarseAngles.push(angle);
	const coarse = search(coarseAngles, null);
	if (coarse == null) {
		return Err(
			new Error(
				`No angle keeps the next dot on time and in frame (${rejected.blocked} blocked, ${rejected.missed} missed, ${rejected.strayContact} touch something else, ${rejected.outOfFrame} out of frame, ${rejected.nextBlocked} leave no room at the next dot)`
			)
		);
	}
	const chosen =
		search(
			[-4, -3, -2, -1, 1, 2, 3, 4].map((offset) => coarse.angle + offset * DEGREE),
			coarse
		) ?? coarse;

	const entity = withAngle(base, chosen.angle);
	return Ok({
		hitId,
		entity,
		angle: chosen.angle,
		nextDot: chosen.nextDot,
		travel: chosen.travel,
		commands: [{ type: 'upsertEntity', entity }]
	});
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
	/** On time and in frame; suggestions stop after the first that is not */
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
 * inter-onset interval matches the interval one pattern period earlier. The ghosts are verified in one
 * simulation and cut after the first that misses or leaves the frame band. Returns null when there is
 * no pattern to continue.
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
		const interval = hit.time - previous.time;
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
	const trial = simulateTrial(
		simulate,
		withEntities(
			project,
			ghosts.map((ghost) => ghost.entity)
		),
		last.hit.time + 0.05
	);
	const band = frameBand(project);
	const suggestions: TContinueSuggestion[] = [];
	for (const ghost of ghosts) {
		const hitResult = findHitResult(trial, laneId, ghost.hit.id);
		const dot = hitResult?.dot ?? null;
		const isInFrame = dot != null && isInBand(dot, band, 1);
		const status = hitResult?.status ?? 'missed';
		const isOk = isOnTime(status) && isInFrame;
		suggestions.push({
			hitId: ghost.hit.id,
			entity: ghost.entity,
			piece: trial.pieces.find((piece) => piece.entityId === ghost.entity.id) ?? null,
			dot,
			status,
			error: hitResult?.error ?? null,
			isInFrame,
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
	/** Rail or tunnel linked to the gap's first hit, if one bridges it */
	bridgedBy: string | null;
}

/** Gaps between consecutive hits that are too long for a bounce and need a rail or tunnel */
export function findLongGaps(project: TProject, laneId: string, threshold = 1.2): TLongGap[] {
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
				(kind === 'path' || kind === 'tube') &&
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

// Shared helpers

/** Pieces that sound each hit of the lane: linked, not followers */
export function hitOwners(project: TProject, laneId: string): Map<string, TEntity> {
	const owners = new Map<string, TEntity>();
	for (const entity of project.entities) {
		const { piece, hitLink } = entity.components;
		if (piece == null || hitLink == null || hitLink.laneId !== laneId) continue;
		if (getPieceDefinition(piece.type) == null) continue;
		if (isFollowerPiece(resolvePieceParams(piece.type, piece.params))) continue;
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
function withSettlingBounce(entity: TEntity, velocity: TVec2 | null, interval: number): TEntity {
	const { piece } = entity.components;
	const spec = piece != null ? getPieceDefinition(piece.type)?.params['bounce'] : undefined;
	if (piece == null || spec == null || velocity == null) return entity;
	const steady = (-GRAVITY_Y * interval) / (1 + spec.default);
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

function withAngle(entity: TEntity, angle: number): TEntity {
	const { hitLink } = entity.components;
	if (hitLink == null) return entity;
	return { ...entity, components: { ...entity.components, hitLink: { ...hitLink, angle } } };
}

/**
 * True when, between the hit and `until`, the lane's marble touches another piece or marble, or another
 * marble touches the piece
 */
function hasStrayContact(
	result: TSimulationResult,
	project: TProject,
	laneId: string,
	entityId: string,
	from: number,
	until: number
): boolean {
	const marble = project.entities.find((entity) => entity.components.marble?.laneId === laneId);
	return result.contacts.some((contact) => {
		if (contact.time <= from + 0.005 || contact.time >= until - 0.03) return false;
		if (contact.marbleEntityId !== marble?.id) return contact.otherEntityId === entityId;
		return contact.otherEntityId !== entityId;
	});
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
