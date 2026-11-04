import type { TEntity, TProject, TTransit, TVec2 } from '@/modules/project';
import { layoutOf } from './piece-layout';
import { resolvePieceParams } from './pieces';
import { shapeDistance } from './shapes';
import { PHYSICS_HZ, type TSimulationResult } from './types';

// A marble rolling through a switchback or a rail repeats nothing: a turn of a thousandth of a degree before it
// changes where it comes out by tens of centimetres. So once a track is edited its gap pieces keep the ride they gave,
// as frames relative to where the marble entered, and every later piece stays where it is. A ride is used while the
// marble enters within `TRANSIT_TOLERANCE` of the speed it was made with; past that the piece is simulated again.

/** How far an entry may differ from the ride's, in m/s at Earth's gravity; speeds at a rhythm scale with gravity */
const TRANSIT_TOLERANCE = 0.6;

export function rideTolerance(gravityScale: number): number {
	return TRANSIT_TOLERANCE * gravityScale;
}

/** Physics steps after its hit at which a marble has left a platform */
export const LEAVE_STEPS = 5;
const POSITION_UNIT = 1e-6;
const ANGLE_UNIT = 1e-4;
/** Gap between marble and piece under which the ride is not over yet */
const TOUCH_MARGIN = 0.002;

/** The layouts a marble rides through rather than bounces off */
export function hasRide(type: string): boolean {
	const layout = layoutOf(type);
	return layout === 'holder' || layout === 'path' || layout === 'tube';
}

/** What a ride depends on besides the entry speed: the piece's shape and how it sits on the marble */
export function rideKey(entity: TEntity): string {
	const { piece, hitLink, path } = entity.components;
	const { entryDelay: _, ...params } = resolvePieceParams(piece?.type ?? '', piece?.params ?? {});
	return hash(JSON.stringify([piece?.type, params, path?.points, hitLink?.angle, hitLink?.contactAt, hitLink?.offset]));
}

function hash(text: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(36);
}

/** One ride as the simulation plays it, in the units of the stored frames */
export function rideFrame(transit: TTransit, index: number): { x: number; y: number; angle: number } {
	return {
		x: (transit.frames[index * 3] ?? 0) * POSITION_UNIT,
		y: (transit.frames[index * 3 + 1] ?? 0) * POSITION_UNIT,
		angle: (transit.frames[index * 3 + 2] ?? 0) * ANGLE_UNIT
	};
}

export function rideLength(transit: TTransit): number {
	return Math.floor(transit.frames.length / 3);
}

/**
 * The ride `entity` gave in `result`: from where the piece entered the run to where the marble last comes near it
 * before its next hit. Null when the piece didn't enter the run or the marble never rides it.
 */
export function bakeRide(project: TProject, result: TSimulationResult, entity: TEntity): TTransit | null {
	const link = entity.components.hitLink;
	const piece = result.pieces.find((item) => item.entityId === entity.id);
	const track = result.marbles.find((marble) => marble.laneId === link?.laneId);
	const shapes = piece?.shapes;
	if (link == null || piece == null || track == null || shapes == null || piece.status !== 'placed') return null;
	const lane = project.music.lanes.find((item) => item.id === link.laneId);
	const index = lane?.hits.findIndex((hit) => hit.id === link.hitId) ?? -1;
	const hit = lane?.hits[index];
	if (lane == null || hit == null || !track.samples.length) return null;
	const entryTime = hit.time + (entity.components.piece?.params['entryDelay'] ?? 0);
	const first = track.samples[0]?.time ?? 0;
	const start = Math.floor(entryTime * PHYSICS_HZ + 1e-6) - Math.round(first * PHYSICS_HZ);
	const next = lane.hits[index + 1];
	const stop = next != null ? Math.round((next.time - first) * PHYSICS_HZ) - 2 : track.samples.length - 1;
	const origin = track.samples[start];
	if (origin == null || stop <= start) return null;
	let last = -1;
	for (let i = Math.min(stop, track.samples.length - 1); i > start; i--) {
		const sample = track.samples[i];
		if (sample == null) continue;
		let gap = Infinity;
		for (const shape of shapes) gap = Math.min(gap, shapeDistance(shape, sample.position.x, sample.position.y));
		if (gap < track.radius + TOUCH_MARGIN) {
			last = i;
			break;
		}
	}
	if (last < 0) return null;
	const end = Math.min(last + 2, stop, track.samples.length - 1);
	const frames: number[] = [];
	let angle = 0;
	for (let i = start + 1; i <= end; i++) {
		const sample = track.samples[i];
		const before = track.samples[i - 1];
		if (sample == null || before == null) return null;
		angle += wrap(sample.angle - before.angle);
		frames.push(Math.round((sample.position.x - origin.position.x) / POSITION_UNIT), Math.round((sample.position.y - origin.position.y) / POSITION_UNIT), Math.round(angle / ANGLE_UNIT));
	}
	const out = track.samples[end];
	const beforeOut = track.samples[end - 1];
	if (out == null || beforeOut == null) return null;
	return {
		key: rideKey(entity),
		entry: { ...origin.velocity },
		exit: {
			position: { x: out.position.x - origin.position.x, y: out.position.y - origin.position.y },
			velocity: { ...out.velocity },
			angle,
			spin: wrap(out.angle - beforeOut.angle) * PHYSICS_HZ
		},
		touches: [...new Set(result.contacts.filter((contact) => contact.marbleEntityId === track.entityId && contact.kind === 'piece' && contact.time >= origin.time && contact.time <= out.time && contact.otherEntityId !== entity.id).map((contact) => contact.otherEntityId ?? ''))],
		frames
	};
}

function wrap(angle: number): number {
	return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** Velocity of a ride's frame from its neighbours; the last is how the marble comes out */
export function rideVelocity(transit: TTransit, index: number): TVec2 {
	if (index >= rideLength(transit) - 1) return transit.exit.velocity;
	const after = rideFrame(transit, index + 1);
	const before = index > 0 ? rideFrame(transit, index - 1) : { x: 0, y: 0, angle: 0 };
	return { x: ((after.x - before.x) * PHYSICS_HZ) / 2, y: ((after.y - before.y) * PHYSICS_HZ) / 2 };
}

const rideHashes = new WeakMap<TTransit, string>();

/** Stands for a ride in a run's snapshot keys, so a new ride never resumes from an old one */
export function rideHash(transit: TTransit): string {
	let known = rideHashes.get(transit);
	if (known == null) {
		known = hash(`${JSON.stringify(transit.entry)}${transit.frames.join()}`);
		rideHashes.set(transit, known);
	}
	return known;
}
