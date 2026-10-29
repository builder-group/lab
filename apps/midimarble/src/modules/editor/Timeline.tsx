import {
	Camera,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	CopyPlus,
	Focus,
	Lightbulb,
	Link2,
	Magnet,
	Maximize2,
	Minus,
	MousePointer2,
	Music2,
	Pencil,
	Plus
} from 'lucide-react';
import React from 'react';
import type { TNote, TPerformance, TProject } from '../project';
import { ContactLane } from './ContactLane';
import { ContextHelp } from './ContextHelp';
import { KeyframeLane } from './KeyframeLane';
import { MidiTrackLane, PIANO_ROW_HEIGHT } from './MidiTrackLane';
import { parsePianoClipboard, pastePianoNotes, serializePianoClipboard } from './piano-clipboard';
import {
	duplicatePianoNotes,
	getPianoPitchRange,
	movePianoNotes,
	pianoBeatTickStep,
	pianoPitchTop
} from './piano-editing';
import { reconcilePianoSelection, type TPianoSelection } from './piano-selection';
import { pointerGesture } from './pointer-gesture';
import {
	clampTimelineTime,
	timelineSnapStep,
	timelineTickStep,
	timelineZoomAnchor,
	type TTimelineSnap
} from './timeline-editing';
import './Timeline.css';

export const Timeline: React.FC<TTimelineProps> = (props) => {
	const {
		project,
		focusRequest,
		performance,
		time,
		selectedNoteId,
		selectedObjectId,
		selectedCameraKeyframeId,
		selectedLightingKeyframeId,
		fps = 30,
		playing = false,
		disabled = false,
		timeRef,
		linkingObjectId = null,
		draggingObjectId = null,
		onSeek,
		onSelectNote,
		onSelectObject,
		onUpdateNote,
		onUpdateNotes,
		onDeleteNotes,
		onAddNotes,
		onClipboardMessage,
		onAddNote,
		onMuteTrack,
		onSoloTrack,
		onSelectCameraKeyframe,
		onUpdateCameraKeyframe,
		onDeleteCameraKeyframe,
		onAddCameraKeyframe,
		onSelectLightingKeyframe,
		onMoveLightingKeyframe,
		onDeleteLightingKeyframe,
		onAddLightingKeyframe,
		onLinkObject,
		onAuditionNote,
		onSelectTrack,
		onFocusMidi,
		onDeleteNote,
		onAddTrack
	} = props;
	const [zoom, setZoom] = React.useState(64);
	const [unit, setUnit] = React.useState<TTimelineUnit>('frames');
	const [snapMode, setSnapMode] = React.useState<TTimelineSnap['mode']>('frame');
	const [follow, setFollow] = React.useState(true);
	const [musicOpen, setMusicOpen] = React.useState(true);
	const [focusedTrackId, setFocusedTrackId] = React.useState<string | null>(null);
	const [drawMode, setDrawMode] = React.useState<'select' | 'draw'>('select');
	const [drawLengthBeats, setDrawLengthBeats] = React.useState(0.5);
	const [clipboardStatus, setClipboardStatus] = React.useState<string | null>(null);
	const [selection, setSelection] = React.useState<TPianoSelection>(() => ({
		primaryId: selectedNoteId,
		ids: new Set(selectedNoteId == null ? [] : [selectedNoteId])
	}));
	const resolvedSelection = reconcilePianoSelection(selection, selectedNoteId);
	if (resolvedSelection !== selection) setSelection(resolvedSelection);
	const noteSelection = resolvedSelection.ids;
	function setNoteSelection(ids: Set<string>) {
		setSelection({ primaryId: selectedNoteId, ids });
	}
	const previousViewRef = React.useRef<{
		expanded: Set<string>;
		snap: TTimelineSnap['mode'];
		zoom: number;
		scrollLeft: number;
		scrollTop: number;
		manual: boolean;
		unit: TTimelineUnit;
	} | null>(null);
	const [expandedTracks, setExpandedTracks] = React.useState<Set<string>>(() => new Set());
	const [viewport, setViewport] = React.useState({ left: 0, width: 1000 });
	const scrollerRef = React.useRef<HTMLDivElement>(null);
	const playheadRef = React.useRef<HTMLDivElement>(null);
	const rulerPlayheadRef = React.useRef<HTMLSpanElement>(null);
	const gestureRef = React.useRef<(() => void) | null>(null);
	const manuallyZoomedRef = React.useRef(false);
	const clockRef = React.useRef(time);
	const duration = Math.max(1 / fps, project.duration);
	const gridWidth = duration * zoom + 48;
	const snap = React.useMemo(
		() => ({ mode: snapMode, fps, bpm: project.bpm }),
		[snapMode, fps, project.bpm]
	);
	const tickStep =
		unit === 'beats' ? pianoBeatTickStep(zoom, project.bpm) : timelineTickStep(zoom, fps, unit);
	const tickSeconds = unit === 'frames' ? tickStep / fps : tickStep;
	const beatSeconds = 60 / Math.max(1, project.bpm);
	const visibleStart = Math.max(0, (viewport.left - 200) / zoom);
	const visibleEnd = (viewport.left + viewport.width + 200) / zoom;
	const tracks = React.useMemo(() => {
		const byTrack = new Map<string, TNote[]>();
		for (const note of project.notes) {
			const notes = byTrack.get(note.trackId) ?? [];
			notes.push(note);
			byTrack.set(note.trackId, notes);
		}
		return project.tracks.map((track) => {
			const notes = byTrack.get(track.id) ?? [];
			return { ...track, notes, ...getPianoPitchRange(notes) };
		});
	}, [project.notes, project.tracks]);
	const linkedNotes = React.useMemo(
		() =>
			new Set(
				project.objects.flatMap((object) => (object.binding == null ? [] : [object.binding.noteId]))
			),
		[project.objects]
	);
	const objectNames = React.useMemo(
		() => new Map(project.objects.map((object) => [object.id, object.name])),
		[project.objects]
	);
	const noteTimes = React.useMemo(
		() => new Map(project.notes.map((note) => [note.id, note.time])),
		[project.notes]
	);
	const linkingObject = project.objects.find((object) => object.id === linkingObjectId);

	const focusedTrack = tracks.find((track) => track.id === focusedTrackId);
	const soloActive = project.tracks.some((track) => track.solo);
	const multiSelect =
		focusedTrack != null &&
		linkingObjectId == null &&
		onUpdateNotes != null &&
		onDeleteNotes != null;
	const groupNotes = React.useMemo(
		() => focusedTrack?.notes.filter((note) => noteSelection.has(note.id)) ?? [],
		[focusedTrack, noteSelection]
	);
	const drawLength = (60 / project.bpm) * drawLengthBeats;
	const shownTracks = focusedTrack == null ? tracks : [focusedTrack];
	function focusTrack(id: string | null) {
		setClipboardStatus(null);
		setNoteSelection(new Set(selectedNoteId == null ? [] : [selectedNoteId]));
		if (id == null) {
			setFocusedTrackId(null);
			const previous = previousViewRef.current;
			if (previous) {
				setExpandedTracks(previous.expanded);
				setSnapMode(previous.snap);
				setUnit(previous.unit);
				setZoom(previous.zoom);
				manuallyZoomedRef.current = previous.manual;
				requestAnimationFrame(() => {
					if (scrollerRef.current) {
						scrollerRef.current.scrollLeft = previous.scrollLeft;
						scrollerRef.current.scrollTop = previous.scrollTop;
					}
				});
			}
			previousViewRef.current = null;
			onFocusMidi?.(null);
			return;
		}
		if (focusedTrackId == null)
			previousViewRef.current = {
				expanded: new Set(expandedTracks),
				snap: snapMode,
				zoom,
				scrollLeft: scrollerRef.current?.scrollLeft ?? 0,
				scrollTop: scrollerRef.current?.scrollTop ?? 0,
				manual: manuallyZoomedRef.current,
				unit
			};
		setFocusedTrackId(id);
		setExpandedTracks(new Set([id]));
		setMusicOpen(true);
		setSnapMode('sixteenth');
		setUnit('beats');
		manuallyZoomedRef.current = true;
		const nextZoom = Math.max(96, zoom);
		setZoom(nextZoom);
		const focusedNotes = tracks.find((track) => track.id === id)?.notes ?? [];
		const firstNote = focusedNotes.reduce<TNote | null>(
			(first, note) => (first == null || note.time < first.time ? note : first),
			null
		);
		const selected = focusedNotes.find((note) => note.id === selectedNoteId);
		const lastNoteEnd = Math.max(0, ...focusedNotes.map((note) => note.time + note.duration));
		const anchorTime =
			selected?.time ??
			(firstNote && (time < firstNote.time || time > lastNoteEnd) ? firstNote.time : time);
		requestAnimationFrame(() => {
			const scroller = scrollerRef.current;
			if (scroller)
				scroller.scrollLeft = Math.max(
					0,
					anchorTime * nextZoom - (scroller.clientWidth - CHANNEL_WIDTH) * 0.25
				);
		});
		onSelectTrack?.(id);
		onFocusMidi?.(id);
	}
	function scrollToTrackPitch(trackId: string) {
		requestAnimationFrame(() => {
			const scroller = scrollerRef.current;
			if (scroller == null) return;
			const row = Array.from(scroller.querySelectorAll<HTMLElement>('[data-track-id]')).find(
				(entry) => entry.dataset['trackId'] === trackId
			);
			const track = tracks.find((entry) => entry.id === trackId);
			if (row == null || track == null) return;
			const note = track.notes.find((entry) => entry.id === selectedNoteId) ?? track.notes[0];
			const pitchScroller = row.classList.contains('is-focused')
				? row.querySelector<HTMLElement>('.mm-piano-pitch-scroll')
				: null;
			if (pitchScroller) {
				pitchScroller.scrollTop = Math.max(
					0,
					pianoPitchTop(
						note?.midi ?? 60,
						MIDI_PITCH_RANGE,
						Number(row.dataset['pianoRowHeight']) || PIANO_ROW_HEIGHT
					) -
						pitchScroller.clientHeight / 2
				);
				return;
			}
			const top = row.offsetTop + 33 + pianoPitchTop(note?.midi ?? 60, track, PIANO_ROW_HEIGHT);
			scroller.scrollTop = Math.max(0, top - Math.max(30, scroller.clientHeight / 2));
		});
	}

	// MARK: - Actions

	const fit = React.useCallback(() => {
		const scroller = scrollerRef.current;
		if (scroller == null) return;
		const notes = focusedTrack?.notes ?? [];
		const start = notes.length > 0 ? Math.min(...notes.map((note) => note.time)) : 0;
		const end =
			notes.length > 0 ? Math.max(...notes.map((note) => note.time + note.duration)) : duration;
		const span = Math.max(end - start, focusedTrack == null ? 1 / fps : beatSeconds * 4);
		const nextZoom = Math.max(8, Math.min(480, (scroller.clientWidth - CHANNEL_WIDTH - 50) / span));
		manuallyZoomedRef.current = focusedTrack != null;
		setZoom(nextZoom);
		requestAnimationFrame(() => {
			scroller.scrollLeft = Math.max(0, start * nextZoom - 25);
		});
	}, [beatSeconds, duration, focusedTrack, fps]);

	const changeZoom = React.useCallback(
		(nextZoom: number, pointerX?: number) => {
			const scroller = scrollerRef.current;
			if (scroller == null) return;
			const next = Math.max(8, Math.min(480, nextZoom));
			const anchor = pointerX ?? Math.max(0, (scroller.clientWidth - CHANNEL_WIDTH) / 2);
			const nextScroll = timelineZoomAnchor(scroller.scrollLeft, anchor, zoom, next);
			manuallyZoomedRef.current = true;
			setZoom(next);
			requestAnimationFrame(() => {
				scroller.scrollLeft = nextScroll;
			});
		},
		[zoom]
	);

	const seekAt = React.useCallback(
		(event: React.PointerEvent<HTMLElement>) => {
			if (event.button !== 0 || disabled) return;
			event.preventDefault();
			const target = event.currentTarget;
			const seek = (clientX: number) => {
				onSeek(
					clampTimelineTime((clientX - target.getBoundingClientRect().left) / zoom, duration, fps)
				);
			};
			seek(event.clientX);
			gestureRef.current?.();
			gestureRef.current = pointerGesture(target, event.pointerId, {
				move: (moveEvent) => seek(moveEvent.clientX),
				end: () => {
					gestureRef.current = null;
				}
			});
		},
		[disabled, duration, fps, onSeek, zoom]
	);

	const handleGestureChange = React.useCallback((cancel: (() => void) | null) => {
		if (cancel != null) gestureRef.current?.();
		gestureRef.current = cancel;
	}, []);

	const handleScroll = React.useCallback(() => {
		const scroller = scrollerRef.current;
		if (scroller == null) return;
		setViewport({ left: scroller.scrollLeft, width: scroller.clientWidth });
	}, []);

	const pan = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		if (event.button !== 1) return;
		event.preventDefault();
		const target = event.currentTarget;
		const verticalTarget =
			target.querySelector<HTMLElement>('.mm-midi-row.is-focused .mm-piano-pitch-scroll') ?? target;
		const { scrollLeft } = target;
		const { scrollTop } = verticalTarget;
		gestureRef.current?.();
		gestureRef.current = pointerGesture(target, event.pointerId, {
			move: (moveEvent) => {
				target.scrollLeft = scrollLeft + event.clientX - moveEvent.clientX;
				verticalTarget.scrollTop = scrollTop + event.clientY - moveEvent.clientY;
			},
			end: () => {
				gestureRef.current = null;
			}
		});
	}, []);

	function duplicateSelection() {
		if (disabled || !multiSelect || onAddNotes == null || !groupNotes.length) return;
		gestureRef.current?.();
		const copies = duplicatePianoNotes(groupNotes, snap);
		if (!onAddNotes(copies)) return;
		selectAddedNotes(
			copies,
			Math.max(
				0,
				groupNotes.findIndex((note) => note.id === selectedNoteId)
			)
		);
	}
	function selectAddedNotes(notes: TNote[], primaryIndex = 0) {
		const primary = notes[primaryIndex];
		if (primary == null) return;
		setSelection({ primaryId: primary.id, ids: new Set(notes.map((note) => note.id)) });
		onSelectNote(primary.id);
		const scroller = scrollerRef.current;
		if (scroller == null) return;
		requestAnimationFrame(() => {
			scroller
				.querySelector<HTMLElement>(`[data-note-id="${primary.id}"]`)
				?.focus({ preventScroll: true });
		});
		const start = Math.min(...notes.map((note) => note.time)) * zoom;
		const end = Math.max(...notes.map((note) => note.time + note.duration)) * zoom;
		if (
			start < scroller.scrollLeft ||
			end > scroller.scrollLeft + scroller.clientWidth - CHANNEL_WIDTH
		)
			scroller.scrollLeft = Math.max(0, start - 24);
	}
	function handleCopy(event: React.ClipboardEvent<HTMLElement>) {
		if (
			disabled ||
			!multiSelect ||
			!groupNotes.length ||
			isClipboardInput(event.target) ||
			window.getSelection()?.isCollapsed === false
		)
			return;
		const text = serializePianoClipboard(groupNotes);
		if (text == null) return;
		event.preventDefault();
		event.stopPropagation();
		event.clipboardData.setData('text/plain', text);
		reportClipboard(`Copied ${groupNotes.length} notes · ⌘/Ctrl+V: paste at playhead`);
	}
	function handlePaste(event: React.ClipboardEvent<HTMLElement>) {
		if (disabled || !multiSelect || onAddNotes == null || isClipboardInput(event.target)) return;
		const result = parsePianoClipboard(event.clipboardData.getData('text/plain'));
		if (result.kind === 'foreign') return;
		event.preventDefault();
		event.stopPropagation();
		if (result.kind === 'invalid') {
			reportClipboard('Cannot paste: invalid or unsupported MidiMarble note data.');
			return;
		}
		gestureRef.current?.();
		const notes = pastePianoNotes(result.notes, focusedTrack.id, timeRef?.current ?? time, snap);
		if (!onAddNotes(notes)) {
			setClipboardStatus('Paste was not added. The whole phrase must fit within project limits.');
			return;
		}
		selectAddedNotes(notes);
		reportClipboard(`Pasted ${notes.length} notes at the snapped playhead`);
	}
	function reportClipboard(message: string) {
		setClipboardStatus(message);
		onClipboardMessage?.(message);
	}

	function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
		if (event.defaultPrevented || document.querySelector(':popover-open')) return;
		const control = (event.target as HTMLElement).closest('button');
		if (control != null && !control.matches('.mm-midi-note, .mm-velocity-bar')) return;
		if ((event.target as HTMLElement).closest('input, select, textarea, [contenteditable]') != null)
			return;
		const target = event.target as HTMLElement;
		if (multiSelect && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
			event.preventDefault();
			event.stopPropagation();
			gestureRef.current?.();
			setNoteSelection(new Set(focusedTrack.notes.map((note) => note.id)));
			if (!focusedTrack.notes.some((note) => note.id === selectedNoteId) && focusedTrack.notes[0])
				onSelectNote(focusedTrack.notes[0].id);
			return;
		}
		if (multiSelect && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
			event.preventDefault();
			event.stopPropagation();
			duplicateSelection();
			return;
		}
		if (event.metaKey || event.ctrlKey || event.altKey) {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z')
				gestureRef.current?.();
			return;
		}
		if (multiSelect && event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			setNoteSelection(new Set(selectedNoteId == null ? [] : [selectedNoteId]));
			return;
		}
		const editingKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Delete', 'Backspace'];
		const editingControl =
			event.key.startsWith('Arrow') && target.closest('.mm-piano-key, .mm-velocity-bar') != null;
		if (multiSelect && editingKeys.includes(event.key) && !editingControl) {
			const notes = groupNotes;
			if (notes.length > 0) {
				event.preventDefault();
				event.stopPropagation();
				gestureRef.current?.();
				if (event.key === 'Delete' || event.key === 'Backspace')
					onDeleteNotes(notes.map((note) => note.id));
				else {
					const step = timelineSnapStep(snap) || 1 / fps;
					const direction = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : -1;
					const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
					const updates = movePianoNotes(
						notes,
						vertical ? 0 : direction * step,
						vertical ? direction * (event.shiftKey ? 12 : 1) : 0,
						duration,
						snap,
						selectedNoteId ?? undefined
					);
					onUpdateNotes(updates);
					const primary = updates.find((update) => update.id === selectedNoteId);
					if (vertical && primary) onAuditionNote?.(primary.patch.midi, focusedTrack.id);
				}
				return;
			}
		}
		if (
			(focusedTrack != null || expandedTracks.size > 0) &&
			['b', 'v'].includes(event.key.toLowerCase())
		) {
			event.preventDefault();
			event.stopPropagation();
			setDrawMode(event.key.toLowerCase() === 'b' ? 'draw' : 'select');
			return;
		}
		if (event.key === 'Home') {
			event.preventDefault();
			event.stopPropagation();
			fit();
		} else if (event.key === '+' || event.key === '=' || event.key === '-') {
			event.preventDefault();
			event.stopPropagation();
			changeZoom(event.key === '-' ? zoom / 1.3 : zoom * 1.3);
		}
	}

	// MARK: - Effects

	React.useEffect(() => {
		clockRef.current = time;
	}, [time]);

	React.useEffect(() => {
		const scroller = scrollerRef.current;
		if (scroller == null) return;
		const observer = new ResizeObserver(() => {
			if (!manuallyZoomedRef.current) fit();
			handleScroll();
		});
		observer.observe(scroller);
		return () => observer.disconnect();
	}, [fit, handleScroll]);

	React.useEffect(() => {
		const scroller = scrollerRef.current;
		if (scroller == null) return;
		const wheel = (event: WheelEvent) => {
			if (event.ctrlKey || event.metaKey || event.altKey) {
				event.preventDefault();
				const x = Math.max(
					0,
					event.clientX - scroller.getBoundingClientRect().left - CHANNEL_WIDTH
				);
				changeZoom(zoom * Math.exp(-event.deltaY * 0.008), x);
			} else if (event.shiftKey) {
				event.preventDefault();
				scroller.scrollLeft += event.deltaY + event.deltaX;
			}
		};
		scroller.addEventListener('wheel', wheel, { passive: false });
		return () => scroller.removeEventListener('wheel', wheel);
	}, [changeZoom, zoom]);

	React.useEffect(() => {
		if (!playing) return;
		let frame = 0;
		const paint = () => {
			const current = timeRef?.current ?? clockRef.current;
			if (playheadRef.current != null)
				playheadRef.current.style.transform = `translateX(${current * zoom}px)`;
			if (rulerPlayheadRef.current != null)
				rulerPlayheadRef.current.style.transform = `translateX(${current * zoom}px)`;
			const scroller = scrollerRef.current;
			if (playing && follow && gestureRef.current == null && scroller != null) {
				const available = scroller.clientWidth - CHANNEL_WIDTH;
				const x = current * zoom;
				if (x > scroller.scrollLeft + available - 35 || x < scroller.scrollLeft) {
					scroller.scrollLeft = Math.max(0, x - available * 0.15);
				}
			}
			frame = requestAnimationFrame(paint);
		};
		paint();
		return () => cancelAnimationFrame(frame);
	}, [follow, playing, timeRef, zoom]);

	React.useEffect(
		() => () => {
			gestureRef.current?.();
		},
		[]
	);

	React.useEffect(() => {
		if (disabled) gestureRef.current?.();
	}, [disabled]);

	const applyFocusRequest = React.useEffectEvent((trackId: string) => {
		focusTrack(trackId);
		scrollToTrackPitch(trackId);
	});
	React.useEffect(() => {
		if (focusRequest == null) return;
		const frame = requestAnimationFrame(() => applyFocusRequest(focusRequest.trackId));
		return () => cancelAnimationFrame(frame);
	}, [focusRequest]);

	// MARK: - UI

	return (
		<section
			className={`mm-timeline ${linkingObjectId != null ? 'is-linking' : ''} ${focusedTrack != null ? 'is-midi-focused' : ''}`}
			aria-label="Animation and music timeline"
			aria-disabled={disabled}
			inert={disabled}
			onKeyDown={handleKeyDown}
			onCopy={handleCopy}
			onPaste={handlePaste}
		>
			<header className="mm-timeline-toolbar">
				<div className="mm-timeline-title">
					<Music2 size={14} />
					<strong>{focusedTrack == null ? 'Timeline' : 'MIDI editor'}</strong>
					<span>
						{focusedTrack?.notes.length ?? project.notes.length} notes
						{multiSelect && groupNotes.length > 0 ? ` · ${groupNotes.length} selected` : ''}
					</span>
				</div>
				<div className="mm-timeline-tools">
					{focusedTrack != null && (
						<button
							type="button"
							className="mm-midi-editor-toggle"
							aria-label="Return to timeline"
							onClick={() => focusTrack(null)}
						>
							<ChevronLeft size={13} /> Timeline
						</button>
					)}
					{focusedTrack != null && (
						<select
							aria-label="MIDI editor track"
							value={focusedTrack.id}
							className="mm-midi-track-select"
							onChange={(event) => {
								focusTrack(event.target.value);
								scrollToTrackPitch(event.target.value);
							}}
						>
							{tracks.map((track) => (
								<option key={track.id} value={track.id}>
									{track.name}
								</option>
							))}
						</select>
					)}
					{(focusedTrack != null || expandedTracks.size > 0) && (
						<div className="mm-note-tools" aria-label="MIDI note tools">
							<button
								type="button"
								aria-label="Select MIDI notes"
								aria-pressed={drawMode === 'select'}
								title="Select and move (V)"
								onClick={() => setDrawMode('select')}
							>
								<MousePointer2 size={13} />
							</button>
							<button
								type="button"
								aria-label="Draw MIDI notes"
								aria-pressed={drawMode === 'draw'}
								title="Pencil (B) · drag to draw a note"
								onClick={() => setDrawMode('draw')}
							>
								<Pencil size={13} />
							</button>
							<select
								aria-label="New MIDI note length"
								value={drawLengthBeats}
								onChange={(event) => setDrawLengthBeats(Number(event.target.value))}
							>
								<option value={0.25}>1/16</option>
								<option value={0.5}>1/8</option>
								<option value={1}>1/4</option>
								<option value={2}>1/2</option>
								<option value={4}>1 bar</option>
							</select>
						</div>
					)}

					{multiSelect && (
						<>
							<button
								type="button"
								className="mm-note-duplicate"
								aria-label="Duplicate selected MIDI notes"
								title="Duplicate selection after phrase (⌘/Ctrl+D)"
								disabled={disabled || onAddNotes == null || !groupNotes.length}
								onClick={duplicateSelection}
							>
								<CopyPlus size={13} />
								<span>Duplicate</span>
							</button>
						</>
					)}
					<div className="mm-unit-switch" aria-label="Timeline units">
						<button
							type="button"
							aria-pressed={unit === 'frames'}
							onClick={() => setUnit('frames')}
						>
							Frames
						</button>
						<button
							type="button"
							aria-pressed={unit === 'seconds'}
							onClick={() => setUnit('seconds')}
						>
							Seconds
						</button>
						<button type="button" aria-pressed={unit === 'beats'} onClick={() => setUnit('beats')}>
							Beats
						</button>
					</div>
					<span className="mm-timeline-divider" />
					<Magnet size={13} className={snapMode === 'off' ? 'mm-muted-icon' : 'mm-snap-icon'} />
					<select
						aria-label="Timeline snapping"
						value={snapMode}
						onChange={(event) => setSnapMode(event.target.value as TTimelineSnap['mode'])}
					>
						<option value="off">Snap off</option>
						<option value="frame">Frame</option>
						<option value="beat">Beat</option>
						<option value="sixteenth">1/16 note</option>
					</select>
					<button
						type="button"
						className="mm-timeline-icon"
						aria-label="Follow playhead"
						aria-pressed={follow}
						title="Follow playhead during playback"
						onClick={() => setFollow(!follow)}
					>
						<Focus size={14} />
					</button>
					<span className="mm-timeline-divider" />
					<button
						type="button"
						className="mm-timeline-icon"
						aria-label="Zoom timeline out"
						onClick={() => changeZoom(zoom / 1.3)}
					>
						<Minus size={13} />
					</button>
					<button
						type="button"
						className="mm-timeline-icon"
						aria-label="Zoom timeline in"
						onClick={() => changeZoom(zoom * 1.3)}
					>
						<Plus size={13} />
					</button>
					<button
						type="button"
						className="mm-timeline-icon"
						aria-label={focusedTrack == null ? 'Frame all timeline content' : 'Frame track notes'}
						title={focusedTrack == null ? 'Frame all (Home)' : 'Frame track notes (Home)'}
						onClick={fit}
					>
						<Maximize2 size={13} />
					</button>
				</div>
			</header>
			{linkingObject != null && (
				<div className="mm-timeline-link-hint">
					<Link2 size={12} /> Click a note to link <strong>{linkingObject.name}</strong>
				</div>
			)}
			<div
				className="mm-timeline-scroll"
				ref={scrollerRef}
				onScroll={handleScroll}
				onPointerDown={pan}
				tabIndex={0}
			>
				<div
					className="mm-timeline-content"
					style={
						{
							'width': gridWidth + CHANNEL_WIDTH,
							'--mm-grid-step': `${(unit === 'beats' ? beatSeconds : tickSeconds) * zoom}px`,
							'--mm-grid-minor': `${unit === 'beats' ? (beatSeconds * zoom) / 4 : (tickSeconds * zoom) / 5}px`
						} as React.CSSProperties
					}
				>
					<div className="mm-timeline-row mm-ruler-row">
						<div className="mm-channel mm-ruler-channel">
							<button
								type="button"
								className="mm-channel-toggle"
								aria-label={`${musicOpen ? 'Hide' : 'Show'} music channels`}
								aria-expanded={musicOpen}
								title="Show or hide music tracks to focus on camera, lighting and contacts"
								onClick={() => {
									if (focusedTrack != null) focusTrack(null);
									setMusicOpen(!musicOpen);
								}}
							>
								{musicOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Music{' '}
								<small>{tracks.length}</small>
							</button>
							<div className="mm-music-channel-actions">
								<span>
									{unit === 'frames'
										? `${fps} fps`
										: unit === 'beats'
											? `${project.bpm} bpm`
											: 'Time'}
								</span>
								{onAddTrack && (
									<button
										type="button"
										aria-label="Add MIDI track"
										title="Add a MIDI track"
										onClick={onAddTrack}
									>
										<Plus size={12} />
									</button>
								)}
							</div>
						</div>
						<div className="mm-timeline-ruler" onPointerDown={seekAt} title="Drag to scrub">
							<span
								className="mm-ruler-playhead"
								ref={rulerPlayheadRef}
								style={{ transform: `translateX(${time * zoom}px)` }}
							>
								{unit === 'frames'
									? Math.round(time * fps)
									: unit === 'beats'
										? (time / beatSeconds + 1).toFixed(2)
										: `${time.toFixed(2)}s`}
							</span>
							{Array.from({ length: Math.ceil(duration / tickSeconds) + 1 }, (_, index) => {
								const tick = index * tickSeconds;
								return (
									<span key={index} style={{ left: tick * zoom }}>
										{unit === 'frames'
											? Math.round(tick * fps)
											: unit === 'beats'
												? Math.round(tick / beatSeconds) + 1
												: `${Number(tick.toFixed(2))}s`}
									</span>
								);
							})}
						</div>
					</div>

					{musicOpen &&
						shownTracks.map((track) => (
							<MidiTrackLane
								key={track.id}
								track={track}
								project={project}
								range={focusedTrack?.id === track.id ? MIDI_PITCH_RANGE : track}
								expanded={expandedTracks.has(track.id)}
								focused={focusedTrack?.id === track.id}
								selectedNoteId={selectedNoteId}
								selectedNoteIds={multiSelect ? noteSelection : undefined}
								onSelectionChange={(ids) => setNoteSelection(new Set(ids))}
								linkedNotes={linkedNotes}
								zoom={zoom}
								snap={snap}
								visibleStart={visibleStart}
								visibleEnd={visibleEnd}
								currentTime={time}
								playing={playing}
								timeRef={timeRef}
								drawMode={drawMode}
								drawLength={drawLength}
								linkingObjectId={linkingObjectId}
								draggingObjectId={draggingObjectId}
								onExpand={() => {
									if (focusedTrack?.id === track.id) {
										focusTrack(null);
										return;
									}
									const expanded = expandedTracks.has(track.id);
									setExpandedTracks((current) => {
										const next = new Set(current);
										if (expanded) next.delete(track.id);
										else next.add(track.id);
										return next;
									});
									if (!expanded) scrollToTrackPitch(track.id);
								}}
								onFocus={() => {
									focusTrack(track.id);
									scrollToTrackPitch(track.id);
								}}
								onSelectTrack={onSelectTrack}
								onSelectNote={onSelectNote}
								onUpdateNote={onUpdateNote}
								onUpdateNotes={onUpdateNotes}
								onAddNotes={onAddNotes}
								onAddNote={onAddNote}
								onDeleteNote={onDeleteNote}
								onMute={() => onMuteTrack(track.id)}
								soloActive={soloActive}
								onSolo={onSoloTrack == null ? undefined : () => onSoloTrack(track.id)}
								onAuditionNote={onAuditionNote}
								onLinkObject={onLinkObject}
								onGestureChange={handleGestureChange}
							/>
						))}

					<KeyframeLane
						kind="camera"
						label="Camera"
						icon={<Camera size={13} />}
						keyframes={project.camera?.keyframes ?? []}
						selectedId={selectedCameraKeyframeId}
						zoom={zoom}
						duration={duration}
						snap={snap}
						hidden={focusedTrack != null}
						disabled={disabled}
						onSeek={onSeek}
						onScrub={seekAt}
						onSelect={onSelectCameraKeyframe}
						onMove={onUpdateCameraKeyframe}
						onDelete={onDeleteCameraKeyframe}
						onAdd={onAddCameraKeyframe}
						onGestureChange={handleGestureChange}
					/>
					<KeyframeLane
						kind="lighting"
						label="Lighting"
						icon={<Lightbulb size={13} />}
						keyframes={project.scene?.keyframes ?? []}
						selectedId={selectedLightingKeyframeId}
						zoom={zoom}
						duration={duration}
						snap={snap}
						hidden={focusedTrack != null}
						disabled={disabled}
						onSeek={onSeek}
						onScrub={seekAt}
						onSelect={onSelectLightingKeyframe}
						onMove={onMoveLightingKeyframe}
						onDelete={onDeleteLightingKeyframe}
						onAdd={onAddLightingKeyframe}
						onGestureChange={handleGestureChange}
					/>
					<ContactLane
						performance={performance}
						objectNames={objectNames}
						noteTimes={noteTimes}
						selectedObjectId={selectedObjectId}
						selectedNoteId={selectedNoteId}
						visibleStart={visibleStart}
						visibleEnd={visibleEnd}
						zoom={zoom}
						fps={fps}
						hidden={focusedTrack != null}
						onSeek={onSeek}
						onSelectNote={onSelectNote}
						onSelectObject={onSelectObject}
					/>
					<div
						className="mm-timeline-playhead"
						ref={playheadRef}
						style={{ left: CHANNEL_WIDTH, transform: `translateX(${time * zoom}px)` }}
						aria-hidden="true"
					>
						<i />
					</div>
				</div>
			</div>
			<footer className="mm-timeline-footer">
				<div className="mm-timeline-position">
					<span>Current</span>
					<TimelinePosition
						time={time}
						fps={fps}
						bpm={project.bpm}
						unit={unit}
						duration={duration}
						onSeek={onSeek}
					/>
					<span className="mm-timeline-range">
						Start <b>{unit === 'beats' ? 1 : 0}</b> End{' '}
						<b>
							{unit === 'frames'
								? Math.round(duration * fps)
								: unit === 'beats'
									? Number((duration / beatSeconds + 1).toFixed(2))
									: `${duration.toFixed(2)}s`}
						</b>
					</span>
				</div>
				{clipboardStatus != null && (
					<span className="mm-timeline-help" role="status">
						{clipboardStatus}
					</span>
				)}
				<ContextHelp label="Timeline help">
					<p>
						Click a track’s piano icon to edit its MIDI. Click keys to audition; double-click a key
						to add at the playhead.
					</p>
					<p>
						Drag notes to move, or their edges to trim. Shift-click toggles selection; drag empty
						space for a box selection.
					</p>
					<p>
						Snapping applies when you draw, move or trim. Switching the grid keeps existing notes in
						place. Hold Alt for precise timing.
					</p>
					<p>
						⌘/Ctrl+C / V copies and pastes; ⌘/Ctrl+D duplicates. ⌘/Ctrl + scroll zooms; Shift +
						scroll pans.
					</p>
					<p>Drag velocity bars vertically to change how hard a note plays.</p>
				</ContextHelp>
			</footer>
		</section>
	);
};

export interface TTimelineProps {
	focusRequest?: { trackId: string; token: string } | null;
	project: TProject;
	performance: TPerformance | null;
	time: number;
	selectedNoteId: string | null;
	selectedObjectId?: string | null;
	selectedCameraKeyframeId?: string | null;
	selectedLightingKeyframeId?: string | null;
	fps?: number;
	playing?: boolean;
	disabled?: boolean;
	timeRef?: React.RefObject<number>;
	linkingObjectId?: string | null;
	draggingObjectId?: string | null;
	onSeek(time: number): void;
	onSelectNote(id: string): void;
	onSelectObject?(id: string): void;
	onUpdateNote(id: string, patch: Partial<TNote>): void;
	onUpdateNotes?(updates: Array<{ id: string; patch: Partial<TNote> }>): void;
	onDeleteNotes?(ids: string[]): void;
	onAddNotes?(notes: TNote[]): boolean;
	onClipboardMessage?(message: string): void;
	onAddNote(
		trackId: string,
		time: number,
		midi: number,
		duration?: number,
		velocity?: number
	): void;
	onAuditionNote?(midi: number, trackId: string): void;
	onSelectTrack?(trackId: string): void;
	onFocusMidi?(trackId: string | null): void;
	onDeleteNote?(id: string): void;
	onAddTrack?(): void;
	onMuteTrack(id: string): void;
	onSoloTrack?(id: string): void;
	onSelectCameraKeyframe?(id: string): void;
	onUpdateCameraKeyframe?(id: string, time: number): void;
	onDeleteCameraKeyframe?(id: string): void;
	onAddCameraKeyframe?(): void;
	onSelectLightingKeyframe?(id: string): void;
	onMoveLightingKeyframe?(id: string, time: number): void;
	onDeleteLightingKeyframe?(id: string): void;
	onAddLightingKeyframe?(): void;
	onLinkObject?(objectId: string, noteId: string): void;
}

function isClipboardInput(target: EventTarget): boolean {
	return (
		target instanceof Element &&
		target.closest('input, select, textarea, [contenteditable]') != null
	);
}

const CHANNEL_WIDTH = 190;
const MIDI_PITCH_RANGE = { minPitch: 0, maxPitch: 127 };
type TTimelineUnit = 'frames' | 'seconds' | 'beats';

const TimelinePosition: React.FC<TTimelinePositionProps> = (props) => {
	const { time, fps, bpm, unit, duration, onSeek } = props;
	const inputRef = React.useRef<HTMLInputElement>(null);
	const focusedRef = React.useRef(false);
	function formatPosition(position: number) {
		if (unit === 'frames') return Math.round(position * fps).toString();
		if (unit === 'beats') return ((position * bpm) / 60 + 1).toFixed(2);
		return position.toFixed(2);
	}
	const value = formatPosition(time);
	React.useEffect(() => {
		if (inputRef.current != null && !focusedRef.current) inputRef.current.value = value;
	}, [value]);
	return (
		<input
			ref={inputRef}
			aria-label={
				unit === 'frames'
					? 'Current frame'
					: unit === 'beats'
						? 'Current beat'
						: 'Current time in seconds'
			}
			type="text"
			inputMode="decimal"
			defaultValue={value}
			onFocus={(event) => {
				focusedRef.current = true;
				event.currentTarget.select();
			}}
			onBlur={(event) => {
				focusedRef.current = false;
				const numeric = Number(event.currentTarget.value);
				if (!Number.isFinite(numeric)) {
					event.currentTarget.value = value;
					return;
				}
				const nextTime = clampTimelineTime(
					unit === 'frames'
						? numeric / fps
						: unit === 'beats'
							? ((numeric - 1) * 60) / bpm
							: numeric,
					duration,
					fps
				);
				event.currentTarget.value = formatPosition(nextTime);
				onSeek(nextTime);
			}}
			onKeyDown={(event) => {
				event.stopPropagation();
				if (event.key === 'Enter') event.currentTarget.blur();
				if (event.key === 'Escape') {
					event.currentTarget.value = value;
					event.currentTarget.blur();
				}
			}}
		/>
	);
};

interface TTimelinePositionProps {
	time: number;
	fps: number;
	bpm: number;
	unit: TTimelineUnit;
	duration: number;
	onSeek(time: number): void;
}
