import React from 'react';
import { SHOT_EASE_SECONDS, shotSpans } from '@/modules/scene';
import type { TProject } from '@/modules/project';
import { parseShotKey } from '@/modules/project';

/**
 * How long each shot frames, as a band behind its marker on the Camera track: to its hold's end, where a fade shows
 * the camera easing back, or to the next shot. Clicks pass through to the track and the markers.
 */
export const CameraShotSpans: React.FC<TCameraShotSpansProps> = (props) => {
	const { project, zoom, selection, dragged } = props;
	const shots = project.design.camera.shots.map((shot) => (dragged != null && shot.id === dragged.shotId ? { ...shot, time: dragged.time } : shot));
	const selected = new Set(selection.map(parseShotKey).filter((id) => id != null));
	return (
		<>
			{shotSpans(shots, project.end).map((span) => {
				const color = selected.has(span.shotId) ? 'var(--accent)' : 'var(--warn)';
				const fade = span.isRelease ? SHOT_EASE_SECONDS * zoom : 0;
				return (
					<div
						key={span.shotId}
						className="pointer-events-none absolute top-[7px] z-10 h-[5px]"
						style={{
							left: span.start * zoom,
							width: Math.max(2, (span.end - span.start) * zoom + fade),
							borderRadius: span.isRelease ? '0 3px 3px 0' : 0,
							background: span.isRelease
								? `linear-gradient(to right, color-mix(in srgb, ${color} 40%, transparent) calc(100% - ${fade}px), transparent)`
								: `color-mix(in srgb, ${color} 40%, transparent)`
						}}
						aria-hidden
					/>
				);
			})}
		</>
	);
};

interface TCameraShotSpansProps {
	project: TProject;
	zoom: number;
	selection: string[];
	/** The marker being dragged and its time, so its span moves with it */
	dragged: { shotId: string; time: number } | null;
}
