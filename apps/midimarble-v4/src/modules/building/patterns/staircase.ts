import type { TPatternDefinition } from './contract';
import { fitBarPattern } from './fit-bar-pattern';

export const staircase: TPatternDefinition = {
	label: 'Staircase',
	title: 'One way across the wall, a step on every note',
	takes: 'notes',
	defaults: { width: 0.09, bounce: 0.5 },
	widthRange: { min: 0.05, max: 0.16 },
	drop: 0.12,
	glyph: {
		guide: 'M10 7 L19 13 L28 19 L37 25',
		marks: ['M5 8 L14 10', 'M14 14 L23 16', 'M23 20 L32 22', 'M32 26 L41 28'],
		markWidth: 2
	},
	fit: (input, world) => fitBarPattern('staircase', input, world)
};
