import { useFeatureState } from 'feature-react/state';
import React from 'react';
import type { TMarble, TProject, TVec2 } from '@/modules/project';
import { toPoints } from '@/modules/canvas';
import { bandAlongGuide, type TSimulationResult } from '@/modules/simulation';
import { pastBuiltMark } from './past-built';
import type { TrackCx } from './TrackCx';

/** How far the line runs past the marble's lowest point, in meters, so it reads as a direction and not an end */
const RUN_ON = 0.6;

/**
 * Each marble's guide line, the direction the builder follows, straight down from its release unless the marble stores a
 * line: dashed in the marble's color and quiet, under the pieces, so it never competes with them. It only shows; nothing edits it here
 */
export const GuideLayer: React.FC<{ trackCx: TrackCx }> = (props) => {
	const { trackCx } = props;
	const cx = trackCx.studio;
	const project = useFeatureState(cx.$history)?.present;
	const result = useFeatureState(cx.simulation.$result);
	const hidden = useFeatureState(cx.$hidden);
	const viewport = useFeatureState(trackCx.$viewport);
	const { target } = useFeatureState(cx.bar.$state);
	useFeatureState(trackCx.$camera);
	if (project == null || viewport.width <= 1) return null;
	// A note past what's built: the line goes on down to where it would be
	const mark = target != null ? pastBuiltMark(project, result, target) : null;
	return (
		<g data-guide-lines>
			{project.marbles.map((marble) =>
				hidden.includes(marble.id) ? null : <polyline key={marble.id} points={toPoints(guidePoints(project, result, marble, marble.id === target?.marbleId ? mark?.point.y : undefined).map((point) => trackCx.toScreen(point)))} fill="none" stroke={marble.labelColor} strokeOpacity={0.45} strokeWidth={1} strokeDasharray="5 5" />
			)}
		</g>
	);
};

/** The line from the marble's release down past the lowest point of its run, and past `reach` when given, through each point it stores */
export function guidePoints(project: TProject, result: TSimulationResult | null, marble: TMarble, reach?: number): TVec2[] {
	const top = marble.start.position.y;
	const samples = result?.marbles.find((item) => item.marbleId === marble.id)?.samples ?? [];
	const lowest = samples.reduce((min, sample) => Math.min(min, sample.position.y), Math.min(top - 1, reach ?? Infinity));
	const bottom = lowest - RUN_ON;
	const band = bandAlongGuide(project, marble.id);
	const heights = [top, ...(marble.guide?.points ?? []).map((point) => point.y).filter((y) => y < top && y > bottom), bottom];
	return heights.map((y) => ({ x: band(y).centerX, y }));
}
