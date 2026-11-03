import { Err, Ok, type TResult } from 'tuple-result';
import {
	createId,
	type TEntity,
	type TProject,
	type TProjectCommand,
	type TVec2
} from '@/modules/project';
import {
	findHitResult,
	hitOwners,
	isInBand,
	simulateTrial,
	withEntities,
	type TSimulateFn
} from './assists';
import { gravityOf } from './geometry';
import { descentPace, paceAt } from './pace';
import { layoutOf, switchbackGeometry, switchbackHoldTime } from './piece-layout';
import { getPieceDefinition, KIT_SCALE, resolvePieceParams } from './pieces';
import { createLinkedPiece, frameBand } from './placement';
import { projectOnPath, shapesBounds } from './shapes';
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
	/** Horizontal run downhill from the entry in metres. Defaults to what fits in the frame band, at most 0.375 m. */
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
	/** Height of the next hit's dot above the shared pace y*, when the project has a pace */
	paceError?: number | null;
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
	const band = frameBand(project, laneId);

	// Replaces an earlier gap piece on the same hit
	const replaced = findGapPiece(project, laneId, fromHitId);
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

	let chosen = first;
	let check: TGapPieceCheck | null = null;
	if (options.simulate != null) {
		const simulate = options.simulate;
		let best: { score: number; candidate: TGapCandidate; check: TGapPieceCheck } | null = null;
		const hasPiece = hitOwners(project, laneId).has(to.id);
		for (const candidate of candidates) {
			const entity = build(candidate);
			// A flat probe on the next hit checks that the marble has left the piece with room for a platform
			const probe = !hasPiece
				? createLinkedPiece('platform', laneId, to.id, 0, { id: `${entity.id}-probe` })
				: null;
			const trial = simulateTrial(
				simulate,
				withEntities(project, probe != null ? [entity, probe] : [entity]),
				to.time + 0.02
			);
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
			if (best == null || score < best.score - 1e-9)
				best = { score, candidate, check: hasPiece ? played : { ...played, nextStatus: null } };
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
	const band = frameBand(project, laneId);
	const pace = trial.pace ?? descentPace(project, trial.hits);
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
		nextStatus: next?.pieceEntityId != null ? next.status : null,
		paceError: dot != null && pace != null ? dot.y - paceAt(pace, toTime) : null
	};
}

/** The switchback, rail or tunnel linked to a hit of the lane, if any */
function findGapPiece(project: TProject, laneId: string, hitId: string): TEntity | undefined {
	return project.entities.find((entity) => {
		const { piece, hitLink } = entity.components;
		if (piece == null || hitLink?.laneId !== laneId || hitLink.hitId !== hitId) return false;
		const kind = layoutOf(piece.type);
		return kind === 'path' || kind === 'tube' || kind === 'holder';
	});
}

// Switchbacks

const SWITCHBACK_MARGIN = 0.01;
// How far below the launching hit the marble enters, so the switchback stays clear of the piece above it
// In marble diameters
const ENTRY_DROPS = [1.25, 2.5];
const SWITCHBACK_SLOPES = [2, 3, 5, 8, 12, 17].map((degrees) => degrees * DEGREE);
const SWITCHBACK_LEGS = [1, 2, 3, 4, 5, 6];
const SWITCHBACK_ENTRIES = [0.25, 0.5, 0.75];
// Shares of the default width
const SWITCHBACK_WIDTHS = [1, 0.8, 0.65];
// The marble must fall this far below the switchback before the next hit, on top of how high the bounce
// at that hit rises, so neither the next piece nor that bounce touches the switchback
const EXIT_CLEARANCE = 0.06;
// Estimates ignore the speed the marble enters with, so they only rank: this many per entry and width are
// simulated, and estimates up to `ESTIMATE_SLACK` too long still count
const SHORTLIST = 10;
const ESTIMATE_SLACK = 0.6;

interface TSwitchbackCandidate {
	entryTime: number;
	/** Direction of the first leg downhill along x, +1 or -1 */
	downhill: number;
	contactAt: number;
	width: number;
	legs: number;
	slope: number;
}

/**
 * Switchback that catches the marble after `fromHitId` and holds it in the lane's frame band, so it
 * leaves shortly before `toHitId` near the shared pace y*. The entry lies where the marble has fallen a
 * few centimetres below the launching hit, so its earlier path stays above the switchback. Leg counts
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
	laneId: string,
	fromHitId: string,
	toHitId: string,
	options: TGapPieceOptions = {}
): TResult<TGapPieceProposal, Error> {
	const lane = project.music.lanes.find((item) => item.id === laneId);
	const from = lane?.hits.find((hit) => hit.id === fromHitId);
	const to = lane?.hits.find((hit) => hit.id === toHitId);
	if (lane == null || from == null || to == null)
		return Err(new Error('Both hits must exist in the lane'));
	if (to.time <= from.time) return Err(new Error('The gap must end after it starts'));
	const samples = result.marbles.find((marble) => marble.laneId === laneId)?.samples ?? [];
	const marbleRadius =
		project.entities.find((entity) => entity.components.marble?.laneId === laneId)?.components
			.marble?.radius ?? 0.008;
	const band = frameBand(project, laneId);
	const pace = result.pace ?? descentPace(project, result.hits);
	const GRAVITY = -gravityOf(project);
	const launch =
		findHitResult(result, laneId, fromHitId)?.dot ??
		trajectoryAt(samples, from.time, -GRAVITY)?.position;
	if (launch == null) return Err(new Error('The marble does not reach the hit before the gap'));
	const targetY = pace != null ? paceAt(pace, to.time) : null;
	// The bounce at the hit after the gap rises about v0² / 2g, v0 the pace takeoff for the interval after it
	const after = lane.hits[lane.hits.findIndex((hit) => hit.id === toHitId) + 1];
	const afterInterval = after != null ? after.time - to.time : 0;
	const afterTakeoff =
		after != null && pace != null ? Math.max(0, (GRAVITY * afterInterval) / 2 - pace.rate) : 0;
	const minExitFall = Math.sqrt(
		(2 * (Math.min(afterTakeoff * afterTakeoff, 2 * GRAVITY * 0.6) / (2 * GRAVITY) + EXIT_CLEARANCE)) /
			GRAVITY
	);

	const replaced = findGapPiece(project, laneId, fromHitId);
	const id = replaced?.id ?? options.id ?? createId('piece');
	const count = project.entities.filter(
		(entity) => entity.components.piece?.type === 'switchback' && entity.id !== replaced?.id
	).length;
	const defaults = resolvePieceParams('switchback', {});
	const build = (candidate: TSwitchbackCandidate): TEntity =>
		switchbackEntity(id, count, laneId, fromHitId, candidate.entryTime - from.time, candidate);

	const entryTimes =
		options.entryTime != null
			? [options.entryTime]
			: ENTRY_DROPS.map((drop) =>
					findDropTime(samples, from.time, to.time, launch.y - drop * 2 * marbleRadius)
				).filter(
					(time): time is number => time != null
				);
	const slopes = options.slope != null ? [options.slope] : SWITCHBACK_SLOPES;
	type TRanked = { candidate: TSwitchbackCandidate; predicted: number };
	const ranked: TRanked[] = [];
	for (const entryTime of [...new Set(entryTimes)]) {
		const entry = trajectoryAt(samples, entryTime, -GRAVITY);
		if (entry == null) continue;
		for (const width of SWITCHBACK_WIDTHS.map((share) => share * (defaults['width'] ?? 0.15))) {
			const fits: Omit<TSwitchbackCandidate, 'legs' | 'slope'>[] = [];
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
			const params = { ...defaults, width };
			const estimates: { legs: number; slope: number; predicted: number }[] = [];
			for (const legs of SWITCHBACK_LEGS) {
				for (const slope of slopes) {
					const sized = { ...params, legs };
					const exitTime =
						entryTime +
						switchbackHoldTime(sized, slope, GRAVITY, Math.hypot(entry.velocity.x, entry.velocity.y));
					const fall = to.time - exitTime;
					if (fall < minExitFall - ESTIMATE_SLACK) continue;
					const geometry = switchbackGeometry(sized, -slope, 0.5, entry.position, marbleRadius, null);
					const y = geometry.exit.y - (GRAVITY * fall * fall) / 2;
					estimates.push({ legs, slope, predicted: targetY != null ? y - targetY : 0 });
				}
			}
			estimates.sort(
				(a, b) =>
					Math.abs(a.predicted) - Math.abs(b.predicted) || a.legs - b.legs || a.slope - b.slope
			);
			for (const estimate of estimates.slice(0, SHORTLIST)) {
				for (const fit of fits)
					ranked.push({
						candidate: { ...fit, legs: estimate.legs, slope: estimate.slope },
						predicted: estimate.predicted
					});
			}
		}
	}
	const first = ranked[0];
	if (first == null)
		return Err(
			new Error(
				'The marble does not fall below the hit before the gap ends, or the frame has no room for a switchback'
			)
		);

	let chosen = first.candidate;
	let check: TGapPieceCheck | null = null;
	if (options.simulate != null) {
		const simulate = options.simulate;
		const owners = hitOwners(project, laneId);
		const play = (
			candidate: TSwitchbackCandidate
		): { score: number; check: TGapPieceCheck } | null => {
			const entity = build(candidate);
			// A flat probe on the next hit checks that its dot can take a piece below the switchback
			const probe = !owners.has(to.id)
				? createLinkedPiece('platform', laneId, to.id, 0, { id: `${entity.id}-probe` })
				: null;
			const trial = simulateTrial(
				simulate,
				withEntities(project, probe != null ? [entity, probe] : [entity]),
				to.time + 0.02
			);
			const played = checkSwitchback(trial, project, laneId, entity.id, candidate.entryTime, from.time, to.id, to.time);
			if (played.check.pieceStatus !== 'placed') return null;
			const probeStatus = trial.pieces.find((piece) => piece.entityId === probe?.id)?.status;
			const paceError = Math.abs(played.check.paceError ?? 0);
			const limit = pace?.limit ?? Infinity;
			const score =
				(played.isStray ? 20 : 0) +
				(played.check.leaveTime == null ? 20 : 0) +
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
				0.01 * candidate.legs;
			return { score, check: played.check };
		};
		let best: { score: number; candidate: TSwitchbackCandidate; check: TGapPieceCheck } | null = null;
		const consider = (candidate: TSwitchbackCandidate): void => {
			const played = play(candidate);
			if (played != null && (best == null || played.score < best.score - 1e-9))
				best = { score: played.score, candidate, check: played.check };
		};
		for (const item of ranked) consider(item.candidate);
		const found = best as { score: number; candidate: TSwitchbackCandidate; check: TGapPieceCheck } | null;
		if (found == null) return Err(new Error('Every switchback crosses the earlier trajectory'));
		// Steeper legs hold shorter and drop the marble lower; one round of neighbouring slopes
		if (options.slope == null) {
			for (const offset of [-2, 2, -4, 4]) {
				const slope = found.candidate.slope + offset * DEGREE;
				if (slope >= 2 * DEGREE && slope <= 25 * DEGREE) consider({ ...found.candidate, slope });
			}
		}
		const refined = best as { score: number; candidate: TSwitchbackCandidate; check: TGapPieceCheck } | null;
		chosen = refined?.candidate ?? found.candidate;
		check = refined?.check ?? found.check;
	}

	const entity = build(chosen);
	return Ok({
		entity,
		commands: [{ type: 'upsertEntity', entity }],
		entryTime: chosen.entryTime,
		length: chosen.width,
		slope: chosen.slope,
		check
	});
}

/**
 * First time after the hit when the marble falls and is at or below `level`, leaving at least 0.25 s
 * before the gap ends
 */
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

function switchbackEntity(
	id: string,
	count: number,
	laneId: string,
	hitId: string,
	entryDelay: number,
	candidate: TSwitchbackCandidate
): TEntity {
	const definition = getPieceDefinition('switchback');
	const params = resolvePieceParams('switchback', {
		entryDelay: Math.round(entryDelay * 1000) / 1000,
		width: candidate.width,
		legs: candidate.legs
	});
	return {
		id,
		name: `${definition?.label ?? 'Switchback'} ${count + 1}`,
		components: {
			piece: { type: 'switchback', params },
			hitLink: {
				laneId,
				hitId,
				angle: round(-candidate.downhill * candidate.slope),
				contactAt: candidate.contactAt,
				pinned: false
			}
		}
	};
}

/** How a switchback played: when the marble dropped below it, frame, pace and stray contacts */
function checkSwitchback(
	trial: TSimulationResult,
	project: TProject,
	laneId: string,
	entityId: string,
	entryTime: number,
	fromTime: number,
	toHitId: string,
	toTime: number
): { check: TGapPieceCheck; isStray: boolean } {
	const band = frameBand(project, laneId);
	const pace = trial.pace ?? descentPace(project, trial.hits);
	const piece = trial.pieces.find((item) => item.entityId === entityId);
	const marble = trial.marbles.find((item) => item.laneId === laneId);
	const next = findHitResult(trial, laneId, toHitId);
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
	const marbleId = marble?.entityId;
	const isStray = trial.contacts.some((contact) => {
		if (contact.time <= fromTime + 0.02 || contact.time >= toTime - 0.01) return false;
		if (contact.marbleEntityId !== marbleId) return contact.otherEntityId === entityId;
		return contact.otherEntityId !== entityId;
	});
	return {
		check: {
			dot,
			isDotInFrame: dot != null && isInBand(dot, band, 1),
			isRunInFrame,
			leaveTime,
			pieceStatus: piece?.status ?? 'unreached',
			nextStatus: next?.pieceEntityId != null ? next.status : null,
			paceError: dot != null && pace != null ? dot.y - paceAt(pace, toTime) : null
		},
		isStray
	};
}
