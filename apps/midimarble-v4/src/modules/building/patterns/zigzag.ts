import type { TPatternDefinition } from './contract';
import { ZIGZAG_WIDTH } from './fit-bars';
import { fitBarPattern } from './fit-bar-pattern';

export const zigzag: TPatternDefinition = {
	label: 'Zigzag',
	title: 'Two columns: the marble crosses between them on every hit',
	takes: 'notes',
	defaults: { width: ZIGZAG_WIDTH, bounce: 0.5 },
	widthRange: { min: 0.1, max: 0.26 },
	drop: 0.08,
	glyph: {
		guide: 'M15 6 L33 12 L15 18 L33 24 L15 30',
		marks: ['M9 8 L19 5', 'M9 20 L19 17', 'M9 32 L19 29', 'M29 11 L39 14', 'M29 23 L39 26'],
		markWidth: 2
	},
	fit: (input, world) => fitBarPattern('zigzag', input, world)
};
