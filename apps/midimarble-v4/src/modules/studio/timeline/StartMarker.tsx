import { useFeatureState } from 'feature-react/state';
import React from 'react';
import { openContextMenu } from '@/components';
import { newlyBroken } from '@/modules/building';
import { formatTime, type TMarble } from '@/modules/project';
import type { THitResult } from '@/modules/simulation';
import { marbleMenu } from '../menus';
import { hitsBeforeStartWords, moveMarbleStart, withMarbleStart } from '../marble-start';
import type { StudioCx } from '../StudioCx';
import { TIME_DEAD_ZONE } from './timeline-layout';

/**
 * When the marble starts: the ring it has on the wall, here at its time. It drags like a Final Cut clip, with the run
 * following as a what-if on the wall and on the row, as one Undo step. Escape cancels.
 */
export const StartMarker: React.FC<TStartMarkerProps> = (props) => {
	const { cx, marble, zoom, top, shift, isSelected, length } = props;
	const [drag, setDrag] = React.useState<TStartDrag | null>(null);
	const time = Math.max(0, (drag?.time ?? marble.start.time) + shift);

	React.useEffect(() => {
		if (drag == null) return;
		function onKeyDown(event: KeyboardEvent): void {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			event.stopImmediatePropagation();
			setDrag(null);
			cx.simulation.endPreview();
		}
		window.addEventListener('keydown', onKeyDown, true);
		return () => window.removeEventListener('keydown', onKeyDown, true);
	}, [cx, drag]);

	return (
		<>
			<button
				aria-label={`Start of ${marble.name} at ${formatTime(time)}`}
				className="mm-start-marker"
				data-selected={isSelected}
				data-dragging={drag != null}
				style={{ left: time * zoom, top, ['--row-color' as string]: marble.labelColor }}
				title={`${marble.name} starts at ${formatTime(time)} · drag to move`}
				onPointerDown={(event) => {
					if (event.button !== 0) return;
					event.stopPropagation();
					event.currentTarget.setPointerCapture(event.pointerId);
					cx.$selection.set([marble.id]);
					setDrag({ originX: event.clientX, time: marble.start.time, base: cx.simulation.$result.get()?.hits ?? [], moved: false });
				}}
				onPointerMove={(event) => {
					if (drag == null) return;
					const delta = event.clientX - drag.originX;
					if (!drag.moved && Math.abs(delta) < TIME_DEAD_ZONE) return;
					const next = Math.min(length, Math.max(0, Math.round((marble.start.time + delta / zoom) * 100) / 100));
					setDrag({ ...drag, time: next, moved: true });
					const project = cx.project;
					if (project != null) cx.simulation.startPreview(withMarbleStart(project, marble.id, next));
				}}
				onPointerUp={() => {
					if (drag == null) return;
					setDrag(null);
					if (drag.moved) moveMarbleStart(cx, marble, drag.time);
					cx.simulation.endPreview();
				}}
				onPointerCancel={() => {
					setDrag(null);
					cx.simulation.endPreview();
				}}
				onContextMenu={(event) => {
					event.stopPropagation();
					cx.$selection.set([marble.id]);
					openContextMenu(event, marbleMenu(cx, marble));
				}}
				type="button"
			>
				<span />
			</button>
			{drag?.moved === true ? <StartChip cx={cx} marble={marble} time={drag.time} base={drag.base} left={time * zoom} top={top} /> : null}
		</>
	);
};

interface TStartMarkerProps {
	cx: StudioCx;
	marble: TMarble;
	zoom: number;
	top: number;
	// How far a song being dragged takes this marble along
	shift: number;
	isSelected: boolean;
	length: number;
}

interface TStartDrag {
	originX: number;
	time: number;
	// The run when the drag began, which the count of broken hits compares with
	base: THitResult[];
	moved: boolean;
}

/** Beside the dragged marker: the time, and what it does to the notes */
const StartChip: React.FC<{ cx: StudioCx; marble: TMarble; time: number; base: THitResult[]; left: number; top: number }> = (props) => {
	const { cx, marble, time, base, left, top } = props;
	const result = useFeatureState(cx.simulation.$result);
	const broken = result == null ? 0 : newlyBroken(base, result.hits).length;
	const past = hitsBeforeStartWords(marble, time);
	return (
		<span className="mm-start-chip" data-bad={past != null} style={{ left: left + 12, top }}>
			{formatTime(time)}
			{past != null ? ` · ${past}` : broken > 0 ? ` · Breaks ${broken} ${broken === 1 ? 'note' : 'notes'}` : ''}
		</span>
	);
};
