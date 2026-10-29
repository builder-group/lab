import { Diamond, Plus } from 'lucide-react';
import React from 'react';
import { formatTime } from '../project';
import { pointerGesture } from './pointer-gesture';
import { snapTimelineTime, type TTimelineSnap } from './timeline-editing';

export const KeyframeLane: React.FC<TKeyframeLaneProps> = (props) => {
	const {
		kind,
		label,
		icon,
		keyframes,
		selectedId,
		zoom,
		duration,
		snap,
		hidden,
		disabled,
		onSelect,
		onSeek,
		onScrub,
		onMove,
		onDelete,
		onAdd,
		onGestureChange
	} = props;
	const rowRef = React.useRef<HTMLDivElement>(null);
	const gestureRef = React.useRef<(() => void) | null>(null);

	const drag = React.useCallback(
		(event: React.PointerEvent<HTMLButtonElement>, keyframe: TTimedKeyframe) => {
			if (event.button !== 0 || disabled) return;
			event.stopPropagation();
			event.preventDefault();
			event.currentTarget.focus({ preventScroll: true });
			onSelect?.(keyframe.id);
			onSeek(keyframe.time);
			if (onMove == null) return;
			const target = event.currentTarget;
			const originalLeft = target.style.left;
			let nextTime = keyframe.time;
			let moved = false;
			gestureRef.current?.();
			const cancel = pointerGesture(target, event.pointerId, {
				move: (next) => {
					if (!moved && Math.abs(next.clientX - event.clientX) < 3) return;
					moved = true;
					nextTime = Math.max(
						0,
						Math.min(
							duration,
							snapTimelineTime(
								keyframe.time + (next.clientX - event.clientX) / zoom,
								next.altKey ? { ...snap, mode: 'off' } : snap
							)
						)
					);
					target.style.left = `${nextTime * zoom}px`;
				},
				end: (cancelled) => {
					target.style.left = originalLeft;
					gestureRef.current = null;
					onGestureChange(null);
					if (!cancelled && moved && nextTime !== keyframe.time) {
						onMove(keyframe.id, nextTime);
						onSeek(nextTime);
					}
				}
			});
			gestureRef.current = cancel;
			onGestureChange(cancel);
		},
		[disabled, duration, onGestureChange, onMove, onSeek, onSelect, snap, zoom]
	);

	React.useEffect(() => () => gestureRef.current?.(), []);
	React.useEffect(() => {
		if (disabled) gestureRef.current?.();
	}, [disabled]);
	React.useEffect(() => {
		const row = rowRef.current;
		const scroll = row?.closest<HTMLElement>('.mm-timeline-scroll');
		if (selectedId == null || hidden || row == null || scroll == null) return;
		if (row.offsetTop + row.offsetHeight > scroll.scrollTop + scroll.clientHeight)
			scroll.scrollTop = row.offsetTop + row.offsetHeight - scroll.clientHeight;
		else if (row.offsetTop < scroll.scrollTop + 26)
			scroll.scrollTop = Math.max(0, row.offsetTop - 26);
	}, [hidden, selectedId]);

	return (
		<div className={`mm-timeline-row mm-keyframe-row mm-${kind}-row`} ref={rowRef} hidden={hidden}>
			<div className="mm-channel">
				<span className="mm-channel-indent" />
				{icon}
				<strong>{label}</strong>
				<span className="mm-channel-meta">{keyframes.length}</span>
				{onAdd != null && (
					<button
						type="button"
						className="mm-timeline-icon"
						aria-label={`Add ${kind} keyframe at playhead`}
						title={`Add ${kind} keyframe at playhead`}
						disabled={disabled}
						onClick={onAdd}
					>
						<Diamond size={12} />
						<Plus size={8} />
					</button>
				)}
			</div>
			<div
				className="mm-keyframe-lane"
				onPointerDown={onScrub}
				onDoubleClick={(event) => {
					if (!disabled && event.target === event.currentTarget) onAdd?.();
				}}
				title={`Drag to scrub. Double-click to add a ${kind} keyframe.`}
			>
				{keyframes.map((keyframe) => (
					<button
						type="button"
						key={keyframe.id}
						className={`mm-keyframe ${selectedId === keyframe.id ? 'is-selected' : ''}`}
						style={{ left: keyframe.time * zoom }}
						aria-label={`${label} keyframe at frame ${Math.round(keyframe.time * snap.fps)}`}
						aria-pressed={selectedId === keyframe.id}
						title={`${label} · ${formatTime(keyframe.time)} · drag to retime`}
						disabled={disabled}
						onPointerDown={(event) => drag(event, keyframe)}
						onKeyDown={(event) => {
							if ((event.key === 'Delete' || event.key === 'Backspace') && onDelete != null) {
								event.preventDefault();
								event.stopPropagation();
								onDelete(keyframe.id);
							}
						}}
						onClick={(event) => {
							if (event.detail === 0) {
								onSelect?.(keyframe.id);
								onSeek(keyframe.time);
							}
						}}
					>
						<Diamond size={11} />
					</button>
				))}
			</div>
		</div>
	);
};

interface TKeyframeLaneProps {
	kind: 'camera' | 'lighting';
	label: string;
	icon: React.ReactNode;
	keyframes: readonly TTimedKeyframe[];
	selectedId?: string | null;
	zoom: number;
	duration: number;
	snap: TTimelineSnap;
	hidden: boolean;
	disabled: boolean;
	onSeek(time: number): void;
	onScrub(event: React.PointerEvent<HTMLDivElement>): void;
	onSelect?(id: string): void;
	onMove?(id: string, time: number): void;
	onDelete?(id: string): void;
	onAdd?(): void;
	onGestureChange(cancel: (() => void) | null): void;
}

interface TTimedKeyframe {
	id: string;
	time: number;
}
