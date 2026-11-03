import { useFeatureState } from 'feature-react/state';
import React from 'react';
import type { StudioCx } from './StudioCx';

/** Lane overview with a shared playhead. M1 replaces this with the editable music lanes. */
export const Timeline: React.FC<TTimelineProps> = (props) => {
	const { cx } = props;
	const history = useFeatureState(cx.$history);
	const playhead = useFeatureState(cx.$playhead);
	const project = history?.present;
	if (project == null) return null;
	const ticks = Array.from({ length: Math.floor(project.end) + 1 }, (_, index) => index);

	function seek(event: React.PointerEvent<HTMLDivElement>): void {
		if (project == null) return;
		const rect = event.currentTarget.getBoundingClientRect();
		const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
		cx.$playhead.set(ratio * project.end);
	}

	return (
		<section
			className="flex h-[168px] shrink-0 border-t border-[var(--separator)] bg-[var(--content)]"
			aria-label="Timeline"
		>
			<div className="w-[232px] shrink-0 border-r border-[var(--separator)] bg-[var(--chrome)] pt-6">
				{project.music.lanes.map((lane) => (
					<div key={lane.id} className="flex h-9 items-center gap-2 px-3">
						<span className="h-2.5 w-2.5 rounded-full" style={{ background: lane.color }} />
						<span className="truncate">{lane.name}</span>
					</div>
				))}
			</div>
			<div
				className="relative min-w-0 flex-1"
				onPointerDown={(event) => {
					event.currentTarget.setPointerCapture(event.pointerId);
					seek(event);
				}}
				onPointerMove={(event) => {
					if (event.buttons === 1) seek(event);
				}}
			>
				<div className="relative h-6 border-b border-[var(--separator)]">
					{ticks.map((tick) => (
						<span
							key={tick}
							className="mm-mono absolute top-1 text-[10px] text-[var(--text-tertiary)]"
							style={{ left: `calc(${(tick / project.end) * 100}% + 3px)` }}
						>
							{tick}
						</span>
					))}
				</div>
				{project.music.lanes.map((lane) => (
					<div key={lane.id} className="relative h-9 border-b border-[var(--separator)]">
						{lane.hits.map((hit) => (
							<span
								key={hit.id}
								className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
								style={{ left: `${(hit.time / project.end) * 100}%`, background: lane.color }}
							/>
						))}
					</div>
				))}
				<div
					className="pointer-events-none absolute top-0 bottom-0 w-px bg-[var(--bad)]"
					style={{ left: `${(playhead / project.end) * 100}%` }}
				/>
			</div>
		</section>
	);
};

interface TTimelineProps {
	cx: StudioCx;
}
