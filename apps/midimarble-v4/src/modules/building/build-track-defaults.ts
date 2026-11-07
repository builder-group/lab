/**
 * How far either side of a marble's center Build Track and Next aim the marble's strikes, in piece lengths: only a default
 * that ranks their tries. The reference short hops 0.65 bars (references.md, What good tracks do); at half gravity and
 * half-second notes a hop under a bar clears nothing, so 1.44.
 */
const STRIKE_COLUMN = 0.72;

/** Where on a marble's sides the marble strikes, either side of its center */
export function columnOffset(pieceLength: number): number {
	return STRIKE_COLUMN * pieceLength;
}
