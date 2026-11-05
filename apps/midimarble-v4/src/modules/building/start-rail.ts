import type { TEntity, TProject, TVec2 } from '@/modules/project';
import { gravityOf, nextPieceName, railLayoutInfo, resolvePieceParams, startRailId } from '@/modules/simulation';

// Start on a Rail: Build Track puts a short rail at each marble's release, so the marble rolls into its first hit
// instead of dropping. It is a normal Rail tied to nothing, which anyone can delete. The marble then falls as long as one
// released without a rail, so it strikes its first note as firmly, so the release moves earlier by the time the rail
// takes, and back along the rail so the note lands where it would have. The rail keeps that distance as `laneOffset`,
// since the lane lies where the marble lands (`frameBand`).

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
/** Room beyond the marble between the run's end and the stop */
const STOP_ROOM = 0.006;
/** How far a marble drifts back from the stop as it falls to its note, at Jingle Bells' half gravity */
const STOP_DRIFT = 0.02;
/** Between the resting marble and the wire, so it doesn't start inside it */
const CLEARANCE = 0.0005;
/** Rolling acceleration of a ball on a slope, g · sin(slope) times this */
const ROLLING = 5 / 7;

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
 * soon even from the film's start, or it starts with a speed of its own that a person gave it.
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
		// Every rail runs the same way: the marbles start side by side and the camera opens on all of them
		const placed = startRail(entities, lane.id, marble.components.marble.radius, plan.slope);
		const position: TVec2 = { x: Math.round((release.position.x - placed.reach) * 1e4) / 1e4, y: release.position.y };
		const moved: TEntity = { ...marble, components: { ...marble.components, release: { ...release, position, time: Math.round((first.time - lead) * 1e4) / 1e4 } } };
		entities = [...entities.map((entity) => (entity === marble ? moved : entity)), placed.at(position)];
	}
	return entities === project.entities ? project : { ...project, entities };
}

/**
 * A rail under a marble at its release, with a short stop past its end: the marble rolls off the run, meets the stop and
 * drops, so it falls almost straight onto its first note, as one released without a rail does and a Switchback lets it
 * go. `reach` is how far along x from the release that fall lies.
 */
function startRail(entities: TEntity[], laneId: string, marbleRadius: number, slope: number): { reach: number; at: (marble: TVec2) => TEntity } {
	const params = resolvePieceParams('rail', {});
	const radius = params['radius'] ?? 0.00375;
	const onWire = marbleRadius + radius;
	const round = (value: number): number => Math.round(value * 1e5) / 1e5;
	const kept: Record<string, number> = {};
	for (const name of railLayoutInfo.path.params) kept[name] = params[name] ?? 0;
	const [cos, sin] = [Math.cos(slope), Math.sin(slope)];
	const gap = 2 * onWire + STOP_ROOM;
	// World offsets from the run's end to local coordinates of the rail, which is turned by -slope
	const local = (dx: number, dy: number): TVec2 => ({ x: round(ROLL_LENGTH + dx * cos - dy * sin), y: round(dx * sin + dy * cos) });
	const toFall = ROLL_LENGTH * cos - (onWire + CLEARANCE) * sin + gap - onWire - STOP_DRIFT;
	return {
		reach: toFall,
		at: (marble) => ({
			id: startRailId(laneId),
			name: nextPieceName('rail', entities),
			components: {
				piece: { type: 'rail', params: { ...kept, laneOffset: round(toFall) } },
				transform: { position: { x: round(marble.x - sin * (onWire + CLEARANCE)), y: round(marble.y - cos * (onWire + CLEARANCE)) }, angle: round(-slope) },
				path: {
					points: [{ x: -BACK_LENGTH, y: 0 }, { x: 0, y: 0 }, { x: ROLL_LENGTH, y: 0 }],
					paths: [[local(gap, 2 * onWire), local(gap, -2 * marbleRadius)]]
				}
			}
		})
	};
}
