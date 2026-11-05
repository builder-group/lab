import { DEFAULT_MARBLE_RADIUS, type TProject, type TRide, type TVec2, tieOf, freePosition } from '@/modules/project';
import { gravityOf } from './geometry';
import { layoutFree, type TPieceLayout } from './piece-layout';
import { getPieceDefinition, soundsHit, resolvePieceParams, resolvePiecePath, type TRailLayout } from './pieces';
import { hasRide, rideHash, rideKey } from './ride';
import { shapesBounds } from './shapes';
import { PHYSICS_HZ, type TPieceDefinition, type TResolvedPiece } from './types';

export const STEP_EPSILON = 1e-7;
const SIGNATURE_VERSION = 'sim@4';

/**
 * All a marble's run reads of a project. `film`, `format`, `songs` and `groups` aren't in it, so the compiler proves
 * they can't change a run.
 */
export type TRunInput = Pick<TProject, 'marbles' | 'gravity' | 'length'> & { track: Pick<TProject['track'], 'pieces'> };

/**
 * True when two projects run the same. Commands copy only what they change, so an unchanged section keeps its identity
 * and comparing it costs nothing. An equal section under a new identity only runs again, which is safe.
 */
export function isSameRunInput(a: TRunInput, b: TRunInput): boolean {
	return a.marbles === b.marbles && a.track.pieces === b.track.pieces && a.gravity === b.gravity && a.length === b.length;
}

export interface TPlan {
	/** Gravity along y, Earth's scaled by the project's `physics.gravity` */
	gravity: number;
	startStep: number;
	endStep: number;
	marbles: TPlanMarble[];
	staticPieces: TStaticPiece[];
	/** Lowest point of the static pieces, which bounds how far a marble may fall */
	staticLowY: number;
	/** Hit-linked pieces in global hit time order */
	events: TPlanEvent[];
	/** Signature of the state just before each event is processed */
	eventKeys: string[];
	/** Linked piece piece ID to its hit time, null when the hit does not exist */
	linkedHitTimes: Map<string, number | null>;
}

export interface TPlanMarble {
	marbleId: string;
	radius: number;
	release: TVec2;
	releaseVelocity: TVec2;
	releaseSpin: number;
	releaseTime: number;
	releaseStep: number;
}

export interface TStaticPiece {
	pieceId: string;
	definition: TPieceDefinition;
	params: Record<string, number>;
	layout: TPieceLayout;
	resolved: TResolvedPiece;
	/**
	 * Signature of a parkable piece, empty for windmills. Parkable pieces enter the world only when a marble
	 * comes near, so they stay out of the event chain, and a run resumes past an edit to one of them as long
	 * as no marble came near its old or new pose before the snapshot.
	 */
	key: string;
}

export interface TPlanEvent {
	pieceId: string;
	definition: TPieceDefinition;
	params: Record<string, number>;
	/** Local control points of rails and tunnels */
	path: TVec2[];
	/** A drawn Rail's further paths */
	extraPaths: TVec2[][] | undefined;
	/** How a Rail gets its paths */
	railLayout: TRailLayout | undefined;
	angle: number;
	contactAt: number;
	/** When the piece is placed: the hit time, plus the entry delay for follower rails and tunnels */
	time: number;
	hitTime: number;
	/** Position among all hits, marble by marble: settles equal times */
	hitOrder: number;
	step: number;
	/** Index into `TPlan.marbles`, -1 when the marble has no marble */
	marbleIndex: number;
	/** Anchored or scenery: follows the trajectory without sounding its hit */
	isAnchor: boolean;
	/** Pose origin relative to the marble at the event, for anchors that keep their pose */
	offset: TVec2 | null;
	/** The ride this piece gives while the marble enters at about the same speed */
	ride: TRide | null;
	/** How the marble leaves this platform while it comes out near that */
	leaves: { velocity: TVec2; spin: number } | null;
	/** Where the piece waits instead of following the marble */
	held: { dot: TVec2; velocity: TVec2 | null } | null;
}

export function createPlan(project: TRunInput): TPlan {
	const hitTimes = new Map<string, number>();
	const hitOrder = new Map<string, number>();
	let nextHitOrder = 0;
	for (const marble of project.marbles) {
		for (const hit of marble.hits) {
			hitTimes.set(`${marble.id}/${hit.id}`, hit.time);
			hitOrder.set(`${marble.id}/${hit.id}`, nextHitOrder++);
		}
	}

	const marbles: TPlanMarble[] = project.marbles.map((marble) => ({
		marbleId: marble.id,
		radius: marble.radius,
		release: marble.start.position,
		releaseVelocity: marble.start.velocity ?? { x: 0, y: 0 },
		releaseSpin: marble.start.spin ?? 0,
		releaseTime: marble.start.time,
		releaseStep: Math.ceil(marble.start.time * PHYSICS_HZ - STEP_EPSILON)
	}));

	const staticPieces: TStaticPiece[] = [];
	const events: TPlanEvent[] = [];
	const linkedHitTimes = new Map<string, number | null>();
	const defaultRadius = marbles[0]?.radius ?? DEFAULT_MARBLE_RADIUS;
	for (const piece of project.track.pieces) {
		const tie = tieOf(piece);
		const definition = getPieceDefinition(piece.type);
		if (definition == null) continue;
		const params = resolvePieceParams(piece.type, piece.params);
		const path = resolvePiecePath(piece.type, piece.path?.points);

		if (tie != null) {
			const time = hitTimes.get(`${tie.marbleId}/${tie.hitId}`) ?? null;
			linkedHitTimes.set(piece.id, time);
			const marbleIndex = marbles.findIndex((marble) => marble.marbleId === tie.marbleId);
			if (time == null) continue;
			// Anchored pieces and scenery follow the trajectory at their hit time plus their entry delay
			const isAnchor = !soundsHit(piece.type, tie);
			const eventTime = time + (isAnchor ? (params['entryDelay'] ?? 0) : 0);
			events.push({
				pieceId: piece.id,
				definition,
				params,
				path,
				extraPaths: piece.path?.paths,
				railLayout: piece.layout,
				angle: piece.angle,
				contactAt: tie.contactAt ?? 0.5,
				time: eventTime,
				hitTime: time,
				hitOrder: hitOrder.get(`${tie.marbleId}/${tie.hitId}`) ?? 0,
				step: Math.floor(eventTime * PHYSICS_HZ + STEP_EPSILON),
				marbleIndex,
				isAnchor,
				offset: tie.kind === 'follows' ? (tie.offset ?? null) : null,
				ride: piece.ride != null && hasRide(piece.type) && piece.ride.key === rideKey(piece) ? piece.ride : null,
				held: tie.held ?? null,
				leaves: tie.kind === 'plays' && tie.leaves != null && tie.leaves.angle === piece.angle && tie.leaves.bounce === params['bounce'] ? { velocity: tie.leaves.velocity, spin: tie.leaves.spin } : null
			});
			continue;
		}

		const freeAt = freePosition(piece) ?? { x: 0, y: 0 };
		const layout = layoutFree(
			{
				type: piece.type,
				params,
				path,
				extraPaths: piece.path?.paths,
				layout: piece.layout,
				angle: piece.angle,
				contactAt: 0.5,
				marbleRadius: defaultRadius
			},
			freeAt
		);
		const resolved = resolvedFromLayout(piece.id, piece.type, params, layout, null, 'free', piece.layout);
		resolved.position = freeAt;
		staticPieces.push({ pieceId: piece.id, definition, params, layout, resolved, key: '' });
	}
	// Equal times go by marble, then hit: IDs are random, so ordering by them gives one song different tracks
	events.sort((a, b) => a.time - b.time || a.hitOrder - b.hitOrder);

	const startStep = Math.min(0, ...marbles.map((marble) => marble.releaseStep));
	const gravity = gravityOf(project);
	const endStep = Math.floor(project.length * PHYSICS_HZ + STEP_EPSILON);

	let staticLowY = Infinity;
	for (const piece of staticPieces) {
		staticLowY = Math.min(staticLowY, lowPointOf(piece.layout));
		if (piece.layout.rotor == null)
			piece.key = signature(
				JSON.stringify([piece.pieceId, piece.definition.type, piece.params, piece.layout.shapes])
			);
	}

	// Each key covers everything that determines the world up to the event: marbles, windmills, every
	// earlier event and the step the event is processed at. Parkable static pieces are checked on resume.
	let chain = signature(
		JSON.stringify([
			SIGNATURE_VERSION,
			gravity,
			startStep,
			marbles,
			staticPieces
				.filter((piece) => piece.key === '')
				.map((piece) => [
					piece.pieceId,
					piece.definition.type,
					piece.params,
					piece.layout.shapes,
					piece.layout.rotor
				])
		])
	);
	const eventKeys: string[] = [];
	for (const event of events) {
		eventKeys.push(signature(`${chain}|${event.step}`));
		chain = signature(
			`${chain}|${JSON.stringify([
				event.pieceId,
				event.definition.type,
				event.params,
				event.path,
				event.extraPaths,
				event.railLayout,
				event.angle,
				event.contactAt,
				event.time,
				event.marbleIndex,
				event.isAnchor,
				event.offset,
				event.ride != null ? rideHash(event.ride) : null,
				event.leaves,
				event.held
			])}`
		);
	}

	return {
		gravity,
		startStep,
		endStep,
		marbles,
		staticPieces,
		staticLowY,
		events,
		eventKeys,
		linkedHitTimes
	};
}

export function lowPointOf(layout: TPieceLayout): number {
	return layout.box != null ? layout.box.cy : shapesBounds(layout.shapes).minY;
}

export function resolvedFromLayout(
	pieceId: string,
	type: string,
	params: Record<string, number>,
	layout: TPieceLayout,
	hitTime: number | null,
	status: TResolvedPiece['status'],
	railLayout: TRailLayout | undefined
): TResolvedPiece {
	const resolved: TResolvedPiece = {
		pieceId,
		type,
		...(railLayout != null ? { layout: railLayout } : {}),
		position: layout.position,
		angle: layout.angle,
		params,
		contactPoint: layout.contactPoint,
		contactNormal: layout.contactNormal,
		hitTime,
		status
	};
	if (layout.box == null) resolved.shapes = layout.shapes;
	if (layout.path != null) resolved.path = layout.path;
	if (layout.paths != null) resolved.paths = layout.paths;
	return resolved;
}

// Signatures

/** Two cyrb53 string hashes, with seeds 0 and 1, computed in one pass over the text */
function signature(text: string): string {
	let a1 = 0xdeadbeef;
	let a2 = 0x41c6ce57;
	let b1 = 0xdeadbeef ^ 1;
	let b2 = 0x41c6ce57 ^ 1;
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		a1 = Math.imul(a1 ^ code, 2654435761);
		a2 = Math.imul(a2 ^ code, 1597334677);
		b1 = Math.imul(b1 ^ code, 2654435761);
		b2 = Math.imul(b2 ^ code, 1597334677);
	}
	return `${bowlHash53(a1, a2)}${bowlHash53(b1, b2)}`;
}

function bowlHash53(h1: number, h2: number): string {
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(11, '0');
}
