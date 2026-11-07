import { useFeatureState } from 'feature-react/state';
import React from 'react';
import { openContextMenu } from '@/components';
import { unreachableStatus, hitTiming, type THitTiming } from '@/modules/building';
import { findMarbleConflicts, isHitAudible, MIN_HIT_GAP, type TMix } from '@/modules/music';
import { playsOnlySong, type THit, type TMarble, toSongKey } from '@/modules/project';
import type { THitResult } from '@/modules/simulation';
import { formatTime, noteName, toHitKey } from '@/modules/project';
import { hitMenu, marbleMenu } from '../menus';
import type { StudioCx } from '../StudioCx';
import { addSuggestedHits, suggestedHits, suggestedHitsLabel } from '../suggested-hits';
import { offsetLabel } from '@/modules/canvas';
import { PatternStrip } from './PatternStrip';
import type { TPitchRange } from './piano-roll';
import type { TSongMove } from './SongTrack';
import { StartMarker } from './StartMarker';
import { PATTERN_STRIP_HEIGHT, ROW_HEIGHT, tieSpans } from './timeline-layout';

/**
 * The instruction itself, like GarageBand's empty track, not behind a ?, with the recording's suggested hits as a link
 * while the marble has none
 */
const EmptyMarbleHint: React.FC<{ cx: StudioCx; marble: TMarble; top: number }> = (props) => {
	const { cx, marble, top } = props;
	useFeatureState(cx.sources.$analysis);
	const suggested = suggestedHits(cx, marble).length;
	return (
		<span className="pointer-events-none absolute left-3 -translate-y-1/2 truncate text-[11px] text-[var(--text-tertiary)]" style={{ top }} data-hint-anchor="tap">
			No hits yet
			{suggested > 0 ? (
				<>
					{' · '}
					<button className="mm-link pointer-events-auto" onClick={() => addSuggestedHits(cx, marble)} onPointerDown={(event) => event.stopPropagation()} title="Add a hit for each beat found in the recording" type="button">
						{suggestedHitsLabel(suggested)}
					</button>
				</>
			) : null}
			{' · press T to tap along, or double-click to add a hit'}
		</span>
	);
};

/**
 * A marble's track: its hits in one flat row, each drawn by its timing status: green On Time, amber Early or
 * Late, red Missed, Blocked or Stopped, hollow Open, hollow amber dashed Too Soon or Out of Reach. Shapes differ too, so color is never the only signal.
 */
export const MarbleTrack: React.FC<TMarbleTrackProps> = (props) => {
	const { cx, marble, zoom, width, selection, drag, statuses, mix, move, songTints, onAdd, onDragStart, timeAt } = props;
	const conflicts = React.useMemo(() => findMarbleConflicts(marble), [marble]);
	const workspace = useFeatureState(cx.$workspace);
	const isTrack = workspace === 'track';
	const hitsTop = isTrack ? PATTERN_STRIP_HEIGHT : 0;
	const marquee = useMarquee(cx, marble, zoom, selection, timeAt, hitsTop);
	const ties = React.useMemo(() => tieSpans(marble.hits), [marble.hits]);

	return (
		<div
			className="mm-marble-track relative flex-1 border-b border-[var(--separator)]"
			style={{ minWidth: width, background: marquee.isMarbleSelected ? 'color-mix(in srgb, var(--text) 3%, transparent)' : undefined }}
			{...marquee.handlers}
			onDoubleClick={(event) => {
				if (event.target !== event.currentTarget) return;
				onAdd(timeAt(event.clientX), event);
			}}
			onContextMenu={(event) => {
				if (event.target !== event.currentTarget) return;
				openContextMenu(event, marbleMenu(cx, marble, timeAt(event.clientX)));
			}}
		>
			{isTrack ? <PatternStrip cx={cx} marble={marble} zoom={zoom} timeAt={timeAt} /> : null}
			{!marble.hits.length ? (
				<EmptyMarbleHint cx={cx} marble={marble} top={hitsTop + (ROW_HEIGHT - hitsTop) / 2} />
			) : null}
			{ties.map((tie) => {
				const shift = move?.songId === tie.songId ? move.delta : 0;
				return <span key={`${tie.songId}:${tie.from}`} className="mm-tie-line" data-selected={selection.includes(toSongKey(tie.songId))} style={{ left: (tie.from + shift) * zoom - 3, width: (tie.to - tie.from) * zoom + 6, background: songTints.get(tie.songId) }} aria-hidden />;
			})}
			<StartMarker
				cx={cx}
				marble={marble}
				zoom={zoom}
				top={hitsTop + (ROW_HEIGHT - hitsTop) / 2}
				shift={move != null && playsOnlySong(marble, move.songId) ? move.delta : 0}
				isSelected={selection.includes(marble.id)}
				length={cx.project?.length ?? Number.POSITIVE_INFINITY}
			/>
			{marble.hits.map((hit, index) => {
				const key = toHitKey(marble.id, hit.id);
				const offset = (drag?.keys.includes(key) === true ? drag.delta : 0) + (move != null && hit.songId === move.songId ? move.delta : 0);
				return (
					<HitButton
						key={hit.id}
						cx={cx}
						marble={marble}
						hit={hit}
						index={index}
						selection={selection}
						status={statuses?.get(hit.id)}
						isConflict={conflicts.has(hit.id)}
						style={{ left: Math.max(0, hit.time + offset) * zoom, top: hitsTop + (ROW_HEIGHT - hitsTop) / 2, opacity: hit.pitch == null || isHitAudible(mix, marble.id, hit.songId) ? 1 : 0.4 }}
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

interface TMarbleTrackProps {
	cx: StudioCx;
	marble: TMarble;
	zoom: number;
	width: number;
	selection: string[];
	drag: TDrag | null;
	statuses: Map<string, THitResult> | undefined;
	// Dims the notes that are muted or left out by a solo
	mix: TMix;
	move: TSongMove | null;
	// Each song's tint, for the line under the hits tied to it
	songTints: ReadonlyMap<string, string>;
	onAdd: (time: number, event: React.MouseEvent) => void;
	onDragStart: TDragStart;
	timeAt: (clientX: number) => number;
}

export interface TDrag {
	originX: number;
	originY: number;
	delta: number;
	// Semitones, only for drags that started in the Song's piano roll
	pitchDelta: number;
	isPitched: boolean;
	// The piano roll it started in, which keeps its pitches
	range: TPitchRange | null;
	keys: string[];
	// The grabbed note, auditioned at its new pitch on drop; `marbleId` is `BACKING_ID` for a Backing note
	grabbed: { marbleId: string; hitId: string };
}

export type TDragStart = (hitKey: string, event: { clientX: number; clientY: number }, isPitched: boolean, range?: TPitchRange | null) => void;

/** A hit diamond: click selects and plays its note if it has one, Shift-click toggles, drag moves */
const HitButton: React.FC<THitButtonProps> = (props) => {
	const { cx, marble, hit, index, selection, status, isConflict, style, onDragStart, children } = props;
	const key = toHitKey(marble.id, hit.id);
	const isSelected = selection.includes(key);
	// Hits of selected pieces are outlined, like keyframes of the selected object in Blender
	const isLinked = status?.pieceId != null && selection.includes(status.pieceId);
	const pieceRecord = status?.pieceId == null ? undefined : cx.project?.track.pieces.find((piece) => piece.id === status.pieceId);
	const piece = pieceRecord?.name;
	const project = cx.project;
	const unreachable = status?.status === 'open' && project != null ? unreachableStatus(project, cx.simulation.$result.get(), status) : null;
	const timing = hitTiming(status, { marble: marble.name, pitch: hit.pitch, piece }, unreachable);
	return (
		<button
			aria-label={`Hit ${index + 1}${hit.pitch == null ? '' : ` ${noteName(hit.pitch)}`} at ${formatTime(hit.time)}`}
			aria-pressed={isSelected}
			className="mm-hit"
			data-hit-key={key}
			data-selected={isSelected}
			data-state={timing.state}
			data-conflict={isConflict}
			data-linked={isLinked}
			style={{ ...style, ['--row-color' as string]: marble.labelColor }}
			title={hitTitle(index, hit, timing, isConflict, status?.error ?? null, cx.project?.songs.find((song) => song.id === hit.songId)?.name)}
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				event.stopPropagation();
				if (event.shiftKey) {
					cx.$selection.set(isSelected ? selection.filter((item) => item !== key) : [...selection, key]);
					return;
				}
				cx.audition(marble.id, hit.pitch);
				onDragStart(event);
			}}
			onContextMenu={(event) => {
				event.stopPropagation();
				if (!isSelected) cx.$selection.set([key]);
				openContextMenu(event, hitMenu(cx, marble, hit.id));
			}}
			type="button"
		>
			{children}
		</button>
	);
};

interface THitButtonProps {
	cx: StudioCx;
	marble: TMarble;
	hit: THit;
	index: number;
	selection: string[];
	status: THitResult | undefined;
	isConflict: boolean;
	style: React.CSSProperties;
	onDragStart: (event: { clientX: number; clientY: number }) => void;
	children?: React.ReactNode;
}

/** Time-range marquee on a track: dragging on empty space selects the hits it spans, Shift adds */
function useMarquee(cx: StudioCx, marble: TMarble, zoom: number, selection: string[], timeAt: (clientX: number) => number, top: number): TMarquee {
	const [range, setRange] = React.useState<{ from: number; to: number } | null>(null);
	const isMarbleSelected = selection.some((key) => key.startsWith(`hit:${marble.id}:`));

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
			const keys = marble.hits.filter((hit) => hit.time >= from && hit.time <= to).map((hit) => toHitKey(marble.id, hit.id));
			cx.$selection.set(event.shiftKey ? [...new Set([...selection, ...keys])] : keys);
			if (keys.length > 0) cx.$reveal.set({ ids: keys, isZoomKept: true });
		}
	};

	const element =
		range != null ? (
			<span
				className="pointer-events-none absolute bottom-1 z-10 rounded-[3px] border border-[var(--accent-strong)] bg-[var(--selection)]"
				style={{ top: top + 4, left: Math.min(range.from, range.to) * zoom, width: Math.abs(range.to - range.from) * zoom }}
			/>
		) : null;

	return { handlers, element, isMarbleSelected };
}

interface TMarquee {
	handlers: {
		onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
		onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
		onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
	};
	element: React.ReactNode;
	isMarbleSelected: boolean;
}

function hitTitle(index: number, hit: THit, timing: THitTiming, isConflict: boolean, error: number | null, songName: string | undefined): string {
	const note = hit.pitch == null ? '' : ` · ${noteName(hit.pitch)}`;
	const warning = isConflict ? ` · closer than ${MIN_HIT_GAP * 1000} ms to the next hit` : '';
	// A landed hit names its offset from the note; "12 ms Late" already does
	const offset = error != null && timing.state === 'onTime' ? ` (${offsetLabel(error)})` : '';
	const tied = songName == null || songName === '' ? '' : ` · moves with ${songName}`;
	return `Hit ${index + 1}${note} · ${formatTime(hit.time)}${tied} · ${timing.label}${offset}: ${timing.tooltip}${warning}`;
}
