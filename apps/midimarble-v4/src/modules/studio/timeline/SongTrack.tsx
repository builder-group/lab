import { AudioLines, ChevronRight, Music } from 'lucide-react';
import { useFeatureState } from 'feature-react/state';
import React from 'react';
import { openContextMenu } from '@/components';
import { BACKING_COLOR } from '@/modules/music';
import { BACKING_ID, hitsOfSong, type TProject, type TSong, toHitKey, formatTime, toSongKey } from '@/modules/project';
import { songMenu } from '../menus';
import type { TSourceAnalysis } from '../SourcesCx';
import type { StudioCx } from '../StudioCx';
import { auditionNote } from '@/modules/track';
import { openingRollOffset, rowCount, songSpan, type TPitchRange } from './piano-roll';
import { MixToggles } from './MixToggles';
import { Keyboard, SongRoll } from './SongRoll';
import type { TDrag, TDragStart } from './MarbleTrack';
import { TimeGutter } from './Ruler';
import { HEADER_WIDTH, NOTE_ROW_HEIGHT, SONG_MOVE_STEP, SONG_ROW_HEIGHT, TIME_DEAD_ZONE } from './timeline-layout';
import { toggleSongExpanded } from './timeline-state';

/**
 * The Song layer's row at the top of the timeline, like the audio clip under a Final Cut storyline: the file
 * name in the header, the waveform of a recording or a small overview of every note for MIDI. A song with notes
 * expands into a piano roll of every note, where notes change pitch and are handed to marbles or to Backing. A recording
 * stays a flat waveform row, the hits drawn on it as ticks in their marbles' colors so they can be judged against the
 * waveform. Mute and Solo in the header take out what the song plays. Its notes or waveform sit on a clip, which drags to
 * move the song with everything tied to it, and a double-click on a recording adds a hit tied to it. The row exists only
 * while the project has a song file or Backing notes; without a file it reads Song and shows the Backing notes.
 */
export const SongTrack: React.FC<TSongTrackProps> = (props) => {
	const { cx, project, song, tint, name, analysis, zoom, width, range, isExpanded, isFirst, height, selection, drag, onDragStart, move, onMove, onAddHit, timeAt } = props;
	const isAudio = song.kind === 'audio';
	const backingCount = song.backing.length;
	// The kind, as the file's name is in Layers and the inspector, and with several songs leads the row
	const file = isAudio ? 'Recording' : 'MIDI';
	const details =
		song.path == null
			? ['Backing', backingCount === 1 ? '1 note' : `${backingCount} notes`]
			: isAudio
				? [file, analysis == null ? null : formatTime(analysis.duration)]
				: [file, song.tempo == null ? null : `${Math.round(song.tempo.bpm)} BPM`];
	const span = songSpan(project, song, analysis?.duration);
	const moved = move?.songId === song.id ? move.delta : 0;
	const songKey = toSongKey(song.id);
	const isSelected = selection.includes(songKey);
	const isMuted = useFeatureState(cx.$mix).muted.includes(song.id);
	const moveStartRef = React.useRef<number | null>(null);

	const clipHandlers = {
		onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
			if (event.button !== 0) return;
			event.stopPropagation();
			event.currentTarget.setPointerCapture(event.pointerId);
			moveStartRef.current = event.clientX;
			cx.$selection.set([songKey]);
		},
		onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
			if (moveStartRef.current == null) return;
			const deltaX = event.clientX - moveStartRef.current;
			onMove({ songId: song.id, delta: Math.abs(deltaX) < TIME_DEAD_ZONE ? 0 : Math.max(cx.sources.earliestStart(song.id) - song.start, Math.round(deltaX / zoom / SONG_MOVE_STEP) * SONG_MOVE_STEP) });
		},
		onPointerUp: () => {
			moveStartRef.current = null;
			if (moved !== 0) cx.sources.moveSong(song.id, song.start + moved);
			onMove(null);
		},
		onPointerCancel: () => {
			moveStartRef.current = null;
			onMove(null);
		},
		onClick: (event: React.MouseEvent) => event.stopPropagation()
	};

	function openMenu(event: React.MouseEvent): void {
		openContextMenu(event, songMenu(cx, song));
	}

	// An expanded roll taller than its track scrolls inside it, keyboard and notes together, like GarageBand's
	// editor; the wheel goes to the timeline once the roll reaches its top or bottom
	const rowRef = React.useRef<HTMLDivElement>(null);
	const rollHeight = range == null ? 0 : rowCount(range) * NOTE_ROW_HEIGHT;
	const maxOffset = isExpanded ? Math.max(0, rollHeight - height) : 0;
	const [offset, setOffset] = React.useState<number | null>(null);
	// Opens on the song's first notes, their top row just below the ruler
	const opening = React.useMemo(
		() => (range == null || !isExpanded ? 0 : openingRollOffset(hitsOfSong(project, song.id), range, NOTE_ROW_HEIGHT, height)),
		[project, song.id, range, isExpanded, height]
	);
	const shown = Math.min(maxOffset, Math.max(0, offset ?? opening));
	// Opening again starts on the first notes, like a freshly opened editor
	const [wasExpanded, setWasExpanded] = React.useState(isExpanded);
	if (wasExpanded !== isExpanded) {
		setWasExpanded(isExpanded);
		if (!isExpanded) setOffset(null);
	}

	React.useEffect(() => {
		const element = rowRef.current;
		if (element == null || maxOffset === 0) return;
		function onWheel(event: WheelEvent): void {
			if (event.ctrlKey || event.metaKey || event.shiftKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
			const next = Math.min(maxOffset, Math.max(0, shown + event.deltaY));
			if (next === shown) return;
			event.preventDefault();
			setOffset(next);
		}
		element.addEventListener('wheel', onWheel, { passive: false });
		return () => element.removeEventListener('wheel', onWheel);
	}, [maxOffset, shown]);

	return (
		<div ref={rowRef} className="flex shrink-0" style={{ height }}>
			<div
				className="mm-track-header sticky left-0 z-20 flex shrink-0 items-start border-r border-b border-[var(--separator)] pl-1"
				style={{ width: HEADER_WIDTH, paddingRight: isExpanded ? 0 : 8 }}
				data-track={songKey}
				data-quick-help={isFirst ? 'song' : undefined}
				data-hint-anchor={isFirst ? 'song' : undefined}
				data-selected={isSelected}
				data-expanded={isExpanded}
				data-muted={isMuted}
				onClick={() => cx.$selection.set([songKey])}
				onContextMenu={openMenu}
				title={name}
			>
				<div className="flex min-w-0 flex-1 items-center gap-1.5 pr-1.5" style={{ height: SONG_ROW_HEIGHT }}>
					{range != null ? (
						<button
							className="mm-disclosure"
							data-open={isExpanded}
							onClick={() => toggleSongExpanded(song.id)}
							title={isExpanded ? 'Collapse Song' : 'Show Every Note'}
							aria-label={isExpanded ? 'Collapse Song' : 'Expand Song'}
							aria-expanded={isExpanded}
							type="button"
						>
							<ChevronRight size={12} strokeWidth={2.25} />
						</button>
					) : (
						// Without a disclosure the icon lines up with the rows below
						<span className="w-[10px] shrink-0" />
					)}
					<span className="mm-song-icon">{isAudio ? <AudioLines size={12} strokeWidth={1.75} /> : <Music size={12} strokeWidth={1.75} />}</span>
					<span className="flex min-w-0 flex-1 flex-col leading-tight">
						<span className="mm-track-title truncate font-medium">{name}</span>
						<span className="truncate text-[11px] text-[var(--text-secondary)]">{details.filter(Boolean).join(' · ')}</span>
					</span>
					<MixToggles cx={cx} id={song.id} name="Song" />
				</div>
				{isExpanded && range != null ? (
					<div className="flex self-stretch" onClick={(event) => event.stopPropagation()}>
						<Keyboard cx={cx} project={project} song={song} name="Song" range={range} offset={shown} onPlay={(pitch) => auditionNote(cx, BACKING_ID, pitch, song.id)} />
					</div>
				) : null}
			</div>
			<TimeGutter />
			{isExpanded && range != null ? (
				<div className="relative flex-1 overflow-hidden border-b border-[var(--separator)]" style={{ minWidth: width }}>
					<div style={{ transform: shown === 0 ? undefined : `translateY(${-shown}px)` }}>
						<SongRoll cx={cx} project={project} song={song} range={range} zoom={zoom} width={width} selection={selection} drag={drag} onDragStart={onDragStart} />
					</div>
				</div>
			) : (
			<div
				className="mm-song-row relative flex-1 overflow-hidden border-b border-[var(--separator)]"
				style={{ minWidth: width }}
				onClick={(event) => {
					if (!event.shiftKey) cx.$selection.set([]);
				}}
				onDoubleClick={(event) => {
					if (isAudio) onAddHit(song, timeAt(event.clientX), event);
				}}
				onContextMenu={openMenu}
				aria-label={`Song ${name}`}
			>
				<div className="pointer-events-none absolute inset-0" style={{ transform: moved === 0 ? undefined : `translateX(${moved * zoom}px)` }}>
					{span != null ? (
						<div
							className="mm-song-clip pointer-events-auto absolute"
							data-selected={isSelected}
							data-moving={moved !== 0}
							style={{ left: span.from * zoom, width: Math.max(8, (span.to - span.from) * zoom), ['--song-tint' as string]: tint }}
							title={`Drag to move ${song.name === '' ? 'the song' : song.name} and the notes tied to it`}
							{...clipHandlers}
						/>
					) : null}
					{isAudio && analysis != null ? (
						<>
							<Waveform analysis={analysis} offset={song.start} zoom={zoom} height={SONG_ROW_HEIGHT - 1} />
							{analysis.onsets.map((onset) => (
								<span key={onset} className="pointer-events-none absolute bottom-0 h-1.5 w-px bg-[var(--text-tertiary)]" style={{ left: (onset + song.start) * zoom }} />
							))}
						</>
					) : null}
					{isAudio ? null : <NoteOverview project={project} song={song} zoom={zoom} width={width} height={SONG_ROW_HEIGHT - 1} />}
				</div>
				{isAudio ? <HitTicks project={project} song={song} zoom={zoom} width={width} height={SONG_ROW_HEIGHT - 1} drag={drag} move={move} /> : null}
			</div>
			)}
		</div>
	);
};

interface TSongTrackProps {
	cx: StudioCx;
	project: TProject;
	song: TSong;
	tint: string;
	name: string;
	analysis: TSourceAnalysis | undefined;
	zoom: number;
	width: number;
	// Pitch rows of the expanded piano roll; null when the song cannot expand
	range: TPitchRange | null;
	isExpanded: boolean;
	// The first song's row carries the first-run hint and quick help
	isFirst: boolean;
	height: number;
	selection: string[];
	drag: TDrag | null;
	onDragStart: TDragStart;
	move: TSongMove | null;
	onMove: (move: TSongMove | null) => void;
	onAddHit: (song: TSong, time: number, event: React.MouseEvent) => void;
	timeAt: (clientX: number) => number;
}

/** A song being dragged along the timeline, with what is tied to it following it until it lands */
export interface TSongMove {
	songId: string;
	delta: number;
}

/** The hits tied to this recording and every marble's own as ticks over the waveform, in their colors; dragged hits move with the drag, tied hits with their song */
const HitTicks: React.FC<{ project: TProject; song: TSong; zoom: number; width: number; height: number; drag: TDrag | null; move: TSongMove | null }> = (props) => {
	const { project, song, zoom, width, height, drag, move } = props;
	return (
		<svg className="pointer-events-none absolute top-0 left-0" width={width} height={height} aria-hidden>
			{project.marbles.map((marble) => (
				<g key={marble.id} fill={marble.labelColor}>
					{marble.hits.filter((hit) => hit.songId == null || hit.songId === song.id).map((hit) => {
						const delta = (drag?.keys.includes(toHitKey(marble.id, hit.id)) === true ? drag.delta : 0) + (move != null && hit.songId === move.songId ? move.delta : 0);
						return <rect key={hit.id} x={Math.max(0, hit.time + delta) * zoom - 0.75} y={4} width={1.5} height={height - 8} rx={0.75} />;
					})}
				</g>
			))}
		</svg>
	);
};

/** Every note of a song in one strip, higher notes higher, in the marble colors and Backing in gray */
const NoteOverview: React.FC<{ project: TProject; song: TSong; zoom: number; width: number; height: number }> = (props) => {
	const { project, song, zoom, width, height } = props;
	const marbles = [...project.marbles.map((marble) => ({ ...marble, hits: marble.hits.filter((hit) => hit.songId === song.id) })), { id: BACKING_ID, labelColor: BACKING_COLOR, hits: song.backing }];
	const pitches = marbles.flatMap((marble) => marble.hits.flatMap((hit) => (hit.pitch == null ? [] : [hit.pitch])));
	const low = pitches.length ? Math.min(...pitches) : 60;
	const high = pitches.length ? Math.max(...pitches) : 72;
	const pad = 6;

	function y(pitch: number | undefined): number {
		if (pitch == null || high === low) return height / 2 - 1;
		return pad + ((high - pitch) / (high - low)) * (height - pad * 2 - 2);
	}

	return (
		<svg className="pointer-events-none absolute top-0 left-0" width={width} height={height} aria-hidden>
			{marbles.map((marble) => (
				<g key={marble.id} fill={marble.labelColor}>
					{marble.hits.map((hit) => (
						<rect key={hit.id} x={hit.time * zoom} y={y(hit.pitch)} width={Math.max(3, Math.min(8, zoom * 0.06))} height={2} rx={1} />
					))}
				</g>
			))}
		</svg>
	);
};

/** Waveform of a recording, drawn once per zoom on a canvas and redrawn when the appearance changes */
const Waveform: React.FC<{ analysis: TSourceAnalysis; offset: number; zoom: number; height: number }> = (props) => {
	const { analysis, offset, zoom, height } = props;
	const canvasRef = React.useRef<HTMLCanvasElement>(null);
	const width = Math.ceil(analysis.duration * zoom);
	const scheme = useColorScheme();

	React.useEffect(() => {
		const canvas = canvasRef.current;
		const context = canvas?.getContext('2d');
		if (canvas == null || context == null) return;
		const scale = window.devicePixelRatio || 1;
		canvas.width = Math.min(width * scale, 32000);
		canvas.height = height * scale;
		context.setTransform(canvas.width / width, 0, 0, scale, 0, 0);
		context.fillStyle = getComputedStyle(canvas).color;
		const perPixel = 1 / zoom / analysis.bucketSeconds;
		for (let x = 0; x < width; x++) {
			const start = Math.floor(x * perPixel);
			const end = Math.max(start + 1, Math.floor((x + 1) * perPixel));
			let peak = 0;
			for (let index = start; index < end && index < analysis.peaks.length; index++) {
				peak = Math.max(peak, analysis.peaks[index] ?? 0);
			}
			const bar = Math.max(1, peak * (height - 8));
			context.fillRect(x, (height - bar) / 2, 1, bar);
		}
	}, [analysis, width, height, zoom, scheme]);

	return (
		<canvas
			ref={canvasRef}
			className="pointer-events-none absolute top-0 text-[var(--text-secondary)] opacity-70"
			style={{ left: offset * zoom, width, height }}
		/>
	);
};

function useColorScheme(): 'light' | 'dark' {
	const query = React.useMemo(() => window.matchMedia('(prefers-color-scheme: dark)'), []);
	const [isDark, setIsDark] = React.useState(query.matches);
	React.useEffect(() => {
		const onChange = (event: MediaQueryListEvent): void => setIsDark(event.matches);
		query.addEventListener('change', onChange);
		return () => query.removeEventListener('change', onChange);
	}, [query]);
	return isDark ? 'dark' : 'light';
}
