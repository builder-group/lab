import { type TPiece, type TProject, type TRide, tieOf } from '@/modules/project';
import { ANGLE_UNIT, hasRide, PHYSICS_HZ, POSITION_UNIT, rideKey, shapeDistance, soundsHit, type TSimulationResult } from '@/modules/simulation';

/** Gap between marble and piece under which the ride is not over yet */
const TOUCH_MARGIN = 0.002;

/**
 * The ride `piece` gave in `result`: from where the piece entered the run to where the marble last comes near it
 * before its next hit. Null when the piece didn't enter the run or the marble never rides it.
 */
function bakeRide(project: TProject, result: TSimulationResult, piece: TPiece): TRide | null {
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

/**
 * Keeps the rides of a track an edit is about to change, from `fromTime` on. Earlier ones stay simulated: the edit can't
 * reach them, and a ride played back differs by the last bits, which a rail turns into centimeters on the pieces after it.
 */
export function withRides(project: TProject, result: TSimulationResult, fromTime = -Infinity): TProject {
	let isChanged = false;
	const timeOf = (marbleId: string, hitId: string): number | undefined => project.marbles.find((marble) => marble.id === marbleId)?.hits.find((hit) => hit.id === hitId)?.time;
	const pieces = project.track.pieces.map((piece) => {
		const type = piece.type ?? '';
		const link = tieOf(piece);
		if (link == null || !hasRide(type) || soundsHit(type, link)) return piece;
		if (piece.ride?.key === rideKey(piece) || (timeOf(link.marbleId, link.hitId) ?? Infinity) < fromTime) return piece;
		const ride = bakeRide(project, result, piece);
		if (ride == null) return piece;
		isChanged = true;
		return { ...piece, ride };
	});
	return isChanged ? { ...project, track: { ...project.track, pieces } } : project;
}

function wrap(angle: number): number {
	return Math.atan2(Math.sin(angle), Math.cos(angle));
}
