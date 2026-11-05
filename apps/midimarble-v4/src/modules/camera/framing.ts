import type { TMarbleTrack, TSimulationResult } from '@/modules/simulation';
import { quaternionToMatrix } from './compare-track';
import { verticalFov, type TCameraTrack } from './follow-camera';

/** Seconds before a marble's first note and after its last during which it plays and should be in frame */
export const PLAYING_MARGIN = 0.3;
/** A marble out of frame for longer than this many seconds while it plays is a framing problem */
export const OUT_LONGEST = 0.5;
/** Stays in frame shorter than this many seconds join the stretches out of frame around them */
const BACK_SHORTEST = 0.25;

/**
 * Stretches in which the follow camera leaves a playing marble out of frame, from the camera track the Draft
 * Preview draws and the film bakes. A marble plays from PLAYING_MARGIN before its first note to PLAYING_MARGIN after
 * its last; it is out while its center is outside the frame. Stretches longer than OUT_LONGEST that hold at least one
 * of its notes count, in time order.
 */
export function framingStretches(result: TSimulationResult, track: TCameraTrack): TFramingStretch[] {
	const notes = new Map<string, number[]>();
	for (const hit of result.hits) notes.set(hit.laneId, [...(notes.get(hit.laneId) ?? []), hit.targetTime]);
	const stretches: TFramingStretch[] = [];
	for (const marble of result.marbles) {
		const times = (notes.get(marble.laneId) ?? []).sort((a, b) => a - b);
		const first = times[0];
		const last = times[times.length - 1];
		if (first == null || last == null || !marble.samples.length) continue;
		const from = Math.max(0, Math.floor((first - PLAYING_MARGIN) * track.fps));
		const to = Math.min(track.frameCount - 1, Math.ceil((last + PLAYING_MARGIN) * track.fps));
		const runs: [number, number][] = [];
		let start = -1;
		for (let frame = from; frame <= to + 1; frame++) {
			const isOut = frame <= to && !isInFrame(track, frame, marble, frame / track.fps);
			if (isOut && start < 0) start = frame;
			else if (!isOut && start >= 0) {
				runs.push([start, frame - 1]);
				start = -1;
			}
		}
		// A marble that swings back in for a moment is still lost
		const joined: [number, number][] = [];
		for (const run of runs) {
			const previous = joined[joined.length - 1];
			if (previous != null && (run[0] - previous[1] - 1) / track.fps < BACK_SHORTEST) previous[1] = run[1];
			else joined.push([run[0], run[1]]);
		}
		for (const [startFrame, endFrame] of joined) {
			const stretch = { from: startFrame / track.fps, to: (endFrame + 1) / track.fps };
			if (stretch.to - stretch.from <= OUT_LONGEST) continue;
			const struck = times.filter((time) => time >= stretch.from - 1e-9 && time <= stretch.to + 1e-9);
			if (!struck.length) continue;
			stretches.push({ laneId: marble.laneId, marbleEntityId: marble.entityId, ...stretch, notes: struck });
		}
	}
	return stretches.sort((a, b) => a.from - b.from || a.laneId.localeCompare(b.laneId));
}

export interface TFramingStretch {
	laneId: string;
	marbleEntityId: string;
	/** Seconds the marble is out of frame, from the first frame out to the end of the last */
	from: number;
	to: number;
	/** Times of its notes within the stretch, which the film shows without the marble */
	notes: number[];
}

/** Whether the marble's center at `time` lies inside the frame of the track's `frame` */
export function isInFrame(track: TCameraTrack, frame: number, marble: TMarbleTrack, time: number): boolean {
	const position = marblePosition(marble, time);
	if (position == null) return true;
	const [u, v] = projectToFrame(track, frame, position.x, position.y);
	return u >= 0 && u <= 1 && v >= 0 && v <= 1;
}

/**
 * Wall point in image coordinates of the track's `frame`, 0 to 1 with y up; outside 0 to 1 is out of frame. `distance`
 * is how far in front of the wall the point stands, the marble plane by default.
 */
export function projectToFrame(track: TCameraTrack, frame: number, x: number, y: number, distance = track.depth): [number, number] {
	const rotation = quaternionToMatrix(track.rotation.subarray(frame * 4, frame * 4 + 4));
	const relative = [
		x - (track.position[frame * 3] ?? 0),
		-distance - (track.position[frame * 3 + 1] ?? 0),
		y - (track.position[frame * 3 + 2] ?? 0)
	];
	// Camera space is the transposed rotation times the offset; the camera looks along its -z
	const local = [0, 1, 2].map((column) =>
		rotation.reduce((sum, row, index) => sum + (row[column] ?? 0) * (relative[index] ?? 0), 0)
	);
	const depth = -(local[2] ?? 0);
	if (depth <= 1e-6) return [Number.NaN, Number.NaN];
	const halfHeight = Math.tan((verticalFov(track.lens, track.aspect) * Math.PI) / 360);
	const halfWidth = halfHeight * track.aspect;
	return [0.5 + (local[0] ?? 0) / depth / halfWidth / 2, 0.5 + (local[1] ?? 0) / depth / halfHeight / 2];
}

/** Marble center at `time` between its samples, or null before its release */
function marblePosition(marble: TMarbleTrack, time: number): { x: number; y: number } | null {
	const samples = marble.samples;
	const first = samples[0];
	if (first == null || time < first.time) return null;
	let low = 0;
	let high = samples.length - 1;
	if (time >= (samples[high]?.time ?? 0)) return samples[high]?.position ?? null;
	while (high - low > 1) {
		const middle = (low + high) >> 1;
		if ((samples[middle]?.time ?? 0) <= time) low = middle;
		else high = middle;
	}
	const a = samples[low];
	const b = samples[high];
	if (a == null || b == null) return null;
	const t = b.time > a.time ? (time - a.time) / (b.time - a.time) : 0;
	return { x: a.position.x + (b.position.x - a.position.x) * t, y: a.position.y + (b.position.y - a.position.y) * t };
}
