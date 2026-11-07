import { useFeatureState } from 'feature-react/state';
import { Link2 } from 'lucide-react';
import React from 'react';
import { openContextMenu, RenameField } from '@/components';
import { findMarbleConflicts, marbleSounds } from '@/modules/music';
import { marbleSong, type TMarble, type TProject } from '@/modules/project';
import { LabelColorInput } from '../LabelColorInput';
import { marbleMenu } from '../menus';
import type { StudioCx } from '../StudioCx';
import { MixToggles } from './MixToggles';
import { HEADER_WIDTH, ROW_HEIGHT, songTint } from './timeline-layout';

/**
 * A marble's track header: label color chip, which opens its choices, name, hit count and the song its hits move with,
 * with Mute and Solo once it has notes that play. Its row stays flat: notes open only in the Song layer's piano roll.
 */
export const TrackHeader: React.FC<TTrackHeaderProps> = (props) => {
	const { cx, project, marble, selection } = props;
	const [isRenaming, setIsRenaming] = React.useState(false);
	const isMuted = useFeatureState(cx.$mix).muted.includes(marble.id);
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
			data-muted={isMuted}
			onContextMenu={(event) => openContextMenu(event, marbleMenu(cx, marble))}
		>
			<span className="mm-track-chip relative" style={{ background: marble.labelColor }}>
				<LabelColorInput cx={cx} color={marble.labelColor} name={marble.name} commandsFor={(labelColor) => [{ type: 'updateMarble', marbleId: marble.id, patch: { labelColor } }]} />
			</span>
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
				<span className="flex min-w-0 items-center gap-1.5 text-[11px]" style={{ color: conflicts > 0 ? 'var(--bad)' : 'var(--text-secondary)' }}>
					<span className="shrink-0">{details}</span>
					<SongChip project={project} marble={marble} />
				</span>
			</button>
			{marbleSounds(project, marble) ? <MixToggles cx={cx} id={marble.id} name={marble.name} /> : null}
		</div>
	);
};

/**
 * What the marble's hits move with, in the tint of the line under them: like Resolve's chain on a linked clip it is only
 * there while there is a link and it isn't a control. A click selects the marble, whose inspector has the Song field.
 */
const SongChip: React.FC<{ project: TProject; marble: TMarble }> = (props) => {
	const { project, marble } = props;
	const song = marbleSong(marble);
	if (song.kind === 'none') return null;
	const nameOf = (songId: string): string => project.songs.find((item) => item.id === songId)?.name || 'Backing';
	const tint = song.kind === 'song' ? songTint(project.songs.findIndex((item) => item.id === song.songId)) : 'var(--text-tertiary)';
	const title = song.kind === 'song' ? `Moves with ${nameOf(song.songId)}` : `${song.tied} of ${marble.hits.length} hits move with ${song.songIds.map(nameOf).join(' and ')}`;
	return (
		<span className="flex min-w-0 items-center gap-0.5" title={title} data-song-chip={song.kind}>
			<Link2 size={11} strokeWidth={1.75} className="shrink-0" style={{ color: tint }} />
			<span className="truncate">{song.kind === 'song' ? nameOf(song.songId) : 'Mixed'}</span>
		</span>
	);
};

interface TTrackHeaderProps {
	cx: StudioCx;
	project: TProject;
	marble: TMarble;
	selection: string[];
}
