import React from 'react';
import type { THitResult, TPieceStatus } from '@/modules/simulation';

// Hit status colours always come with a glyph, so they stay readable without colour

export type TBadgeStatus = Exclude<THitResult['status'], 'open'>;

export const badgeStyles: Record<TBadgeStatus, { color: string; glyph: string; label: string }> = {
	onTime: { color: 'var(--good)', glyph: 'M -2.6 0.2 L -0.8 2 L 2.6 -1.8', label: 'On Time' },
	drifting: { color: 'var(--warn)', glyph: 'M -2.8 0.8 C -1.6 -1.4 -0.4 -1.2 0 0 C 0.4 1.2 1.6 1.4 2.8 -0.8', label: 'Early or Late' },
	missed: { color: 'var(--bad)', glyph: 'M -2.2 -2.2 L 2.2 2.2 M 2.2 -2.2 L -2.2 2.2', label: 'Missed' },
	blocked: { color: 'var(--bad)', glyph: 'M 0 -2.8 L 0 0.8 M 0 2.6 L 0 2.7', label: 'Blocked' }
};

/** The badge status of a piece, from its own status and the result of its hit */
export function badgeStatus(pieceStatus: TPieceStatus | undefined, hit: THitResult | undefined): TBadgeStatus | null {
	if (pieceStatus === 'blocked') return 'blocked';
	if (pieceStatus === 'unreached') return 'missed';
	if (hit == null || hit.status === 'open') return null;
	return hit.status;
}

/** Badge glyph centred on the origin, for use inside an SVG */
export const StatusBadge: React.FC<{ status: TBadgeStatus; radius?: number }> = (props) => {
	const { status, radius = 6 } = props;
	const style = badgeStyles[status];
	const scale = radius / 6;
	return (
		<>
			<circle r={radius} fill={style.color} stroke="var(--canvas)" strokeWidth={1.5} />
			<path d={style.glyph} transform={`scale(${scale})`} fill="none" stroke="white" strokeWidth={1.4 / scale} strokeLinecap="round" strokeLinejoin="round" />
		</>
	);
};

/** Standalone status icon for lists and the inspector */
export const StatusIcon: React.FC<{ status: TBadgeStatus | null; size?: number }> = (props) => {
	const { status, size = 12 } = props;
	if (status == null) {
		return (
			<svg width={size} height={size} viewBox="-6 -6 12 12" aria-label="Open">
				<circle r={4} fill="none" stroke="var(--text-tertiary)" strokeWidth={1.2} />
			</svg>
		);
	}
	const style = badgeStyles[status];
	return (
		<svg width={size} height={size} viewBox="-6 -6 12 12" role="img" aria-label={style.label}>
			<circle r={6} fill={style.color} />
			<path d={style.glyph} fill="none" stroke="white" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
};
