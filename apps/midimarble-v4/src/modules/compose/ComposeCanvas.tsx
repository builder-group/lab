import { useFeatureState } from 'feature-react/state';
import { Box, Square } from 'lucide-react';
import React from 'react';
import { openContextMenu } from '@/components';
import type { TProject, TVec2 } from '@/modules/project';
import { frameBand, getPieceDefinition, type THitResult, type TResolvedPiece, type TSimulationResult } from '@/modules/simulation';
import { formatTime, noteName } from '@/modules/studio/format';
import { laneMenu, pieceMenu } from '@/modules/studio/menus';
import { parseHitKey } from '@/modules/studio/selection';
import type { StudioCx } from '@/modules/studio/StudioCx';
import { formatDegrees, parseDegrees, toDegrees } from './angles';
import { ComposeCx } from './ComposeCx';
import { paletteOf } from './ComposeRenderer';
import { ComposeToolbar } from './ComposeToolbar';
import { GhostHint, GhostShapes } from './GhostLayer';
import { canvasMenu, dotMenu } from './menus';
import { PieceLayer, toPoints } from './PieceLayer';
import { pathRun, pathToWorld, pieceKind } from './scene';
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
	const isMoving = drag?.kind === 'release' || drag?.kind === 'path' || hover?.kind === 'release' || hover?.kind === 'pathEnd' || hover?.kind === 'pathBend';
	const cursor =
		isPanning ? 'grabbing'
		: spaceHeld || tool === 'hand' ? 'grab'
		: drag?.kind === 'rotate' || hover?.kind === 'rotate' ? 'grab'
		: isMoving ? 'move'
		: hover?.kind === 'dot' || hover?.kind === 'track' || tool === 'piece' ? 'crosshair'
		: 'default';

	return (
		<div ref={containerRef} className="mm-pegboard relative h-full w-full overflow-hidden">
			<canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
			<svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
				<PieceLayer compose={compose} />
				<GhostShapes compose={compose} />
			</svg>
			<div
				className="absolute inset-0 touch-none"
				style={{ cursor }}
				onPointerDown={(event) => compose.onPointerDown(event)}
				onPointerMove={(event) => compose.onPointerMove(event)}
				onPointerUp={(event) => compose.onPointerUp(event)}
				onPointerCancel={(event) => compose.onPointerUp(event)}
				onPointerLeave={() => compose.onPointerLeave()}
				onContextMenu={(event) => openCanvasMenu(compose, event)}
			/>
			<ComposeOverlay compose={compose} />
			<GhostHint compose={compose} />
			<CornerControls compose={compose} />
			<SimulatingIndicator cx={cx} />
			<EmptyState compose={compose} />
			<ComposeToolbar compose={compose} />
		</div>
	);
};

interface TComposeCanvasProps {
	cx: StudioCx;
}

/** Right-click opens the menu for what is under the pointer, selecting it first like Finder */
function openCanvasMenu(compose: ComposeCx, event: React.MouseEvent<HTMLElement>): void {
	const cx = compose.studio;
	const rect = event.currentTarget.getBoundingClientRect();
	const target = compose.pickAt({ x: event.clientX - rect.left, y: event.clientY - rect.top });
	switch (target?.kind) {
		case 'piece':
		case 'rotate':
		case 'pathEnd':
		case 'pathBend':
			if (!cx.$selection.get().includes(target.entityId)) cx.$selection.set([target.entityId]);
			openContextMenu(event, pieceMenu(cx));
			return;
		case 'dot':
			openContextMenu(event, dotMenu(compose, target.laneId, target.hitId));
			return;
		case 'release': {
			const laneId = compose.project?.entities.find((entity) => entity.id === target.entityId)?.components.marble?.laneId;
			const lane = compose.project?.music.lanes.find((item) => item.id === laneId);
			cx.$selection.set([target.entityId]);
			if (lane != null) openContextMenu(event, laneMenu(cx, lane));
			return;
		}
		default:
			openContextMenu(event, canvasMenu(compose));
	}
}

/** First-run guidance: what to do with no hits, then how to place the first piece */
const EmptyState: React.FC<{ compose: ComposeCx }> = (props) => {
	const { compose } = props;
	const cx = compose.studio;
	const project = useFeatureState(cx.$history)?.present;
	const notice = useFeatureState(cx.$notice);
	const playing = useFeatureState(cx.$playing);
	const isImporting = useFeatureState(cx.sources.$midiImport) != null;
	if (project == null || isImporting) return null;
	const hasHits = project.music.lanes.some((lane) => lane.hits.length > 0);
	const hasPieces = project.entities.some((entity) => entity.components.piece != null);

	if (!hasHits) {
		return (
			<div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center pb-16">
				<div className="mm-floating pointer-events-auto flex w-[300px] flex-col items-center gap-1 px-5 py-4 text-center">
					<span className="mm-placeholder-title">Add Hits to Start</span>
					<span className="mm-placeholder-body text-[var(--text-secondary)]">
						Each hit is a moment the marble strikes a piece. Import music, or double-click a lane in the timeline.
					</span>
					<div className="mt-2 flex gap-2">
						<button className="mm-button" data-variant="primary" onClick={() => void cx.sources.pickMidi()} type="button">
							Import MIDI…
						</button>
						<button className="mm-button" onClick={() => void cx.sources.pickAudio()} type="button">
							Import Audio…
						</button>
					</div>
				</div>
			</div>
		);
	}
	if (hasPieces || notice != null || playing) return null;
	return (
		<div className="mm-floating pointer-events-none absolute bottom-[64px] left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 px-3 py-1.5 text-[11px] whitespace-nowrap">
			Click the pulsing dot or press <kbd className="mm-keycap">N</kbd> to place the first platform
		</div>
	);
};

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
	const gapMenu = useFeatureState(compose.$gapMenu);
	const tool = useFeatureState(compose.$tool);
	const pieceType = useFeatureState(compose.$pieceType);
	const project = history?.present;
	if (project == null || result == null || viewport.width <= 1) return null;

	const is2d = camera.mode === '2d';
	const selectedPieces = selectedPieceIds(project, selection);
	const single = selectedPieces.length === 1 ? result.pieces.find((piece) => piece.entityId === selectedPieces[0]) : undefined;
	const singleKind = single != null ? pieceKind(single) : null;
	const isPathPiece = singleKind === 'path' || singleKind === 'tube';
	const grip = single?.contactPoint != null && is2d && !isPathPiece ? compose.screenGrip(single) : null;
	const pathHandles = single != null && is2d && isPathPiece ? compose.screenPathHandles(single) : null;
	const isRotating = drag?.kind === 'rotate';
	const showArc = grip != null && (isRotating || (hover?.kind === 'rotate' && hover.entityId === single?.entityId));
	const nextDots = nextOpenHitPerLane(result);
	const band = frameBand(project);
	const hoveredPiece = hover?.kind === 'piece' ? hover.entityId : null;
	const hoveredDot =
		hover?.kind === 'dot' ? result.hits.find((hit) => hit.status === 'open' && hit.laneId === hover.laneId && hit.hitId === hover.hitId) : undefined;
	const focusedKeys = new Set(selection.filter((key) => parseHitKey(key) != null));
	const longGaps = compose.longGapKeys(project);
	const gapHit = gapMenu != null ? result.hits.find((hit) => hit.status === 'open' && hit.laneId === gapMenu.laneId && hit.hitId === gapMenu.hitId) : undefined;
	const placementLabel = getPieceDefinition(tool === 'piece' ? pieceType : 'platform')?.label.toLowerCase() ?? 'platform';

	return (
		<>
			<svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
				{result.pieces.map((piece) => {
					const isSelected = selection.includes(piece.entityId);
					const isHovered = hoveredPiece === piece.entityId && !isSelected;
					if (!isSelected && !isHovered) return null;
					const outline = pieceKind(piece) === 'box' ? inflate(compose.screenOutline(piece), 2.5) : compose.screenOutline(piece);
					return (
						<polygon
							key={`outline-${piece.entityId}`}
							points={toPoints(outline)}
							fill="none"
							stroke="var(--accent-strong)"
							strokeWidth={isSelected ? 1.75 : 1.25}
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
					const isHovered = hoveredDot === hit || gapHit === hit;
					const isFocused = focusedKeys.has(`hit:${hit.laneId}:${hit.hitId}`);
					const isOutside = hit.outOfFrame ?? Math.abs(hit.dot.x - band.centerX) > band.halfWidth;
					const isLongGap = longGaps.has(`${hit.laneId}:${hit.hitId}`);
					const color = isOutside ? 'var(--bad)' : (lane?.color ?? 'var(--text)');
					return (
						<HitDot
							key={`dot-${hit.laneId}-${hit.hitId}`}
							position={position}
							color={color}
							isNext={isNext}
							isHovered={isHovered}
							isFocused={isFocused}
							isLongGap={isLongGap}
						/>
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
				{pathHandles != null && single != null ? <PathHandles handles={pathHandles} hover={hover} drag={drag} entityId={single.entityId} /> : null}
				{hover?.kind === 'track' && drag == null ? (
					<circle cx={hover.position.x} cy={hover.position.y} r={4.5} fill="var(--canvas)" stroke={paletteOf(pieceType).bar} strokeWidth={2} />
				) : null}
				{drag?.kind === 'marquee' ? <Marquee from={drag.from} to={drag.to} /> : null}
			</svg>
			{hoveredDot != null && drag == null && gapHit !== hoveredDot ? (
				<DotTooltip compose={compose} project={project} hit={hoveredDot} placementLabel={placementLabel} />
			) : null}
			{gapHit != null && drag == null ? <GapMenu compose={compose} project={project} hit={gapHit} /> : null}
			{hover?.kind === 'track' && drag == null ? (
				<CanvasTooltip position={hover.position}>
					<div className="font-medium">
						Start a {placementLabel} here
						<span className="mm-tabular ml-1.5 font-normal text-[var(--text-secondary)]">{formatTime(hover.time)}</span>
					</div>
					<div className="text-[var(--text-secondary)]">The marble enters it at this moment</div>
				</CanvasTooltip>
			) : null}
			{single != null && grip != null ? (
				<AngleReadout
					compose={compose}
					piece={single}
					position={drag?.kind === 'rotate' ? { x: drag.pointer.x + 14, y: drag.pointer.y + 14 } : { x: grip.grip.x + 10, y: grip.grip.y + 8 }}
					angle={drag?.kind === 'rotate' ? drag.angle : (project.entities.find((entity) => entity.id === single.entityId)?.components.hitLink?.angle ?? single.angle)}
				/>
			) : null}
			{drag?.kind === 'path' && pathHandles != null && single != null ? <PathReadout piece={single} points={drag.points} position={pathHandles.end} /> : null}
		</>
	);
};

/** An open hit dot. Long gaps get a diamond with a dashed ring; dots outside the frame are red. */
const HitDot: React.FC<{ position: TVec2; color: string; isNext: boolean; isHovered: boolean; isFocused: boolean; isLongGap: boolean }> = (props) => {
	const { position, color, isNext, isHovered, isFocused, isLongGap } = props;
	const radius = (isNext ? 5 : 4) + (isHovered ? 1.5 : 0);
	const { x, y } = position;
	return (
		<g>
			{isNext ? (
				<circle className="mm-dot-pulse" cx={x} cy={y} r={5} fill="none" stroke={color} strokeWidth={1.5} style={{ transformOrigin: `${x}px ${y}px` }} />
			) : null}
			{isFocused ? <circle cx={x} cy={y} r={radius + 4} fill="none" stroke="var(--accent-strong)" strokeWidth={2} /> : null}
			{isLongGap ? (
				<>
					<circle cx={x} cy={y} r={radius + 5} fill="none" stroke={color} strokeWidth={1.25} strokeDasharray="2.5 2.5" />
					<rect
						x={x - radius}
						y={y - radius}
						width={radius * 2}
						height={radius * 2}
						rx={1.5}
						transform={`rotate(45 ${x} ${y})`}
						fill={isNext ? color : 'var(--canvas)'}
						stroke={isNext ? 'var(--canvas)' : color}
						strokeWidth={1.5}
					/>
				</>
			) : (
				<circle cx={x} cy={y} r={radius} fill={isNext ? color : 'var(--canvas)'} stroke={isNext ? 'var(--canvas)' : color} strokeWidth={1.5} />
			)}
			{isNext && !isLongGap ? <circle cx={x} cy={y} r={radius + 0.75} fill="none" stroke={color} strokeWidth={1} /> : null}
		</g>
	);
};

/** End and bend handles of a selected rail or tunnel, joined by a dashed control line like Blender curves */
const PathHandles: React.FC<{
	handles: { end: TVec2; bend: TVec2; entry: TVec2 };
	hover: ReturnType<ComposeCx['$hover']['get']>;
	drag: ReturnType<ComposeCx['$drag']['get']>;
	entityId: string;
}> = (props) => {
	const { handles, hover, drag, entityId } = props;
	const { end, bend, entry } = handles;
	const isActive = (kind: 'pathEnd' | 'pathBend'): boolean =>
		(hover?.kind === kind && hover.entityId === entityId) ||
		(drag?.kind === 'path' && drag.entityId === entityId && drag.handle === (kind === 'pathEnd' ? 'end' : 'bend'));
	return (
		<g>
			<polyline points={toPoints([entry, bend, end])} fill="none" stroke="var(--accent-strong)" strokeWidth={1} strokeDasharray="2 3" strokeOpacity={0.8} />
			<circle cx={entry.x} cy={entry.y} r={2.5} fill="var(--accent-strong)" />
			<rect
				x={bend.x - 4}
				y={bend.y - 4}
				width={8}
				height={8}
				rx={1.5}
				transform={`rotate(45 ${bend.x} ${bend.y})`}
				fill={isActive('pathBend') ? 'var(--accent)' : 'white'}
				stroke="var(--accent-strong)"
				strokeWidth={1.5}
			/>
			<circle cx={end.x} cy={end.y} r={5} fill={isActive('pathEnd') ? 'var(--accent)' : 'white'} stroke="var(--accent-strong)" strokeWidth={1.5} />
		</g>
	);
};

/** Live length and slope next to the dragged handle */
const PathReadout: React.FC<{ piece: TResolvedPiece; points: TVec2[]; position: TVec2 }> = (props) => {
	const { piece, points, position } = props;
	const run = pathRun(points);
	const end = points[points.length - 1] ?? { x: 1, y: 0 };
	const tip = pathToWorld(piece, points, end);
	const entry = pathToWorld(piece, points, { x: 0, y: 0 });
	const slope = toDegrees(Math.atan2(entry.y - tip.y, Math.abs(tip.x - entry.x)));
	return (
		<div className="absolute z-10" style={{ left: position.x + 12, top: position.y + 10 }}>
			<span className="mm-tabular rounded-[4px] bg-[var(--accent)] px-1 text-[11px] leading-[16px] text-[var(--on-accent)]">
				{(run.length * 100).toFixed(1)} cm · {slope >= 0 ? '↘' : '↗'} {Math.abs(slope).toFixed(1)}°
			</span>
		</div>
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

/** Status badge off the left end of a placed piece */
const PieceBadge: React.FC<{ compose: ComposeCx; piece: TResolvedPiece; result: TSimulationResult }> = (props) => {
	const { compose, piece, result } = props;
	const status = badgeStatus(piece.status, result.hits.find((item) => item.pieceEntityId === piece.entityId));
	if (status == null) return null;
	const outline = compose.screenOutline(piece);
	if (!outline.length) return null;
	const left = outline.reduce((best, point) => (point.x < best.x ? point : best));
	const center = {
		x: outline.reduce((sum, point) => sum + point.x, 0) / outline.length,
		y: outline.reduce((sum, point) => sum + point.y, 0) / outline.length
	};
	const length = Math.hypot(left.x - center.x, left.y - center.y) || 1;
	const x = left.x + ((left.x - center.x) / length) * 10;
	const y = left.y + ((left.y - center.y) / length) * 10;
	return (
		<g transform={`translate(${x} ${y})`} opacity={status === 'onTime' ? 0.85 : 1}>
			<StatusBadge status={status} />
		</g>
	);
};

const CanvasTooltip: React.FC<{ position: TVec2; interactive?: boolean; children: React.ReactNode }> = (props) => {
	const { position, interactive = false, children } = props;
	return (
		<div
			className={`absolute z-10 rounded-[6px] bg-[var(--content-raised)] px-2 py-1 text-[11px] leading-[15px] whitespace-nowrap ${interactive ? '' : 'pointer-events-none'}`}
			style={{ left: position.x + 12, top: position.y - 34, boxShadow: 'var(--shadow-popover)' }}
		>
			{children}
		</div>
	);
};

const DotTooltip: React.FC<{ compose: ComposeCx; project: TProject; hit: THitResult; placementLabel: string }> = (props) => {
	const { compose, project, hit, placementLabel } = props;
	if (hit.dot == null) return null;
	const position = compose.toScreen(hit.dot);
	const lane = project.music.lanes.find((item) => item.id === hit.laneId);
	const index = lane?.hits.findIndex((item) => item.id === hit.hitId) ?? -1;
	const pitch = lane?.hits[index]?.pitch;
	const band = frameBand(project);
	const overshoot = Math.abs(hit.dot.x - band.centerX) - band.halfWidth;
	const isOutside = hit.outOfFrame ?? overshoot > 0;
	const side = hit.dot.x > band.centerX ? 'right' : 'left';
	return (
		<CanvasTooltip position={position}>
			<div className="font-medium">
				{lane?.name ?? 'Hit'} · Hit {index + 1}
				<span className="mm-tabular ml-1.5 font-normal text-[var(--text-secondary)]">
					{formatTime(hit.targetTime)}
					{pitch != null ? ` · ${noteName(pitch)}` : ''}
				</span>
			</div>
			{isOutside ? (
				<>
					<div className="text-[var(--bad)]">
						{overshoot > 0 ? `${(overshoot * 100).toFixed(1)} cm past the ${side} frame edge` : 'Outside the frame'} at this time
					</div>
					<div className="text-[var(--text-secondary)]">Turn the piece before it or press A · click to place anyway</div>
				</>
			) : (
				<div className="text-[var(--text-secondary)]">Click to place a {placementLabel}</div>
			)}
		</CanvasTooltip>
	);
};

/** Guardrail for a long gap: the hit is too far after the previous one for a bounce, so offer a bridge */
const GapMenu: React.FC<{ compose: ComposeCx; project: TProject; hit: THitResult }> = (props) => {
	const { compose, project, hit } = props;
	if (hit.dot == null) return null;
	const gap = compose.longGapKeys(project).get(`${hit.laneId}:${hit.hitId}`);
	if (gap == null) return null;
	const position = compose.toScreen(hit.dot);
	const lane = project.music.lanes.find((item) => item.id === hit.laneId);
	const index = lane?.hits.findIndex((item) => item.id === hit.hitId) ?? -1;
	const add = (type: 'rail' | 'tunnel'): void => {
		compose.$gapMenu.set(null);
		compose.assist.suggestGapPiece(type, hit.laneId, gap.fromHitId, hit.hitId, { accept: true });
	};
	return (
		<div
			className="absolute z-10 flex flex-col gap-1 rounded-[8px] bg-[var(--content-raised)] p-1.5 text-[11px] leading-[15px] whitespace-nowrap"
			style={{ left: position.x + 12, top: position.y - 70, boxShadow: 'var(--shadow-popover)' }}
			onPointerLeave={() => compose.$gapMenu.set(null)}
		>
			<div className="px-1 font-medium">
				{lane?.name ?? 'Hit'} · Hit {index + 1}
				<span className="ml-1.5 font-normal text-[var(--warn)]">{gap.duration.toFixed(1)} s gap</span>
			</div>
			<div className="px-1 text-[var(--text-secondary)]">Too long for one bounce. Bridge it, or click the dot for a platform.</div>
			<div className="flex gap-1">
				<GapButton type="rail" label="Add Rail" onClick={() => add('rail')} />
				<GapButton type="tunnel" label="Add Tunnel" onClick={() => add('tunnel')} />
			</div>
		</div>
	);
};

const GapButton: React.FC<{ type: string; label: string; onClick: () => void }> = (props) => {
	const { type, label, onClick } = props;
	return (
		<button
			className="flex h-[22px] items-center gap-1.5 rounded-[5px] bg-[var(--control)] px-2 font-medium hover:bg-[var(--hover)]"
			style={{ boxShadow: 'inset 0 0 0 0.5px var(--control-border)' }}
			onClick={onClick}
			type="button"
		>
			<span className="inline-block h-2 w-2 rounded-full" style={{ background: paletteOf(type).bar }} />
			{label}
		</button>
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
					className="mm-tabular h-[18px] w-[56px] rounded-[4px] border-0 bg-[var(--content-raised)] px-1 text-[11px] outline-none"
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
					className="mm-tabular rounded-[4px] bg-[var(--accent)] px-1 text-[11px] leading-[16px] text-[var(--on-accent)]"
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
			<button className="mm-tool-button mm-tabular !h-7 !w-auto px-1.5 text-[11px]" onClick={() => compose.fitAll()} type="button">
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
