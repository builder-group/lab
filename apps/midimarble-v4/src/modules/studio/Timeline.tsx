import { useFeatureState } from 'feature-react/state';
import React from 'react';
import { findLaneConflicts, MIN_HIT_GAP } from '@/modules/music';
import { createId, type TLane, type TProject } from '@/modules/project';
import { formatTime } from './format';
import type { StudioCx } from './StudioCx';
import type { TSourceAnalysis } from './SourcesCx';
import { parseHitKey, toHitKey } from './selection';

const HEADER_WIDTH = 232;
const RULER_HEIGHT = 24;
const ROW_HEIGHT = 44;
const MIN_ZOOM = 20;
const MAX_ZOOM = 800;

/** Music lanes in a Logic-style track area: one row per marble, shared ruler and playhead */
export const Timeline: React.FC<TTimelineProps> = (props) => {
	const { cx } = props;
	const history = useFeatureState(cx.$history);
	const playhead = useFeatureState(cx.$playhead);
	const selection = useFeatureState(cx.$selection);
	const analysis = useFeatureState(cx.sources.$analysis);
	const scrollRef = React.useRef<HTMLDivElement>(null);
	const [zoom, setZoom] = React.useState(80);
	const [drag, setDrag] = React.useState<TDrag | null>(null);
	const project = history?.present;

	const audio = project?.music.sources.find((source) => source.kind === 'audio');
	const audioAnalysis = audio == null ? undefined : analysis[audio.id];
	const width = Math.max((project?.end ?? 1) * zoom + 80, 0);

	// MARK: - Actions

	const timeAt = React.useCallback(
		(clientX: number): number => {
			const element = scrollRef.current;
			if (element == null) return 0;
			const rect = element.getBoundingClientRect();
			return Math.max(0, (clientX - rect.left + element.scrollLeft) / zoom);
		},
		[zoom]
	);

	const snap = React.useCallback(
		(time: number, disabled: boolean): number => {
			if (disabled || audio == null || audioAnalysis == null) return time;
			let best = time;
			let bestDistance = 8 / zoom;
			for (const onset of audioAnalysis.onsets) {
				const distance = Math.abs(onset + audio.offset - time);
				if (distance < bestDistance) {
					best = onset + audio.offset;
					bestDistance = distance;
				}
			}
			return best;
		},
		[audio, audioAnalysis, zoom]
	);

	function addHit(lane: TLane, time: number): void {
		const hit = { id: createId('hit'), time: round(time), pitch: nearestPitch(lane, time) };
		if (cx.execute([{ type: 'upsertHits', laneId: lane.id, hits: [hit] }])) {
			cx.$selection.set([toHitKey(lane.id, hit.id)]);
			cx.audition(lane.id, hit.pitch);
		}
	}

	function commitMove(delta: number): void {
		if (project == null || delta === 0) return;
		const commands = project.music.lanes.flatMap((lane) => {
			const moved = lane.hits
				.filter((hit) => selection.includes(toHitKey(lane.id, hit.id)))
				.map((hit) => ({ ...hit, time: round(Math.max(0, hit.time + delta)) }));
			return moved.length ? [{ type: 'upsertHits' as const, laneId: lane.id, hits: moved }] : [];
		});
		cx.execute(commands);
	}

	// Zoom around the pointer with pinch or Command-scroll, like Logic
	React.useEffect(() => {
		const element = scrollRef.current;
		if (element == null) return;
		function onWheel(event: WheelEvent): void {
			if (!event.ctrlKey && !event.metaKey) return;
			event.preventDefault();
			if (element == null) return;
			const rect = element.getBoundingClientRect();
			const anchor = (event.clientX - rect.left + element.scrollLeft) / zoom;
			const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * Math.exp(-event.deltaY * 0.01)));
			setZoom(next);
			requestAnimationFrame(() => {
				element.scrollLeft = anchor * next - (event.clientX - rect.left);
			});
		}
		element.addEventListener('wheel', onWheel, { passive: false });
		return () => element.removeEventListener('wheel', onWheel);
	}, [zoom]);

	// Keep the playhead visible while playing
	React.useEffect(() => {
		const element = scrollRef.current;
		if (element == null || !cx.$playing.get()) return;
		const x = playhead * zoom;
		if (x > element.scrollLeft + element.clientWidth - 40) element.scrollLeft = x - 80;
		if (x < element.scrollLeft) element.scrollLeft = Math.max(0, x - 80);
	}, [cx, playhead, zoom]);

	if (project == null) return null;

	// MARK: - UI

	return (
		<section
			className="relative flex h-[200px] shrink-0 border-t border-[var(--separator)] bg-[var(--content)]"
			aria-label="Timeline"
		>
			<div
				className="shrink-0 border-r border-[var(--separator)] bg-[var(--chrome)]"
				style={{ width: HEADER_WIDTH, paddingTop: RULER_HEIGHT }}
			>
				{project.music.lanes.map((lane) => (
					<LaneHeader key={lane.id} cx={cx} lane={lane} project={project} />
				))}
			</div>
			<div ref={scrollRef} className="relative min-w-0 flex-1 overflow-x-auto overflow-y-auto">
				<div className="relative" style={{ width, minHeight: '100%' }}>
					<Ruler
						end={project.end}
						zoom={zoom}
						onSeek={(clientX) => {
							cx.$playhead.set(Math.min(project.end, timeAt(clientX)));
						}}
					/>
					{project.music.lanes.map((lane) => (
						<LaneRow
							key={lane.id}
							cx={cx}
							lane={lane}
							zoom={zoom}
							selection={selection}
							drag={drag}
							audioOffset={audio?.offset ?? 0}
							analysis={audioAnalysis}
							onAdd={(time, event) => addHit(lane, snap(time, event.altKey))}
							onDragStart={(hitKey, clientX) => {
								const keys = selection.includes(hitKey) ? selection : [hitKey];
								cx.$selection.set(keys);
								setDrag({ originX: clientX, delta: 0, keys });
							}}
							timeAt={timeAt}
						/>
					))}
					<div
						className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-[var(--bad)]"
						style={{ left: playhead * zoom }}
					/>
				</div>
			</div>
			{drag != null ? (
				<DragLayer
					drag={drag}
					zoom={zoom}
					onMove={(delta) => setDrag({ ...drag, delta })}
					onEnd={(delta) => {
						setDrag(null);
						commitMove(delta);
					}}
				/>
			) : null}
		</section>
	);
};

interface TTimelineProps {
	cx: StudioCx;
}

interface TDrag {
	originX: number;
	delta: number;
	keys: string[];
}

const LaneHeader: React.FC<{ cx: StudioCx; lane: TLane; project: TProject }> = (props) => {
	const { cx, lane, project } = props;
	const selection = useFeatureState(cx.$selection);
	const marble = project.entities.find((entity) => entity.components.marble?.laneId === lane.id);
	const id = marble?.id ?? lane.id;
	const conflicts = findLaneConflicts(lane).size;

	return (
		<button
			className="flex w-full items-center gap-2 border-b border-[var(--separator)] px-3 text-left"
			style={{ height: ROW_HEIGHT }}
			data-selected={selection.includes(id)}
			onClick={() => cx.$selection.set([id])}
			type="button"
		>
			<span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: lane.color }} />
			<span className="flex min-w-0 flex-1 flex-col leading-tight">
				<span className={`truncate ${selection.includes(id) ? 'font-semibold' : ''}`}>{lane.name}</span>
				<span className="truncate text-[11px] text-[var(--text-tertiary)]">
					{lane.hits.length} hits{conflicts > 0 ? ` · ${conflicts} too close` : ''}
				</span>
			</span>
		</button>
	);
};

const Ruler: React.FC<{ end: number; zoom: number; onSeek: (clientX: number) => void }> = (props) => {
	const { end, zoom, onSeek } = props;
	const step = zoom >= 240 ? 0.25 : zoom >= 100 ? 0.5 : zoom >= 40 ? 1 : 2;
	const ticks = Array.from({ length: Math.floor(end / step) + 1 }, (_, index) => index * step);

	return (
		<div
			className="sticky top-0 z-20 border-b border-[var(--separator)] bg-[var(--content)]"
			style={{ height: RULER_HEIGHT }}
			onPointerDown={(event) => {
				event.currentTarget.setPointerCapture(event.pointerId);
				onSeek(event.clientX);
			}}
			onPointerMove={(event) => {
				if (event.buttons === 1) onSeek(event.clientX);
			}}
		>
			{ticks.map((tick) => {
				const major = Math.abs(tick - Math.round(tick)) < 1e-6;
				return (
					<span key={tick} className="absolute bottom-0" style={{ left: tick * zoom }}>
						<span className="absolute bottom-0 w-px bg-[var(--separator)]" style={{ height: major ? 10 : 5 }} />
						{major ? (
							<span className="mm-mono absolute bottom-2.5 left-1 text-[10px] text-[var(--text-tertiary)]">
								{formatTime(tick).replace(/\.00$/, '')}
							</span>
						) : null}
					</span>
				);
			})}
			<span
				className="absolute top-0 bottom-0 bg-[var(--hover)]"
				style={{ left: end * zoom, width: 80 }}
				title="Project end"
			/>
		</div>
	);
};

const LaneRow: React.FC<TLaneRowProps> = (props) => {
	const { cx, lane, zoom, selection, drag, audioOffset, analysis, onAdd, onDragStart, timeAt } = props;
	const conflicts = React.useMemo(() => findLaneConflicts(lane), [lane]);
	const pitches = lane.hits.map((hit) => hit.pitch).filter((pitch): pitch is number => pitch != null);
	const low = pitches.length ? Math.min(...pitches) : 60;
	const high = pitches.length ? Math.max(...pitches) : 72;
	const [marquee, setMarquee] = React.useState<{ from: number; to: number } | null>(null);

	function pitchY(pitch: number | undefined): number {
		if (pitch == null || high === low) return ROW_HEIGHT / 2;
		return 34 - ((pitch - low) / (high - low)) * 24;
	}

	return (
		<div
			className="relative border-b border-[var(--separator)]"
			style={{ height: ROW_HEIGHT }}
			onPointerDown={(event) => {
				if (event.button !== 0 || event.target !== event.currentTarget) return;
				event.currentTarget.setPointerCapture(event.pointerId);
				const time = timeAt(event.clientX);
				setMarquee({ from: time, to: time });
			}}
			onPointerMove={(event) => {
				if (marquee != null) setMarquee({ ...marquee, to: timeAt(event.clientX) });
			}}
			onPointerUp={(event) => {
				if (marquee == null) return;
				const from = Math.min(marquee.from, marquee.to);
				const to = Math.max(marquee.from, marquee.to);
				setMarquee(null);
				if ((to - from) * zoom < 3) {
					if (!event.shiftKey) cx.$selection.set([]);
					return;
				}
				const keys = lane.hits.filter((hit) => hit.time >= from && hit.time <= to).map((hit) => toHitKey(lane.id, hit.id));
				cx.$selection.set(event.shiftKey ? [...new Set([...selection, ...keys])] : keys);
			}}
			onDoubleClick={(event) => {
				if (event.target !== event.currentTarget) return;
				onAdd(timeAt(event.clientX), event);
			}}
		>
			{analysis != null ? <Waveform analysis={analysis} offset={audioOffset} zoom={zoom} /> : null}
			{analysis?.onsets.map((onset) => (
				<span
					key={onset}
					className="pointer-events-none absolute bottom-0 h-1.5 w-px bg-[var(--text-tertiary)]"
					style={{ left: (onset + audioOffset) * zoom }}
				/>
			))}
			{lane.hits.map((hit) => {
				const key = toHitKey(lane.id, hit.id);
				const selected = selection.includes(key);
				const offset = drag?.keys.includes(key) ? drag.delta : 0;
				const conflict = conflicts.has(hit.id);
				return (
					<button
						key={hit.id}
						aria-label={`Hit at ${formatTime(hit.time)}`}
						className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
						style={{
							left: Math.max(0, hit.time + offset) * zoom,
							top: pitchY(hit.pitch),
							background: lane.color,
							boxShadow: selected
								? '0 0 0 2px var(--content), 0 0 0 3.5px var(--accent)'
								: conflict
									? '0 0 0 2px var(--content), 0 0 0 3.5px var(--bad)'
									: undefined
						}}
						title={conflict ? `Closer than ${MIN_HIT_GAP * 1000} ms to a neighbor` : formatTime(hit.time)}
						onPointerDown={(event) => {
							if (event.button !== 0) return;
							event.stopPropagation();
							if (event.shiftKey) {
								cx.$selection.set(selected ? selection.filter((item) => item !== key) : [...selection, key]);
								return;
							}
							cx.audition(lane.id, hit.pitch);
							onDragStart(key, event.clientX);
						}}
						type="button"
					/>
				);
			})}
			{marquee != null ? (
				<span
					className="pointer-events-none absolute top-1 bottom-1 rounded-[3px] border border-[var(--accent)] bg-[var(--selection)]"
					style={{ left: Math.min(marquee.from, marquee.to) * zoom, width: Math.abs(marquee.to - marquee.from) * zoom }}
				/>
			) : null}
		</div>
	);
};

interface TLaneRowProps {
	cx: StudioCx;
	lane: TLane;
	zoom: number;
	selection: string[];
	drag: TDrag | null;
	audioOffset: number;
	analysis: TSourceAnalysis | undefined;
	onAdd: (time: number, event: React.MouseEvent) => void;
	onDragStart: (hitKey: string, clientX: number) => void;
	timeAt: (clientX: number) => number;
}

/** Faint waveform of the imported recording behind a lane */
const Waveform: React.FC<{ analysis: TSourceAnalysis; offset: number; zoom: number }> = (props) => {
	const { analysis, offset, zoom } = props;
	const canvasRef = React.useRef<HTMLCanvasElement>(null);
	const width = Math.ceil(analysis.duration * zoom);

	React.useEffect(() => {
		const canvas = canvasRef.current;
		const context = canvas?.getContext('2d');
		if (canvas == null || context == null) return;
		const scale = window.devicePixelRatio || 1;
		canvas.width = Math.min(width * scale, 32000);
		canvas.height = ROW_HEIGHT * scale;
		context.scale(canvas.width / width, scale);
		context.fillStyle = getComputedStyle(canvas).color;
		const perPixel = 1 / zoom / analysis.bucketSeconds;
		for (let x = 0; x < width; x++) {
			const start = Math.floor(x * perPixel);
			const end = Math.max(start + 1, Math.floor((x + 1) * perPixel));
			let peak = 0;
			for (let index = start; index < end && index < analysis.peaks.length; index++) {
				peak = Math.max(peak, analysis.peaks[index] ?? 0);
			}
			const height = Math.max(1, peak * (ROW_HEIGHT - 8));
			context.fillRect(x, (ROW_HEIGHT - height) / 2, 1, height);
		}
	}, [analysis, width, zoom]);

	return (
		<canvas
			ref={canvasRef}
			className="pointer-events-none absolute top-0 text-[var(--text-tertiary)] opacity-60"
			style={{ left: offset * zoom, width, height: ROW_HEIGHT }}
		/>
	);
};

/** Captures pointer movement for a hit drag across the whole window */
const DragLayer: React.FC<{ drag: TDrag; zoom: number; onMove: (delta: number) => void; onEnd: (delta: number) => void }> = (
	props
) => {
	const { drag, zoom, onMove, onEnd } = props;
	return (
		<div
			className="fixed inset-0 z-50 cursor-ew-resize"
			onPointerMove={(event) => onMove((event.clientX - drag.originX) / zoom)}
			onPointerUp={(event) => onEnd((event.clientX - drag.originX) / zoom)}
			onPointerCancel={() => onEnd(0)}
		/>
	);
};

export function deleteSelectedHits(cx: StudioCx): boolean {
	const project = cx.project;
	if (project == null) return false;
	const byLane = new Map<string, string[]>();
	for (const key of cx.$selection.get()) {
		const parsed = parseHitKey(key);
		if (parsed == null) continue;
		byLane.set(parsed.laneId, [...(byLane.get(parsed.laneId) ?? []), parsed.hitId]);
	}
	if (!byLane.size) return false;
	const applied = cx.execute([...byLane].map(([laneId, hitIds]) => ({ type: 'removeHits' as const, laneId, hitIds })));
	if (applied) cx.$selection.set([]);
	return applied;
}

function nearestPitch(lane: TLane, time: number): number | undefined {
	let best: number | undefined;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const hit of lane.hits) {
		const distance = Math.abs(hit.time - time);
		if (hit.pitch != null && distance < bestDistance) {
			best = hit.pitch;
			bestDistance = distance;
		}
	}
	return best;
}

function round(value: number): number {
	return Math.round(value * 10000) / 10000;
}
