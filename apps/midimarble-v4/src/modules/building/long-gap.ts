import type { TProject } from '@/modules/project';
import { GRAVITY_Y, gravityOf, paceRate } from '@/modules/simulation';

const EARTH = -GRAVITY_Y;

/**
 * Highest a bounce may rise above its takeoff at Earth's gravity before the gap counts as long and needs a
 * holder. It scales with the project's gravity, like every height at a given rhythm: the pace drop per hit
 * and so the spacing of a marble's earlier pieces above the marble shrink with gravity, and a fixed 0.4 m
 * bounce at half gravity rose through the two pieces above it.
 */
export const MAX_BOUNCE_RISE = 0.4;
/**
 * Upward takeoff speed after a hit that brings the marble to height `targetY` after `interval` seconds of
 * free flight from `fromY`, under a downward acceleration `g` (Earth's by default)
 */
export function takeoffSpeed(fromY: number, targetY: number, interval: number, g = EARTH): number {
	return (targetY - fromY + (g * interval * interval) / 2) / interval;
}

/**
 * Interval above which one bounce at the project's pace rises higher than `MAX_BOUNCE_RISE`, scaled with
 * gravity, above its takeoff, so the gap needs a holder or rail. Between 0.6 and 2 seconds. Since the rise,
 * the pace and the column spacing all scale with gravity, the threshold depends on the rhythm alone.
 */
export function longGapThreshold(project: TProject): number {
	const rate = paceRate(project);
	const g = -gravityOf(project);
	const rise = (MAX_BOUNCE_RISE * g) / EARTH;
	const interval = (2 * (Math.sqrt(2 * g * rise) + rate)) / g;
	return Math.min(2, Math.max(0.6, Math.round(interval * 1000) / 1000));
}
