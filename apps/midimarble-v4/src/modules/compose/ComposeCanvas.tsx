import { useFeatureState } from 'feature-react/state';
import { createState } from 'feature-state';
import { Anchor, ChevronsRight, Link2, LocateFixed, Magnet, Unlink2 } from 'lucide-react';
import React from 'react';
import { openContextMenu } from '@/components';
import type { TPathNode, TProject, TVec2 } from '@/modules/project';
import { frameBand, type THitResult, type TResolvedPiece, type TSimulationResult } from '@/modules/simulation';
import { formatTime, noteName } from '@/modules/studio/format';
import { hitMenu, laneMenu, pieceMenu } from '@/modules/studio/menus';
import { parseHitKey, toHitKey } from '@/modules/studio/selection';
import type { StudioCx } from '@/modules/studio/StudioCx';
import { formatDegrees, parseDegrees, toDegrees } from './angles';
import type { TPose, TSnap } from './attach-edit';
import { mapNodes, nodesPathData } from './bezier';
import { ComposeCx, noteLabel, type TComposeDrag } from './ComposeCx';
import { paletteOf } from './ComposeRenderer';
import { timingStatus } from './timing-status';
import { acceptableCount } from './ghosts';
import { followKey } from './keys';
import { GhostHint, GhostShapes } from './GhostLayer';
import { PatternGhost } from './PatternInspector';
import { HitFlashLayer } from './HitFlashLayer';
import { canvasMenu, dotMenu } from './menus';
import { PieceLayer, projectedOutline, toPoints, usePannedProjection, type TScreenProjection } from './PieceLayer';
import { placeBar, type TScreenRect } from './view';
import { pathRun, pathToWorld, pieceKind } from './scene';
import { badgeStatus, badgeStyles, StatusBadge } from './status';
import { findStepTarget, linkedPieces, nextOpenHitPerLane, pieceAngle, pieceAngleCommands, selectedPieceIds } from './step-loop';

/** The Compose wall: WebGL content over the CSS dot grid, with screen-space handles on top */
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
	const isMoving = drag?.kind === 'release' || drag?.kind === 'path' || drag?.kind === 'move' || drag?.kind === 'node';
	const isHandle = hover?.kind === 'release' || hover?.kind === 'pathEnd' || hover?.kind === 'pathBend' || hover?.kind === 'node' || hover?.kind === 'nodeIn' || hover?.kind === 'nodeOut';
	const cursor =
		isPanning ? 'grabbing'
		: spaceHeld || tool === 'hand' ? 'grab'
		: drag?.kind === 'rotate' || hover?.kind === 'rotate' ? 'grab'
		: isMoving ? 'grabbing'
		: isHandle ? 'move'
		: hover?.kind === 'dot' || hover?.kind === 'ghost' || hover?.kind === 'track' ? 'pointer'
		: tool !== 'select' ? 'crosshair'
		: 'default';

	return (
		<div ref={containerRef} className="mm-pegboard relative h-full w-full overflow-hidden">
			<canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
			<svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
				<PieceLayer compose={compose} />
				<GhostShapes compose={compose} />
				<PatternGhost compose={compose} />
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
			<PenOverlay compose={compose} />
			<GhostHint compose={compose} />
			<PlayNoteHint compose={compose} />
			<AssistBar compose={compose} />
			<CornerControls compose={compose} />
			<EmptyWall cx={cx} />
			<SimulatingIndicator cx={cx} />
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
		case 'node':
		case 'nodeIn':
		case 'nodeOut':
			if (!cx.$selection.get().includes(target.entityId)) cx.$selection.set([target.entityId]);
			openContextMenu(event, pieceMenu(cx));
			return;
		case 'dot': {
			const lane = compose.project?.music.lanes.find((item) => item.id === target.laneId);
			const hit = compose.result?.hits.find((item) => item.laneId === target.laneId && item.hitId === target.hitId);
			if (lane != null && hit != null && hit.status !== 'open') {
				cx.$selection.set([toHitKey(target.laneId, target.hitId)]);
				openContextMenu(event, hitMenu(cx, lane, target.hitId));
				return;
			}
			openContextMenu(event, dotMenu(compose, target.laneId, target.hitId));
			return;
		}
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

// MARK: - Empty wall

/**
 * The next step of a project with no song and no hits, at the bottom of the wall like GarageBand's empty project:
 * Import Song… as the obvious first step, and Add Marble when no marble is left.
 * It goes once the project has a song or a hit.
 */
const EmptyWall: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const history = useFeatureState(cx.$history);
	const project = history?.present;
	if (project == null || !isEmptyProject(project)) return null;
	const hasMarble = project.music.lanes.length > 0;
	return (
		<div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center px-4">
			<div className="mm-floating pointer-events-auto flex max-w-[460px] flex-col items-center gap-2 px-5 py-4 text-center" role="group" aria-label="Start the Project">
				<span className="text-[13px] font-semibold">{hasMarble ? 'No Song Yet' : 'No Marbles Yet'}</span>
				<span className="text-[12px] leading-snug text-[var(--text-secondary)]">
					{hasMarble ? 'Import a MIDI file for its notes, or a recording to tap along to.' : 'Add a marble, then import a song for it to play.'}
				</span>
				<div className="flex flex-wrap justify-center gap-2 pt-1">
					{!hasMarble ? (
						<button className="mm-button" data-variant="primary" onClick={() => cx.addMarble()} type="button">
							Add Marble
						</button>
					) : null}
					<button className="mm-button" data-variant={hasMarble ? 'primary' : undefined} onClick={() => void cx.importSong()} title="Import a MIDI file or a recording (⌘I)" type="button">
						Import Song…
					</button>
				</div>
			</div>
		</div>
	);
};

/** No song and no hit on any marble: the state of a new project */
export function isEmptyProject(project: TProject): boolean {
	return project.music.sources.length === 0 && project.music.lanes.every((lane) => lane.hits.length === 0);
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
	const tool = useFeatureState(compose.$tool);
	useFeatureState(compose.$override);
	const hidden = useFeatureState(cx.$hidden);
	const insertSnap = useFeatureState(compose.$insertSnap);
	const hoverPreview = useFeatureState(compose.$hoverPreview);
	const project = history?.present;
	const { projection, scale, transform } = usePannedProjection(compose);
	const nextDots = React.useMemo(() => (result != null ? nextOpenHitPerLane(result) : null), [result]);
	if (project == null || result == null || nextDots == null || viewport.width <= 1) return null;

	const pieces = compose.displayPieces(result);
	const selectedPieces = selectedPieceIds(project, selection);
	const single = selectedPieces.length === 1 ? pieces.find((piece) => piece.entityId === selectedPieces[0]) : undefined;
	const singleKind = single != null ? pieceKind(single) : null;
	const frame = single != null ? compose.railFrame(single.entityId) : null;
	const isPathPiece = singleKind === 'path' || singleKind === 'tube' || singleKind === 'generated';
	const isMoveDrag = drag?.kind === 'move' && drag.moved;
	// A Bowl always stands upright, so it has nothing to turn
	const grip = single != null && !isPathPiece && singleKind !== 'catcher' && !isMoveDrag ? compose.screenGrip(single) : null;
	const pathHandles = single != null && isPathPiece && frame == null && singleKind !== 'generated' ? compose.screenPathHandles(single) : null;
	const isRotating = drag?.kind === 'rotate';
	const showArc = grip != null && (isRotating || (hover?.kind === 'rotate' && hover.entityId === single?.entityId));
	const hoveredPiece = hover?.kind === 'piece' ? hover.entityId : null;
	const hoveredDot = hover?.kind === 'dot' ? result.hits.find((hit) => hit.laneId === hover.laneId && hit.hitId === hover.hitId) : undefined;
	const snap = drag?.kind === 'move' ? drag.snap : (insertSnap?.snap ?? null);
	const singleEntity = single != null ? project.entities.find((entity) => entity.id === single.entityId) : undefined;
	// The first-run hint "Click a note's dot to see its platform" points at the earliest next open dot
	const firstNext = [...nextDots.values()].filter((hit) => hit.dot != null).sort((a, b) => a.targetTime - b.targetTime)[0];
	const firstNextScreen = firstNext?.dot != null ? compose.toScreen(firstNext.dot) : null;
	const hintDot = firstNextScreen != null && firstNextScreen.x >= 0 && firstNextScreen.x <= viewport.width && firstNextScreen.y >= 0 && firstNextScreen.y <= viewport.height ? firstNextScreen : null;

	return (
		<>
			<svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
				{pieces.map((piece) => {
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
				<AgentTouched compose={compose} pieces={pieces} />
				<g transform={transform}>
					{drag == null ? <PieceBadges projection={projection} result={result} /> : null}
					<HitDots compose={compose} projection={projection} scale={scale} project={project} result={result} nextDots={nextDots} selection={selection} hoveredDot={hoveredDot} isDragging={drag != null} />
				</g>
				<HitFlashLayer compose={compose} />
				{snap?.kind === 'link' ? <SnapRing position={compose.toScreen(snap.dot)} /> : null}
				{drag?.kind === 'move' && drag.moved && drag.plays != null && drag.origin != null ? <PlaysGhost compose={compose} origin={drag.origin} dot={drag.plays.dot} /> : null}
				{project.entities.map((entity) => {
					const { release, marble } = entity.components;
					if (release == null || marble == null || hidden.includes(entity.id)) return null;
					const position = drag?.kind === 'release' && drag.entityId === entity.id ? drag.position : release.position;
					const center = compose.toScreen(position);
					const isSelected = selection.includes(entity.id);
					const isActive = isSelected || (hover?.kind === 'release' && hover.entityId === entity.id) || (drag?.kind === 'release' && drag.entityId === entity.id);
					const radius = Math.max(9, marble.radius * camera.view.scale + 5);
					return (
						<g key={`release-${entity.id}`}>
							{isSelected ? <circle cx={center.x} cy={center.y} r={radius + 3} fill="none" stroke="var(--accent-strong)" strokeWidth={1.75} /> : null}
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
				})}
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
				{frame != null && single != null ? <RailNodes compose={compose} entityId={single.entityId} frame={frame} hover={hover} drag={drag} /> : null}
				{hover?.kind === 'track' && drag == null ? (
					<circle cx={hover.position.x} cy={hover.position.y} r={4.5} fill="var(--canvas)" stroke={paletteOf('windmill').bar} strokeWidth={2} />
				) : null}
				{drag?.kind === 'marquee' ? <Marquee from={drag.from} to={drag.to} /> : null}
			</svg>
			{hoveredDot != null && drag == null && hoverPreview == null ? <DotTooltip compose={compose} project={project} hit={hoveredDot} /> : null}
			{hintDot != null && drag == null ? (
				<span data-hint-anchor="dot" className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2" style={{ left: hintDot.x, top: hintDot.y }} />
			) : null}
			{hover?.kind === 'track' && drag == null ? (
				<CanvasTooltip position={hover.position}>
					<span className="font-medium">Follows {project.music.lanes.find((lane) => lane.id === hover.laneId)?.name ?? 'Marble'}</span>
					<span className="mm-tabular ml-1 text-[var(--text-secondary)]">at {formatTime(hover.time)}</span>
					<WhatIfCount compose={compose} result={result} />
				</CanvasTooltip>
			) : null}
			{hoverPreview != null && hover?.kind !== 'track' && drag == null ? (
				<CanvasTooltip position={hoverPreview.position}>
					{hoverPreview.label != null ? <span className="font-medium">{hoverPreview.label}</span> : null}
					<WhatIfCount compose={compose} result={result} isFirst={hoverPreview.label == null} />
				</CanvasTooltip>
			) : null}
			{drag?.kind === 'move' && drag.moved ? (
				drag.plays != null && (drag.playsDrop === 'keeps' || (drag.playsDrop === 'frees' && drag.snap == null)) ? (
					<PlaysChip compose={compose} project={project} drag={drag} result={result} />
				) : (
					<SnapChip compose={compose} project={project} position={drag.current.position} snap={drag.snap} />
				)
			) : null}
			{insertSnap != null && drag == null ? <SnapChip compose={compose} project={project} position={insertSnap.position} snap={insertSnap.snap} /> : null}
			{single != null && grip != null && singleEntity != null ? (
				<AngleReadout
					compose={compose}
					piece={single}
					position={drag?.kind === 'rotate' ? { x: drag.pointer.x + 14, y: drag.pointer.y + 14 } : { x: grip.grip.x + 10, y: grip.grip.y + 8 }}
					angle={drag?.kind === 'rotate' ? drag.angle : (pieceAngle(singleEntity) ?? single.angle)}
				/>
			) : null}
			{drag?.kind === 'path' && pathHandles != null && single != null ? <PathReadout piece={single} points={drag.points} position={pathHandles.end} /> : null}
		</>
	);
};

/** An open hit dot. Long gaps get a diamond with a dashed ring; dots outside the frame are red. */
/**
 * Every hit's dot, where the marble is at the hit's time: a solid dot with its small outline ring. Open dots take the
 * marble's colour, on-time dots are green at the same size, and a hit that needs attention is a little larger, amber or
 * red. The next open dot and every dot that needs attention pulse, in CSS alone. Selecting the hit adds the accent ring.
 */
const HitDot = React.memo(function HitDot(props: { x: number; y: number; color: string; size: number; isPulsing: boolean; isHovered: boolean; isFocused: boolean; isLongGap?: boolean }) {
	const { x, y, color, size, isPulsing, isHovered, isFocused, isLongGap = false } = props;
	const radius = size + (isHovered ? 1.5 : 0);
	return (
		<g>
			{isPulsing ? <circle className="mm-dot-pulse" cx={x} cy={y} r={size} fill="none" stroke={color} strokeWidth={1.5} style={{ transformOrigin: `${x}px ${y}px` }} /> : null}
			{isFocused ? <circle cx={x} cy={y} r={radius + 4} fill="none" stroke="var(--accent-strong)" strokeWidth={2} /> : null}
			{isLongGap ? (
				<>
					<circle cx={x} cy={y} r={radius + 5} fill="none" stroke={color} strokeWidth={1.25} strokeDasharray="2.5 2.5" />
					<rect x={x - radius} y={y - radius} width={radius * 2} height={radius * 2} rx={1.5} transform={`rotate(45 ${x} ${y})`} fill={color} stroke="var(--canvas)" strokeWidth={1.5} />
				</>
			) : (
				<>
					<circle cx={x} cy={y} r={radius} fill={color} stroke="var(--canvas)" strokeWidth={1.5} />
					<circle cx={x} cy={y} r={radius + 0.75} fill="none" stroke={color} strokeWidth={1} />
				</>
			)}
		</g>
	);
});

// Pixels per metre below which a default platform is under about 16 px, not much wider than an on-time dot
const ON_TIME_DOT_MIN_SCALE = 180;

/** Every hit's dot, redrawn when the run, the selection, the hovered dot or the zoom changes and not when the view pans */
const HitDots = React.memo(function HitDots(props: { compose: ComposeCx; projection: TScreenProjection; scale: number; project: TProject; result: TSimulationResult; nextDots: Map<string, THitResult>; selection: string[]; hoveredDot: THitResult | undefined; isDragging: boolean }) {
	const { compose, projection, scale, project, result, nextDots, selection, hoveredDot, isDragging } = props;
	const band = frameBand(project);
	const longGaps = compose.longGapKeys(project);
	const focusedKeys = new Set(selection.filter((key) => parseHitKey(key) != null));
	return (
		<>
			{result.hits.map((hit) => {
				if (hit.dot == null) return null;
				const { x, y } = projection.toScreen(hit.dot);
				if (hit.status !== 'open') {
					// Zoomed far out a dot is wider than its platform, so on-time ones step aside for the track
					const isFocused = focusedKeys.has(toHitKey(hit.laneId, hit.hitId));
					if (hit.status === 'onTime' && scale < ON_TIME_DOT_MIN_SCALE && !isFocused && hoveredDot !== hit) return null;
					return (
						<HitDot
							key={`dot-${hit.laneId}-${hit.hitId}`}
							x={x}
							y={y}
							color={badgeStyles[hit.status].color}
							size={hit.status === 'onTime' || hit.status === 'waiting' ? 4 : 5}
							isPulsing={hit.status !== 'onTime' && hit.status !== 'waiting' && !isDragging}
							isHovered={hoveredDot === hit}
							isFocused={isFocused}
						/>
					);
				}
				const lane = project.music.lanes.find((item) => item.id === hit.laneId);
				const isNext = nextDots.get(hit.laneId) === hit;
				const isOutside = hit.outOfFrame ?? Math.abs(hit.dot.x - band.centerX) > band.halfWidth;
				const color = isOutside ? 'var(--bad)' : (lane?.color ?? 'var(--text)');
				return (
					<HitDot
						key={`dot-${hit.laneId}-${hit.hitId}`}
						x={x}
						y={y}
						color={color}
						size={isNext ? 5 : 4}
						isPulsing={isNext && !isDragging}
						isHovered={hoveredDot === hit}
						isFocused={focusedKeys.has(`hit:${hit.laneId}:${hit.hitId}`)}
						isLongGap={longGaps.has(`${hit.laneId}:${hit.hitId}`)}
					/>
				);
			})}
		</>
	);
});

/** The dot a dragged platform will link to, ringed in the accent like a Figma snap target */
const SnapRing: React.FC<{ position: TVec2 }> = (props) => {
	const { x, y } = props.position;
	return (
		<g>
			<circle cx={x} cy={y} r={9} fill="color-mix(in srgb, var(--accent) 22%, transparent)" stroke="var(--accent-strong)" strokeWidth={2} />
			<circle cx={x} cy={y} r={3} fill="var(--accent-strong)" />
		</g>
	);
};

/** Where a platform that plays a note was when the drag began, and its note's dot, so the way back stays in view */
const PlaysGhost: React.FC<{ compose: ComposeCx; origin: TResolvedPiece; dot: TVec2 | null }> = (props) => {
	const { compose, origin, dot } = props;
	const center = dot != null ? compose.toScreen(dot) : null;
	return (
		<g>
			<polygon points={toPoints(compose.screenOutline(origin))} fill="none" stroke="var(--text-secondary)" strokeWidth={1.25} strokeDasharray="3 3" strokeLinejoin="round" />
			{center != null ? <circle cx={center.x} cy={center.y} r={5} fill="none" stroke="var(--text-secondary)" strokeWidth={1.25} strokeDasharray="2 2" /> : null}
		</g>
	);
};

// Pixels the chip of a dragged platform may need to its right, with its timing and what-if count
const PLAYS_CHIP_ROOM = 300;

/**
 * Beside a dragged platform that plays a note: that it keeps playing it, with how the marble would land there, or that
 * a drop this far away detaches it
 */
const PlaysChip: React.FC<{ compose: ComposeCx; project: TProject; drag: Extract<TComposeDrag, { kind: 'move' }>; result: TSimulationResult }> = (props) => {
	const { compose, project, drag, result } = props;
	const limit = useFeatureState(compose.studio.simulation.$moveLimit);
	const center = compose.toScreen(drag.current.position);
	const plays = drag.plays;
	if (plays == null) return null;
	// Beside the piece, on its left near the wall's right edge, so the timing never runs under the inspector
	const place = center.x + PLAYS_CHIP_ROOM > compose.$viewport.get().width ? { right: compose.$viewport.get().width - center.x + 18, top: center.y + 14 } : { left: center.x + 18, top: center.y + 14 };
	const label = noteLabel(project, plays.laneId, plays.hitId);
	if (drag.playsDrop === 'frees') {
		return (
			<div className="mm-snap-chip" data-snapped={false} style={place}>
				<Unlink2 size={11} strokeWidth={2.2} />
				<span className="font-medium">Detaches {label}</span>
				<WhatIfCount compose={compose} result={result} isInChip />
			</div>
		);
	}
	// The run for this spot has arrived once the what-if can count; until then the hit still reads as before
	const hit = compose.whatIfBreaks(result) != null ? result.hits.find((item) => item.laneId === plays.laneId && item.hitId === plays.hitId) : undefined;
	const status = timingStatus(undefined, hit);
	return (
		<div className="mm-snap-chip" data-snapped style={place}>
			<Link2 size={11} strokeWidth={2.2} />
			<span className="font-medium">Plays {label}</span>
			<span className="mm-chip-timing" data-tone={status.tone}>
				{status.label}
			</span>
			<WhatIfCount compose={compose} result={result} isInChip />
			{limit != null ? <span className="mm-whatif-count" data-bad data-chip>{limit.chip}</span> : null}
		</div>
	);
};

/** What a drop will do, next to the dragged piece: play a note, follow a marble at a moment or stay free */
const SnapChip: React.FC<{ compose: ComposeCx; project: TProject; position: TVec2; snap: TSnap | null }> = (props) => {
	const { compose, project, snap } = props;
	const center = compose.toScreen(props.position);
	const lane = snap != null ? project.music.lanes.find((item) => item.id === snap.laneId) : undefined;
	let content: React.ReactNode;
	if (snap?.kind === 'link') {
		const index = lane?.hits.findIndex((hit) => hit.id === snap.hitId) ?? -1;
		const pitch = lane?.hits[index]?.pitch;
		content = (
			<>
				<Link2 size={11} strokeWidth={2.2} />
				<span className="font-medium">Hit {index + 1}</span>
				{pitch != null ? <span className="opacity-70">{noteName(pitch)}</span> : null}
			</>
		);
	} else if (snap?.kind === 'anchor') {
		content = (
			<>
				<Anchor size={11} strokeWidth={2.2} />
				<span className="font-medium">Follows {lane?.name ?? 'Marble'}</span>
				<span className="mm-tabular opacity-70">at {formatTime(snap.time)}</span>
			</>
		);
	} else {
		content = <span className="font-medium">None</span>;
	}
	return (
		<div className="mm-snap-chip" data-snapped={snap != null} style={{ left: center.x + 18, top: center.y + 14 }}>
			{content}
			<WhatIfCount compose={compose} result={compose.result} isInChip />
		</div>
	);
};

/** While Play a Note… is armed: which piece waits for a note's dot, and that Escape stops */
const PlayNoteHint: React.FC<{ compose: ComposeCx }> = (props) => {
	const { compose } = props;
	const entityId = useFeatureState(compose.$playNoteFor);
	if (entityId == null) return null;
	const name = compose.project?.entities.find((entity) => entity.id === entityId)?.name ?? 'The platform';
	return (
		<div className="mm-hint mm-ghost-in absolute top-[52px] left-1/2 z-10 -translate-x-1/2 whitespace-nowrap">
			Click a note's dot for {name} to play <kbd className="opacity-60">⎋</kbd>
		</div>
	);
};

/**
 * What the shown what-if does to the run, beside a hover or drag: "Breaks 86 hits" in red, or "Breaks no hits".
 * Nothing shows until the what-if run arrives.
 */
const WhatIfCount: React.FC<{ compose: ComposeCx; result: TSimulationResult | null; isFirst?: boolean; isInChip?: boolean }> = (props) => {
	const { compose, result, isFirst = false, isInChip = false } = props;
	const count = compose.whatIfBreaks(result);
	if (count == null) return null;
	const text = count === 0 ? 'Breaks no hits' : `Breaks ${count} ${count === 1 ? 'hit' : 'hits'}`;
	return (
		<span className="mm-whatif-count" data-bad={count > 0} data-chip={isInChip} data-first={isFirst}>
			{text}
		</span>
	);
};

/** Points and handles of a selected rail drawn with the path tool, editable like a Figma vector */
const RailNodes: React.FC<{
	compose: ComposeCx;
	entityId: string;
	frame: { nodes: TPathNode[]; base: TPose };
	hover: ReturnType<ComposeCx['$hover']['get']>;
	drag: ReturnType<ComposeCx['$drag']['get']>;
}> = (props) => {
	const { compose, entityId, frame, hover, drag } = props;
	const map = (point: TVec2): TVec2 => compose.frameToScreen(frame.base, point);
	const nodes = mapNodes(frame.nodes, map);
	const isActive = (kind: 'node' | 'nodeIn' | 'nodeOut', index: number): boolean =>
		(hover != null && 'index' in hover && hover.kind === kind && hover.entityId === entityId && hover.index === index) ||
		(drag?.kind === 'node' && drag.entityId === entityId && drag.index === index && (drag.handle === 'point' ? 'node' : drag.handle === 'in' ? 'nodeIn' : 'nodeOut') === kind);
	return (
		<g>
			<path d={nodesPathData(frame.nodes, map)} fill="none" stroke="var(--accent-strong)" strokeWidth={1} strokeOpacity={0.9} />
			{nodes.map((node, index) => (
				// Nodes keep their order while edited, so the point identifies them
				<g key={`${node.point.x.toFixed(1)}:${node.point.y.toFixed(1)}:${frame.nodes.length}`}>
					{node.in != null ? (
						<>
							<line x1={node.point.x} y1={node.point.y} x2={node.in.x} y2={node.in.y} stroke="var(--accent-strong)" strokeWidth={1} />
							<circle cx={node.in.x} cy={node.in.y} r={3.5} fill={isActive('nodeIn', index) ? 'var(--accent)' : 'white'} stroke="var(--accent-strong)" strokeWidth={1.25} />
						</>
					) : null}
					{node.out != null ? (
						<>
							<line x1={node.point.x} y1={node.point.y} x2={node.out.x} y2={node.out.y} stroke="var(--accent-strong)" strokeWidth={1} />
							<circle cx={node.out.x} cy={node.out.y} r={3.5} fill={isActive('nodeOut', index) ? 'var(--accent)' : 'white'} stroke="var(--accent-strong)" strokeWidth={1.25} />
						</>
					) : null}
					<rect
						x={node.point.x - 4}
						y={node.point.y - 4}
						width={8}
						height={8}
						rx={1.5}
						fill={isActive('node', index) ? 'var(--accent)' : 'white'}
						stroke="var(--accent-strong)"
						strokeWidth={1.5}
					/>
				</g>
			))}
		</g>
	);
};

/** The rail being drawn with the path tool: placed points, their handles and the next segment */
const PenOverlay: React.FC<{ compose: ComposeCx }> = (props) => {
	const { compose } = props;
	const pen = useFeatureState(compose.$pen);
	useFeatureState(compose.$camera);
	useFeatureState(compose.$viewport);
	if (pen == null) return null;
	const map = (point: TVec2): TVec2 => compose.toScreen(point);
	const nodes = mapNodes(pen.nodes, map);
	const last = pen.nodes[pen.nodes.length - 1];
	const preview = pen.pointer != null && !pen.isDragging && last != null ? nodesPathData([last, { point: pen.pointer }], map) : null;
	const first = nodes[0];
	const end = nodes[nodes.length - 1];
	return (
		<>
			<svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
				<path d={nodesPathData(pen.nodes, map)} fill="none" stroke="var(--accent-strong)" strokeWidth={1.5} />
				{preview != null ? <path d={preview} fill="none" stroke="var(--accent-strong)" strokeWidth={1} strokeDasharray="4 3" /> : null}
				{nodes.map((node, index) => (
					<g key={`${node.point.x.toFixed(1)}:${node.point.y.toFixed(1)}`}>
						{node.in != null ? <line x1={node.point.x} y1={node.point.y} x2={node.in.x} y2={node.in.y} stroke="var(--accent-strong)" strokeWidth={1} /> : null}
						{node.out != null ? <line x1={node.point.x} y1={node.point.y} x2={node.out.x} y2={node.out.y} stroke="var(--accent-strong)" strokeWidth={1} /> : null}
						{node.in != null ? <circle cx={node.in.x} cy={node.in.y} r={3} fill="white" stroke="var(--accent-strong)" strokeWidth={1.25} /> : null}
						{node.out != null ? <circle cx={node.out.x} cy={node.out.y} r={3} fill="white" stroke="var(--accent-strong)" strokeWidth={1.25} /> : null}
						<rect x={node.point.x - 4} y={node.point.y - 4} width={8} height={8} rx={1.5} fill={index === pen.nodes.length - 1 ? 'var(--accent)' : 'white'} stroke="var(--accent-strong)" strokeWidth={1.5} />
					</g>
				))}
			</svg>
			{end != null && first != null ? (
				<div className="mm-snap-chip" style={{ left: end.point.x + 14, top: end.point.y + 12 }}>
					{pen.nodes.length < 2 ? <span>Click the next point · drag for a curve</span> : <span>Return to finish</span>}
					<kbd className="opacity-60">esc</kbd>
				</div>
			) : null}
		</>
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

/** What an agent's edit just changed: the selection's outline in the accent, fading in about a second */
const AgentTouched: React.FC<{ compose: ComposeCx; pieces: readonly TResolvedPiece[] }> = (props) => {
	const { compose, pieces } = props;
	const touched = useFeatureState(compose.studio.mcp.presence.$touched);
	if (!touched.length) return null;
	return (
		<>
			{touched.map((item) => {
				const piece = pieces.find((candidate) => candidate.entityId === item.key);
				if (piece == null) return null;
				const outline = pieceKind(piece) === 'box' ? inflate(compose.screenOutline(piece), 2.5) : compose.screenOutline(piece);
				return <polygon key={`${item.key}-${item.stamp}`} className="mm-agent-touched" points={toPoints(outline)} fill="none" stroke="var(--accent-strong)" strokeWidth={2} strokeLinejoin="round" />;
			})}
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

/** Every placed piece's status badge, redrawn with the run or the zoom and not when the view pans */
const PieceBadges = React.memo(function PieceBadges(props: { projection: TScreenProjection; result: TSimulationResult }) {
	const { projection, result } = props;
	const hitOfPiece = new Map<string, THitResult>();
	for (const hit of result.hits) if (hit.pieceEntityId != null && !hitOfPiece.has(hit.pieceEntityId)) hitOfPiece.set(hit.pieceEntityId, hit);
	return (
		<>
			{result.pieces.map((piece) => (
				<PieceBadge key={`badge-${piece.entityId}`} projection={projection} piece={piece} hit={hitOfPiece.get(piece.entityId)} />
			))}
		</>
	);
});

/** Status badge off the left end of a placed piece */
const PieceBadge: React.FC<{ projection: TScreenProjection; piece: TResolvedPiece; hit: THitResult | undefined }> = (props) => {
	const { projection, piece, hit } = props;
	const status = badgeStatus(piece.status, hit);
	if (status == null) return null;
	const outline = projectedOutline(projection, piece);
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

const CanvasTooltip: React.FC<{ position: TVec2; children: React.ReactNode }> = (props) => {
	const { position, children } = props;
	return (
		<div
			className="pointer-events-none absolute z-10 rounded-[6px] bg-[var(--content-raised)] px-2 py-1 text-[11px] leading-[15px] whitespace-nowrap"
			style={{ left: position.x + 12, top: position.y - 30, boxShadow: 'var(--shadow-popover)' }}
		>
			{children}
		</div>
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
	const overshoot = Math.abs(hit.dot.x - band.centerX) - band.halfWidth;
	const isOutside = hit.outOfFrame ?? overshoot > 0;
	return (
		<CanvasTooltip position={position}>
			<span className="font-medium">Hit {index + 1}</span>
			<span className="mm-tabular ml-1.5 text-[var(--text-secondary)]">
				{formatTime(hit.targetTime)}
				{pitch != null ? ` · ${noteName(pitch)}` : ''}
			</span>
			{isOutside ? <span className="ml-1.5 text-[var(--bad)]">{overshoot > 0 ? `${(overshoot * 100).toFixed(0)} cm outside` : 'outside'} the frame</span> : null}
		</CanvasTooltip>
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

// MARK: - Contextual assists

/**
 * The build assists next to where they act, like Figma's selection toolbar: under the selected last piece of
 * a marble, or under the next open dot when nothing is selected. Their keys work everywhere.
 */
const AssistBar: React.FC<{ compose: ComposeCx }> = (props) => {
	const { compose } = props;
	const cx = compose.studio;
	const result = useFeatureState(cx.simulation.$result);
	const project = useFeatureState(cx.$history)?.present;
	const selection = useFeatureState(cx.$selection);
	const playing = useFeatureState(cx.$playing);
	const drag = useFeatureState(compose.$drag);
	const pen = useFeatureState(compose.$pen);
	const tool = useFeatureState(compose.$tool);
	const ghosts = useFeatureState(compose.assist.$ghosts);
	const queued = useFeatureState(compose.assist.$queuedNext);
	const building = useFeatureState(compose.assist.$building);
	// The bar sits at screen positions, so it moves with the view
	useFeatureState(compose.$camera);
	const viewport = useFeatureState(compose.$viewport);
	// The bar's measured size, so it can move off ghosts it would cover
	const [size, setSize] = React.useState({ width: 240, height: 38 });
	const barRef = React.useCallback((bar: HTMLDivElement | null) => {
		if (bar == null) return;
		const observer = new ResizeObserver(() => {
			const { offsetWidth: width, offsetHeight: height } = bar;
			setSize((current) => (Math.abs(current.width - width) > 1 || Math.abs(current.height - height) > 1 ? { width, height } : current));
		});
		observer.observe(bar);
		return () => observer.disconnect();
	}, []);
	if (project == null || result == null || playing || drag != null || pen != null || tool === 'path' || building != null) return null;

	const target = findStepTarget(project, result, selection);
	if (target?.dot == null) return null;
	// With a selection, the bar belongs to the selected piece or dot and only shows when Next has a target after it
	let anchor: TVec2;
	const pieceId = selection.length === 1 ? selection[0] : undefined;
	const piece = pieceId != null ? linkedPieces(project).find((item) => item.entity.id === pieceId) : undefined;
	const resolved = piece != null ? result.pieces.find((item) => item.entityId === piece.entity.id) : undefined;
	if (selection.length > 0 && piece == null && parseHitKey(selection[0] ?? '') == null) return null;
	if (resolved != null) {
		const outline = compose.screenOutline(resolved);
		anchor = { x: outline.reduce((sum, point) => sum + point.x, 0) / outline.length, y: Math.max(...outline.map((point) => point.y)) + 30 };
	} else {
		// Below the ghost piece at the dot when one shows, so the bar never covers it
		const ghost = ghosts.ghost?.kind === 'continue' ? ghosts.ghost.answer.suggestions.find((item) => item.piece != null)?.piece : ghosts.ghost?.kind === 'place' ? ghosts.ghost.answer.piece : null;
		const outline = ghost != null ? compose.screenOutline(ghost) : [];
		const dot = compose.toScreen(target.dot);
		anchor = outline.length ? { x: dot.x, y: Math.max(dot.y, ...outline.map((point) => point.y)) + 26 } : { x: dot.x, y: dot.y + 24 };
	}
	// The bar belongs next to what it acts on; when that is out of view it stays away
	if (anchor.x < 0 || anchor.x > viewport.width || anchor.y < 0 || anchor.y > viewport.height + 20) return null;
	const continueCount = ghosts.ghost?.kind === 'continue' ? acceptableCount(ghosts.ghost) : 0;
	const { left, top } = placeBar(anchor, size, ghostRects(compose, ghosts.ghost), viewport);

	return (
		<div ref={barRef} className="mm-assist-bar mm-ghost-in" style={{ left, top }} role="toolbar" aria-label="Assists">
			<AssistButton
				label="Place Next Platform"
				detail={queued > 0 ? `${queued} more ${queued === 1 ? 'press' : 'presses'} waiting for the track · esc cancels` : 'Add the platform for the next open note'}
				shortcut="N"
				onClick={() => compose.next()}
				isText
			>
				{/* Presses made while the run catches up queue up, like key repeat in a text field */}
				{queued > 0 ? <span className="tabular-nums">Next ×{queued}</span> : 'Next'}
			</AssistButton>
			<AssistButton label="Build Track" detail="Build every open hit, in time order, and end in a Bowl" shortcut="⇧N" onClick={() => void compose.assist.buildTrack()} isText>
				Build Track
			</AssistButton>
			{continueCount > 0 ? (
				<>
					<div className="mm-assist-divider" />
					<AssistButton label={`Continue Pattern (${continueCount})`} detail={`Repeat the pattern for ${continueCount} more ${continueCount === 1 ? 'note' : 'notes'} · esc dismisses`} shortcut="⇥" onClick={() => compose.assist.acceptGhosts()} isText>
						<ChevronsRight size={14} strokeWidth={1.8} />
						Continue Pattern ({continueCount})
					</AssistButton>
				</>
			) : null}
		</div>
	);
};

/** Screen boxes of the ghost pieces and dots on show, which the build bar keeps clear of */
function ghostRects(compose: ComposeCx, ghost: ReturnType<ComposeCx['assist']['$ghosts']['get']>['ghost']): TScreenRect[] {
	if (ghost == null) return [];
	const pieces = ghost.kind === 'continue' ? ghost.answer.suggestions.map((item) => item.piece) : [ghost.answer.piece];
	const dots = ghost.kind === 'gap' ? [ghost.answer.track.at(-1)] : ghost.kind === 'place' ? [ghost.answer.nextDot] : ghost.answer.suggestions.map((item) => item.dot);
	const rects: TScreenRect[] = [];
	for (const piece of pieces) {
		if (piece == null) continue;
		const outline = compose.screenOutline(piece).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
		if (!outline.length) continue;
		const xs = outline.map((point) => point.x);
		const ys = outline.map((point) => point.y);
		rects.push({ x: Math.min(...xs) - 4, y: Math.min(...ys) - 4, width: Math.max(...xs) - Math.min(...xs) + 8, height: Math.max(...ys) - Math.min(...ys) + 8 });
	}
	for (const dot of dots) {
		if (dot == null) continue;
		const screen = compose.toScreen(dot);
		rects.push({ x: screen.x - 7, y: screen.y - 7, width: 14, height: 14 });
	}
	return rects;
}

const AssistButton: React.FC<{ label: string; detail: string; shortcut: string; onClick: () => void; isText?: boolean; children: React.ReactNode }> = (props) => {
	const { label, detail, shortcut, onClick, isText = false, children } = props;
	return (
		<button className="mm-assist-button" data-text={isText} aria-label={label} onPointerDown={(event) => event.stopPropagation()} onClick={onClick} type="button">
			{children}
			{isText ? <kbd className="mm-keycap">{shortcut}</kbd> : null}
			<span className="mm-tooltip">
				{label}
				<span className="text-[rgb(255_255_255/0.6)]">{detail}</span>
				<kbd>{shortcut}</kbd>
			</span>
		</button>
	);
};

// MARK: - Canvas chrome

const CornerControls: React.FC<{ compose: ComposeCx }> = (props) => {
	const { compose } = props;
	const follow = useFeatureState(compose.$follow);
	const snapping = useFeatureState(compose.studio.$snapping);
	return (
		<div className="mm-floating mm-tooltip-below absolute top-3 right-3 z-20 flex items-center gap-0.5 p-[3px]">
			<button
				className="mm-tool-button !h-7 !w-7"
				data-active={snapping}
				aria-label="Snap"
				aria-pressed={snapping}
				onClick={() => compose.studio.$snapping.set(!snapping)}
				type="button"
			>
				<Magnet size={14} strokeWidth={1.7} />
				<span className="mm-tooltip">Snap pieces to notes and marbles · hold ⌥ to skip</span>
			</button>
			<button
				className="mm-tool-button !h-7 !w-7"
				data-active={follow}
				aria-label="Follow"
				aria-pressed={follow}
				onClick={() => compose.toggleFollow()}
				type="button"
			>
				<LocateFixed size={14} strokeWidth={1.7} />
				<span className="mm-tooltip">
					Follow the marble at the playhead · panning turns it off <kbd>{followKey.key}</kbd>
				</span>
			</button>
		</div>
	);
};

const NO_REPLACING = createState<{ done: number; total: number } | null>(null);

/**
 * Says the run is being checked after an edit, or fixed while Fix Hits runs, fading in only when it
 * takes long enough to notice
 */
const SimulatingIndicator: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const computing = useFeatureState(cx.simulation.$computing);
	const compose = useFeatureState(cx.$compose);
	const replacing = useFeatureState(compose?.assist.$replacing ?? NO_REPLACING);
	if (!computing && replacing == null) return null;
	return (
		<div className="mm-floating mm-delayed-fade absolute top-3 left-3 z-20 px-2.5 py-1 text-[11px] text-[var(--text-secondary)]" role="status">
			{replacing == null ? 'Checking…' : 'Fixing…'}
		</div>
	);
};
