import type { TBuildGapPreference } from './build-track';
import type { TGapPieceType } from './worker-protocol';

// What fills an empty rest, one order for Build Entire Track, the bar and `propose`: a single Curved Rail, then the gap
// pieces, the plain Rail and the Switchback layout, then a Platform at the note after the rest. An order, not a
// judgment: a kind that doesn't fit gives way to the next. Build compares the plain Rail and the Switchback layout by
// building on from each when both fit, the Switchback's hooks costing more; the bar and `propose` offer no plain Rail.

/** A kind that fills a rest, as `propose` names it: `longRail` is the Curved Rail, `platform` a Platform at the note after */
export type TRestKind = 'longRail' | TGapPieceType | 'platform';

/** The kinds a rest tries, in order. A gap piece asked for by name goes first, with the one it's measured against after it */
export function restOrder(preferred?: TBuildGapPreference | null): TRestKind[] {
	if (preferred === 'chain') return ['chain', 'switchback', 'platform'];
	if (preferred === 'switchback') return ['switchback', 'rail', 'platform'];
	if (preferred === 'rail') return ['rail', 'switchback', 'platform'];
	return ['longRail', 'rail', 'switchback', 'platform'];
}

/** What the bar and `propose` offer at an empty rest, in the same order: a plain Rail across a rest is Build's own */
export function restOffers(): TRestKind[] {
	return restOrder().filter((kind) => kind !== 'rail');
}

/** The gap piece Build asks the workers for: the Curved Rail is one ramp (`curve`), and a Platform is no gap piece */
export function gapTypeOf(kind: TRestKind): TGapPieceType | null {
	if (kind === 'platform') return null;
	return kind === 'longRail' ? 'curve' : kind;
}
