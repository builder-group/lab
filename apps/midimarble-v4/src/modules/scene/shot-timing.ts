import type { TShot } from '@/modules/project';

/** Seconds a new shot holds before the camera eases back to the rig */
export const SHOT_HOLD = 2.0;

/** Seconds the follow camera eases into a shot and back out of it, `SHOT_EASE` in `camera.py` */
export const SHOT_EASE_SECONDS = 0.8;

/** Seconds the shot holds, or null when it holds until the next shot */
export function shotHold(shot: Pick<TShot, 'hold'>): number | null {
	return shot.hold != null && shot.hold > 0 ? shot.hold : null;
}

/**
 * The time each shot frames, in time order: from its time to its release (time plus length) or the next shot,
 * whichever comes first, and the last open shot to `end`. `isRelease` marks spans after which the camera eases back.
 */
export function shotSpans(shots: readonly TShot[], end: number): TShotSpan[] {
	const sorted = [...shots].sort((a, b) => a.time - b.time);
	return sorted.map((shot, index) => {
		const following = sorted[index + 1]?.time ?? Infinity;
		const hold = shotHold(shot);
		const release = hold != null ? shot.time + hold : Infinity;
		const isRelease = release < following - 1e-9;
		const stop = Math.min(release, following, Math.max(end, shot.time));
		return { shotId: shot.id, start: shot.time, end: stop, isRelease };
	});
}

export interface TShotSpan {
	shotId: string;
	start: number;
	end: number;
	/** The camera eases back to the rig at `end` rather than cutting to the next shot */
	isRelease: boolean;
}
