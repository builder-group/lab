import { useFeatureState } from 'feature-react/state';
import { Box, Square } from 'lucide-react';
import React from 'react';
import type { TProject, TVec2 } from '@/modules/project';
import { frameBand, type THitResult, type TResolvedPiece, type TSimulationResult } from '@/modules/simulation';
import { formatTime, noteName } from '@/modules/studio/format';
import { parseHitKey } from '@/modules/studio/selection';
import type { StudioCx } from '@/modules/studio/StudioCx';
import { formatDegrees, parseDegrees } from './angles';
import { ComposeCx } from './ComposeCx';
import { ComposeToolbar } from './ComposeToolbar';
import { badgeStatus, StatusBadge } from './status';
import { nextOpenHitPerLane, pieceAngleCommands, selectedPieceIds } from './step-loop';

/** The Compose pegboard: WebGL content over the CSS dot grid, with screen-space handles on top */
export const ComposeCanvas: React.FC<TComposeCanvasProps> = (props) => {
	const { cx } = props;
	const [compose] = React.useState(() => new ComposeCx(cx));
	const containerRef = React.useRef<HTMLDivElement>(null);
	const canvasRef = React.useRef<HTMLCanvasElement>(null);
	const tool = useFeatureState(compose.$tool);
	const spaceHeld = useFeatureState(compose.$spaceHeld);
	const drag = useFeatureState(compose.$drag);
	const hover = useFeatureState(compose.$hover);

	React.useEffect(() => {
		const container = containerRef.current;
		const canvas = canvasRef.current;
		if (container == null || canvas == null) return;
		// Development hook for browser checks and latency measurements
		if (import.meta.env.DEV) (window as unknown as { __midimarble?: unknown }).__midimarble = { studio: cx, compose };
		return compose.mount(container, canvas);
	}, [compose, cx]);

	const isPanning = drag?.kind === 'pan';
	const cursor =
		isPanning ? 'grabbing'
		: spaceHeld || tool === 'hand' ? 'grab'
		: drag?.kind === 'rotate' || hover?.kind === 'rotate' ? 'grab'
		: drag?.kind === 'release' || hover?.kind === 'release' ? 'move'
		: hover?.kind === 'dot' || tool === 'piece' ? 'crosshair'
		: 'default';

	return (
		<div ref={containerRef} className="mm-pegboard relative h-full w-full overflow-hidden">
			<canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
			<div
				className="absolute inset-0 touch-none"
				style={{ cursor }}
				onPointerDown={(event) => compose.onPointerDown(event)}
				onPointerMove={(event) => compose.onPointerMove(event)}
				onPointerUp={(event) => compose.onPointerUp(event)}
				onPointerCancel={(event) => compose.onPointerUp(event)}
				onPointerLeave={() => compose.onPointerLeave()}
				onContextMenu={(event) => event.preventDefault()}
			/>
			<ComposeOverlay compose={compose} />
			<CornerControls compose={compose} />
			<SimulatingIndicator cx={cx} />
			<ComposeToolbar compose={compose} />
		</div>
	);
};

interface TComposeCanvasProps {
	cx: StudioCx;
}

// MARK: - Overlay

const ComposeOverlay: React.FC<{ compose: ComposeCx }> = (props) => {
	const { compose } = props;
	const cx = compose.studio;
	// Subscriptions that move anything drawn here
	const camera = useFeatureState(compose.$camera);
	const viewport = useFeatureState(compose.$viewport);
	const result = useFeatureState(cx.simulation.$result);
	const history = useFeatureState(cx.$history);
	const selection = useFeatureState(cx.$selection);
	const hover = useFeatureState(compose.$hover);
	const drag = useFeatureState(compose.$drag);
	const project = history?.present;
	if (project == null || result == null || viewport.width <= 1) return null;

	const is2d = camera.mode === '2d';
	const selectedPieces = selectedPieceIds(project, selection);
	const single = selectedPieces.length === 1 ? result.pieces.find((piece) => piece.entityId === selectedPieces[0]) : undefined;
	const grip = single?.contactPoint != null && is2d ? compose.screenGrip(single) : null;
	const isRotating = drag?.kind === 'rotate';
	const showArc = grip != null && (isRotating || (hover?.kind === 'rotate' && hover.entityId === single?.entityId));
	const nextDots = nextOpenHitPerLane(result);
	const band = frameBand(project);
	const hoveredPiece = hover?.kind === 'piece' ? hover.entityId : null;
	const hoveredDot =
		hover?.kind === 'dot' ? result.hits.find((hit) => hit.status === 'open' && hit.laneId === hover.laneId && hit.hitId === hover.hitId) : undefined;
	const focusedKeys = new Set(selection.filter((key) => parseHitKey(key) != null));

	return (
		<>
			<svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
				{result.pieces.map((piece) => {
					const isSelected = selection.includes(piece.entityId);
					const isHovered = hoveredPiece === piece.entityId && !isSelected;
					if (!isSelected && !isHovered) return null;
					const corners = inflate(compose.screenCorners(piece), 2.5);
					return (
						<polygon
							key={`outline-${piece.entityId}`}
							points={corners.map((corner) => `${corner.x},${corner.y}`).join(' ')}
							fill="none"
							stroke="var(--accent-strong)"
							strokeWidth={isSelected ? 2 : 1.25}
							strokeOpacity={isSelected ? 1 : 0.75}
							strokeLinejoin="round"
						/>
					);
				})}
				{result.pieces.map((piece) => (
					<PieceBadge key={`badge-${piece.entityId}`} compose={compose} piece={piece} result={result} />
				))}
				{result.hits.map((hit) => {
					if (hit.status !== 'open' || hit.dot == null) return null;
					const position = compose.toScreen(hit.dot);
					const lane = project.music.lanes.find((item) => item.id === hit.laneId);
					const isNext = nextDots.get(hit.laneId) === hit;
					const isHovered = hoveredDot === hit;
					const isFocused = focusedKeys.has(`hit:${hit.laneId}:${hit.hitId}`);
					const isOutside = Math.abs(hit.dot.x - band.centerX) > band.halfWidth;
					const color = isOutside ? 'var(--bad)' : (lane?.color ?? 'var(--text)');
					const radius = (isNext ? 5 : 4) + (isHovered ? 1.5 : 0);
					return (
						<g key={`dot-${hit.laneId}-${hit.hitId}`}>
							{isNext ? (
								<circle
									className="mm-dot-pulse"
									cx={position.x}
									cy={position.y}
									r={5}
									fill="none"
									stroke={color}
									strokeWidth={1.5}
									style={{ transformOrigin: `${position.x}px ${position.y}px` }}
								/>
							) : null}
							{isFocused ? <circle cx={position.x} cy={position.y} r={radius + 4} fill="none" stroke="var(--accent-strong)" strokeWidth={2} /> : null}
							<circle
								cx={position.x}
								cy={position.y}
								r={radius}
								fill={isNext ? color : 'var(--canvas)'}
								stroke={isNext ? 'var(--canvas)' : color}
								strokeWidth={isNext ? 1.5 : 1.5}
							/>
							{isNext ? <circle cx={position.x} cy={position.y} r={radius + 0.75} fill="none" stroke={color} strokeWidth={1} /> : null}
						</g>
					);
				})}
				{is2d
					? project.entities.map((entity) => {
							const { release, marble } = entity.components;
							if (release == null || marble == null) return null;
							const position = drag?.kind === 'release' && drag.entityId === entity.id ? drag.position : release.position;
							const center = compose.toScreen(position);
							const isActive = (hover?.kind === 'release' && hover.entityId === entity.id) || (drag?.kind === 'release' && drag.entityId === entity.id);
							const radius = Math.max(9, marble.radius * camera.view.scale + 5);
							return (
								<g key={`release-${entity.id}`}>
									<circle
										cx={center.x}
										cy={center.y}
										r={radius}
										fill="none"
										stroke={marble.color}
										strokeWidth={isActive ? 2 : 1.5}
										strokeDasharray={isActive ? undefined : '3 2.5'}
									/>
									<path
										d={`M ${center.x} ${center.y - radius - 7} L ${center.x} ${center.y - radius - 1.5} M ${center.x - 3} ${center.y - radius - 4.5} L ${center.x} ${center.y - radius - 1.5} L ${center.x + 3} ${center.y - radius - 4.5}`}
										fill="none"
										stroke={marble.color}
										strokeWidth={1.5}
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
								</g>
							);
						})
					: null}
				{grip != null ? (
					<g>
						{showArc ? (
							<>
								<circle
									cx={grip.pivot.x}
									cy={grip.pivot.y}
									r={Math.hypot(grip.grip.x - grip.pivot.x, grip.grip.y - grip.pivot.y)}
									fill="none"
									stroke="var(--accent-strong)"
									strokeWidth={1}
									strokeDasharray="2 3"
									strokeOpacity={0.8}
								/>
								<circle cx={grip.pivot.x} cy={grip.pivot.y} r={2.5} fill="var(--accent-strong)" />
							</>
						) : null}
						<line x1={grip.pivot.x} y1={grip.pivot.y} x2={grip.grip.x} y2={grip.grip.y} stroke="var(--accent-strong)" strokeWidth={1} strokeOpacity={showArc ? 0.6 : 0} />
						<circle cx={grip.grip.x} cy={grip.grip.y} r={5} fill="white" stroke="var(--accent-strong)" strokeWidth={1.5} />
					</g>
				) : null}
				{drag?.kind === 'marquee' ? <Marquee from={drag.from} to={drag.to} /> : null}
			</svg>
			{hoveredDot != null && drag == null ? <DotTooltip compose={compose} project={project} hit={hoveredDot} /> : null}
			{single != null && grip != null ? (
				<AngleReadout
					compose={compose}
					piece={single}
					position={drag?.kind === 'rotate' ? { x: drag.pointer.x + 14, y: drag.pointer.y + 14 } : { x: grip.grip.x + 10, y: grip.grip.y + 8 }}
					angle={drag?.kind === 'rotate' ? drag.angle : (project.entities.find((entity) => entity.id === single.entityId)?.components.hitLink?.angle ?? single.angle)}
				/>
			) : null}
		</>
	);
};

/** Moves a convex outline outward by `distance` pixels so selection strokes clear the shape */
function inflate(corners: TVec2[], distance: number): TVec2[] {
	const center = {
		x: corners.reduce((sum, corner) => sum + corner.x, 0) / corners.length,
		y: corners.reduce((sum, corner) => sum + corner.y, 0) / corners.length
	};
	return corners.map((corner, index) => {
		const previous = corners[(index + corners.length - 1) % corners.length] ?? corner;
		const next = corners[(index + 1) % corners.length] ?? corner;
		// Offset along both adjacent edge normals, pointing away from the centre
		const offset = { x: 0, y: 0 };
		for (const [a, b] of [
			[previous, corner],
			[corner, next]
		] as const) {
			const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
			let normal = { x: (b.y - a.y) / length, y: -(b.x - a.x) / length };
			const mid = { x: (a.x + b.x) / 2 - center.x, y: (a.y + b.y) / 2 - center.y };
			if (normal.x * mid.x + normal.y * mid.y < 0) normal = { x: -normal.x, y: -normal.y };
			offset.x += normal.x * distance;
			offset.y += normal.y * distance;
		}
		return { x: corner.x + offset.x, y: corner.y + offset.y };
	});
}

const Marquee: React.FC<{ from: TVec2; to: TVec2 }> = (props) => {
	const { from, to } = props;
	return (
		<rect
			x={Math.min(from.x, to.x)}
			y={Math.min(from.y, to.y)}
			width={Math.abs(from.x - to.x)}
			height={Math.abs(from.y - to.y)}
			fill="color-mix(in srgb, var(--accent) 10%, transparent)"
			stroke="var(--accent-strong)"
			strokeWidth={1}
		/>
	);
};

/** Status badge at the left end of a placed piece */
const PieceBadge: React.FC<{ compose: ComposeCx; piece: TResolvedPiece; result: TSimulationResult }> = (props) => {
	const { compose, piece, result } = props;
	const status = badgeStatus(piece.status, result.hits.find((item) => item.pieceEntityId === piece.entityId));
	if (status == null) return null;
	const [a, b, c, d] = compose.screenCorners(piece);
	if (a == null || b == null || c == null || d == null) return null;
	// Midpoints of both short ends; the badge sits off the end further left on screen
	const [end, other] = [
		{ x: (a.x + d.x) / 2, y: (a.y + d.y) / 2 },
		{ x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 }
	].sort((first, second) => first.x - second.x);
	if (end == null || other == null) return null;
	const length = Math.hypot(end.x - other.x, end.y - other.y) || 1;
	const x = end.x + ((end.x - other.x) / length) * 10;
	const y = end.y + ((end.y - other.y) / length) * 10;
	return (
		<g transform={`translate(${x} ${y})`} opacity={status === 'onTime' ? 0.85 : 1}>
			<StatusBadge status={status} />
		</g>
	);
};

const DotTooltip: React.FC<{ compose: ComposeCx; project: TProject; hit: THitResult }> = (props) => {
	const { compose, project, hit } = props;
	if (hit.dot == null) return null;
	const position = compose.toScreen(hit.dot);
	const lane = project.music.lanes.find((item) => item.id === hit.laneId);
	const index = lane?.hits.findIndex((item) => item.id === hit.hitId) ?? -1;
	const pitch = lane?.hits[index]?.pitch;
	const band = frameBand(project);
	const isOutside = Math.abs(hit.dot.x - band.centerX) > band.halfWidth;
	return (
		<div
			className="pointer-events-none absolute z-10 rounded-[6px] bg-[var(--content-raised)] px-2 py-1 text-[11px] leading-[15px] whitespace-nowrap"
			style={{ left: position.x + 12, top: position.y - 34, boxShadow: 'var(--shadow-popover)' }}
		>
			<div className="font-medium">
				{lane?.name ?? 'Hit'} · Hit {index + 1}
				<span className="mm-mono ml-1.5 font-normal text-[var(--text-secondary)]">
					{formatTime(hit.targetTime)}
					{pitch != null ? ` · ${noteName(pitch)}` : ''}
				</span>
			</div>
			<div className={isOutside ? 'text-[var(--bad)]' : 'text-[var(--text-secondary)]'}>
				{isOutside ? 'Outside the frame · click to place anyway' : 'Click to place a platform'}
			</div>
		</div>
	);
};

/** Live angle next to the grip or the pointer. Double-click to type an exact angle. */
const AngleReadout: React.FC<{ compose: ComposeCx; piece: TResolvedPiece; position: TVec2; angle: number }> = (props) => {
	const { compose, piece, position, angle } = props;
	const editing = useFeatureState(compose.$editingAngle) === piece.entityId;
	const [draft, setDraft] = React.useState('');

	function commit(): void {
		const value = parseDegrees(draft);
		const project = compose.project;
		compose.$editingAngle.set(null);
		if (value == null || project == null) return;
		compose.studio.execute(pieceAngleCommands(project, new Map([[piece.entityId, value]])));
	}

	return (
		<div className="absolute z-10" style={{ left: position.x, top: position.y }}>
			{editing ? (
				<input
					autoFocus
					className="mm-mono h-[18px] w-[56px] rounded-[4px] border-0 bg-[var(--content-raised)] px-1 text-[11px] outline-none"
					style={{ boxShadow: '0 0 0 1.5px var(--accent-strong)' }}
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					onBlur={commit}
					onKeyDown={(event) => {
						event.stopPropagation();
						if (event.key === 'Enter') event.currentTarget.blur();
						if (event.key === 'Escape') compose.$editingAngle.set(null);
					}}
				/>
			) : (
				<button
					className="mm-mono rounded-[4px] bg-[var(--accent)] px-1 text-[11px] leading-[16px] text-[var(--on-accent)]"
					title="Double-click to type an angle"
					onDoubleClick={() => {
						setDraft(formatDegrees(angle).replace('°', ''));
						compose.$editingAngle.set(piece.entityId);
					}}
					type="button"
				>
					{formatDegrees(angle)}
				</button>
			)}
		</div>
	);
};

// MARK: - Canvas chrome

const CornerControls: React.FC<{ compose: ComposeCx }> = (props) => {
	const { compose } = props;
	const camera = useFeatureState(compose.$camera);
	// 100% shows the wall at physical size on a 96 dpi screen
	const zoom = Math.round((camera.view.scale / 3779.5) * 100);
	return (
		<div className="mm-floating mm-tooltip-below absolute top-3 right-3 z-20 flex items-center gap-0.5 p-[3px]">
			<div className="flex" role="radiogroup" aria-label="View">
				<button
					className="mm-tool-button !h-7 !w-7"
					data-active={camera.mode === '2d'}
					aria-label="2D wall view"
					onClick={() => compose.setMode('2d')}
					type="button"
				>
					<Square size={14} strokeWidth={1.7} />
					<span className="mm-tooltip">Wall view</span>
				</button>
				<button
					className="mm-tool-button !h-7 !w-7"
					data-active={camera.mode === 'orbit'}
					aria-label="Orbit view"
					onClick={() => compose.setMode('orbit')}
					type="button"
				>
					<Box size={14} strokeWidth={1.7} />
					<span className="mm-tooltip">Orbit · middle mouse</span>
				</button>
			</div>
			<div className="mx-0.5 h-4 w-px bg-[var(--separator)]" />
			<button className="mm-tool-button mm-mono !h-7 !w-auto px-1.5 text-[11px]" onClick={() => compose.fitAll()} type="button">
				{zoom}%<span className="mm-tooltip">Zoom to fit ⇧1</span>
			</button>
		</div>
	);
};

/** Shows that the run is being re-simulated, fading in only when it takes long enough to notice */
const SimulatingIndicator: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const computing = useFeatureState(cx.simulation.$computing);
	if (!computing) return null;
	return (
		<div className="mm-floating mm-delayed-fade absolute top-3 left-3 z-20 px-2.5 py-1 text-[11px] text-[var(--text-secondary)]" role="status">
			Simulating…
		</div>
	);
};
