import { AudioLines, ChevronRight, Music } from 'lucide-react';
import React from 'react';
import { openContextMenu } from '@/components';
import type { TProject, TSource } from '@/modules/project';
import { commandItem } from '../commands';
import { SONG_KEY } from '../selection';
import { formatTime } from '../format';
import type { TSourceAnalysis } from '../SourcesCx';
import type { StudioCx } from '../StudioCx';
import { BACKING_COLOR } from './hand-notes';
import type { TPitchRange } from './piano-roll';
import { SongRoll } from './SongRoll';
import { HEADER_WIDTH, SONG_ROW_HEIGHT } from './timeline-layout';
import { toggleSongExpanded } from './timeline-state';

/**
 * The project's song as the top track, like the audio clip under a Final Cut storyline: the file name in
 * the header, the waveform of a recording or a small overview of every note for MIDI. A MIDI song expands into
 * a piano roll of every note, where notes are handed to marbles or to Backing.
 */
export const SongTrack: React.FC<TSongTrackProps> = (props) => {
	const { cx, project, song, analysis, zoom, width, range, isExpanded, height, selection } = props;
	const isAudio = song.kind === 'audio';
	const tempo = project.music.tempo;
	const details = isAudio
		? ['Recording', analysis == null ? null : formatTime(analysis.duration)]
		: ['MIDI', tempo == null ? null : `${Math.round(tempo.bpm)} BPM`];

	function openMenu(event: React.MouseEvent): void {
		openContextMenu(event, [{ section: 'Song' }, commandItem(cx, 'file.replaceSong'), commandItem(cx, 'file.removeSong')]);
	}

	return (
		<div className="flex shrink-0" style={{ height }}>
			<div
				className="mm-track-header sticky left-0 z-20 flex shrink-0 items-start border-r border-b border-[var(--separator)] pr-2 pl-1"
				style={{ width: HEADER_WIDTH }}
				data-track={SONG_KEY}
				data-selected={selection.includes(SONG_KEY)}
				data-expanded={isExpanded}
				onClick={() => cx.$selection.set([SONG_KEY])}
				onContextMenu={openMenu}
				title={song.name}
			>
				<div className="flex min-w-0 flex-1 items-center gap-1.5" style={{ height: SONG_ROW_HEIGHT }}>
					{range != null ? (
						<button
							className="mm-disclosure"
							data-open={isExpanded}
							onClick={toggleSongExpanded}
							title={isExpanded ? 'Collapse Song' : 'Show Every Note'}
							aria-label={isExpanded ? 'Collapse Song' : 'Expand Song'}
							aria-expanded={isExpanded}
							type="button"
						>
							<ChevronRight size={12} strokeWidth={2.25} />
						</button>
					) : (
						<span className="w-4 shrink-0" />
					)}
					<span className="mm-song-icon">{isAudio ? <AudioLines size={12} strokeWidth={1.75} /> : <Music size={12} strokeWidth={1.75} />}</span>
					<span className="flex min-w-0 flex-1 flex-col leading-tight">
						<span className="truncate font-medium">{song.name}</span>
						<span className="truncate text-[11px] text-[var(--text-secondary)]">{details.filter(Boolean).join(' · ')}</span>
					</span>
				</div>
			</div>
			{isExpanded && range != null ? (
				<SongRoll cx={cx} project={project} range={range} zoom={zoom} width={width} selection={selection} />
			) : (
			<div className="mm-song-lane relative flex-1 overflow-hidden border-b border-[var(--separator)]" style={{ minWidth: width }} onContextMenu={openMenu} aria-label={`Song ${song.name}`}>
				{isAudio && analysis != null ? (
					<>
						<Waveform analysis={analysis} offset={song.offset} zoom={zoom} height={SONG_ROW_HEIGHT - 1} />
						{analysis.onsets.map((onset) => (
							<span key={onset} className="pointer-events-none absolute bottom-0 h-1.5 w-px bg-[var(--text-tertiary)]" style={{ left: (onset + song.offset) * zoom }} />
						))}
					</>
				) : null}
				{isAudio ? null : <NoteOverview project={project} zoom={zoom} width={width} height={SONG_ROW_HEIGHT - 1} />}
			</div>
			)}
		</div>
	);
};

/**
 * The Song track before a song exists: where a file goes, like GarageBand's empty track that asks for a loop.
 * Files dropped anywhere on the window import too.
 */
export const EmptySongTrack: React.FC<{ cx: StudioCx; width: number }> = (props) => {
	const { cx, width } = props;
	return (
		<div className="flex shrink-0" style={{ height: SONG_ROW_HEIGHT }}>
			<div
				className="mm-track-header sticky left-0 z-20 flex shrink-0 items-center gap-1.5 border-r border-b border-[var(--separator)] pr-2 pl-5 text-[var(--text-secondary)]"
				style={{ width: HEADER_WIDTH }}
			>
				<span className="mm-song-icon">
					<Music size={12} strokeWidth={1.75} />
				</span>
				<span className="truncate font-medium">Song</span>
			</div>
			<div className="mm-song-lane mm-song-empty relative flex flex-1 items-center gap-2 border-b border-[var(--separator)] px-3" style={{ minWidth: width }}>
				<span className="text-[11px] text-[var(--text-tertiary)]">No song yet</span>
				<button className="mm-link-button" onClick={() => void cx.importSong()} title="Import a MIDI file or a recording, or drop one on the window (⌘I)" type="button">
					Import Song…
				</button>
			</div>
		</div>
	);
};

interface TSongTrackProps {
	cx: StudioCx;
	project: TProject;
	song: TSource;
	analysis: TSourceAnalysis | undefined;
	zoom: number;
	width: number;
	// Pitch rows of the expanded piano roll; null when the song cannot expand
	range: TPitchRange | null;
	isExpanded: boolean;
	height: number;
	selection: string[];
}

/** Every note in one strip, higher notes higher, in the marble colours and Backing in grey */
const NoteOverview: React.FC<{ project: TProject; zoom: number; width: number; height: number }> = (props) => {
	const { project, zoom, width, height } = props;
	const lanes = [...project.music.lanes, { id: 'backing', color: BACKING_COLOR, hits: project.music.backing }];
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
