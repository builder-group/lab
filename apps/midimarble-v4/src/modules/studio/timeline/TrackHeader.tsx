import { useFeatureState } from 'feature-react/state';
import { ChevronRight, Headphones, Volume2, VolumeOff } from 'lucide-react';
import React from 'react';
import { openContextMenu, RenameField } from '@/components';
import { findLaneConflicts, instruments } from '@/modules/music';
import type { TLane, TProject } from '@/modules/project';
import { noteName } from '../format';
import { laneMenu } from '../menus';
import type { StudioCx } from '../StudioCx';
import { isBlackKey, pitchToRow, rowCount, type TPitchRange } from './piano-roll';
import { HEADER_WIDTH, KEYBOARD_WIDTH, NOTE_ROW_HEIGHT, ROW_HEIGHT } from './timeline-layout';
import { toggleExpandedLane } from './timeline-state';

/**
 * A marble's track header like GarageBand: disclosure triangle, colour chip, name, instrument, and Mute and
 * Solo icon toggles. Expanded, a keyboard strip runs down its right edge beside the piano roll.
 */
export const TrackHeader: React.FC<TTrackHeaderProps> = (props) => {
	const { cx, lane, project, selection, hasRecording, range, isExpanded, height } = props;
	const mix = useFeatureState(cx.$mix);
	const [isRenaming, setIsRenaming] = React.useState(false);
	const marble = project.entities.find((entity) => entity.components.marble?.laneId === lane.id);
	const id = marble?.id ?? lane.id;
	const conflicts = findLaneConflicts(lane).size;
	const isSelected = selection.includes(id) || selection.some((key) => key.startsWith(`hit:${lane.id}:`));
	const instrument = hasRecording ? null : instruments.find((item) => item.program === lane.instrument)?.name;
	const hitCount = `${lane.hits.length} ${lane.hits.length === 1 ? 'hit' : 'hits'}`;
	// The keyboard strip narrows an expanded header, so it names only the instrument
	const details = conflicts > 0 ? `${conflicts} too close` : [instrument, isExpanded && instrument != null ? null : hitCount].filter(Boolean).join(' · ');
	const isMuted = mix.muted.includes(lane.id);
	const isSoloed = mix.solo.includes(lane.id);
	const canExpand = range != null;

	return (
		<div
			className="mm-track-header sticky left-0 z-20 flex shrink-0 border-r border-b border-[var(--separator)]"
			style={{ width: HEADER_WIDTH, height }}
			data-track={id}
			data-selected={isSelected}
			data-muted={isMuted}
			data-expanded={isExpanded}
			onContextMenu={(event) => openContextMenu(event, laneMenu(cx, lane))}
		>
			<div className="flex min-w-0 flex-1 items-center gap-1.5 self-start pr-1.5 pl-1" style={{ height: ROW_HEIGHT }}>
				{canExpand ? (
					<button
						className="mm-disclosure"
						data-open={isExpanded}
						onClick={() => toggleExpandedLane(lane.id)}
						title={isExpanded ? 'Collapse Piano Roll' : 'Expand Piano Roll'}
						aria-label={isExpanded ? `Collapse ${lane.name}` : `Expand ${lane.name}`}
						aria-expanded={isExpanded}
						type="button"
					>
						<ChevronRight size={12} strokeWidth={2.25} />
					</button>
				) : (
					<span className="w-4 shrink-0" />
				)}
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
			{isExpanded && range != null ? <Keyboard name={lane.name} range={range} onPlay={(pitch) => cx.audition(lane.id, pitch)} /> : null}
		</div>
	);
};

interface TTrackHeaderProps {
	cx: StudioCx;
	lane: TLane;
	project: TProject;
	selection: string[];
	hasRecording: boolean;
	range: TPitchRange | null;
	isExpanded: boolean;
	height: number;
}

const TrackToggle: React.FC<{ title: string; isOn: boolean; tone: 'mute' | 'solo'; icon: React.ReactNode; onClick: () => void }> = (props) => {
	const { title, isOn, tone, icon, onClick } = props;
	return (
		<button className="mm-track-toggle" data-on={isOn} data-tone={tone} aria-pressed={isOn} aria-label={tone === 'mute' ? 'Mute' : 'Solo'} title={title} onClick={onClick} type="button">
			{icon}
		</button>
	);
};

/**
 * Vertical keyboard of an expanded track, one key per semitone row, C keys labelled; a click plays the key.
 * `offset` scrolls it with a piano roll that is taller than its track.
 */
export const Keyboard: React.FC<TKeyboardProps> = (props) => {
	const { name, range, offset = 0, onPlay } = props;
	const pitches = Array.from({ length: rowCount(range) }, (_, index) => range.high - index);
	return (
		<div className="mm-keyboard relative shrink-0 overflow-hidden" style={{ width: KEYBOARD_WIDTH }} role="group" aria-label={`${name} keyboard`}>
			<div className="absolute inset-x-0 top-0" style={{ transform: offset === 0 ? undefined : `translateY(${-offset}px)` }}>
				{pitches.map((pitch) => {
					const isBlack = isBlackKey(pitch);
					const isC = pitch % 12 === 0;
					return (
						<button
							key={pitch}
							className="mm-key"
							data-black={isBlack}
							data-c={isC}
							style={{ top: pitchToRow(pitch, range) * NOTE_ROW_HEIGHT, height: NOTE_ROW_HEIGHT }}
							onPointerDown={(event) => {
								if (event.button !== 0) return;
								onPlay(pitch);
							}}
							title={noteName(pitch)}
							aria-label={`Play ${noteName(pitch)}`}
							type="button"
						>
							{isC ? <span className="mm-key-label">{noteName(pitch)}</span> : null}
						</button>
					);
				})}
			</div>
		</div>
	);
};

interface TKeyboardProps {
	name: string;
	range: TPitchRange;
	offset?: number;
	onPlay: (pitch: number) => void;
}
