import type { TVec2 } from '@/modules/project';

// Contract between the simulation engine and its consumers (Compose view, Blender handoff, fixtures).
// Units: metres, seconds, radians. Wall-plane coordinates: x right, y up; the wall surface is z = 0.

/** Fixed physics rate. Samples, contacts and snapshots use this clock. */
export const PHYSICS_HZ = 240;
/** A hit is valid when its marble first touches the linked piece within this error */
export const HIT_TOLERANCE = 0.02;
/** Errors above this but within tolerance are shown as drifting */
export const HIT_DRIFT = 0.008;

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
}

export type TPieceStatus =
	| 'free' // not linked to a hit
	| 'placed' // linked and placed on the trajectory
	| 'pinned' // linked, kept at its pinned position
	| 'blocked' // the earlier trajectory passes through it, so it was not inserted
	| 'unreached'; // the marble never reached a hit position (no samples at the hit time)

export interface TContact {
	time: number;
	marbleEntityId: string;
	/** Piece entity ID, or the other marble's entity ID for marble collisions */
	otherEntityId: string;
	kind: 'piece' | 'marble';
	position: TVec2;
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
	/** First contact time of the marble with the linked piece */
	actualTime: number | null;
	/** actualTime - targetTime */
	error: number | null;
	status: THitStatus;
}

export type THitStatus =
	| 'open' // no piece yet
	| 'onTime' // |error| <= HIT_DRIFT
	| 'drifting' // HIT_DRIFT < |error| <= HIT_TOLERANCE
	| 'missed' // no contact or |error| > HIT_TOLERANCE
	| 'blocked'; // the linked piece could not be inserted

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
		{ default: number; min: number; max: number; label: string; unit: 'm' | 'rad' | '' }
	>;
	/** Distance of the piece from the wall surface along +z, so Blender and Compose agree on depth */
	wallOffset: number;
	restitution: number;
	friction: number;
}
