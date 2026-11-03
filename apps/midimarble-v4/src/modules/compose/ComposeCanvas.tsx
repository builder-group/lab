import { useFeatureState } from 'feature-react/state';
import { Anchor, Box, ChevronsRight, FlipHorizontal2, Link2, Magnet, Repeat2, Square, WandSparkles } from 'lucide-react';
import React from 'react';
import { openContextMenu } from '@/components';
import type { TPathNode, TProject, TVec2 } from '@/modules/project';
import { frameBand, type THitResult, type TResolvedPiece, type TSimulationResult } from '@/modules/simulation';
import { formatTime, noteName } from '@/modules/studio/format';
import { laneMenu, pieceMenu } from '@/modules/studio/menus';
import { parseHitKey } from '@/modules/studio/selection';
import type { StudioCx } from '@/modules/studio/StudioCx';
import { formatDegrees, parseDegrees, toDegrees } from './angles';
import type { TPose } from './attach-edit';
import { mapNodes, nodesPathData } from './bezier';
import { ComposeCx } from './ComposeCx';
import { paletteOf } from './ComposeRenderer';
import { acceptableCount } from './ghosts';
import { GhostHint, GhostShapes } from './GhostLayer';
import { canvasMenu, dotMenu } from './menus';
import { PieceLayer, toPoints } from './PieceLayer';
import { pathRun, pathToWorld, pieceKind } from './scene';
import { badgeStatus, StatusBadge } from './status';
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
		: hover?.kind === 'dot' || hover?.kind === 'track' ? 'pointer'
		: tool !== 'select' ? 'crosshair'
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
			<PenOverlay compose={compose} />
			<GhostHint compose={compose} />
			<AssistBar compose={compose} />
			<CornerControls compose={compose} />
			<SimulatingIndicator cx={cx} />
			<EmptyState compose={compose} />
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

/** First-run guidance: what to do with no hits */
const EmptyState: React.FC<{ compose: ComposeCx }> = (props) => {
	const { compose } = props;
	const cx = compose.studio;
	const project = useFeatureState(cx.$history)?.present;
	const isImporting = useFeatureState(cx.sources.$midiImport) != null;
	if (project == null || isImporting) return null;
	const hasHits = project.music.lanes.some((lane) => lane.hits.length > 0);
	if (hasHits) return null;
	return (
		<div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center">
			<div className="mm-floating pointer-events-auto flex items-center gap-3 py-2 pr-2 pl-3.5">
				<div className="flex flex-col leading-tight">
					<span className="font-semibold">Add Music</span>
					<span className="text-[11px] text-[var(--text-secondary)]">Import a song, or double-click a lane in the timeline to add hits</span>
				</div>
				<button className="mm-button" data-variant="primary" onClick={() => void cx.sources.pickMidi()} type="button">
					MIDI…
				</button>
				<button className="mm-button" onClick={() => void cx.sources.pickAudio()} type="button">
					Audio…
				</button>
			</div>
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
	const tool = useFeatureState(compose.$tool);
	useFeatureState(compose.$override);
	const hidden = useFeatureState(cx.$hidden);
	const project = history?.present;
	if (project == null || result == null || viewport.width <= 1) return null;

	const is2d = camera.mode === '2d';
	const pieces = compose.displayPieces(result);
	const selectedPieces = selectedPieceIds(project, selection);
	const single = selectedPieces.length === 1 ? pieces.find((piece) => piece.entityId === selectedPieces[0]) : undefined;
	const singleKind = single != null ? pieceKind(single) : null;
	const frame = single != null && is2d ? compose.railFrame(single.entityId) : null;
	const isPathPiece = singleKind === 'path' || singleKind === 'tube' || singleKind === 'holder';
	const isMoveDrag = drag?.kind === 'move' && drag.moved;
	const grip = single != null && is2d && !isPathPiece && !isMoveDrag ? compose.screenGrip(single) : null;
	const pathHandles = single != null && is2d && isPathPiece && frame == null && singleKind !== 'holder' ? compose.screenPathHandles(single) : null;
	const isRotating = drag?.kind === 'rotate';
	const showArc = grip != null && (isRotating || (hover?.kind === 'rotate' && hover.entityId === single?.entityId));
	const nextDots = nextOpenHitPerLane(result);
	const band = frameBand(project);
	const hoveredPiece = hover?.kind === 'piece' ? hover.entityId : null;
	const hoveredDot = hover?.kind === 'dot' ? result.hits.find((hit) => hit.status === 'open' && hit.laneId === hover.laneId && hit.hitId === hover.hitId) : undefined;
	const focusedKeys = new Set(selection.filter((key) => parseHitKey(key) != null));
	const longGaps = compose.longGapKeys(project);
	const snap = drag?.kind === 'move' ? drag.snap : null;
	const singleEntity = single != null ? project.entities.find((entity) => entity.id === single.entityId) : undefined;

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
				{drag == null
					? result.pieces.map((piece) => <PieceBadge key={`badge-${piece.entityId}`} compose={compose} piece={piece} result={result} />)
					: null}
				{result.hits.map((hit) => {
					if (hit.status !== 'open' || hit.dot == null) return null;
					const position = compose.toScreen(hit.dot);
					const lane = project.music.lanes.find((item) => item.id === hit.laneId);
					const isNext = nextDots.get(hit.laneId) === hit;
					const isHovered = hoveredDot === hit;
					const isFocused = focusedKeys.has(`hit:${hit.laneId}:${hit.hitId}`);
					const isOutside = hit.outOfFrame ?? Math.abs(hit.dot.x - band.centerX) > band.halfWidth;
					const isLongGap = longGaps.has(`${hit.laneId}:${hit.hitId}`);
					const color = isOutside ? 'var(--bad)' : (lane?.color ?? 'var(--text)');
					return (
						<HitDot
							key={`dot-${hit.laneId}-${hit.hitId}`}
							position={position}
							color={color}
							isNext={isNext && drag == null}
							isHovered={isHovered}
							isFocused={isFocused}
							isLongGap={isLongGap}
						/>
					);
				})}
				{snap?.kind === 'link' ? <SnapRing position={compose.toScreen(snap.dot)} /> : null}
				{is2d
					? project.entities.map((entity) => {
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
				{frame != null && single != null ? <RailNodes compose={compose} entityId={single.entityId} frame={frame} hover={hover} drag={drag} /> : null}
				{hover?.kind === 'track' && drag == null ? (
					<circle cx={hover.position.x} cy={hover.position.y} r={4.5} fill="var(--canvas)" stroke={paletteOf(tool === 'tunnel' ? 'tunnel' : 'windmill').bar} strokeWidth={2} />
				) : null}
				{drag?.kind === 'marquee' ? <Marquee from={drag.from} to={drag.to} /> : null}
			</svg>
			{hoveredDot != null && drag == null ? <DotTooltip compose={compose} project={project} hit={hoveredDot} /> : null}
			{hover?.kind === 'track' && drag == null ? (
				<CanvasTooltip position={hover.position}>
					<span className="font-medium">Anchor here</span>
					<span className="mm-tabular ml-1.5 text-[var(--text-secondary)]">{formatTime(hover.time)}</span>
				</CanvasTooltip>
			) : null}
			{drag?.kind === 'move' && drag.moved ? <SnapChip compose={compose} project={project} drag={drag} /> : null}
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
const HitDot: React.FC<{ position: TVec2; color: string; isNext: boolean; isHovered: boolean; isFocused: boolean; isLongGap: boolean }> = (props) => {
	const { position, color, isNext, isHovered, isFocused, isLongGap } = props;
	const radius = (isNext ? 5 : 4) + (isHovered ? 1.5 : 0);
	const { x, y } = position;
	return (
		<g>
			{isNext ? <circle className="mm-dot-pulse" cx={x} cy={y} r={5} fill="none" stroke={color} strokeWidth={1.5} style={{ transformOrigin: `${x}px ${y}px` }} /> : null}
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

/** What a drop will do, next to the dragged piece: link to a hit, anchor to a moment or stay free */
const SnapChip: React.FC<{ compose: ComposeCx; project: TProject; drag: Extract<ReturnType<ComposeCx['$drag']['get']>, { kind: 'move' }> }> = (props) => {
	const { compose, project, drag } = props;
	const center = compose.toScreen(drag.current.position);
	const snap = drag.snap;
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
				<span className="font-medium">{lane?.name ?? 'Marble'}</span>
				<span className="mm-tabular opacity-70">{formatTime(snap.time)}</span>
			</>
		);
	} else {
		content = <span className="font-medium">Free</span>;
	}
	return (
		<div className="mm-snap-chip" data-snapped={snap != null} style={{ left: center.x + 18, top: center.y + 14 }}>
			{content}
			{snap != null ? <kbd className="opacity-60">⌥ free</kbd> : null}
		</div>
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
	const camera = useFeatureState(compose.$camera);
	const viewport = useFeatureState(compose.$viewport);
	if (project == null || result == null || playing || drag != null || pen != null || tool === 'path' || camera.mode !== '2d') return null;

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
		// Below the ghost piece at the dot when Continue offers one, so the bar never covers it
		const ghost = ghosts.ghost?.kind === 'continue' ? ghosts.ghost.answer.suggestions.find((item) => item.piece != null)?.piece : null;
		const outline = ghost != null ? compose.screenOutline(ghost) : [];
		const dot = compose.toScreen(target.dot);
		anchor = outline.length ? { x: dot.x, y: Math.max(dot.y, ...outline.map((point) => point.y)) + 26 } : { x: dot.x, y: dot.y + 24 };
	}
	// The bar belongs next to what it acts on; when that is out of view it stays away
	if (anchor.x < 0 || anchor.x > viewport.width || anchor.y < 0 || anchor.y > viewport.height + 20) return null;
	const continueCount = ghosts.ghost?.kind === 'continue' ? acceptableCount(ghosts.ghost) : 0;
	const left = Math.min(Math.max(anchor.x, 130), viewport.width - 130);
	const top = Math.min(Math.max(anchor.y, 48), viewport.height - 44);

	return (
		<div className="mm-assist-bar mm-ghost-in" style={{ left, top }} role="toolbar" aria-label="Build">
			<AssistButton label="Next" detail="Place the next hit" shortcut="N" onClick={() => compose.next()} isText>
				Next
			</AssistButton>
			<div className="mm-assist-divider" />
			<AssistButton label="Repeat" detail="Copy the last piece's angle" shortcut="R" onClick={() => compose.step('repeat')}>
				<Repeat2 size={15} strokeWidth={1.7} />
			</AssistButton>
			<AssistButton label="Mirror" detail="Mirror it for a zigzag" shortcut="M" onClick={() => compose.step('mirror')}>
				<FlipHorizontal2 size={15} strokeWidth={1.7} />
			</AssistButton>
			<AssistButton label="Auto Place" detail="Let the solver pick the angle" shortcut="A" onClick={() => compose.assist.autoPlace(compose.placementType())}>
				<WandSparkles size={15} strokeWidth={1.7} />
			</AssistButton>
			{continueCount > 0 ? (
				<>
					<div className="mm-assist-divider" />
					<AssistButton label="Continue" detail={`Accept ${continueCount} suggested pieces · esc hides them`} shortcut="⇥" onClick={() => compose.assist.acceptGhosts()} isText>
						<ChevronsRight size={14} strokeWidth={1.8} />
						Continue {continueCount}
					</AssistButton>
				</>
			) : null}
		</div>
	);
};

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
	const camera = useFeatureState(compose.$camera);
	const snapping = useFeatureState(compose.studio.$snapping);
	return (
		<div className="mm-floating mm-tooltip-below absolute top-3 right-3 z-20 flex items-center gap-0.5 p-[3px]">
			<button
				className="mm-tool-button !h-7 !w-7"
				data-active={snapping}
				aria-label="Snap to dots and trajectories"
				aria-pressed={snapping}
				onClick={() => compose.studio.$snapping.set(!snapping)}
				type="button"
			>
				<Magnet size={14} strokeWidth={1.7} />
				<span className="mm-tooltip">Snap to dots and trajectories · hold ⌥ to skip</span>
			</button>
			<div className="mx-0.5 h-4 w-px bg-[var(--separator)]" />
			<div className="flex" role="radiogroup" aria-label="View">
				<button className="mm-tool-button !h-7 !w-7" data-active={camera.mode === '2d'} aria-label="2D wall view" onClick={() => compose.setMode('2d')} type="button">
					<Square size={14} strokeWidth={1.7} />
					<span className="mm-tooltip">Wall view</span>
				</button>
				<button className="mm-tool-button !h-7 !w-7" data-active={camera.mode === 'orbit'} aria-label="Orbit view" onClick={() => compose.setMode('orbit')} type="button">
					<Box size={14} strokeWidth={1.7} />
					<span className="mm-tooltip">Orbit · middle mouse</span>
				</button>
			</div>
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
