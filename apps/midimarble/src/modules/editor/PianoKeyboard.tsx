import React from 'react';
import { noteName, type TNote } from '../project';
import { isPianoBlackKey, type TPianoPitchRange } from './piano-editing';
import { getPlayingPitches } from './piano-playback';

export const PianoKeyboard: React.FC<TPianoKeyboardProps> = (props) => {
	const {
		range,
		rowHeight,
		activePitch,
		pressedPitch,
		notes,
		playing,
		audible,
		time,
		timeRef,
		onAudition,
		onRelease,
		onAddAtPlayhead
	} = props;
	const [playingPitches, setPlayingPitches] = React.useState<Set<number>>(() => new Set());
	const signatureRef = React.useRef('');
	const clockRef = React.useRef(time);
	React.useEffect(() => {
		clockRef.current = time;
	}, [time]);
	React.useEffect(() => {
		let frame = 0;
		function update() {
			const pitches =
				playing && audible
					? getPlayingPitches(notes, timeRef?.current ?? clockRef.current)
					: new Set<number>();
			const signature = [...pitches].sort((a, b) => a - b).join(',');
			if (signature !== signatureRef.current) {
				signatureRef.current = signature;
				setPlayingPitches(pitches);
			}
			if (playing && audible) frame = requestAnimationFrame(update);
		}
		update();
		return () => cancelAnimationFrame(frame);
	}, [notes, playing, audible, timeRef]);
	const focusPitch = Math.max(range.minPitch, Math.min(range.maxPitch, activePitch ?? 60));
	return (
		<div className="mm-piano-keyboard" role="group" aria-label="Piano keyboard">
			{Array.from({ length: range.maxPitch - range.minPitch + 1 }, (_, index) => {
				const midi = range.maxPitch - index;
				const black = isPianoBlackKey(midi);
				const pressed = pressedPitch === midi || playingPitches.has(midi);
				return (
					<button
						type="button"
						key={midi}
						className={`mm-piano-key ${black ? 'is-black' : 'is-white'} ${pressed ? 'is-active' : ''} ${activePitch === midi ? 'is-selected' : ''}`}
						style={{ height: rowHeight }}
						data-piano-midi={midi}
						aria-label={`Audition ${noteName(midi)}`}
						aria-pressed={pressed}
						tabIndex={midi === focusPitch ? 0 : -1}
						title={`${noteName(midi)} · click to hear · double-click to add at playhead`}
						onPointerDown={(event) => {
							if (event.button !== 0) return;
							event.stopPropagation();
							event.currentTarget.setPointerCapture(event.pointerId);
							onAudition(midi);
						}}
						onPointerUp={onRelease}
						onPointerCancel={onRelease}
						onLostPointerCapture={onRelease}
						onBlur={onRelease}
						onKeyUp={(event) => {
							if (event.key === 'Enter' || event.key === ' ' || event.key.startsWith('Arrow')) {
								event.stopPropagation();
								onRelease();
							}
						}}
						onClick={(event) => {
							if (event.detail === 0) onAudition(midi);
						}}
						onDoubleClick={(event) => {
							event.stopPropagation();
							onAddAtPlayhead(midi);
						}}
						onKeyDown={(event) => {
							if (event.key === 'Enter' || event.key === ' ') {
								event.preventDefault();
								event.stopPropagation();
								if (!event.repeat) onAudition(midi);
								return;
							}
							if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
							if (event.metaKey || event.ctrlKey || event.altKey) return;
							event.stopPropagation();
							event.preventDefault();
							const nextMidi = Math.max(
								range.minPitch,
								Math.min(
									range.maxPitch,
									midi + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 12 : 1)
								)
							);
							const keys =
								event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
									'[data-piano-midi]'
								);
							const next = Array.from(keys ?? []).find(
								(key) => Number(key.dataset['pianoMidi']) === nextMidi
							);
							if (next) {
								next.focus();
								onAudition(nextMidi);
							}
						}}
					>
						<span>{midi % 12 === 0 || pressed || activePitch === midi ? noteName(midi) : ''}</span>
					</button>
				);
			})}
		</div>
	);
};
interface TPianoKeyboardProps {
	range: TPianoPitchRange;
	rowHeight: number;
	activePitch: number | null;
	pressedPitch: number | null;
	notes: readonly TNote[];
	playing: boolean;
	audible: boolean;
	time: number;
	timeRef?: React.RefObject<number>;
	onAudition(midi: number): void;
	onRelease(): void;
	onAddAtPlayhead(midi: number): void;
}
