import { Folder } from 'lucide-react';
import React from 'react';
import type { TGroup } from '@/modules/project';
import { isPatternKind, type TPatternKind } from '@/modules/building';
import { PieceIcon } from '@/modules/canvas';

/** Each Pattern's shape, drawn as lucide draws its glyphs, so a live Pattern reads as what it makes */
const SHAPES: Record<TPatternKind | 'switchback', string> = {
	zigzag: 'M5 4 19 9 5 14 19 19',
	staircase: 'M4 5h5v5h5v5h5v5',
	// A rail that goes out and comes back, as a Curved Rail holds the marble through a rest
	longRail: 'M17 4C5 5 5 19 17 20',
	// Straight runs one under another with round turns, as a Switchback holds the marble through a long rest
	switchback: 'M4 5h13a3 3 0 0 1 0 6H7a3 3 0 0 0 0 6h13'
};

const PatternShape: React.FC<{ kind: keyof typeof SHAPES; size: number }> = (props) => {
	const { kind, size } = props;
	return (
		<svg className="mm-group-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<path d={SHAPES[kind]} />
		</svg>
	);
};

/**
 * Flatten: two arrows pressing onto one line, make it plain. Tried beside a folder with an arrow into it, which read as
 * Move to Folder, a zigzag over an arrow and a line, too busy at 14 px, and Fold Vertical's dashed line, which reads as a split
 */
export const FlattenIcon: React.FC<{ size?: number }> = (props) => {
	const { size = 14 } = props;
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<path d="M12 2v6M15 5l-3 3-3-3M3 12h18M12 22v-6M15 19l-3-3-3 3" />
		</svg>
	);
};

/**
 * What a kind in the bar's dropdown makes: a Pattern's shape, as in Layers and the strip, or the Platform's piece icon, so
 * Patterns read apart from the one piece. Null for a command
 */
export const KindIcon: React.FC<{ kind: string; size?: number }> = (props) => {
	const { kind, size = 14 } = props;
	if (kind === 'platform') return <PieceIcon type="platform" size={size} />;
	return kind in SHAPES ? <PatternShape kind={kind as keyof typeof SHAPES} size={size} /> : null;
};

/**
 * A Group's icon wherever it shows, in Layers, the strip, the bar and the inspector: a live Pattern's shape, a plain
 * Group's folder, so Flatten visibly turns one into the other
 */
export const GroupIcon: React.FC<{ group: Pick<TGroup, 'pattern'>; size?: number }> = (props) => {
	const { group, size = 14 } = props;
	const kind = group.pattern?.kind;
	if (kind == null || !isPatternKind(kind)) return <Folder size={size} strokeWidth={1.75} aria-hidden />;
	return <PatternShape kind={kind} size={size} />;
};
