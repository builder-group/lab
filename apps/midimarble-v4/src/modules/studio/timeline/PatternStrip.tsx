import { useFeatureState } from 'feature-react/state';
import React from 'react';
import { groupSelection, rangeSelection, plainGroupSpan } from '@/modules/track';
import { isPatternGroup, type TPatternGroup, type TLane, formatTime, parseGroupKey, parseHitKey, parseRangeKey } from '@/modules/project';
import type { StudioCx } from '../StudioCx';
import { PATTERN_STRIP_HEIGHT } from './timeline-layout';

/** Blocks reach this far past their first and last hit, so a hit never sits on a block's edge */
const BLOCK_PAD = 5;
const MIN_DRAG_PX = 3;

/**
 * The slim strip above a marble's hits (Patterns prototype): nearly invisible while empty, "Drag to choose a Pattern" on
 * hover. Dragging out a range selects its notes, the same as dragging over them below, or the silence itself. A block is
 * a Group: a click selects it; a Pattern's edges resize it, which fits it again.
 */
/** Pixels a block needs to show a short name whole */
const MIN_NAMED_BLOCK = 44;

export const PatternStrip: React.FC<TPatternStripProps> = (props) => {
	const { cx, lane, zoom, timeAt } = props;
	const history = useFeatureState(cx.$history);
	const selection = useFeatureState(cx.$selection);
	const project = history?.present;
	const [range, setRange] = React.useState<{ from: number; to: number } | null>(null);
	const [hoverX, setHoverX] = React.useState<number | null>(null);
	const [resize, setResize] = React.useState<{ groupId: string; edge: 'from' | 'to'; time: number } | null>(null);
	const stripRef = React.useRef<HTMLDivElement>(null);
	if (project == null) return null;

	const groups = (project.groups ?? []).filter((group) => group.laneId === lane.id);
	const selectedGroupIds = new Set(selection.flatMap((key) => parseGroupKey(key) ?? []));
	const selectedRange = selectedSpan(lane, selection);

	function onPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
		if (event.button !== 0) return;
		event.stopPropagation();
		event.currentTarget.setPointerCapture(event.pointerId);
		const time = timeAt(event.clientX);
		setRange({ from: time, to: time });
	}

	function onPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
		const left = stripRef.current?.getBoundingClientRect().left ?? 0;
		setHoverX(event.clientX - left);
		if (range != null) setRange({ ...range, to: timeAt(event.clientX) });
	}

	function onPointerUp(): void {
		if (range == null || project == null) return;
		const from = Math.max(0, Math.min(range.from, range.to));
		const to = Math.max(range.from, range.to);
		setRange(null);
		const selected = (to - from) * zoom < MIN_DRAG_PX ? [] : rangeSelection(project, lane.id, from, to);
		cx.$selection.set(selected);
		// The wall comes to the range, so its ghost and its pieces are in view from the start
		if (selected.length > 0) cx.$reveal.set({ ids: selected, isZoomKept: true });
	}

	function endResize(group: TPatternGroup): void {
		const edit = resize;
		setResize(null);
		const trackCx = cx.$trackCx.get();
		if (edit == null || trackCx == null) return;
		const from = edit.edge === 'from' ? Math.min(edit.time, group.to) : group.from;
		const to = edit.edge === 'to' ? Math.max(edit.time, group.from) : group.to;
		if (Math.abs(from - group.from) < 1e-4 && Math.abs(to - group.to) < 1e-4) return;
		void trackCx.patterns.apply({ laneId: lane.id, from, to, group }, group.kind);
	}

	const isHinting = hoverX != null && range == null && selectedRange == null;
	const shownRange = range ?? selectedRange;

	return (
		<div
			ref={stripRef}
			className="mm-pattern-strip"
			style={{ height: PATTERN_STRIP_HEIGHT }}
			data-testid="pattern-strip"
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={() => setRange(null)}
			onPointerLeave={() => setHoverX(null)}
			onDoubleClick={(event) => event.stopPropagation()}
			onContextMenu={(event) => event.stopPropagation()}
		>
			{isHinting ? (
				<span className="mm-pattern-hint" style={{ left: hoverX + 10 }}>
					Drag to choose a Pattern
				</span>
			) : null}
			{shownRange != null ? <span className="mm-pattern-range" style={{ left: Math.min(shownRange.from, shownRange.to) * zoom, width: Math.max(1, Math.abs(shownRange.to - shownRange.from) * zoom) }} /> : null}
			{groups.map((group) => {
				const pattern = isPatternGroup(group) ? group : null;
				const span = pattern ?? (isPatternGroup(group) ? null : plainGroupSpan(project, lane, group));
				if (span == null) return null;
				const isResizing = resize?.groupId === group.id;
				const from = isResizing && resize.edge === 'from' ? Math.min(resize.time, span.to) : span.from;
				const to = isResizing && resize.edge === 'to' ? Math.max(resize.time, span.from) : span.to;
				// A rail's block stops short of the notes around its silence, whose blocks reach past them
				const pad = pattern?.kind === 'longRail' ? -BLOCK_PAD : BLOCK_PAD;
				return (
					<div
						key={group.id}
						className="mm-pattern-block"
						data-selected={selectedGroupIds.has(group.id)}
						data-problem={(pattern?.problems?.length ?? 0) > 0}
						role="button"
						tabIndex={-1}
						aria-label={`${group.name}, ${formatTime(span.from)} to ${formatTime(span.to)}`}
						title={`${group.name} · ${formatTime(span.from)} to ${formatTime(span.to)}`}
						style={{ left: from * zoom - pad, width: Math.max(10, (to - from) * zoom + 2 * pad), ['--lane' as string]: lane.color }}
						onPointerDown={(event) => event.stopPropagation()}
						onPointerEnter={() => setHoverX(null)}
						onPointerMove={(event) => event.stopPropagation()}
						onPointerUp={(event) => event.stopPropagation()}
						onClick={() => cx.$selection.set(groupSelection(group))}
					>
						{/* A block too short for its name shows none, not "Zig…"; the tooltip has it */}
						{(to - from) * zoom + 2 * pad >= MIN_NAMED_BLOCK ? <span className="mm-pattern-block-name">{group.name}</span> : null}
						{/* A Long Rail always fills its silence, and a plain Group has no Pattern to fit, so only a Pattern on notes has edges to drag */}
						{pattern != null && pattern.kind !== 'longRail'
							? (['from', 'to'] as const).map((edge) => (
									<span
										key={edge}
										className="mm-pattern-edge"
										data-edge={edge}
										onClick={(event) => event.stopPropagation()}
										onPointerDown={(event) => {
											if (event.button !== 0) return;
											event.stopPropagation();
											event.currentTarget.setPointerCapture(event.pointerId);
											setResize({ groupId: group.id, edge, time: edge === 'from' ? pattern.from : pattern.to });
										}}
										onPointerMove={(event) => {
											if (resize?.groupId === group.id) setResize({ ...resize, time: timeAt(event.clientX) });
										}}
										onPointerUp={(event) => {
											event.stopPropagation();
											endResize(pattern);
										}}
									/>
								))
							: null}
					</div>
				);
			})}
		</div>
	);
};

interface TPatternStripProps {
	cx: StudioCx;
	lane: TLane;
	zoom: number;
	timeAt: (clientX: number) => number;
}

/** What is selected on this row as a span of time: the dragged silence, or from the first selected hit to the last */
function selectedSpan(lane: TLane, selection: readonly string[]): { from: number; to: number } | null {
	const range = selection.flatMap((key) => parseRangeKey(key) ?? []).find((item) => item.laneId === lane.id);
	if (range != null) return range;
	const times = selection.flatMap((key) => {
		const parsed = parseHitKey(key);
		if (parsed?.laneId !== lane.id) return [];
		return lane.hits.find((hit) => hit.id === parsed.hitId)?.time ?? [];
	});
	return times.length > 1 ? { from: Math.min(...times), to: Math.max(...times) } : null;
}
