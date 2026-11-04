import { useFeatureState } from 'feature-react/state';
import React from 'react';
import { createLoop } from '@/modules/simulation';
import { formatTime } from '../format';
import type { StudioCx } from '../StudioCx';
import { formatRulerTime, HEADER_WIDTH, RULER_HEIGHT, rulerSteps } from './timeline-layout';

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
		cx.$playhead.set(Math.min(end, timeAt(clientX)));
	}

	return (
		<div
			className="mm-ruler relative flex-1 border-b border-[var(--separator)]"
			style={{ minWidth: width, backgroundImage: `repeating-linear-gradient(to right, var(--text-tertiary) 0 1px, transparent 1px ${minor * zoom}px)` }}
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				event.currentTarget.setPointerCapture(event.pointerId);
				seek(event.clientX);
			}}
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
				title={`Project end ${formatTime(shownEnd)}. Drag to change.`}
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
			<LoopRegion cx={cx} zoom={zoom} />
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

/** The film range of a seamless loop as a bar along the top of the ruler, like Logic's cycle area */
const LoopRegion: React.FC<{ cx: StudioCx; zoom: number }> = (props) => {
	const { cx, zoom } = props;
	const result = useFeatureState(cx.simulation.$result);
	const project = cx.project;
	const loop = React.useMemo(() => (project?.design.loop === true && result != null ? createLoop(project, result) : null), [project, result]);
	if (loop == null) return null;
	return (
		<span
			className="pointer-events-none absolute top-0 h-[3px] rounded-[1px] bg-[var(--accent)] opacity-70"
			style={{ left: loop.start * zoom, width: loop.length * zoom }}
			title={`Loop ${formatTime(loop.start)} to ${formatTime(loop.end)}`}
		/>
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
		const visible = element.clientWidth - HEADER_WIDTH;
		if (x > element.scrollLeft + visible - 40) element.scrollLeft = x - 80;
		if (x < element.scrollLeft) element.scrollLeft = Math.max(0, x - 80);
	}, [cx, scrollRef, x]);

	return <div className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-[var(--playhead)]" style={{ left: HEADER_WIDTH + x }} />;
};
