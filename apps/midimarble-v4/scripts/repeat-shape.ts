// How alike a repeated stretch comes out against its first time, as a viewer sees it: the same shape, or its mirror
// image. A Zigzag that comes back the other way round is the same Zigzag. For the build table; nothing in the app reads it.
import { hitOwners } from '../src/modules/building';
import { repeatedStretches, STRETCH } from '../src/modules/building/repeats';
import type { TProject } from '../src/modules/project';
import type { TSimulationResult } from '../src/modules/simulation';

const DEGREE = Math.PI / 180;
/**
 * Two platforms in the same place of a stretch look alike when their tilts differ by this much at most, in degrees.
 * A viewer compares them seconds apart with the camera moving, not side by side, and slanted lines are told apart
 * less finely than level ones. The builder's turns come in 3° steps, so 5° lets one step through and not two, and the
 * builds agree: of 511 repeated platforms in the 16 one-marble and two-marble builds at `5397b211`, 376 differ by 5° or
 * less and only one more by 6°.
 */
export const ALIKE_TILT = 5;

/** An angle brought into -π to π */
function wrapped(angle: number): number {
	return ((((angle + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
}

export interface TRepeatShape {
	pairs: number;
	/** Share of platforms within `ALIKE_TILT` of their place the first time, each stretch as it is or mirrored, whichever is closer */
	alike: string | null;
	/** How many stretches came back mirrored */
	mirrored: number;
	/** Median distance of each dot from its place the first time, from the stretch's first dot, in cm, mirrored the same way */
	apartCm: number | null;
}

/**
 * Each repeated stretch (`repeatedStretches`) against its first time. A stretch counts as mirrored when its tilts are
 * closer to the first time's turned the other way round (angle to minus angle, and the dots' sideways offsets with
 * them); a whole stretch is mirrored or not, never single platforms in it.
 */
export function repeatShape(project: TProject, result: TSimulationResult): TRepeatShape {
	let pairs = 0;
	let mirrored = 0;
	const tilts: number[] = [];
	const offsets: number[] = [];
	for (const marble of project.marbles) {
		const { hits } = marble;
		const owners = hitOwners(project, marble.id);
		const dotOf = (index: number) => result.hits.find((hit) => hit.marbleId === marble.id && hit.hitId === hits[index]?.id)?.dot ?? null;
		for (const { first, again } of repeatedStretches(project, marble.id)) {
			pairs++;
			const angles: [number, number][] = [];
			for (let index = 0; index < STRETCH; index++) {
				const [a, b] = [owners.get(hits[first + index]?.id ?? ''), owners.get(hits[again + index]?.id ?? '')];
				if (a?.type === 'platform' && b?.type === 'platform') angles.push([a.angle, b.angle]);
			}
			const straight = angles.map(([a, b]) => Math.abs(wrapped(a - b)) / DEGREE);
			const mirror = angles.map(([a, b]) => Math.abs(wrapped(a + b)) / DEGREE);
			const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
			const isMirrored = sum(mirror) < sum(straight);
			if (isMirrored) mirrored++;
			tilts.push(...(isMirrored ? mirror : straight));
			const side = isMirrored ? -1 : 1;
			const [a0, b0] = [dotOf(first), dotOf(again)];
			for (let index = 1; index < STRETCH; index++) {
				const [da, db] = [dotOf(first + index), dotOf(again + index)];
				if (a0 != null && b0 != null && da != null && db != null) offsets.push(Math.hypot(da.x - a0.x - side * (db.x - b0.x), da.y - a0.y - (db.y - b0.y)) * 100);
			}
		}
	}
	const median = (values: number[]): number | null => (values.length ? Number(([...values].sort((x, y) => x - y)[Math.floor(values.length / 2)] ?? 0).toFixed(1)) : null);
	return { pairs, alike: tilts.length ? `${Math.round((tilts.filter((value) => value <= ALIKE_TILT).length / tilts.length) * 100)}%` : null, mirrored, apartCm: median(offsets) };
}
