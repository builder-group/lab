import type { TEntity, TProject, TVec2 } from '@/modules/project';
import { gravityOf } from '../geometry';
import { findEntryTime } from '../gap-pieces';
import { switchbackHoldTime } from '../piece-layout';
import { railLayoutInfo, resolvePieceParams } from '../pieces';
import { frameBand } from '../placement';
import type { TSimulator } from '../simulate';
import { touchingPairs } from '../track-look';
import type { TSimulationResult } from '../types';
import { withEntity } from './fit-bars';

// Long Rail: a rail whose shape is solved so the marble leaves it a chosen time before the next hit, against the real
// simulator. Promoted from the Patterns experiment (`.local/patterns/longrail.mts`).

const DEGREE = Math.PI / 180;
/** Seconds from where a short ramp stops holding well and a Switchback takes over (the report's 1.5 s) */
export const RAMP_LIMIT = 1.55;

export interface TRailFit {
	entity: TEntity;
	project: TProject;
	kind: 'ramp' | 'switchback';
	/** Seconds it was asked to hold the marble, and how far off it came */
	wanted: number;
	holdErr: number;
	dot: TVec2 | null;
	sims: number;
	width: number;
	turns: number;
	slope: number;
	isTouching: boolean;
}

export interface TRailAnswer {
	fit: TRailFit | null;
	/** What went wrong most often while looking, in words that finish "No rail holds the marble here:" */
	why: string | null;
}

interface TTrial extends TRailFit {
	why: string | null;
}

/** The rail between two hits, or why none holds the marble: the longest hold tried and what went wrong with it */
export function fitLongRail(sim: TSimulator, base: TProject, laneId: string, fromHitId: string, toHitId: string, onTry?: () => void): TRailAnswer {
	let sims = 0;
	const whys = new Map<string, number>();
	const lane = base.music.lanes.find((item) => item.id === laneId);
	const from = lane?.hits.find((hit) => hit.id === fromHitId)?.time;
	const to = lane?.hits.find((hit) => hit.id === toHitId)?.time;
	if (from == null || to == null) return { fit: null, why: null };
	const gap = to - from;
	const tail = 0.1;
	const id = `long-rail-${fromHitId}`;
	const entryDrop = gap <= RAMP_LIMIT ? 0.002 : 0.006;
	const kinds: ('ramp' | 'switchback')[] = gap <= RAMP_LIMIT ? ['ramp', 'switchback'] : ['switchback', 'ramp'];
	const run = (next: TProject, until: number): TSimulationResult => {
		sims++;
		onTry?.();
		return sim.simulate({ ...next, end: until });
	};
	const free = run(base, to + 0.02);
	const entryTime = findEntryTime(free, laneId, from, to, entryDrop) ?? from + 0.12;
	let delay = Math.round((entryTime - from) * 1000) / 1000;
	const samples = free.marbles.find((marble) => marble.laneId === laneId)?.samples ?? [];
	const entry = samples.find((sample) => sample.time >= entryTime);
	if (entry == null) return { fit: null, why: 'the marble has stopped by then' };
	const wanted = gap - tail;
	const band = frameBand(base);
	const downhill0 = Math.abs(entry.velocity.x) > 0.05 ? Math.sign(entry.velocity.x) : Math.sign(band.centerX - entry.position.x) || 1;
	const results: TTrial[] = [];

	const trial = (kind: 'ramp' | 'switchback', width: number, turns: number, slope: number, downhill: number, contactAt: number): TTrial => {
		const entity = kind === 'ramp' ? rampEntity(id, laneId, fromHitId, delay, width, slope, downhill) : switchbackEntity(id, laneId, fromHitId, delay, width, turns, slope, downhill, contactAt);
		const next = withEntity(base, entity);
		const result = run(next, to + 0.02);
		const ride = railRide(result, laneId, id, to, marbleRadius(base, laneId));
		const nextHit = result.hits.find((hit) => hit.hitId === toHitId);
		const marble = result.marbles.find((item) => item.laneId === laneId);
		const last = [...(marble?.samples ?? [])].reverse().find((sample) => sample.time <= to);
		const leave = ride.leave != null ? ride.leave - from : null;
		const isStruck = result.contacts.some((contact) => contact.kind === 'piece' && contact.otherEntityId !== id && contact.time > from + 0.03 && contact.time < to - 0.004 && base.entities.find((item) => item.id === contact.otherEntityId)?.components.piece?.type === 'platform');
		const isTouching = !ride.isBlocked && touchingPairs(next, result).some((pair) => pair.a === id || pair.b === id);
		const why = ride.isBlocked ? 'it would run through the marble’s path' : ride.isTrapped ? 'the marble stops on it' : leave == null ? 'the marble misses it' : isStruck ? 'the marble strikes a bar on the way' : null;
		if (why != null) whys.set(why, (whys.get(why) ?? 0) + 1);
		return { entity, project: next, kind, wanted, holdErr: leave == null ? Infinity : leave - wanted, dot: nextHit?.dot ?? last?.position ?? null, sims: 0, width, turns, slope, isTouching, why };
	};
	const isBetter = (item: TTrial, best: TTrial | null): boolean => item.why == null && (best == null || Math.abs(item.holdErr) < Math.abs(best.holdErr));

	const solveSlope = (width: number, turns: number, downhill: number, contactAt: number, low: number, high: number): void => {
		// Hold falls as the slope rises. Scan then bisect
		const steps = 6;
		let previous: TTrial | null = null;
		let best: TTrial | null = null;
		for (let step = 0; step <= steps; step++) {
			const item = trial('switchback', width, turns, low + ((high - low) * step) / steps, downhill, contactAt);
			if (isBetter(item, best)) best = item;
			if (previous != null && item.why == null && previous.why == null && previous.holdErr * item.holdErr <= 0) {
				let a: TTrial = previous;
				let b: TTrial = item;
				for (let round = 0; round < 7; round++) {
					const weight = a.holdErr / (a.holdErr - b.holdErr);
					const middle = trial('switchback', width, turns, a.slope + (b.slope - a.slope) * Math.max(0.15, Math.min(0.85, weight)), downhill, contactAt);
					if (isBetter(middle, best)) best = middle;
					if (middle.why != null || Math.abs(middle.holdErr) < 0.01) break;
					if (a.holdErr * middle.holdErr <= 0) b = middle;
					else a = middle;
				}
				break;
			}
			previous = item;
		}
		if (best != null) results.push(best);
	};

	const roomTo = (direction: number): number => (direction > 0 ? band.centerX + band.halfWidth - entry.position.x - 0.03 : entry.position.x - band.centerX + band.halfWidth - 0.03);

	for (const kind of kinds) {
		if (kind === 'ramp') {
			// Shallow and short: the catch takes most of the speed, so the length sets the hold. Longest fit first
			const directions = [downhill0, -downhill0].sort((a, b) => roomTo(b) - roomTo(a));
			const delays = [0.03, 0.06, 0.1, 0.15, 0.2].map((extra) => delay + extra);
			rampLoop: for (const travel of directions) {
				for (const nextDelay of delays) {
					for (const slope of [2, 3, 4, 6, 9].map((degrees) => degrees * DEGREE)) {
						const longest = Math.min(0.4, roomTo(travel));
						if (longest < 0.04) continue;
						delay = Math.round(nextDelay * 1000) / 1000;
						let previous: TTrial | null = null;
						let best: TTrial | null = null;
						for (let step = 0; step <= 5; step++) {
							const width = 0.03 + ((longest - 0.03) * step) / 5;
							const item = trial('ramp', width, 1, slope, travel, 0.5);
							if (isBetter(item, best)) best = item;
							if (previous != null && previous.why == null && item.why == null && previous.holdErr * item.holdErr <= 0) {
								let a: TTrial = previous;
								let b: TTrial = item;
								for (let round = 0; round < 7; round++) {
									const weight = a.holdErr / (a.holdErr - b.holdErr);
									const middle = trial('ramp', a.width + (b.width - a.width) * Math.max(0.15, Math.min(0.85, weight)), 1, slope, travel, 0.5);
									if (isBetter(middle, best)) best = middle;
									if (middle.why != null || Math.abs(middle.holdErr) < 0.008) break;
									if (a.holdErr * middle.holdErr <= 0) b = middle;
									else a = middle;
								}
								break;
							}
							previous = item;
						}
						if (best != null) {
							results.push(best);
							const found: TTrial = best;
							if (Math.abs(found.holdErr) < 0.02 && !found.isTouching) break rampLoop;
						}
					}
				}
			}
		} else {
			// Candidates by the formula, simulated from nearest. Both directions
			const candidates: { width: number; turns: number; err: number }[] = [];
			for (const width of [0.1, 0.13, 0.16, 0.2, 0.25]) {
				for (let turns = 1; turns <= 6; turns++) {
					for (const slope of [3, 8, 14].map((degrees) => degrees * DEGREE)) {
						const hold = switchbackHoldTime(railParams('switchback', { turns, width }), slope, Math.abs(gravityOf(base)), Math.hypot(entry.velocity.x, entry.velocity.y));
						candidates.push({ width, turns, err: Math.abs(hold + (entryTime - from) - wanted) });
					}
				}
			}
			const seen = new Set<string>();
			for (const candidate of candidates.sort((a, b) => a.err - b.err)) {
				const key = `${candidate.width}/${candidate.turns}`;
				if (seen.has(key)) continue;
				seen.add(key);
				if (seen.size > 4) break;
				solveSlope(candidate.width, candidate.turns, downhill0, 0.25, 2 * DEGREE, 18 * DEGREE);
				solveSlope(candidate.width, candidate.turns, -downhill0, 0.25, 2 * DEGREE, 18 * DEGREE);
				if (results.some((item) => item.kind === 'switchback' && Math.abs(item.holdErr) < 0.015)) break;
			}
		}
		if (results.some((item) => item.kind === kind && Math.abs(item.holdErr) < 0.02)) break;
	}
	const cost = (item: TTrial): number => Math.abs(item.holdErr) + (item.isTouching ? 0.05 : 0);
	const best = results.sort((a, b) => cost(a) - cost(b))[0];
	if (best == null) return { fit: null, why: [...whys].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null };
	return { fit: { ...best, sims }, why: null };
}

function marbleRadius(project: TProject, laneId: string): number {
	return project.entities.find((entity) => entity.components.marble?.laneId === laneId)?.components.marble?.radius ?? 0.012;
}

function rampEntity(id: string, laneId: string, hitId: string, delay: number, width: number, slope: number, downhill: number): TEntity {
	const scale = 1 / Math.cos(slope);
	return {
		id,
		name: 'Rail',
		components: {
			piece: { type: 'rail', params: railParams('path', { entryDelay: delay }) },
			path: {
				points: [
					{ x: -downhill * 0.006 * scale, y: 0 },
					{ x: 0, y: 0 },
					{ x: downhill * width * scale, y: 0 }
				]
			},
			hitLink: { laneId, hitId, angle: -downhill * slope, contactAt: 0.5 }
		}
	};
}

function switchbackEntity(id: string, laneId: string, hitId: string, delay: number, width: number, turns: number, slope: number, downhill: number, contactAt: number): TEntity {
	return {
		id,
		name: 'Rail',
		components: {
			piece: { type: 'rail', layout: 'switchback', params: railParams('switchback', { entryDelay: delay, turns, width }) },
			hitLink: { laneId, hitId, angle: -downhill * slope, contactAt }
		}
	};
}

function railParams(layout: 'path' | 'switchback', values: Record<string, number>): Record<string, number> {
	const resolved = resolvePieceParams('rail', { ...railLayoutInfo[layout].defaults, ...values });
	const params: Record<string, number> = {};
	for (const name of [...railLayoutInfo[layout].params, 'entryDelay']) params[name] = resolved[name] ?? 0;
	return params;
}

function distanceToPath(path: TVec2[], point: TVec2): number {
	let best = Infinity;
	for (let index = 1; index < path.length; index++) {
		const a = path[index - 1] as TVec2;
		const b = path[index] as TVec2;
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const along = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
		best = Math.min(best, Math.hypot(point.x - a.x - along * dx, point.y - a.y - along * dy));
	}
	return best;
}

/** When the marble last touches the rail before the next hit, and whether it stands still on it */
function railRide(result: TSimulationResult, laneId: string, entityId: string, until: number, radius: number): { leave: number | null; isTrapped: boolean; isBlocked: boolean } {
	const marble = result.marbles.find((item) => item.laneId === laneId);
	const piece = result.pieces.find((item) => item.entityId === entityId);
	if (piece == null || marble == null) return { leave: null, isTrapped: false, isBlocked: true };
	const paths = piece.paths ?? (piece.path != null ? [piece.path] : []);
	const reach = radius + (piece.params['radius'] ?? 0.004) + 0.003;
	let leave: number | null = null;
	let stillFor = 0;
	let isTrapped = false;
	for (const sample of marble.samples) {
		if (sample.time > until) break;
		if (!paths.some((path) => distanceToPath(path, sample.position) < reach)) continue;
		leave = sample.time;
		if (Math.hypot(sample.velocity.x, sample.velocity.y) < 0.03) {
			stillFor += 1 / 240;
			if (stillFor > 0.25) isTrapped = true;
		} else stillFor = 0;
	}
	return { leave, isTrapped, isBlocked: piece.status === 'blocked' };
}
