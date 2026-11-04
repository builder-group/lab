import React from 'react';
import { openContextMenu } from '@/components';
import { BACKING_ID, type THit, type TProject } from '@/modules/project';
import { formatTime, noteName } from '../format';
import { toHitKey } from '../selection';
import type { StudioCx } from '../StudioCx';
import { auditionNote, BACKING_COLOR, isNoteSelection, playWithMenu } from './hand-notes';
import { isPitched } from './hit-status';
import type { TDrag, TDragStart } from './LaneTrack';
import { clampPitch, isBlackKey, pitchToRow, rowCount, type TPitchRange } from './piano-roll';
import { KEYBOARD_WIDTH, NOTE_ROW_HEIGHT } from './timeline-layout';

/**
 * The expanded Song track: every note of the song in one piano roll, coloured by the marble that plays it and
 * grey for Backing, the one place notes show by pitch. Click selects a note, Shift-click adds it, dragging a note
 * moves it in time and in pitch and dragging on empty space selects a box of notes; number keys or the context menu
 * hand the selection to a marble or to Backing.
 */
export const SongRoll: React.FC<TSongRollProps> = (props) => {
	const { cx, project, range, zoom, width, selection, drag, onDragStart } = props;
	const ref = React.useRef<HTMLDivElement>(null);
	const [box, setBox] = React.useState<TBox | null>(null);
	const notes = React.useMemo(() => songNotes(project), [project]);
	const pitches = Array.from({ length: rowCount(range) }, (_, index) => range.high - index);
	const selected = React.useMemo(() => new Set(selection), [selection]);

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
		auditionNote(cx, note.ownerId, note.hit.pitch);
		onDragStart(note.key, event, true);
	}

	function openNoteMenu(note: TSongNote, event: React.MouseEvent): void {
		event.stopPropagation();
		const keys = selected.has(note.key) ? selection : [note.key];
		if (!selected.has(note.key)) cx.$selection.set(keys);
		openContextMenu(event, [
			{ section: `${noteName(note.hit.pitch)} · ${formatTime(note.hit.time)}` },
			{ label: 'Go to Note', onSelect: () => cx.$playhead.set(note.hit.time) },
			'separator',
			...playWithMenu(cx, keys)
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
			if (box != null) setBox({ ...box, to: point(event) });
		},
		onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
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
			onContextMenu={(event) => {
				if (!isNoteSelection(selection)) return;
				openContextMenu(event, playWithMenu(cx, selection));
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
							width: Math.max(4, Math.min(note.hit.duration ?? 0.15, 4) * zoom),
							top: pitchToRow(pitch, range) * NOTE_ROW_HEIGHT + 1,
							height: NOTE_ROW_HEIGHT - 2,
							['--lane' as string]: note.color
						}}
						onPointerDown={(event) => selectNote(note, event)}
						onContextMenu={(event) => openNoteMenu(note, event)}
						type="button"
					/>
				);
			})}
			{box != null ? (
				<span className="pointer-events-none absolute z-10 rounded-[3px] border border-[var(--accent-strong)] bg-[var(--selection)]" style={boxRect(box)} />
			) : null}
		</div>
	);
};

interface TSongRollProps {
	cx: StudioCx;
	project: TProject;
	range: TPitchRange;
	zoom: number;
	width: number;
	selection: string[];
	drag: TDrag | null;
	onDragStart: TDragStart;
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
export function songNotes(project: TProject): TSongNote[] {
	const owners = [
		...project.music.lanes.map((lane) => ({ id: lane.id, name: lane.name, color: lane.color, hits: lane.hits })),
		{ id: BACKING_ID, name: 'Backing', color: BACKING_COLOR, hits: project.music.backing }
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
 * Vertical keyboard of the Song's piano roll, one key per semitone row, C keys labelled; a click plays the key.
 * `offset` scrolls it with a roll that is taller than its track.
 */
export const Keyboard: React.FC<TKeyboardProps> = (props) => {
	const { name, range, offset = 0, onPlay } = props;
	const pitches = Array.from({ length: rowCount(range) }, (_, index) => range.high - index);
	return (
		<div className="mm-keyboard relative shrink-0 overflow-hidden" style={{ width: KEYBOARD_WIDTH }} role="group" aria-label={`${name} keyboard`}>
			<div className="absolute inset-x-0 top-0" style={{ transform: offset === 0 ? undefined : `translateY(${-offset}px)` }}>
				{pitches.map((pitch) => {
					const isBlack = isBlackKey(pitch);
					const isC = pitch % 12 === 0;
					return (
						<button
							key={pitch}
							className="mm-key"
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
	name: string;
	range: TPitchRange;
	offset?: number;
	onPlay: (pitch: number) => void;
}
