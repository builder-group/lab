import { Err, Ok, type TResult } from 'tuple-result';
import {
	createId,
	type TEntity,
	type THit,
	type TProject,
	type TProjectCommand,
	type TVec2
} from '@/modules/project';
import { layoutOf } from './piece-layout';
import { getPieceDefinition, isFollowerPiece, resolvePieceParams } from './pieces';
import { createLinkedPiece, frameBand, type TFrameBand } from './placement';
import { wrapAngle } from './shapes';
import type { THitResult, THitStatus, TResolvedPiece, TSimulationResult } from './types';

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
	/** Dot of the following hit with the chosen angle, null when the lane has no later hit */
	nextDot: TVec2 | null;
}

const DEGREE = Math.PI / 180;

interface TCandidate {
	angle: number;
	score: number;
	nextDot: TVec2 | null;
}

/**
 * Chooses the angle for a hit's piece. Candidates every 5°, refined to 1°, must keep the hit on time,
 * reach the next hit's dot inside the frame band without touching other pieces on the way, and are
 * ranked by how central the next dot is and how close the angle is to the previous piece's angle or its
 * mirror. Ties go to the smaller angle, so the choice is deterministic.
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
	const base =
		existing ??
		createLinkedPiece(type, laneId, hitId, 0, { entities: project.entities, id: options.id });
	let previousAngle: number | null = null;
	for (let i = index - 1; i >= 0 && previousAngle == null; i--) {
		const previous = owners.get(lane.hits[i]?.id ?? '');
		if (previous?.components.hitLink != null) previousAngle = previous.components.hitLink.angle;
	}
	const nextHit = lane.hits[index + 1] ?? null;
	const band = frameBand(project);
	const until = nextHit != null ? nextHit.time + 0.02 : hit.time + 0.5;

	const rejected = { blocked: 0, missed: 0, strayContact: 0, outOfFrame: 0, nextBlocked: 0 };
	const evaluate = (angle: number): { score: number; nextDot: TVec2 | null } | null => {
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
		let nextDot: TVec2 | null = null;
		let centrality = 0;
		if (nextHit != null) {
			nextDot = findHitResult(trial, laneId, nextHit.id)?.dot ?? null;
			if (nextDot == null || !isInBand(nextDot, band, 0.9)) {
				rejected.outOfFrame++;
				return null;
			}
			centrality = Math.abs(nextDot.x - band.centerX) / band.halfWidth;
			const probed = trial.pieces.find((piece) => piece.entityId === probe?.id);
			if (probed?.status === 'blocked') {
				rejected.nextBlocked++;
				return null;
			}
		} else if (!staysInBand(trial, laneId, hit.time, until, band)) {
			rejected.outOfFrame++;
			return null;
		}
		const consistency =
			previousAngle != null
				? Math.min(Math.abs(angle - previousAngle), Math.abs(angle + previousAngle)) / (40 * DEGREE)
				: 0;
		return { score: centrality + 0.5 * consistency + 1e-3 * Math.abs(angle), nextDot };
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
		commands: [{ type: 'upsertEntity', entity }]
	});
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

function withAngle(entity: TEntity, angle: number): TEntity {
	const { hitLink } = entity.components;
	if (hitLink == null) return entity;
	return { ...entity, components: { ...entity.components, hitLink: { ...hitLink, angle } } };
}

/** True when the lane's marble touches another piece or marble between the hit and `until` */
function hasStrayContact(
	result: TSimulationResult,
	project: TProject,
	laneId: string,
	entityId: string,
	from: number,
	until: number
): boolean {
	const marble = project.entities.find((entity) => entity.components.marble?.laneId === laneId);
	return result.contacts.some(
		(contact) =>
			contact.marbleEntityId === marble?.id &&
			contact.time > from + 0.005 &&
			contact.time < until - 0.03 &&
			contact.otherEntityId !== entityId
	);
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
