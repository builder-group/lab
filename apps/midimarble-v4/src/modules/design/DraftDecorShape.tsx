import React from 'react';
import type { TDraftDecor } from './DraftPreviewCx';

// A decoration in the Draft Preview: a cheap stand-in for what Blender builds, drawn in the item's own metres (x right,
// y down, centred) through a matrix that keeps it flat on the wall. Blender's preview shows the real look.

export const DraftDecorShape: React.FC<{ decor: TDraftDecor }> = (props) => {
	const { decor } = props;
	return (
		<g transform={decor.matrix} opacity={decor.opacity * (decor.item?.opacity ?? 1)}>
			<Shape decor={decor} />
		</g>
	);
};

const Shape: React.FC<{ decor: TDraftDecor }> = (props) => {
	const { decor } = props;
	const { item, extent, previewUrl } = decor;
	if (item == null) {
		return previewUrl != null ? (
			<image href={previewUrl} x={-extent.x} y={-extent.y} width={extent.x * 2} height={extent.y * 2} preserveAspectRatio="xMidYMid meet" />
		) : (
			<rect x={-extent.x} y={-extent.y} width={extent.x * 2} height={extent.y * 2} rx={extent.y * 0.2} fill="#ffffff" fillOpacity={0.4} stroke="#000000" strokeOpacity={0.3} strokeWidth={extent.y * 0.05} />
		);
	}
	const { color, second } = item;
	switch (item.id) {
		case 'decor:bauble-red':
		case 'decor:bauble-gold':
			return (
				<>
					<circle cx={0} cy={0.003} r={0.013} fill={color} />
					<circle cx={-0.004} cy={-0.001} r={0.003} fill="#ffffff" fillOpacity={0.65} />
					<rect x={-0.003} y={-0.0135} width={0.006} height={0.004} fill="#c9b37a" />
					<circle cx={0} cy={-0.015} r={0.0012} fill="none" stroke="#c9b37a" strokeWidth={0.0007} />
				</>
			);
		case 'decor:snowflake-gold':
			return (
				<g stroke={color} strokeWidth={0.0018} strokeLinecap="round">
					{[0, 60, 120].map((angle) => (
						<line key={angle} x1={0} y1={-0.016} x2={0} y2={0.016} transform={`rotate(${angle})`} />
					))}
					{[0, 60, 120, 180, 240, 300].map((angle) => (
						<g key={angle} transform={`rotate(${angle})`}>
							<line x1={0} y1={-0.01} x2={-0.0045} y2={-0.0145} />
							<line x1={0} y1={-0.01} x2={0.0045} y2={-0.0145} />
						</g>
					))}
				</g>
			);
		case 'decor:fairy-light':
			return (
				<>
					<path d="M -0.033 -0.004 Q 0 0.012 0.033 -0.004" fill="none" stroke="#3a3a3a" strokeWidth={0.0006} />
					{[-0.03, -0.02, -0.01, 0, 0.01, 0.02, 0.03].map((x) => (
						<circle key={x} cx={x} cy={0.004 - (x * x) / 0.11 + 0.002} r={0.0022} fill={color} style={{ filter: 'drop-shadow(0 0 2px rgb(255 214 138 / 0.9))' }} />
					))}
				</>
			);
		case 'decor:gift-box':
			return (
				<>
					<rect x={-0.013} y={-0.009} width={0.026} height={0.024} rx={0.001} fill={color} />
					<rect x={-0.0025} y={-0.009} width={0.005} height={0.024} fill={second} />
					<rect x={-0.014} y={-0.011} width={0.028} height={0.005} rx={0.001} fill={color} />
					<path d="M 0 -0.011 C -0.008 -0.019 -0.011 -0.011 0 -0.011 C 0.011 -0.011 0.008 -0.019 0 -0.011 Z" fill={second} />
				</>
			);
		case 'decor:sphere':
			return (
				<>
					<circle cx={0} cy={0} r={0.013} fill={color} />
					<circle cx={-0.004} cy={-0.004} r={0.003} fill="#ffffff" fillOpacity={0.65} />
				</>
			);
		case 'decor:ring':
			return <circle cx={0} cy={0} r={0.012} fill="none" stroke={color} strokeWidth={0.006} />;
		case 'decor:cube':
			return <rect x={-0.012} y={-0.012} width={0.024} height={0.024} rx={0.001} fill={color} />;
		case 'decor:star':
			return <polygon points={starPoints(0.016, 0.0068)} fill={color} stroke="#a67c1e" strokeWidth={0.0005} strokeLinejoin="round" />;
		default:
			return null;
	}
};

function starPoints(outer: number, inner: number): string {
	return Array.from({ length: 10 }, (_, index) => {
		const radius = index % 2 === 0 ? outer : inner;
		const angle = (index / 10) * Math.PI * 2 - Math.PI / 2;
		return `${radius * Math.cos(angle)},${radius * Math.sin(angle)}`;
	}).join(' ');
}
