import type { TProject, TVec2 } from '@/modules/project';
import { GRAVITY_Y, gravityOf } from './geometry';
import { platformDefinition } from './pieces';

// Shared descent pace. Every marble of a project should stay near one height curve y*(t) that falls at a
// constant rate, so a camera following that curve keeps every marble in frame. The rate comes from the
// marbles' rhythm: it is the steady descent of the default platform bounce at the median hit interval.

export interface TDescentPace {
	/** Descent rate in meters per second */
	rate: number;
	/** y*(t) = anchorY − rate · (t − anchorTime). The anchor is the earliest hit dot of any marble. */
	anchorTime: number;
	anchorY: number;
	/** Assists keep hit dots within this distance of y*, or no further than they already are */
	limit: number;
}

/** How far from y* the assists place a dot by default; a person's edit may go anywhere */
export const PACE_LIMIT = 0.25;
/**
 * Highest a bounce may rise above its takeoff at Earth's gravity before the gap counts as long and needs a
 * holder. It scales with the project's gravity, like every height at a given rhythm: the pace drop per hit
 * and so the spacing of a marble's earlier pieces above the marble shrink with gravity, and a fixed 0.4 m
 * bounce at half gravity rose through the two pieces above it.
 */
export const MAX_BOUNCE_RISE = 0.4;
// The range of descent, in meters per second, Next and Build Track aim for: only what they aim at, never a limit on a person's edit
const MIN_DEFAULT_RATE = 0.15;
const MAX_DEFAULT_RATE = 0.8;
// Intervals longer than this are long notes, not the rhythm
const RHYTHM_INTERVAL = 0.8;
const DEFAULT_INTERVAL = 0.3;
const EARTH = -GRAVITY_Y;

/**
 * Least height between the top of a bounce at the pace and the piece two hits back, the one a zigzag
 * passes under on its way to the next piece of that column. The default bounce at full gravity and a 0.5 s
 * rhythm leaves 7 cm; at half gravity it left 3.5 cm, and the marbles struck those pieces.
 */
export const COLUMN_CLEARANCE = 0.065;

/**
 * Descent rate for the project: (1 − e) / (1 + e) · g · T / 2 for the project's gravity g, the default platform bounce e and the
 * median interval T between consecutive hits of all marbles, ignoring long notes. A single regular marble
 * therefore keeps the descent its default bounce gives, and marbles with different rhythms share one.
 *
 * With several marbles the rate is at least `columnRate`, so a zigzag at the pace keeps `COLUMN_CLEARANCE`
 * under its earlier pieces. Every height at a rhythm scales with gravity but the pieces do not, so at low
 * gravity or fast rhythms the default bounce stacks the pieces of a narrow marble too densely.
 */
export function paceRate(project: TProject): number {
	const intervals: number[] = [];
	for (const marble of project.marbles) {
		for (let i = 1; i < marble.hits.length; i++) {
			const interval = (marble.hits[i]?.time ?? 0) - (marble.hits[i - 1]?.time ?? 0);
			if (interval > 0.05 && interval <= RHYTHM_INTERVAL) intervals.push(interval);
		}
	}
	intervals.sort((a, b) => a - b);
	const middle = intervals.length / 2;
	const median = intervals.length
		? intervals.length % 2 === 1
			? (intervals[Math.floor(middle)] ?? DEFAULT_INTERVAL)
			: ((intervals[middle - 1] ?? 0) + (intervals[middle] ?? 0)) / 2
		: DEFAULT_INTERVAL;
	const bounce = platformDefinition.params['bounce']?.default ?? 0.65;
	const g = -gravityOf(project);
	const marbles = project.marbles.length;
	const rate = Math.max(
		(((1 - bounce) / (1 + bounce)) * g * median) / 2,
		marbles > 1 ? columnRate(median, g) : 0
	);
	return Math.min(MAX_DEFAULT_RATE, Math.max(MIN_DEFAULT_RATE, rate));
}

/**
 * Least descent rate at which bounces every `interval` seconds keep `COLUMN_CLEARANCE` under the piece two
 * hits back. With a drop d per hit and k = g·T²/2 a bounce rises r = (k − d)² / 4k above its piece, which
 * lies d below the piece two hits back, so d − r = clearance gives d = 3k − √(8k² − 4k · clearance).
 */
export function columnRate(interval: number, g = EARTH): number {
	if (interval <= 0) return 0;
	const k = (g * interval * interval) / 2;
	const drop = 3 * k - Math.sqrt(Math.max(0, 8 * k * k - 4 * k * COLUMN_CLEARANCE));
	return drop / interval;
}

/** The pace of a project, anchored at its earliest hit that has a dot; null without one */
export function descentPace(
	project: TProject,
	hits: { targetTime: number; dot: TVec2 | null }[]
): TDescentPace | null {
	let anchor: { time: number; y: number } | null = null;
	for (const hit of hits) {
		if (hit.dot == null) continue;
		if (anchor == null || hit.targetTime < anchor.time - 1e-9)
			anchor = { time: hit.targetTime, y: hit.dot.y };
	}
	if (anchor == null) return null;
	return { rate: paceRate(project), anchorTime: anchor.time, anchorY: anchor.y, limit: PACE_LIMIT };
}

/** y*(t) */
export function paceAt(pace: TDescentPace, time: number): number {
	return pace.anchorY - pace.rate * (time - pace.anchorTime);
}

export interface TDescentPoint {
	time: number;
	y: number;
}

/** y*(t) sampled every half second from `from` to `to`, both included, for consumers that interpolate */
export function descentPoints(pace: TDescentPace, from: number, to: number): TDescentPoint[] {
	const step = 0.5;
	const points: TDescentPoint[] = [];
	const count = Math.max(1, Math.ceil((to - from) / step - 1e-9));
	for (let i = 0; i <= count; i++) {
		const time = Math.min(to, from + i * step);
		points.push({ time, y: paceAt(pace, time) });
	}
	return points;
}

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
