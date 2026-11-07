import { createId, frameWidthAt, MARBLE_SPACING, type TPiece, type TProject, type TMarble, type TVec2, freePosition } from '@/modules/project';
import { nextPieceName } from './piece-names';
import { getPieceDefinition, hitPlace, type TRailLayout } from './pieces';

// Half width of a marble's band with several marbles: two columns of default bars at least a bar and a
// clearance apart, with half a bar to spare at each side
const MARBLE_HALF_WIDTH = 0.13;
// Frame widths a single marble's run may wander across: the camera pans with it. One frame leaves Long Rails no room in
// the reference's gaps, and 1.5 is what Build Track and Patterns are tuned on, 0.49 m at the default camera
const BAND_FRAMES = 1.5;

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

/** The ID of the Rail a marble starts on: Build Track makes it, tied to no hit, and it stays the marble's in Layers */
export function startRailId(marbleId: string): string {
	return `start-rail-${marbleId}`.slice(0, 64);
}

/** The Rail this marble starts on, if it still has one */
export function startRailOf(project: TProject, marbleId: string): TPiece | undefined {
	const id = startRailId(marbleId);
	return project.track.pieces.find((piece) => piece.id === id);
}

/**
 * Where a marble prefers to stay at height `y`, the release's height if none is given: the band's center is where to aim.
 * It follows the marble's guide line, straight down from the center below unless the marble stores a line. `simulate`
 * never reads this: the line is how the builder judges closeness, and a run only answers what happens.
 */
export function frameBand(project: TProject, marbleId: string, y?: number): TFrameBand {
	return bandAlongGuide(project, marbleId)(y ?? project.marbles[0]?.start.position.y ?? 0);
}

/** `frameBand` at any height, for what asks at many heights */
export function bandAlongGuide(project: TProject, marbleId: string): (y: number) => TFrameBand {
	const straight = straightBand(project, marbleId);
	const points = project.marbles.find((marble) => marble.id === marbleId)?.guide?.points;
	return points == null ? () => straight : (y) => ({ centerX: guideX(points, y), halfWidth: straight.halfWidth });
}

/**
 * The stage at height `y`: what every placement stays inside so the run stays in frame, and what a view fits around. With
 * one marble it is that marble's band. Never where to aim with several, as its center lies between them.
 */
export function stageBand(project: TProject, y?: number): TFrameBand {
	return stageAlongGuide(project)(y ?? project.marbles[0]?.start.position.y ?? 0);
}

/** `stageBand` at any height */
export function stageAlongGuide(project: TProject): (y: number) => TFrameBand {
	const straight = straightBand(project);
	const { marbles } = project;
	if (!marbles.some((marble) => marble.guide != null)) return () => straight;
	if (marbles.length === 1 && marbles[0] != null) return bandAlongGuide(project, marbles[0].id);
	// It stays around the marbles' mean, so it moves as far as they do on average
	const shifts = marbles.map((marble) => {
		const points = marble.guide?.points;
		const center = straightBand(project, marble.id).centerX;
		return (y: number): number => (points == null ? 0 : guideX(points, y) - center);
	});
	return (y) => ({ centerX: straight.centerX + shifts.reduce((sum, shift) => sum + shift(y), 0) / marbles.length, halfWidth: straight.halfWidth });
}

/** The line's x at a height: straight between its points, and straight down or up past its ends */
function guideX(points: readonly TVec2[], y: number): number {
	for (let index = 1; index < points.length; index++) {
		const [above, below] = [points[index - 1], points[index]];
		if (above == null || below == null) continue;
		if (y >= above.y) return above.x;
		if (y >= below.y) return above.x + ((below.x - above.x) * (above.y - y)) / (above.y - below.y);
	}
	return points.at(-1)?.x ?? 0;
}

/**
 * The band with no line stored. With one marble it is `BAND_FRAMES` film frames wide at the camera's distance, centered
 * on the marble's release. With several marbles each marble gets a band `2 · MARBLE_HALF_WIDTH` wide, room for a zigzag
 * of the default kit, and the marbles sit `MARBLE_SPACING` apart in the order of their releases from left to right,
 * centered on the mean release. `marbleId` picks a marble's band, which is only where the marble prefers to stay: a
 * marble may cross another's path as long as it touches neither that marble nor its pieces, which the assists check by
 * simulation. Without it the band covering every marble is returned.
 */
function straightBand(project: TProject, marbleId?: string): TFrameBand {
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
