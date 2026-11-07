import { useFeatureState } from 'feature-react/state';
import { Anchor, ChevronDown, Focus, Link2, Magnet, Unlink2 } from 'lucide-react';
import React from 'react';
import { MenuButton, openContextMenu } from '@/components';
import { DEFAULT_MARBLE_RADIUS, type TPathNode, type TProject, type TVec2, formatTime, noteName, parseHitKey, toHitKey } from '@/modules/project';
import { stageAlongGuide, stageBand, type THitResult, type TResolvedPiece, type TSimulationResult } from '@/modules/simulation';
import type { StudioCx } from '@/modules/studio';
import { formatDegrees, parseDegrees, toDegrees } from './angles';
import type { TPose, TSnap } from '@/modules/building';
import { mapNodes, nodesPathData } from '@/modules/building';
import { TrackCx, noteLabel, type TTrackDrag } from './TrackCx';
import { paletteOf, projectedOutline, toPoints, type TScreenProjection } from '@/modules/canvas';
import { Track3DView, TrackViewSwitch } from './Track3DView';
import { timingStatus } from './timing-status';
import { followKey } from './keys';
import { GhostShapes } from './GhostLayer';
import { PatternGhost } from './PatternInspector';
import { BarHint } from './FloatingBar';
import { HitFlashLayer } from './HitFlashLayer';
import { canvasMenu, dotMenu } from './menus';
import { PieceLayer, usePannedProjection } from './PieceLayer';
import { ZOOM_100_SCALE, hiddenMarbleIds, pathRun, pathToWorld, pieceKind } from '@/modules/scene';
import { badgeStatus, badgeStyles, StatusBadge } from './status';
import { nextOpenHitPerMarble, pieceAngle, pieceAngleCommands, selectedPieceIds } from './step-loop';

/** The Track wall: the wall and its content in WebGL, with screen-space handles on top */
export const TrackCanvas: React.FC<TTrackCanvasProps> = (props) => {
	const { cx } = props;
	const [trackCx] = React.useState(() => new TrackCx(cx));
	const containerRef = React.useRef<HTMLDivElement>(null);
	const canvasRef = React.useRef<HTMLCanvasElement>(null);
	const tool = useFeatureState(trackCx.$tool);
	const spaceHeld = useFeatureState(trackCx.$spaceHeld);
	const drag = useFeatureState(trackCx.$drag);
	const hover = useFeatureState(trackCx.$hover);
	const wallColor = useFeatureState(cx.$history)?.present.film.wall.labelColor;

	React.useEffect(() => {
		const container = containerRef.current;
		const canvas = canvasRef.current;
		if (container == null || canvas == null) return;
		// Development hook for browser checks and latency measurements
		if (import.meta.env.DEV) (window as unknown as { __midimarble?: unknown }).__midimarble = { studio: cx, trackCx };
		return trackCx.mount(container, canvas);
	}, [trackCx, cx]);

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
		<div ref={containerRef} className="mm-pegboard relative h-full w-full overflow-hidden" style={wallColor != null ? ({ '--canvas': wallColor } as React.CSSProperties) : undefined}>
			<canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
			<svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
				<PieceLayer trackCx={trackCx} />
				<GhostShapes trackCx={trackCx} />
				<PatternGhost trackCx={trackCx} />
				<BarHint trackCx={trackCx} />
			</svg>
			<div
				className="absolute inset-0 touch-none"
				style={{ cursor }}
				onPointerDown={(event) => trackCx.onPointerDown(event)}
				onPointerMove={(event) => trackCx.onPointerMove(event)}
				onPointerUp={(event) => trackCx.onPointerUp(event)}
				onPointerCancel={(event) => trackCx.onPointerUp(event)}
				onPointerLeave={() => trackCx.onPointerLeave()}
				onContextMenu={(event) => openCanvasMenu(trackCx, event)}
			/>
			<TrackOverlay trackCx={trackCx} />
			<PenOverlay trackCx={trackCx} />
			<PlayNoteHint trackCx={trackCx} />
			<EmptyWall cx={cx} />
			<Track3DView trackCx={trackCx} />
			<div className="absolute top-3 right-3 z-30 flex items-center gap-2">
				<CornerControls trackCx={trackCx} />
				<TrackViewSwitch cx={cx} />
			</div>
		</div>
	);
};

interface TTrackCanvasProps {
	cx: StudioCx;
}

/** Right-click opens the menu for what is under the pointer, selecting it first like Finder */
function openCanvasMenu(trackCx: TrackCx, event: React.MouseEvent<HTMLElement>): void {
	const cx = trackCx.studio;
	const rect = event.currentTarget.getBoundingClientRect();
	const target = trackCx.pickAt({ x: event.clientX - rect.left, y: event.clientY - rect.top });
	switch (target?.kind) {
		case 'piece':
		case 'rotate':
		case 'pathEnd':
		case 'pathBend':
		case 'node':
		case 'nodeIn':
		case 'nodeOut':
			if (!cx.$selection.get().includes(target.pieceId)) cx.$selection.set([target.pieceId]);
			openContextMenu(event, cx.menus.piece(target.pieceId));
			return;
		case 'dot': {
			const marble = trackCx.project?.marbles.find((item) => item.id === target.marbleId);
			const hit = trackCx.result?.hits.find((item) => item.marbleId === target.marbleId && item.hitId === target.hitId);
			if (marble != null && hit != null && hit.status !== 'open') {
				cx.$selection.set([toHitKey(target.marbleId, target.hitId)]);
				openContextMenu(event, cx.menus.hit(marble, target.hitId));
				return;
			}
			openContextMenu(event, dotMenu(trackCx, target.marbleId, target.hitId));
			return;
		}
		case 'release': {
			const marble = trackCx.project?.marbles.find((item) => item.id === target.marbleId);
			cx.$selection.set([target.marbleId]);
			if (marble != null) openContextMenu(event, cx.menus.marble(marble));
			return;
		}
		default:
			openContextMenu(event, canvasMenu(trackCx));
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
	const hasMarble = project.marbles.length > 0;
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
	return project.songs.every((song) => song.path == null) && project.marbles.every((marble) => marble.hits.length === 0);
}

// MARK: - Overlay

const TrackOverlay: React.FC<{ trackCx: TrackCx }> = (props) => {
	const { trackCx } = props;
	const cx = trackCx.studio;
	// Subscriptions that move anything drawn here
	const camera = useFeatureState(trackCx.$camera);
	const viewport = useFeatureState(trackCx.$viewport);
	const result = useFeatureState(cx.simulation.$result);
	const history = useFeatureState(cx.$history);
	const selection = useFeatureState(cx.$selection);
	const hover = useFeatureState(trackCx.$hover);
	const drag = useFeatureState(trackCx.$drag);
	useFeatureState(trackCx.$override);
	const hidden = useFeatureState(cx.$hidden);
	const insertSnap = useFeatureState(trackCx.$insertSnap);
	const hoverPreview = useFeatureState(trackCx.$hoverPreview);
	const marbleGhost = useFeatureState(trackCx.$marbleGhost);
	const project = history?.present;
	const { projection, scale, transform } = usePannedProjection(trackCx);
	const nextDots = React.useMemo(() => (result != null ? nextOpenHitPerMarble(result) : null), [result]);
	if (project == null || result == null || nextDots == null || viewport.width <= 1) return null;

	const pieces = trackCx.displayPieces(result);
	const selectedPieces = selectedPieceIds(project, selection);
	const single = selectedPieces.length === 1 ? pieces.find((piece) => piece.pieceId === selectedPieces[0]) : undefined;
	const singleKind = single != null ? pieceKind(single) : null;
	const frame = single != null ? trackCx.railFrame(single.pieceId) : null;
	const isPathPiece = singleKind === 'path' || singleKind === 'tube' || singleKind === 'generated';
	const isMoveDrag = drag?.kind === 'move' && drag.moved;
	// A Bowl always stands upright, so it has nothing to turn
	const grip = single != null && !isPathPiece && singleKind !== 'catcher' && !isMoveDrag ? trackCx.screenGrip(single) : null;
	const pathHandles = single != null && isPathPiece && frame == null && singleKind !== 'generated' ? trackCx.screenPathHandles(single) : null;
	const isRotating = drag?.kind === 'rotate';
	const showArc = grip != null && (isRotating || (hover?.kind === 'rotate' && hover.pieceId === single?.pieceId));
	const hoveredPiece = hover?.kind === 'piece' ? hover.pieceId : null;
	const hoveredDot = hover?.kind === 'dot' ? result.hits.find((hit) => hit.marbleId === hover.marbleId && hit.hitId === hover.hitId) : undefined;
	const snap = drag?.kind === 'move' ? drag.snap : (insertSnap?.snap ?? null);
	const singlePiece = single != null ? project.track.pieces.find((piece) => piece.id === single.pieceId) : undefined;
	// The first-run hint "Click a note's dot to see its platform" points at the earliest next open dot
	const firstNext = [...nextDots.values()].filter((hit) => hit.dot != null).sort((a, b) => a.targetTime - b.targetTime)[0];
	const firstNextScreen = firstNext?.dot != null ? trackCx.toScreen(firstNext.dot) : null;
	const hintDot = firstNextScreen != null && firstNextScreen.x >= 0 && firstNextScreen.x <= viewport.width && firstNextScreen.y >= 0 && firstNextScreen.y <= viewport.height ? firstNextScreen : null;

	return (
		<>
			<svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
				{pieces.map((piece) => {
					const isSelected = selection.includes(piece.pieceId);
					const isHovered = hoveredPiece === piece.pieceId && !isSelected;
					if (!isSelected && !isHovered) return null;
					const outline = pieceKind(piece) === 'box' ? inflate(trackCx.screenOutline(piece), 2.5) : trackCx.screenOutline(piece);
					return (
						<polygon
							key={`outline-${piece.pieceId}`}
							points={toPoints(outline)}
							fill="none"
							stroke="var(--accent-strong)"
							strokeWidth={isSelected ? 1.75 : 1.25}
							strokeOpacity={isSelected ? 1 : 0.75}
							strokeLinejoin="round"
						/>
					);
				})}
				<AgentTouched trackCx={trackCx} pieces={pieces} />
				<g transform={transform}>
					{drag == null ? <PieceBadges projection={projection} result={result} /> : null}
					<HitDots hidden={hidden} trackCx={trackCx} projection={projection} scale={scale} project={project} result={result} nextDots={nextDots} selection={selection} hoveredDot={hoveredDot} isDragging={drag != null} />
				</g>
				<HitFlashLayer trackCx={trackCx} />
				{snap?.kind === 'link' ? <SnapRing position={trackCx.toScreen(snap.dot)} /> : null}
				{drag?.kind === 'move' && drag.moved && drag.plays != null && drag.origin != null ? <PlaysGhost trackCx={trackCx} origin={drag.origin} dot={drag.plays.dot} /> : null}
				{project.marbles.map((marble) => {
					if (hidden.includes(marble.id)) return null;
					const position = drag?.kind === 'release' && drag.marbleId === marble.id ? drag.position : marble.start.position;
					const center = trackCx.toScreen(position);
					const isSelected = selection.includes(marble.id);
					const isActive = isSelected || (hover?.kind === 'release' && hover.marbleId === marble.id) || (drag?.kind === 'release' && drag.marbleId === marble.id);
					const radius = Math.max(9, marble.radius * camera.view.scale + 5);
					const labelColor = marble.labelColor;
					return (
						<g key={`release-${marble.id}`}>
							{isSelected ? <circle cx={center.x} cy={center.y} r={radius + 3} fill="none" stroke="var(--accent-strong)" strokeWidth={1.75} /> : null}
							<circle
								cx={center.x}
								cy={center.y}
								r={radius}
								fill="none"
								stroke={labelColor}
								strokeWidth={isActive ? 2 : 1.5}
								strokeDasharray={isActive ? undefined : '3 2.5'}
							/>
							<path
								d={`M ${center.x} ${center.y - radius - 7} L ${center.x} ${center.y - radius - 1.5} M ${center.x - 3} ${center.y - radius - 4.5} L ${center.x} ${center.y - radius - 1.5} L ${center.x + 3} ${center.y - radius - 4.5}`}
								fill="none"
								stroke={labelColor}
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
				{pathHandles != null && single != null ? <PathHandles handles={pathHandles} hover={hover} drag={drag} pieceId={single.pieceId} /> : null}
				{frame != null && single != null ? <RailNodes trackCx={trackCx} pieceId={single.pieceId} frame={frame} hover={hover} drag={drag} /> : null}
				{hover?.kind === 'track' && drag == null ? (
					<circle cx={hover.position.x} cy={hover.position.y} r={4.5} fill="var(--canvas)" stroke={paletteOf('windmill').bar} strokeWidth={2} />
				) : null}
				{drag?.kind === 'marquee' ? <Marquee from={drag.from} to={drag.to} /> : null}
				{marbleGhost != null && drag == null ? <circle cx={marbleGhost.x} cy={marbleGhost.y} r={Math.max(7, DEFAULT_MARBLE_RADIUS * trackCx.screenScale())} fill="var(--text)" fillOpacity={0.3} stroke="var(--text)" strokeOpacity={0.6} /> : null}
			</svg>
			{hoveredDot != null && drag == null && hoverPreview == null ? <DotTooltip trackCx={trackCx} project={project} hit={hoveredDot} /> : null}
			{hintDot != null && drag == null ? (
				<span data-hint-anchor="dot" className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2" style={{ left: hintDot.x, top: hintDot.y }} />
			) : null}
			{hover?.kind === 'track' && drag == null ? (
				<CanvasTooltip position={hover.position}>
					{trackCx.followsAt(hover.marbleId, hover.time) ? (
						<>
							<span className="font-medium">Follows {project.marbles.find((marble) => marble.id === hover.marbleId)?.name ?? 'Marble'}</span>
							<span className="mm-tabular ml-1 text-[var(--text-secondary)]">at {formatTime(hover.time)}</span>
						</>
					) : (
						<span className="font-medium">None</span>
					)}
					<WhatIfCount trackCx={trackCx} result={result} />
				</CanvasTooltip>
			) : null}
			{hoverPreview != null && hover?.kind !== 'track' && drag == null ? (
				<CanvasTooltip position={hoverPreview.position}>
					{hoverPreview.label != null ? <span className="font-medium">{hoverPreview.label}</span> : null}
					<WhatIfCount trackCx={trackCx} result={result} isFirst={hoverPreview.label == null} />
				</CanvasTooltip>
			) : null}
			{drag?.kind === 'move' && drag.moved ? (
				drag.plays != null && (drag.playsDrop === 'keeps' || (drag.playsDrop === 'frees' && drag.snap == null)) ? (
					<PlaysChip trackCx={trackCx} project={project} drag={drag} result={result} />
				) : (
					<SnapChip trackCx={trackCx} project={project} position={drag.current.position} snap={drag.snap} />
				)
			) : null}
			{insertSnap != null && drag == null ? <SnapChip trackCx={trackCx} project={project} position={insertSnap.position} snap={insertSnap.snap} /> : null}
			{single != null && grip != null && singlePiece != null ? (
				<AngleReadout
					trackCx={trackCx}
					piece={single}
					position={drag?.kind === 'rotate' ? { x: drag.pointer.x + 14, y: drag.pointer.y + 14 } : { x: grip.grip.x + 10, y: grip.grip.y + 8 }}
					angle={drag?.kind === 'rotate' ? drag.angle : pieceAngle(singlePiece)}
				/>
			) : null}
			{drag?.kind === 'path' && pathHandles != null && single != null ? <PathReadout piece={single} points={drag.points} position={pathHandles.end} /> : null}
		</>
	);
};

/** An open hit dot. Long gaps get a diamond with a dashed ring; dots outside the frame are red. */
/**
 * Every hit's dot, where the marble is at the hit's time: a solid dot with its small outline ring. Open dots take the
 * marble's color, on-time dots are green at the same size, and a hit that needs attention is a little larger, amber or
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

// Pixels per meter below which a default platform is under about 16 px, not much wider than an on-time dot
const ON_TIME_DOT_MIN_SCALE = 180;

/** Every hit's dot, redrawn when the run, the selection, the hovered dot or the zoom changes and not when the view pans */
const HitDots = React.memo(function HitDots(props: { hidden: readonly string[]; trackCx: TrackCx; projection: TScreenProjection; scale: number; project: TProject; result: TSimulationResult; nextDots: Map<string, THitResult>; selection: string[]; hoveredDot: THitResult | undefined; isDragging: boolean }) {
	const { hidden, trackCx, projection, scale, project, result, nextDots, selection, hoveredDot, isDragging } = props;
	const bandAt = stageAlongGuide(project);
	const longGaps = trackCx.longGapKeys(project);
	const focusedKeys = new Set(selection.filter((key) => parseHitKey(key) != null));
	const hiddenMarbles = hiddenMarbleIds(project, hidden);
	return (
		<>
			{result.hits.map((hit) => {
				if (hit.dot == null || hiddenMarbles.has(hit.marbleId)) return null;
				const { x, y } = projection.toScreen(hit.dot);
				if (hit.status !== 'open') {
					// Zoomed far out a dot is wider than its platform, so on-time ones step aside for the track
					const isFocused = focusedKeys.has(toHitKey(hit.marbleId, hit.hitId));
					if (hit.status === 'onTime' && scale < ON_TIME_DOT_MIN_SCALE && !isFocused && hoveredDot !== hit) return null;
					return (
						<HitDot
							key={`dot-${hit.marbleId}-${hit.hitId}`}
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
				const marble = project.marbles.find((item) => item.id === hit.marbleId);
				const isNext = nextDots.get(hit.marbleId) === hit;
				const band = bandAt(hit.dot.y);
				const isOutside = Math.abs(hit.dot.x - band.centerX) > band.halfWidth;
				const color = isOutside ? 'var(--bad)' : (marble?.labelColor ?? 'var(--text)');
				return (
					<HitDot
						key={`dot-${hit.marbleId}-${hit.hitId}`}
						x={x}
						y={y}
						color={color}
						size={isNext ? 5 : 4}
						isPulsing={isNext && !isDragging}
						isHovered={hoveredDot === hit}
						isFocused={focusedKeys.has(`hit:${hit.marbleId}:${hit.hitId}`)}
						isLongGap={longGaps.has(`${hit.marbleId}:${hit.hitId}`)}
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
const PlaysGhost: React.FC<{ trackCx: TrackCx; origin: TResolvedPiece; dot: TVec2 | null }> = (props) => {
	const { trackCx, origin, dot } = props;
	const center = dot != null ? trackCx.toScreen(dot) : null;
	return (
		<g>
			<polygon points={toPoints(trackCx.screenOutline(origin))} fill="none" stroke="var(--text-secondary)" strokeWidth={1.25} strokeDasharray="3 3" strokeLinejoin="round" />
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
const PlaysChip: React.FC<{ trackCx: TrackCx; project: TProject; drag: Extract<TTrackDrag, { kind: 'move' }>; result: TSimulationResult }> = (props) => {
	const { trackCx, project, drag, result } = props;
	const limit = useFeatureState(trackCx.studio.simulation.$moveLimit);
	const center = trackCx.toScreen(drag.current.position);
	const plays = drag.plays;
	if (plays == null) return null;
	// Beside the piece, on its left near the wall's right edge, so the timing never runs under the inspector
	const place = center.x + PLAYS_CHIP_ROOM > trackCx.$viewport.get().width ? { right: trackCx.$viewport.get().width - center.x + 18, top: center.y + 14 } : { left: center.x + 18, top: center.y + 14 };
	const label = noteLabel(project, plays.marbleId, plays.hitId);
	if (drag.playsDrop === 'frees') {
		return (
			<div className="mm-snap-chip" data-snapped={false} style={place}>
				<Unlink2 size={11} strokeWidth={2.2} />
				<span className="font-medium">Detaches {label}</span>
				<WhatIfCount trackCx={trackCx} result={result} isInChip />
			</div>
		);
	}
	// The run for this spot has arrived once the what-if can count; until then the hit still reads as before
	const hit = trackCx.whatIfBreaks(result) != null ? result.hits.find((item) => item.marbleId === plays.marbleId && item.hitId === plays.hitId) : undefined;
	const status = timingStatus(undefined, hit);
	return (
		<div className="mm-snap-chip" data-snapped style={place}>
			<Link2 size={11} strokeWidth={2.2} />
			<span className="font-medium">Plays {label}</span>
			<span className="mm-chip-timing" data-tone={status.tone}>
				{status.label}
			</span>
			<WhatIfCount trackCx={trackCx} result={result} isInChip />
			{limit != null ? <span className="mm-whatif-count" data-bad data-chip>{limit.chip}</span> : null}
		</div>
	);
};

/** What a drop will do, next to the dragged piece: play a note, follow a marble at a moment or stay free */
const SnapChip: React.FC<{ trackCx: TrackCx; project: TProject; position: TVec2; snap: TSnap | null }> = (props) => {
	const { trackCx, project, snap } = props;
	const center = trackCx.toScreen(props.position);
	const marble = snap != null ? project.marbles.find((item) => item.id === snap.marbleId) : undefined;
	let content: React.ReactNode = null;
	if (snap?.kind === 'link') {
		const index = marble?.hits.findIndex((hit) => hit.id === snap.hitId) ?? -1;
		const pitch = marble?.hits[index]?.pitch;
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
				<span className="font-medium">Follows {marble?.name ?? 'Marble'}</span>
				<span className="mm-tabular opacity-70">at {formatTime(snap.time)}</span>
			</>
		);
	}
	return (
		<div className="mm-snap-chip" data-snapped={snap != null} style={{ left: center.x + 18, top: center.y + 14 }}>
			{content}
			<WhatIfCount trackCx={trackCx} result={trackCx.result} isInChip />
		</div>
	);
};

/** While Play a Note… is armed: which piece waits for a note's dot, and that Escape stops */
const PlayNoteHint: React.FC<{ trackCx: TrackCx }> = (props) => {
	const { trackCx } = props;
	const pieceId = useFeatureState(trackCx.$playNoteFor);
	if (pieceId == null) return null;
	const name = trackCx.project?.track.pieces.find((piece) => piece.id === pieceId)?.name ?? 'The platform';
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
const WhatIfCount: React.FC<{ trackCx: TrackCx; result: TSimulationResult | null; isFirst?: boolean; isInChip?: boolean }> = (props) => {
	const { trackCx, result, isFirst = false, isInChip = false } = props;
	const count = trackCx.whatIfBreaks(result);
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
	trackCx: TrackCx;
	pieceId: string;
	frame: { nodes: TPathNode[]; base: TPose };
	hover: ReturnType<TrackCx['$hover']['get']>;
	drag: ReturnType<TrackCx['$drag']['get']>;
}> = (props) => {
	const { trackCx, pieceId, frame, hover, drag } = props;
	const map = (point: TVec2): TVec2 => trackCx.frameToScreen(frame.base, point);
	const nodes = mapNodes(frame.nodes, map);
	const isActive = (kind: 'node' | 'nodeIn' | 'nodeOut', index: number): boolean =>
		(hover != null && 'index' in hover && hover.kind === kind && hover.pieceId === pieceId && hover.index === index) ||
		(drag?.kind === 'node' && drag.pieceId === pieceId && drag.index === index && (drag.handle === 'point' ? 'node' : drag.handle === 'in' ? 'nodeIn' : 'nodeOut') === kind);
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
const PenOverlay: React.FC<{ trackCx: TrackCx }> = (props) => {
	const { trackCx } = props;
	const pen = useFeatureState(trackCx.$pen);
	useFeatureState(trackCx.$camera);
	useFeatureState(trackCx.$viewport);
	if (pen == null) return null;
	const map = (point: TVec2): TVec2 => trackCx.toScreen(point);
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
	hover: ReturnType<TrackCx['$hover']['get']>;
	drag: ReturnType<TrackCx['$drag']['get']>;
	pieceId: string;
}> = (props) => {
	const { handles, hover, drag, pieceId } = props;
	const { end, bend, entry } = handles;
	const isActive = (kind: 'pathEnd' | 'pathBend'): boolean =>
		(hover?.kind === kind && hover.pieceId === pieceId) ||
		(drag?.kind === 'path' && drag.pieceId === pieceId && drag.handle === (kind === 'pathEnd' ? 'end' : 'bend'));
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
const AgentTouched: React.FC<{ trackCx: TrackCx; pieces: readonly TResolvedPiece[] }> = (props) => {
	const { trackCx, pieces } = props;
	const touched = useFeatureState(trackCx.studio.mcp.presence.$touched);
	if (!touched.length) return null;
	return (
		<>
			{touched.map((item) => {
				const piece = pieces.find((candidate) => candidate.pieceId === item.key);
				if (piece == null) return null;
				const outline = pieceKind(piece) === 'box' ? inflate(trackCx.screenOutline(piece), 2.5) : trackCx.screenOutline(piece);
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
		// Offset along both adjacent edge normals, pointing away from the center
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
	for (const hit of result.hits) if (hit.pieceId != null && !hitOfPiece.has(hit.pieceId)) hitOfPiece.set(hit.pieceId, hit);
	return (
		<>
			{result.pieces.map((piece) => (
				<PieceBadge key={`badge-${piece.pieceId}`} projection={projection} piece={piece} hit={hitOfPiece.get(piece.pieceId)} />
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

const DotTooltip: React.FC<{ trackCx: TrackCx; project: TProject; hit: THitResult }> = (props) => {
	const { trackCx, project, hit } = props;
	if (hit.dot == null) return null;
	const position = trackCx.toScreen(hit.dot);
	const marble = project.marbles.find((item) => item.id === hit.marbleId);
	const index = marble?.hits.findIndex((item) => item.id === hit.hitId) ?? -1;
	const pitch = marble?.hits[index]?.pitch;
	const band = stageBand(project, hit.dot.y);
	const overshoot = Math.abs(hit.dot.x - band.centerX) - band.halfWidth;
	const isOutside = overshoot > 0;
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
const AngleReadout: React.FC<{ trackCx: TrackCx; piece: TResolvedPiece; position: TVec2; angle: number }> = (props) => {
	const { trackCx, piece, position, angle } = props;
	const editing = useFeatureState(trackCx.$editingAngle) === piece.pieceId;
	const [draft, setDraft] = React.useState('');

	function commit(): void {
		const value = parseDegrees(draft);
		const project = trackCx.project;
		trackCx.$editingAngle.set(null);
		if (value == null || project == null) return;
		trackCx.studio.execute(pieceAngleCommands(project, new Map([[piece.pieceId, value]])));
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
						if (event.key === 'Escape') trackCx.$editingAngle.set(null);
					}}
				/>
			) : (
				<button
					className="mm-tabular rounded-[4px] bg-[var(--accent)] px-1 text-[11px] leading-[16px] text-[var(--on-accent)]"
					title="Double-click to type an angle"
					onDoubleClick={() => {
						setDraft(formatDegrees(angle).replace('°', ''));
						trackCx.$editingAngle.set(piece.pieceId);
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

/** The pills beside the view icons change with the view: Snap and Follow in 2D, Follow in 3D, each with the zoom; nothing in Camera */
const CornerControls: React.FC<{ trackCx: TrackCx }> = (props) => {
	const { trackCx } = props;
	const follow = useFeatureState(trackCx.$follow);
	const snapping = useFeatureState(trackCx.studio.$snapping);
	const trackView = useFeatureState(trackCx.studio.$trackView);
	if (trackView === 'camera') return null;
	return (
		<>
			<div className="mm-floating mm-tooltip-below flex items-center gap-0.5 p-[3px]">
				{trackView === '2d' ? (
					<button
						className="mm-tool-button !h-7 !w-7"
						data-active={snapping}
						aria-label="Snap"
						aria-pressed={snapping}
						onClick={() => trackCx.studio.$snapping.set(!snapping)}
						type="button"
					>
						<Magnet size={14} strokeWidth={1.7} />
						<span className="mm-tooltip">Snap pieces to notes and marbles · hold ⌥ to skip</span>
					</button>
				) : null}
				<button
					className="mm-tool-button !h-7 !w-7"
					data-active={follow}
					aria-label="Follow"
					aria-pressed={follow}
					onClick={() => trackCx.toggleFollow()}
					type="button"
				>
					<Focus size={14} strokeWidth={1.7} />
					<span className="mm-tooltip">
						Follow the marble at the playhead · panning turns it off <kbd>{followKey.key}</kbd>
					</span>
				</button>
			</div>
			<div className="mm-floating flex items-center p-[3px]">
				<ZoomMenu trackCx={trackCx} />
			</div>
		</>
	);
};

const ZoomMenu: React.FC<{ trackCx: TrackCx }> = (props) => {
	const { trackCx } = props;
	const cx = trackCx.studio;
	const camera = useFeatureState(trackCx.$camera);
	const zoom = Math.round((camera.view.scale / ZOOM_100_SCALE) * 100);
	return (
		<MenuButton
			className="mm-zoom-button mm-tabular !h-7"
			title="Zoom"
			label={
				<>
					{zoom}%<ChevronDown size={11} strokeWidth={2} />
				</>
			}
			items={[
				cx.commands.item('view.zoomIn'),
				cx.commands.item('view.zoomOut'),
				cx.commands.item('view.zoom100'),
				'separator',
				cx.commands.item('view.fitAll'),
				cx.commands.item('view.fitSelection')
			]}
		/>
	);
};


