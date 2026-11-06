import { type TPiece, type TProject, type TRide, type TVec2, tieOf } from '@/modules/project';
import { layoutOf } from './piece-layout';
import { resolvePieceParams } from './pieces';
import { shapeDistance } from './shapes';
import { PHYSICS_HZ, type TSimulationResult } from './types';

// A marble rolling along a rail repeats nothing: a turn of a thousandth of a degree before it
// changes where it comes out by tens of centimeters. So once a track is edited its gap pieces keep the ride they gave,
// as frames relative to where the marble entered, and every later piece stays where it is. A ride is used while the
// marble enters within `TRANSIT_TOLERANCE` of the speed it was made with; past that the piece is simulated again.

/** How far an entry may differ from the ride's, in m/s at Earth's gravity; speeds at a rhythm scale with gravity */
const TRANSIT_TOLERANCE = 0.6;

export function rideTolerance(gravity: number): number {
	return TRANSIT_TOLERANCE * gravity;
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
	return layout === 'path' || layout === 'tube';
}

/** What a ride depends on besides the entry speed: the piece's shape and how it sits on the marble */
export function rideKey(piece: TPiece): string {
	const tie = tieOf(piece);
	const { entryDelay: _, ...params } = resolvePieceParams(piece?.type ?? '', piece?.params ?? {});
	return hash(JSON.stringify([piece.type, piece.layout, params, piece.path?.points, piece.path?.paths, tie != null ? piece.angle : undefined, tie != null ? (tie.contactAt ?? 0.5) : undefined, tie?.kind === 'follows' ? tie.offset : undefined]));
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
export function rideFrame(ride: TRide, index: number): { x: number; y: number; angle: number } {
	return {
		x: (ride.frames[index * 3] ?? 0) * POSITION_UNIT,
		y: (ride.frames[index * 3 + 1] ?? 0) * POSITION_UNIT,
		angle: (ride.frames[index * 3 + 2] ?? 0) * ANGLE_UNIT
	};
}

export function rideLength(ride: TRide): number {
	return Math.floor(ride.frames.length / 3);
}

/**
 * The ride `piece` gave in `result`: from where the piece entered the run to where the marble last comes near it
 * before its next hit. Null when the piece didn't enter the run or the marble never rides it.
 */
export function bakeRide(project: TProject, result: TSimulationResult, piece: TPiece): TRide | null {
	const link = tieOf(piece);
	const resolvedPiece = result.pieces.find((item) => item.pieceId === piece.id);
	const track = result.marbles.find((marble) => marble.marbleId === link?.marbleId);
	const shapes = resolvedPiece?.shapes;
	if (link == null || resolvedPiece == null || track == null || shapes == null || resolvedPiece.status !== 'placed') return null;
	const marble = project.marbles.find((item) => item.id === link.marbleId);
	const index = marble?.hits.findIndex((hit) => hit.id === link.hitId) ?? -1;
	const hit = marble?.hits[index];
	if (marble == null || hit == null || !track.samples.length) return null;
	const entryTime = hit.time + (piece.params['entryDelay'] ?? 0);
	const first = track.samples[0]?.time ?? 0;
	const start = Math.floor(entryTime * PHYSICS_HZ + 1e-6) - Math.round(first * PHYSICS_HZ);
	const next = marble.hits[index + 1];
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
		key: rideKey(piece),
		entry: { ...origin.velocity },
		exit: {
			position: { x: out.position.x - origin.position.x, y: out.position.y - origin.position.y },
			velocity: { ...out.velocity },
			angle,
			spin: wrap(out.angle - beforeOut.angle) * PHYSICS_HZ
		},
		touches: [...new Set(result.contacts.filter((contact) => contact.marbleId === track.marbleId && contact.kind === 'piece' && contact.time >= origin.time && contact.time <= out.time && contact.otherId !== piece.id).map((contact) => contact.otherId ?? ''))],
		frames
	};
}

function wrap(angle: number): number {
	return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** Velocity of a ride's frame from its neighbors; the last is how the marble comes out */
export function rideVelocity(ride: TRide, index: number): TVec2 {
	if (index >= rideLength(ride) - 1) return ride.exit.velocity;
	const after = rideFrame(ride, index + 1);
	const before = index > 0 ? rideFrame(ride, index - 1) : { x: 0, y: 0, angle: 0 };
	return { x: ((after.x - before.x) * PHYSICS_HZ) / 2, y: ((after.y - before.y) * PHYSICS_HZ) / 2 };
}

const rideHashes = new WeakMap<TRide, string>();

/** Stands for a ride in a run's snapshot keys, so a new ride never resumes from an old one */
export function rideHash(ride: TRide): string {
	let known = rideHashes.get(ride);
	if (known == null) {
		known = hash(`${JSON.stringify(ride.entry)}${ride.frames.join()}`);
		rideHashes.set(ride, known);
	}
	return known;
}
