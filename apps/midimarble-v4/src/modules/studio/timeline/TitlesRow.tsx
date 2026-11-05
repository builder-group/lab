import { Type } from 'lucide-react';
import React from 'react';
import { titleClips } from '@/modules/design/titles';
import type { TComponents, TProject } from '@/modules/project';
import { formatTime } from '../format';
import { TITLES_KEY } from '../outline';
import type { StudioCx } from '../StudioCx';
import { TimeGutter } from './Ruler';
import { CAMERA_ROW_HEIGHT, HEADER_WIDTH, round } from './timeline-layout';

type TWallText = NonNullable<TComponents['wallText']>;
type TClipDrag = { entityId: string; edge: 'move' | 'in' | 'out'; originX: number; grab: number; start: number; end: number; moved: boolean };

/** Shortest title clip the trim handles leave, in seconds */
const MIN_CLIP = 0.1;

/**
 * The Titles track of the Film workspace, like the Titles group in Layers: each title is a clip from
 * its In to its Out time, like a title in Final Cut's timeline. Click selects the title, dragging the clip moves it
 * and dragging an edge trims it, each as one undo step. Absent while the project has no titles.
 */
export const TitlesRow: React.FC<TTitlesRowProps> = (props) => {
	const { cx, project, zoom, width, selection, timeAt } = props;
	const clips = titleClips(project);
	const [drag, setDrag] = React.useState<TClipDrag | null>(null);
	if (!clips.length) return null;
	const isSelected = clips.some((clip) => selection.includes(clip.entityId));

	function commit(next: TClipDrag): void {
		const entity = project.entities.find((item) => item.id === next.entityId);
		const text = entity?.components.wallText;
		if (entity == null || text == null) return;
		const { in: _in, out: _out, ...rest } = text;
		const value: TWallText = { ...rest };
		if (next.start > 0) value.in = round(next.start);
		if (next.end < project.end) value.out = round(next.end);
		cx.execute([{ type: 'setComponent', entityId: entity.id, component: { name: 'wallText', value } }]);
	}

	function dragTo(current: TClipDrag, clientX: number): TClipDrag {
		const clip = clips.find((item) => item.entityId === current.entityId);
		if (clip == null) return current;
		const time = timeAt(clientX);
		if (current.edge === 'in') return { ...current, start: Math.min(Math.max(0, time), clip.end - MIN_CLIP) };
		if (current.edge === 'out') return { ...current, end: Math.max(Math.min(project.end, time), clip.start + MIN_CLIP) };
		const length = clip.end - clip.start;
		const start = Math.min(Math.max(0, time - current.grab), project.end - length);
		return { ...current, start, end: start + length };
	}

	return (
		<div className="flex shrink-0" style={{ height: CAMERA_ROW_HEIGHT }}>
			<div
				className="mm-track-header sticky left-0 z-20 flex shrink-0 items-center gap-1.5 border-r border-b border-[var(--separator)] pr-2.5 pl-5"
				style={{ width: HEADER_WIDTH }}
				data-selected={isSelected}
				data-track={TITLES_KEY}
				onClick={() => cx.$selection.set(clips.map((clip) => clip.entityId))}
			>
				<span className="mm-song-icon">
					<Type size={12} strokeWidth={1.75} />
				</span>
				<span className="min-w-0 flex-1 truncate font-medium">Titles</span>
				<span className="shrink-0 text-[11px] text-[var(--text-secondary)] tabular-nums">{clips.length === 1 ? '1 title' : `${clips.length} titles`}</span>
			</div>
			<TimeGutter />
			<div
				className="relative flex-1 border-b border-[var(--separator)]"
				style={{ minWidth: width }}
				aria-label="Title clips"
				onPointerDown={(event) => {
					if (event.button !== 0 || event.target !== event.currentTarget || event.shiftKey) return;
					cx.$selection.set([]);
				}}
			>
				{clips.map((clip, index) => {
					const isClipSelected = selection.includes(clip.entityId);
					const span = drag?.entityId === clip.entityId ? drag : clip;
					// Overlapping titles stack in two rows so each stays clickable
					const top = clips.slice(0, index).some((other) => other.end > clip.start && other.start < clip.end) ? 15 : 4;
					const onEdgeDown = (edge: TClipDrag['edge']) => (event: React.PointerEvent<HTMLElement>) => {
						if (event.button !== 0) return;
						event.stopPropagation();
						if (event.shiftKey) {
							cx.$selection.set(isClipSelected ? selection.filter((item) => item !== clip.entityId) : [...selection, clip.entityId]);
							return;
						}
						event.currentTarget.setPointerCapture(event.pointerId);
						cx.$selection.set([clip.entityId]);
						setDrag({ entityId: clip.entityId, edge, originX: event.clientX, grab: timeAt(event.clientX) - clip.start, start: clip.start, end: clip.end, moved: false });
					};
					const onMove = (event: React.PointerEvent<HTMLElement>): void => {
						if (drag?.entityId !== clip.entityId) return;
						const moved = drag.moved || Math.abs(event.clientX - drag.originX) > 2;
						if (moved) setDrag({ ...dragTo(drag, event.clientX), moved });
					};
					const onUp = (): void => {
						if (drag?.entityId !== clip.entityId) return;
						setDrag(null);
						if (drag.moved && (drag.start !== clip.start || drag.end !== clip.end)) commit(drag);
					};
					return (
						<div
							key={clip.entityId}
							role="button"
							tabIndex={-1}
							className="mm-title-clip absolute z-10 flex h-[13px] cursor-grab items-center overflow-hidden rounded-[3px] px-1.5 text-[10px] leading-none whitespace-nowrap"
							data-selected={isClipSelected}
							style={{ left: span.start * zoom, width: Math.max(4, (span.end - span.start) * zoom), top }}
							title={`${clip.text} · ${formatTime(span.start)} to ${formatTime(span.end)}`}
							aria-label={`Title ${clip.text} from ${formatTime(span.start)} to ${formatTime(span.end)}`}
							aria-pressed={isClipSelected}
							onPointerDown={onEdgeDown('move')}
							onPointerMove={onMove}
							onPointerUp={onUp}
							onPointerCancel={() => setDrag(null)}
						>
							<span className="pointer-events-none truncate">{clip.text}</span>
							{(['in', 'out'] as const).map((edge) => (
								<span
									key={edge}
									className="mm-title-clip-edge"
									data-edge={edge}
									onPointerDown={onEdgeDown(edge)}
									// The clip itself handles move and up too, so the edge keeps them to itself
									onPointerMove={(event) => {
										event.stopPropagation();
										onMove(event);
									}}
									onPointerUp={(event) => {
										event.stopPropagation();
										onUp();
									}}
								/>
							))}
						</div>
					);
				})}
			</div>
		</div>
	);
};

interface TTitlesRowProps {
	cx: StudioCx;
	project: TProject;
	zoom: number;
	width: number;
	selection: string[];
	timeAt: (clientX: number) => number;
}
