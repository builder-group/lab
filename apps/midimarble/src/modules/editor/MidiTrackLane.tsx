import {
	ChevronDown,
	ChevronRight,
	ChevronsUpDown,
	Link2,
	Minus,
	Music2,
	Piano,
	Plus,
	Volume2,
	VolumeX
} from 'lucide-react';
import React from 'react';
import { formatTime, noteName, type TNote, type TProject, type TTrack } from '../project';
import {
	drawPianoNote,
	editPianoVelocity,
	fitPianoPitchView,
	getPianoMarquee,
	isPianoBlackKey,
	movePianoNotes,
	pianoPitchAtY,
	pianoPitchTop,
	pianoPitchZoomAnchor,
	type TPianoPitchRange
} from './piano-editing';
import { PianoKeyboard } from './PianoKeyboard';
import { pointerGesture } from './pointer-gesture';
import { editTimelineNote, timelineSnapStep, type TTimelineSnap } from './timeline-editing';

export const MidiTrackLane: React.FC<TMidiTrackLaneProps> = (props) => {
	const {
		track,
		project,
		range,
		expanded,
		focused,
		selectedNoteId,
		selectedNoteIds,
		onSelectionChange,
		linkedNotes,
		zoom,
		snap,
		visibleStart,
		visibleEnd,
		currentTime,
		playing = false,
		timeRef,
		drawMode,
		drawLength,
		linkingObjectId,
		draggingObjectId,
		onExpand,
		onFocus,
		onSelectTrack,
		onSelectNote,
		onUpdateNote,
		onUpdateNotes,
		onAddNotes,
		onAddNote,
		onDeleteNote,
		onMute,
		onSolo,
		soloActive = false,
		onAuditionNote,
		onLinkObject,
		onGestureChange
	} = props;
	const [auditionedPitch, setAuditionedPitch] = React.useState<number | null>(null);
	const [previewPitch, setPreviewPitch] = React.useState<number | null>(null);
	const [dropNoteId, setDropNoteId] = React.useState<string | null>(null);
	const [pitchZoom, setPitchZoom] = React.useState(PIANO_ROW_HEIGHT);
	const pitchRowHeight = focused ? pitchZoom : PIANO_ROW_HEIGHT;
	const gestureRef = React.useRef<(() => void) | null>(null);
	const rowRef = React.useRef<HTMLDivElement>(null);
	const draftRef = React.useRef<HTMLDivElement>(null);
	const marqueeRef = React.useRef<HTMLDivElement>(null);
	const pitchScrollRef = React.useRef<HTMLDivElement>(null);
	const keysScrollRef = React.useRef<HTMLDivElement>(null);
	const selectedNote = track.notes.find((note) => note.id === selectedNoteId);
	const silenced = track.muted || (soloActive && !track.solo);
	const selection = React.useMemo(
		() => selectedNoteIds ?? new Set(selectedNoteId == null ? [] : [selectedNoteId]),
		[selectedNoteId, selectedNoteIds]
	);
	const selectionCount = track.notes.filter((note) => selection.has(note.id)).length;
	const activePitch = previewPitch ?? auditionedPitch ?? selectedNote?.midi ?? null;
	const pitchHeight = (range.maxPitch - range.minPitch + 1) * pitchRowHeight;
	const laneHeight = expanded
		? TRACK_HEADER_HEIGHT + pitchHeight + VELOCITY_HEIGHT
		: TRACK_HEADER_HEIGHT;
	const visibleNotes = React.useMemo(
		() =>
			track.notes.filter(
				(note) =>
					note.id === selectedNoteId ||
					(note.time + note.duration >= visibleStart && note.time <= visibleEnd)
			),
		[selectedNoteId, track.notes, visibleEnd, visibleStart]
	);

	const applyPitchView = React.useCallback((rowHeight: number, scrollTop: number) => {
		gestureRef.current?.();
		setPitchZoom(rowHeight);
		requestAnimationFrame(() => {
			const scroll = pitchScrollRef.current;
			if (scroll == null) return;
			scroll.scrollTop = scrollTop;
			if (keysScrollRef.current) keysScrollRef.current.scrollTop = scroll.scrollTop;
		});
	}, []);

	const changePitchZoom = React.useCallback(
		(height: number) => {
			const scroll = pitchScrollRef.current;
			if (scroll == null) return;
			const next = Math.max(4, Math.min(24, height));
			applyPitchView(
				next,
				pianoPitchZoomAnchor(scroll.scrollTop, scroll.clientHeight / 2, pitchRowHeight, next)
			);
		},
		[applyPitchView, pitchRowHeight]
	);

	const fitPitches = React.useCallback(() => {
		const scroll = pitchScrollRef.current;
		if (scroll == null) return;
		const selected = track.notes.filter((note) => selection.has(note.id));
		const view = fitPianoPitchView(
			selected.length > 1 ? selected : track.notes,
			range,
			scroll.clientHeight
		);
		applyPitchView(view.rowHeight, view.scrollTop);
	}, [applyPitchView, range, selection, track.notes]);

	function selectNote(note: TNote, toggle = false, solo = false): TNote[] {
		if (selectedNoteIds == null) {
			onSelectNote(note.id);
			return [note];
		}
		const ids =
			solo || (!toggle && !selection.has(note.id)) ? new Set([note.id]) : new Set(selection);
		if (toggle) {
			if (ids.has(note.id)) ids.delete(note.id);
			else ids.add(note.id);
		}
		onSelectionChange?.([...ids]);
		if (ids.has(note.id)) onSelectNote(note.id);
		else if (selectedNoteId === note.id) {
			const primary = track.notes.find((entry) => ids.has(entry.id));
			if (primary) onSelectNote(primary.id);
		}
		return track.notes.filter((entry) => ids.has(entry.id));
	}

	const audition = React.useCallback(
		(midi: number) => {
			setAuditionedPitch(midi);
			setPreviewPitch(midi);
			onAuditionNote?.(midi, track.id);
		},
		[onAuditionNote, track.id]
	);

	function beginGesture(
		target: HTMLElement,
		pointerId: number,
		callbacks: { move(event: PointerEvent): void; end(cancelled: boolean): void }
	) {
		gestureRef.current?.();
		const cancel = pointerGesture(target, pointerId, {
			move: callbacks.move,
			end: (cancelled) => {
				gestureRef.current = null;
				onGestureChange?.(null);
				callbacks.end(cancelled);
			}
		});
		gestureRef.current = cancel;
		onGestureChange?.(cancel);
	}

	function dragNote(event: React.PointerEvent<HTMLButtonElement>, note: TNote) {
		if (event.button !== 0) return;
		event.stopPropagation();
		if (linkingObjectId != null) {
			onLinkObject?.(linkingObjectId, note.id);
			return;
		}
		event.preventDefault();
		event.currentTarget.focus({ preventScroll: true });
		if (selectedNoteIds != null && event.shiftKey) {
			selectNote(note, true);
			return;
		}
		const edgeElement = (event.target as HTMLElement).closest<HTMLElement>('[data-edge]');
		const edge =
			edgeElement?.dataset['edge'] === 'start'
				? 'start'
				: edgeElement?.dataset['edge'] === 'end'
					? 'end'
					: null;
		const movingNotes = selectNote(note, false, edge != null);
		audition(note.midi);
		const duplicate = edge == null && (event.metaKey || event.ctrlKey);
		if (duplicate && movingNotes.length > 1 && onAddNotes == null) return;
		const elements = new Map(
			Array.from(rowRef.current?.querySelectorAll<HTMLButtonElement>('.mm-midi-note') ?? []).map(
				(element) => [element.dataset['noteId'], element]
			)
		);
		const previews = movingNotes.flatMap((entry) => {
			const element = elements.get(entry.id);
			return element == null
				? []
				: [
						{
							id: entry.id,
							element,
							original: {
								left: element.style.left,
								width: element.style.width,
								top: element.style.top
							}
						}
					];
		});
		const initialScroll = focused ? (pitchScrollRef.current?.scrollTop ?? 0) : 0;
		let updates = movePianoNotes(movingNotes, 0, 0, project.duration, snap);
		let previewMidi = note.midi;
		let moved = false;
		beginGesture(event.currentTarget, event.pointerId, {
			move: (next) => {
				if (!moved && Math.hypot(next.clientX - event.clientX, next.clientY - event.clientY) < 3)
					return;
				moved = true;
				const preciseSnap = next.altKey ? { ...snap, mode: 'off' as const } : snap;
				const delta = (next.clientX - event.clientX) / zoom;
				const pitchDelta =
					expanded && edge == null
						? Math.round(
								(event.clientY -
									next.clientY -
									(focused ? (pitchScrollRef.current?.scrollTop ?? 0) - initialScroll : 0)) /
									pitchRowHeight
							)
						: 0;
				updates =
					edge == null
						? movePianoNotes(movingNotes, delta, pitchDelta, project.duration, preciseSnap, note.id)
						: [
								{
									id: note.id,
									patch: {
										...editTimelineNote(note, delta, edge, project.duration, preciseSnap),
										midi: note.midi
									}
								}
							];
				const byId = new Map(updates.map((update) => [update.id, update.patch]));
				for (const { id, element } of previews) {
					const patch = byId.get(id);
					if (patch == null) continue;
					element.style.left = `${patch.time * zoom}px`;
					element.style.width = `${Math.max(8, patch.duration * zoom)}px`;
					element.style.top = `${expanded ? pianoPitchTop(patch.midi, range, pitchRowHeight) + 1 : 8}px`;
					element.classList.add('is-dragging');
				}
				const midi = byId.get(note.id)?.midi ?? note.midi;
				if (midi !== previewMidi) audition(midi);
				previewMidi = midi;
			},
			end: (cancelled) => {
				for (const { element, original } of previews) {
					Object.assign(element.style, original);
					element.classList.remove('is-dragging');
				}
				setPreviewPitch(null);
				if (cancelled || !moved) return;
				if (duplicate && onAddNotes != null) {
					const byId = new Map(updates.map((update) => [update.id, update.patch]));
					const copies = movingNotes.map((entry) => ({
						...entry,
						...byId.get(entry.id),
						id: crypto.randomUUID()
					}));
					if (onAddNotes(copies)) {
						onSelectionChange?.(copies.map((entry) => entry.id));
						const primaryIndex = movingNotes.findIndex((entry) => entry.id === note.id);
						const primary = copies[primaryIndex];
						if (primary) onSelectNote(primary.id);
					}
				} else if (duplicate) {
					const patch = updates[0]?.patch;
					if (patch) onAddNote(track.id, patch.time, patch.midi, patch.duration, note.velocity);
				} else if (updates.length > 1) onUpdateNotes?.(updates);
				else if (updates[0]) onUpdateNote(updates[0].id, updates[0].patch);
			}
		});
	}

	function marqueeNotes(event: React.PointerEvent<HTMLDivElement>) {
		if (!focused || selectedNoteIds == null || onSelectionChange == null) return;
		event.preventDefault();
		event.stopPropagation();
		const grid = event.currentTarget;
		grid.focus({ preventScroll: true });
		function point(clientX: number, clientY: number) {
			const bounds = grid.getBoundingClientRect();
			return {
				x: Math.max(0, Math.min(grid.clientWidth, clientX - bounds.left)),
				y: Math.max(0, Math.min(pitchHeight, clientY - bounds.top))
			};
		}
		const start = point(event.clientX, event.clientY);
		const original = [...selection];
		let ids = original;
		let moved = false;
		beginGesture(grid, event.pointerId, {
			move: (next) => {
				if (!moved && Math.hypot(next.clientX - event.clientX, next.clientY - event.clientY) < 4)
					return;
				moved = true;
				const box = getPianoMarquee(
					track.notes,
					start,
					point(next.clientX, next.clientY),
					range,
					pitchRowHeight,
					zoom
				);
				const nextIds = event.shiftKey ? [...new Set([...original, ...box.ids])] : box.ids;
				if (nextIds.length !== ids.length || nextIds.some((id, index) => id !== ids[index]))
					onSelectionChange(nextIds);
				ids = nextIds;
				const overlay = marqueeRef.current;
				if (overlay == null) return;
				overlay.hidden = false;
				Object.assign(overlay.style, {
					left: `${box.left}px`,
					top: `${box.top}px`,
					width: `${box.width}px`,
					height: `${box.height}px`
				});
			},
			end: (cancelled) => {
				if (marqueeRef.current) marqueeRef.current.hidden = true;
				if (cancelled) {
					onSelectionChange(original);
					return;
				}
				if (!moved) {
					if (!event.shiftKey) onSelectionChange(selectedNoteId == null ? [] : [selectedNoteId]);
					return;
				}
				if (selectedNoteId == null || !ids.includes(selectedNoteId)) {
					const primary = track.notes.find((note) => ids.includes(note.id));
					if (primary) onSelectNote(primary.id);
				}
			}
		});
	}

	function editGrid(event: React.PointerEvent<HTMLDivElement>) {
		if (
			event.button !== 0 ||
			linkingObjectId != null ||
			(event.target as HTMLElement).closest('button') != null
		)
			return;
		if (drawMode === 'select') {
			marqueeNotes(event);
			return;
		}
		if (!expanded) return;
		event.preventDefault();
		event.stopPropagation();
		const grid = event.currentTarget;
		const bounds = grid.getBoundingClientRect();
		const start = (event.clientX - bounds.left) / zoom;
		const midi = pianoPitchAtY(event.clientY - bounds.top, range, pitchRowHeight);
		let draft = drawPianoNote(start, start, project.duration, snap, drawLength);
		audition(midi);
		function paint() {
			const element = draftRef.current;
			if (element == null) return;
			element.hidden = false;
			element.textContent = noteName(midi);
			element.style.left = `${draft.time * zoom}px`;
			element.style.width = `${Math.max(8, draft.duration * zoom)}px`;
			element.style.top = `${pianoPitchTop(midi, range, pitchRowHeight) + 1}px`;
		}
		paint();
		beginGesture(grid, event.pointerId, {
			move: (next) => {
				draft = drawPianoNote(
					start,
					(next.clientX - bounds.left) / zoom,
					project.duration,
					next.altKey ? { ...snap, mode: 'off' } : snap,
					drawLength
				);
				paint();
			},
			end: (cancelled) => {
				if (draftRef.current != null) draftRef.current.hidden = true;
				setPreviewPitch(null);
				if (!cancelled) onAddNote(track.id, draft.time, midi, draft.duration);
			}
		});
	}

	function addAtPointer(event: React.MouseEvent<HTMLDivElement>) {
		if (
			linkingObjectId != null ||
			drawMode === 'draw' ||
			(event.target as HTMLElement).closest('button') != null
		)
			return;
		const bounds = event.currentTarget.getBoundingClientRect();
		const midi = expanded
			? pianoPitchAtY(event.clientY - bounds.top, range, pitchRowHeight)
			: (activePitch ?? 60);
		const next = drawPianoNote(
			(event.clientX - bounds.left) / zoom,
			(event.clientX - bounds.left) / zoom,
			project.duration,
			snap,
			drawLength
		);
		onAddNote(track.id, next.time, midi, next.duration);
		audition(midi);
	}

	function dragVelocity(event: React.PointerEvent<HTMLButtonElement>, note: TNote) {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.focus({ preventScroll: true });
		selectNote(note, false, true);
		const target = event.currentTarget;
		const original = target.style.height;
		let velocity = note.velocity;
		beginGesture(target, event.pointerId, {
			move: (next) => {
				velocity = editPianoVelocity(
					note.velocity,
					next.clientY - event.clientY,
					VELOCITY_HEIGHT - 18
				);
				target.style.height = `${Math.max(2, velocity * (VELOCITY_HEIGHT - 18))}px`;
				target.setAttribute('aria-valuenow', String(Math.round(velocity * 127)));
			},
			end: (cancelled) => {
				target.style.height = original;
				target.setAttribute('aria-valuenow', String(Math.round(note.velocity * 127)));
				if (!cancelled && velocity !== note.velocity) onUpdateNote(note.id, { velocity });
			}
		});
	}

	React.useEffect(() => () => gestureRef.current?.(), []);
	React.useEffect(() => {
		const scroll = pitchScrollRef.current;
		if (!focused || scroll == null || selectedNote == null) return;
		const currentRowHeight = Number(rowRef.current?.dataset['pianoRowHeight']) || PIANO_ROW_HEIGHT;
		const top = pianoPitchTop(selectedNote.midi, range, currentRowHeight);
		if (top < scroll.scrollTop) scroll.scrollTop = top;
		else if (top + currentRowHeight > scroll.scrollTop + scroll.clientHeight)
			scroll.scrollTop = top + currentRowHeight - scroll.clientHeight;
	}, [focused, range, selectedNote]);
	React.useEffect(() => {
		if (!focused) return;
		const keys = keysScrollRef.current;
		if (keys == null) return;
		function wheel(event: WheelEvent) {
			if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
			const scroll = pitchScrollRef.current;
			if (scroll == null) return;
			event.preventDefault();
			event.stopPropagation();
			scroll.scrollTop += event.deltaY;
		}
		keys.addEventListener('wheel', wheel, { passive: false });
		return () => keys.removeEventListener('wheel', wheel);
	}, [focused]);

	return (
		<div
			ref={rowRef}
			className={`mm-timeline-row mm-midi-row ${silenced ? 'is-muted' : ''} ${expanded ? 'is-expanded' : ''} ${focused ? 'is-focused' : ''} ${selectionCount > 1 ? 'has-note-group' : ''}`}
			data-track-id={track.id}
			data-piano-row-height={pitchRowHeight}
			data-piano-dense={pitchRowHeight < 12 ? true : undefined}
			style={
				{
					'height': focused ? undefined : laneHeight,
					'--mm-track-color': track.color,
					'--mm-pitch-row-height': `${pitchRowHeight}px`
				} as React.CSSProperties
			}
		>
			<div className="mm-channel mm-track-channel">
				<div className="mm-track-controls">
					<button
						type="button"
						className="mm-disclosure"
						aria-label={`${expanded ? 'Collapse' : 'Expand'} ${track.name}`}
						aria-expanded={expanded}
						onClick={onExpand}
					>
						{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
					</button>
					<Music2 className="mm-track-symbol" size={12} />
					<button
						type="button"
						className="mm-track-name"
						onClick={() => onSelectTrack?.(track.id)}
						title={track.name}
					>
						<strong>{track.name}</strong>
						<span className={selectionCount > 1 ? 'is-selection-count' : undefined}>
							{selectionCount > 1 ? `${selectionCount} selected` : `${track.notes.length} notes`}
						</span>
					</button>
					<button
						type="button"
						className="mm-timeline-icon"
						aria-label={`Open MIDI editor for ${track.name}`}
						title="Open piano roll"
						onClick={onFocus}
					>
						<Piano size={13} />
					</button>
					<button
						type="button"
						className="mm-timeline-icon"
						aria-label={`${track.muted ? 'Unmute' : 'Mute'} ${track.name}`}
						aria-pressed={track.muted}
						onClick={onMute}
					>
						{track.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
					</button>
					{onSolo != null && (
						<button
							type="button"
							className="mm-timeline-icon mm-track-solo"
							aria-label={`Solo ${track.name}`}
							aria-pressed={track.solo ?? false}
							title={`${track.solo ? 'Unsolo' : 'Solo'} ${track.name} · MIDI audio only; Surface level controls rolling`}
							onClick={onSolo}
						>
							S
						</button>
					)}
				</div>
				{expanded && (
					<>
						<div className="mm-piano-key-info">
							<span className="mm-piano-pitch-name">
								{activePitch == null ? 'Piano roll' : noteName(activePitch)}
							</span>
							<span>
								{activePitch == null
									? `${noteName(range.minPitch)}–${noteName(range.maxPitch)}`
									: `MIDI ${activePitch}`}
							</span>
							{focused && (
								<div className="mm-piano-pitch-tools" aria-label="Pitch view">
									<button
										type="button"
										aria-label="Pitch zoom out"
										title="Show more pitches"
										disabled={pitchRowHeight <= 4}
										onClick={() => changePitchZoom(pitchRowHeight - 2)}
									>
										<Minus size={12} />
									</button>
									<button
										type="button"
										aria-label="Fit notes vertically"
										title={selectionCount > 1 ? 'Fit selected pitches' : 'Fit track pitches'}
										disabled={!track.notes.length}
										onClick={fitPitches}
									>
										<ChevronsUpDown size={12} />
									</button>
									<button
										type="button"
										aria-label="Pitch zoom in"
										title="Enlarge pitch rows"
										disabled={pitchRowHeight >= 24}
										onClick={() => changePitchZoom(pitchRowHeight + 2)}
									>
										<Plus size={12} />
									</button>
								</div>
							)}
						</div>
						<div
							className="mm-piano-keys-wrap"
							ref={keysScrollRef}
							style={{ top: TRACK_HEADER_HEIGHT, height: focused ? undefined : pitchHeight }}
							onScroll={(event) => {
								if (!focused || pitchScrollRef.current == null) return;
								pitchScrollRef.current.scrollTop = event.currentTarget.scrollTop;
							}}
						>
							<div style={{ height: pitchHeight }}>
								<PianoKeyboard
									range={range}
									rowHeight={pitchRowHeight}
									activePitch={activePitch}
									pressedPitch={previewPitch}
									notes={track.notes}
									playing={playing}
									audible={!silenced}
									time={currentTime}
									timeRef={timeRef}
									onAudition={audition}
									onRelease={() => setPreviewPitch(null)}
									onAddAtPlayhead={(midi) => {
										const next = drawPianoNote(
											currentTime,
											currentTime,
											project.duration,
											snap,
											drawLength
										);
										onAddNote(track.id, next.time, midi, next.duration);
									}}
								/>
							</div>
						</div>
						<div className="mm-velocity-label">
							<strong>Velocity</strong>
							<span>
								{selectedNote == null ? '' : `${Math.round(selectedNote.velocity * 127)} / 127`}
							</span>
						</div>
					</>
				)}
			</div>
			<div className="mm-track-editor">
				{expanded && (
					<div className="mm-piano-grid-heading">
						<span>
							{track.name}
							{selectionCount > 1 ? ` · ${selectionCount} selected` : ''}
						</span>
					</div>
				)}
				<div
					className="mm-piano-pitch-scroll"
					ref={pitchScrollRef}
					onScroll={(event) => {
						if (!focused || keysScrollRef.current == null) return;
						keysScrollRef.current.scrollTop = event.currentTarget.scrollTop;
					}}
				>
					<div
						className={`mm-note-lane ${expanded ? 'mm-piano-grid' : ''} ${drawMode === 'draw' ? 'is-draw-tool' : ''}`}
						style={expanded ? { height: pitchHeight } : undefined}
						tabIndex={focused ? 0 : undefined}
						aria-label={`${track.name} note grid`}
						onPointerDown={editGrid}
						onDoubleClick={addAtPointer}
					>
						{expanded &&
							Array.from({ length: range.maxPitch - range.minPitch + 1 }, (_, index) => {
								const midi = range.maxPitch - index;
								return (
									<i
										key={midi}
										className={`mm-piano-grid-row ${isPianoBlackKey(midi) ? 'is-black' : ''} ${midi % 12 === 0 ? 'is-octave' : ''} ${activePitch === midi ? 'is-active' : ''}`}
										style={{ top: index * pitchRowHeight, height: pitchRowHeight }}
									/>
								);
							})}
						{visibleNotes.map((note) => (
							<button
								type="button"
								key={note.id}
								data-note-id={note.id}
								className={`mm-midi-note ${selection.has(note.id) ? 'is-selected' : ''} ${selectionCount > 1 && selectedNoteId === note.id ? 'is-primary' : ''} ${linkedNotes.has(note.id) ? 'is-linked' : ''} ${dropNoteId === note.id ? 'is-drop-target' : ''}`}
								style={
									{
										'left': note.time * zoom,
										'width': Math.max(8, note.duration * zoom),
										'top': expanded ? pianoPitchTop(note.midi, range, pitchRowHeight) + 1 : 8,
										'--mm-note-color': track.color
									} as React.CSSProperties
								}
								aria-label={`${noteName(note.midi)} at ${formatTime(note.time)}, ${linkedNotes.has(note.id) ? 'linked object' : 'unlinked'}`}
								aria-pressed={selection.has(note.id)}
								title={`${noteName(note.midi)} · ${formatTime(note.time)} · ${note.duration.toFixed(2)}s · velocity ${Math.round(note.velocity * 127)} · arrows: move / transpose · Shift+↑↓: octave`}
								onPointerDown={(event) => dragNote(event, note)}
								onBlur={() => setPreviewPitch(null)}
								onClick={(event) => {
									if (event.detail === 0) {
										if (linkingObjectId != null) onLinkObject?.(linkingObjectId, note.id);
										else {
											selectNote(note, event.shiftKey);
											audition(note.midi);
										}
									}
								}}
								onKeyDown={(event) => {
									if (selectedNoteIds != null) return;
									if (event.metaKey || event.ctrlKey || event.altKey) return;
									if (
										(event.key === 'Delete' || event.key === 'Backspace') &&
										onDeleteNote != null
									) {
										event.preventDefault();
										event.stopPropagation();
										onDeleteNote(note.id);
										return;
									}
									if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key))
										return;
									event.preventDefault();
									event.stopPropagation();
									if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
										const midi = Math.max(
											0,
											Math.min(
												127,
												note.midi + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 12 : 1)
											)
										);
										onUpdateNote(note.id, { midi });
										audition(midi);
									} else {
										const step = timelineSnapStep(snap) || 1 / snap.fps;
										onUpdateNote(
											note.id,
											editTimelineNote(
												note,
												(event.key === 'ArrowRight' ? 1 : -1) * step,
												null,
												project.duration,
												snap
											)
										);
									}
								}}
								onDragOver={(event) => {
									if (
										(draggingObjectId == null &&
											!event.dataTransfer.types.includes(OBJECT_DRAG_TYPE)) ||
										onLinkObject == null
									)
										return;
									event.preventDefault();
									event.dataTransfer.dropEffect = 'link';
									setDropNoteId(note.id);
								}}
								onDragLeave={() => setDropNoteId(null)}
								onDrop={(event) => {
									const id = event.dataTransfer.getData(OBJECT_DRAG_TYPE) || draggingObjectId;
									const object = project.objects.find((item) => item.id === id);
									if (object == null || object.locked || onLinkObject == null) return;
									event.preventDefault();
									event.stopPropagation();
									setDropNoteId(null);
									onLinkObject(object.id, note.id);
								}}
							>
								<i data-edge="start" className="mm-note-trim mm-trim-start" />
								<span>{noteName(note.midi)}</span>
								{linkedNotes.has(note.id) && <Link2 size={8} />}
								<i data-edge="end" className="mm-note-trim mm-trim-end" />
							</button>
						))}
						<div ref={draftRef} className="mm-note-draft" hidden />
						<div ref={marqueeRef} className="mm-note-marquee" hidden aria-hidden="true" />
					</div>
				</div>
				{expanded && (
					<div className="mm-velocity-lane" aria-label={`Velocity for ${track.name}`}>
						<span className="mm-velocity-guide">127</span>
						{visibleNotes.map((note) => (
							<button
								type="button"
								role="slider"
								aria-label={`Velocity ${noteName(note.midi)} at ${formatTime(note.time)}`}
								aria-valuemin={1}
								aria-valuemax={127}
								aria-valuenow={Math.round(note.velocity * 127)}
								key={note.id}
								className={`mm-velocity-bar ${selection.has(note.id) ? 'is-selected' : ''}`}
								style={{
									left: note.time * zoom,
									height: Math.max(2, note.velocity * (VELOCITY_HEIGHT - 18))
								}}
								title={`${noteName(note.midi)} velocity ${Math.round(note.velocity * 127)} · drag up/down`}
								onPointerDown={(event) => dragVelocity(event, note)}
								onFocus={() => selectNote(note, false, true)}
								onClick={() => selectNote(note, false, true)}
								onKeyDown={(event) => {
									if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
									event.preventDefault();
									event.stopPropagation();
									selectNote(note, false, true);
									onUpdateNote(note.id, {
										velocity: editPianoVelocity(
											note.velocity,
											((event.key === 'ArrowUp' ? -1 : 1) *
												(event.shiftKey ? 10 : 1) *
												(VELOCITY_HEIGHT - 18)) /
												127,
											VELOCITY_HEIGHT - 18
										)
									});
								}}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	);
};

export interface TMidiTrackLaneProps {
	track: TTrack & { notes: TNote[] };
	project: TProject;
	range: TPianoPitchRange;
	expanded: boolean;
	focused: boolean;
	selectedNoteId: string | null;
	selectedNoteIds?: ReadonlySet<string>;
	onSelectionChange?(ids: string[]): void;
	linkedNotes: Set<string>;
	zoom: number;
	snap: TTimelineSnap;
	visibleStart: number;
	visibleEnd: number;
	currentTime: number;
	playing?: boolean;
	timeRef?: React.RefObject<number>;
	drawMode: 'select' | 'draw';
	drawLength: number;
	linkingObjectId: string | null;
	draggingObjectId: string | null;
	onExpand(): void;
	onFocus(): void;
	onSelectTrack?(trackId: string): void;
	onSelectNote(id: string): void;
	onUpdateNote(id: string, patch: Partial<TNote>): void;
	onUpdateNotes?(updates: Array<{ id: string; patch: Partial<TNote> }>): void;
	onAddNotes?(notes: TNote[]): boolean;
	onAddNote(
		trackId: string,
		time: number,
		midi: number,
		duration?: number,
		velocity?: number
	): void;
	onDeleteNote?(id: string): void;
	onMute(): void;
	onSolo?(): void;
	soloActive?: boolean;
	onAuditionNote?(midi: number, trackId: string): void;
	onLinkObject?(objectId: string, noteId: string): void;
	onGestureChange?(cancel: (() => void) | null): void;
}

export const PIANO_ROW_HEIGHT = 14;
const TRACK_HEADER_HEIGHT = 33;
const VELOCITY_HEIGHT = 68;
const OBJECT_DRAG_TYPE = 'application/x-midimarble-object';
