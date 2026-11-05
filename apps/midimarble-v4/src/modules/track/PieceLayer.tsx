import { useFeatureState } from 'feature-react/state';
import React from 'react';
import { trackPieceColors, pieceKind, worldToScreen } from '@/modules/scene';
import { shownDepth, type TResolvedPiece } from '@/modules/simulation';
import type { TrackCx } from './TrackCx';
import { paletteOf, BowlShape, isFinitePoint, projectedOutline, RailPathsShape, RailShape, TunnelShape, type TScreenProjection } from '@/modules/canvas';

/**
 * Pieces the overlay draws in screen space: rails and tunnels, which are thin lines on the wall, and a
 * stand-in for any platform or windmill that would be thinner than a few pixels. Like Figma keeps a 1 px
 * stroke at any zoom, every piece stays visible.
 */
export const PieceLayer: React.FC<TPieceLayerProps> = (props) => {
	const { trackCx } = props;
	const cx = trackCx.studio;
	const result = useFeatureState(cx.simulation.$result);
	const { projection, scale, transform } = usePannedProjection(trackCx);
	const viewport = useFeatureState(trackCx.$viewport);
	useFeatureState(trackCx.$override);
	useFeatureState(trackCx.$placing);
	useFeatureState(cx.$hidden);
	useFeatureState(cx.$history);
	// Until the canvas is measured every point projects to NaN, which the browser reports for each attribute
	if (result == null || viewport.width <= 1) return null;

	return (
		<g transform={transform}>
			{trackCx.displayPieces(result).map((piece) => (
				<PieceShape key={piece.entityId} projection={projection} piece={piece} scale={scale} palette={trackPieceColors(cx.project, piece.entityId, piece.type)} />
			))}
		</g>
	);
};

interface TPieceLayerProps {
	trackCx: TrackCx;
}

const PieceShape = React.memo(function PieceShape(props: { projection: TScreenProjection; piece: TResolvedPiece; scale: number; palette: { bar: string; nub: string } }) {
	const { projection, piece, scale, palette } = props;
	const kind = pieceKind(piece);
	if (kind === 'path') return <RailShape projection={projection} piece={piece} scale={scale} opacity={1} palette={palette} />;
	if (kind === 'tube') return <TunnelShape projection={projection} piece={piece} scale={scale} opacity={1} palette={palette} />;
	if (kind === 'generated') return <RailPathsShape projection={projection} piece={piece} scale={scale} opacity={1} palette={palette} />;
	if (kind === 'catcher') return <BowlShape projection={projection} piece={piece} scale={scale} opacity={1} palette={palette} />;
	return <MinimumShape projection={projection} piece={piece} palette={palette} />;
});

/**
 * Screen projection for overlay marks that a pan only slides: marks are drawn once per zoom against a view centered on
 * the wall's origin, and `transform` on their parent moves them all with the camera, so playback, Follow and panning
 * write one attribute per frame instead of every mark's. Only a zoom, whose strokes keep their pixel width, redraws them.
 */
export function usePannedProjection(trackCx: TrackCx): { projection: TScreenProjection; scale: number; transform: string } {
	const { center, scale } = useFeatureState(trackCx.$camera).view;
	const { width, height } = useFeatureState(trackCx.$viewport);
	const projection = React.useMemo<TScreenProjection>(() => {
		const origin = { center: { x: 0, y: 0 }, scale };
		const viewport = { width, height };
		return { toScreen: (point) => worldToScreen(origin, viewport, point) };
	}, [scale, width, height]);
	return { projection, scale, transform: `translate(${-center.x * scale} ${center.y * scale})` };
}

/** A screen-space stand-in when a platform or windmill shrinks below a few pixels */
const MinimumShape: React.FC<{ projection: TScreenProjection; piece: TResolvedPiece; palette?: { bar: string; nub: string } }> = (props) => {
	const { projection, piece } = props;
	const palette = props.palette ?? paletteOf(piece.type);
	const outline = projectedOutline(projection, piece);
	if (!outline.length || !outline.every(isFinitePoint)) return null;
	if (pieceKind(piece) === 'rotor') {
		const center = projection.toScreen(piece.position, shownDepth(piece));
		const reach = Math.max(...outline.map((point) => Math.hypot(point.x - center.x, point.y - center.y)));
		if (reach >= 8) return null;
		return <circle cx={center.x} cy={center.y} r={4} fill={palette.bar} stroke={palette.nub} strokeWidth={1} />;
	}
	const [a, b, c, d] = outline;
	if (a == null || b == null || c == null || d == null) return null;
	const thickness = Math.hypot(d.x - a.x, d.y - a.y);
	const start = { x: (a.x + d.x) / 2, y: (a.y + d.y) / 2 };
	const end = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
	const length = Math.hypot(end.x - start.x, end.y - start.y);
	if (thickness >= 2.5 && length >= 6) return null;
	// Keep at least 6 px of length around the center and 2.5 px of thickness
	const grow = Math.max(0, 6 - length) / 2 / (length || 1);
	const from = { x: start.x - (end.x - start.x) * grow, y: start.y - (end.y - start.y) * grow };
	const to = { x: end.x + (end.x - start.x) * grow, y: end.y + (end.y - start.y) * grow };
	return <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={palette.bar} strokeWidth={2.5} strokeLinecap="round" />;
};
