import { Err, Ok, type TResult } from 'tuple-result';
import { DEFAULT_MARBLE_RADIUS, type TPiece, type TProject, type TProjectCommand, type TVec2, tieOf } from '@/modules/project';
import { gravityOf, layoutFree, layoutOf, type TLayoutInput, ANCHOR_DELAY, isMusicalPiece, resolvePieceParams, resolvePiecePath, soundsHit, trajectoryAt, type TResolvedPiece, type TSimulationResult } from '@/modules/simulation';

// Converting a piece between its three states keeps its world pose where possible:
// - free: a transform in the world, environment the marbles may strike
// - anchored: follows a marble's trajectory at a moment in time and plays no note
// - linked: a musical platform on a hit dot that sounds that hit

export interface TAttachResult {
	/** The piece after the change */
	piece: TPiece;
	/** One edit that applies the change */
	commands: TProjectCommand[];
}

/**
 * The hit an anchor at `time` is stored against: the last hit at or before it, or the first hit when the
 * moment comes before it, so the delay is negative. Null when the moment is more than `ANCHOR_DELAY` away.
 */
export function anchorHit<T extends { time: number }>(hits: T[], time: number): T | null {
	const before = hits.filter((item) => item.time <= time + 1e-9).at(-1);
	if (before != null) return time - before.time <= ANCHOR_DELAY ? before : null;
	const first = hits[0];
	return first != null && first.time - time <= ANCHOR_DELAY ? first : null;
}

/**
 * Anchors a piece to the trajectory of `marbleId`'s marble at `time`. The piece keeps its pose relative to the
 * marble at that moment, so it follows upstream edits, and it never sounds a hit. Any piece type can be
 * anchored; the moment must lie within `ANCHOR_DELAY` seconds after one of the marble's hits, or before its
 * first hit.
 */
export function anchorPiece(
	project: TProject,
	result: TSimulationResult,
	pieceId: string,
	marbleId: string,
	time: number
): TResult<TAttachResult, Error> {
	const [isFound, findErr, found] = findPiece(project, result, pieceId);
	if (!isFound) return Err(findErr);
	const { piece, resolved } = found;
	const marble = project.marbles.find((item) => item.id === marbleId);
	if (marble == null) return Err(new Error(`Marble ${marbleId} not found`));
	const hit = anchorHit(marble.hits, time);
	if (hit == null)
		return Err(new Error(`No hit of ${marble.name} within ${ANCHOR_DELAY} s of that moment`));
	const track = result.marbles.find((marble) => marble.marbleId === marbleId);
	const sample = track != null ? trajectoryAt(track.samples, time, gravityOf(project)) : null;
	if (track == null || sample == null)
		return Err(new Error(`The marble of ${marble.name} does not reach that moment`));

	const pose = freePose(piece, resolved, track.radius);
	const contactAt = tieOf(piece)?.contactAt ?? 0.5;
	const next: TPiece = {
		...piece,
		params: { ...piece.params, entryDelay: time - hit.time },
		angle: pose.angle,
		place: {
			kind: 'follows',
			marbleId,
			hitId: hit.id,
			...(contactAt !== 0.5 ? { contactAt } : {}),
			offset: { x: pose.position.x - sample.position.x, y: pose.position.y - sample.position.y }
		}
	};
	return Ok({ piece: next, commands: [{ type: 'addPiece', piece: next }] });
}

/** Turns an anchored piece back into a free piece at its current pose */
export function unanchorPiece(
	project: TProject,
	result: TSimulationResult,
	pieceId: string
): TResult<TAttachResult, Error> {
	return detach(project, result, pieceId, 'anchored');
}

/**
 * Links a musical piece to a hit dot so it sounds that hit. The piece keeps its angle, and where the dot
 * falls along its surface becomes the contact point, so the bar moves only as far as it must to touch
 * the marble.
 */
export function linkPieceToHit(
	project: TProject,
	result: TSimulationResult,
	pieceId: string,
	marbleId: string,
	hitId: string
): TResult<TAttachResult, Error> {
	const [isFound, findErr, found] = findPiece(project, result, pieceId);
	if (!isFound) return Err(findErr);
	const { piece, resolved } = found;
	const type = piece.type ?? '';
	if (!isMusicalPiece(type)) return Err(new Error(`A ${type} is scenery; anchor it instead`));
	const marble = project.marbles.find((item) => item.id === marbleId);
	const hit = marble?.hits.find((item) => item.id === hitId);
	if (marble == null || hit == null) return Err(new Error(`Hit ${hitId} not found`));
	const owner = project.track.pieces.find(
		(item) =>
			item.id !== pieceId &&
			tieOf(item)?.marbleId === marbleId &&
			tieOf(item)?.hitId === hitId &&
			soundsHit(item.type, tieOf(item))
	);
	if (owner != null) return Err(new Error(`The hit already has ${owner.name ?? 'a piece'}`));
	const track = result.marbles.find((marble) => marble.marbleId === marbleId);
	const dot =
		result.hits.find((item) => item.marbleId === marbleId && item.hitId === hitId)?.dot ??
		(track != null ? trajectoryAt(track.samples, hit.time, gravityOf(project))?.position : null);
	if (dot == null) return Err(new Error(`The marble of ${marble.name} does not reach that hit`));

	const pose = freePose(piece, resolved, track?.radius);
	const params = resolvePieceParams(type, piece.params ?? {});
	const length = params['length'] ?? 0.06;
	const along =
		(dot.x - pose.position.x) * Math.cos(pose.angle) + (dot.y - pose.position.y) * Math.sin(pose.angle);
	const contactAt = Math.min(1, Math.max(0, 0.5 + along / length));
	const next: TPiece = { ...piece, params: { ...piece.params, entryDelay: 0 }, angle: pose.angle, place: { kind: 'plays', marbleId, hitId, contactAt } };
	return Ok({ piece: next, commands: [{ type: 'addPiece', piece: next }] });
}

/** Turns a linked piece back into a free piece at its current pose; its hit opens again */
export function unlinkPiece(
	project: TProject,
	result: TSimulationResult,
	pieceId: string
): TResult<TAttachResult, Error> {
	return detach(project, result, pieceId, 'linked');
}

/**
 * The free transform that reproduces a resolved pose. Free layouts place rails and tunnels by their
 * local origin and generated paths by their entry point, so the shift between the pose origin and the
 * transform is taken from a layout at the world origin.
 */
export function freePose(
	piece: TPiece,
	resolved: TResolvedPiece,
	marbleRadius = DEFAULT_MARBLE_RADIUS
): { position: TVec2; angle: number } {
	if (resolved.status === 'free') return { position: { ...resolved.position }, angle: resolved.angle };
	const type = piece.type ?? resolved.type;
	if (layoutOf(type) === 'box' || layoutOf(type) === 'rotor')
		return { position: { ...resolved.position }, angle: resolved.angle };
	const input: TLayoutInput = {
		type,
		params: resolved.params,
		path: resolvePiecePath(type, piece.path?.points),
		extraPaths: piece.path?.paths,
		layout: piece.layout,
		angle: resolved.angle,
		contactAt: tieOf(piece)?.contactAt ?? 0.5,
		marbleRadius
	};
	const shift = layoutFree(input, { x: 0, y: 0 }).position;
	return {
		position: { x: resolved.position.x - shift.x, y: resolved.position.y - shift.y },
		angle: resolved.angle
	};
}

function detach(
	project: TProject,
	result: TSimulationResult,
	pieceId: string,
	from: 'anchored' | 'linked'
): TResult<TAttachResult, Error> {
	const [isFound, findErr, found] = findPiece(project, result, pieceId);
	if (!isFound) return Err(findErr);
	const { piece, resolved } = found;
	const tie = tieOf(piece);
	if (tie == null) return Err(new Error(`${piece.name ?? pieceId} plays no note and follows no marble`));
	const isLinked = soundsHit(piece.type, tie);
	if (from === 'linked' && !isLinked) return Err(new Error(`${piece.name ?? pieceId} is anchored, not linked`));
	if (from === 'anchored' && isLinked) return Err(new Error(`${piece.name ?? pieceId} is linked, not anchored`));
	if (resolved.status === 'unreached')
		return Err(new Error(`${piece.name ?? pieceId} has no pose in this run`));
	const radius = result.marbles.find((marble) => marble.marbleId === tie.marbleId)?.radius;
	const pose = freePose(piece, resolved, radius);
	const { entryDelay: _, ...params } = piece.params;
	const next: TPiece = { ...piece, params, angle: pose.angle, place: { kind: 'free', position: pose.position } };
	return Ok({ piece: next, commands: [{ type: 'addPiece', piece: next }] });
}

function findPiece(
	project: TProject,
	result: TSimulationResult,
	pieceId: string
): TResult<{ piece: TPiece; resolved: TResolvedPiece }, Error> {
	const piece = project.track.pieces.find((item) => item.id === pieceId);
	if (piece == null) return Err(new Error(`Piece ${pieceId} not found`));
	if (result.revision !== project.revision)
		return Err(new Error('The run is out of date; wait for the simulation to catch up'));
	const resolved = result.pieces.find((item) => item.pieceId === pieceId);
	if (resolved == null) return Err(new Error(`${piece.name ?? pieceId} has no pose in this run`));
	return Ok({ piece, resolved });
}
