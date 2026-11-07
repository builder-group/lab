import { pieceKind, pieceOutline } from './track-geometry';
import { isPointInPolygon } from './picking';
import type { TVec2 } from '@/modules/project';
import type { TResolvedPiece, TSimulationResult } from '@/modules/simulation';

// What stands on the wall around Decor: every marble's swept path and the pieces it hits, as points in a grid.

/** A rectangle on the wall, as Decor and Blender's bounds are checked */
export interface TWallBox {
	x: number;
	y: number;
	halfX: number;
	halfY: number;
	angle: number;
}

/** Spacing of a run's points in meters; checks pad by half of it, so what lies between two points stays covered */
const POINT_SPACING = 0.003;
const PIECE_SPACING = 0.005;
const CELL = 0.04;

export interface TObstacleField {
	x: number[];
	y: number[];
	/** Radius of the obstacle at the point: a marble's at a run's point, 0 at a piece's */
	radius: number[];
	/** Run time at the point, NaN at a piece's */
	time: number[];
	/** Index into `marbleIds`, -1 at a piece's */
	marble: number[];
	marbleIds: string[];
	cells: Map<number, number[]>;
}

/** Every marble's run over the film and the pieces in it. Runs are the marbles' centers at their samples, joined up. */
export function buildObstacleField(result: TSimulationResult): TObstacleField {
	const field: TObstacleField = { x: [], y: [], radius: [], time: [], marble: [], marbleIds: [], cells: new Map() };
	result.marbles.forEach((marble, marbleIndex) => {
		field.marbleIds.push(marble.marbleId);
		let last: { x: number; y: number; time: number } | null = null;
		for (const sample of marble.samples) {
			if (sample.time > result.duration + 1e-6) break;
			const { x, y } = sample.position;
			if (last == null) addPoint(field, x, y, marble.radius, sample.time, marbleIndex);
			else {
				const gap = Math.hypot(x - last.x, y - last.y);
				if (gap < POINT_SPACING) continue;
				const steps = Math.ceil(gap / POINT_SPACING);
				for (let step = 1; step <= steps; step++) {
					const t = step / steps;
					addPoint(field, last.x + (x - last.x) * t, last.y + (y - last.y) * t, marble.radius, last.time + (sample.time - last.time) * t, marbleIndex);
				}
			}
			last = { x, y, time: sample.time };
		}
	});
	for (const piece of result.pieces) {
		if (piece.status !== 'blocked' && piece.status !== 'unreached') addPiece(field, piece);
	}
	return field;
}

function addPiece(field: TObstacleField, piece: TResolvedPiece): void {
	const outline = pieceOutline(piece);
	if (!outline.length) return;
	// A windmill's blades sweep a disc around its hub
	const blades = pieceKind(piece) === 'rotor' ? (piece.params['bladeLength'] ?? 0) : 0;
	if (blades > 0) {
		fillDisc(field, piece.position, blades);
		return;
	}
	const xs = outline.map((corner) => corner.x);
	const ys = outline.map((corner) => corner.y);
	const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
	for (let index = 0; index < outline.length; index++) {
		const a = outline[index] as TVec2;
		const b = outline[(index + 1) % outline.length] as TVec2;
		const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / PIECE_SPACING));
		for (let step = 0; step < steps; step++) addPoint(field, a.x + ((b.x - a.x) * step) / steps, a.y + ((b.y - a.y) * step) / steps, 0, Number.NaN, -1);
	}
	for (let x = minX; x <= maxX; x += PIECE_SPACING * 2) {
		for (let y = minY; y <= maxY; y += PIECE_SPACING * 2) {
			if (isPointInPolygon({ x, y }, outline)) addPoint(field, x, y, 0, Number.NaN, -1);
		}
	}
}

function fillDisc(field: TObstacleField, center: TVec2, radius: number): void {
	for (let x = -radius; x <= radius; x += PIECE_SPACING * 2) {
		for (let y = -radius; y <= radius; y += PIECE_SPACING * 2) {
			if (Math.hypot(x, y) <= radius) addPoint(field, center.x + x, center.y + y, PIECE_SPACING, Number.NaN, -1);
		}
	}
}

function cellKey(ix: number, iy: number): number {
	return (ix + 0x8000) * 0x10000 + (iy + 0x8000);
}

function addPoint(field: TObstacleField, x: number, y: number, radius: number, time: number, marble: number): void {
	const index = field.x.length;
	field.x.push(x);
	field.y.push(y);
	field.radius.push(radius);
	field.time.push(time);
	field.marble.push(marble);
	const key = cellKey(Math.floor(x / CELL), Math.floor(y / CELL));
	const cell = field.cells.get(key);
	if (cell != null) cell.push(index);
	else field.cells.set(key, [index]);
}

/** Calls `visit` for every point in a square around (x, y) */
function eachNear(field: TObstacleField, x: number, y: number, reach: number, visit: (index: number) => void): void {
	const [fromX, toX] = [Math.floor((x - reach) / CELL), Math.floor((x + reach) / CELL)];
	const [fromY, toY] = [Math.floor((y - reach) / CELL), Math.floor((y + reach) / CELL)];
	for (let ix = fromX; ix <= toX; ix++) {
		for (let iy = fromY; iy <= toY; iy++) {
			const cell = field.cells.get(cellKey(ix, iy));
			if (cell != null) for (const index of cell) visit(index);
		}
	}
}

/** Distance from a wall point to a box, 0 inside it */
export function distanceToBox(box: TWallBox, x: number, y: number): number {
	const [dx, dy] = [x - box.x, y - box.y];
	const [cos, sin] = [Math.cos(box.angle), Math.sin(box.angle)];
	const localX = Math.abs(dx * cos + dy * sin) - box.halfX;
	const localY = Math.abs(-dx * sin + dy * cos) - box.halfY;
	return Math.hypot(Math.max(localX, 0), Math.max(localY, 0));
}

function boxReach(box: TWallBox): number {
	return Math.hypot(box.halfX, box.halfY);
}

/** Whether every obstacle stays at least `margin` from the box, its own radius not counted in the margin */
export function isBoxClear(field: TObstacleField, box: TWallBox, margin: number): boolean {
	const pad = margin + POINT_SPACING;
	let isClear = true;
	eachNear(field, box.x, box.y, boxReach(box) + pad + 0.02, (index) => {
		if (isClear && distanceToBox(box, field.x[index] as number, field.y[index] as number) - (field.radius[index] as number) < pad) isClear = false;
	});
	return isClear;
}

/** Each marble whose path crosses the box while `span` shows it, with the first time it does, in time order */
export function pathOverlaps(field: TObstacleField, box: TWallBox, span: { start: number; end: number }): { marbleId: string; time: number; point: TVec2 }[] {
	const first = new Map<number, { time: number; point: TVec2 }>();
	eachNear(field, box.x, box.y, boxReach(box) + 0.02, (index) => {
		const marble = field.marble[index] as number;
		const time = field.time[index] as number;
		if (marble < 0 || time < span.start || time > span.end) return;
		const [x, y] = [field.x[index] as number, field.y[index] as number];
		if (distanceToBox(box, x, y) > (field.radius[index] as number)) return;
		const known = first.get(marble);
		if (known == null || time < known.time) first.set(marble, { time, point: { x, y } });
	});
	return [...first].map(([marble, hit]) => ({ marbleId: field.marbleIds[marble] as string, ...hit })).sort((a, b) => a.time - b.time);
}

/** The run point nearest (x, y) within `reach`, with its distance and time; pieces don't count */
export function nearestRunPoint(field: TObstacleField, x: number, y: number, reach: number): { distance: number; time: number } | null {
	let best: { distance: number; time: number } | null = null;
	eachNear(field, x, y, reach, (index) => {
		if ((field.marble[index] as number) < 0) return;
		const distance = Math.hypot((field.x[index] as number) - x, (field.y[index] as number) - y);
		if (distance <= reach && (best == null || distance < best.distance)) best = { distance, time: field.time[index] as number };
	});
	return best;
}

/** Fields per run, keyed by its marble motion so a copy of a result with another revision shares one */
const fields = new WeakMap<TSimulationResult['marbles'], TObstacleField>();

export function cachedObstacleField(result: TSimulationResult): TObstacleField {
	let field = fields.get(result.marbles);
	if (field == null) {
		field = buildObstacleField(result);
		fields.set(result.marbles, field);
	}
	return field;
}
