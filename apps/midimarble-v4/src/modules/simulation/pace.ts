import type { TProject, TVec2 } from '@/modules/project';
import { GRAVITY_Y, gravityOf } from './geometry';
import { platformDefinition } from './pieces';

// Shared descent pace. Every marble of a project should stay near one height curve y*(t) that falls at a
// constant rate, so a camera following that curve keeps every marble in frame. The rate comes from the
// lanes' rhythm: it is the steady descent of the default platform bounce at the median hit interval.

export interface TDescentPace {
	/** Descent rate in metres per second */
	rate: number;
	/** y*(t) = anchorY − rate · (t − anchorTime). The anchor is the earliest hit dot of any lane. */
	anchorTime: number;
	anchorY: number;
	/** Assists keep hit dots within this distance of y*, or no further than they already are */
	limit: number;
}

/** Hard limit of a dot's distance from y* that the assists accept */
export const PACE_LIMIT = 0.25;
/** Highest a bounce may rise above its takeoff before the gap counts as long and needs a holder */
export const MAX_BOUNCE_RISE = 0.4;
const MIN_RATE = 0.15;
const MAX_RATE = 0.8;
// Intervals longer than this are long notes, not the rhythm
const RHYTHM_INTERVAL = 0.8;
const DEFAULT_INTERVAL = 0.3;
const EARTH = -GRAVITY_Y;

/**
 * Descent rate for the project: (1 − e) / (1 + e) · g · T / 2 for the project's gravity g, the default platform bounce e and the
 * median interval T between consecutive hits of all lanes, ignoring long notes. A single regular lane
 * therefore keeps the descent its default bounce gives, and lanes with different rhythms share one.
 */
export function paceRate(project: TProject): number {
	const intervals: number[] = [];
	for (const lane of project.music.lanes) {
		for (let i = 1; i < lane.hits.length; i++) {
			const interval = (lane.hits[i]?.time ?? 0) - (lane.hits[i - 1]?.time ?? 0);
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
	const rate = (((1 - bounce) / (1 + bounce)) * -gravityOf(project) * median) / 2;
	return Math.min(MAX_RATE, Math.max(MIN_RATE, rate));
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

/** y*(t) sampled every `step` seconds from `from` to `to`, both included, for consumers that interpolate */
export function descentPoints(pace: TDescentPace, from: number, to: number, step = 0.5): TDescentPoint[] {
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
 * Interval above which one bounce at the project's pace rises higher than `MAX_BOUNCE_RISE` above its
 * takeoff, so the gap needs a holder or rail. Between 0.6 and 2 seconds; lower gravity makes it longer.
 */
export function longGapThreshold(project: TProject): number {
	const rate = paceRate(project);
	const g = -gravityOf(project);
	const interval = (2 * (Math.sqrt(2 * g * MAX_BOUNCE_RISE) + rate)) / g;
	return Math.min(2, Math.max(0.6, Math.round(interval * 1000) / 1000));
}
