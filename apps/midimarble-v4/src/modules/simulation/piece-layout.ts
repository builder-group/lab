import type { TVec2 } from '@/modules/project';
import { GRAVITY_Y, placeBoxAtContact, placeBoxAtMarble, surfaceNormal, type TBox2 } from './geometry';
import { getPieceDefinition, type TRailLayout } from './pieces';
import { projectOnPath, smoothPath, transformShape, type TPieceShape } from './shapes';
import type { TPieceLayoutKind } from './types';

// World layout of every piece type. Linked pieces are placed by construction: their contact surface
// touches the marble at the placement time, offset by the marble radius along the surface normal.

export interface TPieceLayout {
	/** Pose origin: box center for platforms, support anchor for rails and tunnels, hub for windmills */
	position: TVec2;
	angle: number;
	contactPoint: TVec2 | null;
	contactNormal: TVec2 | null;
	/** Collider primitives in world coordinates */
	shapes: TPieceShape[];
	/** Platform box, kept so platforms build exactly as before */
	box: TBox2 | null;
	/** Smoothed support line of rails and tunnels in world coordinates */
	path: TVec2[] | null;
	rotor: TRotorLayout | null;
	/** Every path of a Rail that holds several, in world coordinates */
	paths?: TVec2[][];
}

export interface TRotorLayout {
	hub: TVec2;
	angle: number;
	/** Collider primitives relative to the hub at angle 0 */
	localShapes: TPieceShape[];
	damping: number;
	motorSpeed: number;
}

export interface TLayoutInput {
	type: string;
	params: Record<string, number>;
	/** Local control points of rails and tunnels */
	path: TVec2[];
	/** A drawn Rail's further paths, in the same local coordinates */
	extraPaths?: TVec2[][];
	/** How a Rail gets its paths */
	layout?: TRailLayout;
	angle: number;
	contactAt: number;
	marbleRadius: number;
}

/** Places the piece so its contact surface touches a marble centered at `position` */
export function layoutAtMarble(
	input: TLayoutInput,
	position: TVec2,
	velocity: TVec2 | null
): TPieceLayout {
	const kind = layoutOf(input.type, input.layout);
	if (kind === 'generated') return generatedLayout(input, position, velocity);
	if (kind === 'catcher') return catcherLayout(input, position);
	if (kind === 'box') {
		const { length, thickness } = boxSize(input.params);
		const placement = placeBoxAtMarble(
			position,
			velocity,
			input.marbleRadius,
			input.angle,
			input.contactAt,
			length,
			thickness
		);
		return boxLayout(placement.box, placement.contactPoint, placement.contactNormal);
	}
	let normal = baseNormal(input);
	if (velocity != null && normal.x * velocity.x + normal.y * velocity.y > 0) {
		normal = { x: -normal.x, y: -normal.y };
	}
	const contactPoint = {
		x: position.x - normal.x * input.marbleRadius,
		y: position.y - normal.y * input.marbleRadius
	};
	return layoutAtContact(input, contactPoint, normal);
}

/**
 * Places the piece so its contact surface holds `contactPoint` with `normal` facing the marble. Without a
 * normal the surface keeps its unflipped normal.
 */
export function layoutAtContact(
	input: TLayoutInput,
	contactPoint: TVec2,
	normal: TVec2 | null = null
): TPieceLayout {
	const kind = layoutOf(input.type, input.layout);
	// Generated paths have no contact surface; the point is where the marble enters them
	if (kind === 'generated') return generatedLayout(input, contactPoint, null);
	// Nor has a Bowl: the point is its mouth
	if (kind === 'catcher') return catcherLayout(input, contactPoint);
	const n = normal ?? baseNormal(input);
	if (kind === 'box') {
		const { length, thickness } = boxSize(input.params);
		const placement = placeBoxAtContact(
			contactPoint,
			n,
			input.angle,
			input.contactAt,
			length,
			thickness
		);
		return boxLayout(placement.box, placement.contactPoint, placement.contactNormal);
	}
	if (kind === 'rotor') {
		const { bladeLength, bladeThickness, hubRadius } = rotorSize(input.params);
		const d = { x: Math.cos(input.angle), y: Math.sin(input.angle) };
		const reach = hubRadius + input.contactAt * bladeLength;
		const hub = {
			x: contactPoint.x - (n.x * bladeThickness) / 2 - d.x * reach,
			y: contactPoint.y - (n.y * bladeThickness) / 2 - d.y * reach
		};
		return rotorLayout(input, hub, contactPoint, n);
	}
	const radius = input.params['radius'] ?? 0.002;
	const local = localPath(input.path);
	const base = baseNormal(input);
	// The side the marble rides on, in local terms: +1 above the left normal of the path
	const side = n.x * base.x + n.y * base.y >= 0 ? 1 : -1;
	const origin = { x: contactPoint.x - n.x * radius, y: contactPoint.y - n.y * radius };
	return pathLayout(input, local, origin, side, contactPoint, n);
}

/** Places an unlinked piece from its transform */
export function layoutFree(input: TLayoutInput, position: TVec2): TPieceLayout {
	const kind = layoutOf(input.type, input.layout);
	if (kind === 'generated') return generatedLayout(input, position, null);
	if (kind === 'catcher') return catcherLayout(input, position);
	if (kind === 'box') {
		const { length, thickness } = boxSize(input.params);
		const box = {
			cx: position.x,
			cy: position.y,
			angle: input.angle,
			halfLength: length / 2,
			halfThickness: thickness / 2
		};
		return boxLayout(box, null, null);
	}
	if (kind === 'rotor') return rotorLayout(input, position, null, null);
	// The transform places the local origin, so the anchor shift is undone
	const local = localPath(input.path);
	const cos = Math.cos(input.angle);
	const sin = Math.sin(input.angle);
	const origin = {
		x: position.x + local.anchor.x * cos - local.anchor.y * sin,
		y: position.y + local.anchor.x * sin + local.anchor.y * cos
	};
	return pathLayout(input, local, origin, 1, null, null);
}

/** How a piece is built; a Rail's layout decides whether its paths are held or generated */
export function layoutOf(type: string, railLayout?: TRailLayout): TPieceLayoutKind {
	const kind = getPieceDefinition(type)?.layout ?? 'box';
	return kind === 'path' && railLayout != null && railLayout !== 'path' ? 'generated' : kind;
}

/** Piece types a drawn path can be: the path tool draws a Rail and the inspector switches it to a Tunnel */
export type TPathPieceType = 'rail' | 'tunnel';

export function isPathPieceType(type: string | undefined): type is TPathPieceType {
	const kind = layoutOf(type ?? '');
	return kind === 'path' || kind === 'tube';
}

// Platforms

function boxSize(params: Record<string, number>): { length: number; thickness: number } {
	return { length: params['length'] ?? 0.06, thickness: params['thickness'] ?? 0.008 };
}

function boxLayout(
	box: TBox2,
	contactPoint: TVec2 | null,
	contactNormal: TVec2 | null
): TPieceLayout {
	return {
		position: { x: box.cx, y: box.cy },
		angle: box.angle,
		contactPoint,
		contactNormal,
		shapes: [{ kind: 'box', box }],
		box,
		path: null,
		rotor: null
	};
}

/** Surface normal before flipping toward the marble */
function baseNormal(input: TLayoutInput): TVec2 {
	const kind = layoutOf(input.type);
	if (kind === 'box' || kind === 'rotor') return surfaceNormal(input.angle);
	const { tangent } = localPath(input.path);
	return surfaceNormal(input.angle + Math.atan2(tangent.y, tangent.x));
}

// Rails and tunnels

interface TLocalPath {
	points: TVec2[];
	/** Point of the smoothed path closest to the local origin, where the marble touches */
	anchor: TVec2;
	anchorAlong: number;
	tangent: TVec2;
}

const localPathCache = new WeakMap<TVec2[], TLocalPath>();

function localPath(controls: TVec2[]): TLocalPath {
	const cached = localPathCache.get(controls);
	if (cached != null) return cached;
	const points = smoothPath(controls);
	const projected = projectOnPath(points, 0, 0);
	const local = {
		points,
		anchor: projected.point,
		anchorAlong: projected.along,
		tangent: projected.tangent
	};
	localPathCache.set(controls, local);
	return local;
}

function pathLayout(
	input: TLayoutInput,
	local: TLocalPath,
	origin: TVec2,
	side: number,
	contactPoint: TVec2 | null,
	contactNormal: TVec2 | null
): TPieceLayout {
	const radius = input.params['radius'] ?? 0.002;
	const cos = Math.cos(input.angle);
	const sin = Math.sin(input.angle);
	const toWorld = (p: TVec2): TVec2 => {
		const x = p.x - local.anchor.x;
		const y = p.y - local.anchor.y;
		return { x: origin.x + x * cos - y * sin, y: origin.y + x * sin + y * cos };
	};
	const path = local.points.map(toWorld);
	const shapes: TPieceShape[] = capsuleChain(path, radius);
	if (layoutOf(input.type) === 'tube') {
		const bore = input.params['bore'] ?? 0.004;
		const mouth = input.params['mouth'] ?? 0.03;
		const offset = 2 * input.marbleRadius + bore + 2 * radius;
		const ceiling = offsetPath(local.points, local.anchorAlong + mouth, offset * side);
		shapes.push(...capsuleChain(ceiling.map(toWorld), radius));
	}
	const extra = (input.extraPaths ?? []).map((points) => smoothPath(points).map(toWorld));
	for (const line of extra) shapes.push(...capsuleChain(line, radius));
	return {
		position: origin,
		angle: input.angle,
		contactPoint,
		contactNormal,
		shapes,
		box: null,
		path,
		rotor: null,
		...(extra.length > 0 ? { paths: [path, ...extra] } : {})
	};
}

function capsuleChain(points: TVec2[], radius: number): TPieceShape[] {
	const shapes: TPieceShape[] = [];
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1] as TVec2;
		const b = points[i] as TVec2;
		shapes.push({ kind: 'capsule', a, b, radius });
	}
	if (points.length === 1 && points[0] != null)
		shapes.push({ kind: 'capsule', a: points[0], b: points[0], radius });
	return shapes;
}

/** The part of the path after arc length `from`, moved by `offset` along its left normal */
function offsetPath(points: TVec2[], from: number, offset: number): TVec2[] {
	const result: TVec2[] = [];
	let along = 0;
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1] as TVec2;
		const b = points[i] as TVec2;
		const length = Math.hypot(b.x - a.x, b.y - a.y);
		if (length <= 0) continue;
		const nx = -(b.y - a.y) / length;
		const ny = (b.x - a.x) / length;
		const startT = Math.max(0, (from - along) / length);
		along += length;
		if (startT >= 1) continue;
		// Vertex normals average the two adjacent segments so the walls stay parallel through bends
		const start = { x: a.x + (b.x - a.x) * startT, y: a.y + (b.y - a.y) * startT };
		if (!result.length) result.push({ x: start.x + nx * offset, y: start.y + ny * offset });
		const next = points[i + 1];
		let vx = nx;
		let vy = ny;
		if (next != null) {
			const nextLength = Math.hypot(next.x - b.x, next.y - b.y);
			if (nextLength > 0) {
				const mx = nx - (next.y - b.y) / nextLength;
				const my = ny + (next.x - b.x) / nextLength;
				const m = Math.hypot(mx, my);
				// Keep the wall distance through the bend: scale by 1 / cos(half the bend angle)
				const scale = m > 1e-9 ? 2 / (m * m) : 1;
				vx = mx * scale;
				vy = my * scale;
			}
		}
		result.push({ x: b.x + vx * offset, y: b.y + vy * offset });
	}
	return result;
}

// Windmills

function rotorSize(params: Record<string, number>): {
	bladeCount: number;
	bladeLength: number;
	bladeThickness: number;
	hubRadius: number;
} {
	return {
		bladeCount: Math.max(2, Math.round(params['bladeCount'] ?? 4)),
		bladeLength: params['bladeLength'] ?? 0.06,
		bladeThickness: params['bladeThickness'] ?? 0.006,
		hubRadius: params['hubRadius'] ?? 0.008
	};
}

/** Hub and blades relative to the hub, with blade 0 along +x */
export function rotorLocalShapes(params: Record<string, number>): TPieceShape[] {
	const { bladeCount, bladeLength, bladeThickness, hubRadius } = rotorSize(params);
	const shapes: TPieceShape[] = [{ kind: 'ball', center: { x: 0, y: 0 }, radius: hubRadius }];
	for (let k = 0; k < bladeCount; k++) {
		const angle = (2 * Math.PI * k) / bladeCount;
		const reach = hubRadius + bladeLength / 2;
		shapes.push({
			kind: 'box',
			box: {
				cx: Math.cos(angle) * reach,
				cy: Math.sin(angle) * reach,
				angle,
				halfLength: bladeLength / 2,
				halfThickness: bladeThickness / 2
			}
		});
	}
	return shapes;
}

function rotorLayout(
	input: TLayoutInput,
	hub: TVec2,
	contactPoint: TVec2 | null,
	contactNormal: TVec2 | null
): TPieceLayout {
	const localShapes = rotorLocalShapes(input.params);
	return {
		position: hub,
		angle: input.angle,
		contactPoint,
		contactNormal,
		shapes: localShapes.map((shape) => transformShape(shape, hub, input.angle)),
		box: null,
		path: null,
		rotor: {
			hub,
			angle: input.angle,
			localShapes,
			damping: input.params['damping'] ?? 0.5,
			motorSpeed: input.params['motorSpeed'] ?? 0
		}
	};
}

// Generated rail paths

const DEGREE = Math.PI / 180;
const MIN_LEG_SLOPE = 2 * DEGREE;
const MAX_LEG_SLOPE = 25 * DEGREE;
// Space between the marble at its entry and the top of a generated rail
const ENTRY_CLEARANCE = 0.003;
// How far the walls rise above the first leg's high end
const WALL_RISE = 0.03;
// Points per bend; a bend of radius 3 cm then turns about 7° between segments
const BEND_POINTS = 12;
const CURVE_POINTS = 20;

export interface TSwitchbackGeometry {
	/**
	 * One bent wire per leg, top leg first: a wall that comes down on the leg's high side, turns through a
	 * rounded bend of radius `bend` and runs down the leg to its open low end. Then a short stop on the last
	 * leg's open side, which turns the marble down out of the switchback.
	 */
	wires: TVec2[][];
	/** Straight wall segments of the wires, top to bottom, the vertical part above each bend and the stop */
	walls: [TVec2, TVec2][];
	/** Leg segments from high end to low end, top leg first, before the bends round their high ends */
	legs: [TVec2, TVec2][];
	/** Middle of the last leg's opening, where the marble leaves, at the low end's height */
	exit: TVec2;
	/** Lowest point of the wires */
	bottom: number;
	/** Leg slope after limits */
	slope: number;
}

/**
 * Wires of a switchback whose entry point is `entry`. `angle` and `contactAt` come from the hit link and
 * `velocity`, the marble's at the entry, picks the wall that gets the catch lip.
 */
export function switchbackGeometry(
	params: Record<string, number>,
	angle: number,
	contactAt: number,
	entry: TVec2,
	marbleRadius: number,
	velocity: TVec2 | null
): TSwitchbackGeometry {
	const width = params['width'] ?? 0.1;
	const legCount = Math.max(1, Math.round(params['turns'] ?? 3));
	const drop = params['drop'] ?? 0.035;
	const opening = params['opening'] ?? 0.032;
	const lip = params['lip'] ?? 0.04;
	const radius = params['radius'] ?? 0.0025;
	const slope = Math.min(MAX_LEG_SLOPE, Math.max(MIN_LEG_SLOPE, Math.abs(angle)));
	// Like a rail, a negative angle runs the first leg downhill toward +x
	const direction = angle > 0 ? -1 : 1;
	const clear = marbleRadius + radius + ENTRY_CLEARANCE;
	// u runs across the switchback from the first leg's high end (0) toward its low end (width)
	const entryU = Math.min(width - clear, Math.max(clear, contactAt * width));
	const toWorld = (u: number, y: number): TVec2 => ({
		x: entry.x + direction * (u - entryU),
		y
	});
	const rim = entry.y - clear;
	const moving = velocity != null && Math.abs(velocity.x) > 0.05 ? Math.sign(velocity.x * direction) : 0;
	const rise = Math.tan(slope) * (width - opening);
	const legs: [TVec2, TVec2][] = [];
	let high = rim - WALL_RISE;
	let lastLow = high;
	for (let k = 0; k < legCount; k++) {
		const isEven = k % 2 === 0;
		const low = high - rise;
		legs.push([toWorld(isEven ? 0 : width, high), toWorld(isEven ? width - opening : opening, low)]);
		lastLow = low;
		if (k < legCount - 1) high = low - drop;
	}
	const isLastEven = (legCount - 1) % 2 === 0;
	// The marble leaving a leg's low end meets the next leg's wall; it rises this far above that end
	const catchHeight = 2 * marbleRadius + 2 * radius + 0.005;
	const bend = Math.max(0, params['bend'] ?? 0);
	const wires: TVec2[][] = [];
	const walls: [TVec2, TVec2][] = [];
	legs.forEach(([, low], k) => {
		const isEven = k % 2 === 0;
		const wallU = isEven ? 0 : width;
		const along = isEven ? 1 : -1;
		const highY = legHigh(k);
		const lowU = isEven ? width - opening : opening;
		// The top wall catches the entry, with the lip on the side the marble moves toward; lower walls
		// catch the marble falling off the leg above
		// catch the marble falling off the leg above. The second wall stays at the rim on the side the marble came
		// from, where its earlier path runs
		const top =
			k === 0
				? rim + (moving < 0 ? lip : 0)
				: k === 1
					? moving > 0
						? Math.max(rim + lip, legLow(0) + catchHeight)
						: Math.min(rim, legLow(0) + catchHeight)
					: legLow(k - 1) + catchHeight;
		const canonical = bentWire(wallU, top, highY, along, slope, lowU, low.y, bend);
		const points = canonical.map(([u, y]) => toWorld(u, y));
		wires.push(points);
		walls.push([points[0] as TVec2, toWorld(wallU, highY)]);
	});
	// Stop on the exit side, from above the last leg's low end to below it
	const exitU = isLastEven ? width : 0;
	const stop: TVec2[] = [toWorld(exitU, lastLow + catchHeight), toWorld(exitU, lastLow - drop / 2)];
	wires.push(stop);
	walls.push([stop[0] as TVec2, stop[1] as TVec2]);
	return {
		wires,
		walls,
		legs,
		exit: toWorld(isLastEven ? width - opening / 2 : opening / 2, lastLow),
		bottom: Math.min(lastLow - drop / 2, ...wires.flat().map((point) => point.y)) - radius,
		slope
	};

	function legHigh(k: number): number {
		return rim - WALL_RISE - k * (rise + drop);
	}

	function legLow(k: number): number {
		return legHigh(k) - rise;
	}
}

/**
 * A wall at `wallU` from `top` down to a leg's high end at `highY`, turning through a circular bend of
 * `bend` radius into the leg, which runs along `along` (+1 or −1 in u) down at `slope` to (`lowU`, `lowY`).
 * The bend is tangent to the wall and the leg, so the marble rolls up it and back instead of striking a
 * corner. Returns [u, y] points; a radius too large for the wall or leg shrinks to fit.
 */
function bentWire(
	wallU: number,
	top: number,
	highY: number,
	along: number,
	slope: number,
	lowU: number,
	lowY: number,
	bend: number
): [number, number][] {
	// Angle at the corner between the wall going up and the leg going down along `along`
	const corner = Math.PI / 2 + slope;
	const tangentShare = 1 / Math.tan(corner / 2);
	const legLength = Math.hypot(lowU - wallU, lowY - highY);
	const room = Math.min(top - highY, legLength) * 0.9;
	const radius = Math.max(0, Math.min(bend, room / tangentShare));
	const points: [number, number][] = [[wallU, top]];
	if (radius < 1e-6) {
		points.push([wallU, highY], [lowU, lowY]);
		return points;
	}
	const reach = radius * tangentShare;
	const legDirection: [number, number] = [along * Math.cos(slope), -Math.sin(slope)];
	const start: [number, number] = [wallU, highY + reach];
	const end: [number, number] = [wallU + legDirection[0] * reach, highY + legDirection[1] * reach];
	// The center lies one radius inside the bend from the wall
	const center: [number, number] = [wallU + along * radius, highY + reach];
	const from = Math.atan2(start[1] - center[1], start[0] - center[0]);
	const to = Math.atan2(end[1] - center[1], end[0] - center[0]);
	let sweep = to - from;
	// The bend turns the short way: counterclockwise from a wall on the left, clockwise from one on the right
	if (along > 0 && sweep < 0) sweep += 2 * Math.PI;
	if (along < 0 && sweep > 0) sweep -= 2 * Math.PI;
	points.push(start);
	for (let i = 1; i < BEND_POINTS; i++) {
		const angle = from + (sweep * i) / BEND_POINTS;
		points.push([center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)]);
	}
	points.push(end, [lowU, lowY]);
	return points;
}

// Share of its entry speed a marble keeps rolling onto the first leg, fitted to simulated Jingle Bells
// switchbacks at full and half gravity
const ENTRY_SPEED_SHARE = 0.35;

/**
 * Rough time a marble spends in a switchback: the drop onto the first leg, then each leg rolled at the
 * rolling acceleration 5/7 · g · sin(slope) and each drop through an opening. The marble starts the first
 * leg with `ENTRY_SPEED_SHARE` of `entrySpeed` and keeps its speed through the bends, so later legs pass
 * quicker. Rolling every leg from rest instead overestimated simulated holds two to five times, most at low
 * gravity and shallow slopes; this estimate is within about 0.2 s (rms) at full and half gravity. Used to
 * rank candidates before simulating them.
 */
export function switchbackHoldTime(
	params: Record<string, number>,
	slope: number,
	g = -GRAVITY_Y,
	entrySpeed = 0
): number {
	const width = params['width'] ?? 0.1;
	const legCount = Math.max(1, Math.round(params['turns'] ?? 3));
	const drop = params['drop'] ?? 0.035;
	const opening = params['opening'] ?? 0.032;
	const limited = Math.min(MAX_LEG_SLOPE, Math.max(MIN_LEG_SLOPE, Math.abs(slope)));
	const along = (width - opening) / Math.cos(limited);
	const acceleration = (5 / 7) * g * Math.sin(limited);
	const fall = Math.sqrt((2 * drop) / g);
	let time = Math.sqrt((2 * WALL_RISE) / g) + (legCount - 1) * fall;
	let speed = ENTRY_SPEED_SHARE * entrySpeed;
	for (let leg = 0; leg < legCount; leg++) {
		const end = Math.sqrt(speed * speed + 2 * acceleration * along);
		time += (end - speed) / acceleration;
		speed = end;
	}
	return time;
}

/**
 * Separate C's chained down a column: each turn is a wall coming down on one side that curves round through `sweep` on a
 * curve of radius `arc` and throws the marble across to the next turn, `drop` under it. A straight run doesn't lead into
 * a turn, so nothing stops the marble between two curves, as one continuous S does. No stop follows the last turn: the
 * marble leaves off its lip. The hit link's `angle` gives only the direction of the first turn.
 */
export function chainGeometry(params: Record<string, number>, angle: number, contactAt: number, entry: TVec2, marbleRadius: number, velocity: TVec2 | null): TSwitchbackGeometry {
	const width = params['width'] ?? 0.12;
	const turns = Math.max(1, Math.round(params['turns'] ?? 3));
	const step = params['drop'] ?? 0.07;
	const lip = params['lip'] ?? 0.04;
	const radius = params['radius'] ?? 0.0025;
	const direction = angle > 0 ? -1 : 1;
	const clear = marbleRadius + radius + ENTRY_CLEARANCE;
	const entryU = Math.min(width - clear, Math.max(clear, contactAt * width));
	const toWorld = (u: number, y: number): TVec2 => ({ x: entry.x + direction * (u - entryU), y });
	const rim = entry.y - clear;
	const moving = velocity != null && Math.abs(velocity.x) > 0.05 ? Math.sign(velocity.x * direction) : 0;
	// The marble must fit between a lip and the far wall
	const fit = 2 * marbleRadius + 2 * radius + 0.008;
	const curve = Math.min((params['arc'] ?? 0.05) + marbleRadius + radius, (width - fit) / 1.02);
	const over = Math.min(((params['sweep'] ?? 100) - 90) * DEGREE, Math.asin(Math.max(0, Math.min(1, (width - fit) / curve - 1))));
	const sweep = Math.PI / 2 + over;
	const top = rim - WALL_RISE;
	const lipRise = curve * Math.sin(over);
	const catchHeight = 2 * marbleRadius + 2 * radius + 0.005;
	const wires: TVec2[][] = [];
	const walls: [TVec2, TVec2][] = [];
	const legs: [TVec2, TVec2][] = [];
	let lastLip = entry;
	let lastLipU = 0;
	for (let k = 0; k < turns; k++) {
		const along = k % 2 === 0 ? 1 : -1;
		const wallU = k % 2 === 0 ? 0 : width;
		const centerY = top - k * step;
		const centerU = wallU + along * curve;
		const previousLip = centerY + step - curve + lipRise;
		const wallTop = k === 0 ? rim + (moving < 0 ? lip : 0) : k === 1 ? (moving > 0 ? Math.max(rim + lip, previousLip + catchHeight) : Math.max(centerY, Math.min(rim, previousLip + catchHeight))) : Math.max(centerY, previousLip + catchHeight);
		const count = Math.max(6, Math.ceil(sweep / (4 * DEGREE)));
		const canonical: [number, number][] = [[wallU, wallTop]];
		for (let i = 0; i <= count; i++) {
			const turned = (sweep * i) / count;
			canonical.push([centerU - along * curve * Math.cos(turned), centerY - curve * Math.sin(turned)]);
		}
		const points = canonical.map(([u, y]) => toWorld(u, y));
		wires.push(points);
		walls.push([points[0] as TVec2, toWorld(wallU, centerY)]);
		const end = canonical[canonical.length - 1] as [number, number];
		lastLip = toWorld(end[0], end[1]);
		lastLipU = end[0];
		legs.push([toWorld(wallU, centerY), lastLip]);
	}
	const exitU = (turns - 1) % 2 === 0 ? width : 0;
	return {
		wires,
		walls,
		legs,
		exit: toWorld((lastLipU + exitU) / 2, lastLip.y),
		bottom: Math.min(...wires.flat().map((point) => point.y)) - radius,
		slope: Math.min(MAX_LEG_SLOPE, Math.max(MIN_LEG_SLOPE, Math.abs(angle)))
	};
}

/** Rough time a marble spends in a chain, fitted to simulated Jingle Bells gaps. Used to rank candidates before simulating them. */
export function chainHoldTime(params: Record<string, number>): number {
	const turns = Math.max(1, Math.round(params['turns'] ?? 3));
	return 0.25 + (turns - 1) * (0.27 + 0.6 * (params['arc'] ?? 0.05) + 0.0035 * ((params['sweep'] ?? 100) - 95));
}

/** One smooth curve: a parabola from the high side that steepens by `drop` across `width`, on top of the link's slope */
function curveGeometry(params: Record<string, number>, angle: number, contactAt: number, entry: TVec2, marbleRadius: number): TSwitchbackGeometry {
	const width = params['width'] ?? 0.15;
	const drop = params['drop'] ?? 0.06;
	const radius = params['radius'] ?? 0.0025;
	const direction = angle > 0 ? -1 : 1;
	const slope = Math.tan(Math.abs(angle));
	const heightAt = (u: number): number => -slope * u - (drop * u * u) / (width * width);
	const entryU = contactAt * width;
	const rim = entry.y - marbleRadius - radius - ENTRY_CLEARANCE;
	const wire: TVec2[] = [];
	for (let i = 0; i <= CURVE_POINTS; i++) {
		const u = (width * i) / CURVE_POINTS;
		wire.push({ x: entry.x + direction * (u - entryU), y: rim + heightAt(u) - heightAt(entryU) });
	}
	const last = wire[wire.length - 1] as TVec2;
	return { wires: [wire], walls: [], legs: [[wire[0] as TVec2, last]], exit: { ...last }, bottom: last.y - radius, slope: Math.abs(angle) };
}

function generatedGeometry(input: TLayoutInput, entry: TVec2, velocity: TVec2 | null): TSwitchbackGeometry {
	const { params, angle, contactAt, marbleRadius } = input;
	switch (input.layout) {
		case 'curve':
			return curveGeometry(params, angle, contactAt, entry, marbleRadius);
		case 'c':
			return chainGeometry({ ...params, turns: 1 }, angle, contactAt, entry, marbleRadius, velocity);
		case 'chain':
			return chainGeometry(params, angle, contactAt, entry, marbleRadius, velocity);
		default:
			return switchbackGeometry(params, angle, contactAt, entry, marbleRadius, velocity);
	}
}

function generatedLayout(input: TLayoutInput, entry: TVec2, velocity: TVec2 | null): TPieceLayout {
	const geometry = generatedGeometry(input, entry, velocity);
	const radius = input.params['radius'] ?? 0.0025;
	const shapes: TPieceShape[] = geometry.wires.flatMap((wire) => capsuleChain(wire, radius));
	const tops = geometry.wires.slice(0, 2).map((wire) => wire[0] ?? entry);
	const top = Math.max(...tops.map((point) => point.y));
	return {
		position: { x: tops.reduce((sum, point) => sum + point.x, 0) / Math.max(1, tops.length), y: top },
		angle: input.angle,
		contactPoint: null,
		contactNormal: null,
		shapes,
		box: null,
		path: null,
		rotor: null,
		paths: geometry.wires.map((wire) => wire.map((point) => ({ ...point })))
	};
}

// Bowls

// How far the rims curl over the arc's center
const BOWL_RIM = 40 * DEGREE;
// Points per 90° of arc
const ARC_POINTS = 16;

export interface TBowlGeometry {
	/** The wire the marble rides inside, from the far rim down through the bottom to the near one */
	wire: TVec2[];
	/** Center of the catch curve */
	center: TVec2;
	/** The mouth, where the marble is when the Bowl enters the run */
	mouth: TVec2;
	/** Highest and lowest wire point, wire thickness included */
	top: number;
	bottom: number;
}

/**
 * The wire of a Bowl whose mouth is at `mouth`. The catch curve is an arc of radius `size` around a center just below
 * the mouth, so a marble falling through the mouth lands on the inside of the arc, whatever its speed, and loses most
 * of its speed into the wire (restitution 0.1). It runs from rim to rim through the bottom, both rims curling over the
 * center, so the marble stays inside it.
 */
export function bowlGeometry(params: Record<string, number>, mouth: TVec2, marbleRadius: number): TBowlGeometry {
	const size = params['size'] ?? 0.06;
	const radius = params['radius'] ?? 0.0025;
	const side = Math.round(params['mirror'] ?? 0) === 1 ? -1 : 1;
	// Radius of the marble's center when it touches the inside of the arc
	const inner = Math.max(0.001, size - radius - marbleRadius);
	const center = { x: mouth.x - side * 0.25 * inner, y: mouth.y - 0.25 * inner };
	const from = BOWL_RIM;
	const to = -Math.PI - BOWL_RIM;
	const count = Math.max(2, Math.ceil((Math.abs(to - from) / (Math.PI / 2)) * ARC_POINTS));
	const wire = Array.from({ length: count + 1 }, (_, index) => {
		const angle = from + ((to - from) * index) / count;
		return { x: center.x + side * size * Math.cos(angle), y: center.y + size * Math.sin(angle) };
	});
	const ys = wire.map((point) => point.y);
	return { wire, center, mouth: { ...mouth }, top: Math.max(...ys) + radius, bottom: Math.min(...ys) - radius };
}

function catcherLayout(input: TLayoutInput, mouth: TVec2): TPieceLayout {
	const geometry = bowlGeometry(input.params, mouth, input.marbleRadius);
	const radius = input.params['radius'] ?? 0.0025;
	return {
		position: { ...mouth },
		angle: 0,
		contactPoint: null,
		contactNormal: null,
		shapes: capsuleChain(geometry.wire, radius),
		box: null,
		path: null,
		rotor: null,
		paths: [geometry.wire.map((point) => ({ ...point }))]
	};
}
