import type { TVec2 } from '@/modules/project';
import type { TPieceDefinition } from './types';

/**
 * Size of the default kit relative to the Marble Race Kit (16 mm marbles, 6 cm bars). At 1.5 times, with 24 mm
 * marbles and 9 cm bars, a run reads at the reference film's size. Saved projects keep their explicit parameters.
 */
export const KIT_SCALE = 1.5;

/** Longest time after its hit, or before the lane's first hit, that an anchored piece may follow the trajectory */
export const ANCHOR_DELAY = 10;

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
		length: { default: kit(0.06), min: 0.02, max: 0.3, label: 'Length', unit: 'm' },
		thickness: { default: kit(0.008), min: 0.003, max: 0.03, label: 'Thickness', unit: 'm' },
		depth: { default: kit(0.03), min: 0.02, max: 0.08, label: 'Depth', unit: 'm' },
		bounce: { default: 0.65, min: 0.1, max: 0.95, label: 'Bounce', unit: '' },
		entryDelay: { default: 0, min: -ANCHOR_DELAY, max: ANCHOR_DELAY, label: 'Starts after hit', unit: 's' }
	},
	wallOffset: 0,
	restitution: 0.55,
	friction: 0.3,
	musical: true
};

/**
 * Wire rail the marble lands on and rolls along. The path is smoothed into a chain of capsules the
 * marble rides on top of. The film shows two wires `gap` apart in depth; since marbles are locked to
 * the wall plane, physics models them as one support line of the wire radius.
 */
export const railDefinition: TPieceDefinition = {
	type: 'rail',
	label: 'Rail',
	params: {
		radius: { default: kit(0.0025), min: 0.001, max: 0.006, label: 'Thickness of each rail', short: 'Thickness', unit: 'm' },
		gap: { default: kit(0.01), min: 0.004, max: 0.02, label: 'Width between the two rails', short: 'Width', unit: 'm' },
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
export const windmillDefinition: TPieceDefinition = {
	type: 'windmill',
	label: 'Windmill',
	params: {
		bladeCount: { default: 4, min: 2, max: 8, label: 'Number of arms', short: 'Arms', unit: '', integer: true },
		bladeLength: { default: kit(0.06), min: 0.02, max: 0.2, label: 'Arm length', short: 'Arm Length', unit: 'm' },
		bladeThickness: { default: kit(0.006), min: 0.003, max: 0.02, label: 'Arm width', short: 'Arm Width', unit: 'm' },
		hubRadius: { default: kit(0.008), min: 0.004, max: 0.03, label: 'Size of the centre the arms turn on', short: 'Centre Size', unit: 'm' },
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
 * Holder for long gaps: wire legs stacked in a column, sloping alternately left and right. Each leg is one
 * bent wire: a wall comes down on its high side and turns through a rounded bend of radius `bend` into the
 * leg. The marble drops in at the top, rolls down a leg, falls through the `opening` at its low end against
 * the next leg's wall, rolls up that leg's bend and back down the leg the other way, and leaves through the
 * opening of the last leg past a short stop, so it stays in a narrow column for a predictable time. A bend
 * of 0 gives sharp corners. The linked hit's `angle` sets the leg slope, with its
 * sign the direction of the first leg like a rail (negative runs downhill to +x), and `contactAt` where
 * the marble enters across the top, from the first leg's high end (0) to its low end (1). The wall the
 * marble moves toward rises `lip` above the others to catch a sideways entry.
 */
export const switchbackDefinition: TPieceDefinition = {
	type: 'switchback',
	label: 'Switchback',
	params: {
		width: { default: kit(0.1), min: 0.06, max: 0.3, label: 'Width', unit: 'm' },
		legs: { default: 3, min: 1, max: 6, label: 'Number of runs down the zigzag', short: 'Runs', unit: '', integer: true },
		drop: { default: kit(0.035), min: 0.026, max: 0.15, label: 'Height between the runs', short: 'Run Height', unit: 'm' },
		opening: { default: kit(0.032), min: 0.026, max: 0.09, label: 'Gap at each turn where the marble drops through', short: 'Turn Gap', unit: 'm' },
		lip: { default: kit(0.04), min: 0, max: 0.15, label: 'Height of the guard that catches the marble', short: 'Guard', unit: 'm' },
		bend: { default: 0.04, min: 0, max: 0.08, label: 'Roundness of each turn', short: 'Turn Curve', unit: 'm' },
		radius: { default: kit(0.0025), min: 0.001, max: 0.006, label: 'Thickness of the rails', short: 'Thickness', unit: 'm' },
		entryDelay: { default: 0, min: -ANCHOR_DELAY, max: ANCHOR_DELAY, label: 'Starts after hit', unit: 's' }
	},
	wallOffset: 0,
	restitution: 0.15,
	friction: 0.4,
	layout: 'holder'
};

/** `style` values of a Finish */
export const FINISH_CHUTE = 0;
export const FINISH_CUP = 1;

/**
 * The end of a marble's run: a piece that catches the marble after its last note and plays none. `style` 0 is a
 * Chute, a curved open trough (one wire in the wall plane, drawn as a clear two-wire chute) that the marble drops
 * into and that rolls it out to the side and down, away from the frame; 1 is a Cup, a bowl with rims curling
 * inward that holds it. The catch curve is an arc of radius `size`; the Chute's backstop stands on the side the
 * marble moves toward and its run-out leads `length` the other way, `mirror` swapping the sides. A Finish anchored
 * to a marble's last hit enters the run at that marble, its mouth around the marble (`finishGeometry`).
 */
export const finishDefinition: TPieceDefinition = {
	type: 'finish',
	label: 'Finish',
	params: {
		style: { default: FINISH_CHUTE, min: FINISH_CHUTE, max: FINISH_CUP, label: 'Chute rolls the marble away, Cup holds it', short: 'Style', unit: '', integer: true },
		mirror: { default: 0, min: 0, max: 1, label: 'Which side the backstop stands on', short: 'Mirror', unit: '', integer: true },
		size: { default: kit(0.04), min: 0.035, max: 0.15, label: 'Size of the curve that catches the marble', short: 'Size', unit: 'm' },
		length: { default: kit(0.13), min: 0.04, max: 0.5, label: 'Length of the run-out the marble rolls away along', short: 'Run-Out', unit: 'm' },
		radius: { default: kit(0.0025), min: 0.001, max: 0.006, label: 'Thickness of the rails', short: 'Thickness', unit: 'm' },
		entryDelay: { default: 0, min: -ANCHOR_DELAY, max: ANCHOR_DELAY, label: 'Starts after hit', unit: 's' }
	},
	wallOffset: 0,
	restitution: 0.1,
	friction: 0.4,
	layout: 'catcher'
};

export const pieceDefinitions: Record<string, TPieceDefinition> = {
	[platformDefinition.type]: platformDefinition,
	[railDefinition.type]: railDefinition,
	[tunnelDefinition.type]: tunnelDefinition,
	[windmillDefinition.type]: windmillDefinition,
	[switchbackDefinition.type]: switchbackDefinition,
	[finishDefinition.type]: finishDefinition
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
 * Pieces that sound the hit they are linked to: platforms. Windmills, rails, tunnels and switchbacks are
 * scenery; their hit link anchors them to the trajectory `entryDelay` seconds after the hit.
 */
export function isMusicalPiece(type: string): boolean {
	return getPieceDefinition(type)?.musical === true;
}

/** True when a linked piece sounds its hit: a musical piece that is linked, not anchored */
export function soundsHit(type: string, hitLink: { anchored?: boolean } | undefined): boolean {
	return hitLink != null && hitLink.anchored !== true && isMusicalPiece(type);
}

/**
 * Linked pieces entered `entryDelay` seconds after their hit. Scenery never sounds a hit whatever its delay,
 * so `isMusicalPiece` decides which pieces own hits.
 */
export function isFollowerPiece(params: Record<string, number>): boolean {
	return (params['entryDelay'] ?? 0) > 0;
}
