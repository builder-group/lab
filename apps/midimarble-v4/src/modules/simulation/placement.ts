import { createId, frameWidthAt, MARBLE_SPACING, type TPiece, type TProject, type TVec2, type TMarble, freePosition } from '@/modules/project';
import { nextPieceName } from './piece-names';
import { getPieceDefinition, hitPlace, type TRailLayout } from './pieces';

const DEFAULT_TILT = (15 * Math.PI) / 180;
// Dots closer than this to the frame center lean against the horizontal motion instead
const CENTER_DEADBAND = 0.02;
// Half width of a marble's band with several marbles: two columns of default bars at least a bar and a
// clearance apart, with half a bar to spare at each side
const MARBLE_HALF_WIDTH = 0.13;
// Frame widths a single marble's run may wander across: the camera pans with it. One frame leaves Long Rails no room in
// the reference's gaps, and 1.5 is what Build Track and Patterns are tuned on, 0.49 m at the default camera
const BAND_FRAMES = 1.5;

/**
 * Default surface angle for a new piece at a hit dot. The surface tilts by 15° so its normal leans toward
 * the frame center. Near the center it leans against the current horizontal motion, which turns the
 * marble back. A positive angle leans the normal to the left.
 */
export function defaultPlatformAngle(
	dot: TVec2,
	velocity: TVec2 | null,
	frameCenterX: number
): number {
	const offset = dot.x - frameCenterX;
	if (Math.abs(offset) > CENTER_DEADBAND) return offset > 0 ? DEFAULT_TILT : -DEFAULT_TILT;
	return (velocity?.x ?? 0) >= 0 ? DEFAULT_TILT : -DEFAULT_TILT;
}

export interface TCreateLinkedPieceOptions {
	/** How a Rail gets its paths */
	layout?: TRailLayout;
	/** Existing pieces, used to number the name */
	pieces?: TPiece[];
	id?: string;
	/** Where along it the marble strikes, the middle by default */
	contactAt?: number;
}

/** A piece bound to a hit, with default parameters and its contact in the middle of the surface */
export function createLinkedPiece(
	type: string,
	marbleId: string,
	hitId: string,
	angle: number,
	options: TCreateLinkedPieceOptions = {}
): TPiece {
	const { pieces: pieces = [], id = createId('piece') } = options;
	const definition = getPieceDefinition(type);
	const params: Record<string, number> = {};
	for (const [name, spec] of Object.entries(definition?.params ?? {})) params[name] = spec.default;
	return {
		id,
		name: nextPieceName(type, pieces),
		type,
		...(options.layout != null ? { layout: options.layout } : {}),
		params,
		angle,
		place: hitPlace(type, marbleId, hitId, options.contactAt)
	};
}

export interface TFrameBand {
	centerX: number;
	halfWidth: number;
}

/**
 * Horizontal band the run should stay within. With one marble it is `BAND_FRAMES` film frames wide at the camera's
 * distance, centered on the marble's release. With several marbles each marble gets a
 * band `2 · MARBLE_HALF_WIDTH` wide, room for a zigzag of the default kit, and the marbles sit `MARBLE_SPACING`
 * apart in the order of their releases from left to right, centered on the mean release. `marbleId` picks a marble's
 * band, which is only where the marble prefers to stay: a marble may cross another's path as long as it touches
 * neither that marble nor its pieces, which the assists check by simulation. Without it the band covering every marble
 * is returned, the limit every placement stays inside so the run stays in frame.
 */
/** The ID of the Rail a marble starts on: Build Track makes it, tied to no hit, and it stays the marble's in Layers */
export function startRailId(marbleId: string): string {
	return `start-rail-${marbleId}`.slice(0, 64);
}

/** The Rail this marble starts on, if it still has one */
export function startRailOf(project: TProject, marbleId: string): TPiece | undefined {
	const id = startRailId(marbleId);
	return project.track.pieces.find((piece) => piece.id === id);
}

export function frameBand(project: TProject, marbleId?: string): TFrameBand {
	const width = BAND_FRAMES * frameWidthAt(project.film.camera.distance, project.format.width / project.format.height);
	// A marble waiting on its start rail lands `landingOffset` from where it is released, and its column lies there
	const releaseX = (marble: TMarble): number => {
		const x = marble.start.position.x;
		const rail = startRailOf(project, marble.id);
		const railX = freePosition(rail)?.x;
		return railX != null && Math.abs(railX - x) < 0.02 ? x + (rail?.params['landingOffset'] ?? 0) : x;
	};
	const { marbles } = project;
	if (marbles.length <= 1) {
		const marble = project.marbles[0];
		return { centerX: marble != null ? releaseX(marble) : 0, halfWidth: width / 2 };
	}
	const centerX = marbles.reduce((sum, marble) => sum + releaseX(marble), 0) / marbles.length;
	const ordered = marbles
		.map((marble, index) => ({ marble, index }))
		.sort((a, b) => releaseX(a.marble) - releaseX(b.marble) || a.index - b.index);
	const slot = ordered.findIndex((item) => item.marble.id === marbleId);
	const span = (marbles.length - 1) * MARBLE_SPACING;
	// With several marbles the camera moves back for the group, so the whole band is at least the film frame
	if (marbleId == null || slot < 0) return { centerX, halfWidth: Math.max(span / 2 + MARBLE_HALF_WIDTH, width / 2) };
	return { centerX: centerX - span / 2 + slot * MARBLE_SPACING, halfWidth: MARBLE_HALF_WIDTH };
}
