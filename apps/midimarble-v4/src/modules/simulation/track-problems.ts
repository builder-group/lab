import { type TProject, type TVec2, tieOf } from '@/modules/project';
import { boundsOf, resolvedPieceShapes, shapesGap } from './clearance';
import { layoutOf } from './piece-layout';
import { soundsHit } from './pieces';
import { shapeDistance, type TBounds2, type TPieceShape } from './shapes';
import { HIT_TOLERANCE, IMPACT_SPEED, type TMarbleSample, type TMarbleTrack, type TResolvedPiece, type TSimulationResult } from './types';

// What's physically wrong with a run beyond its timing: pieces touching in the wall plane, a platform struck outside its
// note, a marble rolling on a platform. They're Problems, with no taste in them: every number here says what breaks.

/**
 * Least air between two pieces in the wall plane, in meters: a default marble's radius. A skin's body counts: every
 * built-in platform skin keeps the hitbox's top face and length but hangs below it (`visualShapes`). Pieces that only
 * lie over each other in the film's view are fine: the reference does that too.
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

/** Pieces of a run that stand anywhere on the wall: what a Blocked piece leaves out is not in the film */
function standingPieces(result: TSimulationResult): TResolvedPiece[] {
	return result.pieces.filter((piece) => piece.status === 'placed' || piece.status === 'held' || piece.status === 'free');
}

function marbleRadiusOf(project: TProject): number {
	return project.marbles[0]?.radius ?? 0.012;
}

export interface TTouchingPair {
	/** Piece IDs, the piece that plays first first */
	a: string;
	b: string;
	/** Air between them in the wall plane, in meters; negative when they overlap */
	gap: number;
	/** Where the two come closest, for bringing them into view */
	point: TVec2;
	/** The later of the two pieces' times */
	time: number;
}

/**
 * Pieces closer than `gap` in the wall plane, in time order. Free pieces and Decor are the person's own composition and
 * a Bowl stands apart from everything by its own search, so neither is judged.
 */
export function touchingPairs(project: TProject, result: TSimulationResult): TTouchingPair[] {
	const gap = MIN_PIECE_GAP;
	const radius = marbleRadiusOf(project);
	const pieces = new Map(project.track.pieces.map((piece) => [piece.id, piece]));
	const items = standingPieces(result)
		.filter((piece) => tieOf(pieces.get(piece.pieceId)) != null && piece.type !== 'bowl')
		.map((piece) => ({ piece, shapes: visualShapes(piece, radius), time: piece.hitTime ?? piece.entryTime ?? 0 }));
	const pairs: TTouchingPair[] = [];
	for (const [i, j] of pairsWithin(items.map((item) => boundsOf(item.shapes)), gap)) {
		const [first, second] = [items[i], items[j]];
		if (first == null || second == null) continue;
		const between = shapesGap(first.shapes, second.shapes, gap);
		if (between >= gap) continue;
		const [a, b] = first.time <= second.time ? [first, second] : [second, first];
		pairs.push({ a: a.piece.pieceId, b: b.piece.pieceId, gap: between, point: { x: (a.piece.position.x + b.piece.position.x) / 2, y: (a.piece.position.y + b.piece.position.y) / 2 }, time: b.time });
	}
	return pairs.sort((x, y) => x.time - y.time);
}

/** Index pairs in order whose bounds come within `gap` vertically, found by sweeping down the wall: a long song's 800 pieces make 300,000 pairs */
function pairsWithin(bounds: readonly TBounds2[], gap: number): [number, number][] {
	const down = bounds.map((_, index) => index).sort((a, b) => (bounds[a]?.minY ?? 0) - (bounds[b]?.minY ?? 0));
	const pairs: [number, number][] = [];
	for (let k = 0; k < down.length; k++) {
		const i = down[k] as number;
		const bottom = (bounds[i] as TBounds2).maxY;
		for (let l = k + 1; l < down.length; l++) {
			const j = down[l] as number;
			if ((bounds[j] as TBounds2).minY - bottom >= gap) break;
			pairs.push(i < j ? [i, j] : [j, i]);
		}
	}
	return pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** Air from `piece` to the nearest other standing piece in the wall plane, for a check while placing */
export function nearestPieceGap(project: TProject, result: TSimulationResult, entityId: string, limit: number): number {
	const radius = marbleRadiusOf(project);
	const resolvedPieces = standingPieces(result);
	const piece = resolvedPieces.find((item) => item.pieceId === entityId);
	if (piece == null) return Infinity;
	const pieces = new Map(project.track.pieces.map((piece) => [piece.id, piece]));
	const shapes = visualShapes(piece, radius);
	let nearest = Infinity;
	for (const other of resolvedPieces) {
		if (other === piece || tieOf(pieces.get(other.pieceId)) == null || other.type === 'bowl') continue;
		nearest = Math.min(nearest, shapesGap(shapes, visualShapes(other, radius), limit));
	}
	return nearest;
}

/** A marble falling this far between two notes leaves the frame on the way: about a film frame's height on the wall */
export const LONG_FALL = 1;

/** A platform its own marble strikes more than the once its note asks for */
export interface TExtraStrike {
	entityId: string;
	marbleId: string;
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
 * earlier note. Only platforms that sound a hit count: a marble riding a rail or landing in a Bowl is
 * meant to, and a free platform is scenery. A hit that is already Blocked or Missed is reported as that.
 */
export function extraStrikes(project: TProject, result: TSimulationResult): TExtraStrike[] {
	const marbleOf = new Map(result.marbles.map((marble) => [marble.marbleId, marble.marbleId]));
	const strikes: TExtraStrike[] = [];
	for (const hit of result.hits) {
		const entityId = hit.pieceId;
		if (entityId == null || hit.actualTime == null || (hit.status !== 'onTime' && hit.status !== 'drifting')) continue;
		const piece = project.track.pieces.find((item) => item.id === entityId);
		const type = piece?.type;
		if (type == null || layoutOf(type) !== 'box' || !soundsHit(type, tieOf(piece))) continue;
		const marbleId = marbleOf.get(hit.marbleId);
		const note = hit.actualTime;
		const isLast = project.marbles.find((marble) => marble.id === hit.marbleId)?.hits.at(-1)?.id === hit.hitId;
		const extra = result.contacts.filter((contact) => {
			if (contact.marbleId !== marbleId || contact.otherId !== entityId || contact.time > result.duration || Math.abs(contact.time - note) <= SAME_STRIKE) return false;
			// After the marble's last note it may come to rest; only another real bounce still shows
			return !isLast || contact.time < note || (contact.speed ?? Infinity) >= IMPACT_SPEED;
		});
		const first = extra[0];
		if (first == null) continue;
		strikes.push({ entityId, marbleId: hit.marbleId, hitId: hit.hitId, times: extra.length + 1, time: first.time, position: first.position });
	}
	return strikes.sort((a, b) => a.time - b.time);
}

/** How far into a skin's body a marble's center must come to count as passing through it: a graze of the edge isn't one */
const PASS_DEPTH_RADII = 0.25;

/** A piece whose skin a marble goes through, where it has no hitbox */
export interface TPassThrough {
	entityId: string;
	marbleId: string;
	time: number;
	position: TVec2;
}

/**
 * Standing platforms whose body a marble's path runs through: the hitbox is only the top face, so nothing stops the
 * marble below it and the film shows it inside the piece. A marble can't enter a hitbox, so only what hangs below can
 * count, and a rail or tunnel never does (`visualShapes`).
 */
export function passThroughs(project: TProject, result: TSimulationResult): TPassThrough[] {
	const boxes = standingPieces(result).filter((piece) => layoutOf(piece.type) === 'box');
	const passes: TPassThrough[] = [];
	for (const marble of result.marbles) {
		const limit = marble.radius * (1 - PASS_DEPTH_RADII);
		const chunks = sampleChunks(marble.samples);
		const shaped = boxes.map((piece) => ({ piece, shapes: visualShapes(piece, marble.radius), reach: (piece.params['length'] ?? 0) / 2 + 3 * marble.radius }));
		for (const { piece, shapes, reach } of shaped) {
			const { x, y } = piece.position;
			let found: TMarbleSample | undefined;
			for (const chunk of chunks) {
				if (chunk.maxX <= x - reach || chunk.minX >= x + reach || chunk.maxY <= y - reach || chunk.minY >= y + reach) continue;
				for (let index = chunk.from; index < chunk.to && found == null; index++) {
					const sample = marble.samples[index] as TMarbleSample;
					const { time, position } = sample;
					if (time <= result.duration && Math.abs(position.x - x) < reach && Math.abs(position.y - y) < reach && shapes.some((shape) => shapeDistance(shape, position.x, position.y) < limit)) found = sample;
				}
				if (found != null) break;
			}
			if (found != null) passes.push({ entityId: piece.pieceId, marbleId: marble.marbleId, time: found.time, position: found.position });
		}
	}
	return passes.sort((a, b) => a.time - b.time);
}

const SAMPLE_CHUNK = 64;

/** A marble's path in runs of samples with their bounds: asking every sample of a long song about every piece took half a second */
function sampleChunks(samples: readonly TMarbleSample[]): { from: number; to: number; minX: number; maxX: number; minY: number; maxY: number }[] {
	const chunks = [];
	for (let from = 0; from < samples.length; from += SAMPLE_CHUNK) {
		const to = Math.min(samples.length, from + SAMPLE_CHUNK);
		let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
		for (let index = from; index < to; index++) {
			const { x, y } = (samples[index] as TMarbleSample).position;
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
		}
		chunks.push({ from, to, minX, maxX, minY, maxY });
	}
	return chunks;
}

/**
 * How high a marble aims to rise off a platform, in marble radii, and how soon, in seconds. Next and Build Track ask this
 * takeoff of a bounce; Jingle Bells' bounces reach it in about 0.02 s, at 0.04 s at the slowest.
 */
const BOUNCE_RISE_RADII = 1;
const BOUNCE_RISE_WITHIN = 0.1;
/**
 * Less than this rise off the surface in that time is a roll, not a bounce, measured along the surface's normal: on a
 * 3 cm bar a marble with no bounce at all skids off the end and gets a radius away from the bar in 0.06 s, so distance
 * from the bar can't tell. Measured on Zigzags of 3 cm bars at Gravity 0.5 and 1: a dead bar (Bounce 0 to 0.1) reaches
 * 0.11 to 0.19 radii, real bounces 1.45 and up, and every 9 cm fixture's that isn't a roll 0.71 and up.
 */
const ROLL_RISE_RADII = 0.5;

/** Least takeoff speed off a platform that reaches the height of a bounce in time, at this gravity */
export function bounceTakeoff(marbleRadius: number, gravity: number): number {
	return (BOUNCE_RISE_RADII * marbleRadius) / BOUNCE_RISE_WITHIN + (gravity * BOUNCE_RISE_WITHIN) / 2;
}

/** A platform its marble rolls along instead of bouncing off */
export interface TRollingHit {
	entityId: string;
	marbleId: string;
	hitId: string;
	/** Height the marble reached above the platform in the time a bounce has, in meters */
	rise: number;
	time: number;
	position: TVec2;
}

/**
 * Whether a marble struck `piece` at `note` and failed to leave its surface: a platform is for bouncing. The marble must
 * rise `ROLL_RISE_RADII` within `BOUNCE_RISE_WITHIN`, or by its next note when that comes sooner. Null while the run
 * doesn't reach that far, since nothing is known yet.
 */
export function riseAfterHit(piece: TResolvedPiece, marble: TMarbleTrack, note: number, nextNote: number | null): { rise: number; isBounce: boolean } | null {
	const { samples, radius } = marble;
	const until = Math.min(note + BOUNCE_RISE_WITHIN, nextNote ?? Infinity);
	if ((samples.at(-1)?.time ?? -Infinity) < until) return null;
	const normal = { x: -Math.sin(piece.angle), y: Math.cos(piece.angle) };
	const surface = (piece.params['thickness'] ?? 0) / 2 + radius;
	const needed = ROLL_RISE_RADII * radius;
	let low = 0;
	let high = samples.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		if ((samples[middle]?.time ?? Infinity) < note) low = middle + 1;
		else high = middle;
	}
	let rise = 0;
	for (let index = low; index < samples.length; index++) {
		const sample = samples[index];
		if (sample == null || sample.time > until) break;
		rise = Math.max(rise, Math.abs((sample.position.x - piece.position.x) * normal.x + (sample.position.y - piece.position.y) * normal.y) - surface);
		if (rise >= needed) return { rise, isBounce: true };
	}
	return { rise, isBounce: false };
}

/**
 * Platforms a marble rolls along after its note. Rails and the Bowl are exempt, since rolling is their
 * job, a free platform is scenery, and after a marble's last note it may come to rest. A hit that is already Blocked or
 * Missed is reported as that.
 */
export function rollingHits(project: TProject, result: TSimulationResult): TRollingHit[] {
	const resolvedPieces = new Map(result.pieces.map((piece) => [piece.pieceId, piece]));
	const pieces = new Map(project.track.pieces.map((piece) => [piece.id, piece]));
	const rolls: TRollingHit[] = [];
	for (const marble of project.marbles) {
		const marbleEntity = result.marbles.find((item) => item.marbleId === marble.id);
		if (marbleEntity == null) continue;
		const hits = new Map(result.hits.filter((hit) => hit.marbleId === marble.id).map((hit) => [hit.hitId, hit]));
		marble.hits.forEach((item, index) => {
			const hit = hits.get(item.id);
			const following = marble.hits[index + 1];
			if (following == null || hit?.pieceId == null || hit.actualTime == null || (hit.status !== 'onTime' && hit.status !== 'drifting')) return;
			const piece = pieces.get(hit.pieceId);
			const resolvedPiece = resolvedPieces.get(hit.pieceId);
			const type = piece?.type;
			if (resolvedPiece == null || type == null || layoutOf(type) !== 'box' || !soundsHit(type, tieOf(piece))) return;
			const risen = riseAfterHit(resolvedPiece, marbleEntity, hit.actualTime, following.time);
			if (risen == null || risen.isBounce) return;
			rolls.push({ entityId: hit.pieceId, marbleId: marble.id, hitId: hit.hitId, rise: risen.rise, time: hit.actualTime, position: hit.dot ?? resolvedPiece.position });
		});
	}
	return rolls.sort((a, b) => a.time - b.time);
}
