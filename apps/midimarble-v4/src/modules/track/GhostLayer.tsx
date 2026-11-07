import { useFeatureState } from 'feature-react/state';
import React from 'react';
import type { TVec2 } from '@/modules/project';
import type { TResolvedPiece } from '@/modules/simulation';
import type { TrackCx } from './TrackCx';
import { paletteOf, PieceBody, toPoints } from '@/modules/canvas';

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
	const marbleColor = project.marbles.find((marble) => marble.id === ghost.answer.marbleId)?.labelColor ?? 'var(--text)';

	if (ghost.kind === 'gap') {
		const { resolved: piece, track } = ghost.answer;
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
		const { resolved: piece, nextDot, isOk } = ghost.answer;
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
					{suggestion.resolved != null ? <GhostPiece trackCx={trackCx} piece={suggestion.resolved} scale={camera.view.scale} isOk={suggestion.isOk} /> : null}
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
	const drawSolid = (): React.ReactNode => {
		const palette = paletteOf(piece.type);
		const outline = trackCx.screenOutline(piece);
		// Colors come in as variables so dark mode can lighten the outline and raise the fill (styles.css)
		const style = { '--ghost-fill': palette.bar, '--ghost-stroke': isOk ? palette.nub : 'var(--bad)' } as React.CSSProperties;
		return <polygon className="mm-ghost-piece" data-ok={isOk} points={toPoints(outline)} style={style} strokeWidth={1.25} strokeDasharray="4 3" strokeLinejoin="round" />;
	};
	return <PieceBody projection={trackCx} piece={piece} scale={scale} opacity={0.75} dashed tint={isOk ? undefined : 'var(--bad)'} solid={drawSolid} />;
};

const GhostDot: React.FC<{ position: TVec2; color: string }> = (props) => {
	const { position, color } = props;
	return <circle cx={position.x} cy={position.y} r={4} fill="var(--canvas)" fillOpacity={0.7} stroke={color} strokeWidth={1.25} strokeDasharray="2 2" />;
};
