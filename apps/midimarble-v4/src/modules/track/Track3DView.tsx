import { useFeatureState } from 'feature-react/state';
import { Box, type LucideIcon, Square, Video } from 'lucide-react';
import React from 'react';
import { openContextMenu } from '@/components';
import type { TVec2 } from '@/modules/project';
import { patternOfPiece } from '@/modules/building';
import { startCameraOrbit, toPoints } from '@/modules/canvas';
import { CAMERA_KEY } from '@/modules/project';
import type { StudioCx, TTrackView } from '@/modules/studio';
import type { TrackCx } from './TrackCx';
import { groupSelection } from './PatternsCx';
import { canvasMenu } from './menus';
import { Track3DCx } from './Track3DCx';

const views: { id: TTrackView; label: string; Icon: LucideIcon; tooltip: string; shortcut?: string }[] = [
	{ id: '2d', label: '2D', Icon: Square, tooltip: '2D: flat, with all editing' },
	{ id: '3d', label: '3D', Icon: Box, tooltip: '3D: drag to look around', shortcut: 'D' },
	{ id: 'camera', label: 'Camera', Icon: Video, tooltip: "Camera: through the film's camera" }
];

/** Track's 2D, 3D or Camera view, as icons at the canvas's top right beside the pills that change with the view */
export const TrackViewSwitch: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const view = useFeatureState(cx.$trackView);
	return (
		<div className="mm-floating mm-tooltip-below flex items-center gap-0.5 p-[3px]" role="radiogroup" aria-label="Track view">
			{views.map((item) => (
				<button key={item.id} className="mm-tool-button !h-7 !w-7" role="radio" aria-checked={view === item.id} aria-label={item.label} data-active={view === item.id} onClick={() => cx.$trackView.set(item.id)} type="button">
					<item.Icon size={14} strokeWidth={1.7} />
					<span className="mm-tooltip">
						{item.tooltip}
						{item.shortcut != null ? <kbd>{item.shortcut}</kbd> : null}
					</span>
				</button>
			))}
		</div>
	);
};

/**
 * Track's 3D or Camera view over the flat canvas, which stays mounted behind it, not drawing, so the tool rail, keys and Follow keep working.
 * Choosing 2D eases back to front-on before it goes. Arming a tool or dragging a tile out of Insert goes to 2D, the only
 * place they work.
 */
export const Track3DView: React.FC<{ trackCx: TrackCx }> = (props) => {
	const { trackCx } = props;
	const cx = trackCx.studio;
	const view = useFeatureState(cx.$trackView);
	// Coming back from Film already in 3D doesn't replay the ease
	const [startsIn3d] = React.useState(view !== '2d');
	const [isShown, setIsShown] = React.useState(view !== '2d');
	if (view !== '2d' && !isShown) setIsShown(true);

	React.useEffect(() => {
		const stops = [
			trackCx.$tool.listen(({ value }) => {
				if (value !== 'select' && value !== 'hand') cx.$trackView.set('2d');
			}),
			trackCx.$inserting.listen(({ value }) => {
				if (value != null) cx.$trackView.set('2d');
			})
		];
		return () => {
			for (const stop of stops) stop();
		};
	}, [cx, trackCx]);

	return isShown ? <Viewport trackCx={trackCx} view={view} startsIn3d={startsIn3d} onFlat={() => setIsShown(false)} /> : null;
};

const CLICK_SLOP = 4;

const Viewport: React.FC<{ trackCx: TrackCx; view: TTrackView; startsIn3d: boolean; onFlat: () => void }> = (props) => {
	const { trackCx, view, startsIn3d, onFlat } = props;
	const cx = trackCx.studio;
	const [track] = React.useState(() => {
		const created = new Track3DCx(trackCx);
		created.$amount.set(startsIn3d ? 1 : 0);
		return created;
	});
	const containerRef = React.useRef<HTMLDivElement>(null);
	const canvasRef = React.useRef<HTMLCanvasElement>(null);
	const amount = useFeatureState(track.$amount);
	const spaceHeld = useFeatureState(trackCx.$spaceHeld);
	const tool = useFeatureState(trackCx.$tool);
	const [hover, setHover] = React.useState<string | null>(null);
	const dragRef = React.useRef<{ kind: 'turn' | 'pan' | 'still'; last: TVec2; moved: number } | null>(null);
	const [isDragging, setIsDragging] = React.useState(false);
	const selection = useFeatureState(cx.$selection);
	const isCameraAuto = useFeatureState(cx.$history)?.present.film.camera.auto;
	const isCamera = view === 'camera';
	const canOrbit = isCamera && selection.includes(CAMERA_KEY) && isCameraAuto === true;
	const isPanTool = !isCamera && (spaceHeld || tool === 'hand');

	React.useEffect(() => {
		const container = containerRef.current;
		const canvas = canvasRef.current;
		if (container == null || canvas == null) return;
		return track.mount(container, canvas);
	}, [track]);

	React.useEffect(() => {
		if (view !== '2d') {
			track.setView(view === 'camera' ? 'camera' : 'orbit');
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
			className="absolute inset-0 z-[25] touch-none overflow-hidden bg-[var(--canvas)]"
			// The flat canvas and this one match at the ends of the ease, so a short fade hides the change of look
			style={{ opacity: Math.min(1, amount * 8), pointerEvents: view !== '2d' ? undefined : 'none', cursor: isDragging ? 'grabbing' : isPanTool || canOrbit ? 'grab' : hover != null ? 'pointer' : 'default' }}
			role="img"
			aria-label={isCamera ? "Track through the film's camera" : 'Track in 3D'}
			onPointerDown={(event) => {
				if (event.button !== 0 && event.button !== 1) return;
				event.currentTarget.setPointerCapture(event.pointerId);
				dragRef.current = { kind: isCamera ? 'still' : isPanTool || event.button === 1 ? 'pan' : 'turn', last: pointOf(event), moved: 0 };
				if (canOrbit && event.button === 0) startCameraOrbit(cx, event);
			}}
			onPointerMove={(event) => {
				const point = pointOf(event);
				const drag = dragRef.current;
				if (drag == null) {
					setHover(isPanTool ? null : track.pick(point));
					return;
				}
				const [dx, dy] = [point.x - drag.last.x, point.y - drag.last.y];
				const moved = drag.moved + Math.hypot(dx, dy);
				dragRef.current = { ...drag, last: point, moved };
				if (moved < CLICK_SLOP || (drag.kind === 'still' && !canOrbit)) return;
				setIsDragging(true);
				if (drag.kind === 'turn') track.turn(dx, dy);
				else if (drag.kind === 'pan') track.pan(dx, dy);
			}}
			onPointerUp={(event) => {
				const drag = dragRef.current;
				if (drag != null && drag.moved < CLICK_SLOP && drag.kind !== 'pan') select(track.pick(pointOf(event)), event.shiftKey);
				dragRef.current = null;
				setIsDragging(false);
			}}
			onPointerCancel={() => {
				dragRef.current = null;
				setIsDragging(false);
			}}
			onPointerLeave={() => setHover(null)}
			onContextMenu={(event) => {
				const id = track.pick(pointOf(event));
				if (id == null) {
					openContextMenu(event, canvasMenu(track.trackCx));
					return;
				}
				if (!cx.$selection.get().includes(id)) select(id, false);
				openContextMenu(event, cx.menus.piece());
			}}
		>
			<canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
			<Viewfinder track={track} />
			<Outlines track={track} hover={hover} />
		</div>
	);
};

/** The film's frame in the Camera view: the wall beyond it dims, like Blender's passepartout */
const Viewfinder: React.FC<{ track: Track3DCx }> = (props) => {
	const { track } = props;
	useFeatureState(track.$frame);
	const frame = track.filmFrame;
	if (frame == null) return null;
	return <div className="pointer-events-none absolute" style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height, boxShadow: '0 0 0 2000px rgb(0 0 0 / 0.6)' }} />;
};

/** The selection and what the pointer is over, drawn over the view */
const Outlines: React.FC<{ track: Track3DCx; hover: string | null }> = (props) => {
	const { track, hover } = props;
	useFeatureState(track.$frame);
	const selection = useFeatureState(track.trackCx.studio.$selection);
	const pieces = track.pieces();
	return (
		<svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden data-selection-outlines>
			{pieces
				.filter((piece) => piece.pieceId === hover && !selection.includes(piece.pieceId))
				.map((piece) => (
					<polygon key={piece.pieceId} points={toPoints(track.outline(piece))} fill="none" stroke="var(--accent-strong)" strokeOpacity={0.6} strokeWidth={1.25} strokeLinejoin="round" />
				))}
			{pieces
				.filter((piece) => selection.includes(piece.pieceId))
				.map((piece) => {
					const points = toPoints(track.outline(piece));
					return (
						<g key={piece.pieceId}>
							<polygon points={points} fill="none" stroke="white" strokeOpacity={0.9} strokeWidth={3.75} strokeLinejoin="round" />
							<polygon points={points} fill="color-mix(in srgb, var(--accent) 12%, transparent)" stroke="var(--accent-strong)" strokeWidth={1.75} strokeLinejoin="round" />
						</g>
					);
				})}
		</svg>
	);
};
