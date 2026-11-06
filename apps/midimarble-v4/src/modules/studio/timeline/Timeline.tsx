import { useFeatureState } from 'feature-react/state';
import React from 'react';

import { isEditingTarget } from '@/lib';
import { currentMix } from '@/modules/music';
import type { THitResult } from '@/modules/simulation';
import { addHit } from '../menus';
import { TITLES_KEY } from '../outline';
import { CAMERA_KEY, parseHitKey, parseShotKey, shownSongs, type TSong, toHitKey } from '@/modules/project';
import { SONG_LAYER_LABEL } from '../song-layer';
import type { StudioCx } from '../StudioCx';
import { songFitEnd } from '../world';
import { CameraRow } from './CameraRow';
import { auditionNote, handNotes, isNoteSelection, ownerForKey, selectedNotes } from '@/modules/track';
import { MarbleTrack, type TDrag, type TDragStart } from './MarbleTrack';
import { noteDragCommands, pitchDeltaFor, rowCount, songRollRange, type TPitchRange } from './piano-roll';
import { PlayheadLine, Ruler, TimeGutter } from './Ruler';
import { SongTrack, type TSongMove } from './SongTrack';
import { CAMERA_ROW_HEIGHT, clampZoom, fittedHeight, HEADER_WIDTH, playheadScroll, TIME_DEAD_ZONE, TIME_ORIGIN, MIN_HEIGHT, NOTE_ROW_HEIGHT, ROW_HEIGHT, RULER_HEIGHT, SONG_ROLL_MAX_HEIGHT, SONG_ROW_HEIGHT, songTint } from './timeline-layout';
import { $expandedSongs } from './timeline-state';
import { TitlesRow } from './TitlesRow';
import { TrackHeader } from './TrackHeader';
import { flashElement } from '@/modules/canvas';
import { Transport } from './Transport';

/**
 * What changes over time, as a Blender-style dope sheet in a Logic-style track
 * area: the transport and hit summary in the header, one row per song on top, each expandable into
 * every note when it has notes, then the Camera, one flat row per marble with its hits by timing status, and in Film
 * Titles when there are any. Mute and Solo sit on the song's and each marble's header.
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
	const expandedSongs = useFeatureState($expandedSongs);
	const scrollRef = React.useRef<HTMLDivElement>(null);
	const [zoom, setZoom] = React.useState(80);
	const [drag, setDrag] = React.useState<TDrag | null>(null);
	const [move, setMove] = React.useState<TSongMove | null>(null);
	const project = history?.present;

	const songs = React.useMemo(() => (project == null ? [] : shownSongs(project)), [project]);
	const trackWidth = Math.max((project?.length ?? 1) * zoom + 120, 0);

	// Hit results by marble, so a marble row re-renders only with a new simulation result
	const hitStatus = React.useMemo(() => {
		const byMarble = new Map<string, Map<string, THitResult>>();
		for (const hit of result?.hits ?? []) {
			const marble = byMarble.get(hit.marbleId) ?? new Map<string, THitResult>();
			marble.set(hit.hitId, hit);
			byMarble.set(hit.marbleId, marble);
		}
		return byMarble;
	}, [result]);

	// A recording has no notes to expand; MIDI or Backing notes without a file expand into every note
	const songRows = React.useMemo(() => new Map(songs.map((song) => [song.id, project == null ? null : songRollRange(project, song)])), [project, songs]);

	const songTints = React.useMemo(() => new Map(project?.songs.map((item, index) => [item.id, songTint(index)]) ?? []), [project?.songs]);

	// The marble a hit added on a recording goes to: the one selected last, which selecting the song itself doesn't change
	const focusRef = React.useRef<string | null>(null);
	const focused = selection.map((key) => parseHitKey(key)?.marbleId ?? key).find((id) => project?.marbles.some((marble) => marble.id === id) === true);
	React.useEffect(() => {
		if (focused != null) focusRef.current = focused;
	}, [focused]);

	function addSongHit(onSong: TSong, time: number, event: React.MouseEvent): void {
		const marble = project?.marbles.find((item) => item.id === focusRef.current) ?? project?.marbles[0];
		if (marble != null) addHit(cx, marble, snap(time, event.altKey), onSong.id);
	}

	// The hit a marble just landed flashes in its status color. Set on the element, so no row re-renders while playing.
	React.useEffect(
		() =>
			cx.$hitFlash.listen(({ value }) => {
				for (const flash of value) {
					const element = scrollRef.current?.querySelector<HTMLElement>(`[data-hit-key="${CSS.escape(toHitKey(flash.marbleId, flash.hitId))}"]`);
					if (element != null) flashElement(element, flash.tone);
				}
			}),
		[cx]
	);

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

	// A playhead that moves out of view brings the rows along, so what's playing or was jumped to is on the ruler. A drag on
	// the ruler stays inside it, so it never pages while dragged.
	React.useEffect(
		() =>
			cx.$playhead.listen(({ value }) => {
				const element = scrollRef.current;
				if (element == null) return;
				const next = playheadScroll(value, zoom, element.scrollLeft, element.clientWidth);
				if (next != null) element.scrollLeft = next;
			}),
		[cx, zoom]
	);

	// A layer selected in Layers scrolls its row into view below the sticky ruler, like Final Cut's timeline index
	const first = selection[0];
	React.useEffect(() => {
		const element = scrollRef.current;
		if (element == null || first == null) return;
		// A title and a shot have their clip in a shared row
		const track = cx.project?.film.titles.some((title) => title.id === first) === true ? TITLES_KEY : parseShotKey(first) != null ? CAMERA_KEY : first;
		const header = element.querySelector(`[data-track="${CSS.escape(track)}"]`);
		if (header == null) return;
		const view = element.getBoundingClientRect();
		const rect = header.getBoundingClientRect();
		if (rect.top < view.top + RULER_HEIGHT) element.scrollTop -= view.top + RULER_HEIGHT - rect.top;
		else if (rect.bottom > view.bottom - SCROLLBAR_ROOM) element.scrollTop += rect.bottom - view.bottom + SCROLLBAR_ROOM;
	}, [cx, first]);

	// MARK: - Actions

	const timeAt = React.useCallback(
		(clientX: number): number => {
			const element = scrollRef.current;
			if (element == null) return 0;
			const rect = element.getBoundingClientRect();
			return Math.max(0, (clientX - rect.left + element.scrollLeft - TIME_ORIGIN) / zoom);
		},
		[zoom]
	);

	const snap = React.useCallback(
		(time: number, disabled: boolean): number => {
			if (disabled) return time;
			let best = time;
			let bestDistance = 8 / zoom;
			for (const song of songs) {
				if (song.kind !== 'audio') continue;
				for (const onset of analysis[song.id]?.onsets ?? []) {
					const distance = Math.abs(onset + song.start - time);
					if (distance < bestDistance) {
						best = onset + song.start;
						bestDistance = distance;
					}
				}
			}
			return best;
		},
		[songs, analysis, zoom]
	);

	const startDrag: TDragStart = (hitKey, event, isPitched, range = null) => {
		const keys = selection.includes(hitKey) ? selection : [hitKey];
		const grabbed = parseHitKey(hitKey);
		if (grabbed == null) return;
		cx.$selection.set(keys);
		setDrag({ originX: event.clientX, originY: event.clientY, delta: 0, pitchDelta: 0, isPitched, range, keys, grabbed });
	};

	/** Moves the dragged hits in time, and in pitch for a drag in the Song's piano roll, as one undo step */
	function commitDrag(finished: TDrag): void {
		if (project == null) return;
		const { marbleId, hitId } = finished.grabbed;
		const key = toHitKey(marbleId, hitId);
		if (finished.delta === 0 && finished.pitchDelta === 0) {
			// A plain click on one note of several selected in the roll selects just that note
			if (finished.isPitched && finished.keys.length > 1) cx.$selection.set([key]);
			return;
		}
		if (!cx.execute(noteDragCommands(project, finished, finished.range)) || finished.pitchDelta === 0) return;
		const current = cx.project;
		if (current != null) auditionNote(cx, marbleId, selectedNotes(current, [key])[0]?.hit.pitch);
	}

	/** Zooms around a point in the track area, keeping the time under it in place */
	const zoomTo = React.useCallback(
		(next: number, clientX?: number) => {
			const element = scrollRef.current;
			if (element == null) return;
			const clamped = clampZoom(next);
			const rect = element.getBoundingClientRect();
			const x = clientX == null ? TIME_ORIGIN + (rect.width - TIME_ORIGIN) / 2 : clientX - rect.left;
			const anchor = (x + element.scrollLeft - TIME_ORIGIN) / zoom;
			setZoom(clamped);
			requestAnimationFrame(() => {
				element.scrollLeft = anchor * clamped + TIME_ORIGIN - x;
			});
		},
		[zoom]
	);

	function zoomToFit(): void {
		const element = scrollRef.current;
		if (element == null || project == null) return;
		// The song, not a longer length the user set past it, like Figma's fit to the layers
		const span = Math.min(project.length, songFitEnd(project) ?? project.length);
		setZoom(clampZoom((element.clientWidth - TIME_ORIGIN - 24) / span));
		requestAnimationFrame(() => {
			element.scrollLeft = 0;
		});
	}

	// A newly opened project shows its whole length, like View All in Blender
	const projectId = project?.id;
	React.useEffect(() => {
		const element = scrollRef.current;
		const end = cx.project?.length;
		if (element == null || end == null || projectId == null) return;
		setZoom(clampZoom((element.clientWidth - TIME_ORIGIN - 24) / end));
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
	const audible = currentMix(project, mix);
	const showsTitles = workspace === 'film' && project.film.titles.length > 0;
	const rollOf = (songId: string): TPitchRange | null => (expandedSongs.includes(songId) ? (songRows.get(songId) ?? null) : null);
	const songHeight = (songId: string): number => {
		const roll = rollOf(songId);
		return roll != null ? Math.min(SONG_ROLL_MAX_HEIGHT, Math.max(SONG_ROW_HEIGHT, rowCount(roll) * NOTE_ROW_HEIGHT)) : SONG_ROW_HEIGHT;
	};
	const rowsHeight = project.marbles.length * ROW_HEIGHT + songs.reduce((sum, song) => sum + songHeight(song.id), 0) + CAMERA_ROW_HEIGHT;

	// MARK: - UI

	return (
		<section
			className="relative flex shrink-0 flex-col border-t border-[var(--separator)] bg-[var(--content)]"
			style={{ height: height > 0 ? height : fittedHeight(rowsHeight) }}
			aria-label="Timeline"
			onMouseDown={keepFocusOnButtonClick}
		>
			<ResizeHandle cx={cx} />
			<Transport cx={cx} results={result?.hits ?? null} zoom={zoom} onZoom={(next) => zoomTo(next)} onZoomToFit={zoomToFit} />
			<div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
				<div className="relative flex min-h-full min-w-full flex-col" style={{ width: TIME_ORIGIN + trackWidth }}>
					<div className="sticky top-0 z-30 flex shrink-0" style={{ height: RULER_HEIGHT }}>
						<div
							className="mm-track-header sticky left-0 z-30 flex shrink-0 items-center gap-0.5 border-r border-b border-[var(--separator)] pr-1.5 pl-3"
							style={{ width: HEADER_WIDTH }}
							data-quick-help="timelineLayers"
						>
							<span className="flex-1 text-[11px] font-semibold text-[var(--text-secondary)]">Layers</span>
						</div>
						<TimeGutter isRuler />
						<Ruler cx={cx} end={project.length} zoom={zoom} width={trackWidth} timeAt={timeAt} />
					</div>
					{songs.map((song, index) => (
						<SongTrack
							key={song.id}
							cx={cx}
							project={project}
							song={song}
							tint={songTints.get(song.id) ?? songTint(0)}
							name={SONG_LAYER_LABEL}
							analysis={analysis[song.id]}
							zoom={zoom}
							width={trackWidth}
							range={songRows.get(song.id) ?? null}
							isExpanded={rollOf(song.id) != null}
							isFirst={index === 0}
							height={songHeight(song.id)}
							selection={selection}
							drag={drag}
							onDragStart={startDrag}
							move={move}
							onMove={setMove}
							onAddHit={addSongHit}
							timeAt={timeAt}
						/>
					))}
					{/* The same layers as Layers, in the same order: the songs, the Camera, marbles, then in Film Titles */}
					<CameraRow cx={cx} project={project} zoom={zoom} width={trackWidth} selection={selection} timeAt={timeAt} />
					{project.marbles.map((marble) => (
						<div key={marble.id} className="flex shrink-0" style={{ height: ROW_HEIGHT }}>
							<TrackHeader cx={cx} project={project} marble={marble} selection={selection} />
							<TimeGutter />
							<MarbleTrack
								cx={cx}
								marble={marble}
								zoom={zoom}
								width={trackWidth}
								selection={selection}
								drag={drag}
								statuses={hitStatus.get(marble.id)}
								mix={audible}
									move={move}
									songTints={songTints}
								onDragStart={startDrag}
								timeAt={timeAt}
								onAdd={(time, event) => addHit(cx, marble, snap(time, event.altKey))}
							/>
						</div>
					))}
					{!project.marbles.length ? (
						<div className="mm-placeholder !h-auto !items-start py-6" style={{ paddingLeft: TIME_ORIGIN + 24 }}>
							<span className="mm-placeholder-title">No Marbles</span>
							<span className="mm-placeholder-body">Import a MIDI file with ⌘I, drop one on the window or add a marble with +.</span>
						</div>
					) : null}
					{showsTitles ? <TitlesRow cx={cx} project={project} zoom={zoom} width={trackWidth} selection={selection} timeAt={timeAt} /> : null}
					{/* The header column continues below the last marble, like Logic's track list */}
					<div
						className="flex flex-1"
						onClick={(event) => {
							if (!event.shiftKey) cx.$selection.set([]);
						}}
					>
						<div className="mm-track-header sticky left-0 z-20 shrink-0 border-r border-[var(--separator)]" style={{ width: HEADER_WIDTH }} />
					</div>
					{/* Outside the project range is shaded, like the area past Blender's end frame */}
					<div className="mm-out-of-range pointer-events-none absolute top-0 bottom-0" style={{ left: TIME_ORIGIN + project.length * zoom, right: 0 }} />
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

/**
 * A pointer click on a timeline button leaves keyboard focus where it was, like AppKit's non-key buttons, so
 * Return and Space keep their studio meaning instead of pressing the last-clicked button again. Tab still
 * focuses buttons for keyboard use.
 */
function keepFocusOnButtonClick(event: React.MouseEvent): void {
	const target = event.target as HTMLElement;
	if (target.closest('button') == null || target.closest('input, textarea, select, [contenteditable="true"]') != null) return;
	event.preventDefault();
	// A field being edited still ends its edit, as a click elsewhere would
	const active = document.activeElement;
	if (active instanceof HTMLElement && active.matches('input, textarea, select, [contenteditable="true"]')) active.blur();
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

// The horizontal scrollbar along the timeline's bottom edge, which a row scrolled into view stays clear of
const SCROLLBAR_ROOM = 14;

/**
 * Captures pointer movement for a hit drag across the whole window. Song roll drags also move in pitch. The time holds
 * until the pointer has really moved, so a click, a slip or a straight pitch drag leaves it alone.
 */
const DragLayer: React.FC<{ drag: TDrag; zoom: number; onMove: (drag: TDrag) => void; onEnd: (drag: TDrag) => void }> = (props) => {
	const { drag, zoom, onMove, onEnd } = props;

	function moved(event: React.PointerEvent): TDrag {
		const deltaX = event.clientX - drag.originX;
		return {
			...drag,
			delta: Math.abs(deltaX) < TIME_DEAD_ZONE ? 0 : deltaX / zoom,
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
