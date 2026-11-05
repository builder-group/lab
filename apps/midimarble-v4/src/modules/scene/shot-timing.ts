import type { TShot } from '@/modules/project';

/** Seconds a Push In or Close-Up holds before the camera eases back to the rig, unless the shot sets a length */
export const SHOT_HOLD = 2.0;

/** Seconds the follow camera eases into a shot and back out of it, `SHOT_EASE` in `camera.py` */
export const SHOT_EASE_SECONDS = 0.8;

/** Hold of a shot kind without a length of its own: close shots release, Wide and Follow hold until the next shot */
export function defaultShotHold(kind: TShot['kind']): number | null {
	return kind === 'pushIn' || kind === 'closeUp' ? SHOT_HOLD : null;
}

/** Seconds the shot holds, or null when it holds until the next shot (a hold of 0 or an open kind's default) */
export function shotHold(shot: Pick<TShot, 'kind' | 'hold'>): number | null {
	const hold = shot.hold ?? defaultShotHold(shot.kind);
	return hold != null && hold > 0 ? hold : null;
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
		return { shotId: shot.id, kind: shot.kind, start: shot.time, end: stop, isRelease };
	});
}

export interface TShotSpan {
	shotId: string;
	kind: TShot['kind'];
	start: number;
	end: number;
	/** The camera eases back to the rig at `end` rather than cutting to the next shot */
	isRelease: boolean;
}
