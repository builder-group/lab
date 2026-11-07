import React from 'react';
import { openContextMenu } from '@/components';
import { BACKING_ID, type THit, type TProject, type TSong, formatTime, noteName, toHitKey } from '@/modules/project';
import { focusedMarble, type StudioCx } from '../StudioCx';
import { auditionNote, isNoteSelection, playedByMenu } from '@/modules/track';
import { BACKING_COLOR } from '@/modules/music';
import { isPitched } from '@/modules/building';
import type { TDrag, TDragStart } from './MarbleTrack';
import { addNoteCommands, clampPitch, isBlackKey, pitchToRow, resizedNoteLength, rowCount, snapNoteTime, type TPitchRange } from './piano-roll';
import { useSoundingKeys } from './sounding-keys';
import { KEYBOARD_WIDTH, NOTE_ROW_HEIGHT } from './timeline-layout';
import { $noteLength, $rollHasFocus } from './timeline-state';

/**
 * The expanded Song track: every note of the song in one piano roll, the hits tied to it colored by the marble that
 * plays them and gray for its Backing, the one place notes show by pitch. Click selects a note, Shift-click adds it, dragging a note
 * moves it in time and in pitch, dragging its right edge changes its length and dragging on empty space selects a box
 * of notes. A double-click adds a note for the marble in focus; number keys or the context menu hand the selection to a
 * marble or to Backing.
 */
export const SongRoll: React.FC<TSongRollProps> = (props) => {
	const { cx, project, song, range, zoom, width, selection, drag, onDragStart } = props;
	const ref = React.useRef<HTMLDivElement>(null);
	const [box, setBox] = React.useState<TBox | null>(null);
	const [resize, setResize] = React.useState<TResize | null>(null);
	const notes = React.useMemo(() => songNotes(project, song), [project, song]);
	const pitches = Array.from({ length: rowCount(range) }, (_, index) => range.high - index);
	const selected = React.useMemo(() => new Set(selection), [selection]);

	// ⌫ acts on the pane clicked last, as in Logic
	React.useEffect(() => {
		function onPointerDown(event: PointerEvent): void {
			$rollHasFocus.set(ref.current?.contains(event.target as Node) === true);
		}
		window.addEventListener('pointerdown', onPointerDown, true);
		return () => {
			window.removeEventListener('pointerdown', onPointerDown, true);
			$rollHasFocus.set(false);
		};
	}, []);

	function point(event: React.PointerEvent): { x: number; y: number } {
		const rect = ref.current?.getBoundingClientRect();
		return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
	}

	function selectNote(note: TSongNote, event: React.PointerEvent): void {
		if (event.button !== 0) return;
		event.stopPropagation();
		if (event.shiftKey) {
			cx.$selection.set(selected.has(note.key) ? selection.filter((key) => key !== note.key) : [...selection, note.key]);
			return;
		}
		auditionNote(cx, note.ownerId, note.hit.pitch, song.id);
		onDragStart(note.key, event, true, range);
	}

	function startResize(note: TSongNote, event: React.PointerEvent): void {
		if (event.button !== 0) return;
		event.stopPropagation();
		ref.current?.setPointerCapture(event.pointerId);
		cx.$selection.set([note.key]);
		const start = note.hit.duration ?? DEFAULT_DRAWN_LENGTH;
		setResize({ note, startX: event.clientX, start, length: start });
	}

	function addNote(event: React.MouseEvent<HTMLDivElement>): void {
		if ((event.target as HTMLElement).closest('button') != null) return;
		const rect = event.currentTarget.getBoundingClientRect();
		const pitch = clampPitch(range.high - Math.floor((event.clientY - rect.top) / NOTE_ROW_HEIGHT), range);
		const at = (event.clientX - rect.left) / zoom;
		const time = event.altKey ? at : snapNoteTime(at, song.tempo?.bpm, zoom);
		const ownerId = focusedMarble(project, selection)?.id ?? BACKING_ID;
		const { hit, commands } = addNoteCommands(ownerId, song.id, { time, pitch, duration: $noteLength.get() });
		if (!cx.execute(commands)) return;
		cx.$selection.set([toHitKey(ownerId, hit.id)]);
		auditionNote(cx, ownerId, pitch, song.id);
	}

	function openNoteMenu(note: TSongNote, event: React.MouseEvent): void {
		event.stopPropagation();
		const keys = selected.has(note.key) ? selection : [note.key];
		if (!selected.has(note.key)) cx.$selection.set(keys);
		openContextMenu(event, [
			{ section: `${noteName(note.hit.pitch)} · ${formatTime(note.hit.time)}` },
			{ label: 'Go to Note', onSelect: () => cx.$playhead.set(note.hit.time) },
			'separator',
			...playedByMenu(cx, keys)
		]);
	}

	const handlers = {
		onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
			if (event.button !== 0 || (event.target as HTMLElement).closest('button') != null) return;
			event.currentTarget.setPointerCapture(event.pointerId);
			const start = point(event);
			setBox({ from: start, to: start });
		},
		onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
			if (resize != null) setResize({ ...resize, length: resizedNoteLength(resize.note.ownerId, resize.start, event.clientX - resize.startX, zoom) });
			if (box != null) setBox({ ...box, to: point(event) });
		},
		onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
			if (resize != null) {
				setResize(null);
				if (resize.length === resize.start) return;
				$noteLength.set(resize.length);
				cx.execute([{ type: 'upsertHits', marbleId: resize.note.ownerId, hits: [{ ...resize.note.hit, duration: resize.length }] }]);
				return;
			}
			if (box == null) return;
			setBox(null);
			const rect = boxRect(box);
			if (rect.width < 3 && rect.height < 3) {
				if (!event.shiftKey) cx.$selection.set([]);
				return;
			}
			const keys = notes
				.filter((note) => {
					const x = note.hit.time * zoom;
					const y = pitchToRow(note.hit.pitch, range) * NOTE_ROW_HEIGHT + NOTE_ROW_HEIGHT / 2;
					return x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height;
				})
				.map((note) => note.key);
			cx.$selection.set(event.shiftKey ? [...new Set([...selection, ...keys])] : keys);
		}
	};

	return (
		<div
			ref={ref}
			className="mm-song-roll relative flex-1 border-b border-[var(--separator)]"
			style={{ minWidth: width, height: rowCount(range) * NOTE_ROW_HEIGHT }}
			aria-label="Song notes"
			{...handlers}
			onDoubleClick={addNote}
			onContextMenu={(event) => {
				if (!isNoteSelection(selection)) return;
				openContextMenu(event, playedByMenu(cx, selection));
			}}
		>
			{pitches.map((pitch) => (
				<div
					key={pitch}
					className="mm-piano-row"
					data-black={isBlackKey(pitch)}
					data-c={pitch % 12 === 0}
					style={{ top: pitchToRow(pitch, range) * NOTE_ROW_HEIGHT, height: NOTE_ROW_HEIGHT }}
				/>
			))}
			{notes.map((note) => {
				const isSelected = selected.has(note.key);
				const isDragged = drag?.keys.includes(note.key) === true;
				const time = Math.max(0, note.hit.time + (isDragged ? drag.delta : 0));
				const pitch = isDragged && drag.isPitched ? clampPitch(note.hit.pitch + drag.pitchDelta, range) : note.hit.pitch;
				const length = resize?.note.key === note.key ? resize.length : (note.hit.duration ?? DEFAULT_DRAWN_LENGTH);
				return (
					<button
						key={note.key}
						className="mm-song-note"
						data-selected={isSelected}
						data-backing={note.ownerId === BACKING_ID}
						aria-label={`${noteName(note.hit.pitch)} at ${formatTime(note.hit.time)}, ${note.ownerName}`}
						aria-pressed={isSelected}
						title={`${noteName(note.hit.pitch)} · ${formatTime(note.hit.time)} · ${note.ownerName}`}
						style={{
							left: time * zoom,
							width: Math.max(4, Math.min(length, 4) * zoom),
							top: pitchToRow(pitch, range) * NOTE_ROW_HEIGHT + 1,
							height: NOTE_ROW_HEIGHT - 2,
							['--row-color' as string]: note.color
						}}
						onPointerDown={(event) => selectNote(note, event)}
						onContextMenu={(event) => openNoteMenu(note, event)}
						type="button"
					>
						<span className="mm-song-note-end" onPointerDown={(event) => startResize(note, event)} />
					</button>
				);
			})}
			{box != null ? (
				<span className="pointer-events-none absolute z-10 rounded-[3px] border border-[var(--accent-strong)] bg-[var(--selection)]" style={boxRect(box)} />
			) : null}
		</div>
	);
};

// How long a note without a length of its own is drawn
const DEFAULT_DRAWN_LENGTH = 0.15;

interface TSongRollProps {
	cx: StudioCx;
	project: TProject;
	song: TSong;
	range: TPitchRange;
	zoom: number;
	width: number;
	selection: string[];
	drag: TDrag | null;
	onDragStart: TDragStart;
}

/** A note's right edge being dragged */
interface TResize {
	note: TSongNote;
	startX: number;
	start: number;
	length: number;
}

interface TBox {
	from: { x: number; y: number };
	to: { x: number; y: number };
}

function boxRect(box: TBox): { left: number; top: number; width: number; height: number } {
	return {
		left: Math.min(box.from.x, box.to.x),
		top: Math.min(box.from.y, box.to.y),
		width: Math.abs(box.to.x - box.from.x),
		height: Math.abs(box.to.y - box.from.y)
	};
}

/** Every pitched note of the song with the track that holds it */
export function songNotes(project: TProject, song: TSong): TSongNote[] {
	const owners = [
		...project.marbles.map((marble) => ({ id: marble.id, name: marble.name, color: marble.labelColor, hits: marble.hits.filter((hit) => hit.songId === song.id) })),
		{ id: BACKING_ID, name: 'Backing', color: BACKING_COLOR, hits: song.backing }
	];
	return owners.flatMap((owner) =>
		owner.hits.filter(isPitched).map((hit) => ({ key: toHitKey(owner.id, hit.id), ownerId: owner.id, ownerName: owner.name, color: owner.color, hit }))
	);
}

export interface TSongNote {
	key: string;
	ownerId: string;
	ownerName: string;
	color: string;
	hit: THit & { pitch: number };
}

/**
 * Vertical keyboard of the Song's piano roll, one key per semitone row, C keys labeled; a click plays the key.
 * `offset` scrolls it with a roll that is taller than its track. Keys light while their notes sound (`useSoundingKeys`).
 */
export const Keyboard: React.FC<TKeyboardProps> = (props) => {
	const { cx, project, song, name, range, offset = 0, onPlay } = props;
	const ref = React.useRef<HTMLDivElement>(null);
	useSoundingKeys(cx, project, song.id, ref);
	const pitches = Array.from({ length: rowCount(range) }, (_, index) => range.high - index);
	return (
		<div className="mm-keyboard relative shrink-0 overflow-hidden" style={{ width: KEYBOARD_WIDTH }} role="group" aria-label={`${name} keyboard`}>
			<div ref={ref} className="absolute inset-x-0 top-0" style={{ transform: offset === 0 ? undefined : `translateY(${-offset}px)` }}>
				{pitches.map((pitch) => {
					const isBlack = isBlackKey(pitch);
					const isC = pitch % 12 === 0;
					return (
						<button
							key={pitch}
							className="mm-key"
							data-pitch={pitch}
							data-black={isBlack}
							data-c={isC}
							style={{ top: pitchToRow(pitch, range) * NOTE_ROW_HEIGHT, height: NOTE_ROW_HEIGHT }}
							onPointerDown={(event) => {
								if (event.button !== 0) return;
								onPlay(pitch);
							}}
							title={noteName(pitch)}
							aria-label={`Play ${noteName(pitch)}`}
							type="button"
						>
							{isC ? <span className="mm-key-label">{noteName(pitch)}</span> : null}
						</button>
					);
				})}
			</div>
		</div>
	);
};

interface TKeyboardProps {
	cx: StudioCx;
	project: TProject;
	song: TSong;
	name: string;
	range: TPitchRange;
	offset?: number;
	onPlay: (pitch: number) => void;
}
