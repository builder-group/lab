import { useFeatureState } from 'feature-react/state';
import { Plus } from 'lucide-react';
import React from 'react';
import { MenuButton } from '@/components';
import { isEditingTarget } from '@/lib';
import type { THitResult } from '@/modules/simulation';
import { addMenu } from '../add-menu';
import { addHit } from '../menus';
import { parseHitKey, toHitKey } from '../selection';
import { songSource } from '../SourcesCx';
import { isLaneAudible, type StudioCx } from '../StudioCx';
import { CameraRow } from './CameraRow';
import { handNotes, isNoteSelection, ownerForKey } from './hand-notes';
import { LaneTrack, PianoRollTrack, type TDrag, type TDragStart } from './LaneTrack';
import { pitchDeltaFor, pitchRange, rowCount } from './piano-roll';
import { PlayheadLine, Ruler } from './Ruler';
import { songRange } from './SongRoll';
import { EmptySongTrack, SongTrack } from './SongTrack';
import {
	CAMERA_ROW_HEIGHT,
	clampZoom,
	fittedHeight,
	HEADER_WIDTH,
	MIN_HEIGHT,
	NOTE_ROW_HEIGHT,
	ROW_HEIGHT,
	round,
	RULER_HEIGHT,
	SONG_ROLL_MAX_HEIGHT,
	SONG_ROW_HEIGHT
} from './timeline-layout';
import { $expandedLanes, $songExpanded } from './timeline-state';
import { TitlesRow } from './TitlesRow';
import { TrackHeader } from './TrackHeader';
import { Transport } from './Transport';

/**
 * The Tracks as a Blender-style dope sheet in a Logic-style track area: the transport and hit summary in the
 * header, the Song on top, expandable into every note, then one track per marble with mute and solo, its hits
 * in a flat row by timing status and expandable into a piano roll of its notes
 */
export const Timeline: React.FC<TTimelineProps> = (props) => {
	const { cx } = props;
	const history = useFeatureState(cx.$history);
	const selection = useFeatureState(cx.$selection);
	const analysis = useFeatureState(cx.sources.$analysis);
	const result = useFeatureState(cx.simulation.$result);
	const mix = useFeatureState(cx.$mix);
	const height = useFeatureState(cx.$timelineHeight);
	const workspace = useFeatureState(cx.$workspace);
	const expanded = useFeatureState($expandedLanes);
	const isSongExpanded = useFeatureState($songExpanded);
	const scrollRef = React.useRef<HTMLDivElement>(null);
	const [zoom, setZoom] = React.useState(80);
	const [drag, setDrag] = React.useState<TDrag | null>(null);
	const project = history?.present;

	const song = project == null ? undefined : songSource(project);
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

	// Pitch rows of every track that can expand; a dragged note keeps its rows until it is dropped
	const ranges = React.useMemo(() => new Map((project?.music.lanes ?? []).map((lane) => [lane.id, pitchRange(lane)])), [project?.music.lanes]);
	const songRows = React.useMemo(() => (project == null || song?.kind !== 'midi' ? null : songRange(project)), [project, song?.kind]);

	// With notes selected, 1 to 9 hand them to that marble in track order and 0 makes them Backing. Captured
	// before the canvas, whose 0 previews the film camera.
	React.useEffect(() => {
		function onKeyDown(event: KeyboardEvent): void {
			if (event.metaKey || event.ctrlKey || event.altKey || isEditingTarget(event) || !/^[0-9]$/.test(event.key)) return;
			const current = cx.project;
			const keys = cx.$selection.get();
			if (current == null || !isNoteSelection(keys)) return;
			const owner = ownerForKey(current, event.key);
			if (owner == null) return;
			event.preventDefault();
			// Other window listeners, such as the canvas's, must not see the key as well
			event.stopImmediatePropagation();
			handNotes(cx, keys, owner);
		}
		window.addEventListener('keydown', onKeyDown, true);
		return () => window.removeEventListener('keydown', onKeyDown, true);
	}, [cx]);

	// A track selected in Layers scrolls into view below the sticky ruler, like Final Cut's timeline index
	const first = selection[0];
	React.useEffect(() => {
		const element = scrollRef.current;
		if (element == null || first == null) return;
		const header = element.querySelector(`[data-track="${CSS.escape(first)}"]`);
		if (header == null) return;
		const view = element.getBoundingClientRect();
		const rect = header.getBoundingClientRect();
		if (rect.top < view.top + RULER_HEIGHT) element.scrollTop -= view.top + RULER_HEIGHT - rect.top;
		else if (rect.bottom > view.bottom) element.scrollTop += rect.bottom - view.bottom;
	}, [first]);

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

	const startDrag: TDragStart = (hitKey, event, isPitched) => {
		const keys = selection.includes(hitKey) ? selection : [hitKey];
		const grabbed = parseHitKey(hitKey);
		if (grabbed == null) return;
		cx.$selection.set(keys);
		setDrag({ originX: event.clientX, originY: event.clientY, delta: 0, pitchDelta: 0, isPitched, keys, grabbed });
	};

	/** Moves the dragged hits in time, and in pitch for a piano roll drag, as one undo step */
	function commitDrag(finished: TDrag): void {
		if (project == null || (finished.delta === 0 && finished.pitchDelta === 0)) return;
		const commands = project.music.lanes.flatMap((lane) => {
			const range = ranges.get(lane.id);
			const moved = lane.hits
				.filter((hit) => finished.keys.includes(toHitKey(lane.id, hit.id)))
				.map((hit) => {
					const pitch = finished.isPitched && hit.pitch != null && range != null ? Math.min(range.high, Math.max(range.low, hit.pitch + finished.pitchDelta)) : hit.pitch;
					return { ...hit, time: round(Math.max(0, hit.time + finished.delta)), pitch };
				});
			return moved.length ? [{ type: 'upsertHits' as const, laneId: lane.id, hits: moved }] : [];
		});
		if (!cx.execute(commands) || finished.pitchDelta === 0) return;
		const { laneId, hitId } = finished.grabbed;
		const pitch = cx.project?.music.lanes.find((lane) => lane.id === laneId)?.hits.find((hit) => hit.id === hitId)?.pitch;
		cx.audition(laneId, pitch);
	}

	/** Zooms around a point in the track area, keeping the time under it in place */
	const zoomTo = React.useCallback(
		(next: number, clientX?: number) => {
			const element = scrollRef.current;
			if (element == null) return;
			const clamped = clampZoom(next);
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
		setZoom(clampZoom((element.clientWidth - HEADER_WIDTH - 24) / project.end));
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
		setZoom(clampZoom((element.clientWidth - HEADER_WIDTH - 24) / end));
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
	const showsCamera = workspace === 'design';
	const laneHeights = project.music.lanes.map((lane) => {
		const range = ranges.get(lane.id);
		return expanded.includes(lane.id) && range != null ? rowCount(range) * NOTE_ROW_HEIGHT : ROW_HEIGHT;
	});
	const songHeight = isSongExpanded && songRows != null ? Math.min(SONG_ROLL_MAX_HEIGHT, Math.max(SONG_ROW_HEIGHT, rowCount(songRows) * NOTE_ROW_HEIGHT)) : SONG_ROW_HEIGHT;
	const rowsHeight = laneHeights.reduce((sum, value) => sum + value, 0) + (song != null ? songHeight : 0) + (showsCamera ? CAMERA_ROW_HEIGHT : 0);

	// MARK: - UI

	return (
		<section
			className="relative flex shrink-0 flex-col border-t border-[var(--separator)] bg-[var(--content)]"
			style={{ height: height > 0 ? height : fittedHeight(rowsHeight) }}
			aria-label="Timeline"
		>
			<ResizeHandle cx={cx} />
			<Transport cx={cx} results={result?.hits ?? null} zoom={zoom} onZoom={(next) => zoomTo(next)} onZoomToFit={zoomToFit} />
			<div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
				<div className="relative flex min-h-full min-w-full flex-col" style={{ width: HEADER_WIDTH + trackWidth }}>
					<div className="sticky top-0 z-30 flex shrink-0" style={{ height: RULER_HEIGHT }}>
						<div
							className="mm-track-header sticky left-0 z-10 flex shrink-0 items-center gap-0.5 border-r border-b border-[var(--separator)] pr-1.5 pl-3"
							style={{ width: HEADER_WIDTH }}
							data-quick-help="tracks"
						>
							<span className="flex-1 text-[11px] font-semibold text-[var(--text-secondary)]">Tracks</span>
							<MenuButton className="mm-icon-button !h-5 !w-5" label={<Plus size={13} strokeWidth={2} />} title="Add" items={addMenu(cx)} />
						</div>
						<Ruler cx={cx} end={project.end} zoom={zoom} width={trackWidth} timeAt={timeAt} />
					</div>
					{song != null ? (
						<SongTrack
							cx={cx}
							project={project}
							song={song}
							analysis={analysis[song.id]}
							zoom={zoom}
							width={trackWidth}
							range={songRows}
							isExpanded={isSongExpanded && songRows != null}
							height={songHeight}
							selection={selection}
						/>
					) : (
						<EmptySongTrack cx={cx} width={trackWidth} />
					)}
					{project.music.lanes.map((lane, index) => {
						const range = ranges.get(lane.id) ?? null;
						const isExpanded = expanded.includes(lane.id) && range != null;
						const trackProps = {
							cx,
							lane,
							zoom,
							width: trackWidth,
							selection,
							drag,
							statuses: hitStatus.get(lane.id),
							isAudible: isLaneAudible(mix, lane.id),
							onDragStart: startDrag,
							timeAt
						};
						return (
							<div key={lane.id} className="flex shrink-0" style={{ height: laneHeights[index] }}>
								<TrackHeader cx={cx} lane={lane} project={project} selection={selection} hasRecording={hasRecording} range={range} isExpanded={isExpanded} height={laneHeights[index] ?? ROW_HEIGHT} />
								{isExpanded && range != null ? (
									<PianoRollTrack {...trackProps} range={range} />
								) : (
									<LaneTrack {...trackProps} onAdd={(time, event) => addHit(cx, lane, snap(time, event.altKey))} />
								)}
							</div>
						);
					})}
					{!project.music.lanes.length ? (
						<div className="mm-placeholder !h-auto !items-start py-6" style={{ paddingLeft: HEADER_WIDTH + 24 }}>
							<span className="mm-placeholder-title">No Marbles</span>
							<span className="mm-placeholder-body">Import a MIDI file with ⌘I, drop one on the window or add a marble with +.</span>
						</div>
					) : null}
					{/* The track column is the timed part of the Layers outline, in the same order: Song, marbles, Camera */}
					{showsCamera ? <CameraRow cx={cx} project={project} zoom={zoom} width={trackWidth} selection={selection} timeAt={timeAt} /> : null}
					{showsCamera ? <TitlesRow cx={cx} project={project} zoom={zoom} width={trackWidth} selection={selection} timeAt={timeAt} /> : null}
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
					onMove={(next) => setDrag(next)}
					onEnd={(finished) => {
						setDrag(null);
						commitDrag(finished);
					}}
				/>
			) : null}
		</section>
	);
};

interface TTimelineProps {
	cx: StudioCx;
}

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
				const element = event.currentTarget.parentElement;
				startRef.current = { y: event.clientY, height: cx.$timelineHeight.get() || (element?.getBoundingClientRect().height ?? 212) };
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
			onDoubleClick={() => cx.$timelineHeight.set(0)}
		/>
	);
};

/** Captures pointer movement for a hit drag across the whole window; piano roll drags also move in pitch */
const DragLayer: React.FC<{ drag: TDrag; zoom: number; onMove: (drag: TDrag) => void; onEnd: (drag: TDrag) => void }> = (props) => {
	const { drag, zoom, onMove, onEnd } = props;

	function moved(event: React.PointerEvent): TDrag {
		return {
			...drag,
			delta: (event.clientX - drag.originX) / zoom,
			pitchDelta: drag.isPitched ? pitchDeltaFor(event.clientY - drag.originY, NOTE_ROW_HEIGHT) : 0
		};
	}

	return (
		<div
			className="fixed inset-0 z-50"
			style={{ cursor: drag.isPitched ? 'move' : 'ew-resize' }}
			onPointerMove={(event) => onMove(moved(event))}
			onPointerUp={(event) => onEnd(moved(event))}
			onPointerCancel={() => onEnd({ ...drag, delta: 0, pitchDelta: 0 })}
		/>
	);
};
