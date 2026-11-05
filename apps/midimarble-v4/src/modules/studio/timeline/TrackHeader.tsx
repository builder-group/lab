import React from 'react';
import { openContextMenu, RenameField } from '@/components';
import { findMarbleConflicts, marbleSounds } from '@/modules/music';
import type { TMarble, TProject } from '@/modules/project';
import { marbleLabelEntries, marbleMenu } from '../menus';
import type { StudioCx } from '../StudioCx';
import { MixToggles } from './MixToggles';
import { HEADER_WIDTH, ROW_HEIGHT } from './timeline-layout';

/**
 * A marble's track header: label color chip, which opens its choices, name and hit count, with Mute and Solo once it has
 * notes that play. Its row stays flat: notes open only in the Song layer's piano roll.
 */
export const TrackHeader: React.FC<TTrackHeaderProps> = (props) => {
	const { cx, project, marble, selection } = props;
	const [isRenaming, setIsRenaming] = React.useState(false);
	const conflicts = findMarbleConflicts(marble).size;
	const isSelected = selection.includes(marble.id) || selection.some((key) => key.startsWith(`hit:${marble.id}:`));
	const hitCount = `${marble.hits.length} ${marble.hits.length === 1 ? 'hit' : 'hits'}`;
	const details = conflicts > 0 ? `${conflicts} too close` : hitCount;

	return (
		<div
			className="mm-track-header sticky left-0 z-20 flex shrink-0 items-center gap-1.5 border-r border-b border-[var(--separator)] pr-1.5 pl-5"
			style={{ width: HEADER_WIDTH, height: ROW_HEIGHT }}
			data-track={marble.id}
			data-selected={isSelected}
			onContextMenu={(event) => openContextMenu(event, marbleMenu(cx, marble))}
		>
			<button className="mm-track-chip cursor-pointer" style={{ background: marble.labelColor }} onClick={(event) => openContextMenu(event, marbleLabelEntries(cx, marble))} title="Color" aria-label={`Label Color of ${marble.name}`} type="button" />
			<button
				className="mm-track-title flex h-full min-w-0 flex-1 flex-col justify-center text-left leading-tight"
				onClick={() => cx.$selection.set([marble.id])}
				onDoubleClick={() => setIsRenaming(true)}
				aria-label={marble.name}
				title={`Select ${marble.name}; double-click to rename`}
				type="button"
			>
				{isRenaming ? (
					<RenameField
						value={marble.name}
						onDone={(name) => {
							setIsRenaming(false);
							if (name != null && name !== marble.name) cx.execute([{ type: 'updateMarble', marbleId: marble.id, patch: { name } }]);
						}}
					/>
				) : (
					<span className="truncate font-medium">{marble.name}</span>
				)}
				<span className="truncate text-[11px]" style={{ color: conflicts > 0 ? 'var(--bad)' : 'var(--text-secondary)' }}>
					{details}
				</span>
			</button>
			{marbleSounds(project, marble) ? <MixToggles cx={cx} id={marble.id} name={marble.name} /> : null}
		</div>
	);
};

interface TTrackHeaderProps {
	cx: StudioCx;
	project: TProject;
	marble: TMarble;
	selection: string[];
}
