import { useFeatureState } from 'feature-react/state';
import React from 'react';
import type { TVec2 } from '@/modules/project';
import { PACE_LIMIT, type TResolvedPiece } from '@/modules/simulation';
import type { TrackCx } from './TrackCx';
import { paletteOf, BowlShape, RailShape, RailPathsShape, toPoints, TunnelShape } from '@/modules/canvas';
import { acceptableCount, type TGhost } from './ghosts';
import { pieceKind } from '@/modules/scene';

/** Suggested pieces drawn dashed and see-through in place, with the dots they would produce */
export const GhostShapes: React.FC<TGhostLayerProps> = (props) => {
	const { trackCx } = props;
	const state = useFeatureState(trackCx.studio.assist.$ghosts);
	const camera = useFeatureState(trackCx.$camera);
	const viewport = useFeatureState(trackCx.$viewport);
	const project = useFeatureState(trackCx.studio.$history)?.present;
	// Suggestions belong to the run before an edit; while an element is dragged or drawn they would mislead
	const isEditing = useFeatureState(trackCx.$override) != null;
	const { ghost } = state;
	if (ghost == null || project == null || isEditing || viewport.width <= 1) return null;
	const marbleColor = project.music.lanes.find((lane) => lane.id === ghost.answer.marbleId)?.color ?? 'var(--text)';

	if (ghost.kind === 'gap') {
		const { piece, track } = ghost.answer;
		const points = track.map((point) => trackCx.toScreen(point));
		const end = points[points.length - 1];
		return (
			<g className="mm-ghost-in">
				<polyline points={toPoints(points)} fill="none" stroke={marbleColor} strokeWidth={1.5} strokeDasharray="2 4" strokeLinecap="round" opacity={0.8} />
				{piece != null ? <GhostPiece trackCx={trackCx} piece={piece} scale={camera.view.scale} isOk /> : null}
				{end != null ? <GhostDot position={end} color={ghost.answer.check?.isDotInFrame === false ? 'var(--bad)' : marbleColor} /> : null}
			</g>
		);
	}

	if (ghost.kind === 'place') {
		const { piece, nextDot, isOk } = ghost.answer;
		return (
			<g className="mm-ghost-in">
				<GhostPiece trackCx={trackCx} piece={piece} scale={camera.view.scale} isOk={isOk} />
				{nextDot != null ? <GhostDot position={trackCx.toScreen(nextDot)} color={marbleColor} /> : null}
			</g>
		);
	}

	return (
		<g className="mm-ghost-in">
			{ghost.answer.suggestions.map((suggestion) => (
				<g key={suggestion.hitId}>
					{suggestion.piece != null ? <GhostPiece trackCx={trackCx} piece={suggestion.piece} scale={camera.view.scale} isOk={suggestion.isOk} /> : null}
					{suggestion.dot != null ? <GhostDot position={trackCx.toScreen(suggestion.dot)} color={suggestion.isOk ? marbleColor : 'var(--bad)'} /> : null}
				</g>
			))}
		</g>
	);
};

interface TGhostLayerProps {
	trackCx: TrackCx;
}

export const GhostPiece: React.FC<{ trackCx: TrackCx; piece: TResolvedPiece; scale: number; isOk: boolean }> = (props) => {
	const { trackCx, piece, scale, isOk } = props;
	const kind = pieceKind(piece);
	const tint = isOk ? undefined : 'var(--bad)';
	if (kind === 'path') return <RailShape projection={trackCx} piece={piece} scale={scale} opacity={0.75} dashed tint={tint} />;
	if (kind === 'tube') return <TunnelShape projection={trackCx} piece={piece} scale={scale} opacity={0.75} dashed tint={tint} />;
	if (kind === 'generated') return <RailPathsShape projection={trackCx} piece={piece} scale={scale} opacity={0.75} dashed tint={tint} />;
	if (kind === 'catcher') return <BowlShape projection={trackCx} piece={piece} scale={scale} opacity={0.75} dashed tint={tint} />;
	const palette = paletteOf(piece.type);
	const outline = trackCx.screenOutline(piece);
	// Colors come in as variables so dark mode can lighten the outline and raise the fill (styles.css)
	const style = { '--ghost-fill': palette.bar, '--ghost-stroke': isOk ? palette.nub : 'var(--bad)' } as React.CSSProperties;
	return <polygon className="mm-ghost-piece" data-ok={isOk} points={toPoints(outline)} style={style} strokeWidth={1.25} strokeDasharray="4 3" strokeLinejoin="round" />;
};

const GhostDot: React.FC<{ position: TVec2; color: string }> = (props) => {
	const { position, color } = props;
	return <circle cx={position.x} cy={position.y} r={4} fill="var(--canvas)" fillOpacity={0.7} stroke={color} strokeWidth={1.25} strokeDasharray="2 2" />;
};

/**
 * Inline hint next to the first ghost, like tab completion in a code editor: what Tab or Return adds and
 * that Escape hides it. While a gap piece is being searched it says so instead.
 */
export const GhostHint: React.FC<TGhostLayerProps> = (props) => {
	const { trackCx } = props;
	const state = useFeatureState(trackCx.studio.assist.$ghosts);
	// The hint is placed at a screen position, so it moves with the view
	useFeatureState(trackCx.$camera);
	const viewport = useFeatureState(trackCx.$viewport);
	const result = useFeatureState(trackCx.studio.simulation.$result);
	const drag = useFeatureState(trackCx.$drag);
	if (drag != null) return null;

	let anchor: TVec2 | null = null;
	let content: React.ReactNode = null;
	if (state.pendingGap != null) {
		const { marbleId, toHitId } = state.pendingGap;
		const dot = result?.hits.find((hit) => hit.marbleId === marbleId && hit.hitId === toHitId)?.dot;
		anchor = dot != null ? trackCx.toScreen(dot) : null;
		content = <span className="text-[var(--text-secondary)]">Finding a rail for this gap…</span>;
	} else if (state.ghost?.kind === 'gap' || state.ghost?.kind === 'place') {
		// Continue is offered in the contextual build bar; a dot's piece and gap pieces keep their own hint
		anchor = hintAnchor(trackCx, state.ghost);
		content = <HintContent trackCx={trackCx} ghost={state.ghost} />;
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

const HintContent: React.FC<{ trackCx: TrackCx; ghost: TGhost }> = (props) => {
	const { trackCx, ghost } = props;
	const count = acceptableCount(ghost);
	const accept = (): void => {
		trackCx.studio.assist.acceptGhosts();
	};
	if (ghost.kind === 'place') {
		const { type, isOk } = ghost.answer;
		return (
			<>
				<button className="mm-hint-action" tabIndex={-1} onPointerDown={(event) => event.preventDefault()} onClick={accept} type="button">
					<kbd className="mm-keycap">↩</kbd>
					Add {type}
				</button>
				{isOk ? null : <span className="text-[var(--warn)]">· next note leaves the frame</span>}
				<span className="text-[var(--text-tertiary)]">
					<kbd className="mm-keycap">esc</kbd>
				</span>
			</>
		);
	}
	if (ghost.kind === 'gap') {
		const { check, type } = ghost.answer;
		const label = type === 'tunnel' ? 'Tunnel' : 'Rail';
		const offPace = check?.paceError != null && Math.abs(check.paceError) > PACE_LIMIT ? `next dot ${Math.abs(check.paceError).toFixed(2)} m off the descent` : null;
		const note = check == null ? null : !check.isDotInFrame ? 'next dot leaves the frame' : check.leaveTime == null ? 'marble stays on it' : offPace;
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
function hintAnchor(trackCx: TrackCx, ghost: TGhost): TVec2 | null {
	const piece = ghost.kind !== 'continue' ? ghost.answer.piece : (ghost.answer.suggestions.find((suggestion) => suggestion.piece != null)?.piece ?? null);
	if (piece == null) return null;
	const outline = trackCx.screenOutline(piece);
	if (!outline.length) return null;
	const right = outline.reduce((best, point) => (point.x > best.x ? point : best));
	const top = Math.min(...outline.map((point) => point.y));
	return { x: right.x, y: top };
}
