import type { TEntity, TProject, TVec2 } from '@/modules/project';
import { finishGeometry } from './piece-layout';
import { projectOnPath } from './shapes';
import type { TMarbleTrack, TResolvedPiece, TSimulationResult } from './types';

// The Finish, the piece that ends a marble's run by catching it after its last note. See `finishDefinition` for its
// shape and `finishGeometry` for its wire.

export const FINISH_TYPE = 'finish';

/**
 * How far the marble may move off the Finish's wire, beyond touching it, and still count as caught: a marble
 * diameter at the default kit, so the short hop of a landing at speed counts, a bounce out of the mouth does not
 */
const CATCH_MARGIN = 0.024;
/** A marble within this of the Chute's end along its wire has rolled out */
const ROLLED_OUT = 0.004;
/** A landing counts only this far from the run-out's end, and a roll-out only after rolling this far along the wire */
const LANDING_ROOM = 0.03;

export interface TFinishCatch {
	/**
	 * `caught`: the marble lands in the Finish and stays in it until it rolls out of the Chute or the run ends;
	 * `escaped`: it lands and bounces or rolls out of the mouth; `missed`: it never touches the Finish; `blocked`:
	 * the marble's earlier run passes through it, so it is left out
	 */
	status: 'caught' | 'escaped' | 'missed' | 'blocked';
	/** When the marble first touches the Finish */
	enterTime: number | null;
	/** Where it first touches it */
	enterPoint: TVec2 | null;
	/** When it rolls off the end of a Chute, if it does within the run */
	exitTime: number | null;
}

/** The Finish of a marble's lane, if it has one: a Finish anchored to one of the lane's hits */
export function finishOfLane(project: TProject, laneId: string): TEntity | undefined {
	return project.entities.find((entity) => entity.components.piece?.type === FINISH_TYPE && entity.components.hitLink?.laneId === laneId);
}

export function isFinish(entity: TEntity | undefined): boolean {
	return entity?.components.piece?.type === FINISH_TYPE;
}

/**
 * Whether the marble of the Finish's lane lands in it and stays: after its first contact the marble keeps within
 * `CATCH_MARGIN` of the wire until it rolls off the end of a Chute or the run ends
 */
export function finishCatch(result: TSimulationResult, entityId: string): TFinishCatch {
	const piece = result.pieces.find((item) => item.entityId === entityId);
	const none: TFinishCatch = { status: 'missed', enterTime: null, enterPoint: null, exitTime: null };
	if (piece == null) return none;
	if (piece.status === 'blocked') return { ...none, status: 'blocked' };
	const contact = result.contacts.find((item) => item.otherEntityId === entityId && item.kind === 'piece' && trackOf(result, item.marbleEntityId) != null && isOwnMarble(result, piece, item.marbleEntityId));
	if (contact == null) return none;
	const track = trackOf(result, contact.marbleEntityId) as TMarbleTrack;
	return catchAlong(piece, track, contact.time, contact.position);
}

function trackOf(result: TSimulationResult, marbleEntityId: string): TMarbleTrack | undefined {
	return result.marbles.find((track) => track.entityId === marbleEntityId);
}

/** The marble that meets an anchored Finish first is its own: the Finish enters the run at that marble */
function isOwnMarble(result: TSimulationResult, piece: TResolvedPiece, marbleEntityId: string): boolean {
	const first = result.contacts.find((item) => item.otherEntityId === piece.entityId && item.kind === 'piece');
	return first?.marbleEntityId === marbleEntityId;
}

function catchAlong(piece: TResolvedPiece, track: TMarbleTrack, enterTime: number, enterPoint: TVec2): TFinishCatch {
	const wire = piece.paths?.[0] ?? [];
	const radius = piece.params['radius'] ?? 0.0025;
	const reach = track.radius + radius + CATCH_MARGIN;
	const isChute = Math.round(piece.params['style'] ?? 0) !== 1;
	const total = pathLength(wire);
	const { centre } = finishGeometry(piece.params, piece.position, track.radius);
	const size = piece.params['size'] ?? 0.06;
	// The side of the wire the marble rides on: toward the centre of the catch curve
	const middle = projectOnPath(wire, centre.x, centre.y);
	const inside = Math.sign(cross(middle.tangent, { x: centre.x - middle.point.x, y: centre.y - middle.point.y }));
	let landed: number | null = null;
	for (const sample of track.samples) {
		if (sample.time < enterTime) continue;
		const projected = projectOnPath(wire, sample.position.x, sample.position.y);
		if (landed == null) {
			// A marble that strikes the outside of the wire or the end of the run-out has not landed in the Finish
			const side = Math.sign(cross(projected.tangent, { x: sample.position.x - projected.point.x, y: sample.position.y - projected.point.y }));
			if (side !== inside || (isChute && projected.along >= total - LANDING_ROOM)) return { status: 'missed', enterTime, enterPoint, exitTime: null };
			landed = projected.along;
		}
		if (isChute && projected.along >= total - ROLLED_OUT && projected.along - landed >= LANDING_ROOM) return { status: 'caught', enterTime, enterPoint, exitTime: sample.time };
		// Inside the catch curve, or riding the wire
		const isInside = Math.hypot(sample.position.x - centre.x, sample.position.y - centre.y) <= size;
		if (!isInside && projected.distance > reach) return { status: 'escaped', enterTime, enterPoint, exitTime: null };
	}
	return { status: 'caught', enterTime, enterPoint, exitTime: null };
}

function cross(a: TVec2, b: TVec2): number {
	return a.x * b.y - a.y * b.x;
}

function pathLength(points: TVec2[]): number {
	let length = 0;
	for (let index = 1; index < points.length; index++) {
		const a = points[index - 1] as TVec2;
		const b = points[index] as TVec2;
		length += Math.hypot(b.x - a.x, b.y - a.y);
	}
	return length;
}
