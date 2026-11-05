import { useFeatureState } from 'feature-react/state';
import React from 'react';
import { openContextMenu } from '@/components';
import type { TVec2 } from '@/modules/project';
import { patternOfPiece } from '@/modules/simulation';
import { pieceMenu } from '@/modules/studio/menus';
import type { StudioCx, TTrackView } from '@/modules/studio/StudioCx';
import type { ComposeCx } from './ComposeCx';
import { groupSelection } from './PatternsCx';
import { toPoints } from './PieceLayer';
import { Track3DCx } from './Track3DCx';

const views: { id: TTrackView; label: string; title: string }[] = [
	{ id: '2d', label: '2D', title: 'Flat and precise, with all editing' },
	{ id: '3d', label: '3D', title: 'Look around the track: drag to turn, it selects but nothing drags' }
];

/** Track's 2D or 3D switch, at the canvas's top right beside Snap and Follow */
export const TrackViewSwitch: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const view = useFeatureState(cx.$trackView);
	return (
		<div className="mm-floating mm-segmented" role="radiogroup" aria-label="Track view">
			{views.map((item) => (
				<button key={item.id} role="radio" aria-checked={view === item.id} data-active={view === item.id} title={item.title} onClick={() => cx.$trackView.set(item.id)} type="button">
					{item.label}
				</button>
			))}
		</div>
	);
};

/**
 * Track's 3D view over the flat canvas, which stays mounted behind it so the tool rail, keys and Follow keep working.
 * Choosing 2D eases back to front-on before it goes. Arming a tool or dragging a tile out of Insert goes to 2D, the only
 * place they work.
 */
export const Track3DView: React.FC<{ compose: ComposeCx }> = (props) => {
	const { compose } = props;
	const cx = compose.studio;
	const view = useFeatureState(cx.$trackView);
	// Coming back from Film already in 3D doesn't replay the ease
	const [startsIn3d] = React.useState(view === '3d');
	const [isShown, setIsShown] = React.useState(view === '3d');
	if (view === '3d' && !isShown) setIsShown(true);

	React.useEffect(() => {
		const stops = [
			compose.$tool.listen(({ value }) => {
				if (value !== 'select' && value !== 'hand') cx.$trackView.set('2d');
			}),
			compose.$inserting.listen(({ value }) => {
				if (value != null) cx.$trackView.set('2d');
			})
		];
		return () => {
			for (const stop of stops) stop();
		};
	}, [cx, compose]);

	return isShown ? <Viewport compose={compose} view={view} startsIn3d={startsIn3d} onFlat={() => setIsShown(false)} /> : null;
};

const CLICK_SLOP = 4;

const Viewport: React.FC<{ compose: ComposeCx; view: TTrackView; startsIn3d: boolean; onFlat: () => void }> = (props) => {
	const { compose, view, startsIn3d, onFlat } = props;
	const cx = compose.studio;
	const [track] = React.useState(() => {
		const created = new Track3DCx(compose);
		created.$amount.set(startsIn3d ? 1 : 0);
		return created;
	});
	const containerRef = React.useRef<HTMLDivElement>(null);
	const canvasRef = React.useRef<HTMLCanvasElement>(null);
	const amount = useFeatureState(track.$amount);
	const spaceHeld = useFeatureState(compose.$spaceHeld);
	const tool = useFeatureState(compose.$tool);
	const [hover, setHover] = React.useState<string | null>(null);
	const [drag, setDrag] = React.useState<{ kind: 'turn' | 'pan'; last: TVec2; moved: number } | null>(null);
	const isPanTool = spaceHeld || tool === 'hand';

	React.useEffect(() => {
		const container = containerRef.current;
		const canvas = canvasRef.current;
		if (container == null || canvas == null) return;
		return track.mount(container, canvas);
	}, [track]);

	React.useEffect(() => {
		if (view === '3d') {
			if (track.$amount.get() < 1) track.easeTo(1);
		} else track.easeTo(0, onFlat);
	}, [track, view, onFlat]);

	function pointOf(event: React.MouseEvent<HTMLElement>): TVec2 {
		const rect = event.currentTarget.getBoundingClientRect();
		return { x: event.clientX - rect.left, y: event.clientY - rect.top };
	}

	function select(id: string | null, shiftKey: boolean): void {
		// A live Pattern's bar selects its Group, as in 2D
		const group = id != null && cx.project != null ? patternOfPiece(cx.project, id) : null;
		const keys = group != null ? groupSelection(group) : id != null ? [id] : [];
		const current = cx.$selection.get();
		if (!shiftKey) cx.$selection.set(keys);
		else if (keys.length > 0) cx.$selection.set(keys.every((key) => current.includes(key)) ? current.filter((item) => !keys.includes(item)) : [...new Set([...current, ...keys])]);
	}

	return (
		<div
			ref={containerRef}
			className="absolute inset-0 z-[25] touch-none bg-[var(--canvas)]"
			// The flat canvas and this one match at the ends of the ease, so a short fade hides the change of look
			style={{ opacity: Math.min(1, amount * 8), pointerEvents: view === '3d' ? undefined : 'none', cursor: drag != null ? 'grabbing' : isPanTool ? 'grab' : hover != null ? 'pointer' : 'default' }}
			role="img"
			aria-label="Track in 3D"
			onPointerDown={(event) => {
				if (event.button !== 0 && event.button !== 1) return;
				event.currentTarget.setPointerCapture(event.pointerId);
				setDrag({ kind: isPanTool || event.button === 1 ? 'pan' : 'turn', last: pointOf(event), moved: 0 });
			}}
			onPointerMove={(event) => {
				const point = pointOf(event);
				if (drag == null) {
					setHover(isPanTool ? null : track.pick(point));
					return;
				}
				const [dx, dy] = [point.x - drag.last.x, point.y - drag.last.y];
				const moved = drag.moved + Math.hypot(dx, dy);
				setDrag({ ...drag, last: point, moved });
				if (moved < CLICK_SLOP) return;
				if (drag.kind === 'turn') track.turn(dx, dy);
				else track.pan(dx, dy);
			}}
			onPointerUp={(event) => {
				if (drag != null && drag.moved < CLICK_SLOP && drag.kind === 'turn') select(track.pick(pointOf(event)), event.shiftKey);
				setDrag(null);
			}}
			onPointerCancel={() => setDrag(null)}
			onPointerLeave={() => setHover(null)}
			onContextMenu={(event) => {
				const id = track.pick(pointOf(event));
				if (id == null) return;
				if (!cx.$selection.get().includes(id)) select(id, false);
				openContextMenu(event, pieceMenu(cx));
			}}
		>
			<canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
			<Outlines track={track} hover={hover} />
		</div>
	);
};

/** The selection and what the pointer is over, drawn over the view */
const Outlines: React.FC<{ track: Track3DCx; hover: string | null }> = (props) => {
	const { track, hover } = props;
	useFeatureState(track.$frame);
	const selection = useFeatureState(track.compose.studio.$selection);
	const pieces = track.pieces();
	return (
		<svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden data-selection-outlines>
			{pieces
				.filter((piece) => piece.entityId === hover && !selection.includes(piece.entityId))
				.map((piece) => (
					<polygon key={piece.entityId} points={toPoints(track.outline(piece))} fill="none" stroke="var(--accent-strong)" strokeOpacity={0.6} strokeWidth={1.25} strokeLinejoin="round" />
				))}
			{pieces
				.filter((piece) => selection.includes(piece.entityId))
				.map((piece) => {
					const points = toPoints(track.outline(piece));
					return (
						<g key={piece.entityId}>
							<polygon points={points} fill="none" stroke="white" strokeOpacity={0.9} strokeWidth={3.75} strokeLinejoin="round" />
							<polygon points={points} fill="color-mix(in srgb, var(--accent) 12%, transparent)" stroke="var(--accent-strong)" strokeWidth={1.75} strokeLinejoin="round" />
						</g>
					);
				})}
		</svg>
	);
};
