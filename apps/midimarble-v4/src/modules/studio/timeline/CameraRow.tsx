import { Plus } from 'lucide-react';
import React from 'react';
import { addShotCommands, shotKindLabel, updateShotCommands } from '@/modules/design/shots';
import type { TProject } from '@/modules/project';
import { getCommand } from '../commands';
import { formatTime } from '../format';
import { parseShotKey, toShotKey } from '../selection';
import type { StudioCx } from '../StudioCx';
import { CAMERA_ROW_HEIGHT, HEADER_WIDTH, round } from './timeline-layout';

/**
 * Camera shot markers in the Design workspace, like Final Cut markers above the clips: click selects,
 * dragging moves the time with one undo step, double-click on the row adds a marker
 */
export const CameraRow: React.FC<TCameraRowProps> = (props) => {
	const { cx, project, zoom, width, selection, timeAt } = props;
	const shots = project.design.camera.shots;
	const [drag, setDrag] = React.useState<{ shotId: string; grab: number; originX: number; time: number; moved: boolean } | null>(null);

	return (
		<div className="flex shrink-0" style={{ height: CAMERA_ROW_HEIGHT }}>
			<div
				className="mm-track-header sticky left-0 z-20 flex shrink-0 items-center gap-0.5 border-r border-b border-[var(--separator)] pr-1.5 pl-3"
				style={{ width: HEADER_WIDTH }}
			>
				<span className="flex-1 text-[11px] font-semibold text-[var(--text-secondary)]">Camera</span>
				<button
					className="mm-icon-button !h-5 !w-5"
					onClick={() => getCommand('camera.addShot').run(cx)}
					title="Add Shot Marker at Playhead (⇧M)"
					aria-label="Add Shot Marker"
					type="button"
				>
					<Plus size={12} strokeWidth={2} />
				</button>
			</div>
			<div
				className="relative flex-1 border-b border-[var(--separator)]"
				style={{ minWidth: width }}
				aria-label="Camera shot markers"
				onPointerDown={(event) => {
					if (event.button !== 0 || event.target !== event.currentTarget || event.shiftKey) return;
					cx.$selection.set(selection.filter((key) => parseShotKey(key) == null));
				}}
				onDoubleClick={(event) => {
					if (event.target !== event.currentTarget) return;
					const { commands: shotCommands, shotId } = addShotCommands(project, timeAt(event.clientX));
					if (cx.execute(shotCommands)) cx.$selection.set([toShotKey(shotId)]);
				}}
			>
				{shots.map((shot) => {
					const key = toShotKey(shot.id);
					const isSelected = selection.includes(key);
					const time = drag?.shotId === shot.id ? drag.time : shot.time;
					return (
						<button
							key={shot.id}
							className="absolute top-0 z-20 flex h-full w-4 -translate-x-1/2 cursor-ew-resize items-start justify-center pt-[3px]"
							style={{ left: time * zoom }}
							aria-label={`${shotKindLabel(shot.kind)} shot at ${formatTime(time)}`}
							aria-pressed={isSelected}
							title={`${shotKindLabel(shot.kind)} · ${formatTime(time)}`}
							onPointerDown={(event) => {
								if (event.button !== 0) return;
								event.stopPropagation();
								if (event.shiftKey) {
									cx.$selection.set(isSelected ? selection.filter((item) => item !== key) : [...selection, key]);
									return;
								}
								event.currentTarget.setPointerCapture(event.pointerId);
								cx.$selection.set([key]);
								setDrag({ shotId: shot.id, grab: timeAt(event.clientX) - shot.time, originX: event.clientX, time: shot.time, moved: false });
							}}
							onPointerMove={(event) => {
								if (drag?.shotId !== shot.id) return;
								const moved = drag.moved || Math.abs(event.clientX - drag.originX) > 2;
								if (moved) setDrag({ ...drag, moved, time: round(Math.max(0, timeAt(event.clientX) - drag.grab)) });
							}}
							onPointerUp={() => {
								if (drag?.shotId !== shot.id) return;
								setDrag(null);
								if (drag.moved && drag.time !== shot.time) cx.execute(updateShotCommands(project, shot.id, { time: drag.time }));
							}}
							onPointerCancel={() => setDrag(null)}
							onDoubleClick={(event) => event.stopPropagation()}
							type="button"
						>
							<ShotGlyph isSelected={isSelected} />
						</button>
					);
				})}
			</div>
		</div>
	);
};

interface TCameraRowProps {
	cx: StudioCx;
	project: TProject;
	zoom: number;
	width: number;
	selection: string[];
	timeAt: (clientX: number) => number;
}

/** Final Cut style marker: a small tab with a point at the marker's time */
const ShotGlyph: React.FC<{ isSelected: boolean }> = (props) => {
	const { isSelected } = props;
	return (
		<svg width={10} height={14} viewBox="0 0 10 14" aria-hidden>
			<path
				d="M1.5 1h7a.5.5 0 0 1 .5.5V9l-4 4-4-4V1.5a.5.5 0 0 1 .5-.5z"
				fill={isSelected ? 'var(--accent)' : 'var(--warn)'}
				stroke={isSelected ? 'var(--accent-strong)' : 'color-mix(in srgb, var(--warn) 70%, black)'}
				strokeWidth={1}
			/>
		</svg>
	);
};
