import { type TPiece, type TProject, type TVec2, tieOf } from '@/modules/project';
import { bowlGeometry } from './piece-layout';
import { projectOnPath } from './shapes';
import type { TMarbleTrack, TResolvedPiece, TSimulationResult } from './types';

// The Bowl, the piece that ends a marble's run by catching it after its last note. See `bowlDefinition` for its
// shape and `bowlGeometry` for its wire.

export const BOWL_TYPE = 'bowl';

/**
 * How far the marble may move off the Bowl's wire, beyond touching it, and still count as caught: a marble
 * diameter at the default kit, so the short hop of a landing at speed counts, a bounce out of the mouth does not
 */
const CATCH_MARGIN = 0.024;

export interface TBowlCatch {
	/**
	 * `caught`: the marble lands in the Bowl and stays in it until the run ends;
	 * `escaped`: it lands and bounces or rolls out of the mouth; `missed`: it never touches the Bowl; `blocked`:
	 * the marble's earlier run passes through it, so it is left out
	 */
	status: 'caught' | 'escaped' | 'missed' | 'blocked';
	/** When the marble first touches the Bowl */
	enterTime: number | null;
	/** Where it first touches it */
	enterPoint: TVec2 | null;
}

/** The Bowl of a marble's marble, if it has one: a Bowl anchored to one of the marble's hits */
export function bowlOfMarble(project: TProject, marbleId: string): TPiece | undefined {
	return project.track.pieces.find((piece) => piece.type === BOWL_TYPE && tieOf(piece)?.marbleId === marbleId);
}

export function isBowl(piece: TPiece | undefined): boolean {
	return piece?.type === BOWL_TYPE;
}

/**
 * Whether the marble of the Bowl's marble lands in it and stays: after its first contact the marble keeps within
 * `CATCH_MARGIN` of the wire until the run ends
 */
export function bowlCatch(result: TSimulationResult, entityId: string): TBowlCatch {
	const piece = result.pieces.find((item) => item.pieceId === entityId);
	const none: TBowlCatch = { status: 'missed', enterTime: null, enterPoint: null };
	if (piece == null) return none;
	if (piece.status === 'blocked') return { ...none, status: 'blocked' };
	const contact = result.contacts.find((item) => item.otherId === entityId && item.kind === 'piece' && trackOf(result, item.marbleId) != null && isOwnMarble(result, piece, item.marbleId));
	if (contact == null) return none;
	const track = trackOf(result, contact.marbleId) as TMarbleTrack;
	return catchAlong(piece, track, contact.time, contact.position);
}

function trackOf(result: TSimulationResult, marbleId: string): TMarbleTrack | undefined {
	return result.marbles.find((track) => track.marbleId === marbleId);
}

/** The marble that meets an anchored Bowl first is its own: the Bowl enters the run at that marble */
function isOwnMarble(result: TSimulationResult, piece: TResolvedPiece, marbleId: string): boolean {
	const first = result.contacts.find((item) => item.otherId === piece.pieceId && item.kind === 'piece');
	return first?.marbleId === marbleId;
}

function catchAlong(piece: TResolvedPiece, track: TMarbleTrack, enterTime: number, enterPoint: TVec2): TBowlCatch {
	const wire = piece.paths?.[0] ?? [];
	const radius = piece.params['radius'] ?? 0.0025;
	const reach = track.radius + radius + CATCH_MARGIN;
	const { center } = bowlGeometry(piece.params, piece.position, track.radius);
	const size = piece.params['size'] ?? 0.06;
	// The side of the wire the marble rides on: toward the center of the catch curve
	const middle = projectOnPath(wire, center.x, center.y);
	const inside = Math.sign(cross(middle.tangent, { x: center.x - middle.point.x, y: center.y - middle.point.y }));
	let hasLanded = false;
	for (const sample of track.samples) {
		if (sample.time < enterTime) continue;
		const projected = projectOnPath(wire, sample.position.x, sample.position.y);
		if (!hasLanded) {
			// A marble that strikes the outside of the wire has not landed in the Bowl
			const side = Math.sign(cross(projected.tangent, { x: sample.position.x - projected.point.x, y: sample.position.y - projected.point.y }));
			if (side !== inside) return { status: 'missed', enterTime, enterPoint };
			hasLanded = true;
		}
		// Inside the catch curve, or riding the wire
		const isInside = Math.hypot(sample.position.x - center.x, sample.position.y - center.y) <= size;
		if (!isInside && projected.distance > reach) return { status: 'escaped', enterTime, enterPoint };
	}
	return { status: 'caught', enterTime, enterPoint };
}

function cross(a: TVec2, b: TVec2): number {
	return a.x * b.y - a.y * b.x;
}

