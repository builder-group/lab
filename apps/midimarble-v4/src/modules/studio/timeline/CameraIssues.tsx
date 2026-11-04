import React from 'react';
import { useRunPreflight } from '@/modules/design/ExportPreflight';
import type { TProject } from '@/modules/project';
import { formatTime } from '../format';
import type { StudioCx } from '../StudioCx';

/**
 * Framing problems of the problem model as amber spans along the Camera track, from the first to the last moment
 * the camera may lose a marble. A click opens the problem in Film at its time with the Camera selected, like the
 * same problem in the export sheet and the hit summary's menu. Shot markers are drawn by the track itself.
 */
export const CameraIssues: React.FC<TCameraIssuesProps> = (props) => {
	const { cx, project, zoom } = props;
	const preflight = useRunPreflight(cx, project);
	if (preflight == null) return null;
	const spans = preflight.issues.filter((issue) => issue.kind === 'framing' && issue.severity === 'warning' && issue.span != null);
	return (
		<>
			{spans.map((issue, index) => {
				const span = issue.span ?? { from: 0, to: 0 };
				return (
					<button
						key={issue.id}
						className="mm-camera-issue"
						// Overlapping spans stack in up to three rows under the shot markers
						style={{ left: span.from * zoom, width: Math.max(6, (span.to - span.from) * zoom), bottom: 3 + (index % 3) * 7 }}
						title={`${issue.title} · ${formatTime(span.from)} to ${formatTime(span.to)}`}
						aria-label={issue.title}
						onPointerDown={(event) => event.stopPropagation()}
						onDoubleClick={(event) => event.stopPropagation()}
						onClick={() => issue.target != null && cx.revealIssue(issue.target)}
						type="button"
					/>
				);
			})}
		</>
	);
};

interface TCameraIssuesProps {
	cx: StudioCx;
	project: TProject;
	zoom: number;
}
