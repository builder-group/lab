import type { TNote } from '../project';

export function snapTimelineTime(time: number, options: TTimelineSnap): number {
	const step = timelineSnapStep(options);
	return step === 0 ? time : Math.round(time / step) * step;
}

export interface TTimelineSnap {
	mode: 'off' | 'frame' | 'beat' | 'sixteenth';
	fps: number;
	bpm: number;
}

export function timelineSnapStep(options: TTimelineSnap): number {
	if (options.mode === 'off') return 0;
	if (options.mode === 'frame') return 1 / Math.max(1, options.fps);
	const beat = 60 / Math.max(1, options.bpm);
	return options.mode === 'beat' ? beat : beat / 4;
}

/** Preserves the opposite trim edge and keeps moved notes fully inside the score. */
export function editTimelineNote(
	note: TNote,
	delta: number,
	edge: 'start' | 'end' | null,
	duration: number,
	snap: TTimelineSnap
): Pick<TNote, 'time' | 'duration'> {
	const minimum = Math.min(duration, 1 / Math.max(1, snap.fps));
	const end = Math.min(duration, note.time + note.duration);
	if (edge === 'start') {
		const time = Math.max(0, Math.min(end - minimum, snapTimelineTime(note.time + delta, snap)));
		return { time, duration: end - time };
	}
	if (edge === 'end') {
		const nextEnd = Math.max(
			note.time + minimum,
			Math.min(duration, snapTimelineTime(end + delta, snap))
		);
		return { time: note.time, duration: nextEnd - note.time };
	}
	return {
		time: Math.max(
			0,
			Math.min(duration - note.duration, snapTimelineTime(note.time + delta, snap))
		),
		duration: note.duration
	};
}

/** Keeps the same time under the pointer while changing the horizontal scale. */
export function timelineZoomAnchor(
	scrollLeft: number,
	pointerX: number,
	oldZoom: number,
	newZoom: number
): number {
	return Math.max(0, ((scrollLeft + pointerX) / oldZoom) * newZoom - pointerX);
}

export function timelineTickStep(zoom: number, fps: number, unit: 'frames' | 'seconds'): number {
	const candidates =
		unit === 'frames'
			? [1, 2, 5, 10, Math.round(fps / 2), fps, fps * 2, fps * 5, fps * 10, fps * 20]
			: [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 60];
	const steps = [...new Set(candidates)].sort((left, right) => left - right);
	const scale = unit === 'frames' ? zoom / fps : zoom;
	return steps.find((step) => step * scale >= 60) ?? steps[steps.length - 1] ?? 1;
}

export function clampTimelineTime(time: number, duration: number, fps: number): number {
	return Math.max(0, Math.min(duration, Math.round(time * fps) / fps));
}
