import React from 'react';
import { openContextMenu } from '@/components';
import { findLaneConflicts, MIN_HIT_GAP } from '@/modules/music';
import { createId, type THit, type TLane } from '@/modules/project';
import type { THitResult } from '@/modules/simulation';
import { formatTime, noteName } from '../format';
import { hitMenu, laneMenu } from '../menus';
import { toHitKey } from '../selection';
import type { StudioCx } from '../StudioCx';
import { clampPitch, isBlackKey, pitchToRow, rowCount, rowToPitch, type TPitchRange } from './piano-roll';
import { NOTE_ROW_HEIGHT, ROW_HEIGHT, round } from './timeline-layout';

/** A collapsed track: one compact row of hit diamonds, placed higher for higher notes */
export const LaneTrack: React.FC<TLaneTrackProps> = (props) => {
	const { cx, lane, zoom, width, selection, drag, statuses, isAudible, onAdd, onDragStart, timeAt } = props;
	const conflicts = React.useMemo(() => findLaneConflicts(lane), [lane]);
	const pitches = lane.hits.map((hit) => hit.pitch).filter((pitch): pitch is number => pitch != null);
	const low = pitches.length ? Math.min(...pitches) : 60;
	const high = pitches.length ? Math.max(...pitches) : 72;
	const marquee = useMarquee(cx, lane, zoom, selection, timeAt);

	function pitchY(pitch: number | undefined): number {
		if (pitch == null || high === low) return ROW_HEIGHT / 2;
		return ROW_HEIGHT - 11 - ((pitch - low) / (high - low)) * (ROW_HEIGHT - 22);
	}

	return (
		<div
			className="relative flex-1 border-b border-[var(--separator)]"
			style={{ minWidth: width, background: marquee.isLaneSelected ? 'color-mix(in srgb, var(--text) 3%, transparent)' : undefined }}
			{...marquee.handlers}
			onDoubleClick={(event) => {
				if (event.target !== event.currentTarget) return;
				onAdd(timeAt(event.clientX), event);
			}}
			onContextMenu={(event) => {
				if (event.target !== event.currentTarget) return;
				openContextMenu(event, laneMenu(cx, lane, timeAt(event.clientX)));
			}}
		>
			{!lane.hits.length ? (
				<span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[11px] text-[var(--text-tertiary)]">
					Double-click to add a hit, or press T while playing to tap along
				</span>
			) : null}
			{lane.hits.map((hit, index) => {
				const key = toHitKey(lane.id, hit.id);
				const offset = drag?.keys.includes(key) === true ? drag.delta : 0;
				return (
					<HitButton
						key={hit.id}
						cx={cx}
						lane={lane}
						hit={hit}
						index={index}
						className="mm-hit"
						selection={selection}
						status={statuses?.get(hit.id)}
						isConflict={conflicts.has(hit.id)}
						style={{ left: Math.max(0, hit.time + offset) * zoom, top: pitchY(hit.pitch), opacity: isAudible ? 1 : 0.4 }}
						onDragStart={(event) => onDragStart(key, event, false)}
					>
						<span />
					</HitButton>
				);
			})}
			{marquee.element}
		</div>
	);
};

interface TLaneTrackProps {
	cx: StudioCx;
	lane: TLane;
	zoom: number;
	width: number;
	selection: string[];
	drag: TDrag | null;
	statuses: Map<string, THitResult> | undefined;
	isAudible: boolean;
	onAdd: (time: number, event: React.MouseEvent) => void;
	onDragStart: TDragStart;
	timeAt: (clientX: number) => number;
}

/**
 * An expanded track like Logic's piano roll: one row per semitone, black-key rows shaded, hits drawn as
 * note blocks whose left edge is the hit time. Dragging a note moves it in time and in pitch.
 */
export const PianoRollTrack: React.FC<TPianoRollTrackProps> = (props) => {
	const { cx, lane, range, zoom, width, selection, drag, statuses, isAudible, onDragStart, timeAt } = props;
	const conflicts = React.useMemo(() => findLaneConflicts(lane), [lane]);
	const marquee = useMarquee(cx, lane, zoom, selection, timeAt);
	const pitches = Array.from({ length: rowCount(range) }, (_, index) => range.high - index);

	/** Adds a note at the time and pitch under the pointer, like double-clicking in Logic's piano roll */
	function addNote(event: React.MouseEvent<HTMLDivElement>): void {
		const y = event.clientY - event.currentTarget.getBoundingClientRect().top;
		const hit: THit = { id: createId('hit'), time: round(timeAt(event.clientX)), pitch: rowToPitch(y, range, NOTE_ROW_HEIGHT) };
		if (!cx.execute([{ type: 'upsertHits', laneId: lane.id, hits: [hit] }])) return;
		cx.$selection.set([toHitKey(lane.id, hit.id)]);
		cx.audition(lane.id, hit.pitch);
	}

	return (
		<div
			className="mm-piano-roll relative flex-1 border-b border-[var(--separator)]"
			style={{ minWidth: width, height: rowCount(range) * NOTE_ROW_HEIGHT }}
			{...marquee.handlers}
			onDoubleClick={(event) => {
				if (!isRollBackground(event)) return;
				addNote(event);
			}}
			onContextMenu={(event) => {
				if (!isRollBackground(event)) return;
				openContextMenu(event, laneMenu(cx, lane, timeAt(event.clientX)));
			}}
		>
			{pitches.map((pitch) => (
				<div
					key={pitch}
					data-row={pitch}
					className="mm-piano-row"
					data-black={isBlackKey(pitch)}
					data-c={pitch % 12 === 0}
					style={{ top: pitchToRow(pitch, range) * NOTE_ROW_HEIGHT, height: NOTE_ROW_HEIGHT }}
				/>
			))}
			{lane.hits.map((hit, index) => {
				if (hit.pitch == null) return null;
				const key = toHitKey(lane.id, hit.id);
				const isDragged = drag?.keys.includes(key) === true;
				const time = Math.max(0, hit.time + (isDragged ? drag.delta : 0));
				const pitch = isDragged && drag.isPitched ? clampPitch(hit.pitch + drag.pitchDelta, range) : hit.pitch;
				return (
					<HitButton
						key={hit.id}
						cx={cx}
						lane={lane}
						hit={hit}
						index={index}
						className="mm-note"
						selection={selection}
						status={statuses?.get(hit.id)}
						isConflict={conflicts.has(hit.id)}
						style={{ left: time * zoom, top: pitchToRow(pitch, range) * NOTE_ROW_HEIGHT + 1, height: NOTE_ROW_HEIGHT - 2, opacity: isAudible ? 1 : 0.4 }}
						onDragStart={(event) => onDragStart(key, event, true)}
					/>
				);
			})}
			{marquee.element}
		</div>
	);
};

interface TPianoRollTrackProps extends Omit<TLaneTrackProps, 'onAdd'> {
	range: TPitchRange;
}

export interface TDrag {
	originX: number;
	originY: number;
	delta: number;
	// Semitones, only for drags that started in a piano roll
	pitchDelta: number;
	isPitched: boolean;
	keys: string[];
	// The grabbed hit, auditioned at its new pitch on drop
	grabbed: { laneId: string; hitId: string };
}

export type TDragStart = (hitKey: string, event: { clientX: number; clientY: number }, isPitched: boolean) => void;

/** A hit diamond or note block: click selects and auditions, Shift-click toggles, drag moves */
const HitButton: React.FC<THitButtonProps> = (props) => {
	const { cx, lane, hit, index, className, selection, status, isConflict, style, onDragStart, children } = props;
	const key = toHitKey(lane.id, hit.id);
	const isSelected = selection.includes(key);
	// Hits of selected pieces are outlined, like keyframes of the selected object in Blender
	const isLinked = status?.pieceEntityId != null && selection.includes(status.pieceEntityId);
	return (
		<button
			aria-label={`Hit ${index + 1}${hit.pitch == null ? '' : ` ${noteName(hit.pitch)}`} at ${formatTime(hit.time)}`}
			aria-pressed={isSelected}
			className={className}
			data-selected={isSelected}
			data-state={hitState(status)}
			data-conflict={isConflict}
			data-linked={isLinked}
			style={{ ...style, ['--lane' as string]: lane.color }}
			title={hitTitle(index, hit, status, isConflict)}
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				event.stopPropagation();
				if (event.shiftKey) {
					cx.$selection.set(isSelected ? selection.filter((item) => item !== key) : [...selection, key]);
					return;
				}
				cx.audition(lane.id, hit.pitch);
				onDragStart(event);
			}}
			onContextMenu={(event) => {
				event.stopPropagation();
				if (!isSelected) cx.$selection.set([key]);
				openContextMenu(event, hitMenu(cx, lane, hit.id));
			}}
			type="button"
		>
			{children}
		</button>
	);
};

interface THitButtonProps {
	cx: StudioCx;
	lane: TLane;
	hit: THit;
	index: number;
	className: string;
	selection: string[];
	status: THitResult | undefined;
	isConflict: boolean;
	style: React.CSSProperties;
	onDragStart: (event: { clientX: number; clientY: number }) => void;
	children?: React.ReactNode;
}

/** Time-range marquee on a track: dragging on empty space selects the hits it spans, Shift adds */
function useMarquee(cx: StudioCx, lane: TLane, zoom: number, selection: string[], timeAt: (clientX: number) => number): TMarquee {
	const [range, setRange] = React.useState<{ from: number; to: number } | null>(null);
	const isLaneSelected = selection.some((key) => key.startsWith(`hit:${lane.id}:`));

	const handlers: TMarquee['handlers'] = {
		onPointerDown: (event) => {
			if (event.button !== 0 || (event.target as HTMLElement).closest('button') != null) return;
			event.currentTarget.setPointerCapture(event.pointerId);
			const time = timeAt(event.clientX);
			setRange({ from: time, to: time });
		},
		onPointerMove: (event) => {
			if (range != null) setRange({ ...range, to: timeAt(event.clientX) });
		},
		onPointerUp: (event) => {
			if (range == null) return;
			const from = Math.min(range.from, range.to);
			const to = Math.max(range.from, range.to);
			setRange(null);
			if ((to - from) * zoom < 3) {
				if (!event.shiftKey) cx.$selection.set([]);
				return;
			}
			const keys = lane.hits.filter((hit) => hit.time >= from && hit.time <= to).map((hit) => toHitKey(lane.id, hit.id));
			cx.$selection.set(event.shiftKey ? [...new Set([...selection, ...keys])] : keys);
		}
	};

	const element =
		range != null ? (
			<span
				className="pointer-events-none absolute top-1 bottom-1 z-10 rounded-[3px] border border-[var(--accent-strong)] bg-[var(--selection)]"
				style={{ left: Math.min(range.from, range.to) * zoom, width: Math.abs(range.to - range.from) * zoom }}
			/>
		) : null;

	return { handlers, element, isLaneSelected };
}

interface TMarquee {
	handlers: {
		onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
		onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
		onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
	};
	element: React.ReactNode;
	isLaneSelected: boolean;
}

/** Whether an event landed on the piano roll itself or one of its semitone rows, not on a note */
function isRollBackground(event: React.MouseEvent<HTMLElement>): boolean {
	return event.target === event.currentTarget || (event.target as HTMLElement).classList.contains('mm-piano-row');
}

/** Fill state: hollow until a piece plays the hit, then the lane color, red when it misses */
function hitState(status: THitResult | undefined): 'open' | 'placed' | 'drifting' | 'missed' {
	switch (status?.status) {
		case 'onTime':
			return 'placed';
		case 'drifting':
			return 'drifting';
		case 'missed':
		case 'blocked':
			return 'missed';
		default:
			return 'open';
	}
}

function hitTitle(index: number, hit: THit, status: THitResult | undefined, isConflict: boolean): string {
	const state = { open: 'No piece yet', placed: 'On time', drifting: 'Drifting', missed: 'Missed' }[hitState(status)];
	const note = hit.pitch == null ? '' : ` · ${noteName(hit.pitch)}`;
	const warning = isConflict ? ` · closer than ${MIN_HIT_GAP * 1000} ms to a neighbor` : '';
	return `Hit ${index + 1}${note} · ${formatTime(hit.time)} · ${state}${warning}`;
}
