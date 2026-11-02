import { useViewport } from '@xyflow/react';
import React from 'react';

export const CanvasRulers: React.FC<{
	width: number;
	height: number;
}> = React.memo(({ width, height }) => {
	const viewport = useViewport();
	const step = [10, 20, 50, 100, 200, 500, 1000, 2000].find((n) => n * viewport.zoom >= 65) ?? 2000;
	const ticks = (offset: number, length: number): { position: number; value: number }[] => {
		const first = Math.floor(-offset / viewport.zoom / step) * step;
		return Array.from({ length: Math.ceil(length / (step * viewport.zoom)) + 2 }, (_, i) => ({
			value: first + i * step,
			position: offset + (first + i * step) * viewport.zoom
		}));
	};
	return (
		<>
			<div className="canvas-ruler-corner">mm</div>
			<svg className="canvas-ruler horizontal" width={width} height={22}>
				{ticks(viewport.x, width).map((t) => (
					<g key={t.value} transform={`translate(${t.position},0)`}>
						<path d="M0 15V22" />
						<text x="4" y="11">
							{t.value}
						</text>
					</g>
				))}
			</svg>
			<svg className="canvas-ruler vertical" width={22} height={height}>
				{ticks(viewport.y, height).map((t) => (
					<g key={t.value} transform={`translate(0,${t.position})`}>
						<path d="M15 0H22" />
						<text transform="translate(10,-4) rotate(-90)">{t.value}</text>
					</g>
				))}
			</svg>
		</>
	);
});
CanvasRulers.displayName = 'CanvasRulers';
