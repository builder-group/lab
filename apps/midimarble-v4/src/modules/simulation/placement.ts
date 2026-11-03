import { createId, type TEntity, type TProject, type TVec2 } from '@/modules/project';
import { getPieceDefinition } from './pieces';

const DEFAULT_TILT = (15 * Math.PI) / 180;
// Dots closer than this to the frame centre lean against the horizontal motion instead
const CENTRE_DEADBAND = 0.02;

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
	/** Existing entities, used to number the name */
	entities?: TEntity[];
	id?: string;
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
	const count = entities.filter((entity) => entity.components.piece?.type === type).length;
	return {
		id,
		name: `${definition?.label ?? type} ${count + 1}`,
		components: {
			piece: { type, params },
			hitLink: { laneId, hitId, angle, contactAt: 0.5, pinned: false }
		}
	};
}

export interface TFrameBand {
	centerX: number;
	halfWidth: number;
}

/**
 * Horizontal band the run should stay within. The film frame is 0.45 m wide at 9:16 and scales with the
 * project's aspect, centred on the first marble's release.
 */
export function frameBand(project: TProject): TFrameBand {
	const aspect = project.frame.width / project.frame.height;
	const width = 0.45 * (aspect / (9 / 16));
	const release = project.entities.find((entity) => entity.components.marble != null)?.components
		.release;
	return { centerX: release?.position.x ?? 0, halfWidth: width / 2 };
}
