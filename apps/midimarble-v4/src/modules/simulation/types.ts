import type { TVec2 } from '@/modules/project';
import type { TRailLayout } from './pieces';
import type { TDescentPace, TDescentPoint } from './pace';
import type { TPieceShape } from './shapes';

// Contract between the simulation engine and its consumers (Compose view, Blender handoff, fixtures).
// Units: metres, seconds, radians. Wall-plane coordinates: x right, y up; the wall surface is z = 0.

/** Fixed physics rate. Samples, contacts and snapshots use this clock. */
export const PHYSICS_HZ = 240;
/** A hit is valid when its marble first touches the linked piece within this error */
export const HIT_TOLERANCE = 0.02;
/** Errors above this but within tolerance are shown as drifting */
export const HIT_DRIFT = 0.008;
/**
 * A hit needs the marble to strike its piece: the speed at which they approach along the contact normal
 * must reach this. Slower first contacts are resting or rolling contacts and count as missed.
 */
export const IMPACT_SPEED = 0.3;

export interface TSimulationResult {
	/** Project revision the result was computed for */
	revision: number;
	/** Seconds simulated, normally the project end */
	duration: number;
	marbles: TMarbleTrack[];
	/** Resolved pose of every piece entity, linked or free */
	pieces: TResolvedPiece[];
	/** Every contact start between a marble and a piece or another marble, in time order */
	contacts: TContact[];
	/** Validation per hit of every lane, including hits without a piece */
	hits: THitResult[];
	/** Milliseconds spent computing this result and how much was reused from snapshots */
	stats: { computeMs: number; reusedUntil: number; steps: number };
	/**
	 * Shared descent pace y*(t) that the assists keep every lane near and the camera can follow. Null
	 * before any hit has a dot; absent in results made by hand.
	 */
	pace?: TDescentPace | null;
	/**
	 * The pace sampled every 0.5 s over the run, set when several marbles share the frame, so the film
	 * camera can follow their common height instead of zooming out over their spread
	 */
	descent?: TDescentPoint[] | null;
}

export interface TMarbleTrack {
	entityId: string;
	laneId: string;
	radius: number;
	/** Sampled every 1 / PHYSICS_HZ seconds from the release time; empty before release */
	samples: TMarbleSample[];
}

export interface TMarbleSample {
	time: number;
	position: TVec2;
	/** Rolling rotation around the wall normal */
	angle: number;
	velocity: TVec2;
}

export interface TResolvedPiece {
	entityId: string;
	type: string;
	/** Pose of the piece origin. For platforms the origin is the centre of the collider box. */
	position: TVec2;
	angle: number;
	/** Physical parameters after defaults are applied */
	params: Record<string, number>;
	/** Contact point on the surface where the linked hit lands, if linked */
	contactPoint: TVec2 | null;
	/** Surface normal at the contact point, pointing toward the incoming marble */
	contactNormal: TVec2 | null;
	/** The hit time this piece was placed for, if linked */
	hitTime: number | null;
	status: TPieceStatus;
	/**
	 * Every collider primitive in world coordinates, for drawing physics shapes. Set for rails, tunnels
	 * and windmills; windmills show their pose at insertion.
	 */
	shapes?: TPieceShape[];
	/** Smoothed support line of a rail or tunnel floor in world coordinates */
	path?: TVec2[];
	/**
	 * Every path of a Rail that holds several, in world coordinates, top first. A Switchback layout has one bent wire
	 * per leg (wall, rounded bend, leg), then the short exit stop.
	 */
	paths?: TVec2[][];
	/** A Rail's layout, when it isn't drawn */
	layout?: TRailLayout;
	/** When a scenery piece is anchored to the trajectory, `hitTime + entryDelay` */
	entryTime?: number;
	/**
	 * Rotation of a moving piece around its `position`, unwrapped so it never jumps by 2π. The first
	 * sample is at the run start. Samples then follow every physics step from the piece's insertion; in
	 * between the piece rests or turns linearly at its motor speed.
	 */
	motion?: TPieceMotionSample[];
}

export interface TPieceMotionSample {
	time: number;
	angle: number;
}

export type TPieceStatus =
	| 'free' // not linked to a hit
	| 'placed' // linked and placed on the trajectory
	| 'held' // linked, waiting where it was while an edit keeps the marble from it
	| 'blocked' // the earlier trajectory passes through it, so it was not inserted
	| 'unreached'; // the marble never reached a hit position (no samples at the hit time)

export interface TContact {
	time: number;
	marbleEntityId: string;
	/** Piece entity ID, or the other marble's entity ID for marble collisions */
	otherEntityId: string;
	kind: 'piece' | 'marble';
	position: TVec2;
	/**
	 * Speed at which the marble approached the piece along the contact normal, relative to the piece's
	 * surface, in metres per second. Set for piece contacts.
	 */
	speed?: number;
}

export interface THitResult {
	laneId: string;
	hitId: string;
	targetTime: number;
	/** Entity of the piece linked to this hit, if any */
	pieceEntityId: string | null;
	/** Marble centre at the target time on the current trajectory: the dot the user clicks */
	dot: TVec2 | null;
	/** Marble velocity at the target time, used for default angles and guardrails */
	velocity: TVec2 | null;
	/** Marble spin just before its contact with the linked piece, in radians per second */
	spin?: number;
	/** First contact time of the marble with the linked piece */
	actualTime: number | null;
	/** actualTime - targetTime */
	error: number | null;
	status: THitStatus;
	/** Why a hit with a piece is missed: `resting` when the first contact is slower than `IMPACT_SPEED` */
	reason?: 'resting';
	/** Set on open hits with a dot: true when the dot lies out of frame, outside the band covering every lane */
	outOfFrame?: boolean;
}

export type THitStatus =
	| 'open' // no piece yet
	| 'onTime' // |error| <= HIT_DRIFT
	| 'drifting' // HIT_DRIFT < |error| <= HIT_TOLERANCE
	| 'missed' // no contact, |error| > HIT_TOLERANCE, or a resting first contact
	| 'blocked' // the linked piece could not be inserted
	| 'waiting'; // its platform waits where it was, behind a hit an edit broke

export type TPieceLayoutKind = 'box' | 'path' | 'tube' | 'rotor' | 'generated' | 'catcher';

/**
 * Piece definitions. Each type builds its colliders from parameters and places its contact surface on a
 * trajectory point. New piece types are added by registering a definition.
 */
export interface TPieceDefinition {
	type: string;
	label: string;
	/** Parameter defaults and limits, in metres or radians */
	params: Record<
		string,
		{
			default: number;
			min: number;
			max: number;
			/** Full name in user words, shown in the field's tooltip */
			label: string;
			/** Name inside the inspector field when it differs from `label`; up to 7 characters fit a half-width field */
			short?: string;
			unit: 'm' | 'rad' | 's' | 'rad/s' | '' | '°';
			/** Rounded to a whole number when resolved */
			integer?: boolean;
		}
	>;
	/** Distance of the piece from the wall surface along +z, so Blender and Compose agree on depth */
	wallOffset: number;
	/** Restitution of marble contacts, unless the piece has a `bounce` parameter */
	restitution: number;
	/**
	 * True for pieces that sound the hit they are linked to. Other pieces are scenery: their hit link only
	 * anchors them to the trajectory at the hit time plus their `entryDelay`, and contacts with them are plain
	 * contacts, never hits.
	 */
	musical?: boolean;
	friction: number;
	/**
	 * How the piece is built: `box` (default) is a platform bar, `path` a rail along `path` points,
	 * `tube` a tunnel along `path` points, `rotor` a windmill turning around its hub, `generated` a
	 * Rail whose layout builds its paths from its parameters, `catcher` a Bowl built from its parameters
	 */
	layout?: TPieceLayoutKind;
	/** Local control points used when a path piece has no `path` component */
	defaultPath?: TVec2[];
}
