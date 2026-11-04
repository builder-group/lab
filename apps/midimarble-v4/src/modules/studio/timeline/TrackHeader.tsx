import { useFeatureState } from 'feature-react/state';
import { Headphones, Volume2, VolumeOff } from 'lucide-react';
import React from 'react';
import { openContextMenu, RenameField } from '@/components';
import { findLaneConflicts, instruments } from '@/modules/music';
import type { TLane, TProject } from '@/modules/project';
import { laneMenu } from '../menus';
import type { StudioCx } from '../StudioCx';
import { HEADER_WIDTH, ROW_HEIGHT } from './timeline-layout';

/**
 * A marble's track header like GarageBand: colour chip, name, instrument with hit count, and Mute and Solo icon
 * toggles. A marble's row stays flat: notes open only in the Song layer's piano roll.
 */
export const TrackHeader: React.FC<TTrackHeaderProps> = (props) => {
	const { cx, lane, project, selection, hasRecording } = props;
	const mix = useFeatureState(cx.$mix);
	const [isRenaming, setIsRenaming] = React.useState(false);
	const marble = project.entities.find((entity) => entity.components.marble?.laneId === lane.id);
	const id = marble?.id ?? lane.id;
	const conflicts = findLaneConflicts(lane).size;
	const isSelected = selection.includes(id) || selection.some((key) => key.startsWith(`hit:${lane.id}:`));
	const instrument = hasRecording ? null : instruments.find((item) => item.program === lane.instrument)?.name;
	const hitCount = `${lane.hits.length} ${lane.hits.length === 1 ? 'hit' : 'hits'}`;
	const details = conflicts > 0 ? `${conflicts} too close` : [instrument, hitCount].filter(Boolean).join(' · ');
	const isMuted = mix.muted.includes(lane.id);
	const isSoloed = mix.solo.includes(lane.id);

	return (
		<div
			className="mm-track-header sticky left-0 z-20 flex shrink-0 items-center gap-1.5 border-r border-b border-[var(--separator)] pr-1.5 pl-5"
			style={{ width: HEADER_WIDTH, height: ROW_HEIGHT }}
			data-track={id}
			data-selected={isSelected}
			data-muted={isMuted}
			onContextMenu={(event) => openContextMenu(event, laneMenu(cx, lane))}
		>
			<span className="mm-track-chip" style={{ background: lane.color }} aria-hidden />
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
			{hasRecording ? null : (
				<div className="flex shrink-0 items-center gap-0.5">
					<TrackToggle
						title={isMuted ? 'Unmute' : 'Mute'}
						isOn={isMuted}
						tone="mute"
						icon={isMuted ? <VolumeOff size={14} strokeWidth={1.75} /> : <Volume2 size={14} strokeWidth={1.75} />}
						onClick={() => cx.toggleMute(lane.id)}
					/>
					<TrackToggle
						title={isSoloed ? 'Unsolo' : 'Solo'}
						isOn={isSoloed}
						tone="solo"
						icon={<Headphones size={13} strokeWidth={1.75} />}
						onClick={() => cx.toggleSolo(lane.id)}
					/>
				</div>
			)}
		</div>
	);
};

interface TTrackHeaderProps {
	cx: StudioCx;
	lane: TLane;
	project: TProject;
	selection: string[];
	hasRecording: boolean;
}

const TrackToggle: React.FC<{ title: string; isOn: boolean; tone: 'mute' | 'solo'; icon: React.ReactNode; onClick: () => void }> = (props) => {
	const { title, isOn, tone, icon, onClick } = props;
	return (
		<button className="mm-track-toggle" data-on={isOn} data-tone={tone} aria-pressed={isOn} aria-label={tone === 'mute' ? 'Mute' : 'Solo'} title={title} onClick={onClick} type="button">
			{icon}
		</button>
	);
};
