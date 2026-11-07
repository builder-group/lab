import { Folder } from 'lucide-react';
import React from 'react';
import type { TGroup } from '@/modules/project';
import { isPatternKind, type TPatternKind } from '@/modules/building';

/** Each Pattern's shape, drawn as lucide draws its glyphs, so a live Pattern reads as what it makes */
const SHAPES: Record<TPatternKind, string> = {
	zigzag: 'M5 4 19 9 5 14 19 19',
	staircase: 'M4 5h5v5h5v5h5v5',
	// A rail that goes out and comes back, as a Curved Rail holds the marble through a rest
	longRail: 'M17 4C5 5 5 19 17 20'
};

/**
 * A Group's icon wherever it shows, in Layers, the strip, the bar and the inspector: a live Pattern's shape, a plain
 * Group's folder, so Flatten visibly turns one into the other
 */
export const GroupIcon: React.FC<{ group: Pick<TGroup, 'pattern'>; size?: number }> = (props) => {
	const { group, size = 14 } = props;
	const kind = group.pattern?.kind;
	if (kind == null || !isPatternKind(kind)) return <Folder size={size} strokeWidth={1.75} aria-hidden />;
	return (
		<svg className="mm-group-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<path d={SHAPES[kind]} />
		</svg>
	);
};
