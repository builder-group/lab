import { createId, LANE_SPACING, type TEntity, type TProject, type TVec2 } from '@/modules/project';
import { nextPieceName } from './piece-names';
import { getPieceDefinition, type TRailLayout } from './pieces';

const DEFAULT_TILT = (15 * Math.PI) / 180;
// Dots closer than this to the frame centre lean against the horizontal motion instead
const CENTRE_DEADBAND = 0.02;
// Half width of a lane's band with several marbles: two columns of default bars at least a bar and a
// clearance apart, with half a bar to spare at each side
const LANE_HALF_WIDTH = 0.13;

/**
 * Default surface angle for a new piece at a hit dot. The surface tilts by 15° so its normal leans toward
 * the frame centre. Near the centre it leans against the current horizontal motion, which turns the
 * marble back. A positive angle leans the normal to the left.
 */
export function defaultPlatformAngle(
	dot: TVec2,
	velocity: TVec2 | null,
	frameCenterX: number
): number {
	const offset = dot.x - frameCenterX;
	if (Math.abs(offset) > CENTRE_DEADBAND) return offset > 0 ? DEFAULT_TILT : -DEFAULT_TILT;
	return (velocity?.x ?? 0) >= 0 ? DEFAULT_TILT : -DEFAULT_TILT;
}

export interface TCreateLinkedPieceOptions {
	/** How a Rail gets its paths */
	layout?: TRailLayout;
	/** Existing entities, used to number the name */
	entities?: TEntity[];
	id?: string;
	/** Where along it the marble strikes, the middle by default */
	contactAt?: number;
}

/** A piece bound to a hit, with default parameters and its contact in the middle of the surface */
export function createLinkedPiece(
	type: string,
	laneId: string,
	hitId: string,
	angle: number,
	options: TCreateLinkedPieceOptions = {}
): TEntity {
	const { entities = [], id = createId('piece') } = options;
	const definition = getPieceDefinition(type);
	const params: Record<string, number> = {};
	for (const [name, spec] of Object.entries(definition?.params ?? {})) params[name] = spec.default;
	return {
		id,
		name: nextPieceName(type, entities),
		components: {
			piece: { type, ...(options.layout != null ? { layout: options.layout } : {}), params },
			hitLink: { laneId, hitId, angle, contactAt: options.contactAt ?? 0.5 }
		}
	};
}

export interface TFrameBand {
	centerX: number;
	halfWidth: number;
}

/**
 * Horizontal band the run should stay within. With one marble it is the film frame: 0.45 m wide at 9:16 for
 * the camera's original 0.65 m distance, scaled with the project's aspect and camera distance (0.59 m at the
 * 0.85 m default of new projects), centred on the marble's release. With several marbles each lane gets a
 * band `2 · LANE_HALF_WIDTH` wide, room for a zigzag of the default kit, and the lanes sit `LANE_SPACING`
 * apart in the order of their releases from left to right, centred on the mean release. `laneId` picks a lane's
 * band, which is only where the marble prefers to stay: a marble may cross another's path as long as it touches
 * neither that marble nor its pieces, which the assists check by simulation. Without it the band covering every lane
 * is returned, the limit every placement stays inside so the run stays in frame.
 */
/** The ID of the Rail a marble starts on: Build Track makes it, tied to no hit, and it stays the marble's in Layers */
export function startRailId(laneId: string): string {
	return `start-rail-${laneId}`.slice(0, 64);
}

/** The Rail this marble starts on, if it still has one */
export function startRailOf(project: TProject, laneId: string): TEntity | undefined {
	const id = startRailId(laneId);
	return project.entities.find((entity) => entity.id === id);
}

export function frameBand(project: TProject, laneId?: string): TFrameBand {
	const aspect = project.frame.width / project.frame.height;
	const distance = project.design.camera.distance;
	const width = 0.45 * (aspect / (9 / 16)) * (distance > 0 ? distance / 0.65 : 1);
	// A marble waiting on its start rail lands `laneOffset` from where it is released, and its lane lies there
	const releaseX = (entity: TEntity): number => {
		const x = entity.components.release?.position.x ?? 0;
		const rail = startRailOf(project, entity.components.marble?.laneId ?? '')?.components;
		return rail?.transform != null && Math.abs(rail.transform.position.x - x) < 0.02 ? x + (rail.piece?.params['laneOffset'] ?? 0) : x;
	};
	const marbles = project.entities.filter(
		(entity) => entity.components.marble != null && entity.components.release != null
	);
	if (marbles.length <= 1) {
		const marble = project.entities.find((entity) => entity.components.marble != null);
		return { centerX: marble != null ? releaseX(marble) : 0, halfWidth: width / 2 };
	}
	const centerX = marbles.reduce((sum, entity) => sum + releaseX(entity), 0) / marbles.length;
	const ordered = marbles
		.map((entity, index) => ({ entity, index }))
		.sort((a, b) => releaseX(a.entity) - releaseX(b.entity) || a.index - b.index);
	const slot = ordered.findIndex((item) => item.entity.components.marble?.laneId === laneId);
	const span = (marbles.length - 1) * LANE_SPACING;
	// With several marbles the camera moves back for the group, so the whole band is at least the film frame
	if (laneId == null || slot < 0) return { centerX, halfWidth: Math.max(span / 2 + LANE_HALF_WIDTH, width / 2) };
	return { centerX: centerX - span / 2 + slot * LANE_SPACING, halfWidth: LANE_HALF_WIDTH };
}
