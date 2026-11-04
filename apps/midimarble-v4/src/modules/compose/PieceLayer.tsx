import { useFeatureState } from 'feature-react/state';
import React from 'react';
import type { TVec2 } from '@/modules/project';
import type { TResolvedPiece } from '@/modules/simulation';
import type { ComposeCx } from './ComposeCx';
import { paletteOf } from './ComposeRenderer';
import { offsetPolyline, pieceKind, tubeCeiling } from './scene';

/**
 * Pieces the overlay draws in screen space: rails and tunnels, which are thin lines on the wall, and a
 * stand-in for any platform or windmill that would be thinner than a few pixels. Like Figma keeps a 1 px
 * stroke at any zoom, every piece stays visible.
 */
export const PieceLayer: React.FC<TPieceLayerProps> = (props) => {
	const { compose } = props;
	const cx = compose.studio;
	const result = useFeatureState(cx.simulation.$result);
	useFeatureState(compose.$camera);
	const viewport = useFeatureState(compose.$viewport);
	useFeatureState(cx.$playhead);
	useFeatureState(cx.$selection);
	useFeatureState(cx.$playing);
	useFeatureState(compose.$override);
	useFeatureState(compose.$placing);
	useFeatureState(cx.$hidden);
	// Until the canvas is measured every point projects to NaN, which the browser reports for each attribute
	if (result == null || viewport.width <= 1) return null;
	const scale = compose.screenScale();

	return (
		<g>
			{compose.displayPieces(result).map((piece) => {
				const kind = pieceKind(piece);
				if (kind === 'path') return <RailShape key={piece.entityId} compose={compose} piece={piece} scale={scale} opacity={1} />;
				if (kind === 'tube') return <TunnelShape key={piece.entityId} compose={compose} piece={piece} scale={scale} opacity={1} />;
				if (kind === 'holder') return <SwitchbackShape key={piece.entityId} compose={compose} piece={piece} scale={scale} opacity={1} />;
				return <MinimumShape key={piece.entityId} compose={compose} piece={piece} />;
			})}
		</g>
	);
};

interface TPieceLayerProps {
	compose: ComposeCx;
}

/** Two wires with ties between them, like a toy rail seen from the front */
export const RailShape: React.FC<TShapeProps> = (props) => {
	const { compose, piece, scale, opacity, dashed = false, tint } = props;
	const palette = props.palette ?? paletteOf(piece.type);
	const path = finitePoints((piece.path ?? []).map((point) => compose.toScreen(point)));
	if (path.length < 2) return null;
	const radius = piece.params['radius'] ?? 0.0025;
	const wire = Math.max(radius * scale * 0.9, 1.25);
	const spread = Math.max(radius * scale * 1.3, 2);
	const left = offsetPolyline(path, spread);
	const right = offsetPolyline(path, -spread);
	const color = tint ?? palette.bar;
	const dash = dashed ? '5 4' : undefined;
	return (
		<g opacity={opacity}>
			{dashed ? null : <polyline points={toPoints(path)} fill="none" stroke={palette.bar} strokeOpacity={0.18} strokeWidth={spread * 2} strokeLinejoin="round" />}
			{dashed ? null : <RailTies path={path} spread={spread} scale={scale} color={palette.nub} />}
			<polyline points={toPoints(left)} fill="none" stroke={color} strokeWidth={wire} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} />
			<polyline points={toPoints(right)} fill="none" stroke={color} strokeWidth={wire} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} />
		</g>
	);
};

/** A translucent tube between the floor and the ceiling, open at the mouth where the marble drops in */
export const TunnelShape: React.FC<TShapeProps> = (props) => {
	const { compose, piece, scale, opacity, dashed = false, tint } = props;
	const palette = props.palette ?? paletteOf(piece.type);
	const floor = finitePoints((piece.path ?? []).map((point) => compose.toScreen(point)));
	const ceiling = finitePoints(tubeCeiling(piece).map((point) => compose.toScreen(point)));
	if (floor.length < 2) return null;
	const wall = Math.max((piece.params['radius'] ?? 0.002) * 2 * scale, 1.5);
	const stroke = tint ?? palette.nub;
	const dash = dashed ? '5 4' : undefined;
	return (
		<g opacity={opacity}>
			{ceiling.length >= 2 ? (
				<polygon points={toPoints([...floor, ...[...ceiling].reverse()])} fill={palette.bar} fillOpacity={dashed ? 0.12 : 0.3} stroke="none" />
			) : null}
			<polyline points={toPoints(floor)} fill="none" stroke={stroke} strokeWidth={wall} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} />
			{ceiling.length >= 2 ? (
				<polyline points={toPoints(ceiling)} fill="none" stroke={stroke} strokeWidth={wall} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} />
			) : null}
		</g>
	);
};

/** Walls and legs of a switchback as single wires */
export const SwitchbackShape: React.FC<TShapeProps> = (props) => {
	const { compose, piece, scale, opacity, dashed = false, tint } = props;
	const palette = props.palette ?? paletteOf(piece.type);
	const wire = Math.max((piece.params['radius'] ?? 0.0025) * 2 * scale, 1.5);
	const color = tint ?? palette.bar;
	return (
		<g opacity={opacity}>
			{(piece.paths ?? []).map((line) => (
				<polyline
					key={line.map((point) => `${point.x.toFixed(5)},${point.y.toFixed(5)}`).join(' ')}
					points={toPoints(line.map((point) => compose.toScreen(point)))}
					fill="none"
					stroke={color}
					strokeWidth={wire}
					strokeLinecap="round"
					strokeDasharray={dashed ? '5 4' : undefined}
				/>
			))}
		</g>
	);
};

/** What the shapes need to draw: wall points to CSS pixels, as the Compose canvas or the Film Draft Preview projects them */
export interface TScreenProjection {
	toScreen: (point: TVec2, z?: number) => TVec2;
}

interface TShapeProps {
	compose: TScreenProjection;
	piece: TResolvedPiece;
	scale: number;
	opacity: number;
	dashed?: boolean;
	/** Overrides the wire or wall colour, for ghosts that will not fit */
	tint?: string;
	/** Overrides the piece type's colours, for a theme's look */
	palette?: { bar: string; nub: string };
}

/** Ties every 2.5 cm along the rail, left out when they would crowd together on screen */
const RailTies: React.FC<{ path: TVec2[]; spread: number; scale: number; color: string }> = (props) => {
	const { path, spread, scale, color } = props;
	const spacing = 0.025 * scale;
	if (spacing < 7) return null;
	const ties: React.ReactElement[] = [];
	let carried = spacing / 2;
	for (let i = 1; i < path.length; i++) {
		const a = path[i - 1] as TVec2;
		const b = path[i] as TVec2;
		const length = Math.hypot(b.x - a.x, b.y - a.y);
		if (length <= 0) continue;
		const nx = -(b.y - a.y) / length;
		const ny = (b.x - a.x) / length;
		for (let along = carried; along < length; along += spacing) {
			const x = a.x + ((b.x - a.x) * along) / length;
			const y = a.y + ((b.y - a.y) * along) / length;
			ties.push(
				<line
					key={`${i}-${along.toFixed(1)}`}
					x1={x - nx * spread}
					y1={y - ny * spread}
					x2={x + nx * spread}
					y2={y + ny * spread}
					stroke={color}
					strokeWidth={1}
					strokeOpacity={0.55}
				/>
			);
		}
		carried = (carried - length) % spacing;
		if (carried < 0) carried += spacing;
	}
	return <>{ties}</>;
};

/** A screen-space stand-in when a platform or windmill shrinks below a few pixels */
const MinimumShape: React.FC<{ compose: ComposeCx; piece: TResolvedPiece; palette?: { bar: string; nub: string } }> = (props) => {
	const { compose, piece } = props;
	const palette = props.palette ?? paletteOf(piece.type);
	const outline = compose.screenOutline(piece);
	if (!outline.length || !outline.every(isFinitePoint)) return null;
	if (pieceKind(piece) === 'rotor') {
		const center = compose.toScreen(piece.position, piece.params['depth'] ?? 0.03);
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
	// Keep at least 6 px of length around the centre and 2.5 px of thickness
	const grow = Math.max(0, 6 - length) / 2 / (length || 1);
	const from = { x: start.x - (end.x - start.x) * grow, y: start.y - (end.y - start.y) * grow };
	const to = { x: end.x + (end.x - start.x) * grow, y: end.y + (end.y - start.y) * grow };
	return <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={palette.bar} strokeWidth={2.5} strokeLinecap="round" />;
};


/** SVG `points` of screen points, leaving out any that did not project to a number */
export function toPoints(points: TVec2[]): string {
	return finitePoints(points)
		.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
		.join(' ');
}

/** The points whose coordinates are both finite */
function finitePoints(points: TVec2[]): TVec2[] {
	return points.every(isFinitePoint) ? points : points.filter(isFinitePoint);
}

function isFinitePoint(point: TVec2): boolean {
	return Number.isFinite(point.x) && Number.isFinite(point.y);
}
