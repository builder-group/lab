import type { TProject, TVec2 } from '@/modules/project';
import { resolvedPieceShapes, shapesGap } from './clearance';
import { layoutOf } from './piece-layout';
import { shownDepth, soundsHit } from './pieces';
import { shapeDistance, shapesBounds, type TBounds2, type TPieceShape } from './shapes';
import { HIT_TOLERANCE, IMPACT_SPEED, type TMarbleTrack, type TResolvedPiece, type TSimulationResult } from './types';

// How a track looks, beyond whether it plays on time: how close its pieces come as the film shows them, how often a
// marble strikes a platform and whether it bounces off it. Build Track, Next, Fix Hits and the problem list all read these.

/**
 * Least air between two pieces as the film shows them, in metres at the wall: a default marble's radius. The film sees
 * skins, not hitboxes: every built-in platform skin keeps the hitbox's top face and length but hangs below it
 * (`visualShapes`) and stands out from the wall, which the film's pitch folds (`filmView`).
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

/** One convex outline in the image, in metres: x as on the wall, y as wall height the image's height stands for */
export type TFilmOutline = TVec2[];

/** A piece as the film shows it, for measuring against another with `filmGap` */
export interface TFilmView {
	shapes: TPieceShape[];
	/** Only a bar has a body that stands out; a Rail is thin wire, and measured on the wall */
	outline: TFilmOutline | null;
	bounds: TBounds2;
	outlineBounds: TBounds2 | null;
}

/**
 * A piece as the film shows it. The camera looks along the wall at `pitch` from its normal, so a wall height folds by
 * cos(pitch) and what stands out from the wall shifts up by sin(pitch) of that distance: at 1.15 rad a 9 cm deep plate
 * covers as much of the image above its own top face as 20 cm of wall. So two bars well apart on the wall can lie on top
 * of each other in the film. Heights are given back as wall heights, tan(pitch) of the distance from the wall, so the
 * one least gap holds everywhere. Perspective and the camera's small sway are left out.
 */
export function filmView(piece: TResolvedPiece, marbleRadius: number, pitch: number): TFilmView {
	const shapes = visualShapes(piece, marbleRadius);
	const bounds = shapesBounds(shapes);
	if (layoutOf(piece.type) !== 'box') return { shapes, outline: null, bounds, outlineBounds: null };
	const shift = Math.tan(pitch) * shownDepth(piece);
	const outline = convexHull(shapes.flatMap(shapeCorners).flatMap((point) => [point, { x: point.x, y: point.y + shift }]));
	return { shapes, outline, bounds, outlineBounds: outlineBounds(outline) };
}

/**
 * Air between two pieces as the film shows them, negative when they overlap, measured on the wall. Two bars must also
 * stand clear of each other in the image, seen through the film's pitch: when they overlap there the result is below
 * `MIN_PIECE_GAP` by how deep. Asking for air in the image too left Jingle Bells no way through, so bars may just
 * clear. At least `limit` when their bounds already say so.
 */
export function filmGap(a: TFilmView, b: TFilmView, limit = Infinity): number {
	const onWall = isApart(a.bounds, b.bounds, limit) ? limit : shapesGap(a.shapes, b.shapes, limit);
	if (a.outline == null || b.outline == null || a.outlineBounds == null || b.outlineBounds == null) return onWall;
	if (isApart(a.outlineBounds, b.outlineBounds, 0)) return onWall;
	const inImage = outlineGap(a.outline, b.outline, 0);
	return inImage > 0 ? onWall : Math.min(onWall, MIN_PIECE_GAP + inImage - 1e-6);
}

function isApart(a: TBounds2, b: TBounds2, limit: number): boolean {
	return a.minX - b.maxX >= limit || b.minX - a.maxX >= limit || a.minY - b.maxY >= limit || b.minY - a.maxY >= limit;
}

/** The film's pitch; a manual camera lives in Blender, so it keeps the pitch the project was left with */
export function filmPitch(project: TProject): number {
	return project.design.camera.pitch;
}

function outlineBounds(outline: TFilmOutline): TBounds2 {
	return {
		minX: Math.min(...outline.map((point) => point.x)),
		minY: Math.min(...outline.map((point) => point.y)),
		maxX: Math.max(...outline.map((point) => point.x)),
		maxY: Math.max(...outline.map((point) => point.y))
	};
}

function shapeCorners(shape: TPieceShape): TVec2[] {
	if (shape.kind !== 'box') return [];
	const { cx, cy, angle, halfLength, halfThickness } = shape.box;
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	return [
		[-halfLength, -halfThickness],
		[halfLength, -halfThickness],
		[halfLength, halfThickness],
		[-halfLength, halfThickness]
	].map(([lx = 0, ly = 0]) => ({ x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos }));
}

/** Counter-clockwise convex hull */
function convexHull(points: TVec2[]): TFilmOutline {
	const sorted = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
	const half = (items: TVec2[]): TVec2[] => {
		const hull: TVec2[] = [];
		for (const point of items) {
			for (;;) {
				const [from, to] = [hull[hull.length - 2], hull[hull.length - 1]];
				if (from == null || to == null || (to.x - from.x) * (point.y - from.y) - (to.y - from.y) * (point.x - from.x) > 0) break;
				hull.pop();
			}
			hull.push(point);
		}
		hull.pop();
		return hull;
	};
	return [...half(sorted), ...half(sorted.reverse())];
}

/** Distance between two convex outlines, or how deep they overlap as a negative distance */
function outlineGap(a: TFilmOutline, b: TFilmOutline, limit: number): number {
	let separation = -Infinity;
	for (const [from, to] of [
		[a, b],
		[b, a]
	] as const) {
		from.forEach((start, index) => {
			const end = from[(index + 1) % from.length] ?? start;
			const length = Math.hypot(end.x - start.x, end.y - start.y) || 1;
			// Outward normal of a counter-clockwise edge
			const nx = (end.y - start.y) / length;
			const ny = (start.x - end.x) / length;
			let nearest = Infinity;
			for (const point of to) nearest = Math.min(nearest, (point.x - start.x) * nx + (point.y - start.y) * ny);
			separation = Math.max(separation, nearest);
		});
	}
	if (separation <= 0 || separation >= limit) return separation;
	let gap = Infinity;
	for (const [from, to] of [
		[a, b],
		[b, a]
	] as const) {
		for (const point of from) {
			to.forEach((start, index) => {
				const end = to[(index + 1) % to.length] ?? start;
				const dx = end.x - start.x;
				const dy = end.y - start.y;
				const along = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy || 1)));
				gap = Math.min(gap, Math.hypot(point.x - start.x - along * dx, point.y - start.y - along * dy));
			});
		}
	}
	return gap;
}

/** Pieces of a run that stand anywhere on the wall: what a Blocked piece leaves out is not in the film */
function standingPieces(result: TSimulationResult): TResolvedPiece[] {
	return result.pieces.filter((piece) => piece.status === 'placed' || piece.status === 'held' || piece.status === 'free');
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
 * Pieces closer than `gap` as the film shows them, two bars seen through its pitch (`filmView`), in time order. Free pieces and Decor are the person's own composition
 * and a Bowl stands apart from everything by its own search, so neither is judged.
 */
export function touchingPairs(project: TProject, result: TSimulationResult, gap = MIN_PIECE_GAP): TTouchingPair[] {
	const radius = marbleRadiusOf(project);
	const pitch = filmPitch(project);
	const entities = new Map(project.entities.map((entity) => [entity.id, entity]));
	const items = standingPieces(result)
		.filter((piece) => entities.get(piece.entityId)?.components.hitLink != null && piece.type !== 'bowl')
		.map((piece) => ({ piece, view: filmView(piece, radius, pitch), time: piece.hitTime ?? piece.entryTime ?? 0 }));
	const pairs: TTouchingPair[] = [];
	for (let i = 0; i < items.length; i++) {
		for (let j = i + 1; j < items.length; j++) {
			const [first, second] = [items[i], items[j]];
			if (first == null || second == null) continue;
			const between = filmGap(first.view, second.view, gap);
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
	const pitch = filmPitch(project);
	const view = filmView(piece, radius, pitch);
	let nearest = Infinity;
	for (const other of pieces) {
		if (other === piece || entities.get(other.entityId)?.components.hitLink == null || other.type === 'bowl') continue;
		nearest = Math.min(nearest, filmGap(view, filmView(other, radius, pitch), limit));
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
 * earlier note. Only platforms that sound a hit count: a marble riding a rail or landing in a Bowl is
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

/**
 * How high a marble must rise off a platform, in marble radii, and how soon, in seconds, for its hit to count as a bounce.
 * On Jingle Bells a bounce reaches this height in about 0.02 s, at 0.04 s at the slowest, and a roll takes 0.2 s and more.
 */
const BOUNCE_RISE_RADII = 1;
const BOUNCE_RISE_WITHIN = 0.1;

/** Least takeoff speed off a platform that reaches the height of a bounce in time, at this gravity */
export function bounceTakeoff(marbleRadius: number, gravity: number): number {
	return (BOUNCE_RISE_RADII * marbleRadius) / BOUNCE_RISE_WITHIN + (gravity * BOUNCE_RISE_WITHIN) / 2;
}

/** A platform its marble rolls along instead of bouncing off */
export interface TRollingHit {
	entityId: string;
	laneId: string;
	hitId: string;
	/** Height the marble reached above the platform in the time a bounce has, in metres */
	rise: number;
	time: number;
	position: TVec2;
}

/**
 * Whether a marble struck `piece` at `note` and failed to leave its surface: a platform is for bouncing. The marble must
 * rise `BOUNCE_RISE_RADII` within `BOUNCE_RISE_WITHIN`, or by its next note when that comes sooner. Null while the run
 * doesn't reach that far, since nothing is known yet.
 */
export function riseAfterHit(piece: TResolvedPiece, marble: TMarbleTrack, note: number, nextNote: number | null): { rise: number; isBounce: boolean } | null {
	const { samples, radius } = marble;
	const until = Math.min(note + BOUNCE_RISE_WITHIN, nextNote ?? Infinity);
	if ((samples.at(-1)?.time ?? -Infinity) < until) return null;
	const shapes = resolvedPieceShapes(piece);
	const needed = BOUNCE_RISE_RADII * radius;
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
		for (const shape of shapes) rise = Math.max(rise, shapeDistance(shape, sample.position.x, sample.position.y) - radius);
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
	const pieces = new Map(result.pieces.map((piece) => [piece.entityId, piece]));
	const entities = new Map(project.entities.map((entity) => [entity.id, entity]));
	const rolls: TRollingHit[] = [];
	for (const lane of project.music.lanes) {
		const marble = result.marbles.find((item) => item.laneId === lane.id);
		if (marble == null) continue;
		const hits = new Map(result.hits.filter((hit) => hit.laneId === lane.id).map((hit) => [hit.hitId, hit]));
		lane.hits.forEach((item, index) => {
			const hit = hits.get(item.id);
			const following = lane.hits[index + 1];
			if (following == null || hit?.pieceEntityId == null || hit.actualTime == null || (hit.status !== 'onTime' && hit.status !== 'drifting')) return;
			const entity = entities.get(hit.pieceEntityId);
			const piece = pieces.get(hit.pieceEntityId);
			const type = entity?.components.piece?.type;
			if (piece == null || type == null || layoutOf(type) !== 'box' || !soundsHit(type, entity?.components.hitLink)) return;
			const risen = riseAfterHit(piece, marble, hit.actualTime, following.time);
			if (risen == null || risen.isBounce) return;
			rolls.push({ entityId: hit.pieceEntityId, laneId: lane.id, hitId: hit.hitId, rise: risen.rise, time: hit.actualTime, position: hit.dot ?? piece.position });
		});
	}
	return rolls.sort((a, b) => a.time - b.time);
}
