import { useFeatureState } from 'feature-react/state';
import React from 'react';
import type { TVec2 } from '@/modules/project';
import type { TResolvedPiece } from '@/modules/simulation';
import type { ComposeCx } from './ComposeCx';
import { paletteOf } from './ComposeRenderer';
import { acceptableCount, type TGhost } from './ghosts';
import { RailShape, toPoints, TunnelShape } from './PieceLayer';
import { pieceKind } from './scene';

/** Suggested pieces drawn dashed and see-through in place, with the dots they would produce */
export const GhostShapes: React.FC<TGhostLayerProps> = (props) => {
	const { compose } = props;
	const state = useFeatureState(compose.assist.$ghosts);
	const camera = useFeatureState(compose.$camera);
	useFeatureState(compose.$viewport);
	const project = useFeatureState(compose.studio.$history)?.present;
	const { ghost } = state;
	if (ghost == null || project == null) return null;
	const laneColor = project.music.lanes.find((lane) => lane.id === ghost.answer.laneId)?.color ?? 'var(--text)';

	if (ghost.kind === 'gap') {
		const { piece, track } = ghost.answer;
		const points = track.map((point) => compose.toScreen(point));
		const end = points[points.length - 1];
		return (
			<g className="mm-ghost-in">
				<polyline points={toPoints(points)} fill="none" stroke={laneColor} strokeWidth={1.5} strokeDasharray="2 4" strokeLinecap="round" opacity={0.8} />
				{piece != null ? <GhostPiece compose={compose} piece={piece} scale={camera.view.scale} isOk /> : null}
				{end != null ? <GhostDot position={end} color={ghost.answer.check?.isDotInFrame === false ? 'var(--bad)' : laneColor} /> : null}
			</g>
		);
	}

	return (
		<g className="mm-ghost-in">
			{ghost.answer.suggestions.map((suggestion) => (
				<g key={suggestion.hitId}>
					{suggestion.piece != null ? <GhostPiece compose={compose} piece={suggestion.piece} scale={camera.view.scale} isOk={suggestion.isOk} /> : null}
					{suggestion.dot != null ? <GhostDot position={compose.toScreen(suggestion.dot)} color={suggestion.isOk ? laneColor : 'var(--bad)'} /> : null}
				</g>
			))}
		</g>
	);
};

interface TGhostLayerProps {
	compose: ComposeCx;
}

const GhostPiece: React.FC<{ compose: ComposeCx; piece: TResolvedPiece; scale: number; isOk: boolean }> = (props) => {
	const { compose, piece, scale, isOk } = props;
	const kind = pieceKind(piece);
	const tint = isOk ? undefined : 'var(--bad)';
	if (kind === 'path') return <RailShape compose={compose} piece={piece} scale={scale} opacity={0.75} dashed tint={tint} />;
	if (kind === 'tube') return <TunnelShape compose={compose} piece={piece} scale={scale} opacity={0.75} dashed tint={tint} />;
	const palette = paletteOf(piece.type);
	const outline = compose.screenOutline(piece);
	return (
		<polygon
			points={toPoints(outline)}
			fill={palette.bar}
			fillOpacity={isOk ? 0.22 : 0.1}
			stroke={isOk ? palette.nub : 'var(--bad)'}
			strokeWidth={1.25}
			strokeDasharray="4 3"
			strokeLinejoin="round"
		/>
	);
};

const GhostDot: React.FC<{ position: TVec2; color: string }> = (props) => {
	const { position, color } = props;
	return <circle cx={position.x} cy={position.y} r={4} fill="var(--canvas)" fillOpacity={0.7} stroke={color} strokeWidth={1.25} strokeDasharray="2 2" />;
};

/**
 * Inline hint next to the first ghost, like tab completion in a code editor: what Tab or Return adds and
 * that Escape hides it. While a rail is being searched it says so instead.
 */
export const GhostHint: React.FC<TGhostLayerProps> = (props) => {
	const { compose } = props;
	const state = useFeatureState(compose.assist.$ghosts);
	useFeatureState(compose.$camera);
	const viewport = useFeatureState(compose.$viewport);
	const result = useFeatureState(compose.studio.simulation.$result);
	const drag = useFeatureState(compose.$drag);
	if (drag != null) return null;

	let anchor: TVec2 | null = null;
	let content: React.ReactNode = null;
	if (state.pendingGap != null) {
		const { laneId, toHitId } = state.pendingGap;
		const dot = result?.hits.find((hit) => hit.laneId === laneId && hit.hitId === toHitId)?.dot;
		anchor = dot != null ? compose.toScreen(dot) : null;
		content = <span className="text-[var(--text-secondary)]">Finding a rail for this gap…</span>;
	} else if (state.ghost != null) {
		anchor = hintAnchor(compose, state.ghost);
		content = <HintContent compose={compose} ghost={state.ghost} />;
	}
	if (anchor == null || content == null) return null;
	// Keep the hint inside the canvas, clear of the corner controls and the tool bar
	const left = Math.min(Math.max(anchor.x + 14, 8), viewport.width - 240);
	const top = Math.min(Math.max(anchor.y - 12, 52), viewport.height - 120);
	return (
		<div className="mm-hint mm-ghost-in absolute z-10" style={{ left, top }}>
			{content}
		</div>
	);
};

const HintContent: React.FC<{ compose: ComposeCx; ghost: TGhost }> = (props) => {
	const { compose, ghost } = props;
	const count = acceptableCount(ghost);
	const accept = (): void => {
		compose.assist.acceptGhosts();
	};
	if (ghost.kind === 'gap') {
		const { check, type } = ghost.answer;
		const label = type === 'rail' ? 'Rail' : 'Tunnel';
		const note = check == null ? null : !check.isDotInFrame ? 'next dot leaves the frame' : check.leaveTime == null ? 'marble stays on it' : null;
		return (
			<>
				<button className="mm-hint-action" tabIndex={-1} onPointerDown={(event) => event.preventDefault()} onClick={accept} type="button">
					<kbd className="mm-keycap">↩</kbd>
					Add {label.toLowerCase()} across the gap
				</button>
				{note != null ? <span className="text-[var(--warn)]">· {note}</span> : null}
				<span className="text-[var(--text-tertiary)]">
					<kbd className="mm-keycap">esc</kbd>
				</span>
			</>
		);
	}
	const pattern = ghost.answer.pattern === 'mirror' ? 'zigzag' : 'repeat';
	return (
		<>
			<button className="mm-hint-action" tabIndex={-1} onPointerDown={(event) => event.preventDefault()} onClick={accept} type="button">
				<kbd className="mm-keycap">tab</kbd>
				Continue {count}
			</button>
			<span className="text-[var(--text-secondary)]">{pattern}</span>
			<span className="text-[var(--text-tertiary)]">
				<kbd className="mm-keycap">esc</kbd>
			</span>
		</>
	);
};

/** Screen point right of the first ghost piece */
function hintAnchor(compose: ComposeCx, ghost: TGhost): TVec2 | null {
	const piece = ghost.kind === 'gap' ? ghost.answer.piece : (ghost.answer.suggestions.find((suggestion) => suggestion.piece != null)?.piece ?? null);
	if (piece == null) return null;
	const outline = compose.screenOutline(piece);
	if (!outline.length) return null;
	const right = outline.reduce((best, point) => (point.x > best.x ? point : best));
	const top = Math.min(...outline.map((point) => point.y));
	return { x: right.x, y: top };
}
