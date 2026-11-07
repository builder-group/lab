import { type TPiece, type TRide, type TVec2, tieOf } from '@/modules/project';
import { layoutOf } from './piece-layout';
import { resolvePieceParams } from './pieces';
import { PHYSICS_HZ } from './types';

// A marble rolling along a rail repeats nothing: a turn of a thousandth of a degree before it
// changes where it comes out by tens of centimeters. So once a track is edited its gap pieces keep the ride they gave,
// as frames relative to where the marble entered, and every later piece stays where it is. A ride is used while the
// marble enters within `RIDE_TOLERANCE` of the speed it was made with; past that the piece is simulated again.

/** How far an entry may differ from the ride's, in m/s at Earth's gravity; speeds at a rhythm scale with gravity */
const RIDE_TOLERANCE = 0.6;

export function rideTolerance(gravity: number): number {
	return RIDE_TOLERANCE * gravity;
}

/** Physics steps after its hit at which a marble has left a platform */
export const LEAVE_STEPS = 5;
/** What a stored ride's frames count in */
export const POSITION_UNIT = 1e-6;
export const ANGLE_UNIT = 1e-4;

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
