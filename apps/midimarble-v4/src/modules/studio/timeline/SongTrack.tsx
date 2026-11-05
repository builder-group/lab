import { useFeatureState } from 'feature-react/state';
import { AudioLines, ChevronRight, Music } from 'lucide-react';
import React from 'react';
import { openContextMenu } from '@/components';
import { mixLabel, SONG_MIX_ID, BACKING_COLOR } from '@/modules/music';
import { BACKING_ID, type TProject, type TSource, SONG_KEY, toHitKey, formatTime } from '@/modules/project';
import { songMenu } from '../menus';
import type { TSourceAnalysis } from '../SourcesCx';
import type { StudioCx } from '../StudioCx';
import { auditionNote } from '@/modules/track';
import { openingRollOffset, rowCount, type TPitchRange } from './piano-roll';
import { PartToggles } from './PartToggles';
import { Keyboard, SongRoll } from './SongRoll';
import type { TDrag, TDragStart } from './MarbleTrack';
import { TimeGutter } from './Ruler';
import { HEADER_WIDTH, NOTE_ROW_HEIGHT, SONG_ROW_HEIGHT } from './timeline-layout';
import { toggleSongExpanded } from './timeline-state';

/**
 * The Song layer's row at the top of the timeline, like the audio clip under a Final Cut storyline: the file
 * name in the header, the waveform of a recording or a small overview of every note for MIDI. A song with notes
 * expands into a piano roll of every note, where notes change pitch and are handed to marbles or to Backing, with its
 * Parts below (`PartRows`). A recording stays a flat waveform row with one Mute and Solo, the hits drawn on it as ticks
 * in their marbles' colors so they can be judged against the waveform. The row exists only while the project has a song file or Backing notes;
 * without a file it reads Song and shows the Backing notes.
 */
export const SongTrack: React.FC<TSongTrackProps> = (props) => {
	const { cx, project, song, name, analysis, zoom, width, range, isExpanded, height, selection, drag, onDragStart } = props;
	const isAudio = song?.kind === 'audio';
	const mix = useFeatureState(cx.$mix);
	const mixState = mixLabel(project, mix);
	const tempo = project.music.tempo;
	const backingCount = project.music.backing.length;
	const details =
		song == null
			? ['Backing', backingCount === 1 ? '1 note' : `${backingCount} notes`]
			: isAudio
				? [song.name, analysis == null ? null : formatTime(analysis.duration)]
				: [song.name, tempo == null ? null : `${Math.round(tempo.bpm)} BPM`];

	function openMenu(event: React.MouseEvent): void {
		openContextMenu(event, songMenu(cx));
	}

	// An expanded roll taller than its track scrolls inside it, keyboard and notes together, like GarageBand's
	// editor; the wheel goes to the timeline once the roll reaches its top or bottom
	const rowRef = React.useRef<HTMLDivElement>(null);
	const rollHeight = range == null ? 0 : rowCount(range) * NOTE_ROW_HEIGHT;
	const maxOffset = isExpanded ? Math.max(0, rollHeight - height) : 0;
	const [offset, setOffset] = React.useState<number | null>(null);
	// Opens on the song's first notes, their top row just below the ruler
	const opening = React.useMemo(
		() => (range == null || !isExpanded ? 0 : openingRollOffset([...project.music.lanes.flatMap((lane) => lane.hits), ...project.music.backing], range, NOTE_ROW_HEIGHT, height)),
		[project.music, range, isExpanded, height]
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
				data-track={SONG_KEY}
				data-quick-help="song"
				data-hint-anchor="song"
				data-selected={selection.includes(SONG_KEY)}
				data-expanded={isExpanded}
				onClick={() => cx.$selection.set([SONG_KEY])}
				onContextMenu={openMenu}
				title={name}
			>
				<div className="flex min-w-0 flex-1 items-center gap-1.5 pr-1.5" style={{ height: SONG_ROW_HEIGHT }}>
					{range != null ? (
						<button
							className="mm-disclosure"
							data-open={isExpanded}
							onClick={toggleSongExpanded}
							title={isExpanded ? 'Collapse Song' : 'Show Every Note and Part'}
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
						<span className="truncate font-medium">{name}</span>
						<span className="truncate text-[11px] text-[var(--text-secondary)]">{(mixState != null ? [mixState] : details.filter(Boolean)).join(' · ')}</span>
					</span>
					{isAudio ? <PartToggles cx={cx} id={SONG_MIX_ID} name="Song" /> : null}
				</div>
				{isExpanded && range != null ? (
					<div className="flex self-stretch" onClick={(event) => event.stopPropagation()}>
						<Keyboard cx={cx} project={project} name="Song" range={range} offset={shown} onPlay={(pitch) => auditionNote(cx, BACKING_ID, pitch)} />
					</div>
				) : null}
			</div>
			<TimeGutter />
			{isExpanded && range != null ? (
				<div className="relative flex-1 overflow-hidden border-b border-[var(--separator)]" style={{ minWidth: width }}>
					<div style={{ transform: shown === 0 ? undefined : `translateY(${-shown}px)` }}>
						<SongRoll cx={cx} project={project} range={range} zoom={zoom} width={width} selection={selection} drag={drag} onDragStart={onDragStart} />
					</div>
				</div>
			) : (
			<div className="mm-song-lane relative flex-1 overflow-hidden border-b border-[var(--separator)]" style={{ minWidth: width }} onClick={(event) => { if (!event.shiftKey) cx.$selection.set([]); }} onContextMenu={openMenu} aria-label={`Song ${name}`}>
				{song != null && isAudio && analysis != null ? (
					<>
						<Waveform analysis={analysis} offset={song.offset} zoom={zoom} height={SONG_ROW_HEIGHT - 1} />
						{analysis.onsets.map((onset) => (
							<span key={onset} className="pointer-events-none absolute bottom-0 h-1.5 w-px bg-[var(--text-tertiary)]" style={{ left: (onset + song.offset) * zoom }} />
						))}
					</>
				) : null}
				{isAudio ? <HitTicks project={project} zoom={zoom} width={width} height={SONG_ROW_HEIGHT - 1} drag={drag} /> : null}
				{isAudio ? null : <NoteOverview project={project} zoom={zoom} width={width} height={SONG_ROW_HEIGHT - 1} />}
			</div>
			)}
		</div>
	);
};

interface TSongTrackProps {
	cx: StudioCx;
	project: TProject;
	/** Undefined while the Song layer holds only Backing notes */
	song: TSource | undefined;
	name: string;
	analysis: TSourceAnalysis | undefined;
	zoom: number;
	width: number;
	// Pitch rows of the expanded piano roll; null when the song cannot expand
	range: TPitchRange | null;
	isExpanded: boolean;
	height: number;
	selection: string[];
	drag: TDrag | null;
	onDragStart: TDragStart;
}

/** Every marble's hits as ticks over the waveform, in its color; dragged hits move with the drag */
const HitTicks: React.FC<{ project: TProject; zoom: number; width: number; height: number; drag: TDrag | null }> = (props) => {
	const { project, zoom, width, height, drag } = props;
	return (
		<svg className="pointer-events-none absolute top-0 left-0" width={width} height={height} aria-hidden>
			{project.music.lanes.map((lane) => (
				<g key={lane.id} fill={lane.color}>
					{lane.hits.map((hit) => {
						const delta = drag?.keys.includes(toHitKey(lane.id, hit.id)) === true ? drag.delta : 0;
						return <rect key={hit.id} x={Math.max(0, hit.time + delta) * zoom - 0.75} y={4} width={1.5} height={height - 8} rx={0.75} />;
					})}
				</g>
			))}
		</svg>
	);
};

/** Every note in one strip, higher notes higher, in the marble colors and Backing in gray; `only` limits it to one Part */
export const NoteOverview: React.FC<{ project: TProject; only?: string; zoom: number; width: number; height: number }> = (props) => {
	const { project, only, zoom, width, height } = props;
	const lanes = [...project.music.lanes, { id: BACKING_ID, color: BACKING_COLOR, hits: project.music.backing }].filter((lane) => only == null || lane.id === only);
	const pitches = lanes.flatMap((lane) => lane.hits.flatMap((hit) => (hit.pitch == null ? [] : [hit.pitch])));
	const low = pitches.length ? Math.min(...pitches) : 60;
	const high = pitches.length ? Math.max(...pitches) : 72;
	const pad = 6;

	function y(pitch: number | undefined): number {
		if (pitch == null || high === low) return height / 2 - 1;
		return pad + ((high - pitch) / (high - low)) * (height - pad * 2 - 2);
	}

	return (
		<svg className="pointer-events-none absolute top-0 left-0" width={width} height={height} aria-hidden>
			{lanes.map((lane) => (
				<g key={lane.id} fill={lane.color}>
					{lane.hits.map((hit) => (
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
