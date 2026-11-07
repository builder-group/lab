import React from 'react';
import { DEFAULT_MARBLE_RADIUS, type TVec2 } from '@/modules/project';
import { layoutOf, resolvePiecePath, type TResolvedPiece } from '@/modules/simulation';
import { createFreePiece, displayPiece } from '@/modules/building';
import { paletteOf } from '@/modules/canvas';
import type { TInsertItem } from './library';
import { offsetPolyline, tubeCeiling } from '@/modules/scene';

/**
 * Small drawing of a library item from its real default geometry, with the marble and a dashed line for
 * what it does: bounce, ride, drop through, strike or zigzag
 */
export const PiecePreview: React.FC<TPiecePreviewProps> = (props) => {
	const { item, width = 88, height = 52 } = props;
	const scene = React.useMemo(() => previewScene(item), [item]);
	const padding = 6;
	const spanX = scene.bounds.maxX - scene.bounds.minX;
	const spanY = scene.bounds.maxY - scene.bounds.minY;
	const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
	const offsetX = (width - spanX * scale) / 2;
	const offsetY = (height - spanY * scale) / 2;
	// Wall y points up, SVG y points down
	const map = (point: TVec2): TVec2 => ({ x: offsetX + (point.x - scene.bounds.minX) * scale, y: offsetY + (scene.bounds.maxY - point.y) * scale });
	const points = (line: TVec2[]): string => line.map((point) => `${map(point).x.toFixed(2)},${map(point).y.toFixed(2)}`).join(' ');
	const palette = paletteOf(item === 'marble' ? 'platform' : item);
	const piece = scene.piece;

	return (
		<svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="block overflow-visible">
			{scene.trail.length >= 2 ? (
				<polyline points={points(scene.trail)} fill="none" stroke="var(--text-tertiary)" strokeWidth={1.2} strokeDasharray="2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
			) : null}
			{piece != null ? <PieceDrawing piece={piece} map={map} points={points} scale={scale} palette={palette} /> : null}
			{scene.marble != null ? (
				<>
					<circle cx={map(scene.marble).x} cy={map(scene.marble).y} r={DEFAULT_MARBLE_RADIUS * scale} fill="var(--preview-marble)" />
					<circle
						cx={map(scene.marble).x - DEFAULT_MARBLE_RADIUS * scale * 0.35}
						cy={map(scene.marble).y - DEFAULT_MARBLE_RADIUS * scale * 0.35}
						r={DEFAULT_MARBLE_RADIUS * scale * 0.3}
						fill="white"
						fillOpacity={0.55}
					/>
				</>
			) : null}
		</svg>
	);
};

interface TPiecePreviewProps {
	item: TInsertItem;
	width?: number;
	height?: number;
}

const PieceDrawing: React.FC<TPieceDrawingProps> = (props) => {
	const { piece, map, points, scale, palette } = props;
	const path = piece.path ?? [];
	const kind = layoutOf(piece.type);
	if (kind === 'path') {
		const spread = Math.max((piece.params['radius'] ?? 0.0025) * 1.3 * scale, 1.6);
		const wire = Math.max((piece.params['radius'] ?? 0.0025) * 0.9 * scale, 1.1);
		return (
			<g>
				<polyline points={points(path)} fill="none" stroke={palette.bar} strokeOpacity={0.2} strokeWidth={spread * 2} strokeLinejoin="round" strokeLinecap="round" />
				{[spread, -spread].map((offset) => (
					<polyline
						key={offset}
						points={toPoints(offsetPolyline(path.map(map), offset))}
						fill="none"
						stroke={palette.bar}
						strokeWidth={wire}
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				))}
			</g>
		);
	}
	if (kind === 'tube') {
		const ceiling = tubeCeiling(piece);
		const wall = Math.max((piece.params['radius'] ?? 0.002) * 2 * scale, 1.4);
		return (
			<g>
				{ceiling.length >= 2 ? <polygon points={points([...path, ...[...ceiling].reverse()])} fill={palette.bar} fillOpacity={0.3} /> : null}
				<polyline points={points(path)} fill="none" stroke={palette.nub} strokeWidth={wall} strokeLinecap="round" strokeLinejoin="round" />
				{ceiling.length >= 2 ? <polyline points={points(ceiling)} fill="none" stroke={palette.nub} strokeWidth={wall} strokeLinecap="round" strokeLinejoin="round" /> : null}
			</g>
		);
	}
	if (kind === 'catcher') {
		// A clear wire cage: two wires with a pale band between, like the canvas draws it
		const spread = Math.max((piece.params['radius'] ?? 0.0025) * 1.3 * scale, 1.6);
		const wire = Math.max((piece.params['radius'] ?? 0.0025) * 0.9 * scale, 1.1);
		return (
			<g>
				{(piece.paths ?? []).map((line) => (
					<g key={toPoints(line)}>
						<polyline points={points(line)} fill="none" stroke={palette.bar} strokeOpacity={0.2} strokeWidth={spread * 2} strokeLinejoin="round" strokeLinecap="round" />
						{[spread, -spread].map((offset) => (
							<polyline key={offset} points={toPoints(offsetPolyline(line.map(map), offset))} fill="none" stroke={palette.bar} strokeWidth={wire} strokeLinecap="round" strokeLinejoin="round" />
						))}
					</g>
				))}
			</g>
		);
	}
	return (
		<g>
			{(piece.shapes ?? []).map((shape) => {
				const key = JSON.stringify(shape);
				if (shape.kind === 'box') {
					const { cx, cy, angle, halfLength, halfThickness } = shape.box;
					const cos = Math.cos(angle);
					const sin = Math.sin(angle);
					const corners = [
						[-1, -1],
						[1, -1],
						[1, 1],
						[-1, 1]
					].map(([u = 0, v = 0]) => ({ x: cx + u * halfLength * cos - v * halfThickness * sin, y: cy + u * halfLength * sin + v * halfThickness * cos }));
					return <polygon key={key} points={points(corners)} fill={palette.bar} stroke={palette.nub} strokeWidth={0.8} strokeLinejoin="round" />;
				}
				if (shape.kind === 'ball') {
					const center = map(shape.center);
					return <circle key={key} cx={center.x} cy={center.y} r={Math.max(shape.radius * scale, 1.5)} fill={palette.nub} />;
				}
				const a = map(shape.a);
				const b = map(shape.b);
				return <line key={key} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={palette.bar} strokeWidth={Math.max(shape.radius * 2 * scale, 1.5)} strokeLinecap="round" />;
			})}
		</g>
	);
};

interface TPieceDrawingProps {
	piece: TResolvedPiece;
	map: (point: TVec2) => TVec2;
	points: (line: TVec2[]) => string;
	scale: number;
	palette: { bar: string; nub: string };
}

function toPoints(line: TVec2[]): string {
	return line.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
}

// MARK: - Scenes

interface TPreviewScene {
	piece: TResolvedPiece | null;
	marble: TVec2 | null;
	trail: TVec2[];
	bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

function previewScene(item: TInsertItem): TPreviewScene {
	const r = DEFAULT_MARBLE_RADIUS;
	if (item === 'marble') {
		// A marble released from rest falls away in an arc
		const trail = arc({ x: 0, y: 0 }, { x: 0.05, y: -0.07 }, { x: 0.012, y: -0.005 });
		return withBounds({ piece: null, marble: { x: 0, y: 0 }, trail });
	}
	const kind = layoutOf(item);
	const path = kind === 'path' || kind === 'tube' ? { points: resolvePiecePath(item, undefined) } : undefined;
	const piece = createFreePiece(item, { position: { x: 0, y: 0 }, angle: 0 }, [], path);
	const resolvedPiece = displayPiece(piece, { pose: { position: { x: 0, y: 0 }, angle: 0 } });
	const line = resolvedPiece.path ?? [];
	const params = resolvedPiece.params;
	switch (kind) {
		case 'box': {
			const top = (params['thickness'] ?? 0.012) / 2 + r;
			const half = (params['length'] ?? 0.09) / 2;
			const trail = [...arc({ x: -half * 0.9, y: top + 0.06 }, { x: 0, y: top }, { x: -half * 0.5, y: top + 0.05 }), ...arc({ x: 0, y: top }, { x: half * 1.1, y: top + 0.035 }, { x: half * 0.55, y: top + 0.06 })];
			return withBounds({ piece: resolvedPiece, marble: { x: 0, y: top }, trail });
		}
		case 'path':
		case 'generated': {
			const at = alongPath(line, 0.35);
			const marble = { x: at.x, y: at.y + r + (params['radius'] ?? 0.004) };
			const start = line[0] ?? { x: 0, y: 0 };
			const trail = [...arc({ x: start.x - 0.02, y: start.y + 0.05 }, { x: start.x + 0.01, y: start.y + r }, { x: start.x - 0.012, y: start.y + 0.03 }), marble];
			return withBounds({ piece: resolvedPiece, marble, trail });
		}
		case 'tube': {
			const mouth = alongPath(line, 0.08);
			const inside = line.map((point) => ({ x: point.x, y: point.y + r }));
			const trail = [{ x: mouth.x - 0.006, y: mouth.y + 0.06 }, { x: mouth.x, y: mouth.y + r }, ...inside.filter((point) => point.x > mouth.x)];
			return withBounds({ piece: resolvedPiece, marble: { x: mouth.x - 0.006, y: mouth.y + 0.06 }, trail });
		}
		case 'rotor': {
			const reach = (params['bladeLength'] ?? 0.09) + (params['hubRadius'] ?? 0.012);
			const hitAt = { x: reach * 0.72, y: (params['bladeThickness'] ?? 0.009) / 2 + r };
			const trail = [...arc({ x: hitAt.x - 0.035, y: hitAt.y + 0.07 }, hitAt, { x: hitAt.x - 0.03, y: hitAt.y + 0.04 }), ...arc(hitAt, { x: reach * 1.25, y: -reach * 0.5 }, { x: reach * 1.05, y: hitAt.y + 0.01 })];
			return withBounds({ piece: resolvedPiece, marble: hitAt, trail });
		}
		case 'catcher': {
			// The marble drops into the curve and settles in it
			const wire = resolvedPiece.paths?.[0] ?? [];
			const mouth = resolvedPiece.position;
			const trail = [{ x: mouth.x, y: mouth.y + 0.06 }, mouth, ...wire.slice(Math.floor(wire.length * 0.6)).map((point) => ({ x: point.x, y: point.y + r }))];
			return withBounds({ piece: resolvedPiece, marble: { x: mouth.x, y: mouth.y + 0.03 }, trail });
		}
	}
}

function withBounds(scene: Omit<TPreviewScene, 'bounds'>): TPreviewScene {
	const points: TVec2[] = [...scene.trail];
	if (scene.marble != null) points.push({ x: scene.marble.x - DEFAULT_MARBLE_RADIUS, y: scene.marble.y - DEFAULT_MARBLE_RADIUS }, { x: scene.marble.x + DEFAULT_MARBLE_RADIUS, y: scene.marble.y + DEFAULT_MARBLE_RADIUS });
	for (const shape of scene.piece?.shapes ?? []) {
		if (shape.kind === 'capsule') points.push(shape.a, shape.b);
		else if (shape.kind === 'ball') points.push({ x: shape.center.x - shape.radius, y: shape.center.y - shape.radius }, { x: shape.center.x + shape.radius, y: shape.center.y + shape.radius });
		else {
			const reach = Math.hypot(shape.box.halfLength, shape.box.halfThickness);
			points.push({ x: shape.box.cx - reach, y: shape.box.cy - shape.box.halfThickness }, { x: shape.box.cx + reach, y: shape.box.cy + shape.box.halfThickness });
		}
	}
	for (const line of scene.piece?.paths ?? []) points.push(...line);
	const minX = Math.min(...points.map((point) => point.x));
	const maxX = Math.max(...points.map((point) => point.x));
	const minY = Math.min(...points.map((point) => point.y));
	const maxY = Math.max(...points.map((point) => point.y));
	// Keep a minimum span so a flat piece is not stretched into the whole tile
	const spanX = Math.max(maxX - minX, 0.08);
	const spanY = Math.max(maxY - minY, 0.04);
	const midX = (minX + maxX) / 2;
	const midY = (minY + maxY) / 2;
	return { ...scene, bounds: { minX: midX - spanX / 2, maxX: midX + spanX / 2, minY: midY - spanY / 2, maxY: midY + spanY / 2 } };
}

/** Quadratic curve from `a` to `b` bent toward `control`, as a short polyline */
function arc(a: TVec2, b: TVec2, control: TVec2): TVec2[] {
	const points: TVec2[] = [];
	for (let i = 0; i <= 12; i++) {
		const t = i / 12;
		const u = 1 - t;
		points.push({ x: u * u * a.x + 2 * u * t * control.x + t * t * b.x, y: u * u * a.y + 2 * u * t * control.y + t * t * b.y });
	}
	return points;
}

/** Point at `fraction` of a polyline's length */
function alongPath(line: TVec2[], fraction: number): TVec2 {
	const lengths = line.slice(1).map((point, index) => Math.hypot(point.x - (line[index]?.x ?? 0), point.y - (line[index]?.y ?? 0)));
	let remaining = lengths.reduce((sum, length) => sum + length, 0) * fraction;
	for (let i = 0; i < lengths.length; i++) {
		const length = lengths[i] ?? 0;
		const a = line[i] as TVec2;
		const b = line[i + 1] as TVec2;
		if (remaining <= length && length > 0) return { x: a.x + ((b.x - a.x) * remaining) / length, y: a.y + ((b.y - a.y) * remaining) / length };
		remaining -= length;
	}
	return line.at(-1) ?? { x: 0, y: 0 };
}
