import React from 'react';
import type { TVec2 } from '@/modules/project';
import { shownDepth, type TResolvedPiece } from '@/modules/simulation';
import { paletteOf } from './TrackRenderer';
import { offsetPolyline, pieceOutline, tubeCeiling } from '@/modules/scene';

// The shapes of the pieces the overlays draw in screen space, on the Track canvas and over the Film's Draft Preview.

/** Outline of a piece as `projection` draws it, see `pieceOutline` */
export function projectedOutline(projection: TScreenProjection, piece: TResolvedPiece): TVec2[] {
	const depth = shownDepth(piece);
	return pieceOutline(piece).map((corner) => projection.toScreen(corner, depth));
}

/** Two wires with ties between them, like a toy rail seen from the front */
export const RailShape: React.FC<TShapeProps> = (props) => {
	const { projection, piece, scale, opacity, dashed = false, tint } = props;
	const palette = props.palette ?? paletteOf(piece.type);
	const path = finitePoints((piece.path ?? []).map((point) => projection.toScreen(point)));
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
	const { projection, piece, scale, opacity, dashed = false, tint } = props;
	const palette = props.palette ?? paletteOf(piece.type);
	const floor = finitePoints((piece.path ?? []).map((point) => projection.toScreen(point)));
	const ceiling = finitePoints(tubeCeiling(piece).map((point) => projection.toScreen(point)));
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

/** A Rail's several paths as single wires */
export const RailPathsShape: React.FC<TShapeProps> = (props) => {
	const { projection, piece, scale, opacity, dashed = false, tint } = props;
	const palette = props.palette ?? paletteOf(piece.type);
	const wire = Math.max((piece.params['radius'] ?? 0.0025) * 2 * scale, 1.5);
	const color = tint ?? palette.bar;
	return (
		<g opacity={opacity}>
			{(piece.paths ?? []).map((line) => (
				<polyline
					key={line.map((point) => `${point.x.toFixed(5)},${point.y.toFixed(5)}`).join(' ')}
					points={toPoints(line.map((point) => projection.toScreen(point)))}
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

/**
 * A Bowl as a clear cage: its wire drawn like a rail, two thin lines with a pale band between them, like the clear wire
 * catcher of the reference short
 */
export const BowlShape: React.FC<TShapeProps> = (props) => {
	const { piece } = props;
	return (
		<g>
			{(piece.paths ?? []).map((line) => (
				<RailShape key={line.map((point) => `${point.x.toFixed(5)},${point.y.toFixed(5)}`).join(' ')} {...props} piece={{ ...piece, path: line }} />
			))}
		</g>
	);
};

/** What the shapes need to draw: wall points to CSS pixels, as the Track canvas or the Film Draft Preview projects them */
export interface TScreenProjection {
	toScreen: (point: TVec2, z?: number) => TVec2;
}

interface TShapeProps {
	projection: TScreenProjection;
	piece: TResolvedPiece;
	scale: number;
	opacity: number;
	dashed?: boolean;
	/** Overrides the wire or wall color, for ghosts that will not fit */
	tint?: string;
	/** Overrides the piece type's colors, for a theme's look */
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

export function isFinitePoint(point: TVec2): boolean {
	return Number.isFinite(point.x) && Number.isFinite(point.y);
}
