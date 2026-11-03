import { useFeatureState } from 'feature-react/state';
import { ArrowLeftRight, Minus, Plus } from 'lucide-react';
import React from 'react';
import { openContextMenu, RenameField } from '@/components';
import { findLaneConflicts, instruments, MIN_HIT_GAP } from '@/modules/music';
import type { TLane, TProject } from '@/modules/project';
import { createLoop, type THitResult } from '@/modules/simulation';
import { formatTime } from './format';
import { addHit, hitMenu, laneMenu } from './menus';
import { toHitKey } from './selection';
import { isLaneAudible, type StudioCx } from './StudioCx';
import type { TSourceAnalysis } from './SourcesCx';

const HEADER_WIDTH = 232;
const RULER_HEIGHT = 24;
const ROW_HEIGHT = 44;
const MIN_ZOOM = 20;
const MAX_ZOOM = 800;
const MIN_HEIGHT = 120;

/**
 * Music lanes as a Blender-style dope sheet in a Logic-style track area: sticky track headers with
 * mute and solo, a ruler with a playhead head and a draggable project end, and hit diamonds that show
 * whether a piece plays them on time
 */
export const Timeline: React.FC<TTimelineProps> = (props) => {
	const { cx } = props;
	const history = useFeatureState(cx.$history);
	const selection = useFeatureState(cx.$selection);
	const analysis = useFeatureState(cx.sources.$analysis);
	const result = useFeatureState(cx.simulation.$result);
	const mix = useFeatureState(cx.$mix);
	const height = useFeatureState(cx.$timelineHeight);
	const scrollRef = React.useRef<HTMLDivElement>(null);
	const [zoom, setZoom] = React.useState(80);
	const [drag, setDrag] = React.useState<TDrag | null>(null);
	const project = history?.present;

	const audio = project?.music.sources.find((source) => source.kind === 'audio');
	const audioAnalysis = audio == null ? undefined : analysis[audio.id];
	const trackWidth = Math.max((project?.end ?? 1) * zoom + 120, 0);

	// Hit results by lane, so a lane row re-renders only with a new simulation result
	const hitStatus = React.useMemo(() => {
		const byLane = new Map<string, Map<string, THitResult>>();
		for (const hit of result?.hits ?? []) {
			const lane = byLane.get(hit.laneId) ?? new Map<string, THitResult>();
			lane.set(hit.hitId, hit);
			byLane.set(hit.laneId, lane);
		}
		return byLane;
	}, [result]);

	// MARK: - Actions

	const timeAt = React.useCallback(
		(clientX: number): number => {
			const element = scrollRef.current;
			if (element == null) return 0;
			const rect = element.getBoundingClientRect();
			return Math.max(0, (clientX - rect.left + element.scrollLeft - HEADER_WIDTH) / zoom);
		},
		[zoom]
	);

	const snap = React.useCallback(
		(time: number, disabled: boolean): number => {
			if (disabled || audio == null || audioAnalysis == null) return time;
			let best = time;
			let bestDistance = 8 / zoom;
			for (const onset of audioAnalysis.onsets) {
				const distance = Math.abs(onset + audio.offset - time);
				if (distance < bestDistance) {
					best = onset + audio.offset;
					bestDistance = distance;
				}
			}
			return best;
		},
		[audio, audioAnalysis, zoom]
	);

	function commitMove(delta: number): void {
		if (project == null || delta === 0) return;
		const commands = project.music.lanes.flatMap((lane) => {
			const moved = lane.hits
				.filter((hit) => selection.includes(toHitKey(lane.id, hit.id)))
				.map((hit) => ({ ...hit, time: round(Math.max(0, hit.time + delta)) }));
			return moved.length ? [{ type: 'upsertHits' as const, laneId: lane.id, hits: moved }] : [];
		});
		cx.execute(commands);
	}

	/** Zooms around a point in the track area, keeping the time under it in place */
	const zoomTo = React.useCallback(
		(next: number, clientX?: number) => {
			const element = scrollRef.current;
			if (element == null) return;
			const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
			const rect = element.getBoundingClientRect();
			const x = clientX == null ? HEADER_WIDTH + (rect.width - HEADER_WIDTH) / 2 : clientX - rect.left;
			const anchor = (x + element.scrollLeft - HEADER_WIDTH) / zoom;
			setZoom(clamped);
			requestAnimationFrame(() => {
				element.scrollLeft = anchor * clamped + HEADER_WIDTH - x;
			});
		},
		[zoom]
	);

	function zoomToFit(): void {
		const element = scrollRef.current;
		if (element == null || project == null) return;
		setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (element.clientWidth - HEADER_WIDTH - 24) / project.end)));
		requestAnimationFrame(() => {
			element.scrollLeft = 0;
		});
	}

	// A newly opened project shows its whole length, like View All in Blender
	const projectId = project?.id;
	React.useEffect(() => {
		const element = scrollRef.current;
		const end = cx.project?.end;
		if (element == null || end == null || projectId == null) return;
		setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (element.clientWidth - HEADER_WIDTH - 24) / end)));
		element.scrollLeft = 0;
	}, [cx, projectId]);

	// Zoom around the pointer with pinch or Command-scroll, like Logic
	React.useEffect(() => {
		const element = scrollRef.current;
		if (element == null) return;
		function onWheel(event: WheelEvent): void {
			if (!event.ctrlKey && !event.metaKey) return;
			event.preventDefault();
			zoomTo(zoom * Math.exp(-event.deltaY * 0.01), event.clientX);
		}
		element.addEventListener('wheel', onWheel, { passive: false });
		return () => element.removeEventListener('wheel', onWheel);
	}, [zoom, zoomTo]);

	if (project == null) return null;
	const hasRecording = audio != null;

	// MARK: - UI

	return (
		<section
			className="relative flex shrink-0 flex-col border-t border-[var(--separator)] bg-[var(--content)]"
			style={{ height }}
			aria-label="Timeline"
		>
			<ResizeHandle cx={cx} />
			<div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
				<div className="relative flex min-h-full min-w-full flex-col" style={{ width: HEADER_WIDTH + trackWidth }}>
					<div className="sticky top-0 z-30 flex shrink-0" style={{ height: RULER_HEIGHT }}>
						<div
							className="mm-track-header sticky left-0 z-10 flex shrink-0 items-center gap-0.5 border-r border-b border-[var(--separator)] pr-1.5 pl-4"
							style={{ width: HEADER_WIDTH }}
						>
							<span className="flex-1 text-[11px] font-semibold text-[var(--text-secondary)]">Marbles</span>
							<button className="mm-icon-button !h-5 !w-5" onClick={() => zoomTo(zoom / 1.5)} title="Zoom Out (⌘ Scroll)" aria-label="Zoom Out" type="button">
								<Minus size={12} strokeWidth={2} />
							</button>
							<button className="mm-icon-button !h-5 !w-5" onClick={() => zoomTo(zoom * 1.5)} title="Zoom In (⌘ Scroll)" aria-label="Zoom In" type="button">
								<Plus size={12} strokeWidth={2} />
							</button>
							<button className="mm-icon-button !h-5 !w-5" onClick={zoomToFit} title="Zoom to Fit" aria-label="Zoom to Fit" type="button">
								<ArrowLeftRight size={12} strokeWidth={2} />
							</button>
						</div>
						<Ruler cx={cx} end={project.end} zoom={zoom} width={trackWidth} timeAt={timeAt} />
					</div>
					{project.music.lanes.map((lane) => (
						<div key={lane.id} className="flex shrink-0" style={{ height: ROW_HEIGHT }}>
							<LaneHeader cx={cx} lane={lane} project={project} selection={selection} hasRecording={hasRecording} />
							<LaneTrack
								cx={cx}
								lane={lane}
								zoom={zoom}
								width={trackWidth}
								selection={selection}
								drag={drag}
								statuses={hitStatus.get(lane.id)}
								isAudible={isLaneAudible(mix, lane.id)}
								audioOffset={audio?.offset ?? 0}
								analysis={audioAnalysis}
								onAdd={(time, event) => addHit(cx, lane, snap(time, event.altKey))}
								onDragStart={(hitKey, clientX) => {
									const keys = selection.includes(hitKey) ? selection : [hitKey];
									cx.$selection.set(keys);
									setDrag({ originX: clientX, delta: 0, keys });
								}}
								timeAt={timeAt}
							/>
						</div>
					))}
					{!project.music.lanes.length ? (
						<div className="mm-placeholder !h-auto !items-start py-6" style={{ paddingLeft: HEADER_WIDTH + 24 }}>
							<span className="mm-placeholder-title">No marbles</span>
							<span className="mm-placeholder-body">Import a MIDI file with ⌘I or add a marble from the sidebar.</span>
						</div>
					) : null}
					{/* The header column continues below the last lane, like Logic's track list */}
					<div className="flex flex-1">
						<div className="mm-track-header sticky left-0 z-20 shrink-0 border-r border-[var(--separator)]" style={{ width: HEADER_WIDTH }} />
					</div>
					{/* Outside the project range is shaded, like the area past Blender's end frame */}
					<div className="mm-out-of-range pointer-events-none absolute top-0 bottom-0" style={{ left: HEADER_WIDTH + project.end * zoom, right: 0 }} />
					<PlayheadLine cx={cx} zoom={zoom} scrollRef={scrollRef} />
				</div>
			</div>
			{drag != null ? (
				<DragLayer
					drag={drag}
					zoom={zoom}
					onMove={(delta) => setDrag({ ...drag, delta })}
					onEnd={(delta) => {
						setDrag(null);
						commitMove(delta);
					}}
				/>
			) : null}
		</section>
	);
};

interface TTimelineProps {
	cx: StudioCx;
}

interface TDrag {
	originX: number;
	delta: number;
	keys: string[];
}

// MARK: - Chrome

/** Splitter on the top edge; drag to resize like Logic's track area, double-click to reset */
const ResizeHandle: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const startRef = React.useRef<{ y: number; height: number } | null>(null);
	return (
		<div
			className="absolute -top-[3px] right-0 left-0 z-40 h-[6px] cursor-ns-resize"
			role="separator"
			aria-orientation="horizontal"
			aria-label="Resize timeline"
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				event.currentTarget.setPointerCapture(event.pointerId);
				startRef.current = { y: event.clientY, height: cx.$timelineHeight.get() };
			}}
			onPointerMove={(event) => {
				const start = startRef.current;
				if (start == null) return;
				const max = Math.max(MIN_HEIGHT, window.innerHeight * 0.6);
				cx.$timelineHeight.set(Math.round(Math.min(max, Math.max(MIN_HEIGHT, start.height - (event.clientY - start.y)))));
			}}
			onPointerUp={() => {
				startRef.current = null;
			}}
			onDoubleClick={() => cx.$timelineHeight.set(212)}
		/>
	);
};

const LaneHeader: React.FC<{ cx: StudioCx; lane: TLane; project: TProject; selection: string[]; hasRecording: boolean }> = (props) => {
	const { cx, lane, project, selection, hasRecording } = props;
	const mix = useFeatureState(cx.$mix);
	const [isRenaming, setIsRenaming] = React.useState(false);
	const marble = project.entities.find((entity) => entity.components.marble?.laneId === lane.id);
	const id = marble?.id ?? lane.id;
	const conflicts = findLaneConflicts(lane).size;
	const isSelected = selection.includes(id) || selection.some((key) => key.startsWith(`hit:${lane.id}:`));
	const instrument = hasRecording ? null : instruments.find((item) => item.program === lane.instrument)?.name;
	const details = [`${lane.hits.length} ${lane.hits.length === 1 ? 'hit' : 'hits'}`, conflicts > 0 ? `${conflicts} too close` : instrument].filter(Boolean).join(' · ');

	return (
		<div
			className="mm-track-header sticky left-0 z-20 flex shrink-0 items-center gap-1 border-r border-b border-[var(--separator)] pr-2"
			style={{ width: HEADER_WIDTH }}
			data-selected={isSelected}
			onContextMenu={(event) => openContextMenu(event, laneMenu(cx, lane))}
		>
			<span className="absolute top-0 bottom-0 left-0 w-[3px]" style={{ background: lane.color }} />
			<button
				className="flex h-full min-w-0 flex-1 flex-col justify-center pl-4 text-left leading-tight"
				onClick={() => cx.$selection.set([id])}
				onDoubleClick={() => setIsRenaming(true)}
				title="Double-click to rename"
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
				<>
					<TrackToggle label="M" title="Mute" isOn={mix.muted.includes(lane.id)} tone="mute" onClick={() => cx.toggleMute(lane.id)} />
					<TrackToggle label="S" title="Solo" isOn={mix.solo.includes(lane.id)} tone="solo" onClick={() => cx.toggleSolo(lane.id)} />
				</>
			)}
		</div>
	);
};

const TrackToggle: React.FC<{ label: string; title: string; isOn: boolean; tone: 'mute' | 'solo'; onClick: () => void }> = (props) => {
	const { label, title, isOn, tone, onClick } = props;
	return (
		<button className="mm-track-toggle" data-on={isOn} data-tone={tone} aria-pressed={isOn} aria-label={title} title={title} onClick={onClick} type="button">
			{label}
		</button>
	);
};

/** Time ruler with minor and major ticks, the playhead head and the draggable project end */
const Ruler: React.FC<{ cx: StudioCx; end: number; zoom: number; width: number; timeAt: (clientX: number) => number }> = (props) => {
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

/** The film range of a seamless loop as a bar along the top of the ruler, like Logic's cycle area */
const LoopRegion: React.FC<{ cx: StudioCx; zoom: number }> = (props) => {
	const { cx, zoom } = props;
	const result = useFeatureState(cx.simulation.$result);
	const project = cx.project;
	const loop = React.useMemo(
		() => (project?.design.loop === true && result != null ? createLoop(project, result) : null),
		[project, result]
	);
	if (loop == null) return null;
	return (
		<span
			className="pointer-events-none absolute top-0 h-[3px] rounded-[1px] bg-[var(--accent)] opacity-70"
			style={{ left: loop.start * zoom, width: loop.length * zoom }}
			title={`Loop ${formatTime(loop.start)} to ${formatTime(loop.end)}`}
		/>
	);
};

/** Label spacing of at least 56 px, with minor ticks between labels */
function rulerSteps(zoom: number): { step: number; minor: number } {
	const steps: [number, number][] = [
		[0.1, 2],
		[0.25, 5],
		[0.5, 5],
		[1, 4],
		[2, 4],
		[5, 5],
		[10, 5],
		[15, 3],
		[30, 3],
		[60, 4]
	];
	const [step, divisions] = steps.find(([candidate]) => candidate * zoom >= 56) ?? [60, 4];
	return { step, minor: step / divisions };
}

function formatRulerTime(seconds: number, step: number): string {
	const minutes = Math.floor(seconds / 60);
	const rest = seconds - minutes * 60;
	const decimals = step < 0.5 ? 2 : step < 1 ? 1 : 0;
	const text = rest.toFixed(decimals);
	return `${minutes}:${text.padStart(decimals > 0 ? decimals + 3 : 2, '0')}`;
}

// MARK: - Playhead

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

const PlayheadLine: React.FC<{ cx: StudioCx; zoom: number; scrollRef: React.RefObject<HTMLDivElement | null> }> = (props) => {
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

// MARK: - Lanes

const LaneTrack: React.FC<TLaneTrackProps> = (props) => {
	const { cx, lane, zoom, width, selection, drag, statuses, isAudible, audioOffset, analysis, onAdd, onDragStart, timeAt } = props;
	const conflicts = React.useMemo(() => findLaneConflicts(lane), [lane]);
	const pitches = lane.hits.map((hit) => hit.pitch).filter((pitch): pitch is number => pitch != null);
	const low = pitches.length ? Math.min(...pitches) : 60;
	const high = pitches.length ? Math.max(...pitches) : 72;
	const [marquee, setMarquee] = React.useState<{ from: number; to: number } | null>(null);
	const isLaneSelected = selection.some((key) => key.startsWith(`hit:${lane.id}:`));

	function pitchY(pitch: number | undefined): number {
		if (pitch == null || high === low) return ROW_HEIGHT / 2;
		return ROW_HEIGHT - 11 - ((pitch - low) / (high - low)) * (ROW_HEIGHT - 22);
	}

	return (
		<div
			className="relative flex-1 border-b border-[var(--separator)]"
			style={{ minWidth: width, background: isLaneSelected ? 'color-mix(in srgb, var(--text) 3%, transparent)' : undefined }}
			onPointerDown={(event) => {
				if (event.button !== 0 || event.target !== event.currentTarget) return;
				event.currentTarget.setPointerCapture(event.pointerId);
				const time = timeAt(event.clientX);
				setMarquee({ from: time, to: time });
			}}
			onPointerMove={(event) => {
				if (marquee != null) setMarquee({ ...marquee, to: timeAt(event.clientX) });
			}}
			onPointerUp={(event) => {
				if (marquee == null) return;
				const from = Math.min(marquee.from, marquee.to);
				const to = Math.max(marquee.from, marquee.to);
				setMarquee(null);
				if ((to - from) * zoom < 3) {
					if (!event.shiftKey) cx.$selection.set([]);
					return;
				}
				const keys = lane.hits.filter((hit) => hit.time >= from && hit.time <= to).map((hit) => toHitKey(lane.id, hit.id));
				cx.$selection.set(event.shiftKey ? [...new Set([...selection, ...keys])] : keys);
			}}
			onDoubleClick={(event) => {
				if (event.target !== event.currentTarget) return;
				onAdd(timeAt(event.clientX), event);
			}}
			onContextMenu={(event) => {
				if (event.target !== event.currentTarget) return;
				openContextMenu(event, laneMenu(cx, lane, timeAt(event.clientX)));
			}}
		>
			{analysis != null ? <Waveform analysis={analysis} offset={audioOffset} zoom={zoom} /> : null}
			{analysis?.onsets.map((onset) => (
				<span
					key={onset}
					className="pointer-events-none absolute bottom-0 h-1.5 w-px bg-[var(--text-tertiary)]"
					style={{ left: (onset + audioOffset) * zoom }}
				/>
			))}
			{!lane.hits.length ? (
				<span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[11px] text-[var(--text-tertiary)]">
					Double-click to add a hit, or press T while playing to tap along
				</span>
			) : null}
			{lane.hits.map((hit, index) => {
				const key = toHitKey(lane.id, hit.id);
				const selected = selection.includes(key);
				const offset = drag?.keys.includes(key) ? drag.delta : 0;
				const conflict = conflicts.has(hit.id);
				const status = statuses?.get(hit.id);
				// Hits of selected pieces are outlined, like keyframes of the selected object in Blender
				const isLinked = status?.pieceEntityId != null && selection.includes(status.pieceEntityId);
				return (
					<button
						key={hit.id}
						aria-label={`Hit ${index + 1} at ${formatTime(hit.time)}`}
						aria-pressed={selected}
						className="mm-hit"
						data-selected={selected}
						data-state={hitState(status)}
						data-conflict={conflict}
						data-linked={isLinked}
						style={{
							left: Math.max(0, hit.time + offset) * zoom,
							top: pitchY(hit.pitch),
							['--lane' as string]: lane.color,
							opacity: isAudible ? 1 : 0.4
						}}
						title={hitTitle(index, hit.time, status, conflict)}
						onPointerDown={(event) => {
							if (event.button !== 0) return;
							event.stopPropagation();
							if (event.shiftKey) {
								cx.$selection.set(selected ? selection.filter((item) => item !== key) : [...selection, key]);
								return;
							}
							cx.audition(lane.id, hit.pitch);
							onDragStart(key, event.clientX);
						}}
						onContextMenu={(event) => {
							event.stopPropagation();
							if (!selected) cx.$selection.set([key]);
							openContextMenu(event, hitMenu(cx, lane, hit.id));
						}}
						type="button"
					>
						<span />
					</button>
				);
			})}
			{marquee != null ? (
				<span
					className="pointer-events-none absolute top-1 bottom-1 rounded-[3px] border border-[var(--accent-strong)] bg-[var(--selection)]"
					style={{ left: Math.min(marquee.from, marquee.to) * zoom, width: Math.abs(marquee.to - marquee.from) * zoom }}
				/>
			) : null}
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
	audioOffset: number;
	analysis: TSourceAnalysis | undefined;
	onAdd: (time: number, event: React.MouseEvent) => void;
	onDragStart: (hitKey: string, clientX: number) => void;
	timeAt: (clientX: number) => number;
}

/** Diamond fill: hollow until a piece plays the hit, then the lane color, red when it misses */
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

function hitTitle(index: number, time: number, status: THitResult | undefined, conflict: boolean): string {
	const state = { open: 'No piece yet', placed: 'On time', drifting: 'Drifting', missed: 'Missed' }[hitState(status)];
	const warning = conflict ? ` · closer than ${MIN_HIT_GAP * 1000} ms to a neighbor` : '';
	return `Hit ${index + 1} · ${formatTime(time)} · ${state}${warning}`;
}

/** Faint waveform of the imported recording behind a lane */
const Waveform: React.FC<{ analysis: TSourceAnalysis; offset: number; zoom: number }> = (props) => {
	const { analysis, offset, zoom } = props;
	const canvasRef = React.useRef<HTMLCanvasElement>(null);
	const width = Math.ceil(analysis.duration * zoom);

	React.useEffect(() => {
		const canvas = canvasRef.current;
		const context = canvas?.getContext('2d');
		if (canvas == null || context == null) return;
		const scale = window.devicePixelRatio || 1;
		canvas.width = Math.min(width * scale, 32000);
		canvas.height = ROW_HEIGHT * scale;
		context.scale(canvas.width / width, scale);
		context.fillStyle = getComputedStyle(canvas).color;
		const perPixel = 1 / zoom / analysis.bucketSeconds;
		for (let x = 0; x < width; x++) {
			const start = Math.floor(x * perPixel);
			const end = Math.max(start + 1, Math.floor((x + 1) * perPixel));
			let peak = 0;
			for (let index = start; index < end && index < analysis.peaks.length; index++) {
				peak = Math.max(peak, analysis.peaks[index] ?? 0);
			}
			const height = Math.max(1, peak * (ROW_HEIGHT - 8));
			context.fillRect(x, (ROW_HEIGHT - height) / 2, 1, height);
		}
	}, [analysis, width, zoom]);

	return (
		<canvas
			ref={canvasRef}
			className="pointer-events-none absolute top-0 text-[var(--text-tertiary)] opacity-60"
			style={{ left: offset * zoom, width, height: ROW_HEIGHT }}
		/>
	);
};

/** Captures pointer movement for a hit drag across the whole window */
const DragLayer: React.FC<{ drag: TDrag; zoom: number; onMove: (delta: number) => void; onEnd: (delta: number) => void }> = (props) => {
	const { drag, zoom, onMove, onEnd } = props;
	return (
		<div
			className="fixed inset-0 z-50 cursor-ew-resize"
			onPointerMove={(event) => onMove((event.clientX - drag.originX) / zoom)}
			onPointerUp={(event) => onEnd((event.clientX - drag.originX) / zoom)}
			onPointerCancel={() => onEnd(0)}
		/>
	);
};

function round(value: number): number {
	return Math.round(value * 10000) / 10000;
}
