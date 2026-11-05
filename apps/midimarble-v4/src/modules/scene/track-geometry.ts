import type { TProject, TVec2 } from '@/modules/project';
import { frameBand, layoutOf, PHYSICS_HZ, projectOnPath, smoothPath, type THitResult, type TMarbleTrack, type TRailLayout, type TResolvedPiece, type TSimulationResult } from '@/modules/simulation';
import { toHitKey } from '@/modules/project';
import { fitBounds, isBoundsVisible, type TBounds, type TPadding, type TView, type TViewport } from './view';

// Pure derivations from a project and its simulation result that the canvas draws and picks against

/** Marble center at `time`, interpolated between samples. Before release it waits at its release point. */
/** The marbles the eye in Layers hides: their trajectories and dots go with them */
export function hiddenMarbleIds(project: TProject, hidden: readonly string[]): Set<string> {
	return new Set(project.marbles.flatMap((marble) => (hidden.includes(marble.id) ? [marble.id] : [])));
}

export function marblePositionAt(track: TMarbleTrack | undefined, time: number, release: TVec2): TVec2 {
	const samples = track?.samples ?? [];
	const first = samples[0];
	if (first == null || time <= first.time) return release;
	const exact = (time - first.time) * PHYSICS_HZ;
	const index = Math.floor(exact);
	const last = samples[samples.length - 1];
	if (index >= samples.length - 1) return last?.position ?? release;
	const a = samples[index];
	const b = samples[index + 1];
	if (a == null || b == null) return release;
	const t = exact - index;
	return { x: a.position.x + (b.position.x - a.position.x) * t, y: a.position.y + (b.position.y - a.position.y) * t };
}

/** Flat x, y pairs and times of a track, for the trajectory line buffers */
export function trackBuffers(track: TMarbleTrack): { points: Float32Array; times: Float32Array } {
	const points = new Float32Array(track.samples.length * 2);
	const times = new Float32Array(track.samples.length);
	track.samples.forEach((sample, index) => {
		points[index * 2] = sample.position.x;
		points[index * 2 + 1] = sample.position.y;
		times[index] = sample.time;
	});
	return { points, times };
}

/** Corners of a platform's box on the wall, in order around the box */
export function pieceCorners(piece: TResolvedPiece): TVec2[] {
	const halfLength = (piece.params['length'] ?? 0.06) / 2;
	const halfThickness = (piece.params['thickness'] ?? 0.008) / 2;
	const cos = Math.cos(piece.angle);
	const sin = Math.sin(piece.angle);
	return [
		[-halfLength, -halfThickness],
		[halfLength, -halfThickness],
		[halfLength, halfThickness],
		[-halfLength, halfThickness]
	].map(([x = 0, y = 0]) => ({ x: piece.position.x + x * cos - y * sin, y: piece.position.y + x * sin + y * cos }));
}

export type TPieceKind = 'box' | 'path' | 'tube' | 'rotor' | 'generated' | 'catcher';

export function pieceKind(piece: { type: string; layout?: TRailLayout | undefined; paths?: TVec2[][] }): TPieceKind {
	// A drawn Rail with further paths draws and picks like generated ones, and only its first path has handles
	if (piece.type === 'rail' && (piece.paths?.length ?? 0) > 1) return 'generated';
	return layoutOf(piece.type, piece.layout);
}

/**
 * Closed outline of a piece on the wall for picking, selection and framing: the box of a platform, a
 * band around a rail, the tube of a tunnel and the circle the windmill blades sweep
 */
export function pieceOutline(piece: TResolvedPiece): TVec2[] {
	const kind = pieceKind(piece);
	if (kind === 'box') return pieceCorners(piece);
	if (kind === 'generated' || kind === 'catcher') {
		// The rectangle around the walls and legs, or the Bowl's wires
		const points = (piece.paths ?? []).flat();
		if (!points.length) return [piece.position];
		const xs = points.map((point) => point.x);
		const ys = points.map((point) => point.y);
		const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
		return [
			{ x: minX, y: minY },
			{ x: maxX, y: minY },
			{ x: maxX, y: maxY },
			{ x: minX, y: maxY }
		];
	}
	if (kind === 'rotor') {
		const reach = (piece.params['hubRadius'] ?? 0.008) + (piece.params['bladeLength'] ?? 0.06);
		return Array.from({ length: 48 }, (_, index) => {
			const angle = (index / 48) * Math.PI * 2;
			return { x: piece.position.x + Math.cos(angle) * reach, y: piece.position.y + Math.sin(angle) * reach };
		});
	}
	const path = piece.path ?? [];
	if (kind === 'tube') {
		const ceiling = tubeCeiling(piece);
		if (ceiling.length >= 2) return [...path, ...[...ceiling].reverse()];
	}
	const half = (piece.params['radius'] ?? 0.002) + 0.002;
	return [...offsetPolyline(path, half), ...offsetPolyline(path, -half).reverse()];
}

/** Ceiling line of a tunnel, from the capsules after the floor chain */
export function tubeCeiling(piece: TResolvedPiece): TVec2[] {
	const path = piece.path ?? [];
	const capsules = (piece.shapes ?? []).slice(Math.max(0, path.length - 1));
	const points: TVec2[] = [];
	for (const shape of capsules) {
		if (shape.kind !== 'capsule') continue;
		if (!points.length) points.push(shape.a);
		points.push(shape.b);
	}
	return points;
}

/** Polyline moved sideways by `offset` along its left normal, with averaged normals at the joins */
export function offsetPolyline(points: TVec2[], offset: number): TVec2[] {
	return points.map((point, index) => {
		const before = points[index - 1] ?? point;
		const after = points[index + 1] ?? point;
		const dx = after.x - before.x;
		const dy = after.y - before.y;
		const length = Math.hypot(dx, dy) || 1;
		return { x: point.x - (dy / length) * offset, y: point.y + (dx / length) * offset };
	});
}

/** Rotation of a moving piece at `time`, interpolated between motion samples */
export function pieceAngleAt(piece: TResolvedPiece, time: number): number {
	const motion = piece.motion;
	if (motion == null || !motion.length) return piece.angle;
	const first = motion[0];
	const last = motion[motion.length - 1];
	if (first == null || last == null) return piece.angle;
	if (time <= first.time) return first.angle;
	if (time >= last.time) return last.angle;
	let low = 0;
	let high = motion.length - 1;
	while (high - low > 1) {
		const middle = (low + high) >> 1;
		if ((motion[middle]?.time ?? 0) <= time) low = middle;
		else high = middle;
	}
	const a = motion[low] ?? first;
	const b = motion[high] ?? last;
	const t = b.time > a.time ? (time - a.time) / (b.time - a.time) : 0;
	return a.angle + (b.angle - a.angle) * t;
}

/** When a piece first matters on the timeline: its hit, or for rails and tunnels the marble's entry */
export function pieceTime(piece: TResolvedPiece): number | null {
	return piece.entryTime ?? piece.hitTime;
}

/**
 * Rotation pivot and grip of a piece. The pivot is its hit point; the grip sits at the far end of a
 * platform bar or at the tip of the windmill blade that takes the hit.
 */
export function rotationGrip(piece: TResolvedPiece): { pivot: TVec2; grip: TVec2; tangent: TVec2 } {
	const tangent = { x: Math.cos(piece.angle), y: Math.sin(piece.angle) };
	const pivot = piece.contactPoint ?? piece.position;
	if (pieceKind(piece) === 'rotor') {
		const reach = (piece.params['hubRadius'] ?? 0.008) + (piece.params['bladeLength'] ?? 0.06);
		return { pivot, grip: { x: piece.position.x + tangent.x * reach, y: piece.position.y + tangent.y * reach }, tangent };
	}
	const halfLength = (piece.params['length'] ?? 0.06) / 2;
	// Project the pivot onto the bar axis and walk to the +tangent end
	const along = (pivot.x - piece.position.x) * tangent.x + (pivot.y - piece.position.y) * tangent.y;
	const reach = halfLength - along;
	return { pivot, grip: { x: pivot.x + tangent.x * reach, y: pivot.y + tangent.y * reach }, tangent };
}

/** Area worth showing: releases, pieces, reachable hit dots and the frame band */
export function contentBounds(project: TProject, result: TSimulationResult | null): TBounds {
	const points: TVec2[] = project.marbles.map((marble) => marble.start.position);
	for (const piece of result?.pieces ?? []) points.push(...pieceOutline(piece));
	for (const hit of result?.hits ?? []) if (hit.dot != null) points.push(hit.dot);
	const band = frameBand(project);
	let minX = band.centerX - band.halfWidth;
	let maxX = band.centerX + band.halfWidth;
	let minY = Number.POSITIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const point of points) {
		minX = Math.min(minX, point.x);
		maxX = Math.max(maxX, point.x);
		minY = Math.min(minY, point.y);
		maxY = Math.max(maxY, point.y);
	}
	if (!Number.isFinite(minY)) {
		minY = -0.2;
		maxY = 0.2;
	}
	// A run with only a release still shows a frame-shaped area below it
	if (maxY - minY < 0.3) minY = maxY - 0.3;
	return { minX, minY, maxX, maxY };
}

/**
 * Per marble, the last moment Zoom to Fit frames: its last hit with a piece, or the first open hit after it, which
 * is the next step. Open dots after that lie on a free fall that runs for meters (8 tapped hits fall 19 m), so
 * framing them would shrink every dot to a speck.
 */
function workEnds(hits: readonly THitResult[]): Map<string, number> {
	const placed = new Map<string, number>();
	for (const hit of hits) if (hit.pieceId != null) placed.set(hit.marbleId, Math.max(placed.get(hit.marbleId) ?? -Infinity, hit.targetTime));
	const ends = new Map(placed);
	for (const hit of hits) {
		if (hit.pieceId != null || hit.dot == null) continue;
		const after = placed.get(hit.marbleId) ?? -Infinity;
		if (hit.targetTime <= after) continue;
		const end = ends.get(hit.marbleId);
		// The earliest open dot past the last placed hit
		if (end == null || end === after || hit.targetTime < end) ends.set(hit.marbleId, hit.targetTime);
	}
	return ends;
}

/**
 * What Zoom to Fit frames, like Figma's, which fits the layers and not the page. `all` holds the releases, the
 * pieces, the hit dots and each marble's trajectory up to its marble's last hit with a piece and the next open hit
 * after it, but not the fall past that, which can run for meters, nor the rest of the film's length. `pieces`
 * holds the work a fit never cuts off: the pieces and those hit dots, or the releases while there are none. A
 * release high above the first hit is framed when it fits, but never shrinks the pieces and dots to specks.
 */
export function fitTargets(project: TProject, result: TSimulationResult | null): TBounds {
	const releases: TVec2[] = project.marbles.map((marble) => marble.start.position);
	const work: TVec2[] = [];
	for (const piece of result?.pieces ?? []) work.push(...pieceOutline(piece));
	const ends = workEnds(result?.hits ?? []);
	for (const hit of result?.hits ?? []) if (hit.dot != null && hit.targetTime <= (ends.get(hit.marbleId) ?? -Infinity)) work.push(hit.dot);
	const points = [...releases, ...work];
	for (const track of result?.marbles ?? []) {
		const last = ends.get(track.marbleId) ?? -Infinity;
		if (!Number.isFinite(last)) continue;
		for (let i = 0; i < track.samples.length; i += 4) {
			const sample = track.samples[i];
			if (sample == null || sample.time > last) break;
			points.push(sample.position);
		}
	}
	const band = frameBand(project);
	const bounds = boundsOfPoints(points);
	let minY = bounds?.minY ?? -0.2;
	const maxY = bounds?.maxY ?? 0.2;
	// A run with only a release still shows a frame-shaped area below it
	if (maxY - minY < 0.3) minY = maxY - 0.3;
	return { minX: Math.min(band.centerX - band.halfWidth, bounds?.minX ?? 0), maxX: Math.max(band.centerX + band.halfWidth, bounds?.maxX ?? 0), minY, maxY };
}

// Room kept around an open dot so its hint and the build bar under it show too
const FIRST_HITS_MARGIN = 90;
// Room below the dots for the build bar, and above them, on the wall
const FIRST_HITS_BELOW = 0.1;
const FIRST_HITS_ABOVE = 0.05;

/**
 * The view that shows each marble's next open dot after tapping or importing, with the hint and the build bar beside
 * it, or null when the view already does or no dot is open. As wide as the film frame like an opened project, with
 * the releases when they fit at `minScale`.
 */
export function firstHitsView(project: TProject, result: TSimulationResult, view: TView, viewport: TViewport, padding: TPadding, minScale: number): TView | null {
	const next = new Map<string, THitResult>();
	for (const hit of result.hits) {
		if (hit.status !== 'open' || hit.dot == null) continue;
		const known = next.get(hit.marbleId);
		if (known == null || hit.targetTime < known.targetTime) next.set(hit.marbleId, hit);
	}
	const dots = boundsOfPoints([...next.values()].flatMap((hit) => (hit.dot != null ? [hit.dot] : [])));
	if (dots == null || isBoundsVisible(view, viewport, dots, FIRST_HITS_MARGIN)) return null;
	const band = frameBand(project);
	const around = (bounds: TBounds): TBounds => ({
		minX: Math.min(band.centerX - band.halfWidth * 1.35, bounds.minX),
		maxX: Math.max(band.centerX + band.halfWidth * 1.35, bounds.maxX),
		minY: bounds.minY - FIRST_HITS_BELOW,
		maxY: bounds.maxY + FIRST_HITS_ABOVE
	});
	const releases = project.marbles.map((marble) => marble.start.position);
	const all = boundsOfPoints([...releases, { x: dots.minX, y: dots.minY }, { x: dots.maxX, y: dots.maxY }]) ?? dots;
	const withReleases = fitBounds(around(all), viewport, padding);
	return withReleases.scale >= minScale ? withReleases : fitBounds(around(dots), viewport, padding);
}

/**
 * What a step to the hit at `time` brings into view: the hit dots struck then and their pieces, as hit keys and
 * piece ids, so a chord of several marbles shows every marble that strikes it
 */
export function struckAt(hits: readonly THitResult[], time: number): string[] {
	return hits
		.filter((hit) => hit.dot != null && Math.abs(hit.targetTime - time) < 1e-3)
		.flatMap((hit) => [toHitKey(hit.marbleId, hit.hitId), ...(hit.pieceId != null ? [hit.pieceId] : [])]);
}

/** Time of the trajectory sample closest to `point`, or null for an empty trajectory */
export function nearestMoment(samples: { time: number; position: TVec2 }[], point: TVec2): number | null {
	let best: number | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const sample of samples) {
		const distance = Math.hypot(sample.position.x - point.x, sample.position.y - point.y);
		if (distance < bestDistance) {
			best = sample.time;
			bestDistance = distance;
		}
	}
	return best;
}

function boundsOfPoints(points: TVec2[]): TBounds | null {
	if (!points.length) return null;
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const point of points) {
		minX = Math.min(minX, point.x);
		minY = Math.min(minY, point.y);
		maxX = Math.max(maxX, point.x);
		maxY = Math.max(maxY, point.y);
	}
	return { minX, minY, maxX, maxY };
}

export function boundsOfPieces(pieces: TResolvedPiece[]): TBounds | null {
	const corners = pieces.flatMap(pieceOutline);
	if (!corners.length) return null;
	return {
		minX: Math.min(...corners.map((point) => point.x)),
		minY: Math.min(...corners.map((point) => point.y)),
		maxX: Math.max(...corners.map((point) => point.x)),
		maxY: Math.max(...corners.map((point) => point.y))
	};
}

// MARK: - Rails and tunnels

/**
 * Editable shape of a rail or tunnel. The control points are local: the entry sits at the origin, the
 * catch section lies behind it and the run ends at the last point. A bend point between entry and end
 * curves the run.
 */
export interface TPathShape {
	controls: TVec2[];
	/** Index of the control at the local origin */
	origin: number;
	/** Index of the bend control, if the run has one */
	bend: number | null;
}

export function pathShape(controls: TVec2[]): TPathShape {
	let origin = controls.findIndex((point) => Math.hypot(point.x, point.y) < 1e-6);
	if (origin < 0) origin = controls.length > 2 ? 1 : 0;
	const bend = controls.length - 1 - origin >= 2 ? origin + 1 : null;
	return { controls, origin, bend };
}

/** World position of a local control point, as the layout places it */
export function pathToWorld(piece: TResolvedPiece, controls: TVec2[], point: TVec2): TVec2 {
	const anchor = pathAnchor(controls);
	const cos = Math.cos(piece.angle);
	const sin = Math.sin(piece.angle);
	const x = point.x - anchor.x;
	const y = point.y - anchor.y;
	return { x: piece.position.x + x * cos - y * sin, y: piece.position.y + x * sin + y * cos };
}

/** Local control coordinates of a world point, the inverse of `pathToWorld` */
export function pathToLocal(piece: TResolvedPiece, controls: TVec2[], point: TVec2): TVec2 {
	const anchor = pathAnchor(controls);
	const cos = Math.cos(piece.angle);
	const sin = Math.sin(piece.angle);
	const x = point.x - piece.position.x;
	const y = point.y - piece.position.y;
	return { x: anchor.x + x * cos + y * sin, y: anchor.y - x * sin + y * cos };
}

function pathAnchor(controls: TVec2[]): TVec2 {
	return projectOnPath(smoothPath(controls), 0, 0).point;
}

/** Handles of a selected rail or tunnel: the end of the run and its bend, in local coordinates */
export function pathHandles(controls: TVec2[]): { end: TVec2; bend: TVec2 } | null {
	const shape = pathShape(controls);
	const end = controls[controls.length - 1];
	const start = controls[shape.origin];
	if (end == null || start == null || controls.length - 1 === shape.origin) return null;
	const bend = shape.bend != null ? controls[shape.bend] : undefined;
	return { end, bend: bend ?? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } };
}

/** Moves the end of the run; the bend keeps its place relative to the run */
export function withPathEnd(controls: TVec2[], end: TVec2): TVec2[] {
	const shape = pathShape(controls);
	const next = controls.map((point) => ({ ...point }));
	const previousEnd = controls[controls.length - 1];
	if (shape.bend != null && previousEnd != null) {
		const bend = controls[shape.bend] as TVec2;
		// Express the bend in run coordinates, then rebuild it on the new run
		const run = { x: previousEnd.x, y: previousEnd.y };
		const runLength = Math.hypot(run.x, run.y) || 1;
		const along = (bend.x * run.x + bend.y * run.y) / (runLength * runLength);
		const side = (bend.y * run.x - bend.x * run.y) / (runLength * runLength);
		next[shape.bend] = { x: end.x * along - end.y * side, y: end.y * along + end.x * side };
	}
	next[next.length - 1] = { ...end };
	return next;
}

/** Moves the bend of the run, adding a bend control when the run is straight */
export function withPathBend(controls: TVec2[], bend: TVec2): TVec2[] {
	const shape = pathShape(controls);
	const next = controls.map((point) => ({ ...point }));
	if (shape.bend != null) next[shape.bend] = { ...bend };
	else next.splice(shape.origin + 1, 0, { ...bend });
	return next;
}

/** Straight-line length and local slope of the run from the entry to its end */
export function pathRun(controls: TVec2[]): { length: number; slope: number } {
	const end = controls[controls.length - 1] ?? { x: 0, y: 0 };
	return { length: Math.hypot(end.x, end.y), slope: Math.atan2(end.y, Math.abs(end.x)) };
}

/** Scales and turns the run around the entry so it reaches `length` at local `slope` */
export function withPathRun(controls: TVec2[], length: number, slope: number): TVec2[] {
	const shape = pathShape(controls);
	const end = controls[controls.length - 1] ?? { x: 1, y: 0 };
	const current = pathRun(controls);
	const direction = end.x < 0 ? -1 : 1;
	const scale = current.length > 1e-9 ? length / current.length : 1;
	const turn = (slope - current.slope) * direction;
	const cos = Math.cos(turn);
	const sin = Math.sin(turn);
	return controls.map((point, index) => {
		if (index <= shape.origin) return { ...point };
		const x = point.x * scale;
		const y = point.y * scale;
		return { x: x * cos - y * sin, y: x * sin + y * cos };
	});
}

/** Turns the run after the entry by `turn` radians around the entry */
export function turnPathRun(controls: TVec2[], turn: number): TVec2[] {
	const shape = pathShape(controls);
	const cos = Math.cos(turn);
	const sin = Math.sin(turn);
	return controls.map((point, index) => (index <= shape.origin ? { ...point } : { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos }));
}

/** Downhill slope of the run on the wall in radians, positive when the end is lower than the entry */
export function worldRunSlope(piece: TResolvedPiece, controls: TVec2[]): { slope: number; direction: number } {
	const entry = pathToWorld(piece, controls, { x: 0, y: 0 });
	const end = pathToWorld(piece, controls, controls[controls.length - 1] ?? { x: 0, y: 0 });
	return { slope: Math.atan2(entry.y - end.y, Math.abs(end.x - entry.x)), direction: end.x >= entry.x ? 1 : -1 };
}

export interface TPathRide {
	/** When the marble first touches the piece */
	enter: number | null;
	/** When it leaves again, null when it is still on the piece at `until` */
	leave: number | null;
}

/** When the marble's marble rides on a rail or tunnel floor, from the result's samples */
export function pathRide(result: TSimulationResult, piece: TResolvedPiece, marbleId: string, until: number): TPathRide {
	const marble = result.marbles.find((track) => track.marbleId === marbleId);
	const paths = piece.paths ?? (piece.path != null ? [piece.path] : []);
	const from = (pieceTime(piece) ?? 0) - 2 / PHYSICS_HZ;
	if (marble == null || !paths.some((path) => path.length >= 2)) return { enter: null, leave: null };
	const reach = marble.radius + (piece.params['radius'] ?? 0.002) + 0.002;
	let enter: number | null = null;
	let leave: number | null = null;
	for (const sample of marble.samples) {
		if (sample.time < from) continue;
		if (sample.time > until) break;
		const isNear = paths.some((path) => projectOnPath(path, sample.position.x, sample.position.y).distance <= reach);
		if (isNear) {
			enter ??= sample.time;
			leave = null;
		} else if (enter != null && leave == null) leave = sample.time;
	}
	return { enter, leave };
}
