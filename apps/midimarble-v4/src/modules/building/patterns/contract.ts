import type { THit, TPiece, TProject, TVec2 } from '@/modules/project';
import type { TSimulator } from '@/modules/simulation';

// What a Pattern is: a pure calculation from where the marble arrives, the hits it was given and its settings to pieces,
// how the marble leaves them and a verdict per hit. It changes nothing, so asking is free: `checkPattern` asks first, shows
// the answer, and only an answer whose every verdict fits is ever applied. A Pattern's stored part is kind, hitIds and
// settings; the verdict is worked out each time.

/** How the marble moves at a moment: where it arrives at a Pattern's first hit, or where it leaves it */
export interface TPatternMoment {
	position: TVec2;
	velocity: TVec2;
	time: number;
}

/** What a person or an agent sets; stored on the Group */
export interface TPatternSettings {
	/** Bar centers apart (Zigzag) or sideways per hit (Staircase), in meters: what's asked is what's built */
	width: number;
	/** How lively the hops are: a higher one falls less per hit */
	bounce: number;
	/** The steepest a bar may tilt, in degrees; the usual limit otherwise */
	maxTilt?: number;
}

/** What one hit makes of a Pattern */
export interface THitVerdict {
	hitId: string;
	/** Whether it plays. A hit that plays but not quite as asked fits, with words saying so */
	fits: boolean;
	words: string | null;
}

export interface TPatternInput {
	/** Null when the marble isn't there at the first hit */
	arrival: TPatternMoment | null;
	/** In time order. A Pattern for silence gets the notes around it, or the one note it opens the track for */
	hits: readonly THit[];
	settings: TPatternSettings;
}

/** What a Pattern works in, besides its input: the wall without the pieces it replaces, and how far to look */
export interface TPatternWorld extends TPatternOptions {
	project: TProject;
	marbleId: string;
	sim: TSimulator;
	onProgress?: ((fraction: number) => void) | undefined;
}

/** Ways to ask for a fit that aren't settings: they follow from the pieces there now, or from what's calling */
export interface TPatternOptions {
	/** The same bounce on every bar, in place of a bounce per bar aiming for a drop */
	fixedBounce?: number;
	/** The wall drop per hit a bounce per bar aims for, in meters */
	drop?: number;
	/** Bar size, the default plate's otherwise: Length changes the run, Depth is only how far it stands out */
	barLength?: number;
	barDepth?: number;
	/** How many nearby shapes to try for a clean one */
	maxTries?: number;
	/** End at the first bar that can't play: nothing can apply after it, so a check says no sooner. A ghost goes on, to show the shape */
	stopsAtBadBar?: boolean;
	/** The last bar keeps its own direction instead of turning the marble toward the frame's middle */
	keepsDirection?: boolean;
	/** The way the track goes now, on a song already built: fit it so what follows can stay where it stands */
	along?: TPatternCourse;
}

/** Where the marble is now at the hits a Pattern takes over and at the next note, and how it leaves them */
export interface TPatternCourse {
	dots: ReadonlyMap<string, TVec2>;
	leaves: ReadonlyMap<string, TPatternLeaving>;
	/** Start on the other side from the way the track crosses */
	isOtherSide?: boolean;
}

/** How a marble leaves a bar: where it is this long after, from the hit. Leaving the same way, it meets what follows the same way */
export interface TPatternLeaving {
	offset: TVec2;
	after: number;
}

export interface TPatternFit {
	pieces: TPiece[];
	/** How the marble leaves it: at the next note, or 0.3 s after the last */
	exit: TPatternMoment | null;
	/** One per hit given */
	verdicts: THitVerdict[];
	/** The note after its hits, when the fit can't reach it: the ending is part of the check */
	ending: THitVerdict | null;
	/** What's worth saying that isn't wrong, such as bars steeper than usual */
	notes: string[];
	/** The world with its pieces in place */
	project: TProject;
	/** The width and drop it used: a neighboring drop when the asked one left problems */
	width: number;
	drop: number | null;
	/** Physics runs it took, and how many shapes it tried */
	sims: number;
	tries: number;
}

/**
 * One Pattern. A new one is this object in a file of its own and a line in `PATTERNS`: the tiles, the words, the commands
 * and the agent's list read from here.
 */
export interface TPatternDefinition {
	/** The tile's name, and the Group's */
	label: string;
	/** The tile's tooltip */
	title: string;
	/** Whether it plays notes or fills the silence between them; it decides which ranges offer its tile */
	takes: 'notes' | 'silence';
	/** Where its settings start */
	defaults: Pick<TPatternSettings, 'width' | 'bounce'>;
	/** What the inspector's Width slider offers; a Pattern without a Width shows none */
	widthRange: { min: number; max: number } | null;
	/** The wall drop per hit at Bounce 0.5, when it plays notes */
	drop: number | null;
	/** The tile's drawing, in a 48 by 36 box: thick marks, a thin guide and a marble */
	glyph: TPatternGlyph;
	fit: (input: TPatternInput, world: TPatternWorld) => TPatternFit;
}

export interface TPatternGlyph {
	marks: readonly string[];
	markWidth: number;
	guide?: string;
	marble?: { x: number; y: number };
}
