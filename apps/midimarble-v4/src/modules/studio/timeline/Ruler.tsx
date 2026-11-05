import { useFeatureState } from 'feature-react/state';
import React from 'react';
import { openContextMenu } from '@/components';
import { renderedSpans } from '@/modules/design/live-preview';
import { commandItem } from '../commands';
import { draggedRepeatSpan, shownRepeatRange, type TRepeatRangeDrag } from '../repeat-range';
import { formatTime } from '../format';
import type { StudioCx } from '../StudioCx';
import { formatRulerTime, RULER_HEIGHT, rulerSteps, TIME_INSET, TIME_ORIGIN } from './timeline-layout';

/**
 * Time ruler with minor and major ticks, the playhead head and the draggable project end. Like Logic's ruler it runs
 * on past the end, so the end can be dragged out, but the time past the end is shaded and its ticks dimmed, so the
 * film visibly stops at the end bracket.
 */
export const Ruler: React.FC<TRulerProps> = (props) => {
	const { cx, end, zoom, width, timeAt } = props;
	const [endDrag, setEndDrag] = React.useState<number | null>(null);
	const { step, minor } = rulerSteps(zoom);
	const shownEnd = endDrag ?? end;
	// The ruler can grow past the project to fill a wide window
	const labels = Array.from({ length: Math.floor(Math.max(width, window.innerWidth) / zoom / step) + 1 }, (_, index) => index * step);

	function seek(clientX: number): void {
		const time = Math.min(end, timeAt(clientX));
		cx.$playhead.set(time);
		cx.audioScrubTo(time);
	}

	return (
		<div
			className="mm-ruler relative flex-1 border-b border-[var(--separator)]"
			style={{ minWidth: width, backgroundImage: `repeating-linear-gradient(to right, var(--text-tertiary) 0 1px, transparent 1px ${minor * zoom}px)` }}
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				event.currentTarget.setPointerCapture(event.pointerId);
				cx.beginAudioScrub();
				seek(event.clientX);
			}}
			onPointerUp={() => cx.endAudioScrub()}
			onPointerCancel={() => cx.endAudioScrub()}
			onContextMenu={(event) => openContextMenu(event, [commandItem(cx, 'film.fitToSong')])}
			onPointerMove={(event) => {
				if (event.buttons === 1 && endDrag == null) seek(event.clientX);
			}}
		>
			{labels.map((tick) => (
				<span key={tick} className="pointer-events-none absolute bottom-0" style={{ left: tick * zoom }}>
					<span className="absolute bottom-0 h-[9px] w-px bg-[var(--text-tertiary)]" />
					<span className="mm-tabular absolute bottom-[7px] left-[3px] text-[11px] leading-none whitespace-nowrap text-[var(--text-secondary)]">
						{formatRulerTime(tick, step)}
					</span>
				</span>
			))}
			<span className="mm-ruler-past-end pointer-events-none absolute top-0 bottom-0" style={{ left: shownEnd * zoom, right: 0 }} />
			<span
				className="absolute top-0 bottom-0 z-10 flex w-3 -translate-x-full cursor-ew-resize items-stretch justify-end"
				style={{ left: shownEnd * zoom }}
				title={`Film end ${formatTime(shownEnd)}. Drag to change.`}
				onPointerDown={(event) => {
					if (event.button !== 0) return;
					event.stopPropagation();
					event.currentTarget.setPointerCapture(event.pointerId);
					setEndDrag(end);
				}}
				onPointerMove={(event) => {
					if (endDrag != null) setEndDrag(Math.max(0.5, Math.round(timeAt(event.clientX) * 20) / 20));
				}}
				onPointerUp={() => {
					if (endDrag != null && Math.abs(endDrag - end) > 1e-6) cx.execute([{ type: 'setEnd', end: endDrag }]);
					setEndDrag(null);
				}}
			>
				{/* End bracket, like the end marker of a Logic project */}
				<span className="w-[3px] rounded-l-[1px] bg-[var(--text-secondary)]" />
			</span>
			<RepeatStrip cx={cx} end={end} zoom={zoom} timeAt={timeAt} />
			<RenderBar cx={cx} zoom={zoom} />
			<PlayheadHead cx={cx} zoom={zoom} />
		</div>
	);
};

interface TRulerProps {
	cx: StudioCx;
	end: number;
	zoom: number;
	width: number;
	timeAt: (clientX: number) => number;
}

// How close to an edge of the Repeat Range, in pixels, a press takes that edge
const REPEAT_EDGE_PX = 5;

/** The Repeat range along the top of the ruler, only while Repeat is on, as a video editor's loop range: its edges and body drag */
const RepeatStrip: React.FC<{ cx: StudioCx; end: number; zoom: number; timeAt: (clientX: number) => number }> = (props) => {
	const { cx, end, zoom, timeAt } = props;
	const stored = useFeatureState(cx.$repeatRange);
	// A range exists on the ruler only while Repeat is on, so moving the playhead can never start one
	const shown = shownRepeatRange(stored, cx.project?.id, end);
	const range = shown?.isOn === true ? shown : null;
	const dragRef = React.useRef<TRepeatRangeDrag | null>(null);
	if (range == null) return null;

	function onPointerDown(event: React.PointerEvent<HTMLElement>): void {
		if (event.button !== 0 || range == null) return;
		event.stopPropagation();
		event.currentTarget.setPointerCapture(event.pointerId);
		const time = timeAt(event.clientX);
		const edge = REPEAT_EDGE_PX / zoom;
		dragRef.current = Math.abs(time - range.start) <= edge ? { mode: 'start', range } : Math.abs(time - range.end) <= edge ? { mode: 'end', range } : { mode: 'move', range, grabbedAt: time };
	}

	function onPointerMove(event: React.PointerEvent<HTMLElement>): void {
		const drag = dragRef.current;
		if (drag == null) return;
		// The ruler around the range scrubs on a move; this drag is the range's
		event.stopPropagation();
		cx.setRepeatSpan(draggedRepeatSpan(drag, timeAt(event.clientX), end));
	}

	return (
		<span
			className="mm-repeat-range"
			style={{ left: range.start * zoom, width: (range.end - range.start) * zoom }}
			title={`Repeats ${formatTime(range.start)} to ${formatTime(range.end)}. Drag it or its edges; the Repeat button removes it (C)`}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={() => (dragRef.current = null)}
			onPointerCancel={() => (dragRef.current = null)}
		/>
	);
};

/**
 * Film's render bar, like Final Cut's: the separator line between the ruler and the rows fills green over each span
 * Blender has rendered in the background. Where nothing is rendered the ruler's own separator shows.
 */
const RenderBar: React.FC<{ cx: StudioCx; zoom: number }> = (props) => {
	const { cx, zoom } = props;
	const workspace = useFeatureState(cx.$workspace);
	const frames = useFeatureState(cx.design.live.$frames);
	const isEnabled = useFeatureState(cx.design.live.$enabled);
	const isRendering = useFeatureState(cx.design.live.$isRendering);
	const spans = React.useMemo(() => (frames != null ? renderedSpans(frames.rendered, frames.fps, frames.startTime) : []), [frames]);
	if (workspace !== 'design' || !isEnabled || frames == null || (!isRendering && spans.length === 0)) return null;
	const songEnd = frames.startTime + frames.total / frames.fps;
	return (
		<span className="mm-render-bar" style={{ left: frames.startTime * zoom, width: (songEnd - frames.startTime) * zoom }} title={isRendering ? 'Rendering in Blender…' : undefined}>
			{spans.map((span) => (
				<span
					key={span.start}
					className="mm-render-span"
					style={{ left: (span.start - frames.startTime) * zoom, width: (span.end - span.start) * zoom }}
					title={isRendering ? 'Rendered in Blender. Rendering more…' : 'Rendered in Blender'}
				/>
			))}
		</span>
	);
};

/** Playhead head on the ruler. It subscribes on its own so playback re-renders only the head and line. */
const PlayheadHead: React.FC<{ cx: StudioCx; zoom: number }> = (props) => {
	const { cx, zoom } = props;
	const playhead = useFeatureState(cx.$playhead);
	return (
		<svg className="pointer-events-none absolute top-0 z-20" width={13} height={RULER_HEIGHT} style={{ left: playhead * zoom - 6.5 }} aria-hidden>
			<path d={`M1 2.5 Q1 1 2.5 1 H10.5 Q12 1 12 2.5 V${RULER_HEIGHT - 9} L6.5 ${RULER_HEIGHT - 3} L1 ${RULER_HEIGHT - 9} Z`} fill="var(--playhead)" />
		</svg>
	);
};

export const PlayheadLine: React.FC<{ cx: StudioCx; zoom: number; scrollRef: React.RefObject<HTMLDivElement | null> }> = (props) => {
	const { cx, zoom, scrollRef } = props;
	const playhead = useFeatureState(cx.$playhead);
	const x = playhead * zoom;

	// Keep the playhead in view while playing, paging like Logic
	React.useEffect(() => {
		const element = scrollRef.current;
		if (element == null || !cx.$playing.get()) return;
		const visible = element.clientWidth - TIME_ORIGIN;
		if (x > element.scrollLeft + visible - 40) element.scrollLeft = x - 80;
		if (x < element.scrollLeft) element.scrollLeft = Math.max(0, x - 80);
	}, [cx, scrollRef, x]);

	return <div className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-[var(--playhead)]" style={{ left: TIME_ORIGIN + x }} />;
};

/** The room between a row's header and its time 0, so the playhead's head shows whole at 0:00; it carries the row's line */
export const TimeGutter: React.FC<{ isRuler?: boolean }> = ({ isRuler = false }) => <div className={`${isRuler ? 'mm-ruler ' : ''}shrink-0 border-b border-[var(--separator)]`} style={{ width: TIME_INSET }} aria-hidden />;
