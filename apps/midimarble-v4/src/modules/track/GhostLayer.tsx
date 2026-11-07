import React from 'react';
import type { TResolvedPiece } from '@/modules/simulation';
import type { TrackCx } from './TrackCx';
import { paletteOf, PieceBody, toPoints } from '@/modules/canvas';

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
