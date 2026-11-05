import type { TVec2 } from '@/modules/project';
import type { TPieceDefinition } from './types';

/**
 * Size of the default kit relative to the Marble Race Kit (16 mm marbles, 6 cm bars). At 1.5 times, with 24 mm
 * marbles and 9 cm bars, a run reads at the reference film's size. Saved projects keep their explicit parameters.
 */
export const KIT_SCALE = 1.5;

/** Longest time after its hit, or before the marble's first hit, that an anchored piece may follow the trajectory */
export const ANCHOR_DELAY = 10;

/** How far a piece stands out of the wall in the app's views and the film: its Depth, however large */
export function shownDepth(piece: { type: string; params: Record<string, number> }): number {
	return piece.params['depth'] ?? 0.03;
}

/** Bar length that hops, columns and the canvas's fit are spaced by, whatever a bar's own length: a thin bar doesn't crowd the run */
export const PLACEMENT_LENGTH = 0.09;

/** Gap between a marble and the wall at its closest, `MARBLE_WALL_GAP` in `mm_worker/util.py` */
const MARBLE_WALL_GAP = 0.0005;

/**
 * How far the marble's path runs out from the wall in the film and the Draft Preview: the middle of a typical platform's
 * Depth, so the marble lands in the middle of its bars. Rails, Tunnels, Windmills and the Bowl run there too, on posts
 * back to the wall. Only a look: physics stays in one plane and never reads it.
 */
export function pathDepth(pieces: readonly { type: string; params: Record<string, number> }[], marbleRadius: number): number {
	const depths = pieces
		.filter((piece) => piece.type === 'platform')
		.map(shownDepth)
		.sort((a, b) => a - b);
	const depth = depths[Math.floor(depths.length / 2)] ?? platformDefinition.params['depth']?.default ?? 0.09;
	return Math.max(depth / 2, marbleRadius + MARBLE_WALL_GAP);
}

function kit(value: number): number {
	return Math.round(value * KIT_SCALE * 1e6) / 1e6;
}

/**
 * Flat bar the marble bounces off. The collider is a box; its top face is the contact surface.
 * `bounce` is the restitution e of every marble contact with it. With a hit every T seconds the marble
 * settles at a drop per hit of (1 − e) / (1 + e) · gT² / 2, and after a bounce it rises e² / (1 − e²)
 * times that drop. Above e = 1 / √2 it rises past the previous piece of the other column in a zigzag
 * and has to pass beside it on the way down, which the assists cannot keep in frame. The default 0.65
 * stays below that: at T = 0.3 s it drops about 9.4 cm per hit, against 12.8 cm at 0.55.
 */
export const platformDefinition: TPieceDefinition = {
	type: 'platform',
	label: 'Platform',
	params: {
		// A thin plate seen end on, 3 cm along the wall: the collider's length too
		length: { default: kit(0.02), min: 0.02, max: 0.3, label: 'Length', unit: 'm' },
		thickness: { default: kit(0.008), min: 0.003, max: 0.03, label: 'Thickness', unit: 'm' },
		// How far the plate stands out of the wall, 9 cm by default: visual only, as the marble moves in the wall plane
		depth: { default: kit(0.06), min: 0.02, max: 0.12, label: 'Depth', unit: 'm' },
		bounce: { default: 0.65, min: 0.1, max: 0.95, label: 'Bounce', unit: '' },
		entryDelay: { default: 0, min: -ANCHOR_DELAY, max: ANCHOR_DELAY, label: 'Starts after hit', unit: 's' }
	},
	wallOffset: 0,
	restitution: 0.55,
	friction: 0.3,
	musical: true
};

/**
 * How a Rail gets its paths, like one Blender curve with several splines: `path` is drawn, the others generate their
 * paths from the parameters each time the piece is laid out, around the point the marble enters.
 */
export const RAIL_LAYOUTS = ['path', 'curve', 'c', 'chain', 'switchback'] as const;
export type TRailLayout = (typeof RAIL_LAYOUTS)[number];

/** What the inspector calls each layout, says about it and shows for it, in the order it shows them */
export const railLayoutInfo: Record<TRailLayout, { label: string; title: string; params: string[]; defaults: Record<string, number> }> = {
	path: { label: 'Drawn', title: 'The path you drew with the Rail tool', params: ['radius', 'gap'], defaults: {} },
	curve: { label: 'Curve', title: 'One smooth curve down to the side', params: ['width', 'drop', 'radius', 'gap'], defaults: { width: kit(0.1), drop: 0.06 } },
	c: { label: 'C', title: 'One wall that curves round and sends the marble back the way it came', params: ['width', 'arc', 'sweep', 'radius', 'gap'], defaults: { width: 0.12, arc: 0.05, sweep: 100 } },
	chain: { label: 'Chain', title: 'Curved turns one under the other, with gaps the marble drops through. Tried by simulating it.', params: ['turns', 'width', 'drop', 'arc', 'sweep', 'radius', 'gap'], defaults: { turns: 3, width: 0.12, drop: 0.07, arc: 0.05, sweep: 100 } },
	switchback: { label: 'Switchback', title: 'Straight runs one under the other, sloping left and right, for the steadiest timing', params: ['turns', 'width', 'drop', 'opening', 'lip', 'bend', 'radius', 'gap'], defaults: {} }
};

/** A Rail's parameters for a layout: its own and the delay, the rest being the definition's */
export function railParams(layout: TRailLayout, values: Record<string, number>): Record<string, number> {
	const resolved = resolvePieceParams('rail', { ...railLayoutInfo[layout].defaults, ...values });
	const params: Record<string, number> = {};
	for (const name of [...railLayoutInfo[layout].params, 'entryDelay']) params[name] = resolved[name] ?? 0;
	return params;
}

/**
 * Rail: what the marble rolls on. It holds one path or several with gaps between them, smoothed into chains of capsules
 * the marble rides on top of, one row in Layers and one Skin. The film shows two wires `gap` apart in depth; since
 * marbles are locked to the wall plane, physics models them as one support line of the wire radius.
 *
 * Layout `switchback` is for long gaps: legs stacked in a column, sloping alternately left and right. Each leg is one
 * bent wire: a wall comes down on its high side and turns through a rounded bend of radius `bend` into the leg. The
 * marble drops in at the top, rolls down a leg, falls through the `opening` at its low end against the next leg's wall,
 * rolls up that leg's bend and back down the leg the other way, and leaves through the opening of the last leg past a
 * short stop, so it stays in a narrow column for a predictable time. The linked hit's `angle` sets the leg slope, with
 * its sign the direction of the first leg (negative runs downhill to +x), and `contactAt` where the marble enters across
 * the top. The wall the marble moves toward rises `lip` above the others to catch a sideways entry.
 *
 * Layout `chain` is separate C's in the same column: each turn is a wall curving round through `sweep` on a curve of
 * radius `arc`, `drop` under the one before.
 */
const railDefinition: TPieceDefinition = {
	type: 'rail',
	label: 'Rail',
	params: {
		radius: { default: kit(0.0025), min: 0.001, max: 0.006, label: 'Thickness of each rail', short: 'Thickness', unit: 'm' },
		gap: { default: kit(0.01), min: 0.004, max: 0.02, label: 'Width between the two rails', short: 'Spread', unit: 'm' },
		width: { default: kit(0.1), min: 0.06, max: 0.3, label: 'Width', unit: 'm' },
		turns: { default: 3, min: 1, max: 6, label: 'Number of turns', short: 'Turns', unit: '', integer: true },
		drop: { default: kit(0.035), min: 0.026, max: 0.15, label: 'Height between the turns', short: 'Drop', unit: 'm' },
		opening: { default: kit(0.032), min: 0.026, max: 0.09, label: 'Gap at each turn where the marble drops through', short: 'Turn Gap', unit: 'm' },
		lip: { default: kit(0.04), min: 0, max: 0.15, label: 'Height of the guard that catches the marble', short: 'Guard', unit: 'm' },
		bend: { default: 0.04, min: 0, max: 0.08, label: 'Roundness of each turn', short: 'Turn Curve', unit: 'm' },
		arc: { default: 0.05, min: 0.02, max: 0.12, label: 'Radius of each curved turn', short: 'Curve', unit: 'm' },
		sweep: { default: 100, min: 70, max: 130, label: 'How far each curved turn comes round. Past 90° the marble can settle in it', short: 'Lip', unit: '°' },
		entryDelay: { default: 0, min: -ANCHOR_DELAY, max: ANCHOR_DELAY, label: 'Starts after hit', unit: 's' }
	},
	wallOffset: 0,
	restitution: 0.15,
	friction: 0.4,
	layout: 'path',
	defaultPath: [
		{ x: kit(-0.006), y: 0 },
		{ x: 0, y: 0 },
		{ x: kit(0.15), y: kit(-0.012) }
	]
};

/**
 * Closed tube along a path. The floor works like a rail, and a ceiling `bore` above the marble starts
 * `mouth` after the entry so the marble can drop in. Blender hides the marble while it is inside.
 */
export const tunnelDefinition: TPieceDefinition = {
	type: 'tunnel',
	label: 'Tunnel',
	params: {
		radius: { default: kit(0.002), min: 0.001, max: 0.006, label: 'Wall thickness', short: 'Wall', unit: 'm' },
		bore: { default: kit(0.004), min: 0.001, max: 0.02, label: 'Room around the marble', short: 'Room', unit: 'm' },
		mouth: { default: kit(0.03), min: 0.01, max: 0.1, label: 'Mouth width', short: 'Mouth', unit: 'm' },
		entryDelay: { default: 0, min: -ANCHOR_DELAY, max: ANCHOR_DELAY, label: 'Starts after hit', unit: 's' }
	},
	wallOffset: 0,
	restitution: 0.15,
	friction: 0.4,
	layout: 'tube',
	defaultPath: [
		{ x: kit(-0.006), y: 0 },
		{ x: 0, y: 0 },
		{ x: kit(0.15), y: kit(-0.02) }
	]
};

/**
 * Blades on a hub that turns around the wall normal. The marble strikes a blade face; with no motor the
 * windmill turns freely and slows down by `damping`, with a motor it turns at `motorSpeed` regardless.
 */
const windmillDefinition: TPieceDefinition = {
	type: 'windmill',
	label: 'Windmill',
	params: {
		bladeCount: { default: 4, min: 2, max: 8, label: 'Number of arms', short: 'Arms', unit: '', integer: true },
		bladeLength: { default: kit(0.06), min: 0.02, max: 0.2, label: 'Arm length', short: 'Arm Length', unit: 'm' },
		bladeThickness: { default: kit(0.006), min: 0.003, max: 0.02, label: 'Arm width', short: 'Arm Width', unit: 'm' },
		hubRadius: { default: kit(0.008), min: 0.004, max: 0.03, label: 'Size of the center the arms turn on', short: 'Center Size', unit: 'm' },
		damping: { default: 0.5, min: 0, max: 10, label: 'Brake: how quickly the spin slows down', short: 'Brake', unit: '' },
		motorSpeed: { default: 0, min: -20, max: 20, label: 'Spin on its own; 0 turns only when the marble pushes it', short: 'Spin', unit: 'rad/s' },
		depth: { default: kit(0.03), min: 0.02, max: 0.08, label: 'Depth', unit: 'm' },
		bounce: { default: 0.5, min: 0.2, max: 0.95, label: 'Bounce', unit: '' },
		entryDelay: { default: 0, min: -ANCHOR_DELAY, max: ANCHOR_DELAY, label: 'Starts after hit', unit: 's' }
	},
	wallOffset: 0,
	restitution: 0.5,
	friction: 0.3,
	layout: 'rotor'
};

/**
 * Bowl: what collects a marble. A piece that catches the marble and plays no note: an arc of radius `size` with rims
 * curling inward, drawn as a clear wire cage, that holds it. `mirror` picks the side of the marble its center lies on.
 * A Bowl anchored to a marble's last hit enters the run at that marble, its mouth around the marble (`bowlGeometry`).
 */
export const bowlDefinition: TPieceDefinition = {
	type: 'bowl',
	label: 'Bowl',
	params: {
		mirror: { default: 0, min: 0, max: 1, label: 'Which side of the marble the center lies on', short: 'Mirror', unit: '', integer: true },
		size: { default: kit(0.04), min: 0.035, max: 0.15, label: 'Size of the curve that catches the marble', short: 'Size', unit: 'm' },
		radius: { default: kit(0.0025), min: 0.001, max: 0.006, label: 'Thickness of the rails', short: 'Thickness', unit: 'm' },
		entryDelay: { default: 0, min: -ANCHOR_DELAY, max: ANCHOR_DELAY, label: 'Starts after hit', unit: 's' }
	},
	wallOffset: 0,
	restitution: 0.1,
	friction: 0.4,
	layout: 'catcher'
};

const pieceDefinitions: Record<string, TPieceDefinition> = {
	[platformDefinition.type]: platformDefinition,
	[railDefinition.type]: railDefinition,
	[tunnelDefinition.type]: tunnelDefinition,
	[windmillDefinition.type]: windmillDefinition,
	[bowlDefinition.type]: bowlDefinition
};

export function getPieceDefinition(type: string): TPieceDefinition | undefined {
	return pieceDefinitions[type];
}

/** Parameters with defaults filled in and values clamped to their limits */
export function resolvePieceParams(
	type: string,
	params: Record<string, number>
): Record<string, number> {
	const definition = getPieceDefinition(type);
	if (definition == null) return { ...params };
	const resolved: Record<string, number> = {};
	for (const [name, spec] of Object.entries(definition.params)) {
		const value = params[name] ?? spec.default;
		const clamped = Math.min(spec.max, Math.max(spec.min, value));
		resolved[name] = spec.integer === true ? Math.round(clamped) : clamped;
	}
	return resolved;
}

/** Restitution of a piece's colliders: its `bounce` parameter when it has one, else its definition's */
export function pieceRestitution(
	definition: TPieceDefinition,
	params: Record<string, number>
): number {
	return params['bounce'] ?? definition.restitution;
}

/** Local control points of a path piece, falling back to the definition's default path */
export function resolvePiecePath(type: string, points: TVec2[] | undefined): TVec2[] {
	if (points != null && points.length >= 2) return points;
	return getPieceDefinition(type)?.defaultPath ?? [];
}

/**
 * Pieces that sound the hit they are linked to: platforms. Windmills, rails and tunnels are
 * scenery; their hit link anchors them to the trajectory `entryDelay` seconds after the hit.
 */
export function isMusicalPiece(type: string): boolean {
	return getPieceDefinition(type)?.musical === true;
}

/** True when a linked piece sounds its hit: a musical piece that is linked, not anchored */
export function soundsHit(type: string, hitLink: { anchored?: boolean } | undefined): boolean {
	return hitLink != null && hitLink.anchored !== true && isMusicalPiece(type);
}
