import React from 'react';
import { openContextMenu, RenameField } from '@/components';
import { findLaneConflicts } from '@/modules/music';
import type { TLane, TProject } from '@/modules/project';
import { laneLabelEntries, laneMenu } from '../menus';
import type { StudioCx } from '../StudioCx';
import { HEADER_WIDTH, ROW_HEIGHT } from './timeline-layout';

/**
 * A marble's track header: label color chip, which opens its choices, name and hit count. A marble plays nothing, so sound lives on the Song, and
 * its row stays flat: notes open only in the Song layer's piano roll.
 */
export const TrackHeader: React.FC<TTrackHeaderProps> = (props) => {
	const { cx, lane, project, selection } = props;
	const [isRenaming, setIsRenaming] = React.useState(false);
	const marble = project.entities.find((entity) => entity.components.marble?.laneId === lane.id);
	const id = marble?.id ?? lane.id;
	const conflicts = findLaneConflicts(lane).size;
	const isSelected = selection.includes(id) || selection.some((key) => key.startsWith(`hit:${lane.id}:`));
	const hitCount = `${lane.hits.length} ${lane.hits.length === 1 ? 'hit' : 'hits'}`;
	const details = conflicts > 0 ? `${conflicts} too close` : hitCount;

	return (
		<div
			className="mm-track-header sticky left-0 z-20 flex shrink-0 items-center gap-1.5 border-r border-b border-[var(--separator)] pr-1.5 pl-5"
			style={{ width: HEADER_WIDTH, height: ROW_HEIGHT }}
			data-track={id}
			data-selected={isSelected}
			onContextMenu={(event) => openContextMenu(event, laneMenu(cx, lane))}
		>
			<button className="mm-track-chip cursor-pointer" style={{ background: lane.color }} onClick={(event) => openContextMenu(event, laneLabelEntries(cx, lane))} title="Label Color" aria-label={`Label Color of ${lane.name}`} type="button" />
			<button
				className="mm-track-title flex h-full min-w-0 flex-1 flex-col justify-center text-left leading-tight"
				onClick={() => cx.$selection.set([id])}
				onDoubleClick={() => setIsRenaming(true)}
				aria-label={lane.name}
				title={`Select ${lane.name}; double-click to rename`}
				type="button"
			>
				{isRenaming ? (
					<RenameField
						value={lane.name}
						onDone={(name) => {
							setIsRenaming(false);
							if (name != null && name !== lane.name) cx.execute([{ type: 'upsertLane', lane: { ...lane, name } }]);
						}}
					/>
				) : (
					<span className="truncate font-medium">{lane.name}</span>
				)}
				<span className="truncate text-[11px]" style={{ color: conflicts > 0 ? 'var(--bad)' : 'var(--text-secondary)' }}>
					{details}
				</span>
			</button>
		</div>
	);
};

interface TTrackHeaderProps {
	cx: StudioCx;
	lane: TLane;
	project: TProject;
	selection: string[];
}
