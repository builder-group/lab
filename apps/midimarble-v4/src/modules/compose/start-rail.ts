import type { TEntity, TProject, TVec2 } from '@/modules/project';
import { columnOffset, gravityOf, nextPieceName, railLayoutInfo, resolvePieceParams } from '@/modules/simulation';

// Start on a Rail: Build Track puts a short rail at each marble's release, so the marble rolls into its first hit
// instead of dropping. It is a normal Rail tied to nothing, which anyone can delete. The marble then falls as long as one
// released without a rail, so it strikes its first note as firmly, so the release moves earlier by the time the rail
// takes, and back along the rail so the note lands on the near column of its lane.

const DEGREE = Math.PI / 180;
/** The shortest and steepest a start rail gets: gentler or shorter and the leave time stops following the formula */
const MIN_SLOPE = 10 * DEGREE;
const MAX_SLOPE = 25 * DEGREE;
const ROLL_LENGTH = 0.06;
/** Rail behind the marble */
const BACK_LENGTH = 0.012;
/** Seconds the marble is in the air before its first note, so the note is a strike */
const MIN_FALL = 0.12;
/** Seconds it falls when there's time, as a marble released without a rail falls after import: what the track's first bounces are built on */
const FALL = 0.5;
/** Between the resting marble and the wire, so it doesn't start inside it */
const CLEARANCE = 0.0005;
/** Rolling acceleration of a ball on a slope, g · sin(slope) times this */
const ROLLING = 5 / 7;

export function startRailId(laneId: string): string {
	return `start-rail-${laneId}`.slice(0, 64);
}

/** How long a rail at `slope` takes to roll the marble off */
function rollTime(slope: number, gravity: number): number {
	return Math.sqrt((2 * ROLL_LENGTH) / (ROLLING * gravity * Math.sin(slope)));
}

/**
 * The slope and the fall after it, given how long there is before the note and how long the marble asks to fall: the
 * gentlest slope that fits that fall, else the steepest with the fall that's left; null when the fall gets too short.
 */
export function startRailPlan(lead: number, gravity: number, fall: number): { slope: number; fall: number } | null {
	const sine = (2 * ROLL_LENGTH) / (ROLLING * gravity * Math.max(1e-6, lead - fall) ** 2);
	if (lead > fall && sine <= Math.sin(MAX_SLOPE)) return { slope: Math.max(MIN_SLOPE, Math.asin(sine)), fall };
	const left = lead - rollTime(MAX_SLOPE, gravity);
	return left >= MIN_FALL ? { slope: MAX_SLOPE, fall: left } : null;
}

/**
 * The project with a start rail at the release of each of these marbles, unless it has one, or its first note comes too
 * soon even from the film's start, or it starts with a speed of its own that a person gave it. Each rail runs toward the
 * frame's middle.
 */
export function withStartRails(project: TProject, laneIds: ReadonlySet<string>): TProject {
	const gravity = -gravityOf(project);
	let entities = project.entities;
	for (const lane of project.music.lanes) {
		const [first] = lane.hits;
		const marble = entities.find((entity) => entity.components.marble?.laneId === lane.id);
		const release = marble?.components.release;
		if (first == null || marble?.components.marble == null || release == null || !laneIds.has(lane.id)) continue;
		if (entities.some((entity) => entity.id === startRailId(lane.id))) continue;
		if (release.velocity != null && (release.velocity.x !== 0 || release.velocity.y !== 0)) continue;
		// As early as it needs, but no later than the person's release and not before the film starts
		const lead = Math.min(first.time, Math.max(first.time - release.time, rollTime(MIN_SLOPE, gravity) + FALL));
		const plan = startRailPlan(lead, gravity, FALL);
		if (plan == null) continue;
		const direction = release.position.x > 0 ? -1 : 1;
		const speed = ROLLING * gravity * Math.sin(plan.slope) * rollTime(plan.slope, gravity);
		const travel = (ROLL_LENGTH + speed * plan.fall) * Math.cos(plan.slope);
		// The note lands on the column the marble comes from, so it carries on across the lane as a zigzag does
		const column = columnOffset(resolvePieceParams('platform', {})['length'] ?? 0.09);
		const position: TVec2 = { x: Math.round((release.position.x - direction * (travel + column)) * 1e4) / 1e4, y: release.position.y };
		const moved: TEntity = { ...marble, components: { ...marble.components, release: { ...release, position, time: Math.round((first.time - lead) * 1e4) / 1e4 } } };
		entities = [...entities.map((entity) => (entity === marble ? moved : entity)), startRail(entities, lane.id, position, marble.components.marble.radius, plan.slope, direction)];
	}
	return entities === project.entities ? project : { ...project, entities };
}

function startRail(entities: TEntity[], laneId: string, marble: TVec2, marbleRadius: number, slope: number, direction: number): TEntity {
	const params = resolvePieceParams('rail', {});
	const reach = marbleRadius + (params['radius'] ?? 0.00375) + CLEARANCE;
	const round = (value: number): number => Math.round(value * 1e5) / 1e5;
	const kept: Record<string, number> = {};
	for (const name of railLayoutInfo.path.params) kept[name] = params[name] ?? 0;
	return {
		id: startRailId(laneId),
		name: nextPieceName('rail', entities),
		components: {
			piece: { type: 'rail', params: kept },
			transform: { position: { x: round(marble.x - Math.sin(slope) * direction * reach), y: round(marble.y - Math.cos(slope) * reach) }, angle: round(-direction * slope) },
			path: { points: [{ x: round(-direction * BACK_LENGTH), y: 0 }, { x: 0, y: 0 }, { x: round(direction * ROLL_LENGTH), y: 0 }] }
		}
	};
}
