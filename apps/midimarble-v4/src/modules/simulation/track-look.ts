import type { TProject, TVec2 } from '@/modules/project';
import { resolvedPieceShapes, shapesGap } from './clearance';
import { shapesBounds } from './shapes';
import { layoutOf } from './piece-layout';
import { soundsHit } from './pieces';
import type { TPieceShape } from './shapes';
import { HIT_TOLERANCE, IMPACT_SPEED, type TResolvedPiece, type TSimulationResult } from './types';

// How a track looks, beyond whether it plays on time: how close its pieces come as the film shows them and how often a
// marble strikes a platform. Build Track, Next, Fix Hits and the problem list all read these.

/**
 * Least air between two pieces as the film shows them, in metres: a default marble's radius. The film sees skins, not
 * hitboxes, and every built-in platform skin keeps the hitbox's top face and length but hangs below it (`visualShapes`).
 */
export const MIN_PIECE_GAP = 0.012;

/** A skin's body below its top face: Gift's 17 mm box at the 8 mm marble, in marble radii, and the deepest device housing */
const SKIN_DEPTH_RADII = 2.125;
const DEVICE_DEPTH_THICKNESS = 2;
const DEVICE_LIP_RADII = 0.15;
/** A Gift's ribbon stands a hair past the hitbox's ends, in marble radii */
const SKIN_OVERHANG_RADII = 0.05;

/**
 * Hitboxes of a resolved piece grown to the body of the deepest built-in skin, since that is what the film shows. A
 * platform's skin shares the hitbox's top face and ends and hangs below it: a Gift to 2.125 marble radii, a Key device
 * to two thicknesses and a lip. Thin chrome brackets behind a bar are left out, and other pieces look like their hitboxes.
 */
export function visualShapes(piece: TResolvedPiece, marbleRadius: number): TPieceShape[] {
	if (layoutOf(piece.type) !== 'box') return resolvedPieceShapes(piece);
	const thickness = piece.params['thickness'] ?? 0;
	const length = piece.params['length'] ?? 0;
	const depth = Math.max(thickness, SKIN_DEPTH_RADII * marbleRadius, DEVICE_DEPTH_THICKNESS * thickness + DEVICE_LIP_RADII * marbleRadius);
	// The body grows away from the top face, along the surface's own downward normal
	const drop = (depth - thickness) / 2;
	return [
		{
			kind: 'box',
			box: {
				cx: piece.position.x + Math.sin(piece.angle) * drop,
				cy: piece.position.y - Math.cos(piece.angle) * drop,
				angle: piece.angle,
				halfLength: length / 2 + SKIN_OVERHANG_RADII * marbleRadius,
				halfThickness: depth / 2
			}
		}
	];
}

/**
 * How far either side of a lane's centre the marble strikes, in piece lengths. The reference short hops 0.65 bars (see
 * references.md, What good tracks do); at half gravity and half-second notes a hop under a bar clears nothing, so 1.44.
 */
const STRIKE_COLUMN = 0.72;
/** Where on a lane's sides the marble strikes, either side of its centre */
export function columnOffset(pieceLength: number): number {
	return STRIKE_COLUMN * pieceLength;
}

/** Pieces of a run that stand anywhere on the wall: what a Blocked piece leaves out is not in the film */
function standingPieces(result: TSimulationResult): TResolvedPiece[] {
	return result.pieces.filter((piece) => piece.status === 'placed' || piece.status === 'pinned' || piece.status === 'free');
}

function marbleRadiusOf(project: TProject): number {
	return project.entities.find((entity) => entity.components.marble != null)?.components.marble?.radius ?? 0.012;
}

export interface TTouchingPair {
	/** Entity IDs, the piece that plays first first */
	a: string;
	b: string;
	/** Air between them as the film shows them, in metres; negative when they overlap */
	gap: number;
	/** Where the two come closest, for bringing them into view */
	point: TVec2;
	/** The later of the two pieces' times */
	time: number;
}

/**
 * Pieces closer than `gap` as the film shows them, in time order. Free pieces and Decor are the person's own composition
 * and a Finish stands apart from everything by its own search, so neither is judged.
 */
export function touchingPairs(project: TProject, result: TSimulationResult, gap = MIN_PIECE_GAP): TTouchingPair[] {
	const radius = marbleRadiusOf(project);
	const entities = new Map(project.entities.map((entity) => [entity.id, entity]));
	const items = standingPieces(result)
		.filter((piece) => entities.get(piece.entityId)?.components.hitLink != null && piece.type !== 'finish')
		.map((piece) => {
			const shapes = visualShapes(piece, radius);
			return { piece, shapes, bounds: shapesBounds(shapes), time: piece.hitTime ?? piece.entryTime ?? 0 };
		});
	const pairs: TTouchingPair[] = [];
	for (let i = 0; i < items.length; i++) {
		for (let j = i + 1; j < items.length; j++) {
			const [first, second] = [items[i], items[j]];
			if (first == null || second == null) continue;
			// Bounds this far apart settle it without measuring every pair of shapes
			if (first.bounds.minX - second.bounds.maxX >= gap || second.bounds.minX - first.bounds.maxX >= gap || first.bounds.minY - second.bounds.maxY >= gap || second.bounds.minY - first.bounds.maxY >= gap) continue;
			const between = shapesGap(first.shapes, second.shapes, gap);
			if (between >= gap) continue;
			const [a, b] = first.time <= second.time ? [first, second] : [second, first];
			pairs.push({ a: a.piece.entityId, b: b.piece.entityId, gap: between, point: { x: (a.piece.position.x + b.piece.position.x) / 2, y: (a.piece.position.y + b.piece.position.y) / 2 }, time: b.time });
		}
	}
	return pairs.sort((x, y) => x.time - y.time);
}

/** Air from `piece` to the nearest other standing piece as the film shows them, for a check while placing */
export function nearestPieceGap(project: TProject, result: TSimulationResult, entityId: string, limit: number): number {
	const radius = marbleRadiusOf(project);
	const pieces = standingPieces(result);
	const piece = pieces.find((item) => item.entityId === entityId);
	if (piece == null) return Infinity;
	const entities = new Map(project.entities.map((entity) => [entity.id, entity]));
	const shapes = visualShapes(piece, radius);
	let nearest = Infinity;
	for (const other of pieces) {
		if (other === piece || entities.get(other.entityId)?.components.hitLink == null || other.type === 'finish') continue;
		nearest = Math.min(nearest, shapesGap(shapes, visualShapes(other, radius), limit));
	}
	return nearest;
}

/** A platform its own marble strikes more than the once its note asks for */
export interface TExtraStrike {
	entityId: string;
	laneId: string;
	hitId: string;
	/** Every strike of the marble on it, the note's included */
	times: number;
	/** When the first strike without a note happens */
	time: number;
	position: TVec2;
}

/** A marble that stays on a platform is reported again by every step it re-touches; these count as one strike */
const SAME_STRIKE = HIT_TOLERANCE + 0.01;

/**
 * Platforms a marble strikes outside their note: a second bounce, a roll along the top, or a graze on the way to an
 * earlier note. Only platforms that sound a hit count: a marble riding a switchback or rail or landing in a Finish is
 * meant to, and a free platform is scenery. A hit that is already Blocked or Missed is reported as that.
 */
export function extraStrikes(project: TProject, result: TSimulationResult): TExtraStrike[] {
	const marbleOf = new Map(result.marbles.map((marble) => [marble.laneId, marble.entityId]));
	const strikes: TExtraStrike[] = [];
	for (const hit of result.hits) {
		const entityId = hit.pieceEntityId;
		if (entityId == null || hit.actualTime == null || (hit.status !== 'onTime' && hit.status !== 'drifting')) continue;
		const entity = project.entities.find((item) => item.id === entityId);
		const type = entity?.components.piece?.type;
		if (type == null || layoutOf(type) !== 'box' || !soundsHit(type, entity?.components.hitLink)) continue;
		const marbleId = marbleOf.get(hit.laneId);
		const note = hit.actualTime;
		const isLast = project.music.lanes.find((lane) => lane.id === hit.laneId)?.hits.at(-1)?.id === hit.hitId;
		const extra = result.contacts.filter((contact) => {
			if (contact.marbleEntityId !== marbleId || contact.otherEntityId !== entityId || contact.time > result.duration || Math.abs(contact.time - note) <= SAME_STRIKE) return false;
			// After the marble's last note it may come to rest; only another real bounce still shows
			return !isLast || contact.time < note || (contact.speed ?? Infinity) >= IMPACT_SPEED;
		});
		const first = extra[0];
		if (first == null) continue;
		strikes.push({ entityId, laneId: hit.laneId, hitId: hit.hitId, times: extra.length + 1, time: first.time, position: first.position });
	}
	return strikes.sort((a, b) => a.time - b.time);
}
