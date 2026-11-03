import { Err, Ok, type TResult } from 'tuple-result';
import {
	createId,
	type TEntity,
	type TProject,
	type TProjectCommand,
	type TVec2
} from '@/modules/project';
import { findHitResult, isInBand, simulateTrial, withEntities, type TSimulateFn } from './assists';
import { layoutOf } from './piece-layout';
import { getPieceDefinition, resolvePieceParams } from './pieces';
import { frameBand } from './placement';
import { projectOnPath } from './shapes';
import { trajectoryAt } from './simulate';
import { PHYSICS_HZ, type THitStatus, type TSimulationResult } from './types';

// Rails and tunnels for long gaps. The piece is anchored to the trajectory like a platform: it is linked
// to the hit before the gap with an entry delay, and at that time its start lies tangent under the
// marble. Upstream edits move it along with the trajectory. After it the marble flies freely, and the
// next hit's piece is placed by construction where the marble is at that hit, so timing never depends on
// the rail. Length and slope only shape the path through the gap.

export interface TGapPieceOptions {
	/** When the marble enters. Defaults to shortly after the bounce apex following the first hit. */
	entryTime?: number;
	/** Horizontal run downhill from the entry in metres. Defaults to what fits in the frame band, at most 0.25 m. */
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
	entity: TEntity;
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
}

/** Rail starting under the marble shortly after `fromHitId`, bridging the gap to `toHitId` */
export function createRailForGap(
	project: TProject,
	result: TSimulationResult,
	laneId: string,
	fromHitId: string,
	toHitId: string,
	options: TGapPieceOptions = {}
): TResult<TGapPieceProposal, Error> {
	return createGapPiece('rail', project, result, laneId, fromHitId, toHitId, options);
}

/** Tunnel starting under the marble shortly after `fromHitId`, bridging the gap to `toHitId` */
export function createTunnelForGap(
	project: TProject,
	result: TSimulationResult,
	laneId: string,
	fromHitId: string,
	toHitId: string,
	options: TGapPieceOptions = {}
): TResult<TGapPieceProposal, Error> {
	return createGapPiece('tunnel', project, result, laneId, fromHitId, toHitId, options);
}

const DEGREE = Math.PI / 180;
const LEAD_IN = 0.006;
const FRAME_MARGIN = 0.03;
const MAX_LENGTH = 0.25;
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

function createGapPiece(
	type: 'rail' | 'tunnel',
	project: TProject,
	result: TSimulationResult,
	laneId: string,
	fromHitId: string,
	toHitId: string,
	options: TGapPieceOptions
): TResult<TGapPieceProposal, Error> {
	const lane = project.music.lanes.find((item) => item.id === laneId);
	const from = lane?.hits.find((hit) => hit.id === fromHitId);
	const to = lane?.hits.find((hit) => hit.id === toHitId);
	if (lane == null || from == null || to == null)
		return Err(new Error('Both hits must exist in the lane'));
	if (to.time <= from.time) return Err(new Error('The gap must end after it starts'));
	const samples = result.marbles.find((marble) => marble.laneId === laneId)?.samples ?? [];
	const band = frameBand(project);

	// Replaces an earlier rail or tunnel on the same hit
	const replaced = project.entities.find((entity) => {
		const { piece, hitLink } = entity.components;
		return (
			piece != null &&
			hitLink?.laneId === laneId &&
			hitLink.hitId === fromHitId &&
			(layoutOf(piece.type) === 'path' || layoutOf(piece.type) === 'tube')
		);
	});
	const id = replaced?.id ?? options.id ?? createId('piece');
	const count = project.entities.filter(
		(entity) => entity.components.piece?.type === type && entity.id !== replaced?.id
	).length;
	const build = (candidate: TGapCandidate): TEntity =>
		gapEntity(type, id, count, laneId, fromHitId, candidate.entryTime - from.time, candidate);

	// Candidates: how far below the bounce apex the marble enters, whether the piece runs with the
	// marble's travel or against it, slope and length
	const entryTimes =
		options.entryTime != null
			? [options.entryTime]
			: [0.01, 0.05, 0.12]
					.map((drop) => findEntryTime(result, laneId, from.time, to.time, drop))
					.filter((time): time is number => time != null);
	const candidates: TGapCandidate[] = [];
	for (const entryTime of entryTimes) {
		if (entryTime <= from.time || entryTime >= to.time) continue;
		const entry = trajectoryAt(samples, entryTime);
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

	let chosen = first;
	let check: TGapPieceCheck | null = null;
	if (options.simulate != null) {
		const simulate = options.simulate;
		let best: { score: number; candidate: TGapCandidate; check: TGapPieceCheck } | null = null;
		for (const candidate of candidates) {
			const entity = build(candidate);
			const trial = simulateTrial(simulate, withEntities(project, [entity]), to.time + 0.02);
			const played = checkGapPiece(
				trial,
				project,
				laneId,
				entity.id,
				candidate.entryTime,
				to.id,
				to.time
			);
			if (played.pieceStatus !== 'placed') continue;
			const score =
				(played.isDotInFrame ? 0 : 10) +
				(played.isRunInFrame ? 0 : 5) +
				(played.leaveTime == null ? 20 : Math.abs(to.time - played.leaveTime - PREFERRED_DROP)) +
				(played.nextStatus === 'missed' || played.nextStatus === 'blocked' ? 10 : 0);
			if (best == null || score < best.score - 1e-9) best = { score, candidate, check: played };
		}
		if (best == null) return Err(new Error('Every candidate crosses the earlier trajectory'));
		chosen = best.candidate;
		check = best.check;
	}

	const entity = build(chosen);
	return Ok({
		entity,
		commands: [{ type: 'upsertEntity', entity }],
		entryTime: chosen.entryTime,
		length: chosen.length,
		slope: chosen.slope,
		check
	});
}

/**
 * First time after the hit when the marble falls and has dropped `drop` below its apex, leaving at least
 * 0.3 s before the gap ends
 */
export function findEntryTime(
	result: TSimulationResult,
	laneId: string,
	from: number,
	to: number,
	drop = 0.01
): number | null {
	const samples = result.marbles.find((marble) => marble.laneId === laneId)?.samples ?? [];
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

function gapEntity(
	type: 'rail' | 'tunnel',
	id: string,
	count: number,
	laneId: string,
	hitId: string,
	entryDelay: number,
	candidate: TGapCandidate
): TEntity {
	const { downhill, length, catchLength, slope } = candidate;
	const definition = getPieceDefinition(type);
	const params = resolvePieceParams(type, { entryDelay: Math.round(entryDelay * 1000) / 1000 });
	// Local path along the downhill direction through the entry point at the origin, with the catch
	// section behind it. The angle tilts it downhill.
	const scale = 1 / Math.cos(slope);
	return {
		id,
		name: `${definition?.label ?? type} ${count + 1}`,
		components: {
			piece: { type, params },
			path: {
				points: [
					{ x: round(-downhill * catchLength * scale), y: 0 },
					{ x: 0, y: 0 },
					{ x: round(downhill * length * scale), y: 0 }
				]
			},
			hitLink: { laneId, hitId, angle: -downhill * slope, contactAt: 0.5, pinned: false }
		}
	};
}

function round(value: number): number {
	return Math.round(value * 1e5) / 1e5;
}

function checkGapPiece(
	trial: TSimulationResult,
	project: TProject,
	laneId: string,
	entityId: string,
	entryTime: number,
	toHitId: string,
	toTime: number
): TGapPieceCheck {
	const band = frameBand(project);
	const piece = trial.pieces.find((item) => item.entityId === entityId);
	const marble = trial.marbles.find((item) => item.laneId === laneId);
	const next = findHitResult(trial, laneId, toHitId);
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
		nextStatus: next?.pieceEntityId != null ? next.status : null
	};
}
