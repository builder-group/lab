import React from 'react';
import type { TResolvedPiece } from '@/modules/simulation';
import type { TrackCx } from './TrackCx';
import { PieceBody, toPoints } from '@/modules/canvas';

/**
 * A hint's piece, dashed and see-through in its marble's color, like Figma's drop preview in one neutral color: a hint
 * never reads as an error. Red only when it doesn't fit, with its reason beside it or in the bar
 */
export const GhostPiece: React.FC<{ trackCx: TrackCx; piece: TResolvedPiece; scale: number; isOk: boolean; color: string }> = (props) => {
	const { trackCx, piece, scale, isOk, color } = props;
	const tint = isOk ? color : 'var(--bad)';
	const drawSolid = (): React.ReactNode => {
		const outline = trackCx.screenOutline(piece);
		// Colors come in as variables so dark mode can lighten the outline and raise the fill (styles.css)
		const style = { '--ghost-fill': tint, '--ghost-stroke': tint } as React.CSSProperties;
		return <polygon className="mm-ghost-piece" data-ok={isOk} points={toPoints(outline)} style={style} strokeWidth={1.25} strokeDasharray="4 3" strokeLinejoin="round" />;
	};
	return <PieceBody projection={trackCx} piece={piece} scale={scale} opacity={0.75} dashed tint={tint} solid={drawSolid} />;
};
